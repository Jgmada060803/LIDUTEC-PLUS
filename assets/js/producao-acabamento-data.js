(function initializeAcabamentoProductionData(root) {
  const client = () => root.supabaseClient;
  const result = async (request, fallback = []) => {
    const response = await request;
    if (response.error) throw response.error;
    return response.data ?? fallback;
  };
  let areaIdCache = null;
  const areaId = async () => {
    if (areaIdCache) return areaIdCache;
    const { data, error } = await client().from("areas_checklist").select("id").eq("codigo", "ACABAMENTO").single();
    if (error) throw error;
    areaIdCache = data.id;
    return areaIdCache;
  };
  function applyFilters(query, filters = {}) {
    if (filters.from) query = query.gte("data_operacional", filters.from);
    if (filters.to) query = query.lte("data_operacional", filters.to);
    if (filters.shift) query = query.eq("turno", filters.shift);
    if (filters.productId) query = query.eq("produto_id", filters.productId);
    return query.limit(Math.min(Math.max(Number(filters.limit) || 1000, 1), 5000));
  }
  root.LIDUTEC_PRODUCAO_ACABAMENTO_DATA = {
    support: async () => {
      const [products, lines, categories, sectors] = await Promise.all([
        result(client().from("produtos").select("id,codigo,nome").eq("status", "ATIVO").order("codigo")),
        result(client().from("linhas_maquinas_producao").select("id,codigo,nome,areas_checklist!inner(codigo)").eq("areas_checklist.codigo", "ACABAMENTO").eq("ativo", true).order("codigo")),
        result(client().from("categorias_parada_producao").select("id,codigo,nome").eq("ativo", true).order("nome")),
        result(client().from("setores_responsaveis_parada").select("id,codigo,nome").eq("ativo", true).order("nome"))
      ]);
      return { products, lines, categories, sectors };
    },
    cycleTimes: async (productIds) => {
      if (!productIds?.length) return [];
      return result(client().from("tempos_ciclo_padrao").select("produto_id,identificador,tempo_ciclo_segundos")
        .eq("area_id", await areaId()).in("produto_id", productIds));
    },
    plannedOperators: async (linhaId, turno, date) => {
      const { data, error } = await client().rpc("meta_vigente", {
        p_area_id: await areaId(), p_linha_maquina_id: linhaId, p_turno: turno,
        p_indicador_codigo: "OPERADORES_PLANEJADOS", p_data: date
      });
      if (error) throw error;
      return data;
    },
    records: (filters = {}) => result(applyFilters(client()
      .from("registros_producao_acabamento")
      .select("*,produtos(codigo,nome,clientes(nome))")
      .order("data_operacional", { ascending: false }), filters)),
    stops: (filters = {}) => result(applyFilters(client()
      .from("paradas_producao_acabamento")
      .select("*,categorias_parada_producao(nome),setores_responsaveis_parada(nome)")
      .order("data_operacional", { ascending: false }), filters)),
    shiftsOnDate: (date) => result(client().from("turnos_producao_acabamento")
      .select("id,turno,linha_maquina_id,operadores_planejados,operadores_presentes,status")
      .eq("data_operacional", date)),
    shiftsInRange: (from, to) => result(client().from("turnos_producao_acabamento")
      .select("id,turno,linha_maquina_id,operadores_planejados,operadores_presentes,status")
      .gte("data_operacional", from).lte("data_operacional", to).eq("status", "FECHADO")),
    shift: (date, turno, linhaId) => result(client().from("turnos_producao_acabamento")
      .select("id,status,versao,linha_maquina_id,operadores_planejados,operadores_presentes,rascunho_producoes,rascunho_paradas,atualizado_por,atualizado_em,usuarios!turnos_producao_acabamento_atualizado_por_fkey(nome)")
      .eq("data_operacional", date).eq("turno", turno).eq("linha_maquina_id", linhaId).maybeSingle(), null),
    monthShifts: (from, to, turno, linhaId) => result(client().from("turnos_producao_acabamento")
      .select("data_operacional,turno,status").gte("data_operacional", from).lte("data_operacional", to)
      .eq("turno", turno).eq("linha_maquina_id", linhaId).limit(40)),
    shiftProductions: (id) => result(client().from("registros_producao_acabamento")
      .select("produto_id,quantidade_liberada,quantidade_rejeitada,quantidade_retrabalhada,quantidade_refugada")
      .eq("turno_producao_id", id).order("produto_id")),
    shiftStops: (id) => result(client().from("paradas_producao_acabamento")
      .select("inicio,fim,setor_origem_id,categoria_id,observacao").eq("turno_producao_id", id).order("inicio")),
    history: async (id) => result(client().from("historico_edicoes_turno_acabamento")
      .select("alterado_em,descricao,dados_anteriores,dados_novos,usuarios(nome)")
      .eq("turno_producao_id", id).order("alterado_em", { ascending: false })),
    closeShift: (payload) => result(client().rpc("fechar_turno_producao_acabamento", payload)),
    saveShiftDraft: (payload) => result(client().rpc("salvar_rascunho_turno_producao_acabamento", payload), null),
    editShift: (payload) => result(client().rpc("editar_turno_producao_acabamento", payload)),
    deleteShift: (id) => result(client().rpc("excluir_turno_producao_acabamento", { p_turno_id: id }))
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
