(function initializeFichaPreviewModule() {
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);

  function isEnabled() {
    const params = new URLSearchParams(window.location.search);
    return params.get("preview") === "1" &&
      localHosts.has(window.location.hostname);
  }

  function splitRows(block) {
    const rows = [];
    let depth = 0;
    let quoted = false;
    let start = 0;

    for (let index = 0; index < block.length; index += 1) {
      const character = block[index];

      if (character === "'") {
        if (quoted && block[index + 1] === "'") {
          index += 1;
          continue;
        }
        quoted = !quoted;
      } else if (!quoted && character === "(") {
        if (depth === 0) {
          start = index + 1;
        }
        depth += 1;
      } else if (!quoted && character === ")") {
        depth -= 1;
        if (depth === 0) {
          rows.push(block.slice(start, index));
        }
      }
    }

    return rows;
  }

  function splitFields(row) {
    const fields = [];
    let quoted = false;
    let depth = 0;
    let start = 0;

    for (let index = 0; index <= row.length; index += 1) {
      const character = row[index];

      if (character === "'") {
        if (quoted && row[index + 1] === "'") {
          index += 1;
          continue;
        }
        quoted = !quoted;
      } else if (!quoted && "([{".includes(character)) {
        depth += 1;
      } else if (!quoted && ")]}".includes(character)) {
        depth -= 1;
      } else if (
        !quoted &&
        depth === 0 &&
        (character === "," || index === row.length)
      ) {
        fields.push(row.slice(start, index).trim());
        start = index + 1;
      }
    }

    return fields;
  }

  function parseSqlValue(rawValue) {
    if (rawValue === "null") {
      return null;
    }
    if (rawValue === "true") {
      return true;
    }
    if (rawValue === "false") {
      return false;
    }
    if (rawValue.startsWith("'") && rawValue.endsWith("'")) {
      return rawValue.slice(1, -1).replaceAll("''", "'");
    }

    const numericValue = Number(rawValue);
    return Number.isFinite(numericValue) ? numericValue : rawValue;
  }

  function extractRows(sql, startExpression, endExpression) {
    const match = sql.match(
      new RegExp(
        `${startExpression}([\\s\\S]*?)${endExpression}`,
        "i"
      )
    );

    if (!match) {
      throw new Error("Não foi possível localizar o seed na migration 003.");
    }

    return splitRows(match[1]).map((row) =>
      splitFields(row).map(parseSqlValue)
    );
  }

  function buildGroups(sql, type) {
    return extractRows(
      sql,
      "insert into seed_grupos values",
      ";\\s*insert into public\\.grupos_parametros"
    )
      .filter((row) => row[0] === type)
      .map((row, index) => ({
        id: index + 1,
        tipo_ficha: row[0],
        codigo: row[1],
        nome: row[2],
        ordem_exibicao: row[3],
        tipo_layout: row[4],
        descricao: row[5],
        ativo: true
      }));
  }

  function buildParameters(sql, type, groups) {
    const groupByCode = new Map(
      groups.map((group) => [group.codigo, group])
    );

    const intervalParameters = new Set([
      "MOLD_141_SOPRO_SP_3_FRENTE",
      "MOLD_142_SOPRO_SP_3_INFERIOR",
      "MOLD_143_SOPRO_SP_5_FRENTE",
      "MOLD_144_SOPRO_SP_5_INFERIOR",
      "MOLD_148_SOPRO_LATERAL"
    ]);

    return extractRows(
      sql,
      "insert into seed_parametros values",
      ";\\s*insert into public\\.parametros"
    )
      .filter((row) => row[0] === type)
      .map((row, index) => {
        const options = row[7]
          ? JSON.parse(row[7])
          : null;
        const visualInterval = intervalParameters.has(row[2]);

        return {
          id: index + 1,
          grupo_id: groupByCode.get(row[1])?.id,
          codigo: row[2],
          nome: row[3],
          unidade: row[4],
          tipo_dado: row[5],
          permite_faixa: row[6],
          lista_opcoes: options,
          ordem_exibicao: row[8],
          observacao: row[18],
          critico: row[19],
          configuracao_visual: visualInterval
            ? { intervalo_inicio_fim: true }
            : {},
          valores_parametros: [{
            valor_numerico: row[9],
            valor_minimo: row[10],
            valor_alvo: row[11],
            valor_maximo: row[12],
            valor_texto: row[13],
            valor_booleano: row[14],
            valor_inicial: row[15],
            valor_final: row[16],
            nao_aplicavel: row[17],
            observacao: row[18],
            valor_data: null
          }]
        };
      });
  }

  function getProduct() {
    return {
      id: 9,
      codigo: "MS0013",
      nome: "Tambor de Freio",
      codigo_cliente: "067HB20",
      codigo_ferramental: "MS0013-PLACA",
      peso_peca_kg: 6.82,
      cavidades_molde: 6,
      peso_cacho_kg: 67.55,
      rendimento_metalico_pct: 60.58,
      peca_seguranca: true,
      status: "ATIVO",
      clientes: { id: 1, nome: "Astemo" },
      familias_produto: null
    };
  }

  function getSheet(type) {
    const fusion = type === "FUSAO_VAZAMENTO";
    return {
      id: fusion ? 560 : 220,
      produto_id: 9,
      tipo: type,
      codigo_documento: fusion ? "FTFV-13" : "FTMO-0013",
      numero_revisao: fusion ? 56 : 22,
      status: "IMPORTADA",
      vigente: true,
      data_emissao: fusion ? "2026-07-10" : "2026-06-19",
      motivo_revisao: "Visualização local do documento importado.",
      elaborado_por_texto: fusion ? "Luiz Philippe" : null,
      aprovado_engenharia_por_texto: fusion
        ? "David Moreira"
        : null,
      aprovado_processo_por_texto: null,
      criado_em: fusion
        ? "2026-07-10T12:00:00Z"
        : "2026-06-19T12:00:00Z"
    };
  }

  function getHistory(type) {
    if (type === "MOLDAGEM") {
      return [{
        numero_revisao: 22,
        data_revisao: "2026-06-19",
        descricao: "Revisão atual importada; histórico anterior pendente de conferência."
      }];
    }

    return [
      {
        numero_revisao: 56,
        data_revisao: "2026-07-10",
        descricao: "Alterados Ceq e CE Líquido; faixas do forno e vazamento; Holding, panela de transferência e vazamento."
      },
      {
        numero_revisao: 55,
        data_revisao: "2026-06-19",
        descricao: "Alterado CE Líquido. Campo de observações alterado."
      },
      {
        numero_revisao: 54,
        data_revisao: "2026-05-13",
        descricao: "Alterado tempo de vazamento e pós-inoculação. Demais itens pendentes de conferência."
      }
    ];
  }

  async function load(type) {
    if (!isEnabled()) {
      throw new Error("Preview local não autorizado.");
    }

    const response = await fetch(
      "../../supabase/migrations/202607230003_fichas_ms0013_moldagem_fusao.sql",
      { cache: "no-store" }
    );

    if (!response.ok) {
      throw new Error("Não foi possível carregar a migration 003.");
    }

    const sql = await response.text();
    const groups = buildGroups(sql, type);

    return {
      product: getProduct(),
      sheet: getSheet(type),
      groups,
      parameters: buildParameters(sql, type, groups),
      history: getHistory(type),
      approvals: []
    };
  }

  window.LIDUTEC_FICHA_PREVIEW = {
    isEnabled,
    load,
    getProduct,
    getSheet
  };
})();
