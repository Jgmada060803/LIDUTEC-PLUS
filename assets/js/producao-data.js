(function initializeProductionData(root) {
  const client = () => root.supabaseClient;
  const result = async (request, fallback = []) => {
    const response = await request;
    if (response.error) throw response.error;
    return response.data ?? fallback;
  };
  async function allPages(table, columns, order) {
    const pageSize = 1000;
    const rows = [];
    for (let from = 0; ; from += pageSize) {
      const data = await result(client().from(table).select(columns)
        .order(order, { ascending: false }).range(from, from + pageSize - 1));
      rows.push(...data);
      if (data.length < pageSize) return rows;
    }
  }
  root.LIDUTEC_PRODUCAO_DATA = {
    support: async () => {
      const [products, lines, categories, sectors] = await Promise.all([
        result(client().from("produtos").select("id,codigo,nome,cavidades_molde,peso_peca_kg").eq("status", "ATIVO").order("codigo")),
        result(client().from("linhas_maquinas_producao").select("id,codigo,nome").eq("ativo", true).order("codigo")),
        result(client().from("categorias_parada_producao").select("id,codigo,nome").eq("ativo", true).order("nome")),
        result(client().from("setores_responsaveis_parada").select("id,codigo,nome").eq("ativo", true).order("nome"))
      ]);
      return { products, lines, categories, sectors };
    },
    records: () => allPages("registros_producao_moldes", "*,produtos(codigo,nome),linhas_maquinas_producao(codigo,nome)", "data_operacional"),
    stops: () => allPages("paradas_producao_moldes", "*,produtos(codigo,nome),linhas_maquinas_producao(codigo,nome),categorias_parada_producao(nome),setores_responsaveis_parada(nome)", "inicio"),
    shift: (date, shift) => result(client().from("turnos_producao_moldes").select("id,status").eq("data_operacional", date).eq("turno", shift).maybeSingle(), null),
    shiftProductions: (id) => result(client().from("registros_producao_moldes").select("produto_id,inicio,fim,moldes_vazados,moldes_quebrados").eq("turno_producao_id", id).order("inicio")),
    shiftStops: (id) => result(client().from("paradas_producao_moldes").select("inicio,fim,setor_responsavel_id,categoria_id,observacao").eq("turno_producao_id", id).order("inicio")),
    history: async (id) => {
      const table = "historico_edicoes_turno_producao";
      const detailed = await client().from(table)
        .select("alterado_em,descricao,dados_anteriores,dados_novos,usuarios(nome)")
        .eq("turno_producao_id", id)
        .order("alterado_em", { ascending: false });
      if (!detailed.error) return detailed.data ?? [];
      const missingSnapshots = /dados_anteriores|dados_novos/i.test(
        `${detailed.error.message || ""} ${detailed.error.details || ""}`
      );
      if (!missingSnapshots) throw detailed.error;
      return result(client().from(table)
        .select("alterado_em,descricao,usuarios(nome)")
        .eq("turno_producao_id", id)
        .order("alterado_em", { ascending: false }));
    },
    closeShift: (payload) => result(client().rpc("fechar_turno_producao_moldes", payload)),
    editShift: (payload) => result(client().rpc("editar_turno_producao_moldes", payload)),
    deleteShift: (id) => result(client().rpc("excluir_turno_producao_moldes", { p_turno_id: id }))
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
