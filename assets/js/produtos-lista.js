const sidebar = document.querySelector("#sidebar");
const menuButton = document.querySelector("#menu-button");
const logoutButton = document.querySelector("#logout-button");
const userName = document.querySelector("#user-name");
const userProfile = document.querySelector("#user-profile");
const userAvatar = document.querySelector("#user-avatar");
const productSearch = document.querySelector("#product-search");
const statusFilter = document.querySelector("#status-filter");
const productsLoading = document.querySelector("#products-loading");
const productsEmpty = document.querySelector("#products-empty");
const productsTableWrapper =
  document.querySelector("#products-table-wrapper");
const productsBody = document.querySelector("#products-body");
const activeProductsCount =
  document.querySelector("#active-products-count");
const developmentProductsCount =
  document.querySelector("#development-products-count");
const obsoleteProductsCount =
  document.querySelector("#obsolete-products-count");
const quickProductSearch = document.querySelector("#quick-product-search");
const quickSearchButton = document.querySelector("#quick-search-button");
const quickSearchResults = document.querySelector("#quick-search-results");
const quickSearchEmpty = document.querySelector("#quick-search-empty");
const toggleFullListButton =
  document.querySelector("#toggle-full-list-button");
const fullListSection = document.querySelector("#full-list-section");
const listPageHeading = document.querySelector("#list-page-heading");
const listSummary = document.querySelector("#list-summary");

let allProducts = [];
let currentPermissions = new Set();

function getInitials(name = "Usuário") {
  return name.trim().split(/\s+/).slice(0, 2)
    .map((part) => part[0]?.toUpperCase()).join("");
}

function getProductStatus(status) {
  const data = {
    ATIVO: { label: "Ativo", className: "ativo" },
    EM_DESENVOLVIMENTO: {
      label: "Em desenvolvimento",
      className: "desenvolvimento"
    },
    INATIVO: { label: "Inativo", className: "inativo" },
    OBSOLETO: { label: "Obsoleto", className: "obsoleto" }
  };
  return data[status] ?? {
    label: status ?? "—",
    className: "inativo"
  };
}

function getSheets(product) {
  return (product.fichas_tecnicas ?? []).filter((sheet) =>
    window.LIDUTEC_FICHAS_UI.canSeeSheet(sheet, currentPermissions)
  );
}

function getProductAggregates(product) {
  const sheets = getSheets(product);
  const pendingImports = sheets.filter((sheet) => {
    const importData = window.LIDUTEC_FICHAS_UI.getImport(sheet);
    return importData && importData.estado !== "IMPORTADA";
  }).length;
  const pendingApprovals = sheets.filter((sheet) =>
    [
      "EM_APROVACAO",
      "EM_APROVACAO_ENGENHARIA",
      "EM_APROVACAO_PRODUCAO"
    ].includes(sheet.status)
  ).length;
  const latestUpdate = sheets
    .map((sheet) => sheet.criado_em)
    .filter(Boolean)
    .sort((left, right) => String(right).localeCompare(String(left)))[0]
    ?? product.atualizado_em
    ?? product.criado_em;

  return {
    sheets,
    pendingImports,
    pendingApprovals,
    latestUpdate
  };
}

function renderProducts(products) {
  productsBody.replaceChildren();
  if (!products.length) {
    productsEmpty.hidden = false;
    productsTableWrapper.hidden = true;
    return;
  }

  productsEmpty.hidden = true;
  productsTableWrapper.hidden = false;
  const ui = window.LIDUTEC_FICHAS_UI;

  productsBody.innerHTML = products.map((product) => {
    const status = getProductStatus(product.status);
    const aggregates = getProductAggregates(product);
    const pendingTotal =
      aggregates.pendingImports + aggregates.pendingApprovals;

    return `
      <tr class="${product.cadastro_pendente ? "product-import-pending" : ""}">
        <td>
          <span class="product-code">${ui.escapeHtml(product.codigo)}</span>
          <span class="product-name">${ui.escapeHtml(product.nome)}</span>
          ${product.cadastro_pendente
            ? `<span class="product-import-badge">Importado — completar cadastro</span>`
            : ""}
          <span class="product-secondary">
            ${ui.escapeHtml(product.part_number ?? "Sem part number")}
          </span>
        </td>
        <td>${ui.escapeHtml(product.clientes?.nome ?? "—")}</td>
        <td>
          <span class="status-badge ${status.className}">
            ${ui.escapeHtml(status.label)}
          </span>
        </td>
        <td>${aggregates.sheets.length}</td>
        <td>
          ${
            pendingTotal
              ? `<strong>${pendingTotal}</strong>
                 <span class="product-secondary">${
                   aggregates.pendingImports
                 } importação(ões), ${
                   aggregates.pendingApprovals
                 } aprovação(ões)</span>`
              : "—"
          }
        </td>
        <td>${ui.formatDate(aggregates.latestUpdate)}</td>
        <td>
          <a href="./detalhes.html?id=${product.id}" class="table-action">
            Abrir produto
          </a>
        </td>
      </tr>
    `;
  }).join("");
}

function updateSummary() {
  activeProductsCount.textContent = allProducts.filter(
    (product) => product.status === "ATIVO"
  ).length;
  developmentProductsCount.textContent = allProducts.filter(
    (product) => product.status === "EM_DESENVOLVIMENTO"
  ).length;
  obsoleteProductsCount.textContent = allProducts.filter(
    (product) => product.status === "OBSOLETO"
  ).length;
}

function matchesProductSearch(product, search) {
  const searchable = [
    product.codigo,
    product.nome,
    product.codigo_cliente,
    product.part_number,
    product.clientes?.nome
  ].filter(Boolean).join(" ").toLowerCase();
  return searchable.includes(search);
}

function filterProducts() {
  const search = productSearch.value.trim().toLowerCase();
  const status = statusFilter.value;
  const filtered = allProducts.filter((product) =>
    matchesProductSearch(product, search) &&
    (!status || product.status === status)
  );
  renderProducts(filtered);
}

function closeQuickSuggestions() {
  quickSearchResults.replaceChildren();
  quickSearchResults.hidden = true;
  quickSearchEmpty.hidden = true;
  quickProductSearch.setAttribute("aria-expanded", "false");
}

function renderQuickSuggestions(products) {
  const ui = window.LIDUTEC_FICHAS_UI;

  quickSearchResults.replaceChildren();

  if (!products.length) {
    quickSearchResults.hidden = true;
    quickSearchEmpty.hidden = false;
    quickProductSearch.setAttribute("aria-expanded", "false");
    return;
  }

  quickSearchEmpty.hidden = true;
  quickSearchResults.hidden = false;
  quickProductSearch.setAttribute("aria-expanded", "true");

  quickSearchResults.innerHTML = products.slice(0, 20).map((product) => `
    <li role="none">
      <a
        href="./detalhes.html?id=${product.id}"
        role="option"
        class="quick-search-result"
      >
        <span class="product-code">${ui.escapeHtml(product.codigo)}</span>
        <span class="product-name">${ui.escapeHtml(product.nome)}</span>
        <span class="product-secondary">
          ${ui.escapeHtml(product.clientes?.nome ?? "Sem cliente vinculado")}
        </span>
      </a>
    </li>
  `).join("");
}

function getQuickSearchMatches() {
  const search = quickProductSearch.value.trim().toLowerCase();
  if (!search) {
    return null;
  }
  return allProducts.filter((product) =>
    matchesProductSearch(product, search)
  );
}

function handleQuickSearchInput() {
  const matches = getQuickSearchMatches();
  if (matches === null) {
    closeQuickSuggestions();
    return;
  }
  renderQuickSuggestions(matches);
}

function handleQuickSearchSubmit() {
  const matches = getQuickSearchMatches();
  if (matches && matches.length === 1) {
    window.location.href = `./detalhes.html?id=${matches[0].id}`;
    return;
  }
  handleQuickSearchInput();
  quickProductSearch.focus();
}

function toggleFullList() {
  const isHidden = fullListSection.hidden;
  fullListSection.hidden = !isHidden;
  listPageHeading.hidden = !isHidden;
  listSummary.hidden = !isHidden;
  toggleFullListButton.textContent = isHidden
    ? "Ocultar lista completa"
    : "Ver lista completa";
}

function createProductQuery(includeImports) {
  const importSelection = includeImports
    ? `,
        importacoes_ficha (
          id,
          estado,
          criado_em,
          validado_em
        )`
    : "";

  return window.supabaseClient
    .from("produtos")
    .select(`
      id,
      codigo,
      nome,
      codigo_cliente,
      part_number,
      status,
      cadastro_pendente,
      importacao_lote,
      importado_em,
      criado_em,
      clientes (nome),
      fichas_tecnicas (
        id,
        produto_id,
        tipo,
        numero_revisao,
        status,
        vigente,
        data_emissao,
        criado_em
        ${importSelection}
      )
    `)
    .order("codigo");
}

async function loadProducts() {
  productsLoading.hidden = false;
  let { data, error } = await createProductQuery(true);

  if (error && /importacoes_ficha/i.test(error.message)) {
    console.warn(
      "Migration 004 ainda não aplicada; carregando produtos sem dados administrativos."
    );
    ({ data, error } = await createProductQuery(false));
  }

  productsLoading.hidden = true;
  if (error) {
    console.error("Erro ao carregar produtos:", error);
    productsEmpty.hidden = false;
    productsEmpty.querySelector("strong").textContent =
      "Erro ao carregar produtos";
    productsEmpty.querySelector("span").textContent = error.message;
    return;
  }

  allProducts = data ?? [];
  updateSummary();
  filterProducts();
}

async function initializeProductsPage() {
  if (window.LIDUTEC_FICHA_PREVIEW?.isEnabled()) {
    const product = window.LIDUTEC_FICHA_PREVIEW.getProduct();
    const sheets = ["MOLDAGEM", "FUSAO_VAZAMENTO"].map((type) => ({
      ...window.LIDUTEC_FICHA_PREVIEW.getSheet(type),
      produto_id: product.id,
      importacoes_ficha: [{
        id: `preview-${type}`,
        estado: "IMPORTADA",
        criado_em: "2026-07-23T00:00:00Z",
        validado_em: "2026-07-23T00:00:00Z"
      }]
    }));

    currentPermissions = new Set([
      "produto.visualizar",
      "ficha.visualizar"
    ]);
    allProducts = [{
      ...product,
      part_number: null,
      criado_em: "2026-07-23T00:00:00Z",
      fichas_tecnicas: sheets
    }];
    userName.textContent = "Preview local";
    userProfile.textContent = "Somente leitura";
    userAvatar.textContent = "PL";
    logoutButton.hidden = true;
    productsLoading.hidden = true;
    updateSummary();
    filterProducts();
    return;
  }

  const user = await window.LIDUTEC_APP.requireAuthenticatedUser();
  if (!user) {
    return;
  }

  const [profile, permissions] = await Promise.all([
    window.LIDUTEC_APP.getCurrentUserProfile(user.id),
    window.LIDUTEC_APP.getUserPermissions(user.id)
  ]);
  if (!profile || profile.status !== "ATIVO") {
    return;
  }
  if (!permissions.has("produto.visualizar")) {
    alert("Você não possui permissão para visualizar produtos.");
    window.location.replace("../dashboard.html");
    return;
  }

  currentPermissions = permissions;
  window.LIDUTEC_APP.applyPermissionVisibility(permissions);
  userName.textContent = profile.nome;
  userProfile.textContent = profile.perfil ?? "Usuário";
  userAvatar.textContent = getInitials(profile.nome);
  await loadProducts();
}

menuButton?.addEventListener("click", () => {
  sidebar?.classList.toggle("open");
});
logoutButton?.addEventListener("click", async () => {
  await window.LIDUTEC_APP.signOut();
});
productSearch?.addEventListener("input", filterProducts);
statusFilter?.addEventListener("change", filterProducts);
quickProductSearch?.addEventListener("input", handleQuickSearchInput);
quickProductSearch?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    handleQuickSearchSubmit();
  }
});
quickProductSearch?.addEventListener("focus", () => {
  if (quickProductSearch.value.trim()) {
    handleQuickSearchInput();
  }
});
quickProductSearch?.addEventListener("focusout", () => {
  window.setTimeout(() => {
    if (!quickProductSearch.matches(":focus") &&
        !quickSearchResults.contains(document.activeElement)) {
      closeQuickSuggestions();
    }
  }, 150);
});
quickSearchButton?.addEventListener("click", handleQuickSearchSubmit);
toggleFullListButton?.addEventListener("click", toggleFullList);

initializeProductsPage().catch((error) => {
  console.error("Erro ao iniciar Lista Mestra:", error);
});
