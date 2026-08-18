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

const newRevisionLink = document.querySelector("#new-revision-link");
const sendApprovalButton = document.querySelector("#send-approval-button");
const rejectButton = document.querySelector("#reject-button");
const approveButton = document.querySelector("#approve-button");
const revisionsList = document.querySelector("#revisions-list");
const historyList = document.querySelector("#history-list");

const STATUS_LABELS = {
  EM_ELABORACAO: "Em elaboração",
  EM_REVISAO: "Em revisão",
  AGUARDANDO_APROVACAO: "Aguardando aprovação",
  APROVADO: "Aprovado",
  VIGENTE: "Vigente",
  OBSOLETO: "Obsoleto"
};

// Estado da tela atual — preenchido em initializeSgiDetalhes/showDocument e
// usado pelos handlers de clique dos botões de ação (revisão/aprovação).
const viewState = {
  userId: null,
  permissions: null,
  documento: null,
  aprovacaoPendenteId: null
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

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function updateActionButtons(documento) {
  const permissions = viewState.permissions;

  const canCreateRevision = permissions.has("sgi.criar") && documento.status === "VIGENTE";
  newRevisionLink.hidden = !canCreateRevision;
  if (canCreateRevision) newRevisionLink.href = `./cadastro.html?revisao_de=${documento.id}`;

  const canSendApproval = permissions.has("sgi.enviar_aprovacao")
    && documento.status === "EM_ELABORACAO"
    && documento.elaborado_por === viewState.userId;
  sendApprovalButton.hidden = !canSendApproval;

  const canDecide = permissions.has("sgi.aprovar") && documento.status === "AGUARDANDO_APROVACAO";
  approveButton.hidden = !canDecide;
  rejectButton.hidden = !canDecide;
}

function renderRevisions(revisoes, documentoAtualId) {
  if (!revisoes.length) {
    revisionsList.innerHTML = `<li class="sgi-list-empty">Nenhuma revisão encontrada.</li>`;
    return;
  }
  revisionsList.innerHTML = revisoes.map((revisao) => {
    const atual = revisao.id === documentoAtualId;
    const data = new Date(revisao.criado_em).toLocaleString("pt-BR");
    const label = `Rev. ${String(revisao.numero_revisao).padStart(2, "0")} — ${STATUS_LABELS[revisao.status] ?? revisao.status}`;
    return `
      <li>
        ${atual
          ? `<strong>${escapeHtml(label)} (esta revisão)</strong>`
          : `<a href="./detalhes.html?id=${revisao.id}">${escapeHtml(label)}</a>`}
        <span class="sgi-list-meta">${escapeHtml(data)}</span>
      </li>
    `;
  }).join("");
}

function renderHistory(eventos) {
  if (!eventos.length) {
    historyList.innerHTML = `<li class="sgi-list-empty">Nenhum evento registrado.</li>`;
    return;
  }
  historyList.innerHTML = eventos.map((evento) => {
    const data = new Date(evento.criado_em).toLocaleString("pt-BR");
    const usuario = evento.usuarios?.nome ?? "Sistema";
    return `
      <li>
        <strong>${escapeHtml(evento.acao)}</strong>
        <span class="sgi-list-meta">${escapeHtml(usuario)} · ${escapeHtml(data)}</span>
        ${evento.descricao ? `<span class="sgi-list-meta">${escapeHtml(evento.descricao)}</span>` : ""}
      </li>
    `;
  }).join("");
}

async function handleSendApproval() {
  if (!confirm("Enviar este documento para aprovação da área responsável?")) return;
  try {
    await window.LIDUTEC_SGI_DATA.enviarParaAprovacao(viewState.documento.id);
    window.location.reload();
  } catch (error) {
    alert(`Não foi possível enviar para aprovação: ${error.message}`);
  }
}

async function handleDecision(resultado) {
  if (!viewState.aprovacaoPendenteId) {
    alert("Solicitação de aprovação não encontrada.");
    return;
  }
  const acao = resultado === "APROVADO" ? "aprovar" : "reprovar";
  const comentario = prompt(`Comentário sobre a decisão (opcional) — ${acao} este documento:`, "");
  if (comentario === null) return;
  try {
    await window.LIDUTEC_SGI_DATA.decidirAprovacao(viewState.aprovacaoPendenteId, resultado, comentario.trim() || null);
    window.location.reload();
  } catch (error) {
    alert(`Não foi possível registrar a decisão: ${error.message}`);
  }
}

async function showDocument(documento) {
  viewState.documento = documento;

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

  updateActionButtons(documento);

  if (documento.status === "AGUARDANDO_APROVACAO" && viewState.permissions.has("sgi.aprovar")) {
    const aprovacao = await window.LIDUTEC_SGI_DATA.aprovacaoPendente(documento.id);
    viewState.aprovacaoPendenteId = aprovacao?.id ?? null;
  } else {
    viewState.aprovacaoPendenteId = null;
  }

  const [revisoes, eventos] = await Promise.all([
    window.LIDUTEC_SGI_DATA.revisoesDaFamilia(documento.codigo),
    window.LIDUTEC_SGI_DATA.historico(documento.id)
  ]);
  renderRevisions(revisoes, documento.id);
  renderHistory(eventos);

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

  viewState.userId = user.id;
  viewState.permissions = permissions;

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

sendApprovalButton?.addEventListener("click", handleSendApproval);
approveButton?.addEventListener("click", () => handleDecision("APROVADO"));
rejectButton?.addEventListener("click", () => handleDecision("REJEITADO"));

initializeSgiDetalhes().catch((error) => {
  console.error(error);
  documentLoading.hidden = true;
  documentError.hidden = false;
});
