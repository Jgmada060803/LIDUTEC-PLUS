(async function initializeDashboardMacharia() {
  const q = (selector) => document.querySelector(selector);
  const esc = (value = "") => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const number = (value) => { const n = Number(value); return Number.isFinite(n) ? n : 0; };
  const isoDateOnly = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

  const user = await LIDUTEC_APP.requireAuthenticatedUser();
  if (!user) return;
  const [profile, permissions] = await Promise.all([
    LIDUTEC_APP.getCurrentUserProfile(user.id),
    LIDUTEC_APP.getUserPermissions(user.id)
  ]);
  if (!permissions.has("producao_macharia.visualizar")) throw new Error("Usuário sem permissão para ver o dashboard de Macharia.");
  LIDUTEC_APP.applyPermissionVisibility(permissions);
  q("#user-name").textContent = profile.nome;
  q("#user-profile").textContent = profile.perfil || "Usuário";
  q("#user-avatar").textContent = profile.nome.slice(0, 1).toUpperCase();
  q("#menu-button").addEventListener("click", () => q("#sidebar").classList.toggle("open"));
  q("#logout-button").addEventListener("click", () => LIDUTEC_APP.signOut());

  const state = { maquinas: [] };

  function message(text, type = "error") {
    const el = q("#macharia-dashboard-message");
    el.textContent = text;
    el.className = `form-message ${type}`;
    el.hidden = false;
  }

  function maquinaStorageKey() {
    return `lidutec:dashboard-macharia:maquina:${user.id}`;
  }

  function hourLabel(isoEnd) {
    const pad = (n) => String(n).padStart(2, "0");
    const end = new Date(isoEnd);
    const start = new Date(end.getTime() - 3600000);
    return `${pad(start.getHours())}:00 às ${pad(end.getHours())}:00`;
  }

  async function loadMaquinas() {
    const { data, error } = await window.supabaseClient
      .from("linhas_maquinas_producao")
      .select("id,codigo,nome,areas_checklist!inner(codigo)")
      .eq("areas_checklist.codigo", "MACHARIA")
      .eq("ativo", true)
      .order("codigo");
    if (error) throw error;
    state.maquinas = data || [];
    const select = q("#macharia-dashboard-maquina");
    select.innerHTML = state.maquinas.map((m) => `<option value="${m.id}">${esc(m.nome)}</option>`).join("");
    const saved = localStorage.getItem(maquinaStorageKey());
    const savedValid = saved && state.maquinas.some((m) => String(m.id) === saved);
    select.value = savedValid ? saved : (state.maquinas[0]?.id ?? "");
  }

  // Resolve o período em análise conforme o modo do filtro "Turno":
  // um turno específico, os 3 turnos do dia escolhido, ou uma janela móvel
  // das últimas 24h (não depende da data escolhida).
  function resolvePeriod(data, turnoCodigo) {
    if (turnoCodigo === "ULTIMAS_24H") {
      const end = new Date();
      const start = new Date(end.getTime() - 24 * 3600000);
      return { mode: "ultimas24h", start, end, minutosPeriodo: 1440, label: "Últimas 24 horas" };
    }
    if (turnoCodigo === "TODOS") {
      const start = window.LIDUTEC_TURNOS.shiftBounds(data, "MANHA").start;
      const end = window.LIDUTEC_TURNOS.shiftBounds(data, "NOITE").end;
      const minutosPeriodo = Object.values(window.LIDUTEC_TURNOS.shifts).reduce((sum, s) => sum + s.minutos, 0);
      return { mode: "todos", start, end, minutosPeriodo, label: "Todos os turnos" };
    }
    const bounds = window.LIDUTEC_TURNOS.shiftBounds(data, turnoCodigo);
    const turnoInfo = window.LIDUTEC_TURNOS.shifts[turnoCodigo];
    return { mode: "turno", start: bounds.start, end: bounds.end, minutosPeriodo: turnoInfo.minutos, label: turnoInfo.nome };
  }

  // Meta por hora = média das metas (sopro_por_hora) dos machos ativos
  // naquela hora, ponderada pelo nº de estações rodando cada um (cada
  // linha de registro = 1 estação daquele macho na hora) — ex.: 1 estação
  // a 50/h + 2 a 120/h => (50+120+120)/3. Faixa de controle: ±20%.
  function computeHourlyPoints(records, hourSlots) {
    const byHour = new Map();
    for (const item of records) {
      const horaIso = new Date(item.horario_previsto).toISOString();
      if (!byHour.has(horaIso)) byHour.set(horaIso, { total: 0, byMacho: new Map() });
      const bucket = byHour.get(horaIso);
      bucket.total += number(item.quantidade_sopros);
      const machoId = String(item.macho_id);
      if (!bucket.byMacho.has(machoId)) {
        const meta = item.machos_macharia?.sopro_por_hora;
        bucket.byMacho.set(machoId, { peso: 0, meta: meta != null ? number(meta) : null });
      }
      bucket.byMacho.get(machoId).peso += 1;
    }
    return hourSlots.map((slot) => {
      const horaIso = slot.toISOString();
      const bucket = byHour.get(horaIso);
      if (!bucket) return { horaIso, hasData: false };
      let pesoTotal = 0, somaPonderada = 0;
      for (const { peso, meta } of bucket.byMacho.values()) {
        if (meta == null) continue;
        pesoTotal += peso;
        somaPonderada += peso * meta;
      }
      const meta = pesoTotal ? somaPonderada / pesoTotal : null;
      return {
        horaIso, hasData: true, total: bucket.total,
        meta, min: meta != null ? meta * 0.8 : null, max: meta != null ? meta * 1.2 : null
      };
    });
  }

  // Guarda os últimos pontos renderizados pra poder redesenhar o gráfico sob
  // demanda (zoom do navegador, redimensionamento da janela) sem precisar
  // recarregar os dados — ver o ResizeObserver no fim do arquivo.
  function renderHourlyChart(points, maquinaNome, stops, period) {
    state.lastHourlyPoints = points;
    state.lastHourlyMaquinaNome = maquinaNome;
    state.lastHourlyStops = stops;
    state.lastHourlyPeriod = period;
    const container = q("#macharia-hourly-chart");
    const withData = points.filter((p) => p.hasData);
    q("#macharia-hourly-chart-empty").hidden = withData.length > 0;
    if (!withData.length) { container.innerHTML = ""; return; }

    // ViewBox no tamanho real do espaço disponível (medido no container),
    // não um tamanho fixo arbitrário — assim o SVG preenche 100% da largura
    // E da altura sem sobrar borda vazia e sem esticar/distorcer os
    // círculos e o texto (o que preserveAspectRatio sozinho não evita).
    // Como o width/height do <svg> abaixo são atributos fixos (não CSS
    // percentual), essa medição só fica correta enquanto o container não
    // mudar de tamanho depois do render — por isso o ResizeObserver no fim
    // do arquivo chama esta função de novo sempre que o container muda
    // (zoom do navegador, redimensionamento da janela etc.), sem o quê o
    // gráfico ficava "congelado" no tamanho de quando a página carregou e
    // distorcia (texto esmagado ou esparso) até a próxima atualização de dados.
    const width = Math.max(600, Math.round(container.clientWidth) || 1400);
    const height = Math.max(240, Math.round(container.clientHeight) || 420);
    // top tem que caber a faixa da linha do tempo (linha 8-22) + respiro
    // antes da grade do gráfico começar em si.
    const margin = { top: 46, right: 30, bottom: 50, left: 66 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const values = withData.flatMap((p) => [p.total, p.min ?? p.total, p.max ?? p.total]);
    const rawMax = Math.max(10, ...values);
    const maxY = Math.ceil((rawMax * 1.25) / 10) * 10;
    const xFor = (index) => margin.left + (points.length > 1 ? (index / (points.length - 1)) * plotWidth : plotWidth / 2);
    const yFor = (value) => margin.top + (1 - value / maxY) * plotHeight;

    // Linha do tempo (sopro/parada), alinhada ao mesmo eixo X do gráfico —
    // usa o mesmo margin.left/plotWidth de xFor(), só que mapeando por
    // horário real (contínuo), não por índice de hora, porque uma parada
    // pode começar/terminar no meio da hora. Nas bordas do período (início
    // de slot = index 0, fim de slot = último index) as duas mapeações
    // coincidem exatamente, então a faixa fica alinhada aos rótulos de hora
    // do eixo abaixo sem nenhum ajuste extra.
    const timelineMarkup = (() => {
      if (!period || !stops) return "";
      const periodStartMs = period.start.getTime(), periodEndMs = period.end.getTime();
      const spanMs = periodEndMs - periodStartMs;
      if (spanMs <= 0) return "";
      const xForTime = (value) => margin.left + Math.min(1, Math.max(0, (new Date(value).getTime() - periodStartMs) / spanMs)) * plotWidth;
      const y = 8, h = 14;
      const track = `<rect x="${margin.left}" y="${y}" width="${plotWidth}" height="${h}" rx="3" class="macharia-hourly-timeline-track"/>`;
      const production = points.filter((p) => p.hasData).map((p) => {
        const end = new Date(p.horaIso), start = new Date(end.getTime() - 3600000);
        const x1 = xForTime(start), x2 = xForTime(end);
        return `<rect x="${x1}" y="${y}" width="${Math.max(1, x2 - x1)}" height="${h}" class="macharia-hourly-timeline-production"/>`;
      }).join("");
      const stopsMarkup = stops.map((stop) => {
        if (!stop.inicio || !stop.fim) return "";
        const x1 = xForTime(stop.inicio), x2 = xForTime(stop.fim);
        const cls = stop.tipo_ocorrencia === "PARCIAL" ? "macharia-hourly-timeline-stop-partial" : "macharia-hourly-timeline-stop";
        return `<rect x="${x1}" y="${y}" width="${Math.max(1, x2 - x1)}" height="${h}" class="${cls}"/>`;
      }).join("");
      return `${track}${production}${stopsMarkup}`;
    })();
    // Sem espaço suficiente por ponto, o rótulo "17:00" de um esbarra no do
    // vizinho e vira uma mancha ilegível — em vez de espremer todos, mostra
    // só 1 a cada N (sempre incluindo o primeiro e o último), do jeito que
    // qualquer biblioteca de gráfico responsiva faz. Não tem como rolar essa
    // tela (é projetada, sem mouse), então afinar os rótulos é a única saída
    // quando o container fica estreito (zoom alto, tela pequena).
    const pxPerPoint = points.length > 1 ? plotWidth / (points.length - 1) : plotWidth;
    const minLabelPx = 46;
    const labelStep = Math.max(1, Math.ceil(minLabelPx / Math.max(1, pxPerPoint)));

    const ticks = 5;
    const grid = Array.from({ length: ticks }, (_, i) => {
      const value = (maxY / (ticks - 1)) * i;
      const y = yFor(value);
      return `<line x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" class="macharia-hourly-grid-line"/>
        <text x="${margin.left - 10}" y="${y + 6}" class="macharia-hourly-axis-label" text-anchor="end">${Math.round(value)}</text>`;
    }).join("");

    const pathFor = (key) => {
      const coords = points
        .map((p, index) => (p.hasData && p[key] != null ? `${xFor(index)},${yFor(p[key])}` : null))
        .filter(Boolean);
      return coords.length ? `M${coords.join(" L")}` : "";
    };

    // Produção é diferente de outros indicadores: acima da meta é sempre
    // bom, não existe "excesso ruim". Por isso a faixa deixou de ser um teto
    // e virou 3 zonas de fundo (verde/amarelo/vermelho) relativas à meta de
    // CADA hora — a meta varia hora a hora (média ponderada dos machos
    // ativos), então os limites das zonas acompanham essa curva, não são
    // retas fixas.
    const metaPoints = points
      .map((p, index) => (p.hasData && p.meta != null ? { index, meta95: p.meta * 0.95, meta80: p.meta * 0.8 } : null))
      .filter(Boolean);
    const areaPath = (topValueFor, bottomValueFor) => {
      if (metaPoints.length < 2) return "";
      const top = metaPoints.map((m) => `${xFor(m.index)},${yFor(topValueFor(m))}`);
      const bottom = metaPoints.slice().reverse().map((m) => `${xFor(m.index)},${yFor(Math.max(0, bottomValueFor(m)))}`);
      return `M${top.join(" L")} L${bottom.join(" L")} Z`;
    };
    const zoneGreen = areaPath(() => maxY, (m) => m.meta95);
    const zoneYellow = areaPath((m) => m.meta95, (m) => m.meta80);
    const zoneRed = areaPath((m) => m.meta80, () => 0);

    // Nível de cada ponto em relação à meta daquela hora — mesmos 3 patamares
    // do fundo, aplicados também à cor do ponto e do valor escrito acima
    // dele, pra ficar consistente (sem meta cadastrada, fica neutro/azul).
    const tierFor = (p) => {
      if (p.meta == null) return null;
      if (p.total >= p.meta * 0.95) return "good";
      if (p.total >= p.meta * 0.8) return "warn";
      return "bad";
    };

    // Valor real do sopro escrito acima de cada ponto — precisa ser
    // legível de longe numa tela projetada, não só em hover. O círculo do
    // ponto sempre aparece; só o número acima dele é que some quando não
    // há espaço (mesmo critério do rótulo de hora, abaixo).
    const lastIndex = points.length - 1;
    const showLabelAt = (index) => index % labelStep === 0 || index === lastIndex;
    const pointsMarkup = points.map((p, index) => {
      if (!p.hasData) return "";
      const tier = tierFor(p);
      const cls = tier ? `macharia-hourly-point-${tier}` : "macharia-hourly-point";
      const x = xFor(index), y = yFor(p.total);
      const value = showLabelAt(index)
        ? `<text x="${x}" y="${y - 16}" class="macharia-hourly-value-label ${tier ? tier : ""}" text-anchor="middle">${p.total}</text>`
        : "";
      return `<circle cx="${x}" cy="${y}" r="6" class="${cls}"/>${value}`;
    }).join("");

    const labels = points.map((p, index) => showLabelAt(index)
      ? `<text x="${xFor(index)}" y="${height - 16}" class="macharia-hourly-axis-label" text-anchor="middle">${hourLabel(p.horaIso).split(" às ")[0]}</text>`
      : ""
    ).join("");

    // Nome da máquina bem grande, ao fundo, no meio do gráfico — dá pra
    // identificar de longe qual máquina é sem competir com os dados (fica
    // atrás das linhas, com opacidade baixa). Fonte calculada a partir da
    // largura real do gráfico (não um valor fixo do CSS): no celular
    // plotWidth é bem menor que no desktop, e um texto de 90px não cabe —
    // ficaria cortado ou vazando pra fora da área do gráfico.
    const watermark = maquinaNome
      ? (() => {
          const fontSize = Math.max(18, Math.min(90, plotWidth / (maquinaNome.length * 0.62), plotHeight * 0.6));
          return `<text x="${margin.left + plotWidth / 2}" y="${margin.top + plotHeight / 2}" class="macharia-hourly-watermark" style="font-size:${fontSize}px" text-anchor="middle">${esc(maquinaNome)}</text>`;
        })()
      : "";

    container.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" preserveAspectRatio="none" aria-hidden="true">
        <path d="${zoneGreen}" class="macharia-hourly-zone-good"/>
        <path d="${zoneYellow}" class="macharia-hourly-zone-warn"/>
        <path d="${zoneRed}" class="macharia-hourly-zone-bad"/>
        ${watermark}
        ${grid}
        <line x1="${margin.left}" y1="${margin.top + plotHeight}" x2="${width - margin.right}" y2="${margin.top + plotHeight}" class="macharia-hourly-axis"/>
        <path d="${pathFor("total")}" class="macharia-hourly-measured-line"/>
        ${pointsMarkup}
        ${labels}
        ${timelineMarkup}
      </svg>
      <div class="macharia-hourly-legend">
        <span><i style="border-color:#1f45a8"></i>Real</span>
        <span><i class="swatch macharia-hourly-zone-good"></i>≥ 95% da meta</span>
        <span><i class="swatch macharia-hourly-zone-warn"></i>80%–95% da meta</span>
        <span><i class="swatch macharia-hourly-zone-bad"></i>&lt; 80% da meta</span>
        <span><i class="swatch macharia-hourly-timeline-production"></i>Sopro</span>
        <span><i class="swatch macharia-hourly-timeline-stop"></i>Parada</span>
        <span><i class="swatch macharia-hourly-timeline-stop-partial"></i>Parada parcial</span>
      </div>
    `;
  }

  // Identificação combinada, ex.: "MS0020 CX1 M1" — código(s) do produto
  // (um macho pode servir mais de um produto, daí juntar todos com "/") +
  // caixa + macho, do jeito que já vêm cadastrados.
  function machoLabel(macho) {
    if (!macho) return "—";
    const produtos = macho.machos_macharia_produtos || [];
    const codigos = [...new Set(produtos.map((item) => item?.produtos?.codigo).filter(Boolean))];
    return [codigos.join("/") || null, macho.caixa, macho.macho].filter(Boolean).join(" ");
  }

  function renderMachosTable(records, descartes) {
    const groups = new Map();
    for (const item of records) {
      const macho = item.machos_macharia;
      const key = String(item.macho_id);
      if (!groups.has(key)) groups.set(key, { label: machoLabel(macho), machosPorSopro: number(macho?.machos_por_sopro), sopros: 0, refugados: 0 });
      groups.get(key).sopros += number(item.quantidade_sopros);
    }
    for (const item of descartes) {
      const key = String(item.macho_id);
      if (!groups.has(key)) {
        groups.set(key, { label: machoLabel(item.machos_macharia), machosPorSopro: number(item.machos_macharia?.machos_por_sopro), sopros: 0, refugados: 0 });
      }
      groups.get(key).refugados += number(item.quantidade_descartada);
    }
    const rows = [...groups.values()].sort((a, b) => b.sopros - a.sopros);
    q("#macharia-dashboard-machos-rows").innerHTML = rows.map((row) => {
      const produzidos = row.sopros * row.machosPorSopro;
      const aproveitados = Math.max(0, produzidos - row.refugados);
      return `<tr><td>${esc(row.label)}</td><td>${row.sopros}</td><td>${produzidos}</td><td>${row.refugados}</td><td>${aproveitados}</td></tr>`;
    }).join("");
    q("#macharia-dashboard-machos-empty").hidden = rows.length > 0;
  }

  // Cada tabela (Machos produzidos / Ocorrências de parada) mostra só
  // MACHARIA_TICKER_VISIBLE_ROWS linhas de cada vez — tela é projetada e
  // fixa, sem mouse pra rolar. Em vez de girar feito rolo infinito, revela
  // 1 linha nova por vez (com pausa em cada uma, inclusive a última, pra dar
  // tempo de ler) e só troca de tabela depois que a última linha some por
  // cima. O cabeçalho (thead) fica parado; só o <tbody> se move.
  const MACHARIA_TICKER_VISIBLE_ROWS = 5;
  const MACHARIA_TICKER_STEP_MS = 8000; // pausa em cada linha revelada
  const MACHARIA_TICKER_TRANSITION_MS = 500; // duração do deslize entre linhas
  const MACHARIA_TICKER_STATIC_MS = 8000; // tempo em tela quando cabe tudo sem rolar
  let machariaTickerTimer = null;

  // Roda o passo a passo de UMA tabela até a última linha sumir, então
  // chama onDone (quem decide o que vem a seguir — ver applyAltPanel).
  function runSideTableTicker(tbodySelector, onDone) {
    clearTimeout(machariaTickerTimer);
    const tbody = q(tbodySelector);
    if (!tbody) { onDone(); return; }
    const wrapper = tbody.closest(".table-wrapper");
    const rows = [...tbody.children];
    tbody.style.transition = "none";
    tbody.style.transform = "translateY(0)";
    if (!wrapper || !rows.length) {
      if (wrapper) wrapper.style.height = "";
      machariaTickerTimer = setTimeout(onDone, MACHARIA_TICKER_STATIC_MS);
      return;
    }
    const thead = wrapper.querySelector("thead");
    const rowHeight = rows[0].getBoundingClientRect().height || 40;
    const headHeight = thead ? thead.getBoundingClientRect().height : 0;
    wrapper.style.height = `${headHeight + rowHeight * Math.min(MACHARIA_TICKER_VISIBLE_ROWS, rows.length)}px`;
    // Força o navegador a aplicar o "transform:none" acima antes de ligar a
    // transição — senão a primeira linha animaria a partir da posição
    // (já desligada) do ciclo anterior.
    void tbody.offsetHeight;
    tbody.style.transition = `transform ${MACHARIA_TICKER_TRANSITION_MS}ms ease-in-out`;
    if (rows.length <= MACHARIA_TICKER_VISIBLE_ROWS) {
      machariaTickerTimer = setTimeout(onDone, MACHARIA_TICKER_STATIC_MS);
      return;
    }
    // Um passo por linha extra (além das que já cabem na janela) + 1 passo
    // final, que empurra a última linha inteira pra fora por cima.
    const lastStep = rows.length - MACHARIA_TICKER_VISIBLE_ROWS + 1;
    let step = 0;
    const advance = () => {
      step++;
      tbody.style.transform = `translateY(${-step * rowHeight}px)`;
      if (step >= lastStep) { machariaTickerTimer = setTimeout(onDone, MACHARIA_TICKER_TRANSITION_MS + 150); return; }
      machariaTickerTimer = setTimeout(advance, MACHARIA_TICKER_STEP_MS);
    };
    machariaTickerTimer = setTimeout(advance, MACHARIA_TICKER_STEP_MS);
  }

  // Desktop/TV: as duas tabelas dividem o mesmo painel no tempo, não lado a
  // lado — a troca não é por tempo fixo, é o próprio ticker (acima) que
  // avisa (onDone) quando a última linha da tabela atual já sumiu de tela.
  // Celular: sem ticker nem alternância — as duas ficam sempre visíveis,
  // empilhadas (cada uma com seu próprio título fixo, ver
  // .macharia-alt-mobile-title no CSS), já que ali dá pra rolar a página.
  let machariaAltShowingParadas = false;
  function applyAltPanel() {
    if (window.matchMedia("(max-width: 760px)").matches) {
      clearTimeout(machariaTickerTimer);
      q("#macharia-alt-machos-wrapper").hidden = false;
      q("#macharia-alt-paradas-wrapper").hidden = false;
      q("#macharia-dashboard-machos-empty").hidden = q("#macharia-dashboard-machos-rows").children.length > 0;
      q("#macharia-dashboard-stops-empty").hidden = q("#macharia-dashboard-stops-rows").children.length > 0;
      return;
    }
    q("#macharia-alt-title").textContent = machariaAltShowingParadas ? "Ocorrências de parada" : "Machos produzidos";
    q("#macharia-alt-machos-wrapper").hidden = machariaAltShowingParadas;
    q("#macharia-alt-paradas-wrapper").hidden = !machariaAltShowingParadas;
    // A mensagem de "nenhum registro" só pode aparecer se a tabela dela for
    // a que está em tela agora, senão as duas mensagens se sobrepõem.
    q("#macharia-dashboard-machos-empty").hidden = machariaAltShowingParadas || q("#macharia-dashboard-machos-rows").children.length > 0;
    q("#macharia-dashboard-stops-empty").hidden = !machariaAltShowingParadas || q("#macharia-dashboard-stops-rows").children.length > 0;
    runSideTableTicker(machariaAltShowingParadas ? "#macharia-dashboard-stops-rows" : "#macharia-dashboard-machos-rows", () => {
      machariaAltShowingParadas = !machariaAltShowingParadas;
      applyAltPanel();
    });
  }

  function formatMinutes(minutes) {
    const h = Math.floor(minutes / 60), m = Math.round(minutes % 60);
    return `${h}h ${String(m).padStart(2, "0")}min`;
  }

  function renderStopsTable(stops) {
    const rows = [...stops].sort((a, b) => new Date(a.inicio) - new Date(b.inicio));
    q("#macharia-dashboard-stops-rows").innerHTML = rows.map((item) => `<tr>
      <td>${new Date(item.inicio).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</td>
      <td>${item.fim ? new Date(item.fim).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
      <td>${formatMinutes(number(item.duracao_minutos))}</td>
      <td>${esc(item.setores_responsaveis_parada?.nome || "—")}</td>
      <td>${esc(item.categorias_parada_producao?.nome || "—")}</td>
      <td>${esc(item.observacao || "—")}</td>
    </tr>`).join("");
    q("#macharia-dashboard-stops-empty").hidden = rows.length > 0;
  }

  function renderGauge(selector, fraction, label) {
    const container = q(selector);
    if (!container) return;
    const percent = Math.max(0, Math.min(1, fraction || 0)) * 100;
    const color = percent >= 85 ? "#218c4b" : percent >= 65 ? "#b7791f" : "#b90e2c";
    container.innerHTML = `<div class="production-donut" style="--donut-segments:${color} 0deg ${percent * 3.6}deg,#e2e8f0 ${percent * 3.6}deg 360deg" role="img" aria-label="${esc(label)}"><div><strong>${percent.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</strong></div></div>`;
  }

  const MACHARIA_QUALIDADE_PADRAO = 0.97;
  function renderGauges(records, stops, minutosPeriodo) {
    const minutosParada = stops.reduce((sum, item) => sum + number(item.tempo_perdido_equivalente_minutos ?? item.duracao_minutos), 0);
    const disponibilidade = window.LIDUTEC_TURNOS.calcularTaxaEquipamento({ minutosPeriodo, minutosParada });
    const minutosDisponivel = Math.max(0, minutosPeriodo - minutosParada);
    const tempoTeoricoMinutos = records.reduce((sum, item) => {
      const soproPorHora = number(item.machos_macharia?.sopro_por_hora);
      if (!soproPorHora) return sum;
      return sum + number(item.quantidade_sopros) * (60 / soproPorHora);
    }, 0);
    const eficiencia = window.LIDUTEC_TURNOS.calcularEficiencia({ tempoTeoricoMinutos, tempoDisponivelMinutos: minutosDisponivel });
    const qualidade = MACHARIA_QUALIDADE_PADRAO;
    const oee = window.LIDUTEC_TURNOS.calcularOEE({ disponibilidade, eficiencia, qualidade });
    renderGauge("#gauge-disponibilidade", disponibilidade, "Disponibilidade");
    renderGauge("#gauge-eficiencia", eficiencia, "Eficiência");
    renderGauge("#gauge-qualidade", qualidade, "Qualidade");
    renderGauge("#gauge-oee", oee, "OEE");
  }

  async function reload() {
    q("#macharia-dashboard-loading").hidden = false;
    q("#macharia-dashboard-message").hidden = true;
    try {
      const data = q("#macharia-dashboard-data").value;
      const turnoCodigo = q("#macharia-dashboard-turno").value;
      const maquinaId = q("#macharia-dashboard-maquina").value;
      localStorage.setItem(maquinaStorageKey(), maquinaId);
      q("#macharia-dashboard-data").disabled = turnoCodigo === "ULTIMAS_24H";

      const maquina = state.maquinas.find((m) => String(m.id) === String(maquinaId));
      if (!maquinaId || (!data && turnoCodigo !== "ULTIMAS_24H")) return;

      const period = resolvePeriod(data, turnoCodigo);
      q("#macharia-dashboard-subtitle").textContent = maquina
        ? `${period.label} · ${maquina.nome}`
        : "";

      // Busca por um intervalo de data_operacional que cubra o período (com
      // 1 dia de folga antes, porque o turno da NOITE fica registrado na
      // data em que começou, não na data em que termina), depois filtra
      // pelo horário exato de cada linha — assim os 3 modos (turno
      // específico, todos os turnos, últimas 24h) usam o mesmo caminho.
      const fromDate = isoDateOnly(new Date(period.start.getTime() - 24 * 3600000));
      const toDate = isoDateOnly(period.end);
      const [recordsRaw, stopsRaw, descartesRaw] = await Promise.all([
        window.LIDUTEC_PRODUCAO_MACHARIA_DATA.records({ from: fromDate, to: toDate, linhaId: maquinaId, limit: 5000 }),
        window.LIDUTEC_PRODUCAO_MACHARIA_DATA.stops({ from: fromDate, to: toDate, linhaId: maquinaId, limit: 5000 }),
        window.LIDUTEC_PRODUCAO_MACHARIA_DATA.descartes({ from: fromDate, to: toDate, linhaId: maquinaId, limit: 5000 })
      ]);
      const records = recordsRaw.filter((item) => {
        const t = new Date(item.horario_previsto);
        return t > period.start && t <= period.end;
      });
      const stops = stopsRaw.filter((item) => {
        const t = new Date(item.inicio);
        return t >= period.start && t < period.end;
      });
      const descartes = descartesRaw.filter((item) => {
        const t = new Date(item.criado_em);
        return t >= period.start && t < period.end;
      });

      const hourSlots = window.LIDUTEC_TURNOS.hourlySlots(period.start, period.end, period.end);
      const points = computeHourlyPoints(records, hourSlots);

      renderHourlyChart(points, maquina?.nome, stops, period);
      renderMachosTable(records, descartes);
      renderStopsTable(stops);
      renderGauges(records, stops, period.minutosPeriodo);
      applyAltPanel();
    } catch (error) {
      message(error.message);
    } finally {
      q("#macharia-dashboard-loading").hidden = true;
    }
  }

  q("#macharia-dashboard-data").value = window.LIDUTEC_TURNOS.determineShift().dataOperacional;
  q("#macharia-dashboard-turno").value = "ULTIMAS_24H";
  await loadMaquinas();

  q("#macharia-dashboard-data").addEventListener("change", () => reload().catch((error) => message(error.message)));
  q("#macharia-dashboard-turno").addEventListener("change", () => reload().catch((error) => message(error.message)));
  q("#macharia-dashboard-maquina").addEventListener("change", () => reload().catch((error) => message(error.message)));

  await reload();

  // Redesenha o gráfico de sopros/hora com os últimos dados já carregados
  // sempre que o container mudar de tamanho — zoom do navegador, janela
  // redimensionada, sidebar aberta/fechada. Sem isso o gráfico ficava preso
  // no tamanho medido no carregamento da página e distorcia (texto esmagado
  // numa tela com zoom, ou esparso demais sem zoom) até o próximo reload de
  // dados (até 60s depois). Debounced com requestAnimationFrame porque
  // ResizeObserver pode disparar várias vezes seguidas durante um resize.
  const hourlyChartContainer = q("#macharia-hourly-chart");
  if (hourlyChartContainer && window.ResizeObserver) {
    let resizeFrame = null;
    new ResizeObserver(() => {
      if (resizeFrame) return;
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = null;
        if (state.lastHourlyPoints) renderHourlyChart(state.lastHourlyPoints, state.lastHourlyMaquinaNome, state.lastHourlyStops, state.lastHourlyPeriod);
      });
    }).observe(hourlyChartContainer);
  }

  // Tela pensada pra ficar projetada, sem ninguém mexendo — precisa se
  // atualizar sozinha. Evita sobrepor com um reload já em andamento, e não
  // atualiza com a aba em segundo plano (evita gasto à toa).
  let refreshing = false;
  setInterval(() => {
    if (document.hidden || refreshing) return;
    refreshing = true;
    reload().catch((error) => message(error.message)).finally(() => { refreshing = false; });
  }, 60000);
})().catch((error) => {
  console.error(error);
  const element = document.querySelector("#macharia-dashboard-message");
  if (element) { element.textContent = error.message; element.className = "form-message error"; element.hidden = false; }
  else alert(error.message);
});
