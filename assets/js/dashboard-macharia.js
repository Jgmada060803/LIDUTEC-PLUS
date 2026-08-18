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

  function renderHourlyChart(points, maquinaNome) {
    const container = q("#macharia-hourly-chart");
    const withData = points.filter((p) => p.hasData);
    q("#macharia-hourly-chart-empty").hidden = withData.length > 0;
    if (!withData.length) { container.innerHTML = ""; return; }

    // ViewBox no tamanho real do espaço disponível (medido no container),
    // não um tamanho fixo arbitrário — assim o SVG preenche 100% da largura
    // E da altura sem sobrar borda vazia e sem esticar/distorcer os
    // círculos e o texto (o que preserveAspectRatio sozinho não evita).
    const width = Math.max(600, Math.round(container.clientWidth) || 1400);
    const height = Math.max(240, Math.round(container.clientHeight) || 420);
    const margin = { top: 46, right: 30, bottom: 50, left: 66 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const values = withData.flatMap((p) => [p.total, p.min ?? p.total, p.max ?? p.total]);
    const rawMax = Math.max(10, ...values);
    const maxY = Math.ceil((rawMax * 1.25) / 10) * 10;
    const xFor = (index) => margin.left + (points.length > 1 ? (index / (points.length - 1)) * plotWidth : plotWidth / 2);
    const yFor = (value) => margin.top + (1 - value / maxY) * plotHeight;

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

    // Valor real do sopro escrito acima de cada ponto — precisa ser
    // legível de longe numa tela projetada, não só em hover.
    const pointsMarkup = points.map((p, index) => {
      if (!p.hasData) return "";
      const outside = p.meta != null && (p.total < p.min || p.total > p.max);
      const cls = outside ? "macharia-hourly-point-outside" : "macharia-hourly-point";
      const x = xFor(index), y = yFor(p.total);
      return `<circle cx="${x}" cy="${y}" r="6" class="${cls}"/>
        <text x="${x}" y="${y - 16}" class="macharia-hourly-value-label ${outside ? "outside" : ""}" text-anchor="middle">${p.total}</text>`;
    }).join("");

    const labels = points.map((p, index) =>
      `<text x="${xFor(index)}" y="${height - 16}" class="macharia-hourly-axis-label" text-anchor="middle">${hourLabel(p.horaIso).split(" às ")[0]}</text>`
    ).join("");

    // Nome da máquina bem grande, ao fundo, no meio do gráfico — dá pra
    // identificar de longe qual máquina é sem competir com os dados (fica
    // atrás das linhas, com opacidade baixa).
    const watermark = maquinaNome
      ? `<text x="${margin.left + plotWidth / 2}" y="${margin.top + plotHeight / 2}" class="macharia-hourly-watermark" text-anchor="middle">${esc(maquinaNome)}</text>`
      : "";

    container.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" preserveAspectRatio="none" aria-hidden="true">
        ${watermark}
        ${grid}
        <line x1="${margin.left}" y1="${margin.top + plotHeight}" x2="${width - margin.right}" y2="${margin.top + plotHeight}" class="macharia-hourly-axis"/>
        <path d="${pathFor("min")}" class="macharia-hourly-limit-min"/>
        <path d="${pathFor("max")}" class="macharia-hourly-limit-max"/>
        <path d="${pathFor("total")}" class="macharia-hourly-measured-line"/>
        ${pointsMarkup}
        ${labels}
      </svg>
      <div class="macharia-hourly-legend">
        <span><i style="border-color:#1f45a8"></i>Real</span>
        <span><i class="dashed" style="border-color:#b90e2c"></i>Meta mínima (-20%)</span>
        <span><i class="dashed" style="border-color:#b7791f"></i>Meta máxima (+20%)</span>
      </div>
    `;
  }

  // Identificação combinada, ex.: "MS0020 CX1 M1" — código do produto (só
  // quando o macho serve um único produto, senão fica ambíguo) + caixa +
  // macho, do jeito que já vêm cadastrados.
  function machoLabel(macho) {
    if (!macho) return "—";
    const produtos = macho.machos_macharia_produtos || [];
    const codigo = produtos.length === 1 ? produtos[0]?.produtos?.codigo : null;
    return [codigo, macho.caixa, macho.macho].filter(Boolean).join(" ");
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
    const minutosParada = stops.reduce((sum, item) => sum + number(item.duracao_minutos), 0);
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

      renderHourlyChart(points, maquina?.nome);
      renderMachosTable(records, descartes);
      renderStopsTable(stops);
      renderGauges(records, stops, period.minutosPeriodo);
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
