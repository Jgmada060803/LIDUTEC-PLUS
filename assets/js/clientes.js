const clientElements = {
  sidebar: document.querySelector("#sidebar"),
  menu: document.querySelector("#menu-button"),
  logout: document.querySelector("#logout-button"),
  userName: document.querySelector("#user-name"),
  userProfile: document.querySelector("#user-profile"),
  userAvatar: document.querySelector("#user-avatar"),
  list: document.querySelector(".client-list-panel"),
  form: document.querySelector("#client-form"),
  formTitle: document.querySelector("#client-form-title"),
  loading: document.querySelector("#client-loading"),
  empty: document.querySelector("#client-empty"),
  wrapper: document.querySelector("#client-table-wrapper"),
  body: document.querySelector("#client-body"),
  search: document.querySelector("#client-search"),
  status: document.querySelector("#client-status"),
  newButton: document.querySelector("#new-client"),
  closeButton: document.querySelector("#close-client-form"),
  cancelButton: document.querySelector("#cancel-client"),
  saveButton: document.querySelector("#save-client"),
  message: document.querySelector("#client-message"),
  logoInput: document.querySelector("#client-logo"),
  logoImage: document.querySelector("#client-logo-image"),
  logoPlaceholder: document.querySelector("#client-logo-placeholder")
};

const clientState = {
  rows: [],
  permissions: new Set(),
  editingId: null
};

const escapeClientHtml = (value = "") => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

function clientInitials(name = "Usuário") {
  return name.trim().split(/\s+/).slice(0, 2)
    .map((part) => part[0]?.toUpperCase()).join("");
}

function clientDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR").format(new Date(value));
}

function showClientMessage(text, type = "error") {
  clientElements.message.textContent = text;
  clientElements.message.className = `form-message ${type}`;
  clientElements.message.hidden = false;
}

function updateClientSummary() {
  document.querySelector("#client-total").textContent =
    clientState.rows.length;
  document.querySelector("#client-active").textContent =
    clientState.rows.filter((row) => row.ativo).length;
  document.querySelector("#client-inactive").textContent =
    clientState.rows.filter((row) => !row.ativo).length;
}

function renderClients() {
  const term = clientElements.search.value.trim().toLowerCase();
  const status = clientElements.status.value;
  const rows = clientState.rows.filter((row) => {
    const searchable = [
      row.nome, row.nome_fantasia, row.documento_fiscal,
      row.contato_principal, row.email, row.cidade, row.estado
    ].filter(Boolean).join(" ").toLowerCase();
    return searchable.includes(term) &&
      (!status || String(Boolean(row.ativo)) === status);
  });

  clientElements.empty.hidden = rows.length > 0;
  clientElements.wrapper.hidden = rows.length === 0;
  clientElements.body.innerHTML = rows.map((row) => `
    <tr>
      <td><div class="client-identity">
        <div class="client-table-logo">${
          row.logotipo_url
            ? `<img src="${escapeClientHtml(row.logotipo_url)}" alt="">`
            : escapeClientHtml(clientInitials(row.nome))
        }</div>
        <div><strong>${escapeClientHtml(row.nome)}</strong>
        <span class="product-secondary">${escapeClientHtml(
          row.nome_fantasia || row.documento_fiscal || "Sem documento"
        )}</span></div>
      </div></td>
      <td>${escapeClientHtml(row.contato_principal || "—")}
        <span class="product-secondary">${escapeClientHtml(
          row.email || row.telefone || row.celular || "Sem contato"
        )}</span></td>
      <td>${escapeClientHtml(
        [row.cidade, row.estado].filter(Boolean).join(" / ") || "—"
      )}<span class="product-secondary">${escapeClientHtml(row.pais || "")}</span></td>
      <td><span class="status-badge ${row.ativo ? "ativo" : "inativo"}">${
        row.ativo ? "Ativo" : "Inativo"
      }</span></td>
      <td>${clientDate(row.atualizado_em || row.criado_em)}</td>
      <td>${
        clientState.permissions.has("clientes.gerenciar")
          ? `<button type="button" class="table-action edit-client" data-id="${row.id}">Editar</button>`
          : ""
      }</td>
    </tr>
  `).join("");
}

async function loadClients() {
  clientElements.loading.hidden = false;
  const { data, error } = await window.supabaseClient
    .from("clientes").select("*").order("nome");
  clientElements.loading.hidden = true;
  if (error) throw error;
  clientState.rows = data ?? [];
  updateClientSummary();
  renderClients();
}

function updateLogoPreview() {
  const url = clientElements.logoInput.value.trim();
  clientElements.logoImage.hidden = !url;
  clientElements.logoPlaceholder.hidden = Boolean(url);
  clientElements.logoPlaceholder.textContent = "Sem logotipo";
  if (url) clientElements.logoImage.src = url;
}

function openClientForm(client = null) {
  clientState.editingId = client?.id ?? null;
  clientElements.form.reset();
  clientElements.message.hidden = true;
  clientElements.formTitle.textContent =
    client ? `Editar ${client.nome}` : "Novo cliente";

  for (const control of clientElements.form.elements) {
    if (!control.name) continue;
    if (control.type === "checkbox") {
      control.checked = client ? Boolean(client[control.name]) : true;
    } else {
      control.value = client?.[control.name] ??
        (control.name === "pais" ? "Brasil" : "");
    }
  }

  updateLogoPreview();
  clientElements.list.hidden = true;
  document.querySelector(".product-summary").hidden = true;
  document.querySelector("main > .page-heading").hidden = true;
  clientElements.form.hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function closeClientForm() {
  clientElements.form.hidden = true;
  clientElements.list.hidden = false;
  document.querySelector(".product-summary").hidden = false;
  document.querySelector("main > .page-heading").hidden = false;
  clientState.editingId = null;
}

function clientPayload() {
  const data = Object.fromEntries(new FormData(clientElements.form));
  const payload = {};
  for (const [field, value] of Object.entries(data)) {
    payload[field] = String(value).trim() || null;
  }
  payload.ativo = document.querySelector("#client-enabled").checked;
  payload.atualizado_em = new Date().toISOString();
  return payload;
}

async function saveClient(event) {
  event.preventDefault();
  clientElements.message.hidden = true;
  if (!clientElements.form.checkValidity()) {
    clientElements.form.reportValidity();
    return;
  }
  clientElements.saveButton.disabled = true;
  clientElements.saveButton.textContent = "Salvando...";
  try {
    const table = window.supabaseClient.from("clientes");
    const result = clientState.editingId
      ? await table.update(clientPayload()).eq("id", clientState.editingId)
      : await table.insert(clientPayload());
    if (result.error) throw result.error;
    showClientMessage(
      clientState.editingId
        ? "Cliente atualizado com sucesso."
        : "Cliente cadastrado com sucesso.",
      "success"
    );
    await loadClients();
    setTimeout(closeClientForm, 500);
  } catch (error) {
    showClientMessage(
      error.code === "23505"
        ? "Já existe um cliente com este documento fiscal."
        : `Não foi possível salvar o cliente: ${error.message}`
    );
  } finally {
    clientElements.saveButton.disabled = false;
    clientElements.saveButton.textContent = "Salvar cliente";
  }
}

async function initializeClients() {
  const user = await window.LIDUTEC_APP.requireAuthenticatedUser();
  if (!user) return;
  const [profile, permissions] = await Promise.all([
    window.LIDUTEC_APP.getCurrentUserProfile(user.id),
    window.LIDUTEC_APP.getUserPermissions(user.id)
  ]);
  if (!profile || profile.status !== "ATIVO") return;
  if (
    !permissions.has("clientes.visualizar") &&
    !permissions.has("clientes.gerenciar")
  ) {
    alert("Você não possui permissão para visualizar clientes.");
    window.location.replace("../dashboard.html");
    return;
  }
  clientState.permissions = permissions;
  window.LIDUTEC_APP.applyPermissionVisibility(permissions);
  clientElements.userName.textContent = profile.nome;
  clientElements.userProfile.textContent = profile.perfil ?? "Usuário";
  clientElements.userAvatar.textContent = clientInitials(profile.nome);
  await loadClients();
}

clientElements.search.addEventListener("input", renderClients);
clientElements.status.addEventListener("change", renderClients);
clientElements.newButton.addEventListener("click", () => openClientForm());
clientElements.closeButton.addEventListener("click", closeClientForm);
clientElements.cancelButton.addEventListener("click", closeClientForm);
clientElements.logoInput.addEventListener("input", updateLogoPreview);
clientElements.logoImage.addEventListener("error", () => {
  clientElements.logoImage.hidden = true;
  clientElements.logoPlaceholder.hidden = false;
  clientElements.logoPlaceholder.textContent = "Imagem indisponível";
});
clientElements.form.addEventListener("submit", saveClient);
clientElements.body.addEventListener("click", (event) => {
  const button = event.target.closest(".edit-client");
  const client = button && clientState.rows.find(
    (row) => String(row.id) === button.dataset.id
  );
  if (client) openClientForm(client);
});
clientElements.menu.addEventListener("click", () =>
  clientElements.sidebar.classList.toggle("open")
);
clientElements.logout.addEventListener("click", () =>
  window.LIDUTEC_APP.signOut()
);

initializeClients().catch((error) => {
  clientElements.loading.hidden = true;
  clientElements.empty.hidden = false;
  clientElements.empty.querySelector("strong").textContent =
    "Não foi possível carregar os clientes";
  clientElements.empty.querySelector("span").textContent = error.message;
});
