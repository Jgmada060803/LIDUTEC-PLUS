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

const moldingStatus =
  document.querySelector("#molding-status");

const moldingRevision =
  document.querySelector("#molding-revision");

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

async function loadMoldingSummary(productId) {
  const { data, error } = await window.supabaseClient
    .from("fichas_tecnicas")
    .select("id, status, numero_revisao, vigente, criado_em")
    .eq("produto_id", productId)
    .eq("tipo", "MOLDAGEM")
    .order("numero_revisao", { ascending: false })
    .order("criado_em", { ascending: false })
    .order("id", { ascending: false });

  if (error) {
    throw error;
  }

  const sheets = [...(data ?? [])].sort(
    compareMoldingSummarySheets
  );
  const sheet = sheets[0] ?? null;

  const statusLabels = {
    RASCUNHO: "Rascunho",
    EM_APROVACAO: "Aguardando aprovação",
    APROVADA: "Aprovada",
    VIGENTE: "Vigente",
    REPROVADA: "Reprovada",
    OBSOLETA: "Obsoleta"
  };

  moldingStatus.textContent = sheet
    ? sheet.vigente
      ? "Vigente"
      : statusLabels[sheet.status] ?? sheet.status
    : "Não cadastrada";

  moldingRevision.textContent =
    sheet ? `Revisão ${sheet.numero_revisao}` : "—";
}

function getMoldingSummaryPriority(sheet) {
  if (sheet.status === "RASCUNHO") {
    return 1;
  }

  if (sheet.status === "EM_APROVACAO") {
    return 2;
  }

  if (sheet.vigente) {
    return 3;
  }

  return 4;
}

function compareMoldingSummaryDescending(left, right) {
  return String(right ?? "").localeCompare(String(left ?? ""));
}

function compareMoldingSummarySheets(left, right) {
  return (
    getMoldingSummaryPriority(left) -
      getMoldingSummaryPriority(right) ||
    Number(right.numero_revisao ?? 0) -
      Number(left.numero_revisao ?? 0) ||
    compareMoldingSummaryDescending(
      left.criado_em,
      right.criado_em
    ) ||
    compareMoldingSummaryDescending(left.id, right.id)
  );
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

  const openMoldingButton =
    document.querySelector("#open-molding-button");
  const canViewMolding =
    permissions.has("ficha.visualizar");

  if (openMoldingButton) {
    openMoldingButton.hidden = !canViewMolding;
  }

  userName.textContent = profile.nome;
  userProfile.textContent =
    profile.perfil ?? "Usuário";
  userAvatar.textContent =
    getInitials(profile.nome);

  initializeTabs();

  const loadingTasks = [loadProduct(productId)];

  if (canViewMolding) {
    loadingTasks.push(loadMoldingSummary(productId));
  } else {
    moldingStatus.textContent = "Sem permissão";
    moldingRevision.textContent = "—";
  }

  await Promise.all(loadingTasks);

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
