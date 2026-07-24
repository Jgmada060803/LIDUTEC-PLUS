(function configureSheetUi() {
  const types = Object.freeze([
    {
      codigo: "MOLDAGEM",
      nome: "Moldagem",
      template: "moldagem_v1",
      page: "moldagem.html"
    },
    {
      codigo: "FUSAO_VAZAMENTO",
      nome: "Fusão/Vazamento",
      template: "fusao_vazamento_v1",
      page: "fusao-vazamento.html"
    },
    {
      codigo: "MACHARIA",
      nome: "Macharia",
      template: "macharia_v1",
      page: null
    },
    {
      codigo: "ACABAMENTO",
      nome: "Acabamento",
      template: "acabamento_v1",
      page: null
    },
    {
      codigo: "LABORATORIO",
      nome: "Laboratório",
      template: "laboratorio_v1",
      page: null
    },
    {
      codigo: "QUALIDADE",
      nome: "Qualidade",
      template: null,
      page: null
    }
  ]);

  const status = Object.freeze({
    RASCUNHO: { label: "Rascunho", className: "desenvolvimento" },
    EM_APROVACAO: {
      label: "Em aprovação",
      className: "desenvolvimento"
    },
    EM_APROVACAO_ENGENHARIA: {
      label: "Em aprovação — Engenharia",
      className: "desenvolvimento"
    },
    EM_APROVACAO_PRODUCAO: {
      label: "Em aprovação — Produção",
      className: "desenvolvimento"
    },
    APROVADA: { label: "Aprovada", className: "ativo" },
    VIGENTE: { label: "Vigente", className: "ativo" },
    IMPORTADA: { label: "Importada", className: "importada" },
    HISTORICA: { label: "Importada", className: "importada" },
    IMPORTACAO_RASCUNHO: {
      label: "Importação pendente",
      className: "desenvolvimento"
    },
    IMPORTACAO_PENDENTE_VALIDACAO: {
      label: "Importação pendente",
      className: "desenvolvimento"
    },
    REJEITADA: { label: "Rejeitada", className: "inativo" },
    REPROVADA: { label: "Reprovada", className: "inativo" },
    OBSOLETA: { label: "Obsoleta", className: "obsoleto" }
  });

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatDate(value) {
    if (!value) {
      return "—";
    }
    const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? `${value}T00:00:00Z`
      : value;
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: "UTC"
    }).format(new Date(normalized));
  }

  function getType(code) {
    return types.find((type) => type.codigo === code) ?? {
      codigo: code,
      nome: code,
      template: null,
      page: null
    };
  }

  function getImport(sheet) {
    return Array.isArray(sheet?.importacoes_ficha)
      ? sheet.importacoes_ficha[0] ?? null
      : sheet?.importacoes_ficha ?? null;
  }

  function getEffectiveStatus(sheet) {
    const importData = getImport(sheet);
    return importData && importData.estado !== "IMPORTADA"
      ? importData.estado
      : sheet?.status;
  }

  function isImportValidated(sheet) {
    const importData = getImport(sheet);
    if (importData) {
      return importData.estado === "IMPORTADA";
    }

    return (
      ["IMPORTADA", "HISTORICA"].includes(sheet?.status) &&
      Boolean(sheet?.vigente)
    );
  }

  function isReleased(sheet) {
    return Boolean(sheet?.vigente) && (
      sheet?.status === "APROVADA" ||
      (
        ["IMPORTADA", "HISTORICA"].includes(sheet?.status) &&
        isImportValidated(sheet)
      )
    );
  }

  function getStatusData(sheetOrStatus) {
    const code = typeof sheetOrStatus === "object"
      ? getEffectiveStatus(sheetOrStatus)
      : sheetOrStatus;
    return status[code] ?? {
      label: code ?? "Não cadastrada",
      className: "inativo"
    };
  }

  function statusBadge(sheetOrStatus) {
    const data = getStatusData(sheetOrStatus);
    return `<span class="status-badge ${data.className}">${
      escapeHtml(data.label)
    }</span>`;
  }

  function priority(sheet) {
    const effectiveStatus = getEffectiveStatus(sheet);
    if (isReleased(sheet)) {
      return 1;
    }
    if (
      sheet?.vigente &&
      ["IMPORTADA", "HISTORICA"].includes(sheet?.status)
    ) {
      return 2;
    }
    if (sheet?.status === "APROVADA") {
      return 3;
    }
    if (
      ["IMPORTADA", "HISTORICA"].includes(sheet?.status) &&
      isImportValidated(sheet)
    ) {
      return 4;
    }
    if (
      effectiveStatus === "EM_APROVACAO" ||
      effectiveStatus === "EM_APROVACAO_ENGENHARIA" ||
      effectiveStatus === "EM_APROVACAO_PRODUCAO"
    ) {
      return 5;
    }
    if (effectiveStatus === "RASCUNHO") {
      return 6;
    }
    return 7;
  }

  function compareIds(left, right) {
    try {
      const leftId = BigInt(left ?? 0);
      const rightId = BigInt(right ?? 0);
      return rightId > leftId ? 1 : rightId < leftId ? -1 : 0;
    } catch {
      return String(right ?? "").localeCompare(String(left ?? ""));
    }
  }

  function compareSheets(left, right) {
    return (
      priority(left) - priority(right) ||
      Number(right.numero_revisao ?? 0) -
        Number(left.numero_revisao ?? 0) ||
      String(right.data_emissao ?? "").localeCompare(
        String(left.data_emissao ?? "")
      ) ||
      String(right.criado_em ?? "").localeCompare(
        String(left.criado_em ?? "")
      ) ||
      compareIds(left.id, right.id)
    );
  }

  function selectActiveSheet(sheets, type) {
    return [...(sheets ?? [])]
      .filter((sheet) => sheet.tipo === type)
      .sort(compareSheets)[0] ?? null;
  }

  function canSeeSheet(sheet, permissions) {
    const effectiveStatus = getEffectiveStatus(sheet);
    if (effectiveStatus === "RASCUNHO") {
      return (
        permissions.has("ficha.visualizar") ||
        permissions.has("ficha.visualizar_rascunho") ||
        permissions.has("ficha.editar_rascunho")
      );
    }
    const importData = getImport(sheet);
    if (importData && importData.estado !== "IMPORTADA") {
      return [
        "ficha.importar",
        "ficha.conferir_importacao",
        "ficha.validar_importacao"
      ].some((permission) => permissions.has(permission));
    }
    return permissions.has("ficha.visualizar");
  }

  function selectPrimarySheet(
    sheets,
    type,
    permissions,
    explicitSheetId = null
  ) {
    const typedSheets = [...(sheets ?? [])].filter(
      (sheet) => sheet.tipo === type
    );

    if (explicitSheetId !== null && explicitSheetId !== "") {
      const explicit = typedSheets.find(
        (sheet) => String(sheet.id) === String(explicitSheetId)
      );
      return explicit && canSeeSheet(explicit, permissions)
        ? explicit
        : null;
    }

    return typedSheets
      .filter((sheet) => sheet.status !== "OBSOLETA")
      .filter((sheet) => canSeeSheet(sheet, permissions))
      .sort(compareSheets)[0] ?? null;
  }

  function sheetUrl(sheet, preview = false) {
    const type = getType(sheet.tipo);
    if (!type.page) {
      return null;
    }
    return `./${type.page}?produto=${encodeURIComponent(
      sheet.produto_id
    )}${preview ? "&preview=1" : ""}`;
  }

  function importUrl(productId, type, importId = null) {
    if (importId) {
      return `./importar-ficha.html?importacao=${encodeURIComponent(
        importId
      )}`;
    }
    const config = getType(type);
    const params = new URLSearchParams({
      produto: productId,
      tipo: type
    });
    if (config.template) {
      params.set("template", config.template);
    }
    return `./importar-ficha.html?${params.toString()}`;
  }

  async function createNewRevision(sheet) {
    const currentRevision = Number(sheet.numero_revisao);
    const revisionInput = prompt(
      "Número da nova revisão:",
      String(currentRevision + 1)
    );
    if (revisionInput === null) {
      return null;
    }

    const newRevision = Number(revisionInput);
    if (!Number.isInteger(newRevision) || newRevision <= currentRevision) {
      throw new Error(
        "Informe uma revisão inteira maior que a revisão atual."
      );
    }

    const reason = prompt("Motivo da nova revisão:");
    if (!reason?.trim()) {
      return null;
    }

    const { data, error } = await window.supabaseClient.rpc(
      "criar_nova_revisao_ficha",
      {
        p_ficha_origem_id: Number(sheet.id),
        p_numero_revisao: newRevision,
        p_motivo_revisao: reason.trim(),
        p_data_emissao: new Date().toISOString().slice(0, 10)
      }
    );
    if (error) {
      throw error;
    }
    return data;
  }

  window.LIDUTEC_FICHAS_UI = Object.freeze({
    types,
    escapeHtml,
    formatDate,
    getType,
    getImport,
    getEffectiveStatus,
    isImportValidated,
    isReleased,
    getStatusData,
    statusBadge,
    compareSheets,
    selectActiveSheet,
    selectPrimarySheet,
    sheetUrl,
    importUrl,
    canSeeSheet,
    createNewRevision
  });
})();
