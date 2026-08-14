const sidebar = document.querySelector("#sidebar");
const menuButton = document.querySelector("#menu-button");
const logoutButton = document.querySelector("#logout-button");

const userName = document.querySelector("#user-name");
const userProfile = document.querySelector("#user-profile");
const userAvatar = document.querySelector("#user-avatar");

const searchInput = document.querySelector("#sgi-search");
const resultsWrapper = document.querySelector("#sgi-results-wrapper");
const resultsBody = document.querySelector("#sgi-results-body");
const resultsEmpty = document.querySelector("#sgi-search-empty");

let allDocuments = [];

function getInitials(name = "Usuário") {
  return name.trim().split(/\s+/).slice(0, 2)
    .map((part) => part[0]?.toUpperCase()).join("");
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const STATUS_LABELS = {
  EM_ELABORACAO: "Em elaboração",
  EM_REVISAO: "Em revisão",
  AGUARDANDO_APROVACAO: "Aguardando aprovação",
  APROVADO: "Aprovado",
  VIGENTE: "Vigente",
  OBSOLETO: "Obsoleto"
};

function normalize(value) {
  return String(value || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function matchesSearch(documento, search) {
  const searchable = [
    documento.codigo,
    documento.titulo,
    documento.palavras_chave,
    documento.processo_setor,
    documento.sgi_tipos_documento?.nome,
    documento.sgi_tipos_documento?.codigo,
    documento.sgi_areas?.nome
  ].filter(Boolean).join(" ");
  return normalize(searchable).includes(search);
}

function renderResults(documentos) {
  if (!documentos.length) {
    resultsWrapper.hidden = true;
    resultsEmpty.hidden = false;
    return;
  }
  resultsEmpty.hidden = true;
  resultsWrapper.hidden = false;

  resultsBody.innerHTML = documentos.map((documento) => `
    <tr>
      <td><strong>${escapeHtml(documento.codigo)}</strong></td>
      <td>${escapeHtml(documento.titulo)}</td>
      <td>${escapeHtml(documento.sgi_tipos_documento?.nome ?? "—")}</td>
      <td>Rev. ${String(documento.numero_revisao).padStart(2, "0")}</td>
      <td><span class="sgi-status-badge sgi-status-${documento.status.toLowerCase()}">${STATUS_LABELS[documento.status] ?? documento.status}</span></td>
      <td>${escapeHtml(documento.sgi_areas?.nome ?? "—")}</td>
      <td>${documento.origem === "EXTERNO" ? "Externo" : "Interno"}</td>
      <td>${new Date(documento.atualizado_em).toLocaleDateString("pt-BR")}</td>
      <td><a href="./detalhes.html?id=${documento.id}" class="table-action">Abrir</a></td>
    </tr>
  `).join("");
}

function handleSearchInput() {
  const search = normalize(searchInput.value.trim());
  const filtered = search
    ? allDocuments.filter((documento) => matchesSearch(documento, search))
    : allDocuments;
  renderResults(filtered);
}

searchInput.addEventListener("input", handleSearchInput);

async function initializeSgiLista() {
  const user = await window.LIDUTEC_APP.requireAuthenticatedUser();
  if (!user) return;

  const profile = await window.LIDUTEC_APP.getCurrentUserProfile(user.id);
  if (!profile || profile.status !== "ATIVO") return;

  const permissions = await window.LIDUTEC_APP.getUserPermissions(user.id);
  if (!permissions.has("sgi.visualizar")) {
    alert("Você não possui permissão para visualizar o SGI.");
    window.location.replace("../dashboard.html");
    return;
  }
  window.LIDUTEC_APP.applyPermissionVisibility(permissions);

  userName.textContent = profile.nome;
  userProfile.textContent = profile.perfil ?? "Usuário";
  userAvatar.textContent = getInitials(profile.nome);

  allDocuments = await window.LIDUTEC_SGI_DATA.listar();
  renderResults(allDocuments);
}

menuButton?.addEventListener("click", () => {
  sidebar?.classList.toggle("open");
});
logoutButton?.addEventListener("click", async () => {
  await window.LIDUTEC_APP.signOut();
});

initializeSgiLista().catch((error) => console.error(error));
