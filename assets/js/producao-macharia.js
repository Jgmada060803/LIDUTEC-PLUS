const machariaPage = document.body.dataset.productionPage;
const machariaState = {
  user: null,
  permissions: new Set(),
  maquinas: [],
  machos: [],
  categories: [],
  sectors: [],
  currentShift: null,
  editingClosed: false,
  draftSaveTimer: null,
  draftSaveInFlight: false,
  records: [],
  fichaProdutos: [],
  fichaRows: [],
  fichaTab: "rascunho",
  reprovandoId: null,
  importPreview: []
};

const aq = (selector) => document.querySelector(selector);
const aesc = (value = "") => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const anumber = (value) => Number(value || 0);

function machariaMessage(text, type = "success") {
  const el = aq("#production-message");
  if (!el) return;
  el.textContent = text;
  el.className = `form-message ${type}`;
  el.hidden = false;
}

// "Caixa"/"Macho" sozinhos não identificam nada (o mesmo "CX1/M1" se repete
// em dezenas de produtos sem relação entre si) — o produto vinculado é que dá
// a identidade prática, tanto pra exibir quanto pra localizar na importação.
function machoLabel(macho) {
  const produtos = (macho.machos_macharia_produtos || []).map((v) => v.produtos?.codigo).filter(Boolean);
  return `${produtos.length ? produtos.join("/") : "sem produto"} · ${macho.caixa}/${macho.macho}`;
}
async function loadMachariaSupport() {
  const { maquinas, machos, categories, sectors } = await window.LIDUTEC_PRODUCAO_MACHARIA_DATA.support();
  machariaState.maquinas = maquinas;
  machariaState.machos = machos.slice().sort((a, b) => machoLabel(a).localeCompare(machoLabel(b), "pt-BR"));
  machariaState.categories = categories;
  machariaState.sectors = sectors;
}
function formatMinutes(value) {
  return `${Math.floor(anumber(value) / 60)}h ${String(anumber(value) % 60).padStart(2, "0")}min`;
}
function resolveShiftTime(value) {
  const form = aq("#shift-entry-form");
  return window.LIDUTEC_TURNOS.resolveShiftTime(form?.elements.data_operacional.value, form?.elements.turno.value, value);
}
function applyRowValues(row, values = {}) {
  for (const control of row.querySelectorAll("input,select")) {
    if (Object.hasOwn(values, control.name)) control.value = values[control.name] ?? "";
  }
}

// ---------------------------------------------------------------------------
// Apontamento hora a hora (tela "entry") — 1 turno cobre as 5 máquinas; cada
// operador só vê/edita a grade da máquina selecionada, mas o rascunho salvo é
// sempre o conjunto de TODAS as máquinas já conhecidas (mergedProducoes),
// senão o apontamento de um operador apagaria o de outro no mesmo turno.
// ---------------------------------------------------------------------------
function hourLabel(slot) {
  const pad = (n) => String(n).padStart(2, "0");
  const end = new Date(slot);
  const start = new Date(end.getTime() - 3600000);
  return `${pad(start.getHours())}:00 às ${pad(end.getHours())}:00`;
}
function currentMaquina() {
  const id = aq("#shift-entry-form")?.elements.maquina_id.value;
  return machariaState.maquinas.find((m) => String(m.id) === String(id)) || null;
}
function renderGrid() {
  const form = aq("#shift-entry-form");
  const container = aq("#macharia-grid-container");
  const maquina = currentMaquina();
  aq("#grid-maquina-title").textContent = maquina ? `Sopros por estação — ${maquina.nome}` : "Sopros por estação";
  const date = form.elements.data_operacional.value, turno = form.elements.turno.value;
  if (!maquina || !date || !turno) { container.innerHTML = ""; return; }

  const bounds = window.LIDUTEC_TURNOS.shiftBounds(date, turno);
  const closed = machariaState.currentShift?.status === "FECHADO";
  const canEdit = !closed || machariaState.editingClosed;
  const slots = window.LIDUTEC_TURNOS.hourlySlots(bounds.start, bounds.end, closed ? bounds.end : new Date());
  const estacoes = Array.from({ length: maquina.numero_estacoes }, (_, i) => i + 1);
  const entries = machariaState.currentShift?.rascunho_producoes || [];
  // Uma hora/estação pode ter mais de um lançamento (troca de macho no meio
  // da hora), então cada chave guarda uma lista, não um item único.
  const lookup = new Map();
  for (const item of entries) {
    if (String(item.linha_id ?? item.linha_maquina_id) !== String(maquina.id)) continue;
    const key = `${item.estacao}|${new Date(item.horario_previsto).toISOString()}`;
    if (!lookup.has(key)) lookup.set(key, []);
    lookup.get(key).push(item);
  }
  const machoOptions = machariaState.machos.map((m) => `<option value="${m.id}">${aesc(machoLabel(m))}</option>`).join("");
  machariaState.machoOptionsHtml = machoOptions;

  if (!slots.length) {
    container.innerHTML = '<p class="checklist-grid-locked">Ainda não há horário previsto vencido para este turno.</p>';
    return;
  }
  const estacaoHeaderCells = estacoes.map((estacao) => `<th class="macharia-estacao-header" colspan="2"><strong>Estação ${estacao}</strong></th>`).join("");
  const subHeaderCells = estacoes.map(() => `<th class="macharia-subheader">Macho</th><th class="macharia-subheader">Sopros</th>`).join("");
  // A identificação do macho repete da hora anterior por padrão (o operador
  // normalmente segue produzindo a mesma coisa) — só a quantidade de sopros
  // começa sempre zerada a cada hora. Se mudou de macho, o operador troca ou
  // usa "+ macho" pra registrar mais de um lançamento na mesma hora.
  const lastMachoByEstacao = new Map();
  const disabledAttr = canEdit ? "" : "disabled";
  const addButtonHtml = canEdit ? '<button type="button" class="macharia-add-entry" aria-label="Adicionar outro macho nesta hora" title="Adicionar outro macho nesta hora">+</button>' : "";
  const rows = slots.map((slot) => {
    const cells = estacoes.map((estacao) => {
      const key = `${estacao}|${slot.toISOString()}`;
      const list = lookup.get(key) || [];
      const defaultMachoId = (list[0]?.macho_id) ?? lastMachoByEstacao.get(estacao) ?? "";
      const lastMachoId = list.length ? list[list.length - 1].macho_id : defaultMachoId;
      if (lastMachoId) lastMachoByEstacao.set(estacao, lastMachoId);
      const items = list.length ? list : [{}];
      const machoEntries = items.map((item, index) => {
        const value = index === 0 ? (item.macho_id ?? defaultMachoId) : (item.macho_id ?? "");
        return `<div class="macharia-entry"><select class="macharia-macho" data-estacao="${estacao}" data-slot="${slot.toISOString()}" data-value="${value || ""}" ${disabledAttr}><option value="">—</option>${machoOptions}</select>${addButtonHtml}</div>`;
      }).join("");
      const soprosEntries = items.map((item) => `<div class="macharia-entry"><input type="number" class="macharia-sopros" min="0" step="1" value="${item.quantidade_sopros ?? 0}" data-estacao="${estacao}" data-slot="${slot.toISOString()}" ${disabledAttr}><button type="button" class="macharia-remove-entry" aria-label="Remover lançamento" ${disabledAttr}>×</button></div>`).join("");
      return `<td class="checklist-grid-cell macharia-macho-cell" data-estacao="${estacao}" data-slot="${slot.toISOString()}"><div class="macharia-multi">${machoEntries}</div></td>`
        + `<td class="checklist-grid-cell macharia-sopros-cell" data-estacao="${estacao}" data-slot="${slot.toISOString()}"><div class="macharia-multi">${soprosEntries}</div></td>`;
    }).join("");
    return `<tr><th class="checklist-grid-itemcol">${hourLabel(slot)}</th>${cells}</tr>`;
  }).join("");
  container.innerHTML = `<table class="checklist-grid macharia-grid"><thead>
    <tr><th class="checklist-grid-itemcol" rowspan="2">Hora</th>${estacaoHeaderCells}</tr>
    <tr>${subHeaderCells}</tr>
  </thead><tbody>${rows}</tbody></table>`;
  for (const select of container.querySelectorAll(".macharia-macho")) {
    if (select.dataset.value) select.value = select.dataset.value;
  }
}
// Pareia cada select de macho com o input de sopros na mesma posição dentro
// da célula (podem existir vários pares na mesma hora/estação).
function collectMachineEntries() {
  const maquina = currentMaquina();
  const container = aq("#macharia-grid-container");
  if (!maquina) return [];
  const entries = [];
  for (const row of container.querySelectorAll("tbody tr")) {
    for (const machoCell of row.querySelectorAll("td.macharia-macho-cell")) {
      const estacao = machoCell.dataset.estacao;
      const soprosCell = row.querySelector(`td.macharia-sopros-cell[data-estacao="${estacao}"]`);
      const selects = [...machoCell.querySelectorAll(".macharia-macho")];
      const inputs = soprosCell ? [...soprosCell.querySelectorAll(".macharia-sopros")] : [];
      selects.forEach((select, index) => {
        if (!select.value) return;
        entries.push({
          linha_id: maquina.id,
          estacao: anumber(select.dataset.estacao),
          horario_previsto: select.dataset.slot,
          macho_id: anumber(select.value),
          quantidade_sopros: anumber(inputs[index]?.value)
        });
      });
    }
  }
  return entries;
}
function addMachoEntryRow(addButton) {
  const machoCell = addButton.closest("td");
  const tr = machoCell.closest("tr");
  const estacao = machoCell.dataset.estacao;
  const slot = machoCell.dataset.slot;
  const soprosCell = tr.querySelector(`td.macharia-sopros-cell[data-estacao="${estacao}"]`);
  const machoEntry = document.createElement("div");
  machoEntry.className = "macharia-entry";
  machoEntry.innerHTML = `<select class="macharia-macho" data-estacao="${estacao}" data-slot="${slot}"><option value="">—</option>${machariaState.machoOptionsHtml || ""}</select><button type="button" class="macharia-add-entry" aria-label="Adicionar outro macho nesta hora" title="Adicionar outro macho nesta hora">+</button>`;
  machoCell.querySelector(".macharia-multi").append(machoEntry);
  const soprosEntry = document.createElement("div");
  soprosEntry.className = "macharia-entry";
  soprosEntry.innerHTML = `<input type="number" class="macharia-sopros" min="0" step="1" value="0" data-estacao="${estacao}" data-slot="${slot}"><button type="button" class="macharia-remove-entry" aria-label="Remover lançamento">×</button>`;
  soprosCell.querySelector(".macharia-multi").append(soprosEntry);
  saveDraft();
}
function removeMachoEntryRow(removeButton) {
  const entryDiv = removeButton.closest(".macharia-entry");
  const soprosCell = removeButton.closest("td");
  const tr = soprosCell.closest("tr");
  const estacao = soprosCell.dataset.estacao;
  const soprosEntries = [...soprosCell.querySelectorAll(".macharia-entry")];
  const index = soprosEntries.indexOf(entryDiv);
  const machoCell = tr.querySelector(`td.macharia-macho-cell[data-estacao="${estacao}"]`);
  const machoEntries = [...machoCell.querySelectorAll(".macharia-entry")];
  if (soprosEntries.length <= 1) {
    const select = machoEntries[0]?.querySelector(".macharia-macho");
    const input = entryDiv.querySelector(".macharia-sopros");
    if (select) select.value = "";
    if (input) input.value = "0";
  } else {
    machoEntries[index]?.remove();
    entryDiv.remove();
  }
  saveDraft();
}
function mergedProducoes() {
  const maquina = currentMaquina();
  const others = (machariaState.currentShift?.rascunho_producoes || [])
    .filter((item) => String(item.linha_id ?? item.linha_maquina_id) !== String(maquina?.id));
  return [...others, ...collectMachineEntries()];
}

// ---------------------------------------------------------------------------
// Paradas — mesmo modelo da Moldagem (Hora início/fim, Setor responsável,
// Motivo, Observações), mas cada parada carrega a máquina selecionada no
// menu superior no momento em que foi lançada: como cada máquina tem seu
// próprio operador, a tabela mostra e salva só as paradas da máquina atual
// (igual à grade de sopros), preservando as paradas de outras máquinas via
// mergedParadas() na hora de salvar.
// ---------------------------------------------------------------------------
function stopRow() {
  const row = document.createElement("tr");
  row.className = "shift-stop-row";
  const sectorOptions = machariaState.sectors.map((s) => `<option value="${s.id}">${aesc(s.nome)}</option>`).join("");
  const categoryOptions = machariaState.categories.map((c) => `<option value="${c.id}">${aesc(c.nome)}</option>`).join("");
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
  row.querySelector("[data-duration]").textContent = formatMinutes(minutes);
}
function renderStopsTable() {
  const maquina = currentMaquina();
  const title = aq("#stops-maquina-title");
  const tbody = aq("#stop-entry-rows");
  const addButton = aq("#add-stop-row");
  if (title) title.textContent = maquina ? `Parada — ${maquina.nome}` : "Parada";
  if (!tbody) return;
  if (!maquina) { tbody.replaceChildren(); return; }
  const closed = machariaState.currentShift?.status === "FECHADO";
  const canEdit = !closed || machariaState.editingClosed;
  if (addButton) addButton.hidden = !canEdit;
  const stops = (machariaState.currentShift?.rascunho_paradas || [])
    .filter((item) => String(item.linha_id ?? item.linha_maquina_id) === String(maquina.id));
  const toTimeInput = (value) => {
    if (!value) return "";
    if (/^\d{2}:\d{2}$/.test(value)) return value;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };
  tbody.replaceChildren();
  for (const item of stops.length ? stops : [{}]) {
    const row = stopRow();
    applyRowValues(row, {
      inicio: toTimeInput(item.inicio),
      fim: toTimeInput(item.fim),
      setor_id: item.setor_responsavel_id ?? item.setor_id ?? "",
      categoria_id: item.categoria_id ?? "",
      observacao: item.observacao ?? ""
    });
    if (!canEdit) for (const control of row.querySelectorAll("input,select,button")) control.disabled = true;
    tbody.append(row);
    try { updateStopRow(row); } catch { /* horário incompleto no carregamento inicial */ }
  }
}
// strict=false (autosave de rascunho): ignora silenciosamente linhas
// incompletas/inválidas, sem travar o usuário no meio do preenchimento.
// strict=true (fechar turno): exige que toda linha começada esteja completa.
function collectMachineStops(strict = false) {
  const maquina = currentMaquina();
  if (!maquina) return [];
  const rows = [...document.querySelectorAll(".shift-stop-row")]
    .filter((row) => ["inicio", "fim", "setor_id", "categoria_id", "observacao"].some((name) => row.querySelector(`[name="${name}"]`)?.value));
  const stops = [];
  for (const row of rows) {
    const value = (name) => row.querySelector(`[name="${name}"]`).value;
    if (!value("inicio") || !value("fim") || !value("setor_id") || !value("categoria_id")) {
      if (strict) throw new Error("Preencha início, fim, setor e motivo em todas as paradas.");
      continue;
    }
    const start = resolveShiftTime(value("inicio"));
    const end = resolveShiftTime(value("fim"));
    if (!start || !end || end < start) {
      if (strict) throw new Error("Os horários da parada devem estar dentro do turno selecionado.");
      continue;
    }
    stops.push({
      linha_id: maquina.id, inicio: start.toISOString(), fim: end.toISOString(),
      setor_id: anumber(value("setor_id")), categoria_id: anumber(value("categoria_id")), observacao: value("observacao")
    });
  }
  if (strict && window.LIDUTEC_TURNOS.findOverlappingInterval(stops)) {
    throw new Error("Há paradas com horários sobrepostos nesta máquina. Ajuste os horários antes de continuar.");
  }
  return stops;
}
function mergedParadas(strict = false) {
  const maquina = currentMaquina();
  const others = (machariaState.currentShift?.rascunho_paradas || [])
    .filter((item) => String(item.linha_id ?? item.linha_maquina_id) !== String(maquina?.id));
  return [...others, ...collectMachineStops(strict)];
}
function updateMaquinaBanner() {
  const maquina = currentMaquina();
  const banner = aq("#maquina-banner-name");
  if (banner) banner.textContent = maquina ? maquina.nome : "—";
}
function renderMachineView() {
  updateMaquinaBanner();
  renderGrid();
  renderStopsTable();
}
function saveDraft() {
  clearTimeout(machariaState.draftSaveTimer);
  machariaState.draftSaveTimer = setTimeout(persistDraft, 800);
}
async function persistDraft() {
  if (machariaState.currentShift?.status === "FECHADO" || machariaState.editingClosed || machariaState.draftSaveInFlight) return;
  machariaState.draftSaveInFlight = true;
  const form = aq("#shift-entry-form");
  try {
    const producoes = mergedProducoes();
    const paradas = mergedParadas(false);
    const saved = await window.LIDUTEC_PRODUCAO_MACHARIA_DATA.saveShiftDraft({
      p_data_operacional: form.elements.data_operacional.value,
      p_turno: form.elements.turno.value,
      p_producoes: producoes,
      p_paradas: paradas,
      p_versao: machariaState.currentShift?.versao ?? null
    });
    machariaState.currentShift = { ...(machariaState.currentShift || {}), ...saved, rascunho_producoes: producoes, rascunho_paradas: paradas, status: "ABERTO" };
    aq("#shift-status").textContent = "Em apontamento · salvo agora";
  } catch (error) {
    if (/CONFLITO_RASCUNHO|40001/i.test(`${error.message || ""} ${error.code || ""}`)) {
      machariaState.draftSaveInFlight = false;
      machariaMessage("Este turno foi atualizado por outro usuário. Carregamos a versão mais recente.", "error");
      await checkShiftStatus();
      return;
    }
    machariaMessage(`Não foi possível salvar o rascunho: ${error.message}`, "error");
  } finally {
    machariaState.draftSaveInFlight = false;
  }
}
async function loadShiftHistory(turnId) {
  const data = await window.LIDUTEC_PRODUCAO_MACHARIA_DATA.history(turnId);
  const rows = (data || []).map((item) => ({ alterado_em: item.alterado_em, nome: item.usuarios?.nome || "Usuário" }));
  const panel = aq("#shift-edit-history");
  panel.hidden = !rows.length;
  aq("#shift-edit-history-rows").innerHTML = rows.map((item) => `<tr><td>${new Date(item.alterado_em).toLocaleString("pt-BR")}</td><td>${aesc(item.nome)} alterou os apontamentos do turno.</td></tr>`).join("");
}
async function checkShiftStatus() {
  const form = aq("#shift-entry-form");
  const date = form.elements.data_operacional.value, turno = form.elements.turno.value;
  if (!date || !turno) return;
  const data = await window.LIDUTEC_PRODUCAO_MACHARIA_DATA.shift(date, turno);
  machariaState.editingClosed = false;
  const closed = data?.status === "FECHADO";
  if (closed) {
    const productions = await window.LIDUTEC_PRODUCAO_MACHARIA_DATA.shiftProductions(data.id);
    const stops = await window.LIDUTEC_PRODUCAO_MACHARIA_DATA.shiftStops(data.id);
    machariaState.currentShift = {
      ...data,
      rascunho_producoes: productions.map((item) => ({ ...item, linha_id: item.linha_maquina_id })),
      rascunho_paradas: stops.map((item) => ({ ...item, linha_id: item.linha_maquina_id }))
    };
  } else {
    machariaState.currentShift = data ? { ...data } : null;
  }
  const canEdit = closed && machariaState.permissions.has("producao_macharia.editar");
  const canDelete = closed && machariaState.permissions.has("producao_macharia.excluir_turno");
  const updatedBy = machariaState.currentShift?.usuarios?.nome;
  aq("#shift-status").textContent = closed ? "Fechado" : (updatedBy ? `Em apontamento · ${updatedBy}` : "Em apontamento");
  aq("#close-shift-button").hidden = closed;
  aq("#close-shift-button").disabled = closed;
  aq("#close-shift-button").textContent = "Fechar turno";
  aq("#edit-shift-button").hidden = !canEdit;
  aq("#delete-shift-button").hidden = !canDelete;
  aq("#delete-shift-button").disabled = false;
  if (data?.id && closed) await loadShiftHistory(data.id); else aq("#shift-edit-history").hidden = true;
  renderMachineView();
}
function editClosedShift() {
  machariaState.editingClosed = true;
  aq("#edit-shift-button").hidden = true;
  aq("#delete-shift-button").hidden = true;
  aq("#close-shift-button").hidden = false;
  aq("#close-shift-button").disabled = false;
  aq("#close-shift-button").textContent = "Salvar alterações";
  aq("#shift-status").textContent = "Editando turno fechado";
  renderMachineView();
}
async function deleteClosedShift() {
  const turnId = machariaState.currentShift?.id;
  if (!turnId) return;
  if (!confirm("Excluir definitivamente este turno e seus apontamentos?")) return;
  const button = aq("#delete-shift-button");
  button.disabled = true;
  try {
    await window.LIDUTEC_PRODUCAO_MACHARIA_DATA.deleteShift(turnId);
    machariaMessage("Turno excluído com sucesso.");
    await checkShiftStatus();
  } catch (error) {
    machariaMessage(error.message, "error");
    button.disabled = false;
  }
}
async function closeShift(event) {
  event.preventDefault();
  const button = aq("#close-shift-button");
  button.disabled = true;
  try {
    const producoes = mergedProducoes();
    if (!producoes.length) throw new Error("Informe ao menos um lançamento de sopro.");
    const paradas = mergedParadas(true);
    const form = aq("#shift-entry-form");
    if (machariaState.editingClosed) {
      await window.LIDUTEC_PRODUCAO_MACHARIA_DATA.editShift({ p_turno_id: machariaState.currentShift.id, p_producoes: producoes, p_paradas: paradas });
      machariaMessage("Alterações do turno salvas com sucesso.");
    } else {
      await window.LIDUTEC_PRODUCAO_MACHARIA_DATA.closeShift({
        p_data_operacional: form.elements.data_operacional.value,
        p_turno: form.elements.turno.value,
        p_producoes: producoes,
        p_paradas: paradas,
        p_versao: machariaState.currentShift?.versao ?? null
      });
      machariaMessage("Turno fechado com sucesso.");
    }
    await checkShiftStatus();
  } catch (error) {
    machariaMessage(error.message, "error");
  } finally {
    button.disabled = false;
  }
}
// A máquina escolhida fica presa a este navegador/usuário (não ao turno em
// si): se voltasse sempre pra primeira da lista ao atualizar a página, o
// operador poderia lançar sopros/paradas na máquina errada sem perceber.
function maquinaStorageKey() {
  return `lidutec:producao-macharia:maquina:${machariaState.user?.id || "anonimo"}`;
}
async function initializeShiftEntry() {
  const form = aq("#shift-entry-form");
  const params = new URLSearchParams(location.search);
  const shift = window.LIDUTEC_TURNOS.determineShift();
  form.elements.data_operacional.value = /^\d{4}-\d{2}-\d{2}$/.test(params.get("data") || "") ? params.get("data") : shift.dataOperacional;
  form.elements.turno.value = window.LIDUTEC_TURNOS.shifts[params.get("turno")] ? params.get("turno") : shift.codigo;
  form.elements.maquina_id.innerHTML = machariaState.maquinas.map((m) => `<option value="${m.id}">${aesc(m.nome)}</option>`).join("");
  const savedMaquinaId = localStorage.getItem(maquinaStorageKey());
  const savedMaquinaValid = savedMaquinaId && machariaState.maquinas.some((m) => String(m.id) === savedMaquinaId);
  if (savedMaquinaValid) form.elements.maquina_id.value = savedMaquinaId;
  else if (machariaState.maquinas[0]) form.elements.maquina_id.value = machariaState.maquinas[0].id;

  form.elements.maquina_id.addEventListener("change", () => {
    localStorage.setItem(maquinaStorageKey(), form.elements.maquina_id.value);
    renderMachineView();
  });
  const refresh = () => checkShiftStatus().catch((error) => machariaMessage(error.message, "error"));
  form.elements.data_operacional.addEventListener("change", refresh);
  form.elements.turno.addEventListener("change", refresh);
  form.addEventListener("input", (event) => {
    if (event.target.matches(".macharia-sopros")) saveDraft();
    const stopRowEl = event.target.closest(".shift-stop-row");
    if (stopRowEl) {
      try { updateStopRow(stopRowEl); } catch { /* horário incompleto, ignora até ambos preenchidos */ }
      saveDraft();
    }
  });
  form.addEventListener("change", (event) => {
    if (event.target.matches(".macharia-macho") || event.target.closest(".shift-stop-row")) saveDraft();
  });
  aq("#macharia-grid-container").addEventListener("click", (event) => {
    const addButton = event.target.closest(".macharia-add-entry");
    if (addButton) { addMachoEntryRow(addButton); return; }
    const removeButton = event.target.closest(".macharia-remove-entry");
    if (removeButton) removeMachoEntryRow(removeButton);
  });
  aq("#add-stop-row").addEventListener("click", () => { aq("#stop-entry-rows").append(stopRow()); saveDraft(); });
  aq("#stop-entry-rows").addEventListener("click", (event) => {
    const button = event.target.closest(".row-remove");
    if (!button) return;
    const row = button.closest("tr");
    const tbody = row.parentElement;
    if (tbody.children.length === 1) {
      for (const control of row.querySelectorAll("input,select")) control.value = "";
      try { updateStopRow(row); } catch { /* ambos vazios, sem erro */ }
    } else {
      row.remove();
    }
    saveDraft();
  });
  form.addEventListener("submit", closeShift);
  aq("#edit-shift-button").addEventListener("click", editClosedShift);
  aq("#delete-shift-button").addEventListener("click", deleteClosedShift);

  await checkShiftStatus();

  window.supabaseClient.channel("shared-production-shift-macharia").on("postgres_changes", { event: "*", schema: "public", table: "turnos_producao_macharia" }, (payload) => {
    const row = payload.new;
    if (!document.hidden && row && row.data_operacional === form.elements.data_operacional.value && row.turno === form.elements.turno.value &&
      String(row.atualizado_por) !== String(machariaState.user?.id)) {
      refresh();
    }
  }).subscribe();
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
async function loadMachariaDashboard() {
  const today = window.LIDUTEC_TURNOS.determineShift().dataOperacional;
  machariaState.records = await window.LIDUTEC_PRODUCAO_MACHARIA_DATA.records({ from: today, to: today, limit: 1000 });
}
function renderMachariaDashboard() {
  const records = machariaState.records;
  const totalSopros = records.reduce((sum, item) => sum + anumber(item.quantidade_sopros), 0);
  const totalMachos = records.reduce((sum, item) => sum + anumber(item.quantidade_sopros) * anumber(item.machos_macharia?.machos_por_sopro), 0);
  aq('[data-metric="sopros"]').textContent = totalSopros.toLocaleString("pt-BR");
  aq('[data-metric="machos"]').textContent = totalMachos.toLocaleString("pt-BR");
  aq("#dashboard-production-records").innerHTML = records.map((item) => `<tr>
      <td>${new Date(item.horario_previsto).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</td>
      <td>${aesc(item.turno)}</td>
      <td>${aesc(item.linhas_maquinas_producao?.nome || "—")}</td>
      <td>${anumber(item.estacao)}</td>
      <td>${item.machos_macharia ? aesc(machoLabel(item.machos_macharia)) : "—"}</td>
      <td>${anumber(item.quantidade_sopros)}</td>
    </tr>`).join("");
  aq("#dashboard-production-empty").hidden = records.length > 0;
}

// ---------------------------------------------------------------------------
// Ficha de macho — cadastro (Engenharia), aval (Produção), importação
// ---------------------------------------------------------------------------
function splitProdutoCodes(raw) {
  const value = String(raw || "").trim();
  if (!value) return [];
  if (!value.includes("/")) return [value];
  const [first, ...rest] = value.split("/").map((v) => v.trim()).filter(Boolean);
  const match = first.match(/^([A-Za-z]+)(\d+)$/);
  if (!match) return [first, ...rest];
  const [, prefix, digits] = match;
  return [first, ...rest.map((suffix) => `${prefix}${suffix.padStart(digits.length, "0")}`)];
}
function statusBadge(status) {
  const labels = { RASCUNHO: "Rascunho", APROVADO: "Vigente", REPROVADO: "Reprovado" };
  return `<span class="ficha-macho-status status-${status.toLowerCase()}">${labels[status] || status}</span>`;
}
function produtoRow(codigo = "", quantidade = 1) {
  const row = document.createElement("div");
  row.className = "ficha-produto-row";
  const options = machariaState.fichaProdutos.map((p) => `<option value="${aesc(p.codigo)}">${aesc(p.codigo)} — ${aesc(p.nome)}</option>`).join("");
  row.innerHTML = `<select name="produto_codigo"><option value="">Selecione</option>${options}</select><input name="machos_por_peca" type="number" min="1" step="1" value="${quantidade}"><button type="button" class="row-remove" aria-label="Remover produto">×</button>`;
  if (codigo) row.querySelector("select").value = codigo;
  return row;
}
function resetFichaForm() {
  aq("#ficha-form").reset();
  aq("#ficha-produtos-rows").replaceChildren(produtoRow());
  const message = aq("#ficha-form-message");
  message.hidden = true;
}
function openFichaDialog(ficha = null) {
  resetFichaForm();
  machariaState.editingFichaId = ficha?.id ?? null;
  aq("#ficha-dialog-title").textContent = !ficha ? "Nova ficha de macho" : ficha.status === "APROVADO" ? "Nova versão da ficha" : "Editar rascunho";
  if (ficha) {
    const form = aq("#ficha-form");
    form.elements.caixa.value = ficha.caixa;
    form.elements.macho.value = ficha.macho;
    form.elements.machos_por_sopro.value = ficha.machos_por_sopro;
    form.elements.peso_macho_kg.value = ficha.peso_macho_kg ?? "";
    form.elements.kg_areia_por_sopro.value = ficha.kg_areia_por_sopro ?? "";
    form.elements.sopro_por_hora.value = ficha.sopro_por_hora ?? "";
    const produtos = ficha.machos_macharia_produtos || [];
    aq("#ficha-produtos-rows").replaceChildren(...(produtos.length ? produtos.map((v) => produtoRow(v.produtos?.codigo, v.machos_por_peca)) : [produtoRow()]));
  }
  aq("#ficha-dialog").showModal();
}
function renderFichaList(rows) {
  const body = aq("#ficha-macho-rows");
  const canEdit = machariaState.permissions.has("produto.editar");
  const canAvaliar = machariaState.permissions.has("producao_macharia.avaliar_ficha_macho");
  body.innerHTML = rows.map((row) => {
    const produtos = (row.machos_macharia_produtos || []).map((v) => aesc(v.produtos?.codigo || "")).join(", ") || "—";
    const actions = [];
    if (row.status === "RASCUNHO" && canEdit) actions.push(`<button type="button" class="button button-secondary ficha-edit" data-id="${row.id}">Editar</button>`);
    if (row.status === "APROVADO" && canEdit) actions.push(`<button type="button" class="button button-secondary ficha-edit" data-id="${row.id}">Nova versão</button>`);
    if (row.status === "RASCUNHO" && canAvaliar) {
      actions.push(`<button type="button" class="button button-primary ficha-aprovar" data-id="${row.id}">Aprovar</button>`);
      actions.push(`<button type="button" class="button button-danger ficha-reprovar" data-id="${row.id}">Reprovar</button>`);
    }
    return `<tr>
      <td>${aesc(row.caixa)}</td><td>${aesc(row.macho)}</td><td>${anumber(row.machos_por_sopro)}</td>
      <td>${row.peso_macho_kg ?? "—"}</td><td>${row.kg_areia_por_sopro ?? "—"}</td><td>${row.sopro_por_hora ?? "—"}</td>
      <td>${produtos}</td><td>${aesc(row.usuarios?.nome || "—")}</td>
      <td>${statusBadge(row.status)} ${actions.join(" ")}</td>
    </tr>`;
  }).join("");
  aq("#ficha-macho-empty").hidden = rows.length > 0;
}
async function loadFichaTab(tab) {
  const statusMap = { rascunho: "RASCUNHO", aprovado: "APROVADO", reprovado: "REPROVADO" };
  machariaState.fichaTab = tab;
  for (const button of document.querySelectorAll(".ficha-tab")) button.classList.toggle("active", button.dataset.tab === tab);
  const rows = await window.LIDUTEC_PRODUCAO_MACHARIA_DATA.fichas(statusMap[tab]);
  machariaState.fichaRows = rows;
  renderFichaList(tab === "aprovado" ? rows.filter((row) => row.ativo) : rows);
}
// Formato da planilha de referência: Produto, Caixa, Macho, Machos por
// sopro, Peso do macho, Kg areia/sopro, Sopro/hora — 7 colunas, sem "machos
// por peça" (a planilha real não traz essa coluna; assume-se 1 por padrão,
// ajustável depois na ficha).
function parseImportText(text) {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const cols = (line.includes("\t") ? line.split("\t") : line.split(/\s{2,}/)).map((v) => (v || "").trim());
    const [produto, caixa, macho, machosPorSopro, peso, areia, soproHora] = cols;
    const parseNum = (value) => { const n = Number(String(value || "").replace(",", ".")); return Number.isFinite(n) ? n : null; };
    return {
      caixa: caixa || "", macho: macho || "",
      machos_por_sopro: Math.max(0, Math.round(parseNum(machosPorSopro) || 0)),
      peso_macho_kg: parseNum(peso), kg_areia_por_sopro: parseNum(areia), sopro_por_hora: parseNum(soproHora),
      produtos: splitProdutoCodes(produto).map((codigo) => ({ produto_codigo: codigo, machos_por_peca: 1 }))
    };
  }).filter((row) => row.caixa && row.macho && row.machos_por_sopro > 0);
}
function produtoCodeKnown(codigo) {
  return machariaState.fichaProdutos.some((p) => p.codigo.toUpperCase() === String(codigo).toUpperCase());
}
async function initializeFichaMacho() {
  machariaState.fichaProdutos = await window.LIDUTEC_PRODUCAO_MACHARIA_DATA.produtos();
  aq("#import-panel").hidden = !machariaState.permissions.has("produto.editar");

  for (const button of document.querySelectorAll(".ficha-tab")) {
    button.addEventListener("click", () => loadFichaTab(button.dataset.tab).catch((error) => machariaMessage(error.message, "error")));
  }
  aq("#new-ficha-button")?.addEventListener("click", () => openFichaDialog(null));
  for (const dialog of document.querySelectorAll("dialog")) {
    dialog.addEventListener("click", (event) => { if (event.target.closest("[data-calendar-close]")) dialog.close(); });
  }
  aq("#add-ficha-produto-row").addEventListener("click", () => aq("#ficha-produtos-rows").append(produtoRow()));
  aq("#ficha-produtos-rows").addEventListener("click", (event) => {
    const button = event.target.closest(".row-remove");
    if (!button) return;
    const rows = aq("#ficha-produtos-rows");
    if (rows.children.length > 1) button.closest(".ficha-produto-row").remove();
  });
  aq("#ficha-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    const produtos = [...aq("#ficha-produtos-rows").children].map((row) => ({
      produto_codigo: row.querySelector('[name="produto_codigo"]').value,
      machos_por_peca: anumber(row.querySelector('[name="machos_por_peca"]').value)
    })).filter((item) => item.produto_codigo);
    try {
      await window.LIDUTEC_PRODUCAO_MACHARIA_DATA.salvarFicha({
        p_id: machariaState.editingFichaId,
        p_caixa: form.elements.caixa.value,
        p_macho: form.elements.macho.value,
        p_machos_por_sopro: anumber(form.elements.machos_por_sopro.value),
        p_peso_macho_kg: form.elements.peso_macho_kg.value ? Number(form.elements.peso_macho_kg.value) : null,
        p_kg_areia_por_sopro: form.elements.kg_areia_por_sopro.value ? Number(form.elements.kg_areia_por_sopro.value) : null,
        p_sopro_por_hora: form.elements.sopro_por_hora.value ? Number(form.elements.sopro_por_hora.value) : null,
        p_produtos: produtos
      });
      aq("#ficha-dialog").close();
      await loadFichaTab(machariaState.fichaTab);
    } catch (error) {
      const message = aq("#ficha-form-message");
      message.textContent = error.message;
      message.className = "form-message error";
      message.hidden = false;
    }
  });
  aq("#ficha-macho-rows").addEventListener("click", async (event) => {
    const editButton = event.target.closest(".ficha-edit");
    if (editButton) { openFichaDialog(machariaState.fichaRows.find((row) => String(row.id) === editButton.dataset.id)); return; }
    const aprovarButton = event.target.closest(".ficha-aprovar");
    if (aprovarButton) {
      if (!confirm("Aprovar esta ficha de macho?")) return;
      try {
        await window.LIDUTEC_PRODUCAO_MACHARIA_DATA.avaliarFicha({ p_id: anumber(aprovarButton.dataset.id), p_decisao: "APROVADO" });
        await loadFichaTab(machariaState.fichaTab);
      } catch (error) { machariaMessage(error.message, "error"); }
      return;
    }
    const reprovarButton = event.target.closest(".ficha-reprovar");
    if (reprovarButton) {
      machariaState.reprovandoId = anumber(reprovarButton.dataset.id);
      aq("#reprovar-form").reset();
      aq("#reprovar-dialog").showModal();
    }
  });
  aq("#reprovar-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await window.LIDUTEC_PRODUCAO_MACHARIA_DATA.avaliarFicha({
        p_id: machariaState.reprovandoId, p_decisao: "REPROVADO", p_justificativa: event.target.elements.justificativa.value
      });
      aq("#reprovar-dialog").close();
      await loadFichaTab(machariaState.fichaTab);
    } catch (error) { machariaMessage(error.message, "error"); }
  });
  aq("#import-preview-button")?.addEventListener("click", () => {
    const lines = aq("#import-textarea").value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).length;
    const parsed = parseImportText(aq("#import-textarea").value);
    machariaState.importPreview = parsed;
    const invalidCount = lines - parsed.length;
    aq("#import-preview-rows").innerHTML = parsed.map((row) => {
      const produtos = row.produtos.map((p) => {
        const known = produtoCodeKnown(p.produto_codigo);
        return `<span${known ? "" : ' class="import-produto-missing" title="Produto não cadastrado"'}>${aesc(p.produto_codigo)}</span>`;
      }).join(", ") || "—";
      return `<tr><td>${aesc(row.caixa)}</td><td>${aesc(row.macho)}</td><td>${row.machos_por_sopro}</td><td>${row.peso_macho_kg ?? "—"}</td><td>${row.kg_areia_por_sopro ?? "—"}</td><td>${row.sopro_por_hora ?? "—"}</td><td>${produtos}</td></tr>`;
    }).join("");
    aq("#import-preview").hidden = !parsed.length;
    aq("#import-confirm-button").hidden = !parsed.length;
    machariaMessage(invalidCount > 0
      ? `${parsed.length} linha(s) reconhecida(s); ${invalidCount} linha(s) não puderam ser lidas (confira caixa/macho/machos por sopro).`
      : `${parsed.length} linha(s) reconhecida(s).`, invalidCount > 0 ? "error" : "success");
  });
  aq("#import-confirm-button")?.addEventListener("click", async () => {
    try {
      const summary = await window.LIDUTEC_PRODUCAO_MACHARIA_DATA.importarFichas(machariaState.importPreview);
      const missing = summary?.produtos_nao_encontrados || [];
      const parts = [`${summary?.importadas ?? 0} ficha(s) importada(s) como rascunho.`];
      if (summary?.linhas_invalidas) parts.push(`${summary.linhas_invalidas} linha(s) ignorada(s) por dados inválidos.`);
      if (missing.length) parts.push(`Produtos não encontrados no cadastro (vínculo não criado, crie o produto e edite a ficha depois): ${missing.join(", ")}.`);
      machariaMessage(parts.join(" "), missing.length || summary?.linhas_invalidas ? "error" : "success");
      aq("#import-textarea").value = "";
      aq("#import-preview").hidden = true;
      aq("#import-confirm-button").hidden = true;
      await loadFichaTab("rascunho");
    } catch (error) { machariaMessage(error.message, "error"); }
  });

  await loadFichaTab("rascunho");
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function initializeMachariaProduction() {
  const user = await window.LIDUTEC_APP.requireAuthenticatedUser();
  if (!user) return;
  const [profile, permissions] = await Promise.all([
    window.LIDUTEC_APP.getCurrentUserProfile(user.id),
    window.LIDUTEC_APP.getUserPermissions(user.id)
  ]);
  if (!profile || profile.status !== "ATIVO") { alert("Seu usuário não possui acesso ativo."); await window.LIDUTEC_APP.signOut(); return; }
  if (!permissions.has("producao_macharia.visualizar")) { location.replace("../dashboard.html"); return; }
  machariaState.user = user;
  machariaState.permissions = permissions;
  window.LIDUTEC_APP.applyPermissionVisibility(permissions);
  aq("#user-name").textContent = profile.nome;
  aq("#user-profile").textContent = profile.perfil || "Usuário";
  aq("#user-avatar").textContent = profile.nome.slice(0, 1).toUpperCase();

  if (machariaPage === "ficha-macho") {
    aq("#production-loading")?.setAttribute("hidden", "");
    aq("#ficha-macho-content").hidden = false;
    await initializeFichaMacho();
    return;
  }

  await loadMachariaSupport();
  aq("#production-loading")?.setAttribute("hidden", "");
  if (machariaPage === "dashboard") { await loadMachariaDashboard(); renderMachariaDashboard(); }
  if (machariaPage === "entry") {
    if (!permissions.has("producao_macharia.lancar")) throw new Error("Usuário sem permissão para lançar produção de macharia.");
    aq("#shift-entry-form").hidden = false;
    await initializeShiftEntry();
  }
}

aq("#menu-button")?.addEventListener("click", () => aq("#sidebar").classList.toggle("open"));
aq("#logout-button")?.addEventListener("click", () => window.LIDUTEC_APP.signOut());
initializeMachariaProduction().catch((error) => {
  console.error(error);
  const loading = aq("#production-loading");
  if (loading) loading.textContent = `Erro: ${error.message}`;
});
