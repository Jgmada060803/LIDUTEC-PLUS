const sidebar = document.querySelector("#sidebar");
const menuButton = document.querySelector("#menu-button");
const logoutButton = document.querySelector("#logout-button");

const userName = document.querySelector("#user-name");
const userProfile = document.querySelector("#user-profile");
const userAvatar = document.querySelector("#user-avatar");

const pageTitle = document.querySelector("#page-title");
const formTitle = document.querySelector("#form-title");

const productForm = document.querySelector("#product-form");
const saveButton = document.querySelector("#save-button");
const formMessage = document.querySelector("#form-message");

const codigoInput = document.querySelector("#codigo");
const nomeInput = document.querySelector("#nome");
const statusSelect = document.querySelector("#status");
const clienteSelect = document.querySelector("#cliente");
const familiaSelect = document.querySelector("#familia");
const codigoClienteInput =
  document.querySelector("#codigo-cliente");
const partNumberInput =
  document.querySelector("#part-number");
const codigoFerramentalInput =
  document.querySelector("#codigo-ferramental");
const pecaSegurancaInput =
  document.querySelector("#peca-seguranca");
const pesoPecaInput =
  document.querySelector("#peso-peca");
const pesoCachoInput =
  document.querySelector("#peso-cacho");
const cavidadesInput =
  document.querySelector("#cavidades");
const rendimentoInput =
  document.querySelector("#rendimento");
const imagemPrincipalUrlInput =
  document.querySelector("#imagem-principal-url");

let authenticatedUser = null;
let productId = null;
let isEditing = false;

function getInitials(name = "Usuário") {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function getProductId() {
  const params = new URLSearchParams(
    window.location.search
  );

  return params.get("id");
}

function showMessage(message, type = "error") {
  formMessage.textContent = message;
  formMessage.className = `form-message ${type}`;
  formMessage.hidden = false;
}

function clearMessage() {
  formMessage.textContent = "";
  formMessage.className = "form-message";
  formMessage.hidden = true;
}

function setSaving(isSaving) {
  saveButton.disabled = isSaving;

  saveButton.textContent = isSaving
    ? "Salvando..."
    : isEditing
      ? "Salvar alterações"
      : "Salvar produto";
}

function parseNumber(value) {
  if (value === "") {
    return null;
  }

  const parsed = Number(value);

  return Number.isNaN(parsed)
    ? null
    : parsed;
}

function fillSelect(select, items) {
  const options = items
    .map((item) => {
      return `
        <option value="${item.id}">
          ${item.nome}
        </option>
      `;
    })
    .join("");

  select.insertAdjacentHTML("beforeend", options);
}

async function loadSupportData() {
  const [clientsResult, familiesResult] =
    await Promise.all([
      window.supabaseClient
        .from("clientes")
        .select("id, nome")
        .eq("ativo", true)
        .order("nome"),

      window.supabaseClient
        .from("familias_produto")
        .select("id, nome")
        .eq("ativo", true)
        .order("nome")
    ]);

  if (clientsResult.error) {
    throw clientsResult.error;
  }

  if (familiesResult.error) {
    throw familiesResult.error;
  }

  fillSelect(
    clienteSelect,
    clientsResult.data ?? []
  );

  fillSelect(
    familiaSelect,
    familiesResult.data ?? []
  );
}

async function loadProduct(id) {
  const { data, error } = await window.supabaseClient
    .from("produtos")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error("Produto não encontrado.");
  }

  codigoInput.value = data.codigo ?? "";
  nomeInput.value = data.nome ?? "";
  statusSelect.value =
    data.status ?? "EM_DESENVOLVIMENTO";
  clienteSelect.value =
    data.cliente_id ?? "";
  familiaSelect.value =
    data.familia_id ?? "";
  codigoClienteInput.value =
    data.codigo_cliente ?? "";
  partNumberInput.value =
    data.part_number ?? "";
  codigoFerramentalInput.value =
    data.codigo_ferramental ?? "";
  pecaSegurancaInput.checked =
    data.peca_seguranca ?? false;
  pesoPecaInput.value =
    data.peso_peca_kg ?? "";
  pesoCachoInput.value =
    data.peso_cacho_kg ?? "";
  cavidadesInput.value =
    data.cavidades_molde ?? "";
  rendimentoInput.value =
    data.rendimento_metalico_pct ?? "";
  imagemPrincipalUrlInput.value =
    data.imagem_principal_url ?? "";

  pageTitle.textContent = `Editar ${data.codigo}`;
  formTitle.textContent = `Editar produto ${data.codigo}`;
}

function buildProductPayload() {
  return {
    codigo: codigoInput.value
      .trim()
      .toUpperCase(),

    nome: nomeInput.value.trim(),

    cliente_id:
      clienteSelect.value || null,

    familia_id:
      familiaSelect.value || null,

    codigo_cliente:
      codigoClienteInput.value.trim() || null,

    part_number:
      partNumberInput.value.trim() || null,

    codigo_ferramental:
      codigoFerramentalInput.value.trim() || null,

    peca_seguranca:
      pecaSegurancaInput.checked,

    peso_peca_kg:
      parseNumber(pesoPecaInput.value),

    peso_cacho_kg:
      parseNumber(pesoCachoInput.value),

    cavidades_molde:
      parseNumber(cavidadesInput.value),

    rendimento_metalico_pct:
      parseNumber(rendimentoInput.value),

    status: statusSelect.value,

    imagem_principal_url:
      imagemPrincipalUrlInput.value.trim() || null
  };
}

async function saveProduct(event) {
  event.preventDefault();
  clearMessage();

  if (!productForm.checkValidity()) {
    productForm.reportValidity();
    return;
  }

  const payload = buildProductPayload();

  try {
    setSaving(true);

    if (isEditing) {
      const { error } = await window.supabaseClient
        .from("produtos")
        .update(payload)
        .eq("id", productId);

      if (error) {
        throw error;
      }

      showMessage(
        "Produto atualizado com sucesso.",
        "success"
      );
    } else {
      const { data, error } = await window.supabaseClient
        .from("produtos")
        .insert({
          ...payload,
          criado_por: authenticatedUser.id
        })
        .select("id")
        .single();

      if (error) {
        throw error;
      }

      productId = data.id;
      isEditing = true;

      showMessage(
        "Produto cadastrado com sucesso.",
        "success"
      );
    }

    setTimeout(() => {
      window.location.href = "./lista.html";
    }, 900);
  } catch (error) {
    console.error(
      "Erro ao salvar produto:",
      error
    );

    const duplicateCode =
      error.code === "23505" ||
      error.message
        ?.toLowerCase()
        .includes("duplicate");

    showMessage(
      duplicateCode
        ? "Já existe um produto com este código."
        : `Não foi possível salvar: ${error.message}`
    );
  } finally {
    setSaving(false);
  }
}

async function initializeProductForm() {
  authenticatedUser =
    await window.LIDUTEC_APP.requireAuthenticatedUser();

  if (!authenticatedUser) {
    return;
  }

  const profile =
    await window.LIDUTEC_APP.getCurrentUserProfile(
      authenticatedUser.id
    );

  if (!profile || profile.status !== "ATIVO") {
    return;
  }

  const permissions =
    await window.LIDUTEC_APP.getUserPermissions(
      authenticatedUser.id
    );

  productId = getProductId();
  isEditing = Boolean(productId);

  const requiredPermission = isEditing
    ? "produto.editar"
    : "produto.criar";

  if (!permissions.has(requiredPermission)) {
    alert(
      "Você não possui permissão para realizar esta operação."
    );

    window.location.replace("./lista.html");
    return;
  }

  userName.textContent = profile.nome;
  userProfile.textContent =
    profile.perfil ?? "Usuário";
  userAvatar.textContent =
    getInitials(profile.nome);

  await loadSupportData();

  if (isEditing) {
    await loadProduct(productId);
    saveButton.textContent = "Salvar alterações";
  }
}

menuButton?.addEventListener("click", () => {
  sidebar?.classList.toggle("open");
});

logoutButton?.addEventListener("click", async () => {
  await window.LIDUTEC_APP.signOut();
});

productForm.addEventListener(
  "submit",
  saveProduct
);

initializeProductForm().catch((error) => {
  console.error(
    "Erro ao abrir cadastro de produto:",
    error
  );

  showMessage(
    `Não foi possível abrir o cadastro: ${error.message}`
  );
});