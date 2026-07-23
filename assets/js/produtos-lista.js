const sidebar = document.querySelector("#sidebar");
const menuButton = document.querySelector("#menu-button");
const logoutButton = document.querySelector("#logout-button");

const userName = document.querySelector("#user-name");
const userProfile = document.querySelector("#user-profile");
const userAvatar = document.querySelector("#user-avatar");

const productSearch =
  document.querySelector("#product-search");

const statusFilter =
  document.querySelector("#status-filter");

const productsLoading =
  document.querySelector("#products-loading");

const productsEmpty =
  document.querySelector("#products-empty");

const productsTableWrapper =
  document.querySelector("#products-table-wrapper");

const productsBody =
  document.querySelector("#products-body");

const activeProductsCount =
  document.querySelector("#active-products-count");

const developmentProductsCount =
  document.querySelector("#development-products-count");

const obsoleteProductsCount =
  document.querySelector("#obsolete-products-count");

let allProducts = [];
let currentPermissions = new Set();

function getInitials(name = "Usuário") {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function formatWeight(weight) {
  if (weight == null) {
    return "—";
  }

  return `${Number(weight).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 3
  })} kg`;
}

function getStatusBadge(status) {
  const labels = {
    ATIVO: "Ativo",
    EM_DESENVOLVIMENTO: "Em desenvolvimento",
    INATIVO: "Inativo",
    OBSOLETO: "Obsoleto"
  };

  const classes = {
    ATIVO: "ativo",
    EM_DESENVOLVIMENTO: "desenvolvimento",
    INATIVO: "inativo",
    OBSOLETO: "obsoleto"
  };

  return `
    <span class="status-badge ${classes[status] ?? "inativo"}">
      ${labels[status] ?? status}
    </span>
  `;
}

function renderProducts(products) {
  productsBody.innerHTML = "";

  if (!products.length) {
    productsEmpty.hidden = false;
    productsTableWrapper.hidden = true;
    return;
  }

  productsEmpty.hidden = true;
  productsTableWrapper.hidden = false;

  const canEdit =
    currentPermissions.has("produto.editar");

  productsBody.innerHTML = products
    .map((product) => {
      const clientName =
        product.clientes?.nome ?? "—";

      const familyName =
        product.familias_produto?.nome ?? "Sem família";

      return `
        <tr>
          <td>
            <span class="product-code">
              ${product.codigo}
            </span>
          </td>

          <td>
            <span class="product-name">
              ${product.nome}
            </span>

            <span class="product-secondary">
              ${familyName}
            </span>
          </td>

          <td>${clientName}</td>

          <td>${product.part_number ?? "—"}</td>

          <td>${formatWeight(product.peso_peca_kg)}</td>

          <td>${getStatusBadge(product.status)}</td>

          <td>
            <a
              href="./detalhes.html?id=${product.id}"

              class="table-action"
            >
              Abrir
            </a>
          </td>
        </tr>
      `;
    })
    .join("");
}

function updateSummary() {
  activeProductsCount.textContent =
    allProducts.filter(
      (product) => product.status === "ATIVO"
    ).length;

  developmentProductsCount.textContent =
    allProducts.filter(
      (product) =>
        product.status === "EM_DESENVOLVIMENTO"
    ).length;

  obsoleteProductsCount.textContent =
    allProducts.filter(
      (product) => product.status === "OBSOLETO"
    ).length;
}

function filterProducts() {
  const searchTerm = productSearch.value
    .trim()
    .toLowerCase();

  const selectedStatus = statusFilter.value;

  const filtered = allProducts.filter((product) => {
    const searchableText = [
      product.codigo,
      product.nome,
      product.codigo_cliente,
      product.part_number,
      product.clientes?.nome,
      product.familias_produto?.nome
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    const matchesSearch =
      searchableText.includes(searchTerm);

    const matchesStatus =
      !selectedStatus ||
      product.status === selectedStatus;

    return matchesSearch && matchesStatus;
  });

  renderProducts(filtered);
}

async function loadProducts() {
  productsLoading.hidden = false;

  const { data, error } = await window.supabaseClient
    .from("produtos")
    .select(`
      id,
      codigo,
      nome,
      codigo_cliente,
      part_number,
      peso_peca_kg,
      status,
      clientes (
        nome
      ),
      familias_produto (
        nome
      )
    `)
    .order("codigo");

  productsLoading.hidden = true;

  if (error) {
    console.error("Erro ao carregar produtos:", error);

    productsEmpty.hidden = false;
    productsEmpty.querySelector("strong").textContent =
      "Erro ao carregar produtos";

    productsEmpty.querySelector("span").textContent =
      error.message;

    return;
  }

  allProducts = data ?? [];

  updateSummary();
  renderProducts(allProducts);
}

async function initializeProductsPage() {
  const user =
    await window.LIDUTEC_APP.requireAuthenticatedUser();

  if (!user) {
    return;
  }

  const profile =
    await window.LIDUTEC_APP.getCurrentUserProfile(
      user.id
    );

  if (!profile || profile.status !== "ATIVO") {
    return;
  }

  currentPermissions =
    await window.LIDUTEC_APP.getUserPermissions(
      user.id
    );

  if (!currentPermissions.has("produto.visualizar")) {
    alert(
      "Você não possui permissão para visualizar produtos."
    );

    window.location.replace("../dashboard.html");
    return;
  }

  window.LIDUTEC_APP.applyPermissionVisibility(
    currentPermissions
  );

  userName.textContent = profile.nome;
  userProfile.textContent =
    profile.perfil ?? "Usuário";
  userAvatar.textContent =
    getInitials(profile.nome);

  await loadProducts();
}

menuButton?.addEventListener("click", () => {
  sidebar?.classList.toggle("open");
});

logoutButton?.addEventListener("click", async () => {
  await window.LIDUTEC_APP.signOut();
});

productSearch?.addEventListener(
  "input",
  filterProducts
);

statusFilter?.addEventListener(
  "change",
  filterProducts
);

initializeProductsPage().catch((error) => {
  console.error(
    "Erro ao iniciar lista de produtos:",
    error
  );
});