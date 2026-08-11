const machariaPage = document.body.dataset.productionPage;
const machariaState = {
  user: null,
  permissions: new Set(),
  maquinas: [],
  machos: [],
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
  const { maquinas, machos } = await window.LIDUTEC_PRODUCAO_MACHARIA_DATA.support();
  machariaState.maquinas = maquinas;
  machariaState.machos = machos.slice().sort((a, b) => machoLabel(a).localeCompare(machoLabel(b), "pt-BR"));
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
  const lookup = new Map(entries
    .filter((item) => String(item.linha_id ?? item.linha_maquina_id) === String(maquina.id))
    .map((item) => [`${item.estacao}|${new Date(item.horario_previsto).toISOString()}`, item]));
  const machoOptions = machariaState.machos.map((m) => `<option value="${m.id}">${aesc(machoLabel(m))}</option>`).join("");

  if (!slots.length) {
    container.innerHTML = '<p class="checklist-grid-locked">Ainda não há horário previsto vencido para este turno.</p>';
    return;
  }
  const headerCells = estacoes.map((estacao) => `<th class="checklist-grid-slot"><strong>Estação ${estacao}</strong></th>`).join("");
  const rows = slots.map((slot) => {
    const cells = estacoes.map((estacao) => {
      const key = `${estacao}|${slot.toISOString()}`;
      const entry = lookup.get(key);
      const disabled = canEdit ? "" : "disabled";
      return `<td class="checklist-grid-cell macharia-cell"><div class="macharia-cell-inner">
        <select class="macharia-macho" data-estacao="${estacao}" data-slot="${slot.toISOString()}" ${disabled}><option value="">—</option>${machoOptions}</select>
        <input type="number" class="macharia-sopros" min="0" step="1" value="${entry?.quantidade_sopros ?? 0}" data-estacao="${estacao}" data-slot="${slot.toISOString()}" ${disabled}>
      </div></td>`;
    }).join("");
    return `<tr><th class="checklist-grid-itemcol">${hourLabel(slot)}</th>${cells}</tr>`;
  }).join("");
  container.innerHTML = `<table class="checklist-grid macharia-grid"><thead><tr><th class="checklist-grid-itemcol">Hora</th>${headerCells}</tr></thead><tbody>${rows}</tbody></table>`;
  for (const select of container.querySelectorAll(".macharia-macho")) {
    const entry = lookup.get(`${select.dataset.estacao}|${select.dataset.slot}`);
    if (entry?.macho_id) select.value = String(entry.macho_id);
  }
}
function collectMachineEntries() {
  const maquina = currentMaquina();
  const container = aq("#macharia-grid-container");
  if (!maquina) return [];
  const entries = [];
  for (const select of container.querySelectorAll(".macharia-macho")) {
    if (!select.value) continue;
    const estacao = anumber(select.dataset.estacao);
    const slot = select.dataset.slot;
    const sopros = container.querySelector(`.macharia-sopros[data-estacao="${estacao}"][data-slot="${slot}"]`);
    entries.push({ linha_id: maquina.id, estacao, horario_previsto: slot, macho_id: anumber(select.value), quantidade_sopros: anumber(sopros?.value) });
  }
  return entries;
}
function mergedProducoes() {
  const maquina = currentMaquina();
  const others = (machariaState.currentShift?.rascunho_producoes || [])
    .filter((item) => String(item.linha_id ?? item.linha_maquina_id) !== String(maquina?.id));
  return [...others, ...collectMachineEntries()];
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
    const saved = await window.LIDUTEC_PRODUCAO_MACHARIA_DATA.saveShiftDraft({
      p_data_operacional: form.elements.data_operacional.value,
      p_turno: form.elements.turno.value,
      p_producoes: producoes,
      p_versao: machariaState.currentShift?.versao ?? null
    });
    machariaState.currentShift = { ...(machariaState.currentShift || {}), ...saved, rascunho_producoes: producoes, status: "ABERTO" };
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
    machariaState.currentShift = { ...data, rascunho_producoes: productions.map((item) => ({ ...item, linha_id: item.linha_maquina_id })) };
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
  renderGrid();
}
function editClosedShift() {
  machariaState.editingClosed = true;
  aq("#edit-shift-button").hidden = true;
  aq("#delete-shift-button").hidden = true;
  aq("#close-shift-button").hidden = false;
  aq("#close-shift-button").disabled = false;
  aq("#close-shift-button").textContent = "Salvar alterações";
  aq("#shift-status").textContent = "Editando turno fechado";
  renderGrid();
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
    const form = aq("#shift-entry-form");
    if (machariaState.editingClosed) {
      await window.LIDUTEC_PRODUCAO_MACHARIA_DATA.editShift({ p_turno_id: machariaState.currentShift.id, p_producoes: producoes });
      machariaMessage("Alterações do turno salvas com sucesso.");
    } else {
      await window.LIDUTEC_PRODUCAO_MACHARIA_DATA.closeShift({
        p_data_operacional: form.elements.data_operacional.value,
        p_turno: form.elements.turno.value,
        p_producoes: producoes,
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
async function initializeShiftEntry() {
  const form = aq("#shift-entry-form");
  const params = new URLSearchParams(location.search);
  const shift = window.LIDUTEC_TURNOS.determineShift();
  form.elements.data_operacional.value = /^\d{4}-\d{2}-\d{2}$/.test(params.get("data") || "") ? params.get("data") : shift.dataOperacional;
  form.elements.turno.value = window.LIDUTEC_TURNOS.shifts[params.get("turno")] ? params.get("turno") : shift.codigo;
  form.elements.maquina_id.innerHTML = machariaState.maquinas.map((m) => `<option value="${m.id}">${aesc(m.nome)}</option>`).join("");
  if (machariaState.maquinas[0]) form.elements.maquina_id.value = machariaState.maquinas[0].id;

  form.elements.maquina_id.addEventListener("change", renderGrid);
  const refresh = () => checkShiftStatus().catch((error) => machariaMessage(error.message, "error"));
  form.elements.data_operacional.addEventListener("change", refresh);
  form.elements.turno.addEventListener("change", refresh);
  form.addEventListener("input", (event) => { if (event.target.matches(".macharia-sopros")) saveDraft(); });
  form.addEventListener("change", (event) => { if (event.target.matches(".macharia-macho")) saveDraft(); });
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
