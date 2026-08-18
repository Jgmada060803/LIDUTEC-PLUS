const importElements = {
  sidebar: document.querySelector("#sidebar"),
  menuButton: document.querySelector("#menu-button"),
  logoutButton: document.querySelector("#logout-button"),
  userName: document.querySelector("#user-name"),
  userProfile: document.querySelector("#user-profile"),
  userAvatar: document.querySelector("#user-avatar"),
  loading: document.querySelector("#import-loading"),
  error: document.querySelector("#import-error"),
  form: document.querySelector("#import-form"),
  product: document.querySelector("#import-product"),
  type: document.querySelector("#import-type"),
  template: document.querySelector("#import-template"),
  machoField: document.querySelector("#import-macho-field"),
  macho: document.querySelector("#import-macho"),
  documentCode: document.querySelector("#import-document-code"),
  revision: document.querySelector("#import-revision"),
  date: document.querySelector("#import-date"),
  file: document.querySelector("#import-file"),
  startExtraction: document.querySelector("#start-extraction"),
  state: document.querySelector("#import-state"),
  warnings: document.querySelector("#import-warnings"),
  historyPanel: document.querySelector("#import-history-panel"),
  history: document.querySelector("#import-history"),
  pdfEmpty: document.querySelector("#pdf-empty"),
  pdfPreview: document.querySelector("#pdf-preview"),
  fieldsEmpty: document.querySelector("#import-fields-empty"),
  fields: document.querySelector("#import-fields"),
  validationNote: document.querySelector("#validation-note"),
  makeCurrent: document.querySelector("#make-current"),
  save: document.querySelector("#save-import"),
  deleteDraft: document.querySelector("#delete-import-draft"),
  submit: document.querySelector("#submit-import"),
  reject: document.querySelector("#reject-import"),
  validate: document.querySelector("#validate-import"),
  message: document.querySelector("#import-message")
};

const importState = {
  user: null,
  permissions: new Set(),
  importRecord: null,
  sheet: null,
  extraction: null,
  pdfObjectUrl: null,
  uploadedPdf: null,
  changedFields: new Set(),
  extractionEventsLogged: false,
  busy: false
};

const templateByType = {
  MOLDAGEM: "moldagem_v1",
  FUSAO_VAZAMENTO: "fusao_vazamento_v1",
  MACHARIA: "macharia_v1"
};

function getInitials(name = "Usuário") {
  return name.trim().split(/\s+/).slice(0, 2)
    .map((part) => part[0]?.toUpperCase()).join("");
}

function getImportId() {
  return new URLSearchParams(window.location.search).get("importacao");
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

// Macharia é o único tipo com mais de uma ficha por produto (uma por
// macho) — esse campo só aparece quando o tipo escolhido é Macharia, e
// lista os machos já cadastrados (Ficha de Macho) pro produto selecionado.
async function syncMachoField() {
  if (!importElements.machoField) {
    return;
  }
  const isMacharia = importElements.type.value === "MACHARIA";
  importElements.machoField.hidden = !isMacharia;
  if (!isMacharia) {
    importElements.macho.innerHTML = '<option value="">Selecione</option>';
    return;
  }

  const productId = importElements.product.value;
  if (!productId) {
    importElements.macho.innerHTML =
      '<option value="">Selecione o produto primeiro</option>';
    return;
  }

  const { data, error } = await window.supabaseClient
    .from("machos_macharia_produtos")
    .select("macho_id, machos_macharia(id, caixa, macho, ativo)")
    .eq("produto_id", Number(productId));

  if (error) {
    console.error(error);
    importElements.macho.innerHTML =
      '<option value="">Erro ao carregar machos</option>';
    return;
  }

  const machos = (data ?? [])
    .map((item) => item.machos_macharia)
    .filter((macho) => macho && macho.ativo);

  importElements.macho.innerHTML = ['<option value="">Selecione</option>']
    .concat(machos.map((macho) =>
      `<option value="${macho.id}">Caixa ${escapeHtml(macho.caixa)} · Macho ${escapeHtml(macho.macho)}</option>`
    ))
    .join("");
}

function applyImportContextFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const productId = params.get("produto");
  const type = params.get("tipo");
  const template = params.get("template");

  if (
    productId &&
    [...importElements.product.options].some(
      (option) => option.value === productId
    )
  ) {
    importElements.product.value = productId;
  }
  if (
    type &&
    [...importElements.type.options].some(
      (option) => option.value === type
    )
  ) {
    importElements.type.value = type;
  }

  const selectedTemplate = template ?? templateByType[type];
  if (
    selectedTemplate &&
    [...importElements.template.options].some(
      (option) => option.value === selectedTemplate
    )
  ) {
    importElements.template.value = selectedTemplate;
  }
}

function showMessage(text, kind = "success") {
  importElements.message.textContent = text;
  importElements.message.className = `form-message ${kind}`;
  importElements.message.hidden = false;
}

function setBusy(busy) {
  importState.busy = busy;
  for (const button of [
    importElements.startExtraction,
    importElements.save,
    importElements.deleteDraft,
    importElements.submit,
    importElements.reject,
    importElements.validate
  ]) {
    button.disabled = busy;
  }
  if (!busy) {
    updateState();
  }
}

function normalizeNumber(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return null;
  }

  const number = Number(text.replace(",", "."));
  if (!Number.isFinite(number)) {
    throw new Error(`Valor numérico inválido: ${text}.`);
  }
  return number;
}

function setPdfPreview(url) {
  if (importState.pdfObjectUrl && importState.pdfObjectUrl !== url) {
    URL.revokeObjectURL(importState.pdfObjectUrl);
    importState.pdfObjectUrl = null;
  }

  importElements.pdfPreview.src = url;
  importElements.pdfPreview.hidden = false;
  importElements.pdfEmpty.hidden = true;
}

async function hashFile(file) {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function loadProducts() {
  const { data, error } = await window.supabaseClient
    .from("produtos")
    .select("id, codigo, nome, status")
    .order("codigo");

  if (error) {
    throw error;
  }

  importElements.product.innerHTML = (data ?? []).map((product) => `
    <option value="${product.id}">
      ${product.codigo} — ${product.nome}
    </option>
  `).join("");
}

async function loadReferenceData(productId, type, sheetId = null) {
  const [productResult, groupsResult] = await Promise.all([
    window.supabaseClient
      .from("produtos")
      .select("*")
      .eq("id", productId)
      .single(),
    window.supabaseClient
      .from("grupos_parametros")
      .select("*")
      .eq("tipo_ficha", type)
      .eq("ativo", true)
      .order("ordem_exibicao")
  ]);

  if (productResult.error) {
    throw productResult.error;
  }
  if (groupsResult.error) {
    throw groupsResult.error;
  }

  let referenceSheet = null;
  if (sheetId) {
    const result = await window.supabaseClient
      .from("fichas_tecnicas")
      .select("*")
      .eq("id", sheetId)
      .single();
    if (result.error) {
      throw result.error;
    }
    referenceSheet = result.data;
  } else {
    const result = await window.supabaseClient
      .from("fichas_tecnicas")
      .select("*")
      .eq("produto_id", productId)
      .eq("tipo", type)
      .in("status", ["IMPORTADA", "APROVADA", "VIGENTE"])
      .order("numero_revisao", { ascending: false })
      .order("criado_em", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (result.error) {
      throw result.error;
    }
    referenceSheet = result.data;
  }

  const groupIds = (groupsResult.data ?? []).map((group) => group.id);
  if (!groupIds.length) {
    return {
      produto: productResult.data,
      ficha: referenceSheet,
      grupos: [],
      parametros: []
    };
  }

  const parametersResult = await window.supabaseClient
    .from("parametros")
    .select("*")
    .in("grupo_id", groupIds)
    .eq("ativo", true)
    .order("ordem_exibicao");

  if (parametersResult.error) {
    throw parametersResult.error;
  }

  let values = [];
  if (referenceSheet?.id) {
    const valuesResult = await window.supabaseClient
      .from("valores_parametros")
      .select("*")
      .eq("ficha_tecnica_id", referenceSheet.id);
    if (valuesResult.error) {
      throw valuesResult.error;
    }
    values = valuesResult.data ?? [];
  }

  const valueByParameter = new Map(
    values.map((value) => [String(value.parametro_id), value])
  );

  return {
    produto: productResult.data,
    ficha: referenceSheet,
    grupos: groupsResult.data ?? [],
    parametros: (parametersResult.data ?? []).map((parameter) => ({
      ...parameter,
      valores_parametros: valueByParameter.has(String(parameter.id))
        ? [valueByParameter.get(String(parameter.id))]
        : []
    }))
  };
}

function createImportInput(name, value, type = "text") {
  const input = document.createElement("input");
  input.name = name;
  input.type = type;
  input.value = value ?? "";
  if (
    type === "text" &&
    !["valor_texto", "observacao"].includes(name)
  ) {
    input.inputMode = "decimal";
  }
  return input;
}

function appendValueField(container, label, input) {
  const wrapper = document.createElement("label");
  const title = document.createElement("span");
  title.textContent = label;
  wrapper.append(title, input);
  container.append(wrapper);
}

function renderExtraction(extraction) {
  importElements.fields.replaceChildren();
  importElements.fieldsEmpty.hidden = true;

  const parametersByGroup = new Map();
  for (const parameter of extraction.parametros) {
    const key = String(parameter.grupo_id);
    if (!parametersByGroup.has(key)) {
      parametersByGroup.set(key, []);
    }
    parametersByGroup.get(key).push(parameter);
  }

  for (const group of extraction.grupos) {
    const parameters = parametersByGroup.get(String(group.id)) ?? [];
    if (!parameters.length) {
      continue;
    }

    const section = document.createElement("section");
    section.className = "import-parameter-group";
    const title = document.createElement("h4");
    title.textContent = group.nome;
    section.append(title);

    for (const parameter of parameters) {
      const row = document.createElement("article");
      row.className = "import-parameter-row";
      row.dataset.parameterId = parameter.parametro_id;
      row.dataset.confidence = String(parameter.confianca);
      row.dataset.lowConfidence = String(parameter.confianca < 0.75);

      const identity = document.createElement("div");
      identity.className = "import-parameter-identity";
      const name = document.createElement("strong");
      name.textContent = parameter.nome;
      const meta = document.createElement("span");
      meta.textContent = [
        parameter.unidade,
        `confiança ${Math.round(parameter.confianca * 100)}%`
      ].filter(Boolean).join(" · ");
      identity.append(name, meta);

      const values = document.createElement("div");
      values.className = "import-parameter-values";

      if (parameter.tipo_dado === "NUMERO") {
        appendValueField(values, "Valor", createImportInput(
          "valor_numerico", parameter.valor_numerico
        ));
        if (parameter.permite_faixa) {
          appendValueField(values, "Mínimo", createImportInput(
            "valor_minimo", parameter.valor_minimo
          ));
          appendValueField(values, "Alvo", createImportInput(
            "valor_alvo", parameter.valor_alvo
          ));
          appendValueField(values, "Máximo", createImportInput(
            "valor_maximo", parameter.valor_maximo
          ));
        }
      } else if (parameter.tipo_dado === "BOOLEANO") {
        const select = document.createElement("select");
        select.name = "valor_booleano";
        select.innerHTML = `
          <option value="">—</option>
          <option value="true">Sim</option>
          <option value="false">Não</option>
        `;
        select.value = parameter.valor_booleano == null
          ? ""
          : String(parameter.valor_booleano);
        appendValueField(values, "Valor", select);
      } else {
        appendValueField(values, "Valor", createImportInput(
          "valor_texto", parameter.valor_texto
        ));
      }

      appendValueField(values, "Observação", createImportInput(
        "observacao", parameter.observacao
      ));

      const illegible = document.createElement("label");
      illegible.className = "import-illegible";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.name = "nao_legivel";
      checkbox.checked = parameter.nao_legivel;
      const checkboxText = document.createElement("span");
      checkboxText.textContent = "Não legível";
      illegible.append(checkbox, checkboxText);

      const notApplicable = document.createElement("label");
      notApplicable.className = "import-illegible";
      const naCheckbox = document.createElement("input");
      naCheckbox.type = "checkbox";
      naCheckbox.name = "nao_aplicavel";
      naCheckbox.checked = parameter.nao_aplicavel;
      const naText = document.createElement("span");
      naText.textContent = "Não aplicável";
      notApplicable.append(naCheckbox, naText);

      const flags = document.createElement("div");
      flags.className = "import-parameter-flags";
      flags.append(illegible, notApplicable);

      row.append(identity, values, flags);
      section.append(row);
    }

    importElements.fields.append(section);
  }

  importElements.warnings.textContent = extraction.avisos.join(" ");
  importElements.warnings.hidden = !extraction.avisos.length;
  renderHistory(extraction.historicoRevisoes ?? []);
}

function createHistoryInput(name, value, type = "text") {
  const input = document.createElement("input");
  input.name = name;
  input.type = type;
  input.value = value ?? "";
  return input;
}

function renderHistory(history) {
  importElements.history.replaceChildren();
  importElements.historyPanel.hidden = false;

  const header = document.createElement("div");
  header.className = "import-history-row import-history-header";
  for (const label of ["Revisão", "Data", "Descrição", "Responsável", ""]) {
    const cell = document.createElement("span");
    cell.textContent = label;
    header.append(cell);
  }
  importElements.history.append(header);

  for (const revision of history) {
    appendHistoryRow(revision);
  }

  const add = document.createElement("button");
  add.type = "button";
  add.className = "button button-secondary import-history-add";
  add.textContent = "Adicionar revisão";
  add.addEventListener("click", () => appendHistoryRow({}));
  importElements.history.append(add);
}

function appendHistoryRow(revision) {
  const row = document.createElement("div");
  row.className = "import-history-row";
  row.append(
    createHistoryInput(
      "numero_revisao",
      revision.numero_revisao,
      "number"
    ),
    createHistoryInput("data_revisao", revision.data_revisao, "date"),
    createHistoryInput("descricao", revision.descricao),
    createHistoryInput("responsavel", revision.responsavel)
  );
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "button button-secondary import-history-remove";
  remove.textContent = "Remover";
  remove.addEventListener("click", () => row.remove());
  row.append(remove);

  const addButton = importElements.history.querySelector(
    ".import-history-add"
  );
  importElements.history.insertBefore(row, addButton);
}

function collectHistory() {
  return [...importElements.history.querySelectorAll(
    ".import-history-row:not(.import-history-header)"
  )].map((row) => ({
    numero_revisao: Number(
      row.querySelector('[name="numero_revisao"]').value
    ),
    data_revisao:
      row.querySelector('[name="data_revisao"]').value || null,
    descricao:
      row.querySelector('[name="descricao"]').value.trim() || null,
    responsavel:
      row.querySelector('[name="responsavel"]').value.trim() || null
  })).filter((revision) => Number.isInteger(revision.numero_revisao));
}

function collectValues() {
  return [...document.querySelectorAll(".import-parameter-row")].map(
    (row) => {
      const getValue = (name) =>
        row.querySelector(`[name="${name}"]`)?.value ?? "";
      const notReadable =
        row.querySelector('[name="nao_legivel"]')?.checked ?? false;
      const notApplicable =
        row.querySelector('[name="nao_aplicavel"]')?.checked ?? false;
      const withoutValue = notReadable || notApplicable;
      const observation = getValue("observacao").trim();

      return {
        parametro_id: Number(row.dataset.parameterId),
        valor_texto: withoutValue ? null : getValue("valor_texto") || null,
        valor_numerico: withoutValue
          ? null
          : normalizeNumber(getValue("valor_numerico")),
        valor_minimo: withoutValue
          ? null
          : normalizeNumber(getValue("valor_minimo")),
        valor_alvo: withoutValue
          ? null
          : normalizeNumber(getValue("valor_alvo")),
        valor_maximo: withoutValue
          ? null
          : normalizeNumber(getValue("valor_maximo")),
        valor_booleano: withoutValue || !getValue("valor_booleano")
          ? null
          : getValue("valor_booleano") === "true",
        valor_data: null,
        valor_inicial: null,
        valor_final: null,
        nao_aplicavel: notApplicable,
        observacao: [
          observation,
          notReadable ? "Campo não legível no PDF original." : null
        ].filter(Boolean).join(" ") || null,
        nao_legivel: notReadable
      };
    }
  );
}

async function uploadPdfIfNeeded() {
  const file = importElements.file.files?.[0];
  if (!file) {
    return importState.uploadedPdf;
  }

  if (file.type !== "application/pdf") {
    throw new Error("O documento original deve ser um PDF.");
  }

  const hash = await hashFile(file);
  if (importState.uploadedPdf?.hash === hash) {
    return importState.uploadedPdf;
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${importState.user.id}/${crypto.randomUUID()}-${safeName}`;
  const { error } = await window.supabaseClient.storage
    .from("fichas-tecnicas-pdf")
    .upload(path, file, {
      contentType: "application/pdf",
      upsert: false
    });

  if (error) {
    throw error;
  }

  importState.uploadedPdf = {
    path,
    name: file.name,
    mimeType: file.type,
    size: file.size,
    hash
  };
  return importState.uploadedPdf;
}

async function saveImport() {
  if (!importState.extraction) {
    throw new Error("Reconheça os campos do PDF antes de salvar.");
  }

  if (
    importElements.type.value === "MACHARIA" &&
    !importState.sheet?.id &&
    !importElements.macho?.value
  ) {
    throw new Error("Selecione o macho para esta ficha de Macharia.");
  }

  const pdf = await uploadPdfIfNeeded();
  const values = collectValues();
  const changedFields = [...importState.changedFields];
  const extractionResult = {
    modo: importState.extraction.modo,
    confiancaGeral: importState.extraction.confiancaGeral,
    requerConferenciaHumana: true,
    campos: values.map((value) => ({
      parametro_id: value.parametro_id,
      nao_legivel: value.nao_legivel
    }))
  };

  const { data, error } = await window.supabaseClient.rpc(
    "salvar_importacao_ficha",
    {
      p_produto_id: Number(importElements.product.value),
      p_tipo: importElements.type.value,
      p_codigo_documento: importElements.documentCode.value.trim(),
      p_numero_revisao: Number(importElements.revision.value),
      p_data_emissao: importElements.date.value,
      p_template_codigo: importElements.template.value,
      p_versao_extrator:
        window.LIDUTEC_PDF_EXTRACTOR.version,
      p_valores: values,
      p_resultado_extracao: extractionResult,
      p_campos_alterados: changedFields,
      p_avisos: importState.extraction.avisos,
      p_campos_nao_reconhecidos:
        importState.extraction.camposNaoReconhecidos,
      p_pdf_storage_path: pdf?.path ?? null,
      p_pdf_nome_original: pdf?.name ?? null,
      p_pdf_mime_type: pdf?.mimeType ?? null,
      p_pdf_tamanho_bytes: pdf?.size ?? null,
      p_pdf_hash_sha256: pdf?.hash ?? null,
      p_ficha_id: importState.sheet?.id ?? null,
      p_macho_id: importElements.macho?.value
        ? Number(importElements.macho.value)
        : null
    }
  );

  if (error) {
    throw error;
  }

  const saved = Array.isArray(data) ? data[0] : data;
  const historyResult = await window.supabaseClient.rpc(
    "salvar_historico_importacao_ficha",
    {
      p_importacao_id: saved.importacao_id,
      p_historico: collectHistory()
    }
  );
  if (historyResult.error) {
    throw historyResult.error;
  }
  importState.sheet = {
    ...(importState.sheet ?? {}),
    id: saved.ficha_id
  };
  importState.importRecord = {
    ...(importState.importRecord ?? {}),
    id: saved.importacao_id,
    estado: "IMPORTACAO_RASCUNHO"
  };
  updateState();

  for (const event of [
    ...(!importState.extractionEventsLogged && pdf
      ? ["PDF_ENVIADO"]
      : []),
    ...(!importState.extractionEventsLogged
      ? ["EXTRACAO_INICIADA", "EXTRACAO_CONCLUIDA"]
      : []),
    ...(changedFields.length ? ["CAMPO_CORRIGIDO"] : [])
  ]) {
    const result = await window.supabaseClient.rpc(
      "registrar_evento_importacao",
      {
        p_importacao_id: saved.importacao_id,
        p_evento: event,
        p_detalhes: {
          campos_alterados: changedFields,
          versao_extrator:
            window.LIDUTEC_PDF_EXTRACTOR.version
        }
      }
    );
    if (result.error) {
      throw result.error;
    }
  }

  importState.extractionEventsLogged = true;
  return saved;
}

async function startExtraction() {
  const file = importElements.file.files?.[0];
  if (!file) {
    throw new Error("Selecione o PDF original.");
  }

  const reference = await loadReferenceData(
    Number(importElements.product.value),
    importElements.type.value,
    importState.sheet?.id ?? null
  );

  importState.extraction =
    await window.LIDUTEC_PDF_EXTRACTOR.extrairFichaPdf({
      arquivo: file,
      tipoFicha: importElements.type.value,
      versaoTemplate: importElements.template.value,
      dadosReferencia: reference
    });

  if (!importState.sheet) {
    const header = importState.extraction.cabecalho ?? {};
    importElements.documentCode.value =
      header.codigo_documento ??
      reference.ficha?.codigo_documento ??
      "";
    importElements.revision.value =
      header.numero_revisao ??
      reference.ficha?.numero_revisao ??
      "";
    importElements.date.value =
      header.data_emissao ??
      reference.ficha?.data_emissao ??
      "";
  }

  renderExtraction(importState.extraction);
}

function updateState() {
  const state = importState.importRecord?.estado ?? "NOVA";
  const labels = {
    NOVA: "Nova importação",
    IMPORTACAO_RASCUNHO: "Importação em conferência",
    IMPORTACAO_PENDENTE_VALIDACAO: "Pendente de validação",
    IMPORTADA: "Importada",
    REJEITADA: "Importação rejeitada"
  };
  importElements.state.textContent = labels[state] ?? state;

  const editable = ["NOVA", "IMPORTACAO_RASCUNHO", "REJEITADA"]
    .includes(state);
  const pending = state === "IMPORTACAO_PENDENTE_VALIDACAO";
  const canEdit = editable && (
    importState.permissions.has("ficha.importar") ||
    importState.permissions.has("ficha.conferir_importacao")
  );
  const canSubmit = canEdit &&
    importState.permissions.has("ficha.conferir_importacao");
  const canValidate = pending &&
    importState.permissions.has("ficha.validar_importacao");
  const canDelete = Boolean(importState.importRecord?.id) &&
    ["IMPORTACAO_RASCUNHO", "REJEITADA"].includes(state) &&
    importState.sheet?.elaborado_por === importState.user?.id &&
    importState.permissions.has("ficha.excluir_rascunho");

  importElements.save.hidden = !canEdit;
  importElements.deleteDraft.hidden = !canDelete;
  importElements.submit.hidden =
    !importState.importRecord?.id || !canSubmit;
  importElements.validate.hidden = !canValidate;
  importElements.reject.hidden = !canValidate;
  importElements.startExtraction.disabled = !canEdit;
  importElements.save.disabled = !canEdit;
  importElements.deleteDraft.disabled = !canDelete;
  importElements.submit.disabled = !canSubmit;
  importElements.validate.disabled = !canValidate;
  importElements.reject.disabled = !canValidate;

  for (const control of importElements.form.querySelectorAll(
    "input, select, textarea"
  )) {
    if (
      control === importElements.validationNote ||
      control === importElements.makeCurrent
    ) {
      control.disabled = !canValidate;
    } else {
      control.disabled = !canEdit;
    }
  }
}

async function loadExistingImport(importId) {
  const { data, error } = await window.supabaseClient
    .from("importacoes_ficha")
    .select(`
      *,
      fichas_tecnicas (
        *,
        produtos (id, codigo, nome)
      )
    `)
    .eq("id", importId)
    .single();

  if (error) {
    throw error;
  }

  importState.importRecord = data;
  importState.sheet = data.fichas_tecnicas;
  importState.uploadedPdf = data.pdf_storage_path
    ? {
        path: data.pdf_storage_path,
        name: data.pdf_nome_original,
        mimeType: data.pdf_mime_type,
        size: data.pdf_tamanho_bytes,
        hash: data.pdf_hash_sha256
      }
    : null;

  importElements.product.value = String(data.fichas_tecnicas.produto_id);
  importElements.type.value = data.fichas_tecnicas.tipo;
  importElements.template.value = data.template_codigo;
  importElements.documentCode.value =
    data.fichas_tecnicas.codigo_documento ?? "";
  importElements.revision.value =
    data.fichas_tecnicas.numero_revisao;
  importElements.date.value = data.fichas_tecnicas.data_emissao ?? "";

  const [reference, historyResult] = await Promise.all([
    loadReferenceData(
      data.fichas_tecnicas.produto_id,
      data.fichas_tecnicas.tipo,
      data.fichas_tecnicas.id
    ),
    window.supabaseClient
      .from("historico_fichas")
      .select("numero_revisao, data_revisao, descricao, responsavel")
      .eq("ficha_tecnica_id", data.fichas_tecnicas.id)
      .order("numero_revisao")
  ]);
  if (historyResult.error) {
    throw historyResult.error;
  }
  importState.extraction = {
    modo: "ASSISTIDO_MANUAL",
    confiancaGeral:
      data.resultado_extracao?.confiancaGeral ?? 0.8,
    grupos: reference.grupos,
    parametros: reference.parametros.map((parameter) => {
      const stored = parameter.valores_parametros?.[0] ?? {};
      return {
        ...parameter,
        parametro_id: parameter.id,
        valor_texto: stored.valor_texto,
        valor_numerico: stored.valor_numerico,
        valor_minimo: stored.valor_minimo,
        valor_alvo: stored.valor_alvo,
        valor_maximo: stored.valor_maximo,
        valor_booleano: stored.valor_booleano,
        observacao: stored.observacao,
        nao_legivel: stored.observacao?.includes("não legível") ?? false,
        nao_aplicavel: Boolean(stored.nao_aplicavel),
        confianca: 1
      };
    }),
    avisos: data.avisos ?? [],
    camposNaoReconhecidos: data.campos_nao_reconhecidos ?? [],
    historicoRevisoes: historyResult.data ?? []
  };
  renderExtraction(importState.extraction);

  if (data.pdf_storage_path) {
    const signed = await window.supabaseClient.storage
      .from("fichas-tecnicas-pdf")
      .createSignedUrl(data.pdf_storage_path, 300);
    if (!signed.error) {
      setPdfPreview(signed.data.signedUrl);
    }
  }
}

async function validateImport(result) {
  const { error } = await window.supabaseClient.rpc(
    "validar_importacao_ficha",
    {
      p_importacao_id: importState.importRecord.id,
      p_resultado: result,
      p_observacao: importElements.validationNote.value.trim() || null,
      p_tornar_vigente: importElements.makeCurrent.checked
    }
  );
  if (error) {
    throw error;
  }

  importState.importRecord.estado =
    result === "VALIDADA" ? "IMPORTADA" : "REJEITADA";
  updateState();
}

async function initializeImportPage() {
  const user = await window.LIDUTEC_APP.requireAuthenticatedUser();
  if (!user) {
    return;
  }

  const [profile, permissions] = await Promise.all([
    window.LIDUTEC_APP.getCurrentUserProfile(user.id),
    window.LIDUTEC_APP.getUserPermissions(user.id)
  ]);

  if (!profile || profile.status !== "ATIVO") {
    throw new Error("Usuário inativo.");
  }

  const allowed = [
    "ficha.importar",
    "ficha.conferir_importacao",
    "ficha.validar_importacao"
  ].some((permission) => permissions.has(permission));
  if (!allowed) {
    throw new Error("Usuário sem permissão para importar fichas.");
  }

  importState.user = user;
  importState.permissions = permissions;
  importElements.userName.textContent = profile.nome;
  importElements.userProfile.textContent = profile.perfil ?? "Usuário";
  importElements.userAvatar.textContent = getInitials(profile.nome);
  window.LIDUTEC_APP.applyPermissionVisibility(permissions);

  await loadProducts();
  const importId = getImportId();
  if (importId) {
    await loadExistingImport(importId);
  } else {
    applyImportContextFromUrl();
  }
  await syncMachoField();
  if (importState.sheet?.macho_id) {
    importElements.macho.value = String(importState.sheet.macho_id);
  }

  updateState();
  importElements.loading.hidden = true;
  importElements.form.hidden = false;
}

importElements.menuButton?.addEventListener("click", () => {
  importElements.sidebar?.classList.toggle("open");
});

importElements.logoutButton?.addEventListener("click", async () => {
  await window.LIDUTEC_APP.signOut();
});

importElements.type?.addEventListener("change", () => {
  importElements.template.value =
    templateByType[importElements.type.value] ?? "";
  syncMachoField().catch(console.error);
});
importElements.product?.addEventListener("change", () => {
  syncMachoField().catch(console.error);
});

importElements.file?.addEventListener("change", () => {
  const file = importElements.file.files?.[0];
  if (!file) {
    return;
  }
  importState.pdfObjectUrl = URL.createObjectURL(file);
  setPdfPreview(importState.pdfObjectUrl);
});

importElements.fields?.addEventListener("input", (event) => {
  const row = event.target.closest(".import-parameter-row");
  if (row) {
    importState.changedFields.add(
      `${row.dataset.parameterId}.${event.target.name}`
    );
    row.classList.add("manually-changed");
  }
});

importElements.startExtraction?.addEventListener("click", async () => {
  try {
    setBusy(true);
    await startExtraction();
    showMessage("Extração assistida preparada. Confira todos os campos.");
  } catch (error) {
    showMessage(error.message, "error");
  } finally {
    setBusy(false);
  }
});

importElements.save?.addEventListener("click", async () => {
  try {
    setBusy(true);
    await saveImport();
    showMessage("Rascunho da importação salvo.");
  } catch (error) {
    showMessage(error.message, "error");
  } finally {
    setBusy(false);
  }
});

importElements.deleteDraft?.addEventListener("click", async () => {
  const confirmed = window.confirm(
    "Excluir definitivamente este rascunho de importação? Esta ação não pode ser desfeita."
  );
  if (!confirmed) return;

  try {
    setBusy(true);
    const pdfPath = importState.importRecord?.pdf_storage_path;
    const { error } = await window.supabaseClient.rpc(
      "excluir_rascunho_ficha",
      { p_ficha_id: importState.sheet.id }
    );
    if (error) throw error;

    if (pdfPath) {
      const { error: storageError } =
        await window.supabaseClient.storage
          .from("fichas-tecnicas-pdf")
          .remove([pdfPath]);
      if (storageError) {
        console.warn(
          "O rascunho foi excluído, mas o PDF não pôde ser removido:",
          storageError
        );
      }
    }

    window.location.assign("./lista.html");
  } catch (error) {
    showMessage(
      `Não foi possível excluir o rascunho: ${error.message}`,
      "error"
    );
    setBusy(false);
  }
});

importElements.submit?.addEventListener("click", async () => {
  try {
    setBusy(true);
    await saveImport();
    const { error } = await window.supabaseClient.rpc(
      "enviar_importacao_validacao",
      { p_importacao_id: importState.importRecord.id }
    );
    if (error) {
      throw error;
    }
    importState.importRecord.estado =
      "IMPORTACAO_PENDENTE_VALIDACAO";
    updateState();
    showMessage("Importação enviada para validação administrativa.");
  } catch (error) {
    showMessage(error.message, "error");
  } finally {
    setBusy(false);
  }
});

importElements.validate?.addEventListener("click", async () => {
  try {
    setBusy(true);
    await validateImport("VALIDADA");
    showMessage("Importação validada administrativamente.");
  } catch (error) {
    showMessage(error.message, "error");
  } finally {
    setBusy(false);
  }
});

importElements.reject?.addEventListener("click", async () => {
  try {
    setBusy(true);
    await validateImport("REJEITADA");
    showMessage("Importação rejeitada e devolvida para conferência.");
  } catch (error) {
    showMessage(error.message, "error");
  } finally {
    setBusy(false);
  }
});

initializeImportPage().catch((error) => {
  console.error("Erro ao iniciar importação:", error);
  importElements.loading.hidden = true;
  importElements.error.hidden = false;
  importElements.error.querySelector("span").textContent = error.message;
});
