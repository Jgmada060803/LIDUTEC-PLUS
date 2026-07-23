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
  issueDate: document.querySelector("#molding-issue-date"),
  reason: document.querySelector("#molding-reason")
};

const moldingState = {
  user: null,
  permissions: new Set(),
  product: null,
  sheet: null,
  parameters: [],
  history: [],
  approvals: [],
  editable: false
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
  const code = document.createElement("span");
  const name = document.createElement("strong");
  code.className = "molding-parameter-code";
  code.textContent = parameter.codigo ?? "—";
  name.textContent = parameter.nome ?? "Parâmetro";
  title.append(code, name);

  if (parameter.critico) {
    const critical = document.createElement("span");
    critical.className = "molding-critical-label";
    critical.textContent = "⚠ Crítico";
    title.append(critical);
  }

  const unit = document.createElement("span");
  unit.className = "molding-parameter-unit";
  unit.textContent = parameter.unidade ?? "Sem unidade";
  heading.append(title, unit);

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

  appendField(fields, "Observação do valor", createInput(
    "text",
    "observacao",
    getStoredValue(parameter, "observacao")
  ));

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
    section.classList.toggle(
      "layout-matriz",
      group.tipo_layout === "MATRIZ"
    );

    const header = document.createElement("div");
    header.className = "panel-header";
    const eyebrow = document.createElement("span");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = group.codigo ?? fichaConfig.nome;
    const title = document.createElement("h3");
    title.textContent = group.nome;
    header.append(eyebrow, title);
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
  const { data, error } = await window.supabaseClient
    .from("produtos")
    .select("*, clientes(nome)")
    .eq("id", productId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error("Produto não encontrado.");
  }

  return data;
}

async function loadMoldingSheet(productId) {
  const { data, error } = await window.supabaseClient
    .from("fichas_tecnicas")
    .select("*")
    .eq("produto_id", productId)
    .eq("tipo", fichaConfig.tipo)
    .order("numero_revisao", { ascending: false })
    .order("criado_em", { ascending: false })
    .order("id", { ascending: false });

  if (error) {
    throw error;
  }

  const sheets = [...(data ?? [])].sort(compareMoldingSheets);
  return (
    sheets.find((sheet) => sheet.status === "RASCUNHO") ??
    sheets.find((sheet) => sheet.status === "EM_APROVACAO") ??
    sheets.find((sheet) => sheet.vigente) ??
    null
  );
}

function getMoldingSheetPriority(sheet) {
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

function compareDescending(left, right) {
  return String(right ?? "").localeCompare(String(left ?? ""));
}

function compareSheetIdsDescending(left, right) {
  try {
    const leftId = BigInt(left ?? 0);
    const rightId = BigInt(right ?? 0);

    return rightId > leftId ? 1 : rightId < leftId ? -1 : 0;
  } catch {
    return compareDescending(left, right);
  }
}

function compareMoldingSheets(left, right) {
  return (
    getMoldingSheetPriority(left) -
      getMoldingSheetPriority(right) ||
    Number(right.numero_revisao ?? 0) -
      Number(left.numero_revisao ?? 0) ||
    compareDescending(left.criado_em, right.criado_em) ||
    compareSheetIdsDescending(left.id, right.id)
  );
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
  document.querySelector("#molding-subtitle").textContent =
    `${product.codigo} — ${product.nome}`;
  document.querySelector("#molding-product-name").textContent =
    product.nome;
  document.querySelector("#molding-product-code").textContent =
    `Código: ${product.codigo}`;
  document.querySelector("#back-to-product").href =
    `./detalhes.html?id=${product.id}`;
  document.querySelector("#molding-sheet-status").textContent =
    sheet?.status?.replaceAll("_", " ") ?? "Nova ficha";
  document.querySelector("#molding-sheet-revision").textContent =
    `Revisão ${sheet?.numero_revisao ?? 0}`;
  document.querySelector("#molding-document-code").textContent =
    sheet?.codigo_documento ?? "Documento ainda não emitido";

  moldingElements.issueDate.value =
    sheet?.data_emissao?.slice(0, 10) ?? getToday();
  moldingElements.reason.value = sheet?.motivo_revisao ?? "";

  const meta = document.querySelector("#sheet-product-meta");
  const items = [
    ["Cliente", product.clientes?.nome],
    ["Código do cliente", product.codigo_cliente],
    ["Ferramenta", product.codigo_ferramental],
    ["Peso da peça", product.peso_peca_kg != null ? `${product.peso_peca_kg} kg` : null],
    ["Peças por molde", product.cavidades_molde],
    ["Peso do cacho", product.peso_cacho_kg != null ? `${product.peso_cacho_kg} kg` : null],
    ["Rendimento", product.rendimento_metalico_pct != null ? `${product.rendimento_metalico_pct}%` : null],
    ["Segurança", product.peca_seguranca ? "Característica especial" : "Não"]
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

function applyMoldingReadOnly() {
  const isNewSheet = !moldingState.sheet;
  const isDraft =
    moldingState.sheet?.status === "RASCUNHO";
  const canCreate =
    moldingState.permissions.has("ficha.criar");
  const canEditDraft =
    moldingState.permissions.has("ficha.editar_rascunho");

  moldingState.editable =
    (isNewSheet && canCreate) ||
    (isDraft && canEditDraft);

  for (const control of moldingElements.form.querySelectorAll(
    "input, select, textarea"
  )) {
    control.disabled = !moldingState.editable;
  }

  moldingElements.saveButton.hidden = !moldingState.editable;

  if (!moldingState.editable) {
    showMoldingMessage(
      isNewSheet || isDraft
        ? "Você pode consultar esta ficha, mas não possui a permissão necessária para salvá-la."
        : "Esta ficha está disponível somente para leitura.",
      "error"
    );
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

  const profile =
    await window.LIDUTEC_APP.getCurrentUserProfile(user.id);
  if (!profile || profile.status !== "ATIVO") {
    throw new Error("Seu usuário não está ativo.");
  }

  const permissions =
    await window.LIDUTEC_APP.getUserPermissions(user.id);
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

  const [product, sheet] = await Promise.all([
    loadMoldingProduct(productId),
    loadMoldingSheet(productId)
  ]);
  moldingState.product = product;
  moldingState.sheet = sheet;

  const { groups, parameters } =
    await loadMoldingParameters(sheet?.id);
  const { history, approvals } =
    await loadSheetSupportData(sheet?.id);
  moldingState.parameters = parameters;
  moldingState.history = history;
  moldingState.approvals = approvals;

  updateMoldingHeader();
  renderizarFichaPorTipo(groups, parameters);
  applyMoldingReadOnly();

  moldingElements.loading.hidden = true;
  moldingElements.content.hidden = false;
}

moldingElements.menuButton?.addEventListener("click", () => {
  moldingElements.sidebar?.classList.toggle("open");
});

moldingElements.logoutButton?.addEventListener("click", async () => {
  await window.LIDUTEC_APP.signOut();
});

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
