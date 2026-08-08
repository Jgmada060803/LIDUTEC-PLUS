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
  draftSaveTimer: null,
  draftSaveInFlight: false
};

const aq = (selector) => document.querySelector(selector);
const aesc = (value = "") => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const anumber = (value) => Number(value || 0);
const aFormatDateTime = (value) => (value ? new Date(value).toLocaleString("pt-BR") : "—");
const aFormatMinutes = (value) => `${Math.floor(anumber(value) / 60)}h ${String(anumber(value) % 60).padStart(2, "0")}min`;
const aDisplayDate = (value) => (value ? new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR") : "—");
const aIsoDate = (date) => date.toISOString().slice(0, 10);
const aDaysBefore = (date, days) => { const value = new Date(`${date}T12:00:00`); value.setDate(value.getDate() - days); return aIsoDate(value); };

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
  const productOptions = acabamentoState.products.map((p) => `<option value="${p.id}">${aesc(p.codigo)} — ${aesc(p.nome)}</option>`).join("");
  row.innerHTML = `
    <td><select name="produto_id"><option value="">Selecione</option>${productOptions}</select></td>
    <td><input name="quantidade_liberada" type="number" min="0" step="1" value="0"></td>
    <td><input name="quantidade_rejeitada" type="number" min="0" step="1" value="0"></td>
    <td><input name="quantidade_retrabalhada" type="number" min="0" step="1" value="0"></td>
    <td><input name="quantidade_refugada" type="number" min="0" step="1" value="0"></td>
    <td><button type="button" class="row-remove" aria-label="Remover linha">×</button></td>`;
  return row;
}
function stopRow() {
  const row = document.createElement("tr");
  row.className = "shift-stop-row";
  const sectorOptions = acabamentoState.sectors.map((s) => `<option value="${s.id}">${aesc(s.nome)}</option>`).join("");
  const categoryOptions = acabamentoState.categories.map((c) => `<option value="${c.id}">${aesc(c.nome)}</option>`).join("");
  row.innerHTML = `
    <td><input name="inicio" type="time" step="60"></td>
    <td><input name="fim" type="time" step="60"></td>
    <td><output data-duration>0h 00min</output></td>
    <td><select name="posto_id"><option value="">Selecione</option>${postoOptionsHtml()}</select></td>
    <td><select name="setor_id"><option value="">Selecione</option>${sectorOptions}</select></td>
    <td><select name="categoria_id"><option value="">Selecione</option>${categoryOptions}</select></td>
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
}
function resolveShiftTime(value) {
  const form = aq("#shift-entry-form");
  return window.LIDUTEC_TURNOS.resolveShiftTime(form?.elements.data_operacional.value, form?.elements.turno.value, value);
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
    if (overlapEnd > overlapStart) overlaps.push([overlapStart, overlapEnd]);
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
  const paradas = stoppedOverlapsForPosto(posto.id, bounds).map(([start, end]) => ({ start: new Date(start), end: new Date(end) }));
  return [
    ...planejados.map((interval) => spanFor(interval, "acabamento-equip-planned", "Parada programada")),
    ...paradas.map((interval) => spanFor(interval, "acabamento-equip-stop"))
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
function updateStopRow(row) {
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
}
function appendEntryRow(target, row) {
  aq(target).append(row);
}
function resetShiftEntryRows() {
  aq("#production-entry-rows-l1").replaceChildren(productionRow());
  aq("#production-entry-rows-l2").replaceChildren(productionRow());
  aq("#stop-entry-rows").replaceChildren(stopRow());
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
  }
  lockAutoAbsenteeismoRows();
}
function serializeProductionSection(target, linhaId) {
  return [...document.querySelectorAll(`${target} .shift-production-row`)]
    .filter((row) => row.querySelector('[name="produto_id"]').value)
    .map((row) => ({
      linha_id: linhaId,
      produto_id: anumber(row.querySelector('[name="produto_id"]').value),
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
      if (!window.LIDUTEC_TURNOS.intervalWithinShift(form.elements.data_operacional.value, form.elements.turno.value, start.toISOString(), end.toISOString())) {
        throw new Error("A parada deve estar dentro do turno selecionado.");
      }
      return { inicio: start.toISOString(), fim: end.toISOString(), posto_id: anumber(value("posto_id")), setor_id: anumber(value("setor_id")), categoria_id: anumber(value("categoria_id")), observacao: value("observacao") };
    });
  return { productions, linhas, stops };
}

function saveShiftDraft() {
  const form = aq("#shift-entry-form");
  if (!form || !acabamentoState.user || acabamentoState.currentShift?.status === "FECHADO" || acabamentoState.editingClosed) return;
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
  if (previous != null && value != null && value > previous) {
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
    const shiftInfo = window.LIDUTEC_TURNOS.shifts[form.elements.turno.value];
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
  if (acabamentoState.linha2Ativa) {
    label.textContent = "Linha 2";
    operatorsField.hidden = false;
  } else {
    label.textContent = "Linha 2 — Produção extraordinária (opcional)";
    operatorsField.hidden = true;
  }
}

async function checkShiftStatus() {
  const form = aq("#shift-entry-form");
  const date = form.elements.data_operacional.value;
  const turno = form.elements.turno.value;
  if (!date || !turno) return;
  acabamentoState.absenteeismCollapsed = { l1: false, l2: false };
  cancelAbsenteeismAutoHide("l1");
  cancelAbsenteeismAutoHide("l2");
  const requestId = ++acabamentoState.statusRequestId;
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
  aq("#close-shift-button").textContent = "Fechar turno";
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
  const shift = window.LIDUTEC_TURNOS.determineShift();
  form.elements.data_operacional.value = shift.dataOperacional;
  form.elements.turno.value = shift.codigo;
}

async function initializeShiftEntry() {
  const form = aq("#shift-entry-form");
  applyCurrentShiftDefaults(form);
  resetShiftEntryRows();

  aq("#add-production-row-l1").addEventListener("click", () => { appendEntryRow("#production-entry-rows-l1", productionRow()); saveShiftDraft(); });
  aq("#add-production-row-l2").addEventListener("click", () => { appendEntryRow("#production-entry-rows-l2", productionRow()); saveShiftDraft(); });
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
  form.hidden = false;

  window.supabaseClient.channel("shared-production-shift-acabamento").on("postgres_changes", { event: "*", schema: "public", table: "turnos_producao_acabamento" }, (payload) => {
    const row = payload.new;
    if (!document.hidden && row && row.data_operacional === form.elements.data_operacional.value && row.turno === form.elements.turno.value &&
      String(row.atualizado_por) !== String(acabamentoState.user?.id)) {
      refreshContext();
    }
  }).subscribe();
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
    const from = aDaysBefore(today, 30);
    const [records, stops, shifts, scheduledStops] = await Promise.all([
      window.LIDUTEC_PRODUCAO_ACABAMENTO_DATA.records({ from, to: today, limit: 5000 }),
      window.LIDUTEC_PRODUCAO_ACABAMENTO_DATA.stops({ from, to: today, limit: 5000 }),
      window.LIDUTEC_PRODUCAO_ACABAMENTO_DATA.shiftsInRange(from, today),
      window.LIDUTEC_PRODUCAO_ACABAMENTO_DATA.scheduledStops(from, today)
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
  const stopMinutes = stops.reduce((sum, x) => sum + anumber(x.duracao_minutos), 0);
  const shifts = acabamentoState.periodShifts || [];
  const planejados = shifts.reduce((sum, s) => sum + anumber(s.operadores_planejados), 0);
  const presentes = shifts.reduce((sum, s) => sum + anumber(s.operadores_presentes), 0);
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

function renderAcabamentoStops() {
  const body = aq("#stop-records");
  if (!body) return;
  body.innerHTML = acabamentoState.stops.map((x) => `<tr>
      <td>${aDisplayDate(x.data_operacional)}</td>
      <td>${aesc(x.turno)}</td>
      <td>${aFormatDateTime(x.inicio)}</td>
      <td>${aFormatDateTime(x.fim)}</td>
      <td>${aFormatMinutes(x.duracao_minutos)}</td>
      <td>${aesc(x.postos_equipamentos_acabamento?.nome || "—")}</td>
      <td>${aesc(x.setores_responsaveis_parada?.nome || "—")}</td>
      <td>${aesc(x.categorias_parada_producao?.nome || "—")}</td>
      <td>${aesc(x.observacao || "—")}</td>
    </tr>`).join("");
  const empty = aq("#stop-records-empty");
  if (empty) empty.hidden = acabamentoState.stops.length > 0;
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
      lista.push({ ...stop, duracao_minutos: Math.max(0, anumber(stop.duracao_minutos) - overlapProgramado) });
      stopsPorTurnoLinha.set(key, lista);
    } else {
      // Mesma lógica: tempo do equipamento avulso parado numa janela programada
      // (refeição, manutenção preventiva etc.) não reduz a taxa de utilização dele.
      const overlapProgramado = paradaProgramadaOverlapMinutos(stop, { equipamentoCodigo: posto.codigo });
      const lista = stopsPorEquipamento.get(posto.id) || [];
      lista.push({ ...stop, duracao_minutos: Math.max(0, anumber(stop.duracao_minutos) - overlapProgramado) });
      stopsPorEquipamento.set(posto.id, lista);
    }
  }

  let totalMinutosTurno = 0;
  let totalDisponibilidadePonderada = 0;
  for (const shift of shifts) {
    const turno = shift.turnos_producao_acabamento?.turno;
    const minutosTurno = window.LIDUTEC_TURNOS.shifts[turno]?.minutos || 0;
    if (!minutosTurno) continue;
    const numeroPostos = postoPorLinha.get(shift.linha_maquina_id) || 1;
    const minutosParada = (stopsPorTurnoLinha.get(`${shift.turno_producao_id}|${shift.linha_maquina_id}`) || []).reduce((sum, x) => sum + anumber(x.duracao_minutos), 0);
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
      const minutosParada = (stopsPorEquipamento.get(equipamento.id) || []).reduce((sum, x) => sum + anumber(x.duracao_minutos), 0);
      const taxa = window.LIDUTEC_TURNOS.calcularTaxaEquipamento({ minutosPeriodo: totalMinutosTurno, minutosParada });
      return `<div class="equipamento-avulso-card"><strong>${aesc(equipamento.nome)}</strong><span>${(taxa * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</span><small>${aFormatMinutes(minutosParada)} parado</small></div>`;
    }).join("");
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

  await loadAcabamentoSupport();
  if (acabamentoPage !== "entry") await loadAcabamentoData();
  aq("#production-loading")?.setAttribute("hidden", "");

  if (acabamentoPage === "dashboard") renderAcabamentoDashboard();
  if (acabamentoPage === "stops") renderAcabamentoStops();
  if (acabamentoPage === "charts") renderAcabamentoCharts();
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
