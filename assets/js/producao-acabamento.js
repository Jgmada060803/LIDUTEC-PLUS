const acabamentoPage = document.body.dataset.productionPage;
const acabamentoState = {
  user: null,
  permissions: new Set(),
  products: [],
  lines: [],
  categories: [],
  sectors: [],
  cycleTimeByProduct: new Map(),
  records: [],
  stops: [],
  currentShift: null,
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

async function loadAcabamentoSupport() {
  const { products, lines, categories, sectors } = await window.LIDUTEC_PRODUCAO_ACABAMENTO_DATA.support();
  acabamentoState.products = products;
  acabamentoState.lines = lines;
  acabamentoState.categories = categories;
  acabamentoState.sectors = sectors;
  const cycleTimes = await window.LIDUTEC_PRODUCAO_ACABAMENTO_DATA.cycleTimes(products.map((p) => p.id));
  acabamentoState.cycleTimeByProduct = new Map(cycleTimes.map((item) => [String(item.produto_id), item.tempo_ciclo_segundos]));
  for (const select of document.querySelectorAll("[data-products]")) {
    select.insertAdjacentHTML("beforeend", products.map((p) => `<option value="${p.id}">${aesc(p.codigo)} — ${aesc(p.nome)}</option>`).join(""));
  }
  for (const select of document.querySelectorAll("[data-lines]")) {
    select.insertAdjacentHTML("beforeend", lines.map((l) => `<option value="${l.id}">${aesc(l.nome)}</option>`).join(""));
  }
  for (const select of document.querySelectorAll("[data-categories]")) {
    select.insertAdjacentHTML("beforeend", categories.map((c) => `<option value="${c.id}">${aesc(c.nome)}</option>`).join(""));
  }
  for (const select of document.querySelectorAll("[data-sectors]")) {
    select.insertAdjacentHTML("beforeend", sectors.map((s) => `<option value="${s.id}">${aesc(s.nome)}</option>`).join(""));
  }
}

// ---------------------------------------------------------------------------
// Apontamento do turno (tela "entry")
// ---------------------------------------------------------------------------
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
  aq("#production-entry-rows").replaceChildren(productionRow());
  aq("#stop-entry-rows").replaceChildren(stopRow());
}
function shiftDraftKey() {
  const form = aq("#shift-entry-form");
  const date = form?.elements.data_operacional.value || "sem-data";
  const shift = form?.elements.turno.value || "sem-turno";
  const linha = form?.elements.linha_maquina_id.value || "sem-linha";
  return `lidutec:producao-acabamento:rascunho:${acabamentoState.user?.id || "anonimo"}:${date}:${shift}:${linha}`;
}
function populateShiftRows(productions, stops) {
  aq("#production-entry-rows").replaceChildren();
  aq("#stop-entry-rows").replaceChildren();
  for (const item of productions.length ? productions : [{}]) {
    const row = productionRow();
    applyRowValues(row, {
      produto_id: item.produto_id ?? "",
      quantidade_liberada: item.quantidade_liberada ?? 0,
      quantidade_rejeitada: item.quantidade_rejeitada ?? 0,
      quantidade_retrabalhada: item.quantidade_retrabalhada ?? 0,
      quantidade_refugada: item.quantidade_refugada ?? 0
    });
    appendEntryRow("#production-entry-rows", row);
  }
  const toTimeInput = (value) => {
    if (!value) return "";
    const date = new Date(value);
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };
  for (const item of stops.length ? stops : [{}]) {
    const row = stopRow();
    applyRowValues(row, {
      inicio: toTimeInput(item.inicio),
      fim: toTimeInput(item.fim),
      setor_id: item.setor_origem_id ?? item.setor_id ?? "",
      categoria_id: item.categoria_id ?? "",
      observacao: item.observacao ?? ""
    });
    appendEntryRow("#stop-entry-rows", row);
    try { updateStopRow(row); } catch { /* horário incompleto no carregamento inicial */ }
  }
}
function serializeShift() {
  const productions = [...document.querySelectorAll(".shift-production-row")]
    .filter((row) => row.querySelector('[name="produto_id"]').value)
    .map((row) => ({
      produto_id: anumber(row.querySelector('[name="produto_id"]').value),
      quantidade_liberada: anumber(row.querySelector('[name="quantidade_liberada"]').value),
      quantidade_rejeitada: anumber(row.querySelector('[name="quantidade_rejeitada"]').value),
      quantidade_retrabalhada: anumber(row.querySelector('[name="quantidade_retrabalhada"]').value),
      quantidade_refugada: anumber(row.querySelector('[name="quantidade_refugada"]').value)
    }));
  if (!productions.length) throw new Error("Informe ao menos um produto.");

  const form = aq("#shift-entry-form");
  const stops = [...document.querySelectorAll(".shift-stop-row")]
    .filter((row) => ["inicio", "fim", "setor_id", "categoria_id"].some((name) => row.querySelector(`[name="${name}"]`)?.value))
    .map((row) => {
      const value = (name) => row.querySelector(`[name="${name}"]`).value;
      if (!value("inicio") || !value("fim") || !value("setor_id") || !value("categoria_id")) {
        throw new Error("Preencha início, fim, setor e motivo em todas as paradas.");
      }
      const start = resolveShiftTime(value("inicio"));
      const end = resolveShiftTime(value("fim"));
      if (!start || !end) throw new Error("Os horários da parada devem estar dentro do turno selecionado.");
      if (!window.LIDUTEC_TURNOS.intervalWithinShift(form.elements.data_operacional.value, form.elements.turno.value, start.toISOString(), end.toISOString())) {
        throw new Error("A parada deve estar dentro do turno selecionado.");
      }
      return { inicio: start.toISOString(), fim: end.toISOString(), setor_id: anumber(value("setor_id")), categoria_id: anumber(value("categoria_id")), observacao: value("observacao") };
    });
  return { productions, stops };
}

function saveShiftDraft() {
  const form = aq("#shift-entry-form");
  if (!form || !acabamentoState.user || acabamentoState.currentShift?.status === "FECHADO" || acabamentoState.editingClosed) return;
  const draft = {
    savedAt: Date.now(),
    data_operacional: form.elements.data_operacional.value,
    turno: form.elements.turno.value,
    linha_maquina_id: form.elements.linha_maquina_id.value,
    operadores_presentes: form.elements.operadores_presentes.value,
    productions: [...document.querySelectorAll(".shift-production-row")].map(rowValues),
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
    const saved = await window.LIDUTEC_PRODUCAO_ACABAMENTO_DATA.saveShiftDraft({
      p_data_operacional: draft.data_operacional,
      p_turno: draft.turno,
      p_linha_maquina_id: anumber(draft.linha_maquina_id),
      p_operadores_presentes: draft.operadores_presentes ? anumber(draft.operadores_presentes) : null,
      p_producoes: draft.productions,
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
  if (draft.operadores_presentes) form.elements.operadores_presentes.value = draft.operadores_presentes;
  populateShiftRows(draft.productions || [], draft.stops || []);
  return true;
}
function populateSharedDraft(productions = [], stops = [], operadoresPresentes = null) {
  const form = aq("#shift-entry-form");
  if (operadoresPresentes != null) form.elements.operadores_presentes.value = operadoresPresentes;
  populateShiftRows(productions, stops);
}

async function updatePlannedOperators() {
  const form = aq("#shift-entry-form");
  const date = form.elements.data_operacional.value;
  const turno = form.elements.turno.value;
  const linhaId = form.elements.linha_maquina_id.value;
  const hint = aq("#operadores-planejados-hint");
  if (!date || !turno || !linhaId) { hint.textContent = ""; return; }
  try {
    const planned = await window.LIDUTEC_PRODUCAO_ACABAMENTO_DATA.plannedOperators(anumber(linhaId), turno, date);
    hint.textContent = planned != null ? `Planejado: ${planned} operadores` : "Sem meta cadastrada para este turno/linha.";
  } catch (error) {
    hint.textContent = "";
  }
}

async function checkShiftStatus() {
  const form = aq("#shift-entry-form");
  const date = form.elements.data_operacional.value;
  const turno = form.elements.turno.value;
  const linhaId = form.elements.linha_maquina_id.value;
  if (!date || !turno || !linhaId) return;
  const requestId = ++acabamentoState.statusRequestId;
  await updatePlannedOperators();
  const data = await window.LIDUTEC_PRODUCAO_ACABAMENTO_DATA.shift(date, turno, anumber(linhaId));
  if (requestId !== acabamentoState.statusRequestId) return;
  const previousVersion = acabamentoState.currentShift?.versao ?? -1;
  const previousKey = acabamentoState.currentShift ? `${acabamentoState.currentShift.data_operacional}|${acabamentoState.currentShift.turno}|${acabamentoState.currentShift.linha_maquina_id}` : "";
  acabamentoState.currentShift = data ? { ...data, data_operacional: date, turno } : null;
  acabamentoState.editingClosed = false;
  const closed = data?.status === "FECHADO";

  if (closed) {
    const [productions, stops] = await Promise.all([
      window.LIDUTEC_PRODUCAO_ACABAMENTO_DATA.shiftProductions(data.id),
      window.LIDUTEC_PRODUCAO_ACABAMENTO_DATA.shiftStops(data.id)
    ]);
    if (requestId !== acabamentoState.statusRequestId) return;
    acabamentoState.originalShiftData = { productions, stops, operadores_presentes: data.operadores_presentes };
    populateShiftRows(productions, stops);
    form.elements.operadores_presentes.value = data.operadores_presentes ?? "";
  } else {
    acabamentoState.originalShiftData = null;
    const key = `${date}|${turno}|${linhaId}`;
    const hasNewSharedDraft = data && (previousKey !== key || Number(data.versao) > Number(previousVersion));
    if (hasNewSharedDraft && !acabamentoState.draftSaveInFlight) {
      populateSharedDraft(data.rascunho_producoes || [], data.rascunho_paradas || [], data.operadores_presentes);
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
  for (const control of form.querySelectorAll("tbody input,tbody select,tbody button,#add-production-row,#add-stop-row,[name=\"operadores_presentes\"]")) {
    control.disabled = closed;
  }
  if (data?.id && closed) await loadShiftHistory(data.id); else aq("#shift-edit-history").hidden = true;
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
  for (const control of form.querySelectorAll("tbody input,tbody select,tbody button,#add-production-row,#add-stop-row,[name=\"operadores_presentes\"]")) control.disabled = false;
  aq("#edit-shift-button").hidden = true;
  aq("#delete-shift-button").hidden = true;
  aq("#close-shift-button").hidden = false;
  aq("#close-shift-button").disabled = false;
  aq("#close-shift-button").textContent = "Salvar alterações";
  aq("#shift-status").textContent = "Editando turno fechado";
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
  const form = event.currentTarget;
  const button = aq("#close-shift-button");
  button.disabled = true;
  try {
    const { productions, stops } = serializeShift();
    const operadoresPresentes = anumber(form.elements.operadores_presentes.value);
    if (acabamentoState.editingClosed) {
      await window.LIDUTEC_PRODUCAO_ACABAMENTO_DATA.editShift({
        p_turno_id: acabamentoState.currentShift.id,
        p_operadores_presentes: operadoresPresentes,
        p_producoes: productions,
        p_paradas: stops
      });
      localStorage.removeItem(shiftDraftKey());
      resetShiftEntryRows();
      acabamentoMessage("Alterações do turno salvas com sucesso.");
      await checkShiftStatus();
      return;
    }
    await window.LIDUTEC_PRODUCAO_ACABAMENTO_DATA.closeShift({
      p_data_operacional: form.elements.data_operacional.value,
      p_turno: form.elements.turno.value,
      p_linha_maquina_id: anumber(form.elements.linha_maquina_id.value),
      p_operadores_presentes: operadoresPresentes,
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
  if (!restoreShiftDraft()) resetShiftEntryRows();

  aq("#add-production-row").addEventListener("click", () => { appendEntryRow("#production-entry-rows", productionRow()); saveShiftDraft(); });
  aq("#add-stop-row").addEventListener("click", () => { appendEntryRow("#stop-entry-rows", stopRow()); saveShiftDraft(); });
  form.addEventListener("input", (event) => {
    const stop = event.target.closest(".shift-stop-row");
    if (stop) {
      try { updateStopRow(stop); acabamentoClearMessage("stop-time"); }
      catch (error) { acabamentoMessage(error.message, "error", "stop-time"); }
    }
    saveShiftDraft();
  });
  form.addEventListener("click", (event) => {
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
  });
  const refreshContext = () => checkShiftStatus().catch((error) => acabamentoMessage(error.message, "error"));
  form.elements.data_operacional.addEventListener("change", refreshContext);
  form.elements.turno.addEventListener("change", refreshContext);
  form.elements.linha_maquina_id.addEventListener("change", refreshContext);
  form.elements.operadores_presentes.addEventListener("input", saveShiftDraft);
  form.addEventListener("submit", closeShift);
  await checkShiftStatus();
  form.hidden = false;

  window.supabaseClient.channel("shared-production-shift-acabamento").on("postgres_changes", { event: "*", schema: "public", table: "turnos_producao_acabamento" }, (payload) => {
    const row = payload.new;
    if (!document.hidden && row && row.data_operacional === form.elements.data_operacional.value && row.turno === form.elements.turno.value &&
      String(row.linha_maquina_id) === form.elements.linha_maquina_id.value && String(row.atualizado_por) !== String(acabamentoState.user?.id)) {
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
    acabamentoState.todayShifts = shifts;
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
    const [records, stops, shifts] = await Promise.all([
      window.LIDUTEC_PRODUCAO_ACABAMENTO_DATA.records({ from, to: today, limit: 5000 }),
      window.LIDUTEC_PRODUCAO_ACABAMENTO_DATA.stops({ from, to: today, limit: 5000 }),
      window.LIDUTEC_PRODUCAO_ACABAMENTO_DATA.shiftsInRange(from, today)
    ]);
    acabamentoState.records = records;
    acabamentoState.stops = stops;
    acabamentoState.todayShifts = shifts;
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
  const shifts = acabamentoState.todayShifts || [];
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

function renderAcabamentoCharts() {
  const totals = productionTotals(acabamentoState.records);
  const stopMinutes = acabamentoState.stops.reduce((sum, x) => sum + anumber(x.duracao_minutos), 0);
  const shifts = acabamentoState.todayShifts || [];
  const planejados = shifts.reduce((sum, s) => sum + anumber(s.operadores_planejados), 0);
  const presentes = shifts.reduce((sum, s) => sum + anumber(s.operadores_presentes), 0);
  const minutosTurno = shifts.reduce((sum, s) => sum + (window.LIDUTEC_TURNOS.shifts[s.turno]?.minutos || 0), 0);

  const disponibilidade = window.LIDUTEC_TURNOS.calcularDisponibilidade({
    minutosTurno,
    operadoresPlanejados: planejados,
    operadoresPresentes: presentes,
    minutosParada: stopMinutes
  });
  const tempoCicloMedio = acabamentoState.records.length
    ? acabamentoState.records.reduce((sum, item) => sum + (cycleTimeFor(item.produto_id) || 0), 0) / acabamentoState.records.length
    : 0;
  const tempoTeorico = window.LIDUTEC_TURNOS.calcularTempoTeorico({
    pecasLiberadas: totals.liberadas, pecasRefugadas: totals.refugadas, tempoCicloSegundos: tempoCicloMedio
  });
  const tempoDisponivel = window.LIDUTEC_TURNOS.minutosDisponiveisProducao({
    minutosTurno, operadoresPlanejados: planejados, operadoresPresentes: presentes, minutosParada: stopMinutes
  });
  const eficiencia = window.LIDUTEC_TURNOS.calcularEficiencia({ tempoTeoricoMinutos: tempoTeorico, tempoDisponivelMinutos: tempoDisponivel });
  const qualidade = window.LIDUTEC_TURNOS.calcularQualidade({ pecasLiberadas: totals.liberadas, pecasRefugadas: totals.refugadas });
  const oee = window.LIDUTEC_TURNOS.calcularOEE({ disponibilidade, eficiencia, qualidade });

  renderGauge("#gauge-disponibilidade", disponibilidade, "Disponibilidade");
  renderGauge("#gauge-eficiencia", eficiencia, "Eficiência");
  renderGauge("#gauge-qualidade", qualidade, "Qualidade");
  renderGauge("#gauge-oee", oee, "OEE");
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
