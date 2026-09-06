const acabamentoPage = document.body.dataset.productionPage;
const acabamentoState = {
  user: null,
  permissions: new Set(),
  products: [],
  lines: [],
  categories: [],
  sectors: [],
  postos: [],
  cycleTimeByProduct: new Map(),
  records: [],
  stops: [],
  scheduledStops: [],
  currentShift: null,
  linha2Ativa: true,
  planned: { l1: null, l2: null },
  absenteeismCollapsed: { l1: false, l2: false },
  absenteeismHovering: { l1: false, l2: false },
  absenteeismAutoHideTimers: { l1: null, l2: null },
  lastPresentes: { l1: null, l2: null },
  editingClosed: false,
  originalShiftData: null,
  statusRequestId: 0,
  contextLoading: false,
  draftSaveTimer: null,
  draftSaveInFlight: false,
  stopSort: { key: null, direction: "asc" },
  visibleStopRows: []
};

const aq = (selector) => document.querySelector(selector);
const aesc = (value = "") => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const anumber = (value) => Number(value || 0);
const anormalize = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
const aFormatDateTime = (value) => (value ? new Date(value).toLocaleString("pt-BR") : "—");
const aFormatMinutes = (value) => `${Math.floor(anumber(value) / 60)}h ${String(anumber(value) % 60).padStart(2, "0")}min`;
const aDisplayDate = (value) => (value ? new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR") : "—");
const aIsoDate = (date) => date.toISOString().slice(0, 10);
const aDaysBefore = (date, days) => { const value = new Date(`${date}T12:00:00`); value.setDate(value.getDate() - days); return aIsoDate(value); };
const aFirstDayOfMonth = (date) => `${date.slice(0, 7)}-01`;
const aDateRange = (from, to) => {
  const dates = [];
  const cursor = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  while (cursor <= end) { dates.push(aIsoDate(cursor)); cursor.setDate(cursor.getDate() + 1); }
  return dates;
};
let acabamentoChartsMonth = null;
const acabamentoChartPeriod = () => {
  const today = window.LIDUTEC_TURNOS.determineShift().dataOperacional;
  const month = acabamentoChartsMonth || today.slice(0, 7);
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(year, monthNumber, 0).getDate();
  const from = `${month}-01`;
  const monthEnd = `${month}-${String(lastDay).padStart(2, "0")}`;
  return { from, to: month === today.slice(0, 7) ? today : monthEnd };
};

function acabamentoMessage(text, type = "success", source = "general") {
  const el = aq("#production-message");
  if (!el) return;
  el.textContent = text;
  el.className = `form-message ${type}`;
  el.dataset.source = source;
  el.hidden = false;
}
function acabamentoClearMessage(source) {
  const el = aq("#production-message");
  if (!el || el.hidden || el.dataset.source !== source) return;
  el.hidden = true;
  el.textContent = "";
  el.className = "form-message";
  delete el.dataset.source;
}

function cycleTimeFor(productId) {
  return acabamentoState.cycleTimeByProduct.get(String(productId)) || null;
}
function linhaIdByCodigo(codigo) {
  return acabamentoState.lines.find((linha) => linha.codigo === codigo)?.id ?? null;
}
function linha1Id() { return linhaIdByCodigo("ACABAMENTO_L1"); }
function linha2Id() { return linhaIdByCodigo("ACABAMENTO_L2"); }

window.LIDUTEC_TYPEAHEAD.register("produto_id", {
  items: () => acabamentoState.products,
  match: (p, s) => normalizeTypeaheadIncludes([p.codigo, p.nome], s),
  label: (p) => `${p.codigo} — ${p.nome}`,
  id: (p) => p.id
});
window.LIDUTEC_TYPEAHEAD.register("setor_id", {
  items: () => acabamentoState.sectors,
  match: (item, s) => normalizeTypeaheadIncludes([item.codigo, item.nome], s),
  label: (item) => item.nome,
  secondary: (item) => item.codigo,
  id: (item) => item.id
});
window.LIDUTEC_TYPEAHEAD.register("categoria_id", {
  items: () => acabamentoState.categories,
  match: (item, s) => normalizeTypeaheadIncludes([item.codigo, item.nome], s),
  label: (item) => item.nome,
  secondary: (item) => item.codigo,
  id: (item) => item.id
});

async function loadAcabamentoSupport() {
  const { products, lines, categories, sectors, postos } = await window.LIDUTEC_PRODUCAO_ACABAMENTO_DATA.support();
  acabamentoState.products = products;
  acabamentoState.lines = lines;
  acabamentoState.categories = categories;
  acabamentoState.sectors = sectors;
  acabamentoState.postos = postos;
  acabamentoState.scheduledStops = await window.LIDUTEC_PRODUCAO_ACABAMENTO_DATA.scheduledStopsAll();
  const cycleTimes = await window.LIDUTEC_PRODUCAO_ACABAMENTO_DATA.cycleTimes(products.map((p) => p.id));
  acabamentoState.cycleTimeByProduct = new Map(cycleTimes.map((item) => [String(item.produto_id), item.tempo_ciclo_segundos]));
  for (const select of document.querySelectorAll("[data-categories]")) {
    select.insertAdjacentHTML("beforeend", categories.map((c) => `<option value="${c.id}">${aesc(c.nome)}</option>`).join(""));
  }
  for (const select of document.querySelectorAll("[data-sectors]")) {
    select.insertAdjacentHTML("beforeend", sectors.map((s) => `<option value="${s.id}">${aesc(s.nome)}</option>`).join(""));
  }
  for (const select of document.querySelectorAll("[data-postos]")) {
    select.insertAdjacentHTML("beforeend", postoOptionsHtml());
  }
}

// ---------------------------------------------------------------------------
// Apontamento do turno (tela "entry") — 1 turno cobre as duas linhas
// ---------------------------------------------------------------------------
function postoOptionsHtml() {
  const linhaNomeById = new Map(acabamentoState.lines.map((linha) => [linha.id, linha.nome]));
  const postosPorLinha = new Map();
  const avulsos = [];
  for (const posto of acabamentoState.postos) {
    if (posto.tipo === "POSTO_LINHA") {
      const nomeLinha = linhaNomeById.get(posto.linha_maquina_id) || "Linha";
      if (!postosPorLinha.has(nomeLinha)) postosPorLinha.set(nomeLinha, []);
      postosPorLinha.get(nomeLinha).push(posto);
    } else {
      avulsos.push(posto);
    }
  }
  let html = "";
  for (const [nomeLinha, postos] of postosPorLinha) {
    html += `<optgroup label="${aesc(nomeLinha)}">${postos.map((posto) => `<option value="${posto.id}">${aesc(posto.nome)}</option>`).join("")}</optgroup>`;
  }
  if (avulsos.length) {
    html += `<optgroup label="Equipamentos">${avulsos.map((posto) => `<option value="${posto.id}">${aesc(posto.nome)}</option>`).join("")}</optgroup>`;
  }
  return html;
}
function productionRow() {
  const row = document.createElement("tr");
  row.className = "shift-production-row";
  row.innerHTML = `
    <td>${window.LIDUTEC_TYPEAHEAD.fieldHtml("produto_id", 'name="produto_id"', "Buscar produto por código ou nome...", "Produto")}</td>
    <td><input name="rastreabilidade" type="text" maxlength="120" placeholder="lote"></td>
    <td><input name="quantidade_liberada" type="number" min="0" step="1" value="0"></td>
    <td><input name="quantidade_rejeitada" type="number" min="0" step="1" value="0"></td>
    <td><input name="quantidade_retrabalhada" type="number" min="0" step="1" value="0"></td>
    <td><input name="quantidade_refugada" type="number" min="0" step="1" value="0"></td>
    <td><button type="button" class="row-remove" aria-label="Remover linha">×</button></td>`;
  return row;
}
// Só o Jato (postos com numero_turbinas cadastrado — Jato 1/2 têm 4
// turbinas, Jato Gancheira tem 3) oferece capacidade reduzida; postos de
// linha e demais equipamentos avulsos (correias, VS automática) não têm
// numero_turbinas, então só aparece "Parada total" pra eles. O total nunca é
// fixo em 4: vem do próprio posto selecionado na linha.
function stopConditionOptionsHtml(postoId) {
  const posto = acabamentoState.postos.find((p) => String(p.id) === String(postoId));
  const total = anumber(posto?.numero_turbinas);
  let html = '<option value="TOTAL:">Parada total</option>';
  if (total >= 2) html += `<option value="PARCIAL:1">1 de ${total} turbinas desabilitada</option>`;
  if (total >= 3) html += `<option value="PARCIAL:2">2 de ${total} turbinas desabilitadas</option>`;
  return html;
}
function stopConditionValue(row) {
  const [tipo, qtd] = (row.querySelector('[name="condicao"]')?.value || "TOTAL:").split(":");
  return { tipo, componentesIndisponiveis: qtd ? anumber(qtd) : null };
}
// Reconstrói as opções de condição quando o posto/equipamento da linha muda
// (cada um pode ter um número de turbinas diferente). Memoiza o posto já
// aplicado pra não reconstruir (e perder a seleção do operador) toda vez que
// updateStopRow roda por outro motivo, como digitar o horário.
function refreshStopConditionOptions(row) {
  const select = row.querySelector('[name="condicao"]');
  if (!select) return;
  const postoId = row.querySelector('[name="posto_id"]')?.value || "";
  if (select.dataset.postoId === postoId) return;
  const previous = select.value;
  select.dataset.postoId = postoId;
  select.innerHTML = stopConditionOptionsHtml(postoId);
  select.value = [...select.options].some((o) => o.value === previous) ? previous : "TOTAL:";
}
function stopRow() {
  const row = document.createElement("tr");
  row.className = "shift-stop-row";
  row.innerHTML = `
    <td><input name="inicio" type="time" step="60"></td>
    <td><input name="fim" type="time" step="60"></td>
    <td><output data-duration>0h 00min</output></td>
    <td><select name="posto_id"><option value="">Selecione</option>${postoOptionsHtml()}</select></td>
    <td><select name="condicao">${stopConditionOptionsHtml("")}</select></td>
    <td><output data-perda>—</output></td>
    <td>${window.LIDUTEC_TYPEAHEAD.fieldHtml("setor_id", 'name="setor_id"', "Buscar setor...", "Setor de origem")}</td>
    <td>${window.LIDUTEC_TYPEAHEAD.fieldHtml("categoria_id", 'name="categoria_id"', "Buscar motivo...", "Motivo da parada")}</td>
    <td><input name="observacao" type="text" maxlength="500"></td>
    <td><button type="button" class="row-remove" aria-label="Remover linha">×</button></td>`;
  return row;
}
function rowValues(row) {
  return Object.fromEntries([...row.querySelectorAll("input,select")].map((control) => [control.name, control.value]));
}
function applyRowValues(row, values = {}) {
  for (const control of row.querySelectorAll("input,select")) {
    if (Object.hasOwn(values, control.name)) control.value = values[control.name] ?? "";
  }
  window.LIDUTEC_TYPEAHEAD.syncAll(row);
}
function resolveShiftTime(value) {
  const form = aq("#shift-entry-form");
  return window.LIDUTEC_TURNOS.resolveShiftTime(form?.elements.data_operacional.value, form?.elements.turno.value, value, "ACABAMENTO");
}

// ---------------------------------------------------------------------------
// Ilustrações compactas: bolinhas de posto (proporção parado/funcionando) e
// mini linha do tempo dos equipamentos avulsos. Só lê o que já está na tela
// (linhas de parada), sem nenhuma consulta nova ao banco.
// ---------------------------------------------------------------------------
function turnoBoundsOrNull() {
  const form = aq("#shift-entry-form");
  const date = form?.elements.data_operacional.value;
  const turno = form?.elements.turno.value;
  if (!date || !turno) return null;
  try { return window.LIDUTEC_TURNOS.shiftBounds(date, turno); } catch { return null; }
}
function stoppedOverlapsForPosto(postoId, bounds) {
  const overlaps = [];
  for (const row of document.querySelectorAll(".shift-stop-row")) {
    if (String(row.querySelector('[name="posto_id"]').value) !== String(postoId)) continue;
    const start = resolveShiftTime(row.querySelector('[name="inicio"]').value);
    const end = resolveShiftTime(row.querySelector('[name="fim"]').value);
    if (!start || !end || end <= start) continue;
    const overlapStart = Math.max(start.getTime(), bounds.start.getTime());
    const overlapEnd = Math.min(end.getTime(), bounds.end.getTime());
    if (overlapEnd > overlapStart) overlaps.push([overlapStart, overlapEnd, stopConditionValue(row).tipo]);
  }
  return overlaps;
}
function renderPostoDots(containerId, linhaId, bounds) {
  const container = aq(containerId);
  if (!container) return;
  const totalMs = bounds.end.getTime() - bounds.start.getTime();
  const postos = acabamentoState.postos.filter((posto) => posto.tipo === "POSTO_LINHA" && posto.linha_maquina_id === linhaId);
  container.innerHTML = postos.map((posto) => {
    const stoppedMs = totalMs > 0 ? stoppedOverlapsForPosto(posto.id, bounds).reduce((sum, [s, e]) => sum + (e - s), 0) : 0;
    const percent = totalMs > 0 ? Math.min(100, (stoppedMs / totalMs) * 100) : 0;
    const title = `${aesc(posto.nome)} · ${(100 - percent).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}% em operação`;
    return `<span class="acabamento-posto-dot" style="--parado:${percent}%" title="${title}" aria-label="${title}"></span>`;
  }).join("");
}
function plannedWindowIntervals(bounds, { turno, dataOperacional, linhaId = null, equipamentoCodigo = null }) {
  return window.LIDUTEC_PARADAS_PROGRAMADAS.overlapIntervals({
    janelas: acabamentoState.scheduledStops || [], turnoInicio: bounds.start,
    paradaInicio: bounds.start, paradaFim: bounds.end,
    turno, dataOperacional, linhaId, equipamentoCodigo
  });
}
function equipmentSegmentsHtml(posto, bounds) {
  const totalMs = bounds.end.getTime() - bounds.start.getTime();
  if (totalMs <= 0) return "";
  const form = aq("#shift-entry-form");
  const turno = form?.elements.turno.value;
  const dataOperacional = form?.elements.data_operacional.value;
  const spanFor = (interval, className, title = "") => {
    const left = ((interval.start.getTime() - bounds.start.getTime()) / totalMs) * 100;
    const width = ((interval.end.getTime() - interval.start.getTime()) / totalMs) * 100;
    return `<span class="${className}" style="left:${left}%;width:${width}%"${title ? ` title="${title}"` : ""}></span>`;
  };
  // Janela de parada programada (refeição, manutenção preventiva etc.) sempre
  // aparece em amarelo, tenha ou não parada real lançada nesse horário; as
  // paradas realmente registradas ficam em vermelho, por cima.
  const planejados = plannedWindowIntervals(bounds, { turno, dataOperacional, equipamentoCodigo: posto.codigo });
  const paradas = stoppedOverlapsForPosto(posto.id, bounds).map(([start, end, tipo]) => ({ start: new Date(start), end: new Date(end), tipo }));
  return [
    ...planejados.map((interval) => spanFor(interval, "acabamento-equip-planned", "Parada programada")),
    ...paradas.map((interval) => spanFor(interval, interval.tipo === "PARCIAL" ? "acabamento-equip-stop acabamento-equip-stop-partial" : "acabamento-equip-stop"))
  ].join("");
}
function renderEquipmentTimelines(bounds) {
  const container = aq("#equipamentos-timelines");
  if (!container) return;
  const equipamentos = acabamentoState.postos.filter((posto) => posto.tipo === "EQUIPAMENTO_AVULSO");
  container.innerHTML = equipamentos.map((equipamento) => `
    <div class="acabamento-equip-row">
      <span class="acabamento-equip-label">${aesc(equipamento.nome)}</span>
      <div class="acabamento-equip-track">${equipmentSegmentsHtml(equipamento, bounds)}</div>
    </div>`).join("");
}
function renderAcabamentoIllustrations() {
  const bounds = turnoBoundsOrNull();
  if (!bounds) return;
  renderPostoDots("#postos-dots-l1", linha1Id(), bounds);
  const dotsL2 = aq("#postos-dots-l2");
  if (dotsL2) { if (acabamentoState.linha2Ativa) renderPostoDots("#postos-dots-l2", linha2Id(), bounds); else dotsL2.innerHTML = ""; }
  renderEquipmentTimelines(bounds);
}
// A perda equivalente mostrada aqui é só feedback imediato pro operador — o
// valor que entra nos indicadores é recalculado no banco (RPC de
// fechar/editar turno), que é a fonte única da fórmula.
function updateStopRow(row) {
  refreshStopConditionOptions(row);
  const start = row.querySelector('[name="inicio"]').value;
  const end = row.querySelector('[name="fim"]').value;
  let minutes = 0;
  if (start && end) {
    const resolvedStart = resolveShiftTime(start);
    const resolvedEnd = resolveShiftTime(end);
    if (!resolvedStart || !resolvedEnd || resolvedEnd < resolvedStart) {
      throw new Error("Os horários da parada devem estar dentro do turno selecionado.");
    }
    minutes = window.LIDUTEC_TURNOS.stopDurationMinutes(resolvedStart.toISOString(), resolvedEnd.toISOString());
  }
  row.querySelector("[data-duration]").textContent = aFormatMinutes(minutes);
  const perdaOutput = row.querySelector("[data-perda]");
  if (perdaOutput) {
    if (!start || !end) {
      perdaOutput.textContent = "—";
    } else {
      const { tipo, componentesIndisponiveis } = stopConditionValue(row);
      const postoId = row.querySelector('[name="posto_id"]')?.value;
      const posto = acabamentoState.postos.find((p) => String(p.id) === String(postoId));
      const totalTurbinas = anumber(posto?.numero_turbinas);
      const perda = tipo === "PARCIAL" && totalTurbinas > 0 && componentesIndisponiveis
        ? Math.round(minutes * componentesIndisponiveis / totalTurbinas)
        : minutes;
      perdaOutput.textContent = aFormatMinutes(perda);
    }
  }
}
function appendEntryRow(target, row) {
  aq(target).append(row);
}
// Total de Liberada/Rejato/Retrabalhada/Refugada por tabela (Linha 1 e
// Linha 2) — pedido explícito, pra não precisar somar de cabeça.
function updateProductionTotals(tbodySelector) {
  const tbody = aq(tbodySelector);
  const table = tbody?.closest("table");
  if (!table) return;
  const totals = { liberada: 0, rejeitada: 0, retrabalhada: 0, refugada: 0 };
  for (const row of tbody.querySelectorAll(".shift-production-row")) {
    totals.liberada += anumber(row.querySelector('[name="quantidade_liberada"]').value);
    totals.rejeitada += anumber(row.querySelector('[name="quantidade_rejeitada"]').value);
    totals.retrabalhada += anumber(row.querySelector('[name="quantidade_retrabalhada"]').value);
    totals.refugada += anumber(row.querySelector('[name="quantidade_refugada"]').value);
  }
  table.querySelector("[data-total-liberada]").textContent = totals.liberada.toLocaleString("pt-BR");
  table.querySelector("[data-total-rejeitada]").textContent = totals.rejeitada.toLocaleString("pt-BR");
  table.querySelector("[data-total-retrabalhada]").textContent = totals.retrabalhada.toLocaleString("pt-BR");
  table.querySelector("[data-total-refugada]").textContent = totals.refugada.toLocaleString("pt-BR");
}
function updateAllProductionTotals() {
  updateProductionTotals("#production-entry-rows-l1");
  updateProductionTotals("#production-entry-rows-l2");
}
function resetShiftEntryRows() {
  aq("#production-entry-rows-l1").replaceChildren(productionRow());
  aq("#production-entry-rows-l2").replaceChildren(productionRow());
  aq("#stop-entry-rows").replaceChildren(stopRow());
  updateAllProductionTotals();
}
function shiftDraftKey() {
  const form = aq("#shift-entry-form");
  const date = form?.elements.data_operacional.value || "sem-data";
  const shift = form?.elements.turno.value || "sem-turno";
  return `lidutec:producao-acabamento:rascunho:${acabamentoState.user?.id || "anonimo"}:${date}:${shift}`;
}
function populateShiftRows(productions, stops, linhas) {
  const rowsL1 = productions.filter((item) => String(item.linha_id ?? item.linha_maquina_id) === String(linha1Id()));
  const rowsL2 = productions.filter((item) => String(item.linha_id ?? item.linha_maquina_id) === String(linha2Id()));
  aq("#production-entry-rows-l1").replaceChildren();
  aq("#production-entry-rows-l2").replaceChildren();
  const fillProductions = (target, items) => {
    for (const item of items.length ? items : [{}]) {
      const row = productionRow();
      applyRowValues(row, {
        produto_id: item.produto_id ?? "",
        rastreabilidade: item.rastreabilidade ?? "",
        quantidade_liberada: item.quantidade_liberada ?? 0,
        quantidade_rejeitada: item.quantidade_rejeitada ?? 0,
        quantidade_retrabalhada: item.quantidade_retrabalhada ?? 0,
        quantidade_refugada: item.quantidade_refugada ?? 0
      });
      appendEntryRow(target, row);
    }
  };
  fillProductions("#production-entry-rows-l1", rowsL1);
  fillProductions("#production-entry-rows-l2", rowsL2);
  updateAllProductionTotals();

  const form = aq("#shift-entry-form");
  const linhaL1 = (linhas || []).find((item) => String(item.linha_id ?? item.linha_maquina_id) === String(linha1Id()));
  const linhaL2 = (linhas || []).find((item) => String(item.linha_id ?? item.linha_maquina_id) === String(linha2Id()));
  form.elements.operadores_presentes_l1.value = linhaL1?.operadores_presentes ?? "";
  form.elements.operadores_presentes_l2.value = linhaL2?.operadores_presentes ?? "";
  acabamentoState.lastPresentes.l1 = form.elements.operadores_presentes_l1.value === "" ? null : anumber(form.elements.operadores_presentes_l1.value);
  acabamentoState.lastPresentes.l2 = form.elements.operadores_presentes_l2.value === "" ? null : anumber(form.elements.operadores_presentes_l2.value);

  const toTimeInput = (value) => {
    if (!value) return "";
    // Rascunhos (local ou compartilhado) já guardam "HH:MM" cru, do próprio
    // input; só timestamps completos (turno fechado, vindos do banco) precisam
    // ser convertidos. Tratar os dois como data quebrava o valor (NaN:NaN),
    // esvaziando o campo ao recarregar a página.
    if (/^\d{2}:\d{2}$/.test(value)) return value;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };
  aq("#stop-entry-rows").replaceChildren();
  for (const item of stops.length ? stops : [{}]) {
    const row = stopRow();
    applyRowValues(row, {
      inicio: toTimeInput(item.inicio),
      fim: toTimeInput(item.fim),
      posto_id: item.posto_equipamento_id ?? item.posto_id ?? "",
      setor_id: item.setor_origem_id ?? item.setor_id ?? "",
      categoria_id: item.categoria_id ?? "",
      observacao: item.observacao ?? ""
    });
    appendEntryRow("#stop-entry-rows", row);
    try { updateStopRow(row); } catch { /* horário incompleto no carregamento inicial */ }
    // condicao depende do posto (turbinas) — só dá pra aplicar depois que
    // updateStopRow() acima já reconstruiu as opções pro posto_id certo.
    const condicaoSelect = row.querySelector('[name="condicao"]');
    if (condicaoSelect) {
      // "condicao" é o formato bruto do rascunho local/compartilhado (vem
      // direto do <select>, via rowValues); tipo_ocorrencia/componentes_indis-
      // poniveis é o formato do turno fechado, vindo do banco — mesmo padrão
      // dual já usado acima pra posto_id.
      const desired = item.condicao
        ?? `${item.tipo_ocorrencia || "TOTAL"}:${item.tipo_ocorrencia === "PARCIAL" ? (item.componentes_indisponiveis ?? "") : ""}`;
      if ([...condicaoSelect.options].some((o) => o.value === desired)) condicaoSelect.value = desired;
      try { updateStopRow(row); } catch { /* horário incompleto no carregamento inicial */ }
    }
  }
  lockAutoAbsenteeismoRows();
}
function serializeProductionSection(target, linhaId) {
  return [...document.querySelectorAll(`${target} .shift-production-row`)]
    .filter((row) => row.querySelector('[name="produto_id"]').value)
    .map((row) => ({
      linha_id: linhaId,
      produto_id: anumber(row.querySelector('[name="produto_id"]').value),
      rastreabilidade: row.querySelector('[name="rastreabilidade"]').value,
      quantidade_liberada: anumber(row.querySelector('[name="quantidade_liberada"]').value),
      quantidade_rejeitada: anumber(row.querySelector('[name="quantidade_rejeitada"]').value),
      quantidade_retrabalhada: anumber(row.querySelector('[name="quantidade_retrabalhada"]').value),
      quantidade_refugada: anumber(row.querySelector('[name="quantidade_refugada"]').value)
    }));
}
function serializeShift() {
  const form = aq("#shift-entry-form");
  const productions = [
    ...serializeProductionSection("#production-entry-rows-l1", linha1Id()),
    ...serializeProductionSection("#production-entry-rows-l2", linha2Id())
  ];
  if (!productions.length) throw new Error("Informe ao menos um produto.");

  const linhas = [{ linha_id: linha1Id(), operadores_presentes: anumber(form.elements.operadores_presentes_l1.value) }];
  if (acabamentoState.linha2Ativa || form.elements.operadores_presentes_l2.value) {
    linhas.push({ linha_id: linha2Id(), operadores_presentes: anumber(form.elements.operadores_presentes_l2.value) });
  }
  for (const linha of linhas) {
    const limit = absenteeismLimit(linha.linha_id);
    if (limit > 0 && absenteeismActiveCount(linha.linha_id) < limit) {
      throw new Error("Marque na caixa de absenteísmo quais postos ficarão parados antes de continuar.");
    }
  }

  const stops = [...document.querySelectorAll(".shift-stop-row")]
    .filter((row) => ["inicio", "fim", "posto_id", "setor_id", "categoria_id"].some((name) => row.querySelector(`[name="${name}"]`)?.value))
    .map((row) => {
      const value = (name) => row.querySelector(`[name="${name}"]`).value;
      if (!value("inicio") || !value("fim") || !value("posto_id") || !value("setor_id") || !value("categoria_id")) {
        throw new Error("Preencha início, fim, posto/equipamento, setor e motivo em todas as paradas.");
      }
      const start = resolveShiftTime(value("inicio"));
      const end = resolveShiftTime(value("fim"));
      if (!start || !end) throw new Error("Os horários da parada devem estar dentro do turno selecionado.");
      if (!window.LIDUTEC_TURNOS.intervalWithinShift(form.elements.data_operacional.value, form.elements.turno.value, start.toISOString(), end.toISOString(), "ACABAMENTO")) {
        throw new Error("A parada deve estar dentro do turno selecionado.");
      }
      const { tipo, componentesIndisponiveis } = stopConditionValue(row);
      return {
        inicio: start.toISOString(), fim: end.toISOString(), posto_id: anumber(value("posto_id")),
        setor_id: anumber(value("setor_id")), categoria_id: anumber(value("categoria_id")),
        tipo_ocorrencia: tipo, componentes_indisponiveis: tipo === "PARCIAL" ? componentesIndisponiveis : null,
        observacao: value("observacao")
      };
    });
  // No Acabamento cada parada é vinculada a um posto/equipamento, então
  // paradas em postos diferentes podem ter o mesmo horário — só bloqueia
  // sobreposição dentro do mesmo posto/equipamento.
  const stopsPorPosto = new Map();
  for (const stop of stops) {
    const lista = stopsPorPosto.get(stop.posto_id) || [];
    lista.push(stop);
    stopsPorPosto.set(stop.posto_id, lista);
  }
  for (const lista of stopsPorPosto.values()) {
    if (window.LIDUTEC_TURNOS.findOverlappingInterval(lista)) {
      throw new Error("Há paradas com horários sobrepostos no mesmo posto/equipamento. Ajuste os horários antes de continuar.");
    }
  }
  return { productions, linhas, stops };
}

function saveShiftDraft() {
  const form = aq("#shift-entry-form");
  if (!form || !acabamentoState.user || acabamentoState.currentShift?.status === "FECHADO" || acabamentoState.editingClosed || acabamentoState.contextLoading) return;
  const draft = {
    savedAt: Date.now(),
    data_operacional: form.elements.data_operacional.value,
    turno: form.elements.turno.value,
    operadores_presentes_l1: form.elements.operadores_presentes_l1.value,
    operadores_presentes_l2: form.elements.operadores_presentes_l2.value,
    productionsL1: [...document.querySelectorAll("#production-entry-rows-l1 .shift-production-row")].map(rowValues),
    productionsL2: [...document.querySelectorAll("#production-entry-rows-l2 .shift-production-row")].map(rowValues),
    stops: [...document.querySelectorAll(".shift-stop-row")].map(rowValues)
  };
  localStorage.setItem(shiftDraftKey(), JSON.stringify(draft));
  clearTimeout(acabamentoState.draftSaveTimer);
  acabamentoState.draftSaveTimer = setTimeout(() => persistSharedShiftDraft(draft), 800);
}
async function persistSharedShiftDraft(draft) {
  if (acabamentoState.currentShift?.status === "FECHADO" || acabamentoState.editingClosed || acabamentoState.draftSaveInFlight) return;
  acabamentoState.draftSaveInFlight = true;
  try {
    const linhas = [{ linha_id: linha1Id(), operadores_presentes: draft.operadores_presentes_l1 ? anumber(draft.operadores_presentes_l1) : null }];
    if (acabamentoState.linha2Ativa || draft.operadores_presentes_l2) {
      linhas.push({ linha_id: linha2Id(), operadores_presentes: draft.operadores_presentes_l2 ? anumber(draft.operadores_presentes_l2) : null });
    }
    const producoes = [
      ...draft.productionsL1.filter((item) => item.produto_id).map((item) => ({ ...item, linha_id: linha1Id() })),
      ...draft.productionsL2.filter((item) => item.produto_id).map((item) => ({ ...item, linha_id: linha2Id() }))
    ];
    const saved = await window.LIDUTEC_PRODUCAO_ACABAMENTO_DATA.saveShiftDraft({
      p_data_operacional: draft.data_operacional,
      p_turno: draft.turno,
      p_linhas: linhas,
      p_producoes: producoes,
      p_paradas: draft.stops,
      p_versao: acabamentoState.currentShift?.versao ?? null
    });
    acabamentoState.currentShift = { ...(acabamentoState.currentShift || {}), ...saved, data_operacional: draft.data_operacional, turno: draft.turno, status: "ABERTO" };
    aq("#shift-status").textContent = "Em apontamento · salvo agora";
  } catch (error) {
    if (/CONFLITO_RASCUNHO|40001/i.test(`${error.message || ""} ${error.code || ""}`)) {
      acabamentoState.draftSaveInFlight = false;
      acabamentoMessage("Este turno foi atualizado por outro usuário. Carregamos a versão mais recente.", "error", "shared-draft");
      await checkShiftStatus();
    } else {
      acabamentoMessage(`Não foi possível salvar o rascunho: ${error.message}`, "error", "shared-draft");
    }
  } finally {
    acabamentoState.draftSaveInFlight = false;
  }
}
function restoreShiftDraft() {
  let draft = null;
  try { draft = JSON.parse(localStorage.getItem(shiftDraftKey()) || "null"); } catch { localStorage.removeItem(shiftDraftKey()); }
  if (!draft || !draft.savedAt || Date.now() - draft.savedAt > 24 * 60 * 60 * 1000) { localStorage.removeItem(shiftDraftKey()); return false; }
  const form = aq("#shift-entry-form");
  form.elements.operadores_presentes_l1.value = draft.operadores_presentes_l1 || "";
  form.elements.operadores_presentes_l2.value = draft.operadores_presentes_l2 || "";
  populateShiftRows(
    [
      ...draft.productionsL1.map((item) => ({ ...item, linha_id: linha1Id() })),
      ...draft.productionsL2.map((item) => ({ ...item, linha_id: linha2Id() }))
    ],
    draft.stops || [],
    []
  );
  return true;
}

async function updatePlannedOperators() {
  const form = aq("#shift-entry-form");
  const date = form.elements.data_operacional.value;
  const turno = form.elements.turno.value;
  if (!date || !turno) return;
  const [plannedL1, plannedL2] = await Promise.all([
    window.LIDUTEC_PRODUCAO_ACABAMENTO_DATA.plannedOperators(linha1Id(), turno, date),
    acabamentoState.linha2Ativa ? window.LIDUTEC_PRODUCAO_ACABAMENTO_DATA.plannedOperators(linha2Id(), turno, date) : Promise.resolve(null)
  ]);
  aq("#operadores-planejados-hint-l1").textContent = plannedL1 != null ? `Planejado: ${plannedL1} operadores` : "Sem meta cadastrada para este turno.";
  aq("#operadores-planejados-hint-l2").textContent = acabamentoState.linha2Ativa
    ? (plannedL2 != null ? `Planejado: ${plannedL2} operadores` : "Sem meta cadastrada para este turno.")
    : "";
  acabamentoState.planned = { l1: plannedL1, l2: plannedL2 };
  updateAbsenteeismBoxes();
}

// ---------------------------------------------------------------------------
// Caixa de postos parados por absenteísmo: quando o operador informa menos
// gente presente do que o planejado, mostra os postos da linha para marcar
// quem ficou parado — o clique já lança a parada (Setor ADM / Motivo
// Absenteísmo) e pinta a bolinha do posto, sem digitar nada.
// ---------------------------------------------------------------------------
function absenteismoCategoriaId() {
  return acabamentoState.categories.find((c) => c.codigo === "ABSENTEISMO")?.id ?? null;
}
function admSetorId() {
  return acabamentoState.sectors.find((s) => s.codigo === "ADM")?.id ?? null;
}
function isAbsenteeismoRow(row) {
  const categoriaId = absenteismoCategoriaId();
  const setorId = admSetorId();
  if (!categoriaId || !setorId) return false;
  return anumber(row.querySelector('[name="categoria_id"]').value) === categoriaId &&
    anumber(row.querySelector('[name="setor_id"]').value) === setorId;
}
function isAbsenteeismoStopRecord(stop) {
  const categoriaId = absenteismoCategoriaId();
  const setorId = admSetorId();
  if (!categoriaId || !setorId) return false;
  return anumber(stop.categoria_id) === categoriaId && anumber(stop.setor_origem_id) === setorId;
}
function findAbsenteeismRowForPosto(postoId) {
  return [...document.querySelectorAll(".shift-stop-row")].find((row) =>
    anumber(row.querySelector('[name="posto_id"]').value) === Number(postoId) && isAbsenteeismoRow(row));
}
function lockAutoAbsenteeismoRows() {
  for (const row of document.querySelectorAll(".shift-stop-row")) {
    if (!isAbsenteeismoRow(row)) continue;
    for (const name of ["inicio", "fim", "posto_id", "setor_id", "categoria_id"]) {
      const control = row.querySelector(`[name="${name}"]`);
      if (control) control.disabled = true;
      const visibleInput = control?.closest(".typeahead-field")?.querySelector(".typeahead-input");
      if (visibleInput) visibleInput.disabled = true;
    }
    const removeButton = row.querySelector(".row-remove");
    if (removeButton) { removeButton.disabled = true; removeButton.title = "Remova marcando/desmarcando o posto na caixa de absenteísmo acima."; }
  }
}
function insertAbsenteeismRow(row) {
  const tbody = aq("#stop-entry-rows");
  const autoRows = [...tbody.querySelectorAll(".shift-stop-row")].filter(isAbsenteeismoRow);
  if (autoRows.length) autoRows[autoRows.length - 1].insertAdjacentElement("afterend", row);
  else tbody.prepend(row);
}
function clearAbsenteeismStopsForLinha(linhaId) {
  const postoIds = new Set(acabamentoState.postos.filter((p) => p.tipo === "POSTO_LINHA" && p.linha_maquina_id === linhaId).map((p) => p.id));
  for (const row of [...document.querySelectorAll(".shift-stop-row")]) {
    if (!isAbsenteeismoRow(row) || !postoIds.has(anumber(row.querySelector('[name="posto_id"]').value))) continue;
    const body = row.parentElement;
    if (body.children.length === 1) {
      for (const control of row.querySelectorAll("input,select,button")) { control.disabled = false; control.value = control.type === "number" ? "0" : ""; }
    } else {
      row.remove();
    }
  }
}
function handlePresentesInput(key) {
  const form = aq("#shift-entry-form");
  const input = key === "l1" ? form.elements.operadores_presentes_l1 : form.elements.operadores_presentes_l2;
  const value = input.value === "" ? null : anumber(input.value);
  const previous = acabamentoState.lastPresentes[key];
  // Campo vazio = ainda não dá pra saber se falta gente, então nenhum posto
  // deve continuar marcado como parado por absenteísmo até ser preenchido de
  // novo — mesma limpeza já feita quando o número aumenta.
  if (value == null || (previous != null && value > previous)) {
    clearAbsenteeismStopsForLinha(key === "l1" ? linha1Id() : linha2Id());
    renderAcabamentoIllustrations();
  }
  acabamentoState.lastPresentes[key] = value;
  saveShiftDraft();
  updateAbsenteeismBoxes();
}
function absenteeismLimit(linhaId) {
  const form = aq("#shift-entry-form");
  const isL1 = String(linhaId) === String(linha1Id());
  const planned = isL1 ? acabamentoState.planned.l1 : acabamentoState.planned.l2;
  const presentesTexto = isL1 ? form.elements.operadores_presentes_l1.value : form.elements.operadores_presentes_l2.value;
  if (planned == null || presentesTexto === "") return 0;
  return Math.max(0, planned - anumber(presentesTexto));
}
function absenteeismActiveCount(linhaId) {
  return acabamentoState.postos.filter((posto) => posto.tipo === "POSTO_LINHA" && posto.linha_maquina_id === linhaId && findAbsenteeismRowForPosto(posto.id)).length;
}
function toggleAbsenteeismStop(postoId) {
  const posto = acabamentoState.postos.find((p) => p.id === Number(postoId));
  const existing = findAbsenteeismRowForPosto(postoId);
  if (existing) {
    const body = existing.parentElement;
    if (body.children.length === 1) {
      for (const control of existing.querySelectorAll("input,select,button")) { control.disabled = false; control.value = control.type === "number" ? "0" : ""; }
    } else {
      existing.remove();
    }
  } else {
    const limit = posto ? absenteeismLimit(posto.linha_maquina_id) : 0;
    const activeCount = posto ? absenteeismActiveCount(posto.linha_maquina_id) : 0;
    if (activeCount >= limit) return;
    const bounds = turnoBoundsOrNull();
    const form = aq("#shift-entry-form");
    const shiftInfo = window.LIDUTEC_TURNOS.shiftsFor("ACABAMENTO", form.elements.data_operacional.value)[form.elements.turno.value];
    const categoriaId = absenteismoCategoriaId();
    const setorId = admSetorId();
    if (!bounds || !shiftInfo || !categoriaId || !setorId) return;
    const row = stopRow();
    applyRowValues(row, {
      inicio: shiftInfo.inicio,
      fim: shiftInfo.fim,
      posto_id: postoId,
      setor_id: setorId,
      categoria_id: categoriaId,
      observacao: ""
    });
    insertAbsenteeismRow(row);
    try { updateStopRow(row); } catch { /* ignorado: horário do turno já é válido */ }
  }
  lockAutoAbsenteeismoRows();
  saveShiftDraft();
  renderAcabamentoIllustrations();
  updateAbsenteeismBoxes();
}
function cancelAbsenteeismAutoHide(key) {
  clearTimeout(acabamentoState.absenteeismAutoHideTimers[key]);
  acabamentoState.absenteeismAutoHideTimers[key] = null;
}
function scheduleAbsenteeismAutoHide(key) {
  cancelAbsenteeismAutoHide(key);
  acabamentoState.absenteeismAutoHideTimers[key] = setTimeout(() => {
    acabamentoState.absenteeismCollapsed[key] = true;
    updateAbsenteeismBoxes();
  }, 10000);
}
function renderAbsenteeismBox(containerId, linhaId, key) {
  const container = aq(containerId);
  if (!container) return;
  const postos = acabamentoState.postos.filter((posto) => posto.tipo === "POSTO_LINHA" && posto.linha_maquina_id === linhaId);
  const limit = absenteeismLimit(linhaId);
  const activeCount = absenteeismActiveCount(linhaId);
  const satisfeito = activeCount >= limit;
  if (acabamentoState.absenteeismCollapsed[key] && satisfeito) {
    cancelAbsenteeismAutoHide(key);
    container.classList.remove("is-expanded");
    container.innerHTML = `<button type="button" class="acabamento-absenteeism-review" data-linha-key="${key}">Postos parados por absenteísmo (${activeCount}/${limit}) · revisar</button>`;
    return;
  }
  container.classList.add("is-expanded");
  container.innerHTML = `
    <div class="acabamento-absenteeism-header">
      <p class="acabamento-absenteeism-hint">Faltam ${limit} operador(es) frente ao planejado — marque ${limit} posto(s) parado(s) (${activeCount}/${limit} marcados):</p>
      ${satisfeito ? `<button type="button" class="acabamento-absenteeism-hide" data-linha-key="${key}">Ocultar</button>` : ""}
    </div>
    <div class="acabamento-absenteeism-postos">${postos.map((posto) => {
      const active = !!findAbsenteeismRowForPosto(posto.id);
      const blocked = !active && activeCount >= limit;
      return `<button type="button" class="acabamento-absenteeism-posto${active ? " active" : ""}" data-posto-id="${posto.id}"${blocked ? " disabled" : ""}>${aesc(posto.nome)}</button>`;
    }).join("")}</div>`;
  if (satisfeito && !acabamentoState.absenteeismHovering[key]) scheduleAbsenteeismAutoHide(key);
  else cancelAbsenteeismAutoHide(key);
}
function updateAbsenteeismBoxes() {
  const form = aq("#shift-entry-form");
  const boxL1 = aq("#absenteeism-box-l1");
  const boxL2 = aq("#absenteeism-box-l2");
  const closed = acabamentoState.currentShift?.status === "FECHADO" && !acabamentoState.editingClosed;
  if (boxL1) {
    const presentesTexto = form.elements.operadores_presentes_l1.value;
    const showL1 = !closed && acabamentoState.planned.l1 != null && presentesTexto !== "" && anumber(presentesTexto) < acabamentoState.planned.l1;
    boxL1.hidden = !showL1;
    if (showL1) renderAbsenteeismBox("#absenteeism-box-l1", linha1Id(), "l1"); else cancelAbsenteeismAutoHide("l1");
  }
  if (boxL2) {
    const presentesTexto = form.elements.operadores_presentes_l2.value;
    const showL2 = !closed && acabamentoState.linha2Ativa && acabamentoState.planned.l2 != null && presentesTexto !== "" && anumber(presentesTexto) < acabamentoState.planned.l2;
    boxL2.hidden = !showL2;
    if (showL2) renderAbsenteeismBox("#absenteeism-box-l2", linha2Id(), "l2"); else cancelAbsenteeismAutoHide("l2");
  }
}

function applyLinha2Visibility() {
  const section = aq("#linha2-section");
  const label = aq("#linha2-title");
  const operatorsField = aq("#operadores-presentes-l2-field");
  if (!section) return;
  const operatorsInput = operatorsField.querySelector("input");
  if (acabamentoState.linha2Ativa) {
    label.textContent = "Linha 2";
    operatorsField.hidden = false;
    if (operatorsInput) operatorsInput.required = true;
  } else {
    label.textContent = "Linha 2 — Produção extraordinária (opcional)";
    operatorsField.hidden = true;
    // Campo escondido não pode continuar "required" — o navegador tenta
    // focar nele pra validar e não consegue (elemento oculto), travando o
    // envio do formulário inteiro sem nenhum aviso visível ao usuário.
    if (operatorsInput) operatorsInput.required = false;
  }
}

function updateChecklistLink() {
  const link = aq("#checklist-link"), form = aq("#shift-entry-form");
  if (!link || !form) return;
  const params = new URLSearchParams();
  if (form.elements.data_operacional.value) params.set("data", form.elements.data_operacional.value);
  if (form.elements.turno.value) params.set("turno", form.elements.turno.value);
  params.set("origem", "apontamento");
  if (acabamentoState.editingClosed) params.set("editar", "1");
  link.href = `../controle-processo/checklists.html?area=ACABAMENTO&${params}`;
}
async function checkShiftStatus() {
  const form = aq("#shift-entry-form");
  const date = form.elements.data_operacional.value;
  const turno = form.elements.turno.value;
  if (!date || !turno) return;
  const requestId = ++acabamentoState.statusRequestId;
  acabamentoState.contextLoading = true;
  try {
    const blockingShift = await findBlockingOpenShift(turno, date);
    if (requestId !== acabamentoState.statusRequestId) return;
    if (blockingShift) { showShiftBlocked(blockingShift.data_operacional, turno); return; }
    hideShiftBlocked();
    acabamentoState.absenteeismCollapsed = { l1: false, l2: false };
    cancelAbsenteeismAutoHide("l1");
    cancelAbsenteeismAutoHide("l2");
    acabamentoState.linha2Ativa = await window.LIDUTEC_PRODUCAO_ACABAMENTO_DATA.linha2Ativa(date, turno);
    if (requestId !== acabamentoState.statusRequestId) return;
    applyLinha2Visibility();
    await updatePlannedOperators();
    const data = await window.LIDUTEC_PRODUCAO_ACABAMENTO_DATA.shift(date, turno);
    if (requestId !== acabamentoState.statusRequestId) return;
    const previousVersion = acabamentoState.currentShift?.versao ?? -1;
    const previousKey = acabamentoState.currentShift ? `${acabamentoState.currentShift.data_operacional}|${acabamentoState.currentShift.turno}` : "";
    acabamentoState.currentShift = data ? { ...data, data_operacional: date, turno } : null;
    acabamentoState.editingClosed = false;
    const closed = data?.status === "FECHADO";

    if (closed) {
      const [productions, stops] = await Promise.all([
        window.LIDUTEC_PRODUCAO_ACABAMENTO_DATA.shiftProductions(data.id),
        window.LIDUTEC_PRODUCAO_ACABAMENTO_DATA.shiftStops(data.id)
      ]);
      if (requestId !== acabamentoState.statusRequestId) return;
      acabamentoState.originalShiftData = { productions, stops, linhas: data.turnos_acabamento_linhas };
      populateShiftRows(productions, stops, data.turnos_acabamento_linhas);
    } else {
      acabamentoState.originalShiftData = null;
      const key = `${date}|${turno}`;
      const hasNewSharedDraft = data && (previousKey !== key || Number(data.versao) > Number(previousVersion));
      if (hasNewSharedDraft && !acabamentoState.draftSaveInFlight) {
        populateShiftRows(data.rascunho_producoes || [], data.rascunho_paradas || [], data.rascunho_linhas || []);
      } else if (!data) {
        if (!restoreShiftDraft()) resetShiftEntryRows();
      }
    }

    const canEdit = closed && acabamentoState.permissions.has("producao_acabamento.editar");
    const canDelete = closed && acabamentoState.permissions.has("producao_acabamento.excluir_turno");
    const updatedBy = data?.usuarios?.nome;
    const updatedAt = data?.atualizado_em ? new Date(data.atualizado_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";
    form.classList.toggle("shift-readonly", closed);
    aq("#shift-status").textContent = closed ? "Fechado" : (updatedBy ? `Em apontamento · ${updatedBy} às ${updatedAt}` : "Em apontamento");
    aq("#close-shift-button").hidden = closed;
    aq("#close-shift-button").disabled = closed;
    aq("#close-shift-button").textContent = "Gravar Informação";
    aq("#edit-shift-button").hidden = !canEdit;
    aq("#delete-shift-button").hidden = !canDelete;
    aq("#delete-shift-button").disabled = false;
    for (const control of form.querySelectorAll("tbody input,tbody select,tbody button,.row-add-button,[name^=\"operadores_presentes\"]")) {
      control.disabled = closed;
    }
    lockAutoAbsenteeismoRows();
    if (data?.id && closed) await loadShiftHistory(data.id); else aq("#shift-edit-history").hidden = true;
    renderAcabamentoIllustrations();
    updateAbsenteeismBoxes();
    updateChecklistLink();
  } finally {
    if (requestId === acabamentoState.statusRequestId) acabamentoState.contextLoading = false;
  }
}

async function loadShiftHistory(turnId) {
  const data = await window.LIDUTEC_PRODUCAO_ACABAMENTO_DATA.history(turnId);
  const rows = (data || []).map((item) => ({ alterado_em: item.alterado_em, nome: item.usuarios?.nome || "Usuário" }));
  const panel = aq("#shift-edit-history");
  panel.hidden = !rows.length;
  aq("#shift-edit-history-rows").innerHTML = rows.map((item) => `<tr><td>${aFormatDateTime(item.alterado_em)}</td><td>${aesc(item.nome)} alterou os apontamentos do turno.</td></tr>`).join("");
}

async function editClosedShift() {
  const turnId = acabamentoState.currentShift?.id;
  if (!turnId) return;
  acabamentoState.editingClosed = true;
  const form = aq("#shift-entry-form");
  for (const control of form.querySelectorAll("tbody input,tbody select,tbody button,.row-add-button,[name^=\"operadores_presentes\"]")) control.disabled = false;
  lockAutoAbsenteeismoRows();
  aq("#edit-shift-button").hidden = true;
  aq("#delete-shift-button").hidden = true;
  aq("#close-shift-button").hidden = false;
  aq("#close-shift-button").disabled = false;
  aq("#close-shift-button").textContent = "Salvar alterações";
  aq("#shift-status").textContent = "Editando turno fechado";
  updateAbsenteeismBoxes();
  updateChecklistLink();
}
async function deleteClosedShift() {
  const turnId = acabamentoState.currentShift?.id;
  if (!turnId) return;
  if (!confirm("Excluir definitivamente este turno, suas produções, paradas e histórico de alterações?")) return;
  const button = aq("#delete-shift-button");
  button.disabled = true;
  try {
    await window.LIDUTEC_PRODUCAO_ACABAMENTO_DATA.deleteShift(turnId);
    localStorage.removeItem(shiftDraftKey());
    resetShiftEntryRows();
    aq("#shift-edit-history").hidden = true;
    acabamentoMessage("Turno excluído com sucesso.");
    await checkShiftStatus();
  } catch (error) {
    acabamentoMessage(error.message, "error");
    button.disabled = false;
  }
}
async function closeShift(event) {
  event.preventDefault();
  const button = aq("#close-shift-button");
  button.disabled = true;
  try {
    const { productions, linhas, stops } = serializeShift();
    if (acabamentoState.editingClosed) {
      await window.LIDUTEC_PRODUCAO_ACABAMENTO_DATA.editShift({
        p_turno_id: acabamentoState.currentShift.id,
        p_linhas: linhas,
        p_producoes: productions,
        p_paradas: stops
      });
      localStorage.removeItem(shiftDraftKey());
      resetShiftEntryRows();
      acabamentoMessage("Alterações do turno salvas com sucesso.");
      await checkShiftStatus();
      return;
    }
    const form = aq("#shift-entry-form");
    await window.LIDUTEC_PRODUCAO_ACABAMENTO_DATA.closeShift({
      p_data_operacional: form.elements.data_operacional.value,
      p_turno: form.elements.turno.value,
      p_linhas: linhas,
      p_producoes: productions,
      p_paradas: stops,
      p_versao: acabamentoState.currentShift?.versao ?? null
    });
    localStorage.removeItem(shiftDraftKey());
    resetShiftEntryRows();
    acabamentoMessage("Turno fechado com sucesso.");
    await checkShiftStatus();
  } catch (error) {
    acabamentoMessage(error.message, "error");
    button.disabled = false;
  }
}

function applyCurrentShiftDefaults(form) {
  const params = new URLSearchParams(location.search);
  const paramDate = params.get("data");
  const paramTurno = params.get("turno");
  if (paramDate && /^\d{4}-\d{2}-\d{2}$/.test(paramDate) && window.LIDUTEC_TURNOS.shifts[paramTurno]) {
    form.elements.data_operacional.value = paramDate;
    form.elements.turno.value = paramTurno;
    return;
  }
  const shift = window.LIDUTEC_TURNOS.determineShift(new Date(), "ACABAMENTO");
  form.elements.data_operacional.value = shift.dataOperacional;
  form.elements.turno.value = shift.codigo;
}
// Um turno só conta como "aberto com dados" se o rascunho realmente tiver algo
// preenchido — abrir e apagar tudo sem fechar não deve travar o turno seguinte.
function shiftDraftHasData(row) {
  return (row.rascunho_producoes || []).some((item) => item.produto_id) ||
    (row.rascunho_paradas || []).some((item) => item.categoria_id || item.setor_id) ||
    (row.rascunho_linhas || []).some((item) => item.operadores_presentes != null && item.operadores_presentes !== "");
}
async function findBlockingOpenShift(turno, date) {
  const rows = await window.LIDUTEC_PRODUCAO_ACABAMENTO_DATA.openShiftsBefore(turno, date);
  return rows.find(shiftDraftHasData) || null;
}
function showShiftBlocked(openDate, turno) {
  const form = aq("#shift-entry-form");
  const panel = aq("#shift-blocked-message");
  if (!panel) return;
  form.hidden = true;
  const label = window.LIDUTEC_TURNOS.shifts[turno]?.nome || turno;
  const displayDate = new Date(`${openDate}T12:00:00`).toLocaleDateString("pt-BR");
  aq("#shift-blocked-text").textContent = `Existe um turno de ${label} em aberto no dia ${displayDate}. Feche-o ou remova os lançamentos incompletos antes de abrir um novo turno de ${label} — avalie com atenção antes de remover, pois os dados já digitados serão perdidos.`;
  aq("#shift-blocked-link").href = `lancamento.html?data=${openDate}&turno=${turno}`;
  panel.hidden = false;
}
function hideShiftBlocked() {
  const panel = aq("#shift-blocked-message");
  if (panel) panel.hidden = true;
  const form = aq("#shift-entry-form");
  if (form) form.hidden = false;
}

// ---------------------------------------------------------------------------
// Calendário de seleção de data — mesmas regras/cores da Moldagem: verde
// (trabalhado), laranja (feriado trabalhado), amarelo (feriado), roxo
// (férias), vermelho (previsto sem apontamento), cinza (futuro/folga),
// contorno vermelho (aberto, falta finalizar).
// ---------------------------------------------------------------------------
const shiftCalendarState = { month: null, turns: new Map(), events: [] };
const calendarDate = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
function updateShiftDateButton() {
  const input = aq('#shift-entry-form [name="data_operacional"]');
  const button = aq("#shift-date-button");
  if (!input || !button) return;
  const parts = input.value.split("-");
  button.textContent = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : "Selecionar data";
}
function calendarDayState(value, shift) {
  const turn = shiftCalendarState.turns.get(value);
  const bounds = window.LIDUTEC_TURNOS.shiftBounds(value, shift);
  const now = new Date();
  const events = shiftCalendarState.events.filter((event) => event.data_inicio <= value && event.data_fim >= value);
  const work = events.find((event) => event.tipo === "TRABALHO_EXCEPCIONAL");
  const holiday = events.find((event) => event.tipo === "FERIADO");
  const ferias = events.find((event) => event.tipo === "FERIAS_COLETIVAS");
  const folga = events.find((event) => event.tipo === "FOLGA_PROGRAMADA");
  if (turn?.status === "FECHADO") {
    if (holiday) return { type: "worked-holiday", label: `Trabalhado (feriado) · ${holiday.nome}` };
    return { type: "worked", label: `Trabalhado${events.length ? ` · ${events.map((event) => event.nome).join(" · ")}` : ""}` };
  }
  if (turn?.status === "ABERTO" && shiftDraftHasData(turn)) return { type: "incomplete", label: "Turno com dados faltando finalizar" };
  if (bounds.end > now) return { type: "off", label: "Futuro" };
  if (work) return { type: "missing", label: `Trabalho excepcional sem apontamento · ${work.nome}` };
  if (holiday) return { type: "holiday", label: holiday.nome };
  if (ferias) return { type: "vacation", label: ferias.nome };
  if (folga) return { type: "off", label: folga.nome };
  if (!window.LIDUTEC_TURNOS.isScheduledShiftDay(value, shift)) return { type: "off", label: "Folga" };
  return { type: "missing", label: "Turno previsto sem apontamento" };
}
function renderShiftCalendar() {
  const form = aq("#shift-entry-form");
  const month = shiftCalendarState.month;
  const holder = aq("#shift-calendar-days");
  if (!form || !month || !holder) return;
  const shift = form.elements.turno.value;
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const first = new Date(year, monthIndex, 1);
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  const selected = form.elements.data_operacional.value;
  const cells = [];
  aq("#shift-calendar-title").textContent = month.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  for (let index = 0; index < first.getDay(); index++) cells.push('<span class="shift-calendar-day outside"></span>');
  for (let day = 1; day <= lastDay; day++) {
    const date = new Date(year, monthIndex, day);
    const value = calendarDate(date);
    const state = calendarDayState(value, shift);
    cells.push(`<button type="button" class="shift-calendar-day ${state.type}${value === selected ? " selected" : ""}" data-calendar-date="${value}" title="${aesc(state.label)}">${day}</button>`);
  }
  holder.innerHTML = cells.join("");
}
async function loadShiftCalendar() {
  const form = aq("#shift-entry-form");
  const month = shiftCalendarState.month;
  if (!form || !month) return;
  const from = calendarDate(new Date(month.getFullYear(), month.getMonth(), 1));
  const to = calendarDate(new Date(month.getFullYear(), month.getMonth() + 1, 0));
  const shift = form.elements.turno.value;
  const [turns, events] = await Promise.all([
    window.LIDUTEC_PRODUCAO_ACABAMENTO_DATA.monthShifts(from, to, shift),
    window.LIDUTEC_PRODUCAO_ACABAMENTO_DATA.calendarEvents(from, to, shift)
  ]);
  shiftCalendarState.turns = new Map(turns.map((row) => [row.data_operacional, row]));
  shiftCalendarState.events = events;
  renderShiftCalendar();
}
function initializeShiftCalendar() {
  const form = aq("#shift-entry-form");
  const dialog = aq("#shift-calendar");
  const button = aq("#shift-date-button");
  updateShiftDateButton();
  button.addEventListener("click", () => {
    const selected = new Date(`${form.elements.data_operacional.value}T12:00:00`);
    shiftCalendarState.month = Number.isNaN(selected.getTime()) ? new Date() : new Date(selected.getFullYear(), selected.getMonth(), 1);
    dialog.showModal();
    loadShiftCalendar().catch((error) => acabamentoMessage(error.message, "error"));
  });
  dialog.addEventListener("click", (event) => {
    const dateButton = event.target.closest("[data-calendar-date]");
    if (dateButton) {
      form.elements.data_operacional.value = dateButton.dataset.calendarDate;
      updateShiftDateButton();
      form.elements.data_operacional.dispatchEvent(new Event("change", { bubbles: true }));
      dialog.close();
      return;
    }
    if (event.target.closest("[data-calendar-close]")) { dialog.close(); return; }
    const direction = event.target.closest("[data-calendar-previous]") ? -1 : event.target.closest("[data-calendar-next]") ? 1 : 0;
    if (direction) {
      shiftCalendarState.month.setMonth(shiftCalendarState.month.getMonth() + direction);
      loadShiftCalendar().catch((error) => acabamentoMessage(error.message, "error"));
    }
  });
  form.elements.turno.addEventListener("change", () => {
    if (dialog.open) loadShiftCalendar().catch((error) => acabamentoMessage(error.message, "error"));
  });
}

async function initializeShiftEntry() {
  const form = aq("#shift-entry-form");
  applyCurrentShiftDefaults(form);
  initializeShiftCalendar();
  resetShiftEntryRows();

  aq("#add-production-row-l1").addEventListener("click", () => { appendEntryRow("#production-entry-rows-l1", productionRow()); updateAllProductionTotals(); saveShiftDraft(); });
  aq("#add-production-row-l2").addEventListener("click", () => { appendEntryRow("#production-entry-rows-l2", productionRow()); updateAllProductionTotals(); saveShiftDraft(); });
  aq("#add-stop-row").addEventListener("click", () => { appendEntryRow("#stop-entry-rows", stopRow()); saveShiftDraft(); renderAcabamentoIllustrations(); });
  for (const key of ["l1", "l2"]) {
    const box = aq(`#absenteeism-box-${key}`);
    if (!box) continue;
    box.addEventListener("mouseenter", () => { acabamentoState.absenteeismHovering[key] = true; cancelAbsenteeismAutoHide(key); });
    box.addEventListener("mouseleave", () => {
      acabamentoState.absenteeismHovering[key] = false;
      const linhaId = key === "l1" ? linha1Id() : linha2Id();
      if (!acabamentoState.absenteeismCollapsed[key] && absenteeismActiveCount(linhaId) >= absenteeismLimit(linhaId)) scheduleAbsenteeismAutoHide(key);
    });
  }
  form.addEventListener("input", (event) => {
    const stop = event.target.closest(".shift-stop-row");
    if (stop) {
      try { updateStopRow(stop); acabamentoClearMessage("stop-time"); }
      catch (error) { acabamentoMessage(error.message, "error", "stop-time"); }
      renderAcabamentoIllustrations();
    }
    if (event.target.closest(".shift-production-row")) updateAllProductionTotals();
    saveShiftDraft();
  });
  form.addEventListener("click", (event) => {
    const hideButton = event.target.closest(".acabamento-absenteeism-hide");
    if (hideButton) { acabamentoState.absenteeismCollapsed[hideButton.dataset.linhaKey] = true; updateAbsenteeismBoxes(); return; }
    const reviewButton = event.target.closest(".acabamento-absenteeism-review");
    if (reviewButton) { acabamentoState.absenteeismCollapsed[reviewButton.dataset.linhaKey] = false; updateAbsenteeismBoxes(); return; }
    const absenteeismButton = event.target.closest(".acabamento-absenteeism-posto");
    if (absenteeismButton) { toggleAbsenteeismStop(anumber(absenteeismButton.dataset.postoId)); return; }
    const button = event.target.closest(".row-remove");
    if (!button) return;
    const row = button.closest("tr");
    const body = row.parentElement;
    if (body.children.length === 1) {
      for (const control of row.querySelectorAll("input,select")) control.value = control.type === "number" ? "0" : "";
    } else {
      row.remove();
    }
    if (row.matches(".shift-production-row")) updateAllProductionTotals();
    saveShiftDraft();
    if (row.matches(".shift-stop-row")) { renderAcabamentoIllustrations(); updateAbsenteeismBoxes(); }
  });
  const refreshContext = () => checkShiftStatus().catch((error) => acabamentoMessage(error.message, "error"));
  form.elements.data_operacional.addEventListener("change", refreshContext);
  form.elements.turno.addEventListener("change", refreshContext);
  form.elements.operadores_presentes_l1.addEventListener("input", () => handlePresentesInput("l1"));
  form.elements.operadores_presentes_l2.addEventListener("input", () => handlePresentesInput("l2"));
  form.addEventListener("submit", closeShift);
  if (!restoreShiftDraft()) { /* checkShiftStatus abaixo decide entre rascunho compartilhado e formulário em branco */ }
  await checkShiftStatus();

  aq("#edit-shift-button").addEventListener("click", () => editClosedShift().catch((error) => acabamentoMessage(error.message, "error")));
  aq("#delete-shift-button").addEventListener("click", deleteClosedShift);
}

// ---------------------------------------------------------------------------
// Consulta / dashboard / gráficos
// ---------------------------------------------------------------------------
function productionFilters(form) {
  return {
    from: form?.elements.inicio.value || null,
    to: form?.elements.fim.value || null,
    shift: form?.elements.turno?.value || null,
    productId: form?.elements.produto_id?.value || null,
    postoId: form?.elements.posto_id?.value || null,
    sectorId: form?.elements.setor_id?.value || null,
    categoryId: form?.elements.categoria_id?.value || null,
    search: form?.elements.observacao?.value.trim() || null,
    limit: 1000
  };
}
async function loadAcabamentoData() {
  const today = window.LIDUTEC_TURNOS.determineShift().dataOperacional;
  if (acabamentoPage === "dashboard") {
    const form = aq("#production-query-filters");
    if (form) { form.elements.inicio.value = today; form.elements.fim.value = today; }
    const [records, stops, shifts] = await Promise.all([
      window.LIDUTEC_PRODUCAO_ACABAMENTO_DATA.records(productionFilters(form)),
      window.LIDUTEC_PRODUCAO_ACABAMENTO_DATA.stops({ from: today, to: today, limit: 1000 }),
      window.LIDUTEC_PRODUCAO_ACABAMENTO_DATA.shiftsOnDate(today)
    ]);
    acabamentoState.records = records;
    acabamentoState.stops = stops;
    acabamentoState.periodShifts = shifts;
    return;
  }
  if (acabamentoPage === "stops") {
    const form = aq("#stop-query-filters");
    form.elements.inicio.value = aDaysBefore(today, 30);
    form.elements.fim.value = today;
    acabamentoState.records = [];
    acabamentoState.stops = await window.LIDUTEC_PRODUCAO_ACABAMENTO_DATA.stops(productionFilters(form));
    return;
  }
  if (acabamentoPage === "charts") {
    const { from, to } = acabamentoChartPeriod();
    const [records, stops, shifts, scheduledStops] = await Promise.all([
      window.LIDUTEC_PRODUCAO_ACABAMENTO_DATA.records({ from, to, limit: 5000 }),
      window.LIDUTEC_PRODUCAO_ACABAMENTO_DATA.stops({ from, to, limit: 5000 }),
      window.LIDUTEC_PRODUCAO_ACABAMENTO_DATA.shiftsInRange(from, to),
      window.LIDUTEC_PRODUCAO_ACABAMENTO_DATA.scheduledStops(from, to)
    ]);
    acabamentoState.records = records;
    acabamentoState.stops = stops;
    acabamentoState.periodShifts = shifts;
    acabamentoState.scheduledStops = scheduledStops;
  }
}

function productionTotals(records = acabamentoState.records) {
  return {
    liberadas: records.reduce((sum, x) => sum + anumber(x.quantidade_liberada), 0),
    rejeitadas: records.reduce((sum, x) => sum + anumber(x.quantidade_rejeitada), 0),
    retrabalhadas: records.reduce((sum, x) => sum + anumber(x.quantidade_retrabalhada), 0),
    refugadas: records.reduce((sum, x) => sum + anumber(x.quantidade_refugada), 0)
  };
}

function renderAcabamentoDashboard() {
  const today = window.LIDUTEC_TURNOS.determineShift().dataOperacional;
  const records = acabamentoState.records.filter((x) => x.data_operacional === today);
  const stops = acabamentoState.stops.filter((x) => x.data_operacional === today);
  const totals = productionTotals(records);
  // "Tempo de parada" é indicador de perda, não um log de duração — soma o
  // tempo perdido EQUIVALENTE (perda parcial não conta como parada total).
  const stopMinutes = stops.reduce((sum, x) => sum + anumber(x.tempo_perdido_equivalente_minutos ?? x.duracao_minutos), 0);
  // Absenteísmo é do turno atual, não do dia inteiro: turnos_acabamento_linhas
  // guarda linhas de qualquer turno com apontamento iniciado nessa data, então
  // sem filtrar por turno o cálculo misturaria manhã/tarde/noite entre si (e
  // mostraria algo mesmo quando o turno atual ainda nem foi apontado).
  // Enquanto "operadores presentes" não foi preenchido (null), considera a
  // linha com todos os postos ativos (presentes = planejados) em vez de 0 —
  // senão a soma mostraria 100% de absenteísmo antes de qualquer dado real.
  const currentTurno = window.LIDUTEC_TURNOS.determineShift(new Date(), "ACABAMENTO").codigo;
  const shifts = (acabamentoState.periodShifts || []).filter((s) => s.turnos_producao_acabamento?.turno === currentTurno);
  const planejados = shifts.reduce((sum, s) => sum + anumber(s.operadores_planejados), 0);
  const presentes = shifts.reduce((sum, s) => sum + (s.operadores_presentes != null ? anumber(s.operadores_presentes) : anumber(s.operadores_planejados)), 0);
  const absenteismo = planejados > 0 ? Math.max(0, 1 - presentes / planejados) : 0;

  const values = {
    liberadas: totals.liberadas.toLocaleString("pt-BR"),
    refugadas: totals.refugadas.toLocaleString("pt-BR"),
    retrabalhadas: totals.retrabalhadas.toLocaleString("pt-BR"),
    rejeitadas: totals.rejeitadas.toLocaleString("pt-BR"),
    absenteismo: `${(absenteismo * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`,
    stops: aFormatMinutes(stopMinutes)
  };
  for (const [key, value] of Object.entries(values)) {
    const el = aq(`[data-metric="${key}"]`);
    if (el) el.textContent = value;
  }
  renderAcabamentoRecordsTable();
}

function renderAcabamentoRecordsTable() {
  const body = aq("#dashboard-production-records");
  if (!body) return;
  const rows = acabamentoState.records;
  body.innerHTML = rows.map((item) => `<tr>
      <td>${aDisplayDate(item.data_operacional)}</td>
      <td>${aesc(item.turno)}</td>
      <td>${aesc(item.linhas_maquinas_producao?.nome || "—")}</td>
      <td><strong>${aesc(item.produtos?.codigo || "—")}</strong> — ${aesc(item.produtos?.nome || "")}</td>
      <td>${anumber(item.quantidade_liberada)}</td>
      <td>${anumber(item.quantidade_rejeitada)}</td>
      <td>${anumber(item.quantidade_retrabalhada)}</td>
      <td>${anumber(item.quantidade_refugada)}</td>
    </tr>`).join("");
  const empty = aq("#dashboard-production-empty");
  if (empty) empty.hidden = rows.length > 0;
}

// Mesmo modelo da tela de paradas da Moldagem (filtros com recarga em
// debounce, colunas ordenáveis, exportação Excel/SVG), mantendo a coluna de
// Posto/Equipamento que já existia aqui (paradas de Acabamento são por
// posto, diferente de Moldagem).
function filteredByAcabamentoPeriod(rows, form) {
  const start = form?.elements.inicio.value, end = form?.elements.fim.value, shift = form?.elements.turno.value;
  return rows.filter((item) => (!start || item.data_operacional >= start) && (!end || item.data_operacional <= end) && (!shift || item.turno === shift));
}
async function reloadAcabamentoStops() {
  const form = aq("#stop-query-filters");
  acabamentoState.stops = await window.LIDUTEC_PRODUCAO_ACABAMENTO_DATA.stops(productionFilters(form));
  renderAcabamentoStops();
}
function updateAcabamentoStopSortHeaders() {
  for (const button of document.querySelectorAll(".stop-query-table .table-sort")) {
    const active = button.dataset.sort === acabamentoState.stopSort.key;
    const direction = active ? acabamentoState.stopSort.direction : "";
    button.dataset.direction = direction;
    button.closest("th").setAttribute("aria-sort", direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none");
    button.title = active ? `Classificação ${direction === "asc" ? "crescente" : "decrescente"}. Clique para inverter.` : "Clique para classificar em ordem crescente.";
  }
}
// Condição vem de tipo_ocorrencia + componentes_indisponiveis (estruturado no
// banco); o total de turbinas não é duplicado por parada, vem junto no join
// com o posto/equipamento (postos_equipamentos_acabamento.numero_turbinas).
function acabamentoStopConditionLabel(item) {
  if (item.tipo_ocorrencia !== "PARCIAL") return "Parada total";
  const total = item.postos_equipamentos_acabamento?.numero_turbinas;
  return `${item.componentes_indisponiveis} de ${total ?? "?"} turbinas`;
}
const acabamentoStopExportHeaders = ["Data", "Turno", "Início", "Fim", "Tempo total", "Condição", "Perda equivalente", "Posto/Equipamento", "Setor de origem", "Motivo", "Observações"];
function acabamentoStopExportValues(item) {
  return [
    aDisplayDate(item.data_operacional), item.turno, aFormatDateTime(item.inicio), aFormatDateTime(item.fim),
    aFormatMinutes(item.duracao_minutos), acabamentoStopConditionLabel(item),
    aFormatMinutes(item.tempo_perdido_equivalente_minutos ?? item.duracao_minutos), item.postos_equipamentos_acabamento?.nome || "—",
    item.setores_responsaveis_parada?.nome || "—", item.categorias_parada_producao?.nome || "—",
    item.observacao || "—"
  ].map(String);
}
function updateAcabamentoStopExportControls() {
  const rows = acabamentoState.visibleStopRows, button = aq("#stop-export-button"), counter = aq("#stop-export-count");
  if (counter) counter.textContent = `${rows.length} registro${rows.length === 1 ? "" : "s"}`;
  if (button) button.disabled = !rows.length;
}
function downloadAcabamentoFile(content, type, extension, baseName) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${baseName}-${new Date().toISOString().slice(0, 10)}.${extension}`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportAcabamentoStopsExcel(rows) {
  const tableRows = rows.map((item) => `<tr>${acabamentoStopExportValues(item).map((value) => `<td>${aesc(value)}</td>`).join("")}</tr>`).join("");
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body><table border="1"><thead><tr>${acabamentoStopExportHeaders.map((value) => `<th>${aesc(value)}</th>`).join("")}</tr></thead><tbody>${tableRows}</tbody></table></body></html>`;
  downloadAcabamentoFile(`﻿${html}`, "application/vnd.ms-excel;charset=utf-8", "xls", "paradas-acabamento");
}
function exportAcabamentoStopsSvg(rows) {
  const widths = [90, 90, 170, 170, 100, 150, 110, 190, 190, 190, 300];
  const rowHeight = 28;
  const width = widths.reduce((sum, value) => sum + value, 0);
  const height = (rows.length + 1) * rowHeight + 2;
  const truncate = (value, size) => (value.length > size ? `${value.slice(0, Math.max(1, size - 1))}…` : value);
  const text = (value, x, y, maxChars, weight = "400", fill = "#263238") =>
    `<text x="${x}" y="${y}" font-family="Arial,sans-serif" font-size="11" font-weight="${weight}" fill="${fill}">${aesc(truncate(String(value), maxChars))}</text>`;
  let content = `<rect width="100%" height="100%" fill="#fff"/>`, x = 0;
  acabamentoStopExportHeaders.forEach((header, index) => {
    content += `<rect x="${x}" y="1" width="${widths[index]}" height="${rowHeight}" fill="#b71c1c" stroke="#fff"/>${text(header, x + 5, 19, Math.floor(widths[index] / 7), "700", "#fff")}`;
    x += widths[index];
  });
  rows.forEach((item, rowIndex) => {
    const values = acabamentoStopExportValues(item);
    const y = (rowIndex + 1) * rowHeight + 1;
    x = 0;
    values.forEach((value, index) => {
      content += `<rect x="${x}" y="${y}" width="${widths[index]}" height="${rowHeight}" fill="${rowIndex % 2 ? "#f3f5f6" : "#fff"}" stroke="#d8dee2"/>${text(value, x + 5, y + 18, Math.floor(widths[index] / 7))}`;
      x += widths[index];
    });
  });
  downloadAcabamentoFile(`<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${content}</svg>`, "image/svg+xml;charset=utf-8", "svg", "paradas-acabamento");
}
function exportVisibleAcabamentoStops() {
  const rows = acabamentoState.visibleStopRows;
  if (!rows.length) return;
  aq("#stop-export-format")?.value === "svg" ? exportAcabamentoStopsSvg(rows) : exportAcabamentoStopsExcel(rows);
}
function renderAcabamentoStops() {
  const body = aq("#stop-records");
  if (!body) return;
  const form = aq("#stop-query-filters");
  const postoId = form?.elements.posto_id?.value, sectorId = form?.elements.setor_id?.value, categoryId = form?.elements.categoria_id?.value;
  const normalizeText = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const terms = normalizeText(form?.elements.observacao?.value).split(/\s+/).filter(Boolean);
  const filtered = filteredByAcabamentoPeriod(acabamentoState.stops, form).filter((item) =>
    (!postoId || String(item.posto_equipamento_id) === postoId) &&
    (!sectorId || String(item.setor_origem_id) === sectorId) &&
    (!categoryId || String(item.categoria_id) === categoryId) &&
    terms.every((term) => normalizeText(item.observacao).includes(term)));
  const getters = {
    start: (item) => item.inicio, end: (item) => item.fim, duration: (item) => anumber(item.duracao_minutos),
    condition: (item) => (item.tipo_ocorrencia === "PARCIAL" ? anumber(item.componentes_indisponiveis) : 0),
    loss: (item) => anumber(item.tempo_perdido_equivalente_minutos ?? item.duracao_minutos),
    posto: (item) => item.postos_equipamentos_acabamento?.nome, sector: (item) => item.setores_responsaveis_parada?.nome,
    reason: (item) => item.categorias_parada_producao?.nome, notes: (item) => item.observacao,
    date: (item) => item.data_operacional, shift: (item) => item.turno
  };
  const getValue = getters[acabamentoState.stopSort.key];
  const factor = acabamentoState.stopSort.direction === "asc" ? 1 : -1;
  const rows = getValue
    ? filtered.map((item, index) => ({ item, index })).sort((left, right) => {
        const a = getValue(left.item), b = getValue(right.item);
        const result = typeof a === "number" && typeof b === "number" ? a - b : String(a ?? "").localeCompare(String(b ?? ""), "pt-BR", { numeric: true, sensitivity: "base" });
        return result ? result * factor : left.index - right.index;
      }).map((entry) => entry.item)
    : filtered;
  acabamentoState.visibleStopRows = rows;
  body.innerHTML = rows.map((x) => `<tr>
      <td>${aDisplayDate(x.data_operacional)}</td>
      <td>${aesc(x.turno)}</td>
      <td>${aFormatDateTime(x.inicio)}</td>
      <td>${aFormatDateTime(x.fim)}</td>
      <td>${Math.round(anumber(x.duracao_minutos))}</td>
      <td>${aesc(acabamentoStopConditionLabel(x))}</td>
      <td>${Math.round(anumber(x.tempo_perdido_equivalente_minutos ?? x.duracao_minutos))}</td>
      <td>${aesc(x.postos_equipamentos_acabamento?.nome || "—")}</td>
      <td>${aesc(x.setores_responsaveis_parada?.nome || "—")}</td>
      <td>${aesc(x.categorias_parada_producao?.nome || "—")}</td>
      <td>${aesc(x.observacao || "—")}</td>
    </tr>`).join("");
  const empty = aq("#stop-records-empty");
  if (empty) empty.hidden = rows.length > 0;
  updateAcabamentoStopSortHeaders();
  updateAcabamentoStopExportControls();
}

function renderGauge(selector, fraction, label) {
  const container = aq(selector);
  if (!container) return;
  const percent = Math.max(0, Math.min(1, fraction || 0)) * 100;
  const color = percent >= 85 ? "#218c4b" : percent >= 65 ? "#b7791f" : "#b90e2c";
  container.innerHTML = `
    <div class="production-donut" style="--donut-segments:${color} 0deg ${percent * 3.6}deg,#e2e8f0 ${percent * 3.6}deg 360deg" role="img" aria-label="${aesc(label)}">
      <div><strong>${percent.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</strong><span>${aesc(label)}</span></div>
    </div>`;
}

function postoCountByLinha() {
  const map = new Map();
  for (const posto of acabamentoState.postos) {
    if (posto.tipo === "POSTO_LINHA") {
      map.set(posto.linha_maquina_id, (map.get(posto.linha_maquina_id) || 0) + 1);
    }
  }
  return map;
}
function postoTipoById() {
  return new Map(acabamentoState.postos.map((posto) => [posto.id, posto]));
}

function paradaProgramadaOverlapMinutos(stop, { linhaId = null, equipamentoCodigo = null } = {}) {
  let bounds;
  try { bounds = window.LIDUTEC_TURNOS.shiftBounds(stop.data_operacional, stop.turno); } catch { return 0; }
  return window.LIDUTEC_PARADAS_PROGRAMADAS.overlapMinutos({
    janelas: acabamentoState.scheduledStops || [], turnoInicio: bounds.start,
    paradaInicio: stop.inicio, paradaFim: stop.fim,
    turno: stop.turno, dataOperacional: stop.data_operacional, linhaId, equipamentoCodigo
  });
}
function renderAcabamentoCharts() {
  const totals = productionTotals(acabamentoState.records);
  // shiftsInRange devolve 1 linha por (turno, linha ativa) — já exclui
  // automaticamente a Linha 2 nas noites de sexta/domingo, porque nesses
  // turnos não existe registro de turnos_acabamento_linhas para ela.
  const shifts = acabamentoState.periodShifts || [];
  const postoPorLinha = postoCountByLinha();
  const postoById = postoTipoById();

  // Agrupado por (turno, linha) — não só por turno: como 1 turno cobre as duas
  // linhas, agrupar só por turno faria a parada de um posto da Linha 1 também
  // ser contada na disponibilidade da Linha 2 (e vice-versa).
  const stopsPorTurnoLinha = new Map();
  const stopsPorEquipamento = new Map();
  for (const stop of acabamentoState.stops) {
    const posto = postoById.get(stop.posto_equipamento_id);
    if (!posto) continue;
    // Fração da duração real que de fato conta como perda: 1 pra parada
    // total, <1 pra capacidade reduzida (turbinas do Jato etc.) — aplicada
    // sobre a duração já descontada da janela programada abaixo, então os
    // dois ajustes (programado + capacidade parcial) se combinam sem
    // duplicar nem perder nenhum dos dois.
    const perdaRatio = anumber(stop.duracao_minutos) > 0
      ? anumber(stop.tempo_perdido_equivalente_minutos ?? stop.duracao_minutos) / anumber(stop.duracao_minutos)
      : 1;
    if (posto.tipo === "POSTO_LINHA") {
      // Paradas de Absenteísmo (Setor ADM) já são contabilizadas na disponibilidade
      // pela proporção operadoresPresentes/operadoresPlanejados — somar de novo
      // aqui dobraria a perda pelo mesmo motivo.
      if (isAbsenteeismoStopRecord(stop)) continue;
      // Parte da parada que cai numa janela programada (refeição, manutenção
      // preventiva etc.) não conta contra a disponibilidade — já é esperada.
      const overlapProgramado = paradaProgramadaOverlapMinutos(stop, { linhaId: posto.linha_maquina_id });
      const key = `${stop.turno_producao_id}|${posto.linha_maquina_id}`;
      const lista = stopsPorTurnoLinha.get(key) || [];
      lista.push({ ...stop, tempo_perdido_ajustado: Math.max(0, anumber(stop.duracao_minutos) - overlapProgramado) * perdaRatio });
      stopsPorTurnoLinha.set(key, lista);
    } else {
      // Mesma lógica: tempo do equipamento avulso parado numa janela programada
      // (refeição, manutenção preventiva etc.) não reduz a taxa de utilização dele.
      const overlapProgramado = paradaProgramadaOverlapMinutos(stop, { equipamentoCodigo: posto.codigo });
      const lista = stopsPorEquipamento.get(posto.id) || [];
      lista.push({ ...stop, tempo_perdido_ajustado: Math.max(0, anumber(stop.duracao_minutos) - overlapProgramado) * perdaRatio });
      stopsPorEquipamento.set(posto.id, lista);
    }
  }

  let totalMinutosTurno = 0;
  let totalDisponibilidadePonderada = 0;
  for (const shift of shifts) {
    const turno = shift.turnos_producao_acabamento?.turno;
    const minutosTurno = window.LIDUTEC_TURNOS.shiftsFor("ACABAMENTO", shift.turnos_producao_acabamento?.data_operacional)[turno]?.minutos || 0;
    if (!minutosTurno) continue;
    const numeroPostos = postoPorLinha.get(shift.linha_maquina_id) || 1;
    const minutosParada = (stopsPorTurnoLinha.get(`${shift.turno_producao_id}|${shift.linha_maquina_id}`) || []).reduce((sum, x) => sum + anumber(x.tempo_perdido_ajustado), 0);
    const disponibilidadeTurno = window.LIDUTEC_TURNOS.calcularDisponibilidade({
      minutosTurno, numeroPostos,
      operadoresPlanejados: shift.operadores_planejados, operadoresPresentes: shift.operadores_presentes,
      minutosParada
    });
    totalMinutosTurno += minutosTurno;
    totalDisponibilidadePonderada += disponibilidadeTurno * minutosTurno;
  }
  const disponibilidade = totalMinutosTurno > 0 ? totalDisponibilidadePonderada / totalMinutosTurno : 0;
  const tempoDisponivelLinha = totalDisponibilidadePonderada;

  const tempoCicloMedio = acabamentoState.records.length
    ? acabamentoState.records.reduce((sum, item) => sum + (cycleTimeFor(item.produto_id) || 0), 0) / acabamentoState.records.length
    : 0;
  const tempoTeorico = window.LIDUTEC_TURNOS.calcularTempoTeorico({
    pecasLiberadas: totals.liberadas, pecasRefugadas: totals.refugadas, tempoCicloSegundos: tempoCicloMedio
  });
  const eficiencia = window.LIDUTEC_TURNOS.calcularEficiencia({ tempoTeoricoMinutos: tempoTeorico, tempoDisponivelMinutos: tempoDisponivelLinha });
  const qualidade = window.LIDUTEC_TURNOS.calcularQualidade({ pecasLiberadas: totals.liberadas, pecasRefugadas: totals.refugadas });
  const oee = window.LIDUTEC_TURNOS.calcularOEE({ disponibilidade, eficiencia, qualidade });

  renderGauge("#gauge-disponibilidade", disponibilidade, "Disponibilidade");
  renderGauge("#gauge-eficiencia", eficiencia, "Eficiência");
  renderGauge("#gauge-qualidade", qualidade, "Qualidade");
  renderGauge("#gauge-oee", oee, "OEE");

  const equipamentosAvulsos = acabamentoState.postos.filter((posto) => posto.tipo === "EQUIPAMENTO_AVULSO");
  const container = aq("#equipamentos-avulsos-rows");
  if (container) {
    container.innerHTML = equipamentosAvulsos.map((equipamento) => {
      const minutosParada = (stopsPorEquipamento.get(equipamento.id) || []).reduce((sum, x) => sum + anumber(x.tempo_perdido_ajustado), 0);
      const taxa = window.LIDUTEC_TURNOS.calcularTaxaEquipamento({ minutosPeriodo: totalMinutosTurno, minutosParada });
      return `<div class="equipamento-avulso-card"><strong>${aesc(equipamento.nome)}</strong><span>${(taxa * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</span><small>${aFormatMinutes(minutosParada)} parado</small></div>`;
    }).join("");
  }
}

// Mesma paleta de turno do dashboard da Moldagem (assets/js/dashboard.js
// shiftColors), pra manter o padrão visual entre os dois setores.
const DELTA_LINHA2_TURNOS = [
  { codigo: "MANHA", label: "Manhã", cor: "#f2ef85" },
  { codigo: "TARDE", label: "Tarde", cor: "#79e98d" },
  { codigo: "NOITE", label: "Noite", cor: "#82bdf2" }
];

// Mesma lógica de linha_2_ativa_acabamento(data, turno) no banco, só que
// avaliada aqui em cima das regras já carregadas (linha2DiasAtivosRegras) —
// evita 1 RPC por dia/turno do período do gráfico. Uma vigência específica
// do turno pedido tem prioridade sobre uma geral (turno null); sem nenhuma
// regra cadastrada, a linha roda todos os dias.
let linha2DiasAtivosRegras = [];
function linha2TurnoAtivo(day, turnoCodigo) {
  const candidatas = linha2DiasAtivosRegras.filter((regra) =>
    (regra.turno === turnoCodigo || regra.turno == null) &&
    regra.vigencia_inicio <= day &&
    (regra.vigencia_fim == null || regra.vigencia_fim >= day)
  );
  if (!candidatas.length) return true;
  candidatas.sort((a, b) => {
    if ((a.turno != null) !== (b.turno != null)) return a.turno != null ? -1 : 1;
    return b.vigencia_inicio.localeCompare(a.vigencia_inicio);
  });
  const dow = new Date(`${day}T12:00:00`).getDay(); // 0=Dom ... 6=Sáb
  return candidatas[0].dias_semana.includes(dow);
}

// Busca única (registros + meta por dia) reaproveitada pelos 3 gráficos de
// indicadores da Linha 2, pra não repetir a mesma consulta 3x.
async function loadLinha2IndicatorData() {
  const linhaId = linha2Id();
  if (!linhaId) return null;

  const { from, to } = acabamentoChartPeriod();
  const days = aDateRange(from, to);

  const [records, metas, materiais, diasAtivos] = await Promise.all([
    window.LIDUTEC_PRODUCAO_ACABAMENTO_DATA.records({ from, to, limit: 5000 }),
    Promise.all(days.map((day) => window.LIDUTEC_PRODUCAO_ACABAMENTO_DATA.metaPecasLiberadas(linhaId, day))),
    window.LIDUTEC_PRODUCAO_ACABAMENTO_DATA.materiaisProdutos(),
    window.LIDUTEC_PRODUCAO_ACABAMENTO_DATA.diasOperacaoLinha(linhaId)
  ]);
  linha2DiasAtivosRegras = diasAtivos;
  const metaByDay = new Map(days.map((day, index) => [day, metas[index] != null ? anumber(metas[index]) : null]));

  // Só entra ferro base Nodular (o resto — Cinzento etc. — fica fora dos
  // gráficos da Linha 2, a pedido explícito).
  const produtosNodularIds = new Set(
    materiais
      .filter((item) => anormalize(item.tipo_material).includes("NODULAR"))
      .map((item) => String(item.produto_id))
  );

  // Realizado = soma de liberadas por (dia, turno), só da Linha 2 e só
  // Nodular — a meta gerencial (PECAS_LIBERADAS_PLANEJADAS) já é por turno,
  // não por dia.
  const recordsLinha2 = records.filter((record) =>
    String(record.linha_maquina_id) === String(linhaId) && produtosNodularIds.has(String(record.produto_id))
  );
  const realizadoPorDiaTurno = new Map();
  for (const record of recordsLinha2) {
    const key = `${record.data_operacional}|${record.turno}`;
    realizadoPorDiaTurno.set(key, (realizadoPorDiaTurno.get(key) || 0) + anumber(record.quantidade_liberada));
  }

  // Delta é acumulado por turno ao longo do mês, não reseta a cada dia: dia 1
  // fez 1000 a menos → -1000; dia 2 fez 1500 a menos → acumulado -2500; dia 3
  // sem meta programada e fez 3000 → acumulado sobe pra +500. Em dias que o
  // turno não opera (Noite em sex/sáb/dom) não soma nem meta nem realizado —
  // o acumulado simplesmente se mantém igual ao dia anterior.
  const bars = [];
  const acumuladoPorTurno = new Map(DELTA_LINHA2_TURNOS.map((t) => [t.codigo, { realizado: 0, meta: 0 }]));
  for (const day of days) {
    const meta = metaByDay.get(day);
    for (const turno of DELTA_LINHA2_TURNOS) {
      const ativo = linha2TurnoAtivo(day, turno.codigo);
      const acc = acumuladoPorTurno.get(turno.codigo);
      const realizadoDia = realizadoPorDiaTurno.get(`${day}|${turno.codigo}`) || 0;
      acc.realizado += realizadoDia;
      if (ativo && meta != null) acc.meta += anumber(meta);
      bars.push({
        day, turno: turno.codigo, ativo, realizadoDia,
        realizadoAcum: acc.realizado, metaAcum: acc.meta, delta: acc.realizado - acc.meta
      });
    }
  }

  return { days, metaByDay, realizadoPorDiaTurno, bars, recordsLinha2 };
}

function renderDeltaLinha2Chart(data) {
  const container = aq("#delta-linha2-chart");
  if (!container) return;
  const empty = aq("#delta-linha2-chart-empty");
  if (!data) { container.innerHTML = ""; if (empty) empty.hidden = false; return; }
  const { days, bars } = data;
  if (empty) empty.hidden = true;

  const width = Math.max(700, Math.round(container.clientWidth) || 900);
  const height = Math.max(260, Math.round(container.clientHeight) || 320);
  const margin = { top: 16, right: 16, bottom: 34, left: 64 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;

  const maxAbs = Math.max(500, ...bars.map((b) => Math.abs(b.delta)));
  const yMax = Math.ceil(maxAbs / 500) * 500;
  const zeroY = margin.top + plotHeight / 2;
  const yFor = (value) => zeroY - (value / yMax) * (plotHeight / 2);

  const groupWidth = plotWidth / days.length;
  const barWidth = Math.max(2, groupWidth / (DELTA_LINHA2_TURNOS.length + 1.4));
  const barGap = barWidth * 0.18;

  const ticks = [-yMax, -yMax / 2, 0, yMax / 2, yMax];
  const grid = ticks.map((value) => {
    const y = yFor(value);
    return `<line x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" class="delta-linha2-grid-line ${value === 0 ? "is-zero" : ""}"/>
      <text x="${margin.left - 10}" y="${y + 4}" class="delta-linha2-axis-label" text-anchor="end">${Math.round(value).toLocaleString("pt-BR")}</text>`;
  }).join("");

  const barsMarkup = days.map((day, dayIndex) => {
    const groupX = margin.left + dayIndex * groupWidth;
    const dayLabel = day.slice(8, 10);
    const bars2 = DELTA_LINHA2_TURNOS.map((turno, turnoIndex) => {
      const item = bars.find((b) => b.day === day && b.turno === turno.codigo);
      const x = groupX + (groupWidth - DELTA_LINHA2_TURNOS.length * (barWidth + barGap)) / 2 + turnoIndex * (barWidth + barGap);
      const y = Math.min(zeroY, yFor(item.delta));
      const barHeight = Math.max(1, Math.abs(yFor(item.delta) - zeroY));
      const sinal = item.delta >= 0 ? "+" : "";
      const valorLabel = `${sinal}${Math.round(item.delta).toLocaleString("pt-BR")}`;
      const labelX = x + barWidth / 2;
      const labelY = y + barHeight / 2;
      const inativoTexto = item.ativo ? "" : " (não opera esse turno nesse dia — acumulado mantido)";
      return `<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" fill="${turno.cor}" class="delta-linha2-bar linha2-clickable-bar" onclick="selectLinha2Dia('${day}','${turno.codigo}')"><title>${aDisplayDate(day)} · ${turno.label}${inativoTexto}: realizado do dia ${item.realizadoDia.toLocaleString("pt-BR")} · acumulado realizado ${item.realizadoAcum.toLocaleString("pt-BR")} · acumulado meta ${item.metaAcum.toLocaleString("pt-BR")} · delta acumulado ${sinal}${item.delta.toLocaleString("pt-BR")}</title></rect>
        <text x="${labelX}" y="${labelY}" class="delta-linha2-bar-value" text-anchor="middle" dominant-baseline="middle" transform="rotate(-90 ${labelX} ${labelY})">${valorLabel}</text>`;
    }).join("");
    return `${bars2}<text x="${groupX + groupWidth / 2}" y="${height - 10}" class="delta-linha2-axis-label" text-anchor="middle">${dayLabel}</text>`;
  }).join("");

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" preserveAspectRatio="none" aria-hidden="true">
      ${grid}
      ${barsMarkup}
    </svg>
    <div class="delta-linha2-legend">
      ${DELTA_LINHA2_TURNOS.map((turno) => `<span><i style="background:${turno.cor}"></i>${turno.label}</span>`).join("")}
    </div>`;
}

// Gráfico "Peças liberadas por dia": barra empilhada (Noite embaixo, Tarde,
// Manhã em cima) + linha do planejado diário (meta do turno × nº de turnos
// com meta vigente naquele dia).
function renderDiarioLinha2Chart(data) {
  const container = aq("#diario-linha2-chart");
  if (!container) return;
  const empty = aq("#diario-linha2-chart-empty");
  if (!data) { container.innerHTML = ""; if (empty) empty.hidden = false; return; }
  const { days, metaByDay, realizadoPorDiaTurno } = data;
  if (empty) empty.hidden = true;

  const stackOrder = [DELTA_LINHA2_TURNOS[2], DELTA_LINHA2_TURNOS[1], DELTA_LINHA2_TURNOS[0]]; // Noite, Tarde, Manhã
  const totals = days.map((day) => stackOrder.reduce((sum, t) => sum + (realizadoPorDiaTurno.get(`${day}|${t.codigo}`) || 0), 0));
  const plannedDaily = days.map((day) => {
    const meta = metaByDay.get(day);
    if (meta == null) return null;
    const turnosAtivos = DELTA_LINHA2_TURNOS.filter((t) => linha2TurnoAtivo(day, t.codigo)).length;
    return anumber(meta) * turnosAtivos;
  });

  const width = Math.max(700, Math.round(container.clientWidth) || 900);
  const height = Math.max(260, Math.round(container.clientHeight) || 320);
  const margin = { top: 30, right: 16, bottom: 34, left: 64 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;

  const maxValue = Math.max(1000, ...totals, ...plannedDaily.filter((v) => v != null));
  const yMax = Math.ceil(maxValue / 1000) * 1000;
  const yFor = (value) => margin.top + (1 - value / yMax) * plotHeight;

  const groupWidth = plotWidth / days.length;
  const barWidth = Math.max(4, groupWidth * 0.6);

  const ticks = 5;
  const grid = Array.from({ length: ticks }, (_, i) => {
    const value = (yMax / (ticks - 1)) * i;
    const y = yFor(value);
    return `<line x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" class="delta-linha2-grid-line"/>
      <text x="${margin.left - 10}" y="${y + 4}" class="delta-linha2-axis-label" text-anchor="end">${Math.round(value).toLocaleString("pt-BR")}</text>`;
  }).join("");

  const barsMarkup = days.map((day, dayIndex) => {
    const x = margin.left + dayIndex * groupWidth + (groupWidth - barWidth) / 2;
    let cursor = margin.top + plotHeight;
    const segments = stackOrder.map((turno) => {
      const valor = realizadoPorDiaTurno.get(`${day}|${turno.codigo}`) || 0;
      if (!valor) return "";
      const segHeight = Math.max(0, (valor / yMax) * plotHeight);
      cursor -= segHeight;
      return `<rect x="${x}" y="${cursor}" width="${barWidth}" height="${segHeight}" fill="${turno.cor}" class="linha2-clickable-bar" onclick="selectLinha2Dia('${day}','${turno.codigo}')"><title>${aDisplayDate(day)} · ${turno.label}: ${valor.toLocaleString("pt-BR")} pçs</title></rect>`;
    }).join("");
    const total = totals[dayIndex];
    const totalLabel = total ? `<text x="${x + barWidth / 2}" y="${cursor - 6}" class="delta-linha2-axis-label" text-anchor="middle">${total.toLocaleString("pt-BR")}</text>` : "";
    const dayLabel = day.slice(8, 10);
    return `${segments}${totalLabel}<text x="${x + barWidth / 2}" y="${height - 10}" class="delta-linha2-axis-label" text-anchor="middle">${dayLabel}</text>`;
  }).join("");

  const plannedPoints = days
    .map((day, index) => (plannedDaily[index] != null ? `${margin.left + index * groupWidth + groupWidth / 2},${yFor(plannedDaily[index])}` : null))
    .filter(Boolean);
  const plannedLine = plannedPoints.length ? `<path d="M${plannedPoints.join(" L")}" class="diario-linha2-planejado-line"/>` : "";

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" preserveAspectRatio="none" aria-hidden="true">
      ${grid}
      ${barsMarkup}
      ${plannedLine}
    </svg>
    <div class="delta-linha2-legend">
      ${stackOrder.map((turno) => `<span><i style="background:${turno.cor}"></i>${turno.label}</span>`).join("")}
      <span><i class="is-line" style="border-color:#b90e2c"></i>Planejado</span>
    </div>`;
}

// Gráfico "Planejado vs realizado acumulado": barras de atraso/adiantamento
// acumulado no mês + linhas de planejado e realizado acumulados (escala
// própria, já que os totais acumulados são bem maiores que o delta diário)
// + painel de atingimento (%) por turno no mês.
function renderAcumuladoLinha2Chart(data) {
  const container = aq("#acumulado-linha2-chart");
  const painel = aq("#acumulado-linha2-turnos");
  if (!container) return;
  const empty = aq("#acumulado-linha2-chart-empty");
  if (!data) { container.innerHTML = ""; if (painel) painel.innerHTML = ""; if (empty) empty.hidden = false; return; }
  const { days, metaByDay, realizadoPorDiaTurno } = data;
  if (empty) empty.hidden = true;

  let acumRealizado = 0, acumPlanejado = 0;
  const pontos = days.map((day) => {
    const meta = metaByDay.get(day);
    const realizadoDia = DELTA_LINHA2_TURNOS.reduce((sum, t) => sum + (realizadoPorDiaTurno.get(`${day}|${t.codigo}`) || 0), 0);
    acumRealizado += realizadoDia;
    if (meta != null) {
      const turnosAtivos = DELTA_LINHA2_TURNOS.filter((t) => linha2TurnoAtivo(day, t.codigo)).length;
      acumPlanejado += anumber(meta) * turnosAtivos;
    }
    return { day, acumRealizado, acumPlanejado, atraso: acumRealizado - acumPlanejado };
  });

  const width = Math.max(700, Math.round(container.clientWidth) || 900);
  const height = Math.max(260, Math.round(container.clientHeight) || 320);
  const margin = { top: 16, right: 60, bottom: 34, left: 64 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;

  const atrasos = pontos.map((p) => p.atraso);
  const maxAbsAtraso = Math.max(500, ...atrasos.map((v) => Math.abs(v)));
  const yMaxBar = Math.ceil(maxAbsAtraso / 500) * 500;
  const zeroY = margin.top + plotHeight / 2;
  const yForBar = (value) => zeroY - (value / yMaxBar) * (plotHeight / 2);

  const maxAcumulado = Math.max(1000, ...pontos.map((p) => Math.max(p.acumRealizado, p.acumPlanejado)));
  const yMaxLine = Math.ceil(maxAcumulado / 5000) * 5000;
  const yForLine = (value) => margin.top + (1 - value / yMaxLine) * plotHeight;

  const groupWidth = plotWidth / days.length;
  const barWidth = Math.max(4, groupWidth * 0.55);

  const ticksBar = [-yMaxBar, -yMaxBar / 2, 0, yMaxBar / 2, yMaxBar];
  const gridLeft = ticksBar.map((value) => {
    const y = yForBar(value);
    return `<line x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" class="delta-linha2-grid-line ${value === 0 ? "is-zero" : ""}"/>
      <text x="${margin.left - 10}" y="${y + 4}" class="delta-linha2-axis-label" text-anchor="end">${Math.round(value).toLocaleString("pt-BR")}</text>`;
  }).join("");
  const ticksRight = 5;
  const gridRight = Array.from({ length: ticksRight }, (_, i) => {
    const value = (yMaxLine / (ticksRight - 1)) * i;
    const y = yForLine(value);
    return `<text x="${width - margin.right + 8}" y="${y + 4}" class="delta-linha2-axis-label" text-anchor="start">${Math.round(value).toLocaleString("pt-BR")}</text>`;
  }).join("");

  const barsMarkup = pontos.map((p, index) => {
    const x = margin.left + index * groupWidth + (groupWidth - barWidth) / 2;
    const y = Math.min(zeroY, yForBar(p.atraso));
    const barHeight = Math.max(1, Math.abs(yForBar(p.atraso) - zeroY));
    const cls = p.atraso >= 0 ? "is-adiantado" : "is-atraso";
    const valorLabel = Math.abs(Math.round(p.atraso)).toLocaleString("pt-BR");
    const situacaoLabel = p.atraso >= 0 ? "adiantamento" : "atraso";
    const labelX = x + barWidth / 2;
    const labelY = p.atraso >= 0
      ? Math.max(9, y - 11)
      : Math.min(height - 23, y + barHeight + 11);
    return `<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" class="acumulado-linha2-bar ${cls} linha2-clickable-bar" onclick="selectLinha2Dia('${p.day}',null)"><title>${aDisplayDate(p.day)}: ${situacaoLabel} acumulado ${valorLabel} pçs</title></rect>
      <text x="${labelX}" y="${labelY}" class="acumulado-linha2-bar-value" text-anchor="middle" dominant-baseline="middle">${valorLabel}</text>`;
  }).join("");

  const dayLabels = days.map((day, index) =>
    `<text x="${margin.left + index * groupWidth + groupWidth / 2}" y="${height - 10}" class="delta-linha2-axis-label" text-anchor="middle">${day.slice(8, 10)}</text>`
  ).join("");

  const lineFor = (key) => pontos.map((p, index) => `${margin.left + index * groupWidth + groupWidth / 2},${yForLine(p[key])}`).join(" L");
  const planejadoLine = `<path d="M${lineFor("acumPlanejado")}" class="acumulado-linha2-planejado-line"/>`;
  const realLine = `<path d="M${lineFor("acumRealizado")}" class="acumulado-linha2-real-line"/>`;

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" preserveAspectRatio="none" aria-hidden="true">
      ${gridLeft}
      ${gridRight}
      ${barsMarkup}
      ${planejadoLine}
      ${realLine}
      ${dayLabels}
    </svg>
    <div class="delta-linha2-legend">
      <span><i style="background:#ef233c"></i>Atraso acumulado (pçs)</span>
      <span><i style="background:#00b84a"></i>Adiantamento acumulado (pçs)</span>
      <span><i class="is-line" style="border-color:#b90e2c"></i>Planejado acumulado</span>
      <span><i class="is-line" style="border-color:#218c4b"></i>Real acumulado</span>
    </div>`;

  if (painel) {
    painel.innerHTML = DELTA_LINHA2_TURNOS.map((turno) => {
      let realizadoTurno = 0, planejadoTurno = 0;
      for (const day of days) {
        if (!linha2TurnoAtivo(day, turno.codigo)) continue;
        realizadoTurno += realizadoPorDiaTurno.get(`${day}|${turno.codigo}`) || 0;
        const meta = metaByDay.get(day);
        if (meta != null) planejadoTurno += anumber(meta);
      }
      const percent = planejadoTurno > 0 ? (realizadoTurno / planejadoTurno) * 100 : null;
      const percentClass = percent == null ? "" : percent >= 100 ? "is-good" : percent >= 80 ? "is-warn" : "is-bad";
      return `<div class="acumulado-linha2-turno-card" style="--turno-cor:${turno.cor}">
        <strong>${turno.label}</strong>
        <span class="acumulado-linha2-turno-percent ${percentClass}">${percent == null ? "—" : `${percent.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%`}</span>
        <small>${realizadoTurno.toLocaleString("pt-BR")} / ${planejadoTurno.toLocaleString("pt-BR")} pçs</small>
      </div>`;
    }).join("");
  }
}

// Estado da tabela de peças liberadas — guarda os dados já carregados dos
// gráficos (evita nova consulta) e o dia/turno selecionado ao clicar numa
// barra, tipo drill-down do Power BI.
let linha2ChartsData = null;
let linha2TableFilter = null; // { day, turno } | null

function selectLinha2Dia(day, turno) {
  linha2TableFilter = { day, turno: turno || null };
  renderLinha2RecordsTable();
  aq("#linha2-records-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
}
function clearLinha2Filter() {
  linha2TableFilter = null;
  renderLinha2RecordsTable();
}

function renderLinha2RecordsTable() {
  const thead = aq("#linha2-records-thead");
  const tbody = aq("#linha2-records-rows");
  const empty = aq("#linha2-records-empty");
  const chip = aq("#linha2-table-filter-chip");
  if (!thead || !tbody) return;
  if (!linha2ChartsData) { thead.innerHTML = ""; tbody.innerHTML = ""; if (empty) empty.hidden = false; return; }

  if (!linha2TableFilter) {
    if (chip) chip.hidden = true;
    thead.innerHTML = `<tr><th>Data</th><th>Manhã</th><th>Tarde</th><th>Noite</th><th>Total</th></tr>`;
    const rows = linha2ChartsData.days.map((day) => {
      const manha = linha2ChartsData.realizadoPorDiaTurno.get(`${day}|MANHA`) || 0;
      const tarde = linha2ChartsData.realizadoPorDiaTurno.get(`${day}|TARDE`) || 0;
      const noite = linha2ChartsData.realizadoPorDiaTurno.get(`${day}|NOITE`) || 0;
      const total = manha + tarde + noite;
      return `<tr class="linha2-table-row" onclick="selectLinha2Dia('${day}', null)">
        <td>${aDisplayDate(day)}</td><td>${manha.toLocaleString("pt-BR")}</td><td>${tarde.toLocaleString("pt-BR")}</td><td>${noite.toLocaleString("pt-BR")}</td><td><strong>${total.toLocaleString("pt-BR")}</strong></td>
      </tr>`;
    });
    tbody.innerHTML = rows.join("");
    if (empty) empty.hidden = rows.length > 0;
    return;
  }

  const { day, turno } = linha2TableFilter;
  const turnoLabel = turno ? DELTA_LINHA2_TURNOS.find((t) => t.codigo === turno)?.label : null;
  if (chip) {
    chip.hidden = false;
    chip.innerHTML = `<span>Detalhe de ${aDisplayDate(day)}${turnoLabel ? ` · ${turnoLabel}` : ""}</span><button type="button" onclick="clearLinha2Filter()">Ver todos os dias</button>`;
  }

  thead.innerHTML = `<tr><th>Turno</th><th>Produto</th><th>Liberadas</th><th>Rejeitadas</th><th>Retrabalhadas</th><th>Refugadas</th></tr>`;
  const rows = (linha2ChartsData.recordsLinha2 || [])
    .filter((r) => r.data_operacional === day && (!turno || r.turno === turno))
    .sort((a, b) => a.turno.localeCompare(b.turno) || (a.produtos?.codigo || "").localeCompare(b.produtos?.codigo || ""));
  tbody.innerHTML = rows.map((r) => {
    const turnoInfo = DELTA_LINHA2_TURNOS.find((t) => t.codigo === r.turno);
    return `<tr>
      <td>${aesc(turnoInfo?.label || r.turno)}</td>
      <td>${aesc(r.produtos?.codigo || "—")} — ${aesc(r.produtos?.nome || "")}</td>
      <td>${anumber(r.quantidade_liberada).toLocaleString("pt-BR")}</td>
      <td>${anumber(r.quantidade_rejeitada).toLocaleString("pt-BR")}</td>
      <td>${anumber(r.quantidade_retrabalhada).toLocaleString("pt-BR")}</td>
      <td>${anumber(r.quantidade_refugada).toLocaleString("pt-BR")}</td>
    </tr>`;
  }).join("");
  if (empty) empty.hidden = rows.length > 0;
}

async function renderLinha2IndicatorCharts() {
  const data = await loadLinha2IndicatorData();
  linha2ChartsData = data;
  linha2TableFilter = null;
  renderAcumuladoLinha2Chart(data);
  renderDiarioLinha2Chart(data);
  renderDeltaLinha2Chart(data);
  renderLinha2RecordsTable();
}

async function reloadAcabamentoChartsMonth() {
  const input = aq("#charts-month");
  const loading = aq("#production-loading");
  if (!input?.value) return;
  acabamentoChartsMonth = input.value;
  input.disabled = true;
  if (loading) { loading.textContent = "Carregando indicadores..."; loading.hidden = false; }
  try {
    await loadAcabamentoData();
    renderAcabamentoCharts();
    await renderLinha2IndicatorCharts();
  } finally {
    input.disabled = false;
    if (loading) loading.hidden = true;
  }
}

async function initializeAcabamentoProduction() {
  const user = await window.LIDUTEC_APP.requireAuthenticatedUser();
  if (!user) return;
  const [profile, permissions] = await Promise.all([
    window.LIDUTEC_APP.getCurrentUserProfile(user.id),
    window.LIDUTEC_APP.getUserPermissions(user.id)
  ]);
  if (!profile || profile.status !== "ATIVO") { alert("Seu usuário não possui acesso ativo."); await window.LIDUTEC_APP.signOut(); return; }
  if (!permissions.has("producao_acabamento.visualizar")) { location.replace("../dashboard.html"); return; }
  acabamentoState.user = user;
  acabamentoState.permissions = permissions;
  window.LIDUTEC_APP.applyPermissionVisibility(permissions);
  aq("#user-name").textContent = profile.nome;
  aq("#user-profile").textContent = profile.perfil || "Usuário";
  aq("#user-avatar").textContent = profile.nome.slice(0, 1).toUpperCase();

  if (acabamentoPage === "charts") {
    const today = window.LIDUTEC_TURNOS.determineShift().dataOperacional;
    acabamentoChartsMonth = today.slice(0, 7);
    const input = aq("#charts-month");
    if (input) { input.value = acabamentoChartsMonth; input.max = acabamentoChartsMonth; }
  }

  await loadAcabamentoSupport();
  if (acabamentoPage !== "entry") await loadAcabamentoData();
  aq("#production-loading")?.setAttribute("hidden", "");

  if (acabamentoPage === "dashboard") renderAcabamentoDashboard();
  if (acabamentoPage === "stops") {
    renderAcabamentoStops();
    let filterTimer;
    aq("#stop-query-filters")?.addEventListener("input", () => {
      clearTimeout(filterTimer);
      filterTimer = setTimeout(() => reloadAcabamentoStops().catch((error) => acabamentoMessage(error.message, "error")), 300);
    });
    aq(".stop-query-table")?.addEventListener("click", (event) => {
      const button = event.target.closest(".table-sort");
      if (!button) return;
      const same = acabamentoState.stopSort.key === button.dataset.sort;
      acabamentoState.stopSort = { key: button.dataset.sort, direction: same && acabamentoState.stopSort.direction === "asc" ? "desc" : "asc" };
      renderAcabamentoStops();
    });
    aq("#stop-export-button")?.addEventListener("click", exportVisibleAcabamentoStops);
  }
  if (acabamentoPage === "charts") {
    renderAcabamentoCharts();
    await renderLinha2IndicatorCharts();
    aq("#charts-month")?.addEventListener("change", () => reloadAcabamentoChartsMonth().catch((error) => acabamentoMessage(error.message, "error")));
  }
  if (acabamentoPage === "entry") {
    if (!permissions.has("producao_acabamento.lancar")) throw new Error("Usuário sem permissão para lançar produção de acabamento.");
    await initializeShiftEntry();
  }
}

aq("#menu-button")?.addEventListener("click", () => aq("#sidebar").classList.toggle("open"));
aq("#logout-button")?.addEventListener("click", () => window.LIDUTEC_APP.signOut());
initializeAcabamentoProduction().catch((error) => {
  console.error(error);
  const loading = aq("#production-loading");
  if (loading) loading.textContent = `Erro: ${error.message}`;
});
