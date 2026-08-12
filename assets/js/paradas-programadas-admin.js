const pq = (selector) => document.querySelector(selector);
const pesc = (value = "") => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const DIA_SEMANA_LABEL = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
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
  pq("#pp-area").insertAdjacentHTML("beforeend", (areas || []).map((a) => `<option value="${a.id}">${pesc(a.nome)}</option>`).join(""));
  const { data, error } = await window.supabaseClient.from("tipos_parada_programada").select("codigo,nome").eq("ativo", true).order("nome");
  if (error) throw error;
  pq("#pp-tipo").insertAdjacentHTML("beforeend", (data || []).map((t) => `<option value="${t.codigo}">${pesc(t.nome)}</option>`).join(""));
}

async function loadParadaProgramadaUnidades(areaId) {
  const unidadeSelect = pq("#pp-unidade");
  unidadeSelect.innerHTML = '<option value="">Geral (toda a área)</option>';
  if (!areaId) return;
  const [{ data: linhas, error: linhasError }, { data: equipamentos, error: equipamentosError }] = await Promise.all([
    window.supabaseClient.from("linhas_maquinas_producao").select("id,nome").eq("area_id", areaId).eq("ativo", true).order("codigo"),
    window.supabaseClient.from("equipamentos_planejamento").select("id,nome").eq("area_id", areaId).eq("ativo", true).order("codigo")
  ]);
  if (linhasError) throw linhasError;
  if (equipamentosError) throw equipamentosError;
  if ((linhas || []).length) {
    unidadeSelect.insertAdjacentHTML("beforeend", `<optgroup label="Linhas">${linhas.map((item) => `<option value="linha:${item.id}">${pesc(item.nome)}</option>`).join("")}</optgroup>`);
  }
  if ((equipamentos || []).length) {
    unidadeSelect.insertAdjacentHTML("beforeend", `<optgroup label="Equipamentos">${equipamentos.map((item) => `<option value="equip:${item.id}">${pesc(item.nome)}</option>`).join("")}</optgroup>`);
  }
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

async function loadParadaProgramadaList() {
  pq("#parada-programada-list-loading").hidden = false;
  pq("#parada-programada-list-table").hidden = true;
  pq("#parada-programada-list-title").textContent = ppListMode === "vigentes"
    ? "Paradas programadas vigentes" : "Paradas programadas encerradas";
  let query = window.supabaseClient
    .from("paradas_programadas")
    .select("id,linha_maquina_id,turno,horario_inicial,horario_final,dias_semana,vigencia_inicio,vigencia_fim,areas_checklist(nome),linhas_maquinas_producao(nome),equipamentos_planejamento(nome),tipos_parada_programada(nome)");
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
  pq("#parada-programada-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    try {
      const form = event.currentTarget;
      const areaId = Number(form.elements.area_id.value);
      const unidadeValue = form.elements.unidade_trabalho.value;
      const linhaId = unidadeValue.startsWith("linha:") ? Number(unidadeValue.slice(6)) : null;
      const equipamentoId = unidadeValue.startsWith("equip:") ? Number(unidadeValue.slice(6)) : null;
      const turno = form.elements.turno.value || null;
      const tipoParadaCodigo = form.elements.tipo_parada_codigo.value;
      const horarioInicial = form.elements.horario_inicial.value;
      const horarioFinal = form.elements.horario_final.value;
      const vigenciaInicio = form.elements.vigencia_inicio.value;
      const diasSemana = [...form.querySelectorAll('[name="dias_semana"]:checked')].map((el) => Number(el.value));
      if (!areaId || !tipoParadaCodigo || !horarioInicial || !horarioFinal || !vigenciaInicio) {
        throw new Error("Preencha setor, tipo, horários e vigência.");
      }
      if (!diasSemana.length) throw new Error("Selecione ao menos um dia da semana.");
      const { error } = await window.supabaseClient.rpc("definir_parada_programada", {
        p_area_id: areaId, p_linha_maquina_id: linhaId, p_equipamento_planejamento_id: equipamentoId, p_turno: turno,
        p_tipo_parada_codigo: tipoParadaCodigo, p_horario_inicial: horarioInicial, p_horario_final: horarioFinal,
        p_dias_semana: diasSemana, p_vigencia_inicio: vigenciaInicio
      });
      if (error) throw error;
      paradaProgramadaMessage("Parada programada salva com sucesso.");
      await loadParadaProgramadaList();
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
