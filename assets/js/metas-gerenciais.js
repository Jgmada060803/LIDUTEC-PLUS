const mq = (selector) => document.querySelector(selector);
const mesc = (value = "") => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const metaState = { areas: [], indicadoresByArea: new Map(), linesByArea: new Map() };

function metaMessage(text, type = "success") {
  const el = mq("#meta-message");
  el.textContent = text;
  el.className = `form-message ${type}`;
  el.hidden = false;
}

async function loadAreas() {
  const { data, error } = await window.supabaseClient.from("areas_checklist").select("id,codigo,nome").order("ordem");
  if (error) throw error;
  metaState.areas = data || [];
  mq("#meta-area").insertAdjacentHTML("beforeend", metaState.areas.map((a) => `<option value="${a.id}">${mesc(a.nome)}</option>`).join(""));
}

async function loadAreaContext(areaId) {
  const indicadorSelect = mq("#meta-indicador");
  const linhaSelect = mq("#meta-linha");
  if (!areaId) {
    indicadorSelect.innerHTML = '<option value="">Selecione o setor primeiro</option>';
    indicadorSelect.disabled = true;
    linhaSelect.innerHTML = '<option value="">Todas as linhas</option>';
    return;
  }
  const [{ data: indicadores, error: indicadoresError }, { data: lines, error: linesError }] = await Promise.all([
    window.supabaseClient.from("indicadores_metas").select("codigo,nome,unidade").eq("area_id", areaId).eq("ativo", true).order("nome"),
    window.supabaseClient.from("linhas_maquinas_producao").select("id,nome").eq("area_id", areaId).eq("ativo", true).order("codigo")
  ]);
  if (indicadoresError) throw indicadoresError;
  if (linesError) throw linesError;
  indicadorSelect.disabled = false;
  indicadorSelect.innerHTML = '<option value="">Selecione</option>' + (indicadores || []).map((item) => `<option value="${item.codigo}">${mesc(item.nome)}${item.unidade ? ` (${mesc(item.unidade)})` : ""}</option>`).join("");
  linhaSelect.innerHTML = '<option value="">Todas as linhas</option>' + (lines || []).map((item) => `<option value="${item.id}">${mesc(item.nome)}</option>`).join("");
}

async function loadMetaList() {
  mq("#meta-list-loading").hidden = false;
  mq("#meta-list-table").hidden = true;
  const { data, error } = await window.supabaseClient
    .from("metas_gerenciais")
    .select("valor_planejado,vigencia_inicio,turno,areas_checklist(nome),indicadores_metas(nome,unidade),linhas_maquinas_producao(nome)")
    .is("vigencia_fim", null)
    .order("area_id")
    .order("indicador_codigo");
  if (error) throw error;
  const rows = data || [];
  mq("#meta-list-rows").innerHTML = rows.map((item) => `<tr>
      <td>${mesc(item.areas_checklist?.nome || "—")}</td>
      <td>${mesc(item.indicadores_metas?.nome || "—")}</td>
      <td>${mesc(item.linhas_maquinas_producao?.nome || "Todas as linhas")}</td>
      <td>${mesc(item.turno || "Todos")}</td>
      <td>${Number(item.valor_planejado).toLocaleString("pt-BR")}${item.indicadores_metas?.unidade ? ` ${mesc(item.indicadores_metas.unidade)}` : ""}</td>
      <td>${new Date(`${item.vigencia_inicio}T12:00:00`).toLocaleDateString("pt-BR")}</td>
    </tr>`).join("");
  mq("#meta-list-loading").hidden = true;
  mq("#meta-list-table").hidden = false;
  mq("#meta-list-empty").hidden = rows.length > 0;
}

async function initializeMetasGerenciais() {
  const user = await window.LIDUTEC_APP.requireAuthenticatedUser();
  if (!user) return;
  const [profile, permissions] = await Promise.all([
    window.LIDUTEC_APP.getCurrentUserProfile(user.id),
    window.LIDUTEC_APP.getUserPermissions(user.id)
  ]);
  if (!profile || profile.status !== "ATIVO") { alert("Seu usuário não possui acesso ativo."); await window.LIDUTEC_APP.signOut(); return; }
  if (!permissions.has("metas.gerenciar")) { location.replace("../dashboard.html"); return; }
  window.LIDUTEC_APP.applyPermissionVisibility(permissions);
  mq("#user-name").textContent = profile.nome;
  mq("#user-profile").textContent = profile.perfil;
  mq("#user-avatar").textContent = profile.nome[0];

  mq("#meta-vigencia").value = new Date().toISOString().slice(0, 10);
  await loadAreas();
  await loadMetaList();

  mq("#meta-area").addEventListener("change", (event) => loadAreaContext(event.target.value).catch((error) => metaMessage(error.message, "error")));
  mq("#meta-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    try {
      const form = event.currentTarget;
      const areaId = Number(form.elements.area_id.value);
      const indicadorCodigo = form.elements.indicador_codigo.value;
      const linhaId = form.elements.linha_maquina_id.value ? Number(form.elements.linha_maquina_id.value) : null;
      const turno = form.elements.turno.value || null;
      const valor = Number(form.elements.valor.value);
      const vigenciaInicio = form.elements.vigencia_inicio.value;
      if (!areaId || !indicadorCodigo || !vigenciaInicio) throw new Error("Preencha setor, indicador e vigência.");
      const { error } = await window.supabaseClient.rpc("definir_meta_gerencial", {
        p_area_id: areaId, p_linha_maquina_id: linhaId, p_turno: turno,
        p_indicador_codigo: indicadorCodigo, p_valor: valor, p_vigencia_inicio: vigenciaInicio
      });
      if (error) throw error;
      metaMessage("Meta salva com sucesso.");
      await loadMetaList();
    } catch (error) {
      metaMessage(error.message, "error");
    } finally {
      button.disabled = false;
    }
  });
  mq("#menu-button").addEventListener("click", () => mq("#sidebar").classList.toggle("open"));
  mq("#logout-button").addEventListener("click", () => window.LIDUTEC_APP.signOut());
}

initializeMetasGerenciais().catch((error) => {
  const loading = mq("#meta-list-loading");
  if (loading) loading.textContent = error.message;
  else alert(error.message);
});
