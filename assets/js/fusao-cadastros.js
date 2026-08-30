const fcq = (selector) => document.querySelector(selector);
const fcEsc = (value = "") => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const MATERIAL_TIPO_NOMES = { SUCATA: "Sucata", RETORNO: "Retorno", CANAL: "Canal", GUSA: "Gusa", ALTERNATIVO: "Alternativo", LIGA_CORRECAO: "Liga/correção", OUTRO: "Outro" };
const MODO_PESAGEM_NOMES = { CARRO: "Carro", PONTE: "Ponte", DIRETO: "Direto" };
const FORNO_TIPO_NOMES = { FUSAO: "Fusão", HOLDING: "Holding" };
const FUSAO_ELEMENTOS = ["c", "si", "mn", "p", "cr", "s", "sn", "cu", "mo", "al", "pb"];
const FUSAO_ELEMENTOS_LABEL = { c: "C", si: "Si", mn: "Mn", p: "P", cr: "Cr", s: "S", sn: "Sn", cu: "Cu", mo: "Mo", al: "Al", pb: "Pb" };

function formatComposicao(item) {
  const partes = FUSAO_ELEMENTOS
    .map((el) => [FUSAO_ELEMENTOS_LABEL[el], item[`pct_${el}`]])
    .filter(([, valor]) => valor != null)
    .map(([label, valor]) => `${label} ${Number(valor).toLocaleString("pt-BR", { maximumFractionDigits: 3 })}`);
  return partes.length ? partes.join(" · ") : "—";
}

function fcMessage(elId, text, type = "success") {
  const el = fcq(elId);
  el.textContent = text;
  el.className = `form-message ${type}`;
  el.hidden = false;
}

async function loadMateriais() {
  const rows = await window.LIDUTEC_PRODUCAO_FUSAO_DATA.materiaisTodos();
  fcq("#materiais-rows").innerHTML = rows.map((item) => `<tr>
      <td>${fcEsc(item.nome)}</td><td>${MATERIAL_TIPO_NOMES[item.tipo] || item.tipo}</td>
      <td>${MODO_PESAGEM_NOMES[item.modo_pesagem] || item.modo_pesagem}</td>
      <td>${fcEsc(formatComposicao(item))}</td>
      <td>${item.ativo ? "Ativo" : "Inativo"}</td>
      <td><button type="button" class="button button-secondary" data-edit-material="${item.id}">Editar</button></td>
    </tr>`).join("");
  fcq("#materiais-rows").querySelectorAll("[data-edit-material]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = rows.find((r) => String(r.id) === button.dataset.editMaterial);
      if (!item) return;
      const form = fcq("#material-form");
      form.elements.id.value = item.id;
      form.elements.nome.value = item.nome;
      form.elements.tipo.value = item.tipo;
      form.elements.modo_pesagem.value = item.modo_pesagem || "CARRO";
      form.elements.ativo.checked = item.ativo;
      for (const el of FUSAO_ELEMENTOS) form.elements[`pct_${el}`].value = item[`pct_${el}`] ?? "";
      fcq("#material-cancel-edit").hidden = false;
    });
  });
}

async function loadFornos() {
  const rows = await window.LIDUTEC_PRODUCAO_FUSAO_DATA.fornosTodos();
  fcq("#fornos-rows").innerHTML = rows.map((item) => `<tr>
      <td>${fcEsc(item.codigo)}</td><td>${fcEsc(item.nome)}</td><td>${FORNO_TIPO_NOMES[item.tipo] || item.tipo}</td>
      <td>${item.carro ? `Carro ${item.carro}` : "—"}</td>
      <td>${item.capacidade_kg != null ? Number(item.capacidade_kg).toLocaleString("pt-BR") : "—"}</td>
      <td>${item.limite_atencao_corridas}</td><td>${item.limite_critico_corridas}</td>
      <td>${item.ativo ? "Ativo" : "Inativo"}</td>
      <td><button type="button" class="button button-secondary" data-edit-forno="${item.id}">Editar</button></td>
    </tr>`).join("");
  fcq("#fornos-rows").querySelectorAll("[data-edit-forno]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = rows.find((r) => String(r.id) === button.dataset.editForno);
      if (!item) return;
      const form = fcq("#forno-form");
      form.elements.id.value = item.id;
      form.elements.codigo.value = item.codigo;
      form.elements.nome.value = item.nome;
      form.elements.tipo.value = item.tipo;
      form.elements.limite_atencao.value = item.limite_atencao_corridas;
      form.elements.limite_critico.value = item.limite_critico_corridas;
      form.elements.capacidade_kg.value = item.capacidade_kg ?? "";
      form.elements.carro.value = item.carro ?? "";
      form.elements.ativo.checked = item.ativo;
      fcq("#forno-cancel-edit").hidden = false;
    });
  });
}

function resetForm(form, cancelButtonId) {
  form.reset();
  form.elements.id.value = "";
  form.elements.ativo.checked = true;
  fcq(cancelButtonId).hidden = true;
}

async function initializeFusaoCadastros() {
  const user = await window.LIDUTEC_APP.requireAuthenticatedUser();
  if (!user) return;
  const [profile, permissions] = await Promise.all([
    window.LIDUTEC_APP.getCurrentUserProfile(user.id),
    window.LIDUTEC_APP.getUserPermissions(user.id)
  ]);
  if (!profile || profile.status !== "ATIVO") { alert("Seu usuário não possui acesso ativo."); await window.LIDUTEC_APP.signOut(); return; }
  if (!permissions.has("producao_fusao.configurar")) { location.replace("../dashboard.html"); return; }
  window.LIDUTEC_APP.applyPermissionVisibility(permissions);
  fcq("#user-name").textContent = profile.nome;
  fcq("#user-profile").textContent = profile.perfil;
  fcq("#user-avatar").textContent = profile.nome[0];

  await Promise.all([loadMateriais(), loadFornos()]);

  fcq("#material-cancel-edit").addEventListener("click", () => resetForm(fcq("#material-form"), "#material-cancel-edit"));
  fcq("#forno-cancel-edit").addEventListener("click", () => resetForm(fcq("#forno-form"), "#forno-cancel-edit"));

  fcq("#material-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = event.submitter;
    button.disabled = true;
    try {
      const composicao = Object.fromEntries(FUSAO_ELEMENTOS.map((el) => [
        `p_pct_${el}`, form.elements[`pct_${el}`].value === "" ? null : Number(form.elements[`pct_${el}`].value)
      ]));
      await window.LIDUTEC_PRODUCAO_FUSAO_DATA.salvarMaterial({
        p_id: form.elements.id.value ? Number(form.elements.id.value) : null,
        p_nome: form.elements.nome.value,
        p_tipo: form.elements.tipo.value, p_ativo: form.elements.ativo.checked,
        p_modo_pesagem: form.elements.modo_pesagem.value,
        ...composicao
      });
      fcMessage("#material-message", "Material salvo com sucesso.");
      resetForm(form, "#material-cancel-edit");
      await loadMateriais();
    } catch (error) {
      fcMessage("#material-message", error.message, "error");
    } finally {
      button.disabled = false;
    }
  });

  fcq("#forno-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = event.submitter;
    button.disabled = true;
    try {
      await window.LIDUTEC_PRODUCAO_FUSAO_DATA.salvarForno({
        p_id: form.elements.id.value ? Number(form.elements.id.value) : null,
        p_codigo: form.elements.codigo.value, p_nome: form.elements.nome.value, p_tipo: form.elements.tipo.value,
        p_limite_atencao: Number(form.elements.limite_atencao.value), p_limite_critico: Number(form.elements.limite_critico.value),
        p_ativo: form.elements.ativo.checked,
        p_carro: form.elements.carro.value ? Number(form.elements.carro.value) : null,
        p_capacidade_kg: form.elements.capacidade_kg.value ? Number(form.elements.capacidade_kg.value) : null
      });
      fcMessage("#forno-message", "Forno salvo com sucesso.");
      resetForm(form, "#forno-cancel-edit");
      await loadFornos();
    } catch (error) {
      fcMessage("#forno-message", error.message, "error");
    } finally {
      button.disabled = false;
    }
  });

  fcq("#menu-button").addEventListener("click", () => fcq("#sidebar").classList.toggle("open"));
  fcq("#logout-button").addEventListener("click", () => window.LIDUTEC_APP.signOut());
}

initializeFusaoCadastros().catch((error) => alert(error.message));
