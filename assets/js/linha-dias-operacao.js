const ldq = (selector) => document.querySelector(selector);
const ldEsc = (value = "") => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const DIAS_SEMANA_NOMES = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const TURNO_NOMES = { MANHA: "Manhã", TARDE: "Tarde", NOITE: "Noite" };

function ldMessage(text, type = "success") {
  const el = ldq("#linha-dias-message");
  el.textContent = text;
  el.className = `form-message ${type}`;
  el.hidden = false;
}

// "Dias em que opera" fica mais legível como intervalo (ex.: "Seg-Sáb")
// quando os dias marcados são consecutivos, em vez de listar um por um.
function formatDiasSemana(dias) {
  const set = new Set(dias);
  if (set.size === 7) return "Todos os dias";
  const ordenado = [...dias].sort((a, b) => a - b);
  const grupos = [];
  let inicio = null, anterior = null;
  for (const dia of ordenado) {
    if (anterior === null || dia !== anterior + 1) {
      if (inicio !== null) grupos.push([inicio, anterior]);
      inicio = dia;
    }
    anterior = dia;
  }
  if (inicio !== null) grupos.push([inicio, anterior]);
  return grupos.map(([a, b]) => (a === b ? DIAS_SEMANA_NOMES[a] : `${DIAS_SEMANA_NOMES[a]}-${DIAS_SEMANA_NOMES[b]}`)).join(", ");
}

async function loadLinhas() {
  // Por enquanto só o Acabamento de fato usa essa regra (linha_2_ativa_acabamento);
  // Macharia/Moldagem ficam de fora da lista até essa leitura existir nesses fluxos também.
  const { data: area, error: areaError } = await window.supabaseClient
    .from("areas_checklist").select("id").eq("codigo", "ACABAMENTO").single();
  if (areaError) throw areaError;
  const { data, error } = await window.supabaseClient
    .from("linhas_maquinas_producao")
    .select("id,codigo,nome,areas_checklist(nome)")
    .eq("ativo", true)
    .eq("area_id", area.id)
    .order("codigo");
  if (error) throw error;
  ldq("#ld-linha").insertAdjacentHTML("beforeend", (data || [])
    .map((item) => `<option value="${item.id}">${ldEsc(item.areas_checklist?.nome || "—")} — ${ldEsc(item.nome)}</option>`)
    .join(""));
}

async function loadList() {
  ldq("#linha-dias-list-loading").hidden = false;
  ldq("#linha-dias-list-table").hidden = true;
  const { data, error } = await window.supabaseClient
    .from("linha_turno_dias_ativos")
    .select("turno,dias_semana,vigencia_inicio,linhas_maquinas_producao(nome,areas_checklist(nome))")
    .is("vigencia_fim", null)
    .order("linha_maquina_id");
  if (error) throw error;
  const rows = data || [];
  ldq("#linha-dias-list-rows").innerHTML = rows.map((item) => `<tr>
      <td>${ldEsc(item.linhas_maquinas_producao?.areas_checklist?.nome || "—")} — ${ldEsc(item.linhas_maquinas_producao?.nome || "—")}</td>
      <td>${ldEsc(TURNO_NOMES[item.turno] || "Todos")}</td>
      <td>${ldEsc(formatDiasSemana(item.dias_semana))}</td>
      <td>${new Date(`${item.vigencia_inicio}T12:00:00`).toLocaleDateString("pt-BR")}</td>
    </tr>`).join("");
  ldq("#linha-dias-list-loading").hidden = true;
  ldq("#linha-dias-list-table").hidden = false;
  ldq("#linha-dias-list-empty").hidden = rows.length > 0;
}

async function initializeLinhaDiasOperacao() {
  const user = await window.LIDUTEC_APP.requireAuthenticatedUser();
  if (!user) return;
  const [profile, permissions] = await Promise.all([
    window.LIDUTEC_APP.getCurrentUserProfile(user.id),
    window.LIDUTEC_APP.getUserPermissions(user.id)
  ]);
  if (!profile || profile.status !== "ATIVO") { alert("Seu usuário não possui acesso ativo."); await window.LIDUTEC_APP.signOut(); return; }
  if (!permissions.has("metas.gerenciar")) { location.replace("../dashboard.html"); return; }
  window.LIDUTEC_APP.applyPermissionVisibility(permissions);
  ldq("#user-name").textContent = profile.nome;
  ldq("#user-profile").textContent = profile.perfil;
  ldq("#user-avatar").textContent = profile.nome[0];

  ldq("#ld-vigencia").value = new Date().toISOString().slice(0, 10);
  await loadLinhas();
  await loadList();

  ldq("#linha-dias-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    try {
      const form = event.currentTarget;
      const linhaId = Number(form.elements.linha_maquina_id.value);
      const turno = form.elements.turno.value || null;
      const vigenciaInicio = form.elements.vigencia_inicio.value;
      const diasSemana = [...form.querySelectorAll('[name="dias_semana"]:checked')].map((el) => Number(el.value));
      if (!linhaId || !vigenciaInicio) throw new Error("Preencha linha/equipamento e vigência.");
      if (!diasSemana.length) throw new Error("Marque ao menos um dia da semana.");
      const { error } = await window.supabaseClient.rpc("definir_linha_turno_dias_ativos", {
        p_linha_maquina_id: linhaId, p_turno: turno, p_dias_semana: diasSemana, p_vigencia_inicio: vigenciaInicio
      });
      if (error) throw error;
      ldMessage("Regra salva com sucesso.");
      await loadList();
    } catch (error) {
      ldMessage(error.message, "error");
    } finally {
      button.disabled = false;
    }
  });
  ldq("#menu-button").addEventListener("click", () => ldq("#sidebar").classList.toggle("open"));
  ldq("#logout-button").addEventListener("click", () => window.LIDUTEC_APP.signOut());
}

initializeLinhaDiasOperacao().catch((error) => {
  const loading = ldq("#linha-dias-list-loading");
  if (loading) loading.textContent = error.message;
  else alert(error.message);
});
