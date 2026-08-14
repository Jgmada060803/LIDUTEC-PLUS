const sidebar = document.querySelector("#sidebar");
const menuButton = document.querySelector("#menu-button");
const logoutButton = document.querySelector("#logout-button");

const userName = document.querySelector("#user-name");
const userProfile = document.querySelector("#user-profile");
const userAvatar = document.querySelector("#user-avatar");

const documentLoading = document.querySelector("#document-loading");
const documentContent = document.querySelector("#document-content");
const documentError = document.querySelector("#document-error");
const documentTitle = document.querySelector("#document-title");
const documentSubtitle = document.querySelector("#document-subtitle");
const documentFrame = document.querySelector("#document-frame");
const openFullPageLink = document.querySelector("#open-fullpage-link");

const STATUS_LABELS = {
  EM_ELABORACAO: "Em elaboração",
  EM_REVISAO: "Em revisão",
  AGUARDANDO_APROVACAO: "Aguardando aprovação",
  APROVADO: "Aprovado",
  VIGENTE: "Vigente",
  OBSOLETO: "Obsoleto"
};

function getInitials(name = "Usuário") {
  return name.trim().split(/\s+/).slice(0, 2)
    .map((part) => part[0]?.toUpperCase()).join("");
}

function getDocumentId() {
  return new URLSearchParams(window.location.search).get("id");
}

function setText(selector, value) {
  const element = document.querySelector(selector);
  if (element) element.textContent = value ?? "—";
}

async function showDocument(documento) {
  documentTitle.textContent = `${documento.codigo} — ${documento.titulo}`;
  documentSubtitle.textContent = documento.sgi_tipos_documento?.nome ?? "";

  setText("#meta-codigo", documento.codigo);
  setText("#meta-tipo", documento.sgi_tipos_documento?.nome);
  setText("#meta-revisao", `Rev. ${String(documento.numero_revisao).padStart(2, "0")}`);
  setText("#meta-status", STATUS_LABELS[documento.status] ?? documento.status);
  setText("#meta-area", documento.sgi_areas?.nome);
  setText("#meta-processo", documento.processo_setor);
  setText("#meta-origem", documento.origem === "EXTERNO" ? "Externo / não editável" : "Interno / controlado");
  setText("#meta-palavras-chave", documento.palavras_chave);
  setText("#meta-atualizado", new Date(documento.atualizado_em).toLocaleString("pt-BR"));
  setText("#meta-observacoes", documento.observacoes);

  if (documento.arquivo_oficial?.caminho_relativo) {
    const url = await window.LIDUTEC_SGI_DATA.arquivoUrl(documento.arquivo_oficial.caminho_relativo);
    documentFrame.src = url;
    openFullPageLink.href = url;
    openFullPageLink.hidden = false;
  }

  documentLoading.hidden = true;
  documentContent.hidden = false;
}

async function initializeSgiDetalhes() {
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

  const documentId = getDocumentId();
  if (!documentId) {
    window.location.replace("./index.html");
    return;
  }

  const documento = await window.LIDUTEC_SGI_DATA.obter(documentId);
  if (!documento) {
    documentLoading.hidden = true;
    documentError.hidden = false;
    return;
  }

  await showDocument(documento);
}

menuButton?.addEventListener("click", () => {
  sidebar?.classList.toggle("open");
});
logoutButton?.addEventListener("click", async () => {
  await window.LIDUTEC_APP.signOut();
});

initializeSgiDetalhes().catch((error) => {
  console.error(error);
  documentLoading.hidden = true;
  documentError.hidden = false;
});
