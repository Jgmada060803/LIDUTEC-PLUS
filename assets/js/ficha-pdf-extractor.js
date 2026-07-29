(function configurePdfExtractor() {
  const EXTRACTOR_VERSION = "pdf-texto-3";
  const ROW_TOLERANCE = 3.5;
  const NUMBER_PATTERN = /[-+]?\d+(?:[.,]\d+)?/g;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeText(value) {
    return String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[–—]/g, "-")
      .replace(/[^A-Za-z0-9%+\-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toUpperCase();
  }

  function meaningfulTokens(value) {
    const ignored = new Set([
      "A", "AS", "COM", "DA", "DAS", "DE", "DO", "DOS", "E", "EM",
      "NA", "NAS", "NO", "NOS", "O", "OS", "PARA", "POR"
    ]);
    return normalizeText(value).split(" ").filter(
      (token) => token.length > 1 && !ignored.has(token)
    );
  }

  function similarity(left, right) {
    const expected = meaningfulTokens(left);
    const actual = new Set(meaningfulTokens(right));
    if (!expected.length) {
      return 0;
    }
    return expected.filter((token) => actual.has(token)).length /
      expected.length;
  }

  function normalizeReferenceParameter(parameter) {
    const stored = parameter.valores_parametros?.[0] ?? {};

    return {
      parametro_id: parameter.id,
      codigo: parameter.codigo,
      nome: parameter.nome,
      unidade: parameter.unidade,
      tipo_dado: parameter.tipo_dado,
      permite_faixa: Boolean(parameter.permite_faixa),
      grupo_id: parameter.grupo_id,
      valor_texto: stored.valor_texto ?? null,
      valor_numerico: stored.valor_numerico ?? null,
      valor_minimo: stored.valor_minimo ?? null,
      valor_alvo: stored.valor_alvo ?? null,
      valor_maximo: stored.valor_maximo ?? null,
      valor_booleano: stored.valor_booleano ?? null,
      valor_data: stored.valor_data ?? null,
      valor_inicial: stored.valor_inicial ?? null,
      valor_final: stored.valor_final ?? null,
      nao_aplicavel: Boolean(stored.nao_aplicavel),
      observacao: stored.observacao ?? null,
      nao_legivel: false,
      confianca: stored.id ? 0.35 : 0,
      origem_extracao: stored.id ? "CADASTRO_REFERENCIA" : null,
      referencia_documento:
        parameter.configuracao_visual?.referencia_documento ?? null
    };
  }

  function buildRows(items, pageNumber) {
    const rows = [];
    const positioned = items
      .filter((item) => item.str?.trim())
      .map((item) => ({
        text: item.str.trim(),
        x: item.transform[4],
        y: item.transform[5],
        width: item.width ?? 0
      }))
      .sort((left, right) => right.y - left.y || left.x - right.x);

    for (const item of positioned) {
      let row = rows.find((candidate) =>
        Math.abs(candidate.y - item.y) <= ROW_TOLERANCE
      );
      if (!row) {
        row = { page: pageNumber, y: item.y, items: [] };
        rows.push(row);
      }
      row.items.push(item);
    }

    return rows.map((row) => {
      row.items.sort((left, right) => left.x - right.x);
      row.text = row.items.map((item) => item.text).join(" ")
        .replace(/\s+/g, " ").trim();
      row.normalized = normalizeText(row.text);
      return row;
    });
  }

  async function extractDocument(arquivo) {
    if (!window.pdfjsLib) {
      throw new Error(
        "O leitor PDF não foi carregado. Verifique a conexão e tente novamente."
      );
    }

    const bytes = new Uint8Array(await arquivo.arrayBuffer());
    const document = await window.pdfjsLib.getDocument({ data: bytes }).promise;
    const pages = [];

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent({
        normalizeWhitespace: true,
        disableCombineTextItems: false
      });
      const rows = buildRows(content.items, pageNumber);
      pages.push({
        page: pageNumber,
        rows,
        text: rows.map((row) => row.text).join("\n")
      });
    }

    return {
      pages,
      rows: pages.flatMap((page) => page.rows),
      text: pages.map((page) => page.text).join("\n")
    };
  }

  function findGroupRanges(documentRows, groups) {
    const anchors = groups.map((group) => {
      let best = null;
      for (let index = 0; index < documentRows.length; index += 1) {
        const score = similarity(group.nome, documentRows[index].text);
        if (score >= 0.65 && (!best || score > best.score)) {
          best = { index, score };
        }
      }
      return best ? { groupId: String(group.id), ...best } : null;
    }).filter(Boolean).sort((left, right) => left.index - right.index);

    const ranges = new Map();
    anchors.forEach((anchor, index) => {
      ranges.set(anchor.groupId, {
        start: anchor.index,
        end: anchors[index + 1]?.index ?? documentRows.length
      });
    });
    return ranges;
  }

  function codedParameterNumber(parameter) {
    const match = String(parameter.codigo ?? "").match(/MOLD_(\d{3})_/);
    return match ? Number(match[1]) : null;
  }

  function findParameterRow(parameter, rows, range, knownCodes = new Set()) {
    const candidates = rows.slice(range?.start ?? 0, range?.end ?? rows.length);
    const code = codedParameterNumber(parameter);
    let best = null;

    for (const row of candidates) {
      const codeMatch = code != null &&
        new RegExp(`(^|\\s)0*${code}(?=\\s|[-–—])`).test(row.normalized);
      const nameScore = similarity(parameter.nome, row.text);
      const score = codeMatch ? Math.max(0.94, nameScore) : nameScore;
      const threshold = code != null ? 0.72 : 0.68;
      if (score >= threshold && (!best || score > best.score)) {
        let matchedRow = row;
        if (code != null) {
          const codeIndex = row.items.findIndex((item) =>
            Number(normalizeText(item.text)) === code
          );
          if (codeIndex >= 0) {
            let nextCodeIndex = row.items.findIndex((item, index) =>
              index > codeIndex &&
              /^\d{2,3}$/.test(normalizeText(item.text)) &&
              knownCodes.has(Number(normalizeText(item.text)))
            );
            if (nextCodeIndex < 0) {
              nextCodeIndex = row.items.length;
            }
            const items = row.items.slice(codeIndex, nextCodeIndex);
            matchedRow = {
              ...row,
              items,
              text: items.map((item) => item.text).join(" ")
                .replace(/\s+/g, " ").trim()
            };
            matchedRow.normalized = normalizeText(matchedRow.text);
          }
        }
        best = { row: matchedRow, score, code };
      }
    }
    return best;
  }

  function parseNumbers(text, code = null) {
    const values = [...String(text).matchAll(NUMBER_PATTERN)]
      .map((match) => Number(match[0].replace(",", ".")))
      .filter(Number.isFinite);
    if (code != null && values.length && Number(values[0]) === code) {
      values.shift();
    }
    return values;
  }

  function valueTextFromRow(match, parameter) {
    const nameTokens = new Set(meaningfulTokens(parameter.nome));
    const valueItems = match.row.items.filter((item, index) => {
      const normalized = normalizeText(item.text);
      const numericOnly = /^[-+]?\d+(?:[.,]\d+)?(?:\s*[%°A-Z/²]+)?$/
        .test(normalized);
      if (numericOnly) {
        const number = Number((normalized.match(NUMBER_PATTERN) ?? [])[0]
          ?.replace(",", "."));
        return !(index === 0 && match.code != null && number === match.code);
      }
      return !meaningfulTokens(item.text).some((token) =>
        nameTokens.has(token)
      );
    });
    return valueItems.map((item) => item.text).join(" ").trim();
  }

  function applyExtractedValue(parameter, match) {
    if (!match) {
      return parameter;
    }

    const extracted = { ...parameter };
    const rawValue = valueTextFromRow(match, parameter);
    const numbers = parseNumbers(rawValue || match.row.text, match.code);
    const normalizedValue = normalizeText(rawValue);
    extracted.referencia_documento = {
      pagina: match.row.page,
      texto_encontrado: match.row.text
    };
    extracted.origem_extracao = "PDF_TEXTO";

    if (parameter.tipo_dado === "NUMERO") {
      if (!numbers.length) {
        return parameter;
      }
      if (parameter.permite_faixa && numbers.length >= 2) {
        if (numbers.length >= 3) {
          [
            extracted.valor_numerico,
            extracted.valor_minimo,
            extracted.valor_maximo
          ] = numbers.slice(-3);
          extracted.valor_alvo = null;
        } else {
          [extracted.valor_minimo, extracted.valor_maximo] = numbers.slice(-2);
          extracted.valor_alvo = null;
          extracted.valor_numerico = null;
        }
      } else {
        extracted.valor_numerico = numbers.at(-1);
      }
    } else if (parameter.tipo_dado === "BOOLEANO") {
      if (/\b(SIM|ATIVO|LIGADO|VERDADEIRO|X)\b/.test(normalizedValue)) {
        extracted.valor_booleano = true;
      } else if (
        /\b(NAO|INATIVO|DESLIGADO|FALSO)\b/.test(normalizedValue)
      ) {
        extracted.valor_booleano = false;
      } else {
        return parameter;
      }
    } else {
      const cleaned = rawValue.trim();
      if (!cleaned) {
        return parameter;
      }
      extracted.valor_texto = cleaned;
      extracted.nao_aplicavel =
        normalizeText(cleaned).includes("NAO APLICAVEL");
    }

    extracted.confianca = Math.min(0.98, match.score);
    return extracted;
  }

  function nearestItem(row, x, maximumDistance = 35) {
    const candidates = row?.items
      .map((item) => ({ item, distance: Math.abs(item.x - x) }))
      .sort((left, right) => left.distance - right.distance);
    return candidates?.[0]?.distance <= maximumDistance
      ? candidates[0].item
      : null;
  }

  function findRowByPatterns(rows, patterns, start = 0) {
    const expressions = patterns.map((pattern) =>
      pattern instanceof RegExp ? pattern : new RegExp(pattern, "i")
    );
    return rows.slice(start).find((row) =>
      expressions.every((pattern) =>
        pattern.test(row.text) ||
        row.items.some((item) => {
          const itemPattern = new RegExp(pattern.source, pattern.flags);
          return itemPattern.test(item.text);
        })
      )
    ) ?? null;
  }

  function extractLabeledRawValue(rows, patterns, options = {}) {
    const row = rows.find((candidate) =>
      patterns.every((pattern) => pattern.test(candidate.text)) &&
      candidate.items.some((item) =>
        item.x >= (options.minAnchorX ?? 0) &&
        item.x < (options.maxX ?? Number.POSITIVE_INFINITY) &&
        patterns.some((pattern) => {
          const itemPattern = new RegExp(pattern.source, pattern.flags);
          return itemPattern.test(item.text);
        })
      )
    );
    if (!row) {
      return null;
    }
    const anchor = row.items.find((item) =>
      item.x >= (options.minAnchorX ?? 0) &&
      patterns.some((pattern) => {
        const expression = pattern instanceof RegExp
          ? new RegExp(pattern.source, pattern.flags)
          : new RegExp(pattern, "i");
        return expression.test(item.text);
      })
    );
    if (!anchor) {
      return null;
    }
    const nextLabel = row.items.find((item) =>
      item.x > anchor.x && item.text.includes(":") &&
      !/^[-+]?\d/.test(item.text)
    );
    const values = row.items.filter((item) =>
      item.x > anchor.x + Math.max(anchor.width ?? 0, 2) &&
      (!nextLabel || item.x < nextLabel.x) &&
      item.x < (options.maxX ?? Number.POSITIVE_INFINITY)
    );
    const raw = values.map((item) => item.text).join(" ")
      .replace(/\s+/g, " ").trim();
    return raw ? { raw, row } : null;
  }

  function applyRawValue(parameter, raw, row, confidence = 0.9) {
    const extracted = { ...parameter };
    const normalized = normalizeText(raw);
    const numbers = parseNumbers(raw);
    extracted.referencia_documento = {
      pagina: row.page,
      texto_encontrado: row.text
    };
    extracted.origem_extracao = "PDF_TEXTO";

    if (parameter.tipo_dado === "NUMERO") {
      if (!numbers.length) {
        return parameter;
      }
      if (parameter.permite_faixa && numbers.length >= 2) {
        if (numbers.length >= 3) {
          [
            extracted.valor_numerico,
            extracted.valor_minimo,
            extracted.valor_maximo
          ] = numbers.slice(-3);
        } else {
          [extracted.valor_minimo, extracted.valor_maximo] = numbers.slice(-2);
          extracted.valor_numerico = null;
        }
        extracted.valor_alvo = null;
      } else {
        extracted.valor_numerico = numbers.at(-1);
      }
    } else if (parameter.tipo_dado === "BOOLEANO") {
      if (/\b(SIM|ATIVO|LIGADO|X)\b/.test(normalized)) {
        extracted.valor_booleano = true;
      } else if (/\b(NAO|INATIVO|DESLIGADO)\b/.test(normalized)) {
        extracted.valor_booleano = false;
      } else {
        return parameter;
      }
    } else {
      extracted.valor_texto = raw.trim();
      extracted.nao_aplicavel = /\b(NA|N A|NAO APLICAVEL)\b/.test(normalized);
    }
    extracted.confianca = confidence;
    return extracted;
  }

  function extractChemicalMatrix(parameter, rows) {
    const code = String(parameter.codigo ?? "");
    const isFurnace = code.startsWith("FV_FORNO_");
    const isPouring = code.startsWith("FV_VAZ_");
    if (!isFurnace && !isPouring) {
      return null;
    }

    const suffix = code.replace(isFurnace ? "FV_FORNO_" : "FV_VAZ_", "");
    const labels = {
      C: /\bC(?:\*+)?$/i,
      SI: /\bSI$/i,
      MN: /\bMN$/i,
      P: /\bP$/i,
      S: /\bS$/i,
      MG: /\bMG$/i,
      CR: /\bCR$/i,
      AL: /\bAL$/i,
      CU: /\bCU$/i,
      SN: /\bSN$/i,
      TI: /\bTI$/i,
      PB: /\bPB$/i,
      CEQ: /\bCEQ(?:\*+)?$/i,
      CE_LIQUIDO: /CE LIQUIDO/i,
      MO: /\bMO$/i
    };
    const labelPattern = labels[suffix];
    if (!labelPattern) {
      return null;
    }

    const sectionIndex = rows.findIndex((row) =>
      isFurnace
        ? row.normalized.includes("COMPOSICAO QUIMICA") &&
          row.normalized.includes("FORNO")
        : row.normalized.includes("COMPOSICAO QUIMICA") &&
          row.normalized.includes("VAZAMENTO")
    );
    if (sectionIndex < 0) {
      return null;
    }
    const header = rows.slice(sectionIndex + 1, sectionIndex + 4).find((row) =>
      row.items.some((item) => labelPattern.test(normalizeText(item.text)))
    );
    if (!header) {
      return null;
    }
    const labelItem = header.items.find((item) =>
      labelPattern.test(normalizeText(item.text))
    );
    const localRows = rows.filter((row) =>
      row.page === header.page &&
      row.y < header.y &&
      header.y - row.y < 32
    );
    const maximumRow = localRows.find((row) => /^MAXIMO\b/i.test(row.normalized));
    const minimumRow = localRows.find((row) => /^MINIMO\b/i.test(row.normalized));
    const maximumText = nearestItem(maximumRow, labelItem.x)?.text ?? "";
    const minimumText = nearestItem(minimumRow, labelItem.x)?.text ?? "";
    const maximum = parseNumbers(maximumText)[0] ?? null;
    const minimum = parseNumbers(minimumText)[0] ?? null;
    const notApplicable = [minimumText, maximumText].some((value) =>
      /\bNA\b/i.test(normalizeText(value))
    );

    if (maximum == null && minimum == null && !notApplicable) {
      return null;
    }
    const extracted = { ...parameter };
    extracted.valor_minimo = minimum;
    extracted.valor_maximo = maximum;
    extracted.valor_alvo = null;
    extracted.valor_numerico = null;
    if (parameter.tipo_dado !== "NUMERO") {
      extracted.valor_texto = notApplicable
        ? "Não aplicável"
        : [minimumText, maximumText].filter(Boolean).join(" a ");
    }
    extracted.nao_aplicavel = notApplicable;
    extracted.confianca = 0.97;
    extracted.origem_extracao = "PDF_TEXTO";
    extracted.referencia_documento = {
      pagina: header.page,
      texto_encontrado: [
        header.text,
        maximumRow?.text,
        minimumRow?.text
      ].filter(Boolean).join(" | ")
    };
    return extracted;
  }

  function extractTemperature(parameter, rows) {
    const temperatureTitle = rows.findIndex((row) =>
      /\bTEMPERATURAS:/i.test(row.text)
    );
    if (temperatureTitle < 0) {
      return null;
    }
    const localRows = rows.slice(temperatureTitle, temperatureTitle + 18);
    const panRows = localRows.filter((row) =>
      /LIBERA[CÇ][AÃ]O PANELA DE/i.test(row.text) &&
      row.items.some((item) => item.x > 400)
    );
    const anchors = {
      FV_TEMP_HOLDING: localRows.find((row) => /FORNO HOLDING/i.test(row.text)),
      FV_TEMP_TRANSFERENCIA: panRows[0],
      FV_TEMP_VAZAMENTO: panRows[1],
      FV_TEMP_LIBERACAO_MOLDE: localRows.find((row) =>
        /LIBERA[CÇ][AÃ]O DE VAZAMENTO/i.test(row.text)
      )
    };
    const anchor = anchors[parameter.codigo];
    if (!anchor) {
      return null;
    }
    const candidates = rows.filter((row) =>
      row.page === anchor.page &&
      Math.abs(row.y - anchor.y) <= 20
    ).flatMap((row) => row.items.map((item) => ({ row, item })))
      .filter(({ item }) => item.x >= 475 && parseNumbers(item.text).length >= 2)
      .filter(({ item }) => item.x <= 590)
      .sort((left, right) =>
        Math.abs(left.row.y - anchor.y) - Math.abs(right.row.y - anchor.y)
      );
    const candidate = candidates[0];
    return candidate
      ? applyRawValue(parameter, candidate.item.text, candidate.row, 0.95)
      : null;
  }

  function extractFusionParameter(parameter, rows) {
    const chemical = extractChemicalMatrix(parameter, rows);
    if (chemical) {
      return chemical;
    }
    const temperature = extractTemperature(parameter, rows);
    if (temperature) {
      return temperature;
    }

    if (parameter.codigo === "FV_POS_INOCULACAO") {
      const row = rows.find((candidate) =>
        candidate.normalized.includes("POS INOCULACAO") &&
        candidate.normalized.includes("%")
      );
      const raw = row?.items.filter((item) =>
        item.x >= 170 && item.x < 235
      ).map((item) => item.text).join(" ").trim();
      return raw ? applyRawValue(parameter, raw, row, 0.94) : null;
    }

    if (parameter.codigo === "FV_TIPO_INOCULACAO") {
      const title = rows.findIndex((row) =>
        /\bINOCULA[CÇ][AÃ]O:/i.test(row.text)
      );
      const candidates = title < 0 ? [] : rows.slice(title + 1, title + 10);
      const row = candidates.find((candidate) =>
        candidate.items.some((item) =>
          item.x >= 230 && item.x <= 275 &&
          /^\d+(?:[.,]\d+)?$/.test(item.text)
        )
      );
      const value = row?.items.find((item) =>
        item.x >= 230 && item.x <= 275 &&
        /^\d+(?:[.,]\d+)?$/.test(item.text)
      );
      return value
        ? applyRawValue(parameter, value.text, row, 0.9)
        : null;
    }

    if (parameter.codigo === "FV_ANALISE_PENDENTE") {
      const title = rows.find((row) =>
        row.normalized.includes("ANALISE TERMICA")
      );
      const values = title
        ? rows.filter((row) =>
          row.page === title.page &&
          row.y < title.y &&
          title.y - row.y < 75
        ).flatMap((row) => row.items.filter((item) => item.x >= 585)
          .map((item) => item.text))
        : [];
      const raw = values.join(" ").replace(/\s+/g, " ").trim();
      return raw ? applyRawValue(parameter, raw, title, 0.78) : null;
    }

    const labels = {
      FV_TIPO_MATERIAL: { patterns: [/TIPO DE MATERIAL/i], maxX: 420 },
      FV_NORMA_CLIENTE: { patterns: [/NORMA DO CLIENTE/i], maxX: 350 },
      FV_NORMA_EQUIVALENTE: { patterns: [/NORMA EQUIVALENTE/i], maxX: 350 },
      FV_PERLITA: { patterns: [/PERLITA/i], minAnchorX: 320, maxX: 530 },
      FV_FERRITA: { patterns: [/FERRITA/i], minAnchorX: 320, maxX: 530 },
      FV_CARBONETOS: {
        patterns: [/CARBONETOS/i], minAnchorX: 320, maxX: 530
      },
      FV_GRAFITA_TIPO: {
        patterns: [/^TIPO:$/i], minAnchorX: 350, maxX: 530
      },
      FV_GRAFITA_TAMANHO: {
        patterns: [/^TAMANHO:$/i], minAnchorX: 350, maxX: 530
      },
      FV_RESISTENCIA_TRACAO: {
        patterns: [/RESIST[ÊE]NCIA/i], minAnchorX: 520, maxX: 810
      },
      FV_DUREZA: { patterns: [/DUREZA/i], minAnchorX: 520, maxX: 810 },
      FV_LIMITE_ESCOAMENTO: {
        patterns: [/ESCOAMENTO/i], minAnchorX: 520, maxX: 810
      },
      FV_ALONGAMENTO: {
        patterns: [/ALONGAMENTO/i], minAnchorX: 520, maxX: 810
      },
      FV_PRE_INOCULACAO: {
        patterns: [/PR[ÉE]\.? INOCULA[CÇ][AÃ]O/i], maxX: 235
      },
      FV_GRAU_1: { patterns: [/GRAU 1/i], maxX: 235 },
      FV_GRAU_2: { patterns: [/GRAU 2/i], maxX: 235 },
      FV_PESO_METAL: {
        patterns: [/PESO METAL/i], minAnchorX: 270, maxX: 430
      },
      FV_PESO_LIGA: {
        patterns: [/PESO DE LIGA/i], minAnchorX: 270, maxX: 430
      },
      FV_PERCENTUAL: {
        patterns: [/PERCENTUAL/i], minAnchorX: 270, maxX: 430
      },
      FV_COBERTURA: {
        patterns: [/COBERTURA/i], minAnchorX: 270, maxX: 430
      },
      FV_FADING: {
        patterns: [/FADING/i], minAnchorX: 270, maxX: 430
      }
    };
    const selected = labels[parameter.codigo];
    if (!selected) {
      return null;
    }
    const candidate = extractLabeledRawValue(
      rows,
      selected.patterns,
      selected
    );
    if (candidate && parameter.codigo === "FV_PESO_METAL") {
      const firstTwo = parseNumbers(candidate.raw).slice(0, 2);
      candidate.raw = firstTwo.join(" a ");
    }
    return candidate
      ? applyRawValue(parameter, candidate.raw, candidate.row)
      : null;
  }

  function parseDate(value) {
    const match = String(value).match(
      /\b(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})\b/
    );
    if (!match) {
      return null;
    }
    const year = match[3].length === 2 ? `20${match[3]}` : match[3];
    return `${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  }

  function extractHeader(text, fileName) {
    const combined = `${fileName}\n${text}`;
    const documentCode = combined.match(/\b(FT(?:MO|FV))[-\s]*0*(\d+)\b/i);
    const revision = combined.match(
      /\b(?:REVIS[AÃ]O|REV\.?|RV\.?)\s*[:.-]?\s*(\d+)\b/i
    );
    const dateCandidates = [...text.matchAll(
      /\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b/g
    )];

    return {
      codigo_documento: documentCode
        ? `${documentCode[1].toUpperCase()}-${documentCode[2].padStart(4, "0")}`
        : null,
      numero_revisao: revision ? Number(revision[1]) : null,
      data_emissao: dateCandidates.length
        ? parseDate(dateCandidates[0][0])
        : null
    };
  }

  function extractHistory(rows) {
    const result = [];
    const pages = new Map();
    for (const row of rows) {
      if (!pages.has(row.page)) {
        pages.set(row.page, []);
      }
      pages.get(row.page).push(row);
    }

    for (const pageRows of pages.values()) {
      let start = pageRows.findIndex((row) =>
        similarity("HISTÓRICO DAS REVISÕES", row.text) >= 0.7 ||
        (
          /REVIS[AÃ]O\s*N/i.test(row.text) &&
          /DATA:/i.test(row.text) &&
          /DESCRI[CÇ][AÃ]O/i.test(row.text)
        )
      );
      if (start < 0) {
        start = pageRows.findIndex((row) =>
          /^\s*(?:REVIS[AÃ]O\s+)?\d{1,3}\s+\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b/i
            .test(row.text)
        );
        if (start >= 0) {
          start -= 1;
        }
      }
      if (start < 0) {
        continue;
      }
      const endOffset = pageRows.slice(start + 1).findIndex((row) =>
        similarity("APROVAÇÕES", row.text) >= 0.75 ||
        /\bELABORA[CÇ][AÃ]O\b/i.test(row.text) ||
        (
          /REVIS[AÃ]O\s*N/i.test(row.text) &&
          /\bPOSTO:/i.test(row.text)
        )
      );
      const end = endOffset < 0
        ? pageRows.length
        : start + 1 + endOffset;
      let current = null;

      for (const row of pageRows.slice(start + 1, end)) {
        const date = parseDate(row.text);
        const revision = row.text.match(
          /(?:^|\b)(?:REV(?:IS[AÃ]O)?\.?\s*)?(\d{1,3})(?=\s|[-–—])/i
        );
        if (date && revision) {
          const description = row.text
            .replace(revision[0], " ")
            .replace(/\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b/, " ")
            .replace(/\s+/g, " ")
            .trim();
          current = {
            numero_revisao: Number(revision[1]),
            data_revisao: date,
            descricao: description || null,
            responsavel: null,
            pagina: row.page,
            confianca: description ? 0.82 : 0.7
          };
          const responsible = current.descricao?.match(
            /(?:^|\s)([\p{Lu}][\p{L}]+(?:\s+[\p{Lu}][\p{L}]+){1,2})$/u
          );
          if (responsible) {
            current.responsavel = responsible[1];
            current.descricao = current.descricao
              .slice(0, responsible.index).trim() || null;
          }
          if (!result.some((existing) =>
            existing.numero_revisao === current.numero_revisao
          )) {
            result.push(current);
          } else {
            current = null;
          }
        } else if (
          current &&
          row.text.length > 8 &&
          !/REVIS[AÃ]O\s*N|DATA:|DESCRI[CÇ][AÃ]O/i.test(row.text)
        ) {
          current.descricao = [current.descricao, row.text]
            .filter(Boolean).join(" ");
        }
      }
    }
    return result.sort((left, right) =>
      left.numero_revisao - right.numero_revisao
    );
  }

  async function extrairFichaPdf({
    arquivo,
    tipoFicha,
    versaoTemplate,
    dadosReferencia = null
  }) {
    if (!(arquivo instanceof File) || arquivo.type !== "application/pdf") {
      throw new Error("Selecione um arquivo PDF válido.");
    }

    const templates = window.LIDUTEC_IMPORT_TEMPLATES ?? {};
    const template = templates[versaoTemplate];
    if (!template || template.tipoFicha !== tipoFicha) {
      throw new Error("Template incompatível com o tipo da ficha.");
    }

    const reference = dadosReferencia ?? {};
    const document = await extractDocument(arquivo);
    if (normalizeText(document.text).length < 40) {
      throw new Error(
        "O PDF não contém texto suficiente. Este arquivo precisará de OCR."
      );
    }

    const baseParameters = (reference.parametros ?? []).map(
      normalizeReferenceParameter
    );
    const knownCodes = new Set(
      baseParameters.map(codedParameterNumber).filter((code) => code != null)
    );
    const ranges = findGroupRanges(document.rows, reference.grupos ?? []);
    const parameters = baseParameters.map((parameter) => {
      if (tipoFicha === "FUSAO_VAZAMENTO") {
        return extractFusionParameter(parameter, document.rows) ?? parameter;
      }
      const code = codedParameterNumber(parameter);
      const range = code == null
        ? ranges.get(String(parameter.grupo_id))
        : null;
      const match = findParameterRow(
        parameter,
        document.rows,
        range,
        knownCodes
      );
      return applyExtractedValue(parameter, match);
    });
    const recognized = parameters.filter(
      (parameter) => parameter.origem_extracao === "PDF_TEXTO"
    );
    const history = extractHistory(document.rows);
    const header = extractHeader(document.text, arquivo.name);
    const resolvedTemplate = {
      ...clone(template),
      parametros: (reference.parametros ?? []).map((parameter) => ({
        codigo: parameter.codigo,
        nomeEsperado: parameter.nome,
        aliases: [parameter.nome, parameter.codigo].filter(Boolean),
        grupoId: parameter.grupo_id,
        ordem: parameter.ordem_exibicao,
        unidade: parameter.unidade,
        tipoCampo: parameter.tipo_dado,
        obrigatorio: Boolean(parameter.obrigatorio),
        permiteFaixa: Boolean(parameter.permite_faixa),
        referenciaDocumento:
          parameter.configuracao_visual?.referencia_documento ?? null
      }))
    };
    const confidence = parameters.length
      ? recognized.reduce((sum, parameter) => sum + parameter.confianca, 0) /
        parameters.length
      : 0;

    return {
      versaoExtrator: EXTRACTOR_VERSION,
      modo: "PDF_TEXTO",
      template: resolvedTemplate,
      cabecalho: header,
      dadosProduto: clone(reference.produto ?? {}),
      dadosFicha: clone(reference.ficha ?? {}),
      grupos: clone(reference.grupos ?? []),
      parametros: parameters,
      historicoRevisoes: history,
      avisos: [
        `${recognized.length} de ${parameters.length} campos reconhecidos no PDF.`,
        history.length
          ? `${history.length} revisões históricas reconhecidas; confira os dados.`
          : "Histórico de revisões não reconhecido automaticamente.",
        "Confira os campos destacados antes de salvar."
      ].filter(Boolean),
      camposNaoReconhecidos: parameters
        .filter((parameter) => parameter.origem_extracao !== "PDF_TEXTO")
        .map((parameter) => ({
          parametro_id: parameter.parametro_id,
          codigo: parameter.codigo,
          nome: parameter.nome
        })),
      confiancaGeral: confidence,
      requerConferenciaHumana: true
    };
  }

  window.LIDUTEC_PDF_EXTRACTOR = Object.freeze({
    version: EXTRACTOR_VERSION,
    extrairFichaPdf
  });
})();
