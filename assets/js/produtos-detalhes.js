const sidebar = document.querySelector("#sidebar");
const menuButton = document.querySelector("#menu-button");
const logoutButton = document.querySelector("#logout-button");

const userName = document.querySelector("#user-name");
const userProfile = document.querySelector("#user-profile");
const userAvatar = document.querySelector("#user-avatar");

const productLoading =
  document.querySelector("#product-loading");

const productContent =
  document.querySelector("#product-content");

const productError =
  document.querySelector("#product-error");

const productTitle =
  document.querySelector("#product-title");

const productSubtitle =
  document.querySelector("#product-subtitle");

const productStatus =
  document.querySelector("#product-status");

const productImage =
  document.querySelector("#product-image");

const productImagePlaceholder =
  document.querySelector("#product-image-placeholder");

const editProductButton =
  document.querySelector("#edit-product-button");

const revisionHistoryButton =
  document.querySelector("#revision-history-button");

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

function formatWeight(value) {
  if (value == null) {
    return "—";
  }

  return `${Number(value).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 3
  })} kg`;
}

function formatPercentage(value) {
  if (value == null) {
    return "—";
  }

  return `${Number(value).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 3
  })}%`;
}

function getStatusData(status) {
  const map = {
    ATIVO: {
      label: "Ativo",
      className: "ativo"
    },
    EM_DESENVOLVIMENTO: {
      label: "Em desenvolvimento",
      className: "desenvolvimento"
    },
    INATIVO: {
      label: "Inativo",
      className: "inativo"
    },
    OBSOLETO: {
      label: "Obsoleto",
      className: "obsoleto"
    }
  };

  return map[status] ?? {
    label: status ?? "—",
    className: "inativo"
  };
}

function setText(selector, value) {
  const element = document.querySelector(selector);

  if (element) {
    element.textContent = value ?? "—";
  }
}

function showProduct(product) {
  const openMoldingButton =
    document.querySelector("#open-molding-button");

  if (openMoldingButton) {
    openMoldingButton.href =
      `./moldagem.html?produto=${product.id}`;
  }

  const status = getStatusData(product.status);

  productTitle.textContent =
    `${product.codigo} — ${product.nome}`;

  productSubtitle.textContent =
    product.codigo_cliente
      ? `Código do cliente: ${product.codigo_cliente}`
      : "Cadastro mestre de engenharia";

  productStatus.textContent = status.label;
  productStatus.className =
    `status-badge ${status.className}`;

  setText(
    "#product-client",
    product.clientes?.nome
  );

  setText(
    "#product-part-number",
    product.part_number
  );

  setText(
    "#product-family",
    product.familias_produto?.nome
  );

  setText(
    "#product-safety",
    product.peca_seguranca ? "Sim" : "Não"
  );

  setText("#detail-code", product.codigo);

  setText(
    "#detail-client-code",
    product.codigo_cliente
  );

  setText(
    "#detail-tool-code",
    product.codigo_ferramental
  );

  setText("#detail-status", status.label);

  setText(
    "#detail-piece-weight",
    formatWeight(product.peso_peca_kg)
  );

  setText(
    "#detail-cluster-weight",
    formatWeight(product.peso_cacho_kg)
  );

  setText(
    "#detail-cavities",
    product.cavidades_molde
  );

  setText(
    "#detail-yield",
    formatPercentage(product.rendimento_metalico_pct)
  );

  if (product.imagem_principal_url) {
    productImage.src = product.imagem_principal_url;
    productImage.hidden = false;
    productImagePlaceholder.hidden = true;
  }

  editProductButton.href =
    `./cadastro.html?id=${product.id}`;

  revisionHistoryButton.href =
    `./revisoes.html?produto=${product.id}`;
}

async function loadProduct(productId) {
  const { data, error } = await window.supabaseClient
    .from("produtos")
    .select(`
      *,
      clientes (
        id,
        nome
      ),
      familias_produto (
        id,
        nome
      )
    `)
    .eq("id", productId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error("Produto não encontrado.");
  }

  showProduct(data);
}

function initializeTabs() {
  const tabs =
    document.querySelectorAll(".product-tab");

  const panels =
    document.querySelectorAll(".product-tab-panel");

  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      const selectedTab = tab.dataset.tab;

      for (const currentTab of tabs) {
        currentTab.classList.toggle(
          "active",
          currentTab === tab
        );
      }

      for (const panel of panels) {
        const isSelected =
          panel.dataset.panel === selectedTab;

        panel.hidden = !isSelected;
        panel.classList.toggle(
          "active",
          isSelected
        );
      }
    });
  }
}

async function initializeProductDetails() {
  const productId = getProductId();

  if (!productId) {
    window.location.replace("./lista.html");
    return;
  }

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

  const permissions =
    await window.LIDUTEC_APP.getUserPermissions(
      user.id
    );

  if (!permissions.has("produto.visualizar")) {
    alert(
      "Você não possui permissão para visualizar produtos."
    );

    window.location.replace("../dashboard.html");
    return;
  }

  window.LIDUTEC_APP.applyPermissionVisibility(
    permissions
  );

  userName.textContent = profile.nome;
  userProfile.textContent =
    profile.perfil ?? "Usuário";
  userAvatar.textContent =
    getInitials(profile.nome);

  initializeTabs();

  await loadProduct(productId);

  productLoading.hidden = true;
  productContent.hidden = false;
}

menuButton?.addEventListener("click", () => {
  sidebar?.classList.toggle("open");
});

logoutButton?.addEventListener("click", async () => {
  await window.LIDUTEC_APP.signOut();
});

initializeProductDetails().catch((error) => {
  console.error(
    "Erro ao carregar detalhes do produto:",
    error
  );

  productLoading.hidden = true;

  productError.textContent =
    `Não foi possível carregar o produto: ${error.message}`;

  productError.hidden = false;
});
