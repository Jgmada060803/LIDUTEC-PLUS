const sidebar = document.querySelector("#sidebar");
const menuButton = document.querySelector("#menu-button");
const logoutButton = document.querySelector("#logout-button");

const userName = document.querySelector("#user-name");
const userProfile = document.querySelector("#user-profile");
const userAvatar = document.querySelector("#user-avatar");

const externalDocumentForm = document.querySelector("#external-document-form");
const saveButton = document.querySelector("#save-button");
const formMessage = document.querySelector("#form-message");

const arquivoInput = document.querySelector("#arquivo-pdf");
const codigoInput = document.querySelector("#codigo");
const tituloInput = document.querySelector("#titulo");
const tipoDocumentoSelect = document.querySelector("#tipo-documento");
const areaResponsavelSelect = document.querySelector("#area-responsavel");
const processoSetorInput = document.querySelector("#processo-setor");
const palavrasChaveInput = document.querySelector("#palavras-chave");
const observacoesInput = document.querySelector("#observacoes");

function getRevisaoDeId() {
  return new URLSearchParams(window.location.search).get("revisao_de");
}

function getInitials(name = "Usuário") {
  return name.trim().split(/\s+/).slice(0, 2)
    .map((part) => part[0]?.toUpperCase()).join("");
}

function showMessage(text, type = "error") {
  formMessage.textContent = text;
  formMessage.className = `form-message ${type}`;
  formMessage.hidden = false;
}

// Sugestão a partir do nome do arquivo (ex.: "ITF-PRO-005 - Partida a Frio
// dos Fornos ABC.pdf" -> código "ITF-PRO-005", título "Partida a Frio dos
// Fornos ABC") — é só ponto de partida, o usuário confirma ou edita.
function sugerirCodigoTitulo(nomeArquivo) {
  const semExtensao = nomeArquivo.replace(/\.[^.]+$/, "");
  const match = semExtensao.match(/^(\S+)\s*-\s*(.+)$/);
  if (!match) {
    return { codigo: "", titulo: semExtensao.trim() };
  }
  return { codigo: match[1].trim(), titulo: match[2].trim() };
}

arquivoInput.addEventListener("change", () => {
  const file = arquivoInput.files[0];
  if (!file) return;
  const sugestao = sugerirCodigoTitulo(file.name);
  if (!codigoInput.value.trim() && sugestao.codigo) codigoInput.value = sugestao.codigo;
  if (!tituloInput.value.trim() && sugestao.titulo) tituloInput.value = sugestao.titulo;
});

externalDocumentForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  formMessage.hidden = true;

  const file = arquivoInput.files[0];
  const revisaoDeId = getRevisaoDeId();
  if (!file) {
    showMessage(revisaoDeId ? "Selecione o novo PDF desta revisão." : "Selecione o arquivo PDF do documento.");
    return;
  }
  if (file.type !== "application/pdf") {
    showMessage("O arquivo deve ser um PDF.");
    return;
  }

  saveButton.disabled = true;
  saveButton.textContent = "Salvando...";

  try {
    let documentoId;
    if (revisaoDeId) {
      documentoId = await window.LIDUTEC_SGI_DATA.criarNovaRevisao(
        Number(revisaoDeId),
        observacoesInput.value.trim() || null,
        file
      );
    } else {
      documentoId = await window.LIDUTEC_SGI_DATA.cadastrarDocumentoExterno({
        codigo: codigoInput.value.trim(),
        titulo: tituloInput.value.trim(),
        tipoDocumentoId: tipoDocumentoSelect.value ? Number(tipoDocumentoSelect.value) : null,
        areaResponsavelId: areaResponsavelSelect.value ? Number(areaResponsavelSelect.value) : null,
        processoSetor: processoSetorInput.value.trim() || null,
        palavrasChave: palavrasChaveInput.value.trim() || null,
        observacoes: observacoesInput.value.trim() || null
      }, file);
    }

    window.location.href = `./detalhes.html?id=${documentoId}`;
  } catch (error) {
    showMessage(`Não foi possível salvar o documento: ${error.message}`);
    saveButton.disabled = false;
    saveButton.textContent = revisaoDeId ? "Salvar nova revisão" : "Salvar documento";
  }
});

async function initializeSgiCadastro() {
  const user = await window.LIDUTEC_APP.requireAuthenticatedUser();
  if (!user) return;

  const profile = await window.LIDUTEC_APP.getCurrentUserProfile(user.id);
  if (!profile || profile.status !== "ATIVO") return;

  const permissions = await window.LIDUTEC_APP.getUserPermissions(user.id);
  window.LIDUTEC_APP.applyPermissionVisibility(permissions);

  if (!permissions.has("sgi.criar")) {
    alert("Você não possui permissão para cadastrar documentos no SGI.");
    window.location.replace("./index.html");
    return;
  }

  userName.textContent = profile.nome;
  userProfile.textContent = profile.perfil ?? "Usuário";
  userAvatar.textContent = getInitials(profile.nome);

  const { areas, tipos } = await window.LIDUTEC_SGI_DATA.support();
  tipoDocumentoSelect.insertAdjacentHTML(
    "beforeend",
    tipos.map((tipo) => `<option value="${tipo.id}">${tipo.nome}</option>`).join("")
  );
  areaResponsavelSelect.insertAdjacentHTML(
    "beforeend",
    areas.map((area) => `<option value="${area.id}">${area.nome}</option>`).join("")
  );

  const revisaoDeId = getRevisaoDeId();
  if (revisaoDeId) {
    const origem = await window.LIDUTEC_SGI_DATA.obter(revisaoDeId);
    if (!origem) {
      showMessage("Documento de origem não encontrado.");
      saveButton.disabled = true;
      return;
    }
    if (origem.status !== "VIGENTE") {
      showMessage("Só é possível criar uma nova revisão a partir do documento vigente.");
      saveButton.disabled = true;
      return;
    }
    document.querySelector("#page-heading-title").textContent = "Nova revisão";
    document.querySelector("#page-heading-description").textContent =
      `Nova revisão de ${origem.codigo} — ${origem.titulo}. Anexe o PDF atualizado.`;
    document.querySelector("#arquivo-label").textContent = "Novo PDF desta revisão *";
    document.querySelector("#identificacao-section").hidden = true;
    document.querySelector("#observacoes-label").textContent = "Motivo da revisão";
    saveButton.textContent = "Salvar nova revisão";
    return;
  }

  const normaExterna = tipos.find((tipo) => tipo.codigo === "NORMA_EXTERNA");
  if (normaExterna) tipoDocumentoSelect.value = String(normaExterna.id);
}

menuButton?.addEventListener("click", () => {
  sidebar?.classList.toggle("open");
});
logoutButton?.addEventListener("click", async () => {
  await window.LIDUTEC_APP.signOut();
});

initializeSgiCadastro().catch((error) => {
  console.error(error);
  showMessage(`Erro ao carregar a tela: ${error.message}`);
});
