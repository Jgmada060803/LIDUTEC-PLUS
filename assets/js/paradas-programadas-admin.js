const pq = (selector) => document.querySelector(selector);
const pesc = (value = "") => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const DIA_SEMANA_LABEL = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const TURNO_LABEL = { MANHA: "Manhã", TARDE: "Tarde", NOITE: "Noite" };
let ppPermissions = new Set();
let ppListMode = "vigentes";

function paradaProgramadaMessage(text, type = "success") {
  const el = pq("#parada-programada-message");
  el.textContent = text;
  el.className = `form-message ${type}`;
  el.hidden = false;
}

async function loadParadaProgramadaAreas() {
  const { data: areas, error: areasError } = await window.supabaseClient.from("areas_checklist").select("id,nome").order("ordem");
  if (areasError) throw areasError;
  const areaOptionsHtml = (areas || []).map((a) => `<option value="${a.id}">${pesc(a.nome)}</option>`).join("");
  pq("#pp-area").insertAdjacentHTML("beforeend", areaOptionsHtml);
  pq("#pp-setor-filtro").insertAdjacentHTML("beforeend", areaOptionsHtml);
  const { data, error } = await window.supabaseClient.from("tipos_parada_programada").select("codigo,nome").eq("ativo", true).order("nome");
  if (error) throw error;
  pq("#pp-tipo").insertAdjacentHTML("beforeend", (data || []).map((t) => `<option value="${t.codigo}">${pesc(t.nome)}</option>`).join(""));
}

// Marcar várias unidades de uma vez cria uma parada programada por unidade
// marcada (mesmo horário/dias para todas) — evita repetir o cadastro
// máquina por máquina. "Geral" é exclusiva com unidades específicas.
async function loadParadaProgramadaUnidades(areaId) {
  const fieldset = pq("#pp-unidades-fieldset");
  const geralCheckbox = pq("#pp-unidade-geral");
  for (const item of fieldset.querySelectorAll(".pp-unidade-item")) item.remove();
  geralCheckbox.checked = true;
  if (!areaId) return;
  const [{ data: linhas, error: linhasError }, { data: equipamentos, error: equipamentosError }] = await Promise.all([
    window.supabaseClient.from("linhas_maquinas_producao").select("id,nome").eq("area_id", areaId).eq("ativo", true).order("codigo"),
    window.supabaseClient.from("equipamentos_planejamento").select("id,nome").eq("area_id", areaId).eq("ativo", true).order("codigo")
  ]);
  if (linhasError) throw linhasError;
  if (equipamentosError) throw equipamentosError;
  const itemsHtml = [
    ...(linhas || []).map((item) => `<label class="pp-unidade-item"><input type="checkbox" name="unidade_especifica" value="linha:${item.id}">${pesc(item.nome)}</label>`),
    ...(equipamentos || []).map((item) => `<label class="pp-unidade-item"><input type="checkbox" name="unidade_especifica" value="equip:${item.id}">${pesc(item.nome)}</label>`)
  ].join("");
  fieldset.insertAdjacentHTML("beforeend", itemsHtml);
}

function formatHorario(value) {
  return String(value || "").slice(0, 5);
}
function formatVigencia(item) {
  const inicio = new Date(`${item.vigencia_inicio}T12:00:00`).toLocaleDateString("pt-BR");
  if (!item.vigencia_fim) return `desde ${inicio}`;
  const fim = new Date(`${item.vigencia_fim}T12:00:00`).toLocaleDateString("pt-BR");
  return `${inicio} até ${fim}`;
}

// ---------------------------------------------------------------------------
// Agenda semanal — modelo de repetição (não datas de calendário: as paradas
// programadas repetem toda semana dentro da vigência), então uma grade de 7
// dias × 24h já mostra o padrão completo sem precisar navegar por mês.
// ---------------------------------------------------------------------------
const AGENDA_HOUR_LABELS = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24];
function minutesOf(value) {
  const [h, m] = String(value || "0:0").slice(0, 5).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
// Encaixa cada bloco na primeira "raia" livre (sem sobrepor um bloco já
// alocado) — evita que paradas com horários próximos fiquem ilegíveis.
function assignAgendaLanes(items) {
  const sorted = items.slice().sort((a, b) => a.start - b.start);
  const laneEnds = [];
  for (const item of sorted) {
    let lane = laneEnds.findIndex((end) => item.start >= end);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(item.end); }
    else laneEnds[lane] = item.end;
    item.lane = lane;
  }
  return laneEnds.length || 1;
}
function paradaAgendaTitle(item) {
  const unidade = item.linhas_maquinas_producao?.nome || item.equipamentos_planejamento?.nome || "Geral";
  const turno = item.turno || "Todos os turnos";
  return `${item.tipos_parada_programada?.nome || "—"} — ${unidade} — ${turno} — ${formatHorario(item.horario_inicial)} às ${formatHorario(item.horario_final)}`;
}
function renderParadaAgenda(rows) {
  const byDay = Array.from({ length: 7 }, () => []);
  for (const item of rows) {
    const start = minutesOf(item.horario_inicial);
    const end = minutesOf(item.horario_final);
    for (const dia of item.dias_semana || []) {
      if (end > start) {
        byDay[dia].push({ ...item, start, end });
      } else {
        // Atravessa a meia-noite (comum no turno Noite): um pedaço fecha o
        // dia, o resto começa no dia seguinte.
        byDay[dia].push({ ...item, start, end: 1440 });
        byDay[(dia + 1) % 7].push({ ...item, start: 0, end });
      }
    }
  }
  const axis = `<div class="pp-agenda-axis-row"><div class="pp-agenda-daylabel"></div><div class="pp-agenda-axis">${AGENDA_HOUR_LABELS.map((h) => `<span style="left:${(h / 24) * 100}%">${String(h).padStart(2, "0")}</span>`).join("")}</div></div>`;
  const today = new Date().getDay();
  const days = DIA_SEMANA_LABEL.map((label, dia) => {
    const items = byDay[dia];
    const lanes = assignAgendaLanes(items);
    const laneHeight = 26;
    const trackHeight = lanes * laneHeight + (lanes - 1) * 4;
    const blocks = items.map((item) => {
      const left = (item.start / 1440) * 100;
      const width = Math.max(((item.end - item.start) / 1440) * 100, 0.6);
      const top = item.lane * (laneHeight + 4);
      return `<div class="pp-agenda-block" style="left:${left}%;width:${width}%;top:${top}px;height:${laneHeight}px" title="${pesc(paradaAgendaTitle(item))}">${pesc(item.tipos_parada_programada?.nome || "—")}</div>`;
    }).join("");
    return `<div class="pp-agenda-day-row${dia === today ? " pp-agenda-today" : ""}"><div class="pp-agenda-daylabel">${label}</div><div class="pp-agenda-track" style="height:${trackHeight}px">${blocks}</div></div>`;
  }).join("");
  pq("#pp-agenda-grid").innerHTML = axis + days;
}
async function loadParadaAgenda(areaId) {
  const grid = pq("#pp-agenda-grid");
  const hint = pq("#pp-agenda-hint");
  const empty = pq("#pp-agenda-empty");
  const loading = pq("#pp-agenda-loading");
  grid.hidden = true;
  empty.hidden = true;
  hint.hidden = true;
  if (!areaId) { hint.hidden = false; return; }
  loading.hidden = false;
  try {
    const { data, error } = await window.supabaseClient
      .from("paradas_programadas")
      .select("linha_maquina_id,turno,horario_inicial,horario_final,dias_semana,linhas_maquinas_producao(nome),equipamentos_planejamento(nome),tipos_parada_programada(nome)")
      .eq("area_id", areaId)
      .is("vigencia_fim", null);
    if (error) throw error;
    const rows = data || [];
    if (!rows.length) { empty.hidden = false; return; }
    renderParadaAgenda(rows);
    grid.hidden = false;
  } finally {
    loading.hidden = true;
  }
}

async function loadParadaProgramadaList() {
  pq("#parada-programada-list-loading").hidden = false;
  pq("#parada-programada-list-table").hidden = true;
  pq("#parada-programada-list-title").textContent = ppListMode === "vigentes"
    ? "Paradas programadas vigentes" : "Paradas programadas encerradas";
  let query = window.supabaseClient
    .from("paradas_programadas")
    .select("id,linha_maquina_id,turno,horario_inicial,horario_final,dias_semana,vigencia_inicio,vigencia_fim,areas_checklist(nome),linhas_maquinas_producao(nome),equipamentos_planejamento(nome),tipos_parada_programada(nome)");
  const areaFiltro = pq("#pp-setor-filtro")?.value;
  if (areaFiltro) query = query.eq("area_id", areaFiltro);
  query = ppListMode === "vigentes"
    ? query.is("vigencia_fim", null).order("area_id")
    : query.not("vigencia_fim", "is", null).order("vigencia_fim", { ascending: false });
  const { data, error } = await query;
  if (error) throw error;
  const rows = data || [];
  const canEncerrar = ppPermissions.has("paradas_programadas.encerrar") && ppListMode === "vigentes";
  const canExcluir = ppPermissions.has("paradas_programadas.excluir");
  pq("#parada-programada-list-rows").innerHTML = rows.map((item) => `<tr data-parada-id="${item.id}">
      <td>${pesc(item.areas_checklist?.nome || "—")}</td>
      <td>${pesc(item.linhas_maquinas_producao?.nome || item.equipamentos_planejamento?.nome || "Geral")}</td>
      <td>${pesc(item.turno || "Todos")}</td>
      <td>${pesc(item.tipos_parada_programada?.nome || "—")}</td>
      <td>${formatHorario(item.horario_inicial)} às ${formatHorario(item.horario_final)}</td>
      <td>${(item.dias_semana || []).slice().sort().map((d) => DIA_SEMANA_LABEL[d]).join(", ")}</td>
      <td>${formatVigencia(item)}</td>
      <td>
        ${canEncerrar ? `<button type="button" class="button button-secondary parada-programada-encerrar" data-parada-id="${item.id}">Encerrar</button>` : ""}
        ${canExcluir ? `<button type="button" class="button button-danger parada-programada-excluir" data-parada-id="${item.id}">Excluir</button>` : ""}
      </td>
    </tr>`).join("");
  pq("#parada-programada-list-loading").hidden = true;
  pq("#parada-programada-list-table").hidden = false;
  pq("#parada-programada-list-empty").hidden = rows.length > 0;
}

async function encerrarParadaProgramada(button) {
  const row = button.closest("tr");
  const id = Number(button.dataset.paradaId);
  if (!confirm("Encerrar esta parada programada a partir de hoje?")) return;
  button.disabled = true;
  try {
    const { error } = await window.supabaseClient.rpc("encerrar_parada_programada", { p_id: id });
    if (error) throw error;
    row.remove();
    pq("#parada-programada-list-empty").hidden = pq("#parada-programada-list-rows").children.length > 0;
    paradaProgramadaMessage("Parada programada encerrada com sucesso.");
  } catch (error) {
    paradaProgramadaMessage(error.message, "error");
    button.disabled = false;
  }
}

async function excluirParadaProgramada(button) {
  const row = button.closest("tr");
  const id = Number(button.dataset.paradaId);
  if (!confirm("Excluir definitivamente esta parada programada? Essa ação não pode ser desfeita.")) return;
  button.disabled = true;
  try {
    const { error } = await window.supabaseClient.rpc("excluir_parada_programada", { p_id: id });
    if (error) throw error;
    row.remove();
    pq("#parada-programada-list-empty").hidden = pq("#parada-programada-list-rows").children.length > 0;
    paradaProgramadaMessage("Parada programada excluída com sucesso.");
  } catch (error) {
    paradaProgramadaMessage(error.message, "error");
    button.disabled = false;
  }
}

function collectUnidades(form) {
  if (pq("#pp-unidade-geral").checked) return [{ linhaId: null, equipamentoId: null }];
  return [...form.querySelectorAll('[name="unidade_especifica"]:checked')].map((el) => ({
    linhaId: el.value.startsWith("linha:") ? Number(el.value.slice(6)) : null,
    equipamentoId: el.value.startsWith("equip:") ? Number(el.value.slice(6)) : null
  }));
}
// Sem nenhum turno marcado, usa o horário único (turno=null, vale pra
// qualquer turno). Marcando turnos, cada um vira uma parada programada
// própria, com seu próprio horário.
function collectTurnos(form) {
  const ativos = [...form.querySelectorAll(".pp-turno-check:checked")];
  if (!ativos.length) {
    const horarioInicial = pq("#pp-horario-inicial").value;
    const horarioFinal = pq("#pp-horario-final").value;
    if (!horarioInicial || !horarioFinal) throw new Error("Informe o horário único ou marque ao menos um turno com horário próprio.");
    return [{ turno: null, horarioInicial, horarioFinal }];
  }
  return ativos.map((checkbox) => {
    const turno = checkbox.value;
    const horarioInicial = form.elements[`horario_inicial_${turno}`].value;
    const horarioFinal = form.elements[`horario_final_${turno}`].value;
    if (!horarioInicial || !horarioFinal) throw new Error(`Informe o horário de início e fim do turno ${TURNO_LABEL[turno] || turno}.`);
    return { turno, horarioInicial, horarioFinal };
  });
}
function updateTurnoUI() {
  const anyChecked = document.querySelectorAll(".pp-turno-check:checked").length > 0;
  pq("#pp-horario-unico-row").hidden = anyChecked;
  pq("#pp-horario-inicial").required = !anyChecked;
  pq("#pp-horario-final").required = !anyChecked;
}
function resetParadaProgramadaForm(form) {
  form.elements.recorrencia.value = "recorrente";
  pq("#pp-vigencia-fim-field").hidden = true;
  pq("#pp-vigencia-fim").required = false;
  pq("#pp-vigencia-fim").value = "";
  pq("#pp-unidade-geral").checked = true;
  for (const checkbox of form.querySelectorAll('[name="unidade_especifica"]')) checkbox.checked = false;
  for (const checkbox of form.querySelectorAll(".pp-turno-check")) {
    checkbox.checked = false;
    const turno = checkbox.value;
    for (const input of [form.elements[`horario_inicial_${turno}`], form.elements[`horario_final_${turno}`]]) {
      input.disabled = true;
      input.required = false;
      input.value = "";
    }
  }
  pq("#pp-horario-inicial").value = "";
  pq("#pp-horario-final").value = "";
  updateTurnoUI();
}

async function initializeParadasProgramadasAdmin() {
  const user = await window.LIDUTEC_APP.requireAuthenticatedUser();
  if (!user) return;
  const [profile, permissions] = await Promise.all([
    window.LIDUTEC_APP.getCurrentUserProfile(user.id),
    window.LIDUTEC_APP.getUserPermissions(user.id)
  ]);
  if (!profile || profile.status !== "ATIVO") { alert("Seu usuário não possui acesso ativo."); await window.LIDUTEC_APP.signOut(); return; }
  ppPermissions = permissions;
  const canView = permissions.has("metas.visualizar") || permissions.has("metas.gerenciar") ||
    permissions.has("paradas_programadas.criar") || permissions.has("paradas_programadas.encerrar");
  if (!canView) { location.replace("../dashboard.html"); return; }
  window.LIDUTEC_APP.applyPermissionVisibility(permissions);
  pq("#user-name").textContent = profile.nome;
  pq("#user-profile").textContent = profile.perfil;
  pq("#user-avatar").textContent = profile.nome[0];

  pq("#pp-vigencia").value = new Date().toISOString().slice(0, 10);
  await loadParadaProgramadaAreas();
  await loadParadaProgramadaList();

  pq("#pp-area").addEventListener("change", (event) => loadParadaProgramadaUnidades(event.target.value).catch((error) => paradaProgramadaMessage(error.message, "error")));
  pq("#pp-setor-filtro").addEventListener("change", (event) => {
    loadParadaAgenda(event.target.value).catch((error) => paradaProgramadaMessage(error.message, "error"));
    loadParadaProgramadaList().catch((error) => paradaProgramadaMessage(error.message, "error"));
  });
  for (const radio of document.querySelectorAll('[name="recorrencia"]')) {
    radio.addEventListener("change", () => {
      const dataValidade = pq('[name="recorrencia"]:checked').value === "data_validade";
      pq("#pp-vigencia-fim-field").hidden = !dataValidade;
      pq("#pp-vigencia-fim").required = dataValidade;
      if (!dataValidade) pq("#pp-vigencia-fim").value = "";
    });
  }
  for (const tabButton of document.querySelectorAll(".pp-tab")) {
    tabButton.addEventListener("click", () => {
      if (tabButton.dataset.ppTab === ppListMode) return;
      ppListMode = tabButton.dataset.ppTab;
      for (const button of document.querySelectorAll(".pp-tab")) button.classList.toggle("active", button === tabButton);
      loadParadaProgramadaList().catch((error) => paradaProgramadaMessage(error.message, "error"));
    });
  }
  pq("#parada-programada-list-rows").addEventListener("click", (event) => {
    const encerrarButton = event.target.closest(".parada-programada-encerrar");
    if (encerrarButton) { encerrarParadaProgramada(encerrarButton); return; }
    const excluirButton = event.target.closest(".parada-programada-excluir");
    if (excluirButton) excluirParadaProgramada(excluirButton);
  });
  const paradaForm = pq("#parada-programada-form");
  paradaForm.addEventListener("change", (event) => {
    if (event.target.matches(".pp-turno-check")) {
      const turno = event.target.value;
      const inicialInput = paradaForm.elements[`horario_inicial_${turno}`];
      const finalInput = paradaForm.elements[`horario_final_${turno}`];
      inicialInput.disabled = finalInput.disabled = !event.target.checked;
      inicialInput.required = finalInput.required = event.target.checked;
      if (!event.target.checked) { inicialInput.value = ""; finalInput.value = ""; }
      updateTurnoUI();
    }
    if (event.target.id === "pp-unidade-geral" && event.target.checked) {
      for (const checkbox of paradaForm.querySelectorAll('[name="unidade_especifica"]')) checkbox.checked = false;
    }
    if (event.target.matches('[name="unidade_especifica"]') && event.target.checked) {
      pq("#pp-unidade-geral").checked = false;
    }
  });
  updateTurnoUI();
  paradaForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    try {
      const form = event.currentTarget;
      const areaId = Number(form.elements.area_id.value);
      const tipoParadaCodigo = form.elements.tipo_parada_codigo.value;
      const vigenciaInicio = form.elements.vigencia_inicio.value;
      const recorrente = form.elements.recorrencia.value === "recorrente";
      const vigenciaFim = recorrente ? null : form.elements.vigencia_fim.value;
      const diasSemana = [...form.querySelectorAll('[name="dias_semana"]:checked')].map((el) => Number(el.value));
      if (!areaId || !tipoParadaCodigo || !vigenciaInicio) throw new Error("Preencha setor, tipo e vigência.");
      if (!diasSemana.length) throw new Error("Selecione ao menos um dia da semana.");
      if (!recorrente && !vigenciaFim) throw new Error("Informe a data de validade ou marque como recorrente.");
      if (!recorrente && vigenciaFim < vigenciaInicio) throw new Error("A data de validade não pode ser anterior ao início da vigência.");
      const unidades = collectUnidades(form);
      if (!unidades.length) throw new Error("Selecione ao menos uma unidade de trabalho (ou Geral).");
      const turnos = collectTurnos(form);

      let criadas = 0;
      let loopError = null;
      for (const unidade of unidades) {
        for (const turnoEntry of turnos) {
          const { error } = await window.supabaseClient.rpc("definir_parada_programada", {
            p_area_id: areaId, p_linha_maquina_id: unidade.linhaId, p_equipamento_planejamento_id: unidade.equipamentoId,
            p_turno: turnoEntry.turno, p_tipo_parada_codigo: tipoParadaCodigo,
            p_horario_inicial: turnoEntry.horarioInicial, p_horario_final: turnoEntry.horarioFinal,
            p_dias_semana: diasSemana, p_vigencia_inicio: vigenciaInicio, p_vigencia_fim: vigenciaFim
          });
          if (error) { loopError = error; break; }
          criadas += 1;
        }
        if (loopError) break;
      }
      if (criadas) await loadParadaProgramadaList();
      if (loopError) {
        throw new Error(criadas
          ? `${criadas} parada(s) programada(s) salva(s), mas houve um erro nas demais: ${loopError.message}`
          : loopError.message);
      }
      paradaProgramadaMessage(criadas > 1 ? `${criadas} paradas programadas salvas com sucesso.` : "Parada programada salva com sucesso.");
      resetParadaProgramadaForm(form);
    } catch (error) {
      paradaProgramadaMessage(error.message, "error");
    } finally {
      button.disabled = false;
    }
  });
  pq("#menu-button").addEventListener("click", () => pq("#sidebar").classList.toggle("open"));
  pq("#logout-button").addEventListener("click", () => window.LIDUTEC_APP.signOut());
}

initializeParadasProgramadasAdmin().catch((error) => {
  const loading = pq("#parada-programada-list-loading");
  if (loading) loading.textContent = error.message;
  else alert(error.message);
});
