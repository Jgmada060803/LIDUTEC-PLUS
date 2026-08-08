(function initializeProductionData(root) {
  const client = () => root.supabaseClient;
  const result = async (request, fallback = []) => {
    const response = await request;
    if (response.error) throw response.error;
    return response.data ?? fallback;
  };
  let areaIdCache = null;
  const areaId = async () => {
    if (areaIdCache) return areaIdCache;
    const { data, error } = await client().from("areas_checklist").select("id").eq("codigo", "MOLDAGEM").single();
    if (error) throw error;
    areaIdCache = data.id;
    return areaIdCache;
  };
  function applyFilters(query, filters = {}) {
    if (filters.from) query = query.gte("data_operacional", filters.from);
    if (filters.to) query = query.lte("data_operacional", filters.to);
    if (filters.shift) query = query.eq("turno", filters.shift);
    if (filters.productId) query = query.eq("produto_id", filters.productId);
    if (filters.sectorId) query = query.eq("setor_responsavel_id", filters.sectorId);
    if (filters.categoryId) query = query.eq("categoria_id", filters.categoryId);
    for (const term of String(filters.search || "").split(/\s+/).filter(Boolean)) {
      query = query.ilike("observacao", `%${term}%`);
    }
    return query.limit(Math.min(Math.max(Number(filters.limit) || 1000, 1), 5000));
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
    records: (filters = {}) => result(applyFilters(client()
      .from("registros_producao_moldes")
      .select("*,produtos(codigo,nome,clientes(nome)),linhas_maquinas_producao(codigo,nome)")
      .order("data_operacional", { ascending: false }), filters)),
    stops: (filters = {}) => result(applyFilters(client()
      .from("paradas_producao_moldes")
      .select("*,produtos(codigo,nome),linhas_maquinas_producao(codigo,nome),categorias_parada_producao(nome),setores_responsaveis_parada(nome)")
      .order("data_operacional", { ascending: false }), filters)),
    productMaterials: () => result(client().rpc("materiais_produtos_producao")),
    scheduledStopsAll: async () => {
      const rows = await result(client().from("paradas_programadas")
        .select("linha_maquina_id,turno,tipo_parada_codigo,horario_inicial,horario_final,dias_semana,vigencia_inicio,vigencia_fim,equipamentos_planejamento(codigo)")
        .eq("area_id", await areaId()));
      return rows.map((row) => ({ ...row, equipamento_codigo: row.equipamentos_planejamento?.codigo ?? null }));
    },
    shift: (date, shift) => result(client().from("turnos_producao_moldes").select("id,status,versao,rascunho_producoes,rascunho_paradas,atualizado_por,atualizado_em,usuarios!turnos_producao_moldes_atualizado_por_fkey(nome)").eq("data_operacional", date).eq("turno", shift).maybeSingle(), null),
    monthShifts: (from, to, shift) => result(client().from("turnos_producao_moldes").select("data_operacional,turno,status").gte("data_operacional", from).lte("data_operacional", to).eq("turno", shift).limit(40)),
    calendarEvents: (from, to, shift) => result(client().from("calendario_operacional").select("id,nome,tipo,escopo,data_inicio,data_fim,turno,observacao").eq("ativo",true).lte("data_inicio",to).gte("data_fim",from).or(`turno.eq.TODOS,turno.eq.${shift}`).order("data_inicio").limit(200)),
    previousProduction: (from, before) => result(client().from("registros_producao_moldes").select("produto_id,inicio").gte("inicio", from).lt("inicio", before).order("inicio", { ascending: false }).limit(1).maybeSingle(), null),
    shiftProductions: (id) => result(client().from("registros_producao_moldes").select("produto_id,inicio,fim,rastreabilidade,moldes_vazados,moldes_quebrados,observacao").eq("turno_producao_id", id).order("inicio")),
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
    saveShiftDraft: (payload) => result(client().rpc("salvar_rascunho_turno_producao_moldes", payload), null),
    editShift: (payload) => result(client().rpc("editar_turno_producao_moldes", payload)),
    deleteShift: (id) => result(client().rpc("excluir_turno_producao_moldes", { p_turno_id: id }))
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
