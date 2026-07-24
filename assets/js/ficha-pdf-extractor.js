(function configurePdfExtractor() {
  const EXTRACTOR_VERSION = "assistido-manual-1";

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
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
      confianca: stored.id ? 1 : 0,
      referencia_documento:
        parameter.configuracao_visual?.referencia_documento ?? null
    };
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
    const parameters = (reference.parametros ?? []).map(
      normalizeReferenceParameter
    );
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
    const hasReferenceValues = parameters.some(
      (parameter) => parameter.confianca === 1
    );

    return {
      versaoExtrator: EXTRACTOR_VERSION,
      modo: "ASSISTIDO_MANUAL",
      template: resolvedTemplate,
      dadosProduto: clone(reference.produto ?? {}),
      dadosFicha: clone(reference.ficha ?? {}),
      grupos: clone(reference.grupos ?? []),
      parametros: parameters,
      avisos: [
        "Não há OCR automático configurado.",
        hasReferenceValues
          ? "Valores pré-preenchidos a partir da ficha já cadastrada; confira cada campo no PDF."
          : "Preenchimento manual obrigatório; nenhum valor foi inferido."
      ],
      camposNaoReconhecidos: [],
      confiancaGeral: hasReferenceValues ? 0.8 : 0,
      requerConferenciaHumana: true
    };
  }

  window.LIDUTEC_PDF_EXTRACTOR = Object.freeze({
    version: EXTRACTOR_VERSION,
    extrairFichaPdf
  });
})();
