const moldingElements = {
  sidebar: document.querySelector("#sidebar"),
  menuButton: document.querySelector("#menu-button"),
  logoutButton: document.querySelector("#logout-button"),
  userName: document.querySelector("#user-name"),
  userProfile: document.querySelector("#user-profile"),
  userAvatar: document.querySelector("#user-avatar"),
  loading: document.querySelector("#molding-loading"),
  content: document.querySelector("#molding-content"),
  error: document.querySelector("#molding-error"),
  form: document.querySelector("#molding-form"),
  parameters: document.querySelector("#molding-parameters"),
  empty: document.querySelector("#molding-empty"),
  message: document.querySelector("#molding-message"),
  saveButton: document.querySelector("#save-molding-button"),
  createButton: document.querySelector("#create-molding-button"),
  historyButton: document.querySelector("#molding-history-button"),
  historyPanel: document.querySelector("#molding-revision-history"),
  historyList: document.querySelector("#molding-revision-list"),
  printButton: document.querySelector("#molding-print-button"),
  pdfButton: document.querySelector("#molding-pdf-button"),
  importButton: document.querySelector("#molding-import-button"),
  newRevisionButton: document.querySelector(
    "#molding-new-revision-button"
  ),
  editButton: document.querySelector("#molding-edit-button"),
  submitApprovalButton: document.querySelector("#molding-submit-approval"),
  approveButton: document.querySelector("#molding-approve"),
  rejectButton: document.querySelector("#molding-reject"),
  editDialog: document.querySelector("#molding-edit-dialog"),
  baseSheetSelect: document.querySelector("#molding-base-sheet"),
  issueDate: document.querySelector("#molding-issue-date"),
  reason: document.querySelector("#molding-reason")
};

const moldingState = {
  user: null,
  permissions: new Set(),
  product: null,
  sheet: null,
  sheets: [],
  parameters: [],
  history: [],
  approvals: [],
  editable: false,
  mode: "LEITURA",
  editRequested: false
};

const fichaConfig = window.location.pathname.includes(
  "fusao-vazamento"
)
  ? {
      tipo: "FUSAO_VAZAMENTO",
      nome: "Fusão / Vazamento",
      classeLayout: "sheet-layout-fusion"
    }
  : {
      tipo: "MOLDAGEM",
      nome: "Moldagem",
      classeLayout: "sheet-layout-molding"
    };

function getMoldingProductId() {
  return new URLSearchParams(window.location.search).get("produto");
}

function getExplicitSheetId() {
  const value = new URLSearchParams(
    window.location.search
  ).get("ficha");
  return value && !["null", "undefined", "0"].includes(value)
    ? value
    : null;
}

function getMoldingInitials(name = "Usuário") {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function getToday() {
  const now = new Date();
  const timezoneOffset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - timezoneOffset)
    .toISOString()
    .slice(0, 10);
}

function showMoldingMessage(text, type) {
  moldingElements.message.textContent = text;
  moldingElements.message.className = `form-message ${type}`;
  moldingElements.message.hidden = false;
}

function normalizeListOptions(options) {
  if (Array.isArray(options)) {
    return options;
  }

  if (options && typeof options === "object") {
    return Object.entries(options).map(([value, label]) => ({
      value,
      label
    }));
  }

  if (typeof options !== "string" || !options.trim()) {
    return [];
  }

  try {
    return normalizeListOptions(JSON.parse(options));
  } catch {
    return options
      .split(/\r?\n|;/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
}

function createInput(type, name, value) {
  const input = document.createElement("input");
  input.type = type === "number" ? "text" : type;
  input.name = name;
  input.value = value ?? "";

  if (type === "number") {
    input.inputMode = "decimal";
    input.dataset.numeric = "true";
  }

  return input;
}

function createSelect(name, options, value) {
  const select = document.createElement("select");
  select.name = name;

  const emptyOption = document.createElement("option");
  emptyOption.value = "";
  emptyOption.textContent = "Selecione";
  select.append(emptyOption);

  for (const item of options) {
    const option = document.createElement("option");
    option.value = typeof item === "object" ? item.value : item;
    option.textContent =
      typeof item === "object" ? item.label ?? item.value : item;
    option.selected = String(option.value) === String(value ?? "");
    select.append(option);
  }

  return select;
}

function appendField(container, labelText, control) {
  const wrapper = document.createElement("label");
  wrapper.className = "molding-value-field";

  const label = document.createElement("span");
  label.textContent = labelText;

  wrapper.append(label, control);
  container.append(wrapper);
}

function getStoredValue(parameter, field) {
  return parameter.valores_parametros?.[0]?.[field] ?? "";
}

function canEditCurrentSheet() {
  if (!moldingState.sheet) {
    return false;
  }

  return (
    moldingState.sheet.status === "RASCUNHO" &&
    moldingState.permissions.has("ficha.editar_rascunho")
  );
}

function renderParameter(parameter) {
  const card = document.createElement("article");
  card.className = "molding-parameter";
  card.dataset.parameterId = parameter.id;
  card.dataset.dataType = parameter.tipo_dado;
  card.dataset.allowsRange = String(Boolean(parameter.permite_faixa));
  card.dataset.critical = String(Boolean(parameter.critico));
  card.dataset.notApplicable = String(
    Boolean(getStoredValue(parameter, "nao_aplicavel"))
  );

  if (parameter.critico) {
    card.setAttribute(
      "aria-label",
      `Parâmetro crítico: ${parameter.nome}`
    );
  }

  const heading = document.createElement("div");
  heading.className = "molding-parameter-heading";

  const title = document.createElement("div");
  const name = document.createElement("strong");
  name.textContent = parameter.nome ?? "Parâmetro";
  name.title = parameter.nome ?? "Parâmetro";
  title.append(name);

  if (parameter.critico) {
    const critical = document.createElement("span");
    critical.className = "molding-critical-label";
    critical.textContent = "⚠ Crítico";
    title.append(critical);
  }

  const unit = document.createElement("span");
  unit.className = "molding-field-unit";
  unit.textContent = parameter.unidade ?? "—";
  heading.append(title);

  const fields = document.createElement("div");
  fields.className = "molding-value-grid";

  if (parameter.tipo_dado === "NUMERO") {
    if (parameter.configuracao_visual?.intervalo_inicio_fim) {
      appendField(fields, "Início", createInput(
        "number",
        "valor_inicial",
        getStoredValue(parameter, "valor_inicial")
      ));
      appendField(fields, "Fim", createInput(
        "number",
        "valor_final",
        getStoredValue(parameter, "valor_final")
      ));
    } else if (parameter.permite_faixa) {
      appendField(fields, "Valor", createInput(
        "number",
        "valor_numerico",
        getStoredValue(parameter, "valor_numerico")
      ));
      appendField(fields, "Mínimo", createInput(
        "number",
        "valor_minimo",
        getStoredValue(parameter, "valor_minimo")
      ));
      appendField(fields, "Alvo", createInput(
        "number",
        "valor_alvo",
        getStoredValue(parameter, "valor_alvo")
      ));
      appendField(fields, "Máximo", createInput(
        "number",
        "valor_maximo",
        getStoredValue(parameter, "valor_maximo")
      ));
    } else {
      appendField(fields, "Valor", createInput(
        "number",
        "valor_numerico",
        getStoredValue(parameter, "valor_numerico")
      ));
    }

    for (const input of fields.querySelectorAll("input")) {
      input.step = "any";
    }
  } else if (parameter.tipo_dado === "BOOLEANO") {
    appendField(fields, "Valor", createSelect(
      "valor_booleano",
      [
        { value: "true", label: "Sim" },
        { value: "false", label: "Não" }
      ],
      getStoredValue(parameter, "valor_booleano")
    ));
  } else if (parameter.tipo_dado === "LISTA") {
    appendField(fields, "Valor", createSelect(
      "valor_texto",
      normalizeListOptions(parameter.lista_opcoes),
      getStoredValue(parameter, "valor_texto")
    ));
  } else if (parameter.tipo_dado === "DATA") {
    appendField(fields, "Valor", createInput(
      "date",
      "valor_data",
      getStoredValue(parameter, "valor_data")
    ));
  } else {
    appendField(fields, parameter.tipo_dado === "IMAGEM" ? "URL da imagem" : "Valor", createInput(
      parameter.tipo_dado === "IMAGEM" ? "url" : "text",
      "valor_texto",
      getStoredValue(parameter, "valor_texto")
    ));
  }

  if (fichaConfig.tipo === "MOLDAGEM") {
    fields.querySelector(".molding-value-field")?.append(unit);
  } else {
    unit.className = "molding-parameter-unit";
    heading.append(unit);
  }

  const storedObservation = getStoredValue(parameter, "observacao");
  if (storedObservation !== "" || canEditCurrentSheet()) {
    appendField(fields, "Observação", createInput(
      "text",
      "observacao",
      storedObservation
    ));
  }

  card.append(heading);

  const parameterNote = parameter.observacao ?? parameter.descricao;
  if (parameterNote) {
    const note = document.createElement("p");
    note.className = "molding-parameter-note";
    note.textContent = parameterNote;
    card.append(note);
  }

  card.append(fields);
  return card;
}

function renderGroups(groups, parameters) {
  moldingElements.parameters.replaceChildren();

  for (const group of groups) {
    const section = document.createElement("section");
    section.className = "panel molding-group";
    const layoutClass = String(group.tipo_layout ?? "BLOCOS")
      .toLowerCase()
      .replaceAll("_", "-");
    section.classList.add(`layout-${layoutClass}`);
    section.classList.toggle(
      "layout-matriz",
      group.tipo_layout === "MATRIZ"
    );

    const header = document.createElement("div");
    header.className = "panel-header";
    const title = document.createElement("h3");
    title.textContent = group.nome;
    header.append(title);
    section.append(header);

    if (group.descricao) {
      const description = document.createElement("p");
      description.className = "molding-group-description";
      description.textContent = group.descricao;
      section.append(description);
    }

    if (group.tipo_layout === "HISTORICO") {
      renderInformationalRows(
        section,
        moldingState.history,
        (item) => `Revisão ${item.numero_revisao}`,
        (item) => [
          item.data_revisao,
          item.descricao,
          item.responsavel
        ].filter(Boolean).join(" — ")
      );
      moldingElements.parameters.append(section);
      continue;
    }

    if (group.tipo_layout === "APROVACAO") {
      const historicalMetadata = [
        moldingState.sheet?.elaborado_por_texto
          ? {
              tipo_aprovacao: "Elaboração no documento original",
              nome_responsavel:
                moldingState.sheet.elaborado_por_texto,
              status: "Metadado histórico — sem assinatura eletrônica"
            }
          : null,
        moldingState.sheet?.aprovado_engenharia_por_texto
          ? {
              tipo_aprovacao: "Aprovação de Engenharia no documento original",
              nome_responsavel:
                moldingState.sheet.aprovado_engenharia_por_texto,
              status: "Metadado histórico — sem assinatura eletrônica"
            }
          : null,
        moldingState.sheet?.aprovado_processo_por_texto
          ? {
              tipo_aprovacao: "Aprovação do processo no documento original",
              nome_responsavel:
                moldingState.sheet.aprovado_processo_por_texto,
              status: "Metadado histórico — sem assinatura eletrônica"
            }
          : null
      ].filter(Boolean);

      renderInformationalRows(
        section,
        [...historicalMetadata, ...moldingState.approvals],
        (item) => item.tipo_aprovacao,
        (item) => [
          item.nome_responsavel,
          item.status,
          item.observacao
        ].filter(Boolean).join(" — ")
      );
      moldingElements.parameters.append(section);
      if (fichaConfig.tipo === "MOLDAGEM") {
        break;
      }
      continue;
    }

    const groupParameters = parameters.filter(
      (parameter) => parameter.grupo_id === group.id
    );

    for (const parameter of groupParameters) {
      section.append(renderParameter(parameter));
    }

    moldingElements.parameters.append(section);
  }

  moldingElements.empty.hidden = parameters.length > 0;
}

function renderInformationalRows(
  container,
  items,
  getTitle,
  getDescription
) {
  if (items.length === 0) {
    const empty = document.createElement("p");
    empty.className = "molding-parameter-note";
    empty.textContent = "Nenhum registro disponível.";
    container.append(empty);
    return;
  }

  for (const item of items) {
    const row = document.createElement("article");
    row.className = "molding-information-row";
    const title = document.createElement("strong");
    const description = document.createElement("span");
    title.textContent = getTitle(item) ?? "Registro";
    description.textContent = getDescription(item) || "—";
    row.append(title, description);
    container.append(row);
  }
}

function renderizarFichaMoldagem(groups, parameters) {
  moldingElements.parameters.className =
    "molding-groups sheet-layout-molding";
  renderGroups(groups, parameters);
}

function renderizarFichaFusaoVazamento(groups, parameters) {
  moldingElements.parameters.className =
    "molding-groups sheet-layout-fusion";
  renderGroups(groups, parameters);
}

function renderizarFichaPorTipo(groups, parameters) {
  if (fichaConfig.tipo === "FUSAO_VAZAMENTO") {
    renderizarFichaFusaoVazamento(groups, parameters);
    return;
  }

  renderizarFichaMoldagem(groups, parameters);
}

async function loadMoldingProduct(productId) {
  let { data, error } = await window.supabaseClient
    .from("produtos")
    .select("*, clientes(nome), familias_produto(nome)")
    .eq("id", productId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const productCode = new URLSearchParams(
    window.location.search
  ).get("codigo");
  if (!data && productCode) {
    ({ data, error } = await window.supabaseClient
      .from("produtos")
      .select("*, clientes(nome), familias_produto(nome)")
      .eq("codigo", productCode)
      .maybeSingle());
    if (error) {
      throw error;
    }
  }

  if (!data) {
    throw new Error("Produto não encontrado.");
  }

  return data;
}

async function loadMoldingSheets(productId) {
  let { data, error } = await window.supabaseClient
    .from("fichas_tecnicas")
    .select("*, importacoes_ficha(*)")
    .eq("produto_id", productId)
    .eq("tipo", fichaConfig.tipo)
    .order("numero_revisao", { ascending: false })
    .order("criado_em", { ascending: false })
    .order("id", { ascending: false });

  if (error && /importacoes_ficha/i.test(error.message ?? "")) {
    ({ data, error } = await window.supabaseClient
      .from("fichas_tecnicas")
      .select("*")
      .eq("produto_id", productId)
      .eq("tipo", fichaConfig.tipo)
      .order("numero_revisao", { ascending: false })
      .order("criado_em", { ascending: false })
      .order("id", { ascending: false }));
  }

  if (error) {
    throw error;
  }

  return data ?? [];
}

async function loadMoldingParameters(sheetId) {
  const { data: groups, error: groupsError } =
    await window.supabaseClient
      .from("grupos_parametros")
      .select("*")
      .eq("tipo_ficha", fichaConfig.tipo)
      .order("ordem_exibicao", { ascending: true });

  if (groupsError) {
    throw groupsError;
  }

  const groupIds = (groups ?? []).map((group) => group.id);
  if (groupIds.length === 0) {
    return { groups: [], parameters: [] };
  }

  const { data: parameters, error: parametersError } =
    await window.supabaseClient
    .from("parametros")
    .select("*")
    .in("grupo_id", groupIds)
    .order("ordem_exibicao", { ascending: true });

  if (parametersError) {
    throw parametersError;
  }

  let values = [];
  if (sheetId) {
    const { data, error } = await window.supabaseClient
      .from("valores_parametros")
      .select(`
        parametro_id,
        valor_texto,
        valor_numerico,
        valor_minimo,
        valor_alvo,
        valor_maximo,
        valor_booleano,
        valor_data,
        observacao,
        valor_inicial,
        valor_final,
        nao_aplicavel
      `)
      .eq("ficha_tecnica_id", sheetId);

    if (error) {
      throw error;
    }
    values = data ?? [];
  }

  const valueByParameter = new Map(
    values.map((value) => [value.parametro_id, value])
  );
  const parametersWithValues = (parameters ?? []).map(
    (parameter) => ({
      ...parameter,
      valores_parametros: valueByParameter.has(parameter.id)
        ? [valueByParameter.get(parameter.id)]
        : []
    })
  );

  return {
    groups: groups ?? [],
    parameters: parametersWithValues
  };
}

async function loadSheetSupportData(sheetId) {
  if (!sheetId) {
    return { history: [], approvals: [] };
  }

  const [historyResult, approvalsResult] = await Promise.all([
    window.supabaseClient
      .from("historico_fichas")
      .select("*")
      .eq("ficha_tecnica_id", sheetId)
      .order("numero_revisao", { ascending: false }),
    window.supabaseClient
      .from("aprovacoes_ficha")
      .select("*")
      .eq("ficha_tecnica_id", sheetId)
      .order("ordem", { ascending: true })
  ]);

  if (historyResult.error) {
    throw historyResult.error;
  }

  if (approvalsResult.error) {
    throw approvalsResult.error;
  }

  return {
    history: historyResult.data ?? [],
    approvals: approvalsResult.data ?? []
  };
}

function updateMoldingHeader() {
  const { product, sheet } = moldingState;
  const ui = window.LIDUTEC_FICHAS_UI;
  document.querySelector("#molding-subtitle").textContent =
    `${product.codigo} — ${product.nome}`;
  document.querySelector("#molding-product-name").textContent =
    `${product.codigo} — ${product.nome}`;
  document.querySelector("#molding-product-code").textContent =
    product.codigo_cliente
      ? `Código do cliente: ${product.codigo_cliente}`
      : "Cadastro mestre de engenharia";

  const productStatus = document.querySelector("#sheet-product-status");
  const isActive = product.status === "ATIVO";
  productStatus.textContent = isActive ? "Ativo" : "Inativo";
  productStatus.className =
    `status-badge ${isActive ? "ativo" : "inativo"}`;

  const productImage = document.querySelector("#sheet-product-image");
  const imagePlaceholder = document.querySelector(
    "#sheet-product-image-placeholder"
  );
  if (product.imagem_principal_url) {
    productImage.src = product.imagem_principal_url;
    productImage.hidden = false;
    imagePlaceholder.hidden = true;
  } else {
    productImage.removeAttribute("src");
    productImage.hidden = true;
    imagePlaceholder.hidden = false;
  }
  document.querySelector("#back-to-product").href =
    `./detalhes.html?id=${product.id}`;
  for (const link of document.querySelectorAll(
    "[data-product-tab-link]"
  )) {
    const target = link.dataset.productTabLink;
    const preview = window.LIDUTEC_FICHA_PREVIEW?.isEnabled()
      ? "&preview=1"
      : "";
    if (target === "moldagem") {
      link.href = `./moldagem.html?produto=${encodeURIComponent(
        product.id
      )}&codigo=${encodeURIComponent(product.codigo)}${preview}`;
    } else if (target === "vazamento") {
      link.href = `./fusao-vazamento.html?produto=${encodeURIComponent(
        product.id
      )}&codigo=${encodeURIComponent(product.codigo)}${preview}`;
    } else {
      link.href = `./detalhes.html?id=${encodeURIComponent(
        product.id
      )}&tab=${encodeURIComponent(target)}${preview}`;
    }
  }
  const statusElement = document.querySelector(
    "#molding-sheet-status"
  );
  const statusData = sheet
    ? ui.getStatusData(sheet)
    : { label: "Sem ficha cadastrada", className: "inativo" };
  statusElement.textContent = statusData.label;
  statusElement.className = `status-badge ${statusData.className}`;
  document.querySelector("#molding-sheet-revision").textContent =
    sheet ? `Revisão ${sheet.numero_revisao}` : "Revisão —";
  document.querySelector("#molding-document-code").textContent =
    sheet?.codigo_documento ?? "Documento ainda não emitido";

  moldingElements.issueDate.value =
    sheet?.data_emissao?.slice(0, 10) ?? "";
  moldingElements.reason.value = sheet?.motivo_revisao ?? "";

  const administrative = document.querySelector(
    "#molding-administrative-status"
  );
  if (administrative) {
    administrative.textContent = sheet
      ? `Situação: ${ui.getStatusData(sheet).label}`
      : "Situação: sem ficha";
  }
  const issuance = document.querySelector("#molding-header-issue-date");
  const validity = document.querySelector("#molding-header-validity");
  if (issuance) {
    issuance.textContent = `Emissão: ${
      ui.formatDate(sheet?.data_emissao)
    }`;
  }
  if (validity) {
    validity.textContent = sheet?.vigente
      ? "Vigência: vigente"
      : "Vigência: não vigente";
  }

  const meta = document.querySelector("#sheet-product-meta");
  const items = [
    ["Cliente", product.clientes?.nome],
    ["Part number", product.part_number],
    ["Família", product.familias_produto?.nome],
    ["Peça de segurança", product.peca_seguranca ? "Sim" : "Não"]
  ];
  meta.replaceChildren();
  for (const [labelText, value] of items) {
    const item = document.createElement("div");
    const label = document.createElement("span");
    const content = document.createElement("strong");
    label.textContent = labelText;
    content.textContent = value ?? "—";
    item.append(label, content);
    meta.append(item);
  }
}

function getMoldingMode() {
  if (!moldingState.sheet) {
    return "SEM_FICHA";
  }
  const importData = window.LIDUTEC_FICHAS_UI.getImport(
    moldingState.sheet
  );
  if (importData && importData.estado !== "IMPORTADA") {
    return "CONFERENCIA_IMPORTACAO";
  }
  return canEditCurrentSheet() && (
    fichaConfig.tipo !== "MOLDAGEM" ||
    moldingState.editRequested
  )
    ? "EDICAO"
    : "LEITURA";
}

function renderMoldingHistory() {
  if (!moldingElements.historyList) {
    return;
  }
  const ui = window.LIDUTEC_FICHAS_UI;
  const rows = moldingState.sheets
    .filter((sheet) =>
      ui.canSeeSheet(sheet, moldingState.permissions)
    )
    .sort(ui.compareSheets);
  moldingElements.historyList.replaceChildren();
  for (const sheet of rows) {
    const link = document.createElement("a");
    link.className = "molding-history-item";
    link.href = `./moldagem.html?produto=${encodeURIComponent(
      moldingState.product.id
    )}&ficha=${encodeURIComponent(sheet.id)}`;
    const title = document.createElement("strong");
    const description = document.createElement("span");
    title.textContent = `Revisão ${sheet.numero_revisao}`;
    description.textContent = `${
      ui.getStatusData(sheet).label
    } · ${ui.formatDate(sheet.data_emissao)}`;
    link.append(title, description);
    moldingElements.historyList.append(link);
  }
}

function updateMoldingActions() {
  const ui = window.LIDUTEC_FICHAS_UI;
  const sheet = moldingState.sheet;
  const importData = ui.getImport(sheet);
  const canCreate = moldingState.permissions.has("ficha.criar");

  if (moldingElements.createButton) {
    moldingElements.createButton.hidden =
      moldingState.mode !== "SEM_FICHA" || !canCreate;
  }
  if (moldingElements.historyButton) {
    moldingElements.historyButton.hidden =
      !moldingState.sheets.some((candidate) =>
        ui.canSeeSheet(candidate, moldingState.permissions)
      );
  }
  if (moldingElements.importButton) {
    moldingElements.importButton.hidden = !(
      importData &&
      importData.estado !== "IMPORTADA" &&
      [
        "ficha.importar",
        "ficha.conferir_importacao",
        "ficha.validar_importacao"
      ].some((permission) =>
        moldingState.permissions.has(permission)
      )
    );
    if (!moldingElements.importButton.hidden) {
      moldingElements.importButton.href = ui.importUrl(
        moldingState.product.id,
        fichaConfig.tipo,
        importData.id
      );
    }
  }
  if (moldingElements.pdfButton) {
    moldingElements.pdfButton.hidden =
      !importData?.pdf_storage_path;
  }
  if (moldingElements.newRevisionButton) {
    moldingElements.newRevisionButton.hidden = !(
      sheet &&
      canCreate &&
      (
        sheet.status === "APROVADA" ||
        ui.isImportValidated(sheet)
      )
    );
  }
  if (moldingElements.editButton) {
    moldingElements.editButton.hidden = !(
      sheet?.status === "RASCUNHO" &&
      moldingState.permissions.has("ficha.editar_rascunho") &&
      !moldingState.editRequested
    );
  }
}

function applyMoldingReadOnly() {
  moldingState.mode = getMoldingMode();

  moldingState.editable = moldingState.mode === "EDICAO";

  for (const control of moldingElements.form.querySelectorAll(
    "input, select, textarea"
  )) {
    control.disabled = !moldingState.editable;
  }

  moldingElements.saveButton.hidden = !moldingState.editable;
  const canSubmit = moldingState.sheet?.status === "RASCUNHO" &&
    (moldingState.permissions.has("ficha.editar_rascunho") ||
      moldingState.permissions.has("ficha.criar"));
  const canDecide = moldingState.sheet?.status === "PENDENTE_APROVACAO" &&
    (moldingState.permissions.has("ficha.aprovar_engenharia") ||
      moldingState.permissions.has("ficha.aprovar_producao"));
  if (moldingElements.submitApprovalButton) {
    moldingElements.submitApprovalButton.hidden = !canSubmit;
  }
  if (moldingElements.approveButton) {
    moldingElements.approveButton.hidden = !canDecide;
  }
  if (moldingElements.rejectButton) {
    moldingElements.rejectButton.hidden = !canDecide;
  }
  updateMoldingActions();

  if (moldingState.mode === "SEM_FICHA") {
    showMoldingMessage(
      moldingState.permissions.has("ficha.criar")
        ? "Este produto ainda não possui ficha técnica de Moldagem. Use Criar ficha para iniciar um rascunho."
        : "Este produto ainda não possui ficha técnica de Moldagem. Você não possui permissão para criar.",
      "error"
    );
  } else if (!moldingState.editable) {
    showMoldingMessage(
      moldingState.mode === "CONFERENCIA_IMPORTACAO"
        ? "Esta importação está pendente de conferência e permanece somente para leitura."
        : moldingState.sheet?.status === "RASCUNHO" &&
            moldingState.permissions.has("ficha.editar_rascunho")
          ? "Modo de visualização. Clique em Editar ajustes para alterar este rascunho."
        : "Esta ficha está disponível somente para leitura.",
      "error"
    );
  } else {
    moldingElements.message.hidden = true;
  }
}

function emptyToNull(value) {
  return value === "" ? null : value;
}

function normalizeNumericValue(value) {
  if (value === "" || value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim().replace(",", ".");
  const number = Number(normalized);

  if (!Number.isFinite(number)) {
    throw new Error(`Valor numérico inválido: ${value}.`);
  }

  return number;
}

function collectParameterValues() {
  return [...document.querySelectorAll(".molding-parameter")].map(
    (card) => {
      const row = {
        parametro_id: card.dataset.parameterId,
        valor_texto: null,
        valor_numerico: null,
        valor_minimo: null,
        valor_alvo: null,
        valor_maximo: null,
        valor_booleano: null,
        valor_data: null,
        valor_inicial: null,
        valor_final: null,
        nao_aplicavel:
          card.dataset.notApplicable === "true",
        observacao: emptyToNull(
          card.querySelector('[name="observacao"]')?.value ?? ""
        )
      };

      for (const field of [
        "valor_texto",
        "valor_numerico",
        "valor_minimo",
        "valor_alvo",
        "valor_maximo",
        "valor_inicial",
        "valor_final",
        "valor_data"
      ]) {
        const control = card.querySelector(`[name="${field}"]`);
        if (control) {
          row[field] = field.startsWith("valor_") &&
              field !== "valor_texto" &&
              field !== "valor_data"
            ? normalizeNumericValue(control.value)
            : emptyToNull(control.value);
        }
      }

      const booleanControl =
        card.querySelector('[name="valor_booleano"]');
      if (booleanControl?.value) {
        row.valor_booleano = booleanControl.value === "true";
      }

      const minimum = row.valor_minimo;
      const target = row.valor_alvo;
      const maximum = row.valor_maximo;

      if (
        minimum !== null &&
        maximum !== null &&
        minimum > maximum
      ) {
        throw new Error(
          `O mínimo não pode superar o máximo em ${card.querySelector("strong")?.textContent}.`
        );
      }

      if (
        target !== null &&
        ((minimum !== null && target < minimum) ||
          (maximum !== null && target > maximum))
      ) {
        throw new Error(
          `O alvo deve estar dentro da faixa em ${card.querySelector("strong")?.textContent}.`
        );
      }

      return row;
    }
  );
}

async function saveMoldingDraft() {
  if (!moldingState.editable) {
    throw new Error("Esta ficha não pode ser editada.");
  }

  if (
    moldingState.sheet &&
    moldingState.sheet.status !== "RASCUNHO"
  ) {
    throw new Error("Somente fichas em rascunho podem ser alteradas.");
  }

  const values = collectParameterValues();
  const { data: sheetId, error } = await window.supabaseClient
    .rpc("salvar_rascunho_ficha_tecnica_v2", {
      p_produto_id: moldingState.product.id,
      p_tipo: fichaConfig.tipo,
      p_ficha_id: moldingState.sheet?.id ?? null,
      p_motivo_revisao: emptyToNull(
        moldingElements.reason.value
      ),
      p_data_emissao: emptyToNull(
        moldingElements.issueDate.value
      ),
      p_valores: values
    });

  if (error) {
    throw error;
  }

  moldingState.sheet = {
    ...moldingState.sheet,
    id: sheetId,
    produto_id: moldingState.product.id,
    tipo: fichaConfig.tipo,
    numero_revisao:
      moldingState.sheet?.numero_revisao ?? 0,
    status: "RASCUNHO",
    vigente: false,
    motivo_revisao:
      emptyToNull(moldingElements.reason.value),
    data_emissao:
      emptyToNull(moldingElements.issueDate.value)
  };

  updateMoldingHeader();
}

async function createMoldingDraft() {
  if (
    moldingState.sheet ||
    !moldingState.permissions.has("ficha.criar")
  ) {
    throw new Error("Você não possui permissão para criar esta ficha.");
  }

  const { data: sheetId, error } = await window.supabaseClient
    .rpc("salvar_rascunho_ficha_tecnica_v2", {
      p_produto_id: moldingState.product.id,
      p_tipo: fichaConfig.tipo,
      p_ficha_id: null,
      p_motivo_revisao: null,
      p_data_emissao: null,
      p_valores: []
    });

  if (error) {
    if (/já existe um rascunho/i.test(error.message ?? "")) {
      const { data: existingDraft, error: draftError } =
        await window.supabaseClient
          .from("fichas_tecnicas")
          .select("id")
          .eq("produto_id", moldingState.product.id)
          .eq("tipo", fichaConfig.tipo)
          .eq("status", "RASCUNHO")
          .order("numero_revisao", { ascending: false })
          .order("criado_em", { ascending: false })
          .order("id", { ascending: false })
          .limit(1)
          .maybeSingle();

      if (draftError) {
        throw new Error(
          `O rascunho já existe, mas não pôde ser consultado: ${draftError.message}`
        );
      }
      if (!existingDraft) {
        throw new Error(
          "O rascunho já existe, mas a política de acesso do banco não permite visualizá-lo. Verifique a RLS de fichas_tecnicas para ficha.visualizar/ficha.editar_rascunho."
        );
      }

      const params = new URLSearchParams(window.location.search);
      params.set("produto", moldingState.product.id);
      params.set("codigo", moldingState.product.codigo);
      params.set("ficha", existingDraft.id);
      window.location.assign(
        `${window.location.pathname}?${params}`
      );
      return;
    }
    throw error;
  }

  const params = new URLSearchParams(window.location.search);
  params.set("produto", moldingState.product.id);
  params.set("ficha", sheetId);
  window.location.assign(`${window.location.pathname}?${params}`);
}

function enterMoldingEditMode() {
  moldingState.editRequested = true;
  applyMoldingReadOnly();
}

function clearMoldingParameterValues() {
  for (const card of moldingElements.parameters.querySelectorAll(
    ".molding-parameter"
  )) {
    card.dataset.notApplicable = "false";
    for (const control of card.querySelectorAll(
      "input, select, textarea"
    )) {
      control.value = "";
    }
  }
}

function applyMoldingBaseValues(values) {
  const valuesByParameter = new Map(
    values.map((value) => [
      String(value.parametro_id),
      value
    ])
  );
  clearMoldingParameterValues();

  for (const card of moldingElements.parameters.querySelectorAll(
    ".molding-parameter"
  )) {
    const value = valuesByParameter.get(card.dataset.parameterId);
    if (!value) {
      continue;
    }
    card.dataset.notApplicable = String(
      Boolean(value.nao_aplicavel)
    );
    for (const field of [
      "valor_texto",
      "valor_numerico",
      "valor_minimo",
      "valor_alvo",
      "valor_maximo",
      "valor_booleano",
      "valor_data",
      "valor_inicial",
      "valor_final",
      "observacao"
    ]) {
      const control = card.querySelector(`[name="${field}"]`);
      if (control && value[field] !== null &&
          value[field] !== undefined) {
        control.value = String(value[field]);
      }
    }
  }
}

async function loadSimilarMoldingSheets() {
  let query = window.supabaseClient
    .from("fichas_tecnicas")
    .select(`
      id,
      numero_revisao,
      status,
      vigente,
      data_emissao,
      produto_id,
      produtos!inner(id,codigo,nome,familia_id)
    `)
    .eq("tipo", fichaConfig.tipo)
    .neq("id", moldingState.sheet.id)
    .neq("status", "RASCUNHO")
    .neq("status", "OBSOLETA")
    .order("numero_revisao", { ascending: false })
    .limit(100);

  if (moldingState.product.familia_id) {
    query = query.eq(
      "produtos.familia_id",
      moldingState.product.familia_id
    );
  }

  const { data, error } = await query;
  if (error) {
    throw error;
  }

  moldingElements.baseSheetSelect.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Selecione uma ficha";
  moldingElements.baseSheetSelect.append(placeholder);

  for (const sheet of data ?? []) {
    const option = document.createElement("option");
    option.value = sheet.id;
    option.textContent = `${
      sheet.produtos?.codigo ?? sheet.produto_id
    } — ${sheet.produtos?.nome ?? "Produto"} — Revisão ${
      sheet.numero_revisao
    } (${window.LIDUTEC_FICHAS_UI.getStatusData(sheet).label})`;
    moldingElements.baseSheetSelect.append(option);
  }
}

async function useSelectedMoldingBase() {
  const sheetId = moldingElements.baseSheetSelect.value;
  if (!sheetId) {
    throw new Error("Selecione uma ficha para usar como base.");
  }
  const { data, error } = await window.supabaseClient
    .from("valores_parametros")
    .select(`
      parametro_id,
      valor_texto,
      valor_numerico,
      valor_minimo,
      valor_alvo,
      valor_maximo,
      valor_booleano,
      valor_data,
      observacao,
      valor_inicial,
      valor_final,
      nao_aplicavel
    `)
    .eq("ficha_tecnica_id", sheetId);
  if (error) {
    throw error;
  }
  applyMoldingBaseValues(data ?? []);
  enterMoldingEditMode();
}

async function initializeMolding() {
  if (window.LIDUTEC_FICHA_PREVIEW?.isEnabled()) {
    const preview =
      await window.LIDUTEC_FICHA_PREVIEW.load(
        fichaConfig.tipo
      );

    moldingState.product = preview.product;
    moldingState.sheet = preview.sheet;
    moldingState.parameters = preview.parameters;
    moldingState.history = preview.history;
    moldingState.approvals = preview.approvals;
    moldingState.permissions = new Set(["ficha.visualizar"]);

    moldingElements.userName.textContent = "Preview local";
    moldingElements.userProfile.textContent = "Somente leitura";
    moldingElements.userAvatar.textContent = "PL";
    document.querySelector("#preview-banner").hidden = false;
    moldingElements.logoutButton.hidden = true;

    updateMoldingHeader();
    renderizarFichaPorTipo(
      preview.groups,
      preview.parameters
    );
    applyMoldingReadOnly();

    moldingElements.loading.hidden = true;
    moldingElements.content.hidden = false;
    return;
  }

  const productId = getMoldingProductId();
  if (!productId) {
    window.location.replace("./lista.html");
    return;
  }

  const user =
    await window.LIDUTEC_APP.requireAuthenticatedUser();
  if (!user) {
    return;
  }

  const [profile, permissions, product, sheets] = await Promise.all([
    window.LIDUTEC_APP.getCurrentUserProfile(user.id),
    window.LIDUTEC_APP.getUserPermissions(user.id),
    loadMoldingProduct(productId),
    loadMoldingSheets(productId)
  ]);
  if (!profile || profile.status !== "ATIVO") {
    throw new Error("Seu usuário não está ativo.");
  }

  if (!permissions.has("ficha.visualizar")) {
    alert("Você não possui permissão para visualizar fichas técnicas.");
    window.location.replace(`./detalhes.html?id=${productId}`);
    return;
  }

  moldingState.user = user;
  moldingState.permissions = permissions;
  window.LIDUTEC_APP.applyPermissionVisibility(permissions);

  moldingElements.userName.textContent = profile.nome;
  moldingElements.userProfile.textContent =
    profile.perfil ?? "Usuário";
  moldingElements.userAvatar.textContent =
    getMoldingInitials(profile.nome);

  const explicitSheetId = getExplicitSheetId();
  let sheet = window.LIDUTEC_FICHAS_UI.selectPrimarySheet(
    sheets,
    fichaConfig.tipo,
    permissions,
    explicitSheetId
  );
  if (explicitSheetId && !sheet) {
    sheet = window.LIDUTEC_FICHAS_UI.selectPrimarySheet(
      sheets,
      fichaConfig.tipo,
      permissions
    );
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete("ficha");
    window.history.replaceState({}, "", cleanUrl);
  }
  moldingState.product = product;
  moldingState.sheet = sheet;
  moldingState.sheets = sheets;

  updateMoldingHeader();
  moldingElements.loading.hidden = true;
  moldingElements.content.hidden = false;

  const [
    { groups, parameters },
    { history, approvals }
  ] = await Promise.all([
    loadMoldingParameters(sheet?.id),
    loadSheetSupportData(sheet?.id)
  ]);
  moldingState.parameters = parameters;
  moldingState.history = history;
  moldingState.approvals = approvals;

  renderMoldingHistory();
  renderizarFichaPorTipo(groups, parameters);
  applyMoldingReadOnly();
}

moldingElements.menuButton?.addEventListener("click", () => {
  moldingElements.sidebar?.classList.toggle("open");
});

moldingElements.logoutButton?.addEventListener("click", async () => {
  await window.LIDUTEC_APP.signOut();
});

moldingElements.historyButton?.addEventListener("click", () => {
  moldingElements.historyPanel.hidden =
    !moldingElements.historyPanel.hidden;
});

moldingElements.printButton?.addEventListener("click", () => {
  window.print();
});

moldingElements.pdfButton?.addEventListener("click", async () => {
  const importData = window.LIDUTEC_FICHAS_UI.getImport(
    moldingState.sheet
  );
  if (!importData?.pdf_storage_path) {
    return;
  }
  const { data, error } = await window.supabaseClient.storage
    .from("fichas-tecnicas-pdf")
    .createSignedUrl(importData.pdf_storage_path, 300);
  if (error) {
    showMoldingMessage(
      `Não foi possível abrir o PDF: ${error.message}`,
      "error"
    );
    return;
  }
  window.open(data.signedUrl, "_blank", "noopener");
});

moldingElements.editButton?.addEventListener("click", async () => {
  try {
    await loadSimilarMoldingSheets();
    if (typeof moldingElements.editDialog.showModal === "function") {
      moldingElements.editDialog.showModal();
    } else {
      moldingElements.editDialog.setAttribute("open", "");
    }
  } catch (error) {
    showMoldingMessage(
      `Não foi possível preparar a edição: ${error.message}`,
      "error"
    );
  }
});

document.querySelector("#molding-edit-current")?.addEventListener(
  "click",
  () => {
    moldingElements.editDialog.close();
    enterMoldingEditMode();
  }
);

document.querySelector("#molding-edit-empty")?.addEventListener(
  "click",
  () => {
    if (!confirm(
      "Começar do zero limpará os valores na tela. O banco só será alterado quando você salvar. Continuar?"
    )) {
      return;
    }
    clearMoldingParameterValues();
    moldingElements.editDialog.close();
    enterMoldingEditMode();
  }
);

document.querySelector("#molding-edit-base")?.addEventListener(
  "click",
  async () => {
    try {
      await useSelectedMoldingBase();
      moldingElements.editDialog.close();
    } catch (error) {
      showMoldingMessage(error.message, "error");
    }
  }
);

document.querySelector("#molding-edit-cancel")?.addEventListener(
  "click",
  () => moldingElements.editDialog.close()
);

moldingElements.createButton?.addEventListener("click", async () => {
  moldingElements.createButton.disabled = true;
  try {
    await createMoldingDraft();
  } catch (error) {
    showMoldingMessage(
      `Não foi possível criar a ficha: ${error.message}`,
      "error"
    );
    moldingElements.createButton.disabled = false;
  }
});

moldingElements.newRevisionButton?.addEventListener(
  "click",
  async () => {
    moldingElements.newRevisionButton.disabled = true;
    try {
      const sheetId =
        await window.LIDUTEC_FICHAS_UI.createNewRevision(
          moldingState.sheet
        );
      if (sheetId) {
        const params = new URLSearchParams(window.location.search);
        params.set("produto", moldingState.product.id);
        params.set("ficha", sheetId);
        window.location.assign(
          `${window.location.pathname}?${params}`
        );
      }
    } catch (error) {
      showMoldingMessage(
        `Não foi possível criar a revisão: ${error.message}`,
        "error"
      );
    } finally {
      moldingElements.newRevisionButton.disabled = false;
    }
  }
);

async function runSheetApproval(action) {
  if (!moldingState.sheet?.id) {
    throw new Error("Ficha não encontrada.");
  }
  let rpc;
  let parameters;
  if (action === "ENVIAR") {
    if (moldingState.editable) {
      await saveMoldingDraft();
    }
    rpc = "enviar_ficha_aprovacao";
    parameters = { p_ficha_id: moldingState.sheet.id };
  } else {
    const observation = prompt(
      action === "REJEITADA"
        ? "Justificativa obrigatória da rejeição:"
        : "Observação da aprovação (opcional):",
      ""
    );
    if (observation === null) return;
    if (action === "REJEITADA" && !observation.trim()) {
      throw new Error("A justificativa da rejeição é obrigatória.");
    }
    rpc = "decidir_aprovacao_ficha";
    parameters = {
      p_ficha_id: moldingState.sheet.id,
      p_resultado: action,
      p_observacao: observation.trim() || null,
      p_tornar_vigente: action === "APROVADA"
    };
  }
  const { error } = await window.supabaseClient.rpc(rpc, parameters);
  if (error) throw error;
  const params = new URLSearchParams(window.location.search);
  params.set("produto", moldingState.product.id);
  params.set("ficha", moldingState.sheet.id);
  window.location.assign(`${window.location.pathname}?${params}`);
}

for (const [button, action] of [
  [moldingElements.submitApprovalButton, "ENVIAR"],
  [moldingElements.approveButton, "APROVADA"],
  [moldingElements.rejectButton, "REJEITADA"]
]) {
  button?.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await runSheetApproval(action);
    } catch (error) {
      showMoldingMessage(error.message, "error");
      button.disabled = false;
    }
  });
}

moldingElements.form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  moldingElements.message.hidden = true;
  moldingElements.saveButton.disabled = true;

  try {
    await saveMoldingDraft();
    showMoldingMessage("Rascunho salvo com sucesso.", "success");
  } catch (error) {
    console.error("Erro ao salvar ficha de Moldagem:", error);
    showMoldingMessage(
      `Não foi possível salvar o rascunho: ${error.message}`,
      "error"
    );
  } finally {
    moldingElements.saveButton.disabled = false;
  }
});

initializeMolding().catch((error) => {
  console.error("Erro ao carregar ficha de Moldagem:", error);
  moldingElements.loading.hidden = true;
  moldingElements.error.textContent =
    `Não foi possível carregar a ficha: ${error.message}`;
  moldingElements.error.hidden = false;
});
