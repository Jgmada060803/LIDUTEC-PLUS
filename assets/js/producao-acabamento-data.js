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
      const [products, lines, categories, sectors, postos] = await Promise.all([
        result(client().from("produtos").select("id,codigo,nome").eq("status", "ATIVO").order("codigo")),
        result(client().from("linhas_maquinas_producao").select("id,codigo,nome,areas_checklist!inner(codigo)").eq("areas_checklist.codigo", "ACABAMENTO").eq("ativo", true).order("codigo")),
        result(client().from("categorias_parada_producao").select("id,codigo,nome").eq("ativo", true).order("nome")),
        result(client().from("setores_responsaveis_parada").select("id,codigo,nome").eq("ativo", true).order("nome")),
        result(client().from("postos_equipamentos_acabamento").select("id,codigo,nome,tipo,linha_maquina_id").eq("ativo", true).order("ordem"))
      ]);
      return { products, lines, categories, sectors, postos };
    },
    cycleTimes: async (productIds) => {
      if (!productIds?.length) return [];
      return result(client().from("tempos_ciclo_padrao").select("produto_id,identificador,tempo_ciclo_segundos")
        .eq("area_id", await areaId()).in("produto_id", productIds));
    },
    openShiftsBefore: (turno, date) => result(client().from("turnos_producao_acabamento")
      .select("data_operacional,rascunho_producoes,rascunho_paradas,rascunho_linhas")
      .eq("turno", turno).eq("status", "ABERTO").lt("data_operacional", date)
      .order("data_operacional", { ascending: true }).limit(60)),
    plannedOperators: async (linhaId, turno, date) => {
      const { data, error } = await client().rpc("meta_vigente", {
        p_area_id: await areaId(), p_linha_maquina_id: linhaId, p_turno: turno,
        p_indicador_codigo: "OPERADORES_PLANEJADOS", p_data: date
      });
      if (error) throw error;
      return data;
    },
    linha2Ativa: async (date, turno) => {
      const { data, error } = await client().rpc("linha_2_ativa_acabamento", { p_data_operacional: date, p_turno: turno });
      if (error) throw error;
      return data;
    },
    scheduledStops: async (from, to) => {
      const rows = await result(client().from("paradas_programadas")
        .select("linha_maquina_id,turno,tipo_parada_codigo,horario_inicial,horario_final,dias_semana,vigencia_inicio,vigencia_fim,equipamentos_planejamento(codigo)")
        .eq("area_id", await areaId())
        .lte("vigencia_inicio", to)
        .or(`vigencia_fim.is.null,vigencia_fim.gte.${from}`));
      return rows.map((row) => ({ ...row, equipamento_codigo: row.equipamentos_planejamento?.codigo ?? null }));
    },
    scheduledStopsAll: async () => {
      const rows = await result(client().from("paradas_programadas")
        .select("linha_maquina_id,turno,tipo_parada_codigo,horario_inicial,horario_final,dias_semana,vigencia_inicio,vigencia_fim,equipamentos_planejamento(codigo)")
        .eq("area_id", await areaId()));
      return rows.map((row) => ({ ...row, equipamento_codigo: row.equipamentos_planejamento?.codigo ?? null }));
    },
    records: (filters = {}) => result(applyFilters(client()
      .from("registros_producao_acabamento")
      .select("*,produtos(codigo,nome,clientes(nome)),linhas_maquinas_producao(codigo,nome)")
      .order("data_operacional", { ascending: false }), filters)),
    stops: (filters = {}) => result(applyFilters(client()
      .from("paradas_producao_acabamento")
      .select("*,categorias_parada_producao(nome),setores_responsaveis_parada(nome),postos_equipamentos_acabamento(codigo,nome,tipo,linha_maquina_id)")
      .order("data_operacional", { ascending: false }), filters)),
    monthShifts: (from, to, shift) => result(client().from("turnos_producao_acabamento").select("data_operacional,turno,status").gte("data_operacional", from).lte("data_operacional", to).eq("turno", shift).limit(40)),
    calendarEvents: (from, to, shift) => result(client().from("calendario_operacional").select("id,nome,tipo,escopo,data_inicio,data_fim,turno,observacao").eq("ativo", true).lte("data_inicio", to).gte("data_fim", from).or(`turno.eq.TODOS,turno.eq.${shift}`).order("data_inicio").limit(200)),
    shiftsOnDate: (date) => result(client().from("turnos_acabamento_linhas")
      .select("turno_producao_id,linha_maquina_id,operadores_planejados,operadores_presentes,turnos_producao_acabamento!inner(turno,status,data_operacional)")
      .eq("turnos_producao_acabamento.data_operacional", date)),
    shiftsInRange: (from, to) => result(client().from("turnos_acabamento_linhas")
      .select("turno_producao_id,linha_maquina_id,operadores_planejados,operadores_presentes,turnos_producao_acabamento!inner(turno,status,data_operacional)")
      .gte("turnos_producao_acabamento.data_operacional", from)
      .lte("turnos_producao_acabamento.data_operacional", to)
      .eq("turnos_producao_acabamento.status", "FECHADO")),
    shift: (date, turno) => result(client().from("turnos_producao_acabamento")
      .select("id,status,versao,rascunho_producoes,rascunho_paradas,rascunho_linhas,atualizado_por,atualizado_em,usuarios!turnos_producao_acabamento_atualizado_por_fkey(nome),turnos_acabamento_linhas(linha_maquina_id,operadores_planejados,operadores_presentes)")
      .eq("data_operacional", date).eq("turno", turno).maybeSingle(), null),
    shiftProductions: (id) => result(client().from("registros_producao_acabamento")
      .select("linha_maquina_id,produto_id,quantidade_liberada,quantidade_rejeitada,quantidade_retrabalhada,quantidade_refugada")
      .eq("turno_producao_id", id).order("linha_maquina_id").order("produto_id")),
    shiftStops: (id) => result(client().from("paradas_producao_acabamento")
      .select("inicio,fim,setor_origem_id,categoria_id,posto_equipamento_id,observacao").eq("turno_producao_id", id).order("inicio")),
    history: async (id) => result(client().from("historico_edicoes_turno_acabamento")
      .select("alterado_em,descricao,dados_anteriores,dados_novos,usuarios(nome)")
      .eq("turno_producao_id", id).order("alterado_em", { ascending: false })),
    closeShift: (payload) => result(client().rpc("fechar_turno_producao_acabamento", payload)),
    saveShiftDraft: (payload) => result(client().rpc("salvar_rascunho_turno_producao_acabamento", payload), null),
    editShift: (payload) => result(client().rpc("editar_turno_producao_acabamento", payload)),
    deleteShift: (id) => result(client().rpc("excluir_turno_producao_acabamento", { p_turno_id: id }))
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
