(function configureImportTemplates() {
  const commonRequiredFields = [
    "produto_id",
    "tipo",
    "codigo_documento",
    "numero_revisao",
    "data_emissao"
  ];

  const templates = {
    moldagem_v1: {
      codigo: "moldagem_v1",
      tipoFicha: "MOLDAGEM",
      versao: "1",
      aliases: [
        "MOLDAGEM",
        "FICHA TÉCNICA DE PROCESSO",
        "FTMO"
      ],
      gruposEsperados: [
        "DADOS DO MODELO",
        "CORREÇÃO DA CÂMARA",
        "JATO DE AREIA",
        "COMPRESSÃO DO MOLDE",
        "EXTRAÇÃO DO MOLDE",
        "FECHAMENTO DO MOLDE"
      ],
      camposObrigatorios: commonRequiredFields,
      validacoes: {
        numeroRevisao: "inteiro_positivo",
        dataEmissao: "data_valida",
        faixas: "minimo_menor_ou_igual_maximo"
      },
      posicoesAproximadas: {
        cabecalho: "topo",
        parametros: "corpo",
        historico: "rodape"
      }
    },
    fusao_vazamento_v1: {
      codigo: "fusao_vazamento_v1",
      tipoFicha: "FUSAO_VAZAMENTO",
      versao: "1",
      aliases: [
        "FUSÃO / VAZAMENTO",
        "FUSAO / VAZAMENTO",
        "FICHA TÉCNICA DE PROCESSO",
        "FTFV"
      ],
      gruposEsperados: [
        "ESPECIFICAÇÕES DO PROCESSO",
        "MATRIZ E PROPRIEDADES MECÂNICAS",
        "COMPOSIÇÃO QUÍMICA NO FORNO",
        "COMPOSIÇÃO QUÍMICA DO VAZAMENTO",
        "INOCULAÇÃO",
        "TEMPERATURAS"
      ],
      camposObrigatorios: commonRequiredFields,
      validacoes: {
        numeroRevisao: "inteiro_positivo",
        dataEmissao: "data_valida",
        faixas: "minimo_menor_ou_igual_maximo"
      },
      posicoesAproximadas: {
        cabecalho: "topo",
        composicaoQuimica: "centro",
        historico: "rodape"
      }
    },
    macharia_v1: {
      codigo: "macharia_v1",
      tipoFicha: "MACHARIA",
      versao: "1",
      aliases: ["MACHARIA"],
      gruposEsperados: [],
      camposObrigatorios: commonRequiredFields,
      validacoes: {}
    },
    acabamento_v1: {
      codigo: "acabamento_v1",
      tipoFicha: "ACABAMENTO",
      versao: "1",
      aliases: ["ACABAMENTO"],
      gruposEsperados: [],
      camposObrigatorios: commonRequiredFields,
      validacoes: {}
    },
    laboratorio_v1: {
      codigo: "laboratorio_v1",
      tipoFicha: "LABORATORIO",
      versao: "1",
      aliases: ["LABORATÓRIO", "LABORATORIO"],
      gruposEsperados: [],
      camposObrigatorios: commonRequiredFields,
      validacoes: {}
    }
  };

  window.LIDUTEC_IMPORT_TEMPLATES = Object.freeze(templates);
})();
