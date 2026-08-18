const sidebar = document.querySelector("#sidebar");
const menuButton = document.querySelector("#menu-button");
const logoutButton = document.querySelector("#logout-button");

const topbarProductNav = document.querySelector("#topbar-product-nav");

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

const deleteObsoleteProductButton =
  document.querySelector("#delete-obsolete-product-button");

const deleteObsoleteProductDialog =
  document.querySelector("#delete-obsolete-product-dialog");

const deleteObsoleteProductForm =
  document.querySelector("#delete-obsolete-product-form");

const deleteObsoleteProductConfirmation =
  document.querySelector("#delete-obsolete-product-confirmation");

const deleteObsoleteProductCode =
  document.querySelector("#delete-obsolete-product-code");

const deleteObsoleteProductMessage =
  document.querySelector("#delete-obsolete-product-message");

const confirmDeleteObsoleteProduct =
  document.querySelector("#confirm-delete-obsolete-product");

const cancelDeleteObsoleteProduct =
  document.querySelector("#cancel-delete-obsolete-product");

const revisionHistoryButton =
  document.querySelector("#revision-history-button");

const moldingStatus =
  document.querySelector("#molding-status");

const moldingRevision =
  document.querySelector("#molding-revision");

const castingStatus =
  document.querySelector("#casting-status");

const castingRevision =
  document.querySelector("#casting-revision");

const machariaMachosList =
  document.querySelector("#macharia-machos-list");

const machariaSemMacho =
  document.querySelector("#macharia-sem-macho");

const productModuleCards =
  document.querySelector("#product-module-cards");

const moduleDetail =
  document.querySelector("#module-detail");

const moduleDetailTitle =
  document.querySelector("#module-detail-title");

const moduleDetailContent =
  document.querySelector("#module-detail-content");

const productDetailsState = {
  product: null,
  sheets: [],
  permissions: new Set()
};

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

function getSheetPageUrl(page, product) {
  const params = new URLSearchParams({
    produto: product.id,
    codigo: product.codigo
  });
  return `./${page}?${params}`;
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
  productDetailsState.product = product;
  const openMoldingButton =
    document.querySelector("#open-molding-button");

  if (openMoldingButton) {
    openMoldingButton.href =
      getSheetPageUrl("moldagem.html", product);
  }

  const openCastingButton =
    document.querySelector("#open-casting-button");

  if (openCastingButton) {
    openCastingButton.href =
      getSheetPageUrl("fusao-vazamento.html", product);
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

  if (deleteObsoleteProductButton) {
    deleteObsoleteProductButton.hidden = !(
      product.status === "OBSOLETO" &&
      productDetailsState.permissions.has("produto.excluir_obsoleto")
    );
  }
  if (deleteObsoleteProductCode) {
    deleteObsoleteProductCode.textContent = product.codigo;
  }

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
  return data;
}

function createProductSheetsQuery(productId, includeImports) {
  const importSelection = includeImports
    ? `,
      importacoes_ficha (
        id,
        estado,
        criado_em,
        validado_em,
        pdf_nome_original,
        validacoes_importacao_ficha (
          administrador_nome,
          resultado,
          criado_em
        )
      )`
    : "";

  return window.supabaseClient
    .from("fichas_tecnicas")
    .select(`
      id,
      produto_id,
      tipo,
      codigo_documento,
      numero_revisao,
      status,
      vigente,
      data_emissao,
      criado_em,
      etapa_aprovacao
      ${importSelection},
      aprovacoes_ficha (
        id,
        tipo_aprovacao,
        status,
        nome_responsavel
      )
    `)
    .eq("produto_id", productId)
    .order("numero_revisao", { ascending: false })
    .order("criado_em", { ascending: false })
    .order("id", { ascending: false });
}

async function loadProductSheets(productId) {
  let { data, error } = await createProductSheetsQuery(productId, true);
  if (error && /importacoes_ficha|etapa_aprovacao/i.test(error.message)) {
    console.warn(
      "Migration 004 ainda não aplicada; carregando módulos sem metadados administrativos."
    );
    ({ data, error } = await window.supabaseClient
      .from("fichas_tecnicas")
      .select(`
        id,
        produto_id,
        tipo,
        codigo_documento,
        numero_revisao,
        status,
        vigente,
        data_emissao,
        criado_em,
        aprovacoes_ficha (
          id,
          tipo_aprovacao,
          status,
          nome_responsavel
        )
      `)
      .eq("produto_id", productId)
      .order("numero_revisao", { ascending: false })
      .order("criado_em", { ascending: false })
      .order("id", { ascending: false }));
  }
  if (error) {
    throw error;
  }
  return data ?? [];
}

function getModuleAction(type, sheet) {
  const ui = window.LIDUTEC_FICHAS_UI;
  const importData = ui.getImport(sheet);
  const canManageImport = [
    "ficha.importar",
    "ficha.conferir_importacao",
    "ficha.validar_importacao"
  ].some((permission) =>
    productDetailsState.permissions.has(permission)
  );

  if (importData && importData.estado !== "IMPORTADA" && canManageImport) {
    return {
      label: "Conferir importação",
      href: ui.importUrl(
        productDetailsState.product.id,
        type.codigo,
        importData.id
      )
    };
  }

  if (sheet && type.page) {
    return {
      label: "Abrir ficha",
      href: ui.sheetUrl(sheet)
    };
  }

  if (type.page) {
    return {
      label: `Abrir ${type.nome}`,
      href: getSheetPageUrl(
        type.page,
        productDetailsState.product
      )
    };
  }

  return null;
}

function getModuleImportAction(type, sheet) {
  if (
    sheet ||
    !type.template ||
    !productDetailsState.permissions.has("ficha.importar")
  ) {
    return null;
  }

  return {
    label: "Importar ficha",
    href: window.LIDUTEC_FICHAS_UI.importUrl(
      productDetailsState.product.id,
      type.codigo
    )
  };
}

function renderModuleCards() {
  const ui = window.LIDUTEC_FICHAS_UI;
  const visibleSheets = productDetailsState.sheets.filter((sheet) =>
    ui.canSeeSheet(sheet, productDetailsState.permissions)
  );

  productModuleCards.innerHTML = ui.types.map((type) => {
    const sheet = ui.selectActiveSheet(visibleSheets, type.codigo);
    const importData = ui.getImport(sheet);
    const action = getModuleAction(type, sheet);
    const importAction = getModuleImportAction(type, sheet);
    const statusText = sheet
      ? ui.getStatusData(sheet).label
      : "Nenhuma ficha cadastrada";
    const importText = importData
      ? importData.estado === "IMPORTADA"
        ? "Importação validada"
        : "Importação pendente de validação"
      : null;

    return `
      <article class="product-module-card">
        <div>
          <h4>${ui.escapeHtml(type.nome)}</h4>
          ${
            sheet
              ? `<strong>Revisão ${ui.escapeHtml(
                  sheet.numero_revisao
                )}</strong>
                 ${ui.statusBadge(sheet)}
                 <span>${ui.escapeHtml(importText ?? statusText)}</span>
                 <small>Emissão: ${ui.formatDate(
                   sheet.data_emissao
                 )}</small>`
              : `<strong>Nenhuma ficha cadastrada</strong>
                 <span>Módulo disponível para configuração.</span>`
          }
        </div>
        <div class="product-module-actions">
          ${
            action
              ? `<a href="${action.href}" class="button button-primary">
                  ${ui.escapeHtml(action.label)}
                </a>`
              : ""
          }
          ${
            importAction
              ? `<a href="${importAction.href}" class="button button-secondary">
                  ${ui.escapeHtml(importAction.label)}
                </a>`
              : ""
          }
          <button type="button" class="button button-secondary view-module"
            data-module-type="${ui.escapeHtml(type.codigo)}">
            Ver módulo
          </button>
        </div>
      </article>
    `;
  }).join("");

  const molding = ui.selectActiveSheet(visibleSheets, "MOLDAGEM");
  const casting = ui.selectActiveSheet(
    visibleSheets,
    "FUSAO_VAZAMENTO"
  );
  moldingStatus.textContent = molding
    ? ui.getStatusData(molding).label
    : "Não cadastrada";
  moldingRevision.textContent = molding
    ? `Revisão ${molding.numero_revisao}`
    : "—";
  castingStatus.textContent = casting
    ? ui.getStatusData(casting).label
    : "Não cadastrada";
  castingRevision.textContent = casting
    ? `Revisão ${casting.numero_revisao}`
    : "—";

  const importButtonSelectors = {
    MOLDAGEM: "#import-molding-button",
    FUSAO_VAZAMENTO: "#import-casting-button"
  };

  for (const [typeCode, sheet, button] of [
    [
      "MOLDAGEM",
      molding,
      document.querySelector("#open-molding-button")
    ],
    [
      "FUSAO_VAZAMENTO",
      casting,
      document.querySelector("#open-casting-button")
    ]
  ]) {
    const action = getModuleAction(ui.getType(typeCode), sheet);
    if (button) {
      button.hidden = !action;
      if (action) {
        button.href = action.href;
        button.textContent = action.label;
      }
    }

    const importButton = document.querySelector(
      importButtonSelectors[typeCode]
    );
    const importAction = getModuleImportAction(
      ui.getType(typeCode),
      sheet
    );
    if (importButton) {
      importButton.hidden = !importAction;
      if (importAction) {
        importButton.href = importAction.href;
      }
    }
  }
}

// Macharia é diferente dos demais módulos: um produto pode ter mais de um
// macho (Ficha de Macho, tabela machos_macharia), e cada macho tem sua
// própria ficha técnica — por isso não cabe no card único genérico, é uma
// lista à parte.
async function renderMachariaList() {
  if (!machariaMachosList) {
    return;
  }
  const productId = productDetailsState.product?.id;
  if (!productId) {
    return;
  }

  const { data: vinculos, error: vinculosError } = await window.supabaseClient
    .from("machos_macharia_produtos")
    .select("macho_id, machos_macharia(id, caixa, macho, status, ativo)")
    .eq("produto_id", productId);

  if (vinculosError) {
    throw vinculosError;
  }

  const machos = (vinculos ?? [])
    .map((vinculo) => vinculo.machos_macharia)
    .filter((macho) => macho && macho.ativo);

  if (machos.length === 0) {
    machariaMachosList.hidden = true;
    if (machariaSemMacho) {
      machariaSemMacho.hidden = false;
    }
    return;
  }
  machariaMachosList.hidden = false;
  if (machariaSemMacho) {
    machariaSemMacho.hidden = true;
  }

  const { data: fichas, error: fichasError } = await window.supabaseClient
    .from("fichas_tecnicas")
    .select("id, macho_id, status, numero_revisao")
    .eq("produto_id", productId)
    .eq("tipo", "MACHARIA")
    .in("macho_id", machos.map((macho) => macho.id));

  if (fichasError) {
    throw fichasError;
  }

  const ui = window.LIDUTEC_FICHAS_UI;
  const canCreate = productDetailsState.permissions.has("ficha.criar");
  const canView = productDetailsState.permissions.has("ficha.visualizar");

  machariaMachosList.innerHTML = machos.map((macho) => {
    const ficha = (fichas ?? [])
      .filter((item) => String(item.macho_id) === String(macho.id))
      .sort(ui.compareSheets)[0] ?? null;

    const label = `Caixa ${ui.escapeHtml(macho.caixa)} · Macho ${ui.escapeHtml(macho.macho)}`;
    const statusText = ficha
      ? `${ui.escapeHtml(ui.getStatusData(ficha).label)} · Revisão ${ficha.numero_revisao}`
      : "Sem ficha técnica";

    const action = ficha
      ? (canView
        ? `<a href="./macharia.html?produto=${productId}&ficha=${ficha.id}" class="button button-secondary">Abrir ficha</a>`
        : "")
      : (canCreate
        ? `<a href="./macharia.html?produto=${productId}&macho=${macho.id}" class="button button-primary">Criar ficha</a>`
        : "");

    return `
      <li class="macharia-macho-row">
        <div>
          <strong>${label}</strong>
          <span class="production-muted">${statusText}</span>
        </div>
        ${action}
      </li>
    `;
  }).join("");
}

function renderModuleDetail(typeCode) {
  const ui = window.LIDUTEC_FICHAS_UI;
  const type = ui.getType(typeCode);
  const sheets = productDetailsState.sheets
    .filter((sheet) =>
      sheet.tipo === typeCode &&
      ui.canSeeSheet(sheet, productDetailsState.permissions)
    )
    .sort(ui.compareSheets);

  moduleDetailTitle.textContent = type.nome;
  moduleDetail.hidden = false;

  if (!sheets.length) {
    const action = getModuleAction(type, null);
    moduleDetailContent.innerHTML = `
      <div class="empty-panel">
        <strong>Nenhuma ficha cadastrada</strong>
        <span>Inicie o módulo por uma criação normal ou importação.</span>
        ${
          action
            ? `<a href="${action.href}" class="button button-primary">
                ${ui.escapeHtml(action.label)}
              </a>`
            : ""
        }
      </div>
    `;
    moduleDetail.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  moduleDetailContent.innerHTML = `
    <div class="module-revision-list">
      ${sheets.map((sheet) => {
        const importData = ui.getImport(sheet);
        const action = getModuleAction(type, sheet);
        const validations =
          importData?.validacoes_importacao_ficha ?? [];
        const validation = [...validations].sort((left, right) =>
          String(right.criado_em).localeCompare(String(left.criado_em))
        )[0];
        const approvals = sheet.aprovacoes_ficha ?? [];
        const canCreateRevision =
          ["IMPORTADA", "HISTORICA"].includes(sheet.status) &&
          (!importData || importData.estado === "IMPORTADA") &&
          productDetailsState.permissions.has("ficha.criar");

        return `
          <article class="module-revision-row">
            <div>
              <strong>Revisão ${ui.escapeHtml(
                sheet.numero_revisao
              )}</strong>
              <span>${ui.escapeHtml(
                sheet.codigo_documento ?? "Sem código"
              )}</span>
            </div>
            <div>
              ${ui.statusBadge(sheet)}
              <span>Emissão: ${ui.formatDate(sheet.data_emissao)}</span>
              ${
                importData
                  ? `<small>${
                      importData.estado === "IMPORTADA"
                        ? `Validada por ${
                            ui.escapeHtml(
                              validation?.administrador_nome ?? "Administrador"
                            )
                          }`
                        : "Importação aguardando validação administrativa"
                    }</small>`
                  : ""
              }
            </div>
            <div>
              <span>${approvals.length} aprovação(ões) registrada(s)</span>
              <small>${sheet.vigente ? "Ficha vigente" : "Não vigente"}</small>
            </div>
            <div class="master-row-actions">
              ${
                action
                  ? `<a href="${action.href}" class="table-action">${
                      ui.escapeHtml(action.label)
                    }</a>`
                  : ""
              }
              ${
                canCreateRevision
                  ? `<button type="button"
                      class="table-action create-module-revision"
                      data-sheet-id="${sheet.id}">
                      Criar nova revisão
                    </button>`
                  : ""
              }
            </div>
          </article>
        `;
      }).join("")}
    </div>
  `;
  moduleDetail.scrollIntoView({ behavior: "smooth", block: "start" });
}

function initializeTabs() {
  const tabs =
    document.querySelectorAll(".product-tab");

  const panels =
    document.querySelectorAll(".product-tab-panel");

  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      const selectedTab = tab.dataset.tab;
      const directPages = {
        moldagem: "moldagem.html",
        vazamento: "fusao-vazamento.html"
      };
      const directPage = directPages[selectedTab];

      if (
        directPage &&
        productDetailsState.permissions.has("ficha.visualizar")
      ) {
        const productId =
          productDetailsState.product?.id ?? getProductId();
        const params = new URLSearchParams({
          produto: productId,
          codigo: productDetailsState.product?.codigo ?? ""
        });
        if (window.LIDUTEC_FICHA_PREVIEW?.isEnabled()) {
          params.set("preview", "1");
        }
        window.location.assign(`./${directPage}?${params}`);
        return;
      }

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

      // Moldagem/Vazamento navegam pra outra página (sem esse botão);
      // Macharia fica na própria detalhes.html, então precisa esconder
      // manualmente pra não editar dados do produto por essa aba.
      if (editProductButton) {
        editProductButton.hidden = selectedTab === "macharia";
      }
    });
  }

  const initialTab = new URLSearchParams(
    window.location.search
  ).get("tab");
  const initialButton = [...tabs].find(
    (tab) => tab.dataset.tab === initialTab
  );
  if (
    initialButton &&
    !["moldagem", "vazamento"].includes(initialTab)
  ) {
    for (const currentTab of tabs) {
      currentTab.classList.toggle(
        "active",
        currentTab === initialButton
      );
    }
    for (const panel of panels) {
      const isSelected = panel.dataset.panel === initialTab;
      panel.hidden = !isSelected;
      panel.classList.toggle("active", isSelected);
    }
    if (editProductButton) {
      editProductButton.hidden = initialTab === "macharia";
    }
  }
}

async function initializeProductDetails() {
  if (window.LIDUTEC_FICHA_PREVIEW?.isEnabled()) {
    const product =
      window.LIDUTEC_FICHA_PREVIEW.getProduct();
    const moldingSheet =
      window.LIDUTEC_FICHA_PREVIEW.getSheet("MOLDAGEM");
    const castingSheet =
      window.LIDUTEC_FICHA_PREVIEW.getSheet(
        "FUSAO_VAZAMENTO"
      );

    userName.textContent = "Preview local";
    userProfile.textContent = "Somente leitura";
    userAvatar.textContent = "PL";
    document.querySelector("#preview-banner").hidden = false;
    logoutButton.hidden = true;
    if (topbarProductNav) {
      topbarProductNav.hidden = true;
    }

    initializeTabs();
    showProduct(product);
    productDetailsState.permissions = new Set(["ficha.visualizar"]);
    productDetailsState.sheets = [moldingSheet, castingSheet].map(
      (sheet) => ({
        ...sheet,
        produto_id: product.id,
        importacoes_ficha: [{
          id: `preview-${sheet.tipo}`,
          estado: "IMPORTADA",
          validacoes_importacao_ficha: []
        }],
        aprovacoes_ficha: []
      })
    );
    renderModuleCards();
    editProductButton.hidden = true;
    moldingStatus.textContent = "Importada";
    moldingRevision.textContent =
      `Revisão ${moldingSheet.numero_revisao}`;
    castingStatus.textContent = "Importada";
    castingRevision.textContent =
      `Revisão ${castingSheet.numero_revisao}`;

    document.querySelector("#open-molding-button").href =
      `./moldagem.html?produto=${product.id}&preview=1`;
    document.querySelector("#open-casting-button").href =
      `./fusao-vazamento.html?produto=${product.id}&preview=1`;

    productLoading.hidden = true;
    productContent.hidden = false;
    return;
  }

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
  productDetailsState.permissions = permissions;

  const openMoldingButton =
    document.querySelector("#open-molding-button");
  const openCastingButton =
    document.querySelector("#open-casting-button");
  const canViewMolding =
    permissions.has("ficha.visualizar");

  if (openMoldingButton) {
    openMoldingButton.hidden = !canViewMolding;
  }

  if (openCastingButton) {
    openCastingButton.hidden = !canViewMolding;
  }

  userName.textContent = profile.nome;
  userProfile.textContent =
    profile.perfil ?? "Usuário";
  userAvatar.textContent =
    getInitials(profile.nome);

  initializeTabs();

  if (!canViewMolding) {
    moldingStatus.textContent = "Sem permissão";
    moldingRevision.textContent = "—";
    castingStatus.textContent = "Sem permissão";
    castingRevision.textContent = "—";
    if (machariaMachosList) {
      machariaMachosList.innerHTML =
        "<li class=\"production-muted\">Sem permissão para visualizar.</li>";
    }
  }

  const [product, sheets] = await Promise.all([
    loadProduct(productId),
    canViewMolding ? loadProductSheets(productId) : Promise.resolve([])
  ]);
  productDetailsState.product = product;
  productDetailsState.sheets = sheets;
  renderModuleCards();
  if (canViewMolding) {
    renderMachariaList().catch((error) => {
      console.error(error);
      if (machariaMachosList) {
        machariaMachosList.innerHTML =
          `<li class="production-muted">Não foi possível carregar os machos: ${error.message}</li>`;
      }
    });
  }

  await window.LIDUTEC_PRODUCT_HEADER_NAV?.updateProductNav(product.id);

  productLoading.hidden = true;
  productContent.hidden = false;
}

menuButton?.addEventListener("click", () => {
  sidebar?.classList.toggle("open");
});

logoutButton?.addEventListener("click", async () => {
  await window.LIDUTEC_APP.signOut();
});

productModuleCards?.addEventListener("click", (event) => {
  const button = event.target.closest(".view-module");
  if (button) {
    renderModuleDetail(button.dataset.moduleType);
  }
});

moduleDetailContent?.addEventListener("click", async (event) => {
  const button = event.target.closest(".create-module-revision");
  if (!button) {
    return;
  }

  const sheet = productDetailsState.sheets.find(
    (item) => String(item.id) === button.dataset.sheetId
  );
  if (!sheet) {
    return;
  }

  try {
    button.disabled = true;
    const newSheetId =
      await window.LIDUTEC_FICHAS_UI.createNewRevision(sheet);
    if (!newSheetId) {
      return;
    }
    const url = window.LIDUTEC_FICHAS_UI.sheetUrl(sheet);
    if (url) {
      window.location.href = url;
    } else {
      window.location.reload();
    }
  } catch (error) {
    alert(`Não foi possível criar a revisão: ${error.message}`);
  } finally {
    button.disabled = false;
  }
});

deleteObsoleteProductButton?.addEventListener("click", () => {
  const product = productDetailsState.product;
  if (
    !product ||
    product.status !== "OBSOLETO" ||
    !productDetailsState.permissions.has("produto.excluir_obsoleto")
  ) {
    return;
  }

  deleteObsoleteProductConfirmation.value = "";
  deleteObsoleteProductMessage.hidden = true;
  deleteObsoleteProductDialog.showModal();
  deleteObsoleteProductConfirmation.focus();
});

cancelDeleteObsoleteProduct?.addEventListener("click", () => {
  deleteObsoleteProductDialog.close();
});

async function removeProductStorageFiles(bucket, paths) {
  const uniquePaths = [...new Set((paths ?? []).filter(Boolean))];
  const errors = [];

  for (let index = 0; index < uniquePaths.length; index += 100) {
    const chunk = uniquePaths.slice(index, index + 100);
    const { error } = await window.supabaseClient.storage
      .from(bucket)
      .remove(chunk);
    if (error) {
      errors.push(`${bucket}: ${error.message}`);
    }
  }
  return errors;
}

deleteObsoleteProductForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const product = productDetailsState.product;
  const confirmation = deleteObsoleteProductConfirmation.value.trim();

  if (!product || confirmation.toUpperCase() !== product.codigo.toUpperCase()) {
    deleteObsoleteProductMessage.textContent =
      "Digite exatamente o código do produto para confirmar.";
    deleteObsoleteProductMessage.hidden = false;
    return;
  }

  confirmDeleteObsoleteProduct.disabled = true;
  cancelDeleteObsoleteProduct.disabled = true;
  deleteObsoleteProductConfirmation.disabled = true;
  deleteObsoleteProductMessage.hidden = true;

  try {
    const { data, error } = await window.supabaseClient.rpc(
      "excluir_produto_obsoleto",
      {
        p_produto_id: product.id,
        p_confirmacao_codigo: confirmation
      }
    );
    if (error) {
      throw error;
    }

    const storageErrors = [
      ...await removeProductStorageFiles(
        "fichas-tecnicas-pdf",
        data?.pdf_storage_paths
      ),
      ...await removeProductStorageFiles(
        "reclamacoes-cliente",
        data?.anexo_storage_paths
      )
    ];

    deleteObsoleteProductDialog.close();
    const summary = [
      `Produto ${product.codigo} excluído definitivamente.`,
      `${data?.fichas_excluidas ?? 0} ficha(s),`,
      `${data?.reclamacoes_excluidas ?? 0} reclamação(ões),`,
      `${data?.registros_producao_excluidos ?? 0} registro(s) de produção e`,
      `${data?.paradas_excluidas ?? 0} parada(s) removidos.`
    ].join(" ");
    alert(
      storageErrors.length
        ? `${summary}\n\nAtenção: alguns arquivos não puderam ser removidos: ${storageErrors.join("; ")}`
        : summary
    );
    window.location.replace("./lista.html");
  } catch (error) {
    deleteObsoleteProductMessage.textContent =
      `Não foi possível excluir o produto: ${error.message}`;
    deleteObsoleteProductMessage.hidden = false;
  } finally {
    confirmDeleteObsoleteProduct.disabled = false;
    cancelDeleteObsoleteProduct.disabled = false;
    deleteObsoleteProductConfirmation.disabled = false;
  }
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
