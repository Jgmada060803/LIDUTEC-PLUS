const mq = (selector) => document.querySelector(selector);
const mesc = (value = "") => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const metaState = { areas: [], indicadoresByArea: new Map(), linesByArea: new Map() };
const DIA_SEMANA_LABEL = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function paradaProgramadaMessage(text, type = "success") {
  const el = mq("#parada-programada-message");
  el.textContent = text;
  el.className = `form-message ${type}`;
  el.hidden = false;
}

async function loadParadaProgramadaAreas() {
  mq("#pp-area").insertAdjacentHTML("beforeend", metaState.areas.map((a) => `<option value="${a.id}">${mesc(a.nome)}</option>`).join(""));
  const { data, error } = await window.supabaseClient.from("tipos_parada_programada").select("codigo,nome").eq("ativo", true).order("nome");
  if (error) throw error;
  mq("#pp-tipo").insertAdjacentHTML("beforeend", (data || []).map((t) => `<option value="${t.codigo}">${mesc(t.nome)}</option>`).join(""));
}

async function loadParadaProgramadaUnidades(areaId) {
  const unidadeSelect = mq("#pp-unidade");
  unidadeSelect.innerHTML = '<option value="">Geral (toda a área)</option>';
  if (!areaId) return;
  const [{ data: linhas, error: linhasError }, { data: equipamentos, error: equipamentosError }] = await Promise.all([
    window.supabaseClient.from("linhas_maquinas_producao").select("id,nome").eq("area_id", areaId).eq("ativo", true).order("codigo"),
    window.supabaseClient.from("equipamentos_planejamento").select("id,nome").eq("area_id", areaId).eq("ativo", true).order("codigo")
  ]);
  if (linhasError) throw linhasError;
  if (equipamentosError) throw equipamentosError;
  if ((linhas || []).length) {
    unidadeSelect.insertAdjacentHTML("beforeend", `<optgroup label="Linhas">${linhas.map((item) => `<option value="linha:${item.id}">${mesc(item.nome)}</option>`).join("")}</optgroup>`);
  }
  if ((equipamentos || []).length) {
    unidadeSelect.insertAdjacentHTML("beforeend", `<optgroup label="Equipamentos">${equipamentos.map((item) => `<option value="equip:${item.id}">${mesc(item.nome)}</option>`).join("")}</optgroup>`);
  }
}

function formatHorario(value) {
  return String(value || "").slice(0, 5);
}

async function loadParadaProgramadaList() {
  mq("#parada-programada-list-loading").hidden = false;
  mq("#parada-programada-list-table").hidden = true;
  const { data, error } = await window.supabaseClient
    .from("paradas_programadas")
    .select("linha_maquina_id,turno,horario_inicial,horario_final,dias_semana,vigencia_inicio,areas_checklist(nome),linhas_maquinas_producao(nome),equipamentos_planejamento(nome),tipos_parada_programada(nome)")
    .is("vigencia_fim", null)
    .order("area_id");
  if (error) throw error;
  const rows = data || [];
  mq("#parada-programada-list-rows").innerHTML = rows.map((item) => `<tr>
      <td>${mesc(item.areas_checklist?.nome || "—")}</td>
      <td>${mesc(item.linhas_maquinas_producao?.nome || item.equipamentos_planejamento?.nome || "Geral")}</td>
      <td>${mesc(item.turno || "Todos")}</td>
      <td>${mesc(item.tipos_parada_programada?.nome || "—")}</td>
      <td>${formatHorario(item.horario_inicial)} às ${formatHorario(item.horario_final)}</td>
      <td>${(item.dias_semana || []).slice().sort().map((d) => DIA_SEMANA_LABEL[d]).join(", ")}</td>
      <td>${new Date(`${item.vigencia_inicio}T12:00:00`).toLocaleDateString("pt-BR")}</td>
    </tr>`).join("");
  mq("#parada-programada-list-loading").hidden = true;
  mq("#parada-programada-list-table").hidden = false;
  mq("#parada-programada-list-empty").hidden = rows.length > 0;
}

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
  mq("#pp-vigencia").value = new Date().toISOString().slice(0, 10);
  await loadAreas();
  await loadMetaList();
  await loadParadaProgramadaAreas();
  await loadParadaProgramadaList();

  mq("#meta-area").addEventListener("change", (event) => loadAreaContext(event.target.value).catch((error) => metaMessage(error.message, "error")));
  mq("#pp-area").addEventListener("change", (event) => loadParadaProgramadaUnidades(event.target.value).catch((error) => paradaProgramadaMessage(error.message, "error")));
  mq("#parada-programada-form").addEventListener("submit", async (event) => {
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
