(function initializeMachariaProductionData(root) {
  const client = () => root.supabaseClient;
  const result = async (request, fallback = []) => {
    const response = await request;
    if (response.error) throw response.error;
    return response.data ?? fallback;
  };
  function applyFilters(query, filters = {}) {
    if (filters.from) query = query.gte("data_operacional", filters.from);
    if (filters.to) query = query.lte("data_operacional", filters.to);
    if (filters.shift) query = query.eq("turno", filters.shift);
    if (filters.linhaId) query = query.eq("linha_maquina_id", filters.linhaId);
    if (filters.sectorId) query = query.eq("setor_responsavel_id", filters.sectorId);
    if (filters.categoryId) query = query.eq("categoria_id", filters.categoryId);
    for (const term of String(filters.search || "").split(/\s+/).filter(Boolean)) {
      query = query.ilike("observacao", `%${term}%`);
    }
    return query.limit(Math.min(Math.max(Number(filters.limit) || 1000, 1), 5000));
  }
  let areaIdCache = null;
  const areaId = async () => {
    if (areaIdCache) return areaIdCache;
    const { data, error } = await client().from("areas_checklist").select("id").eq("codigo", "MACHARIA").single();
    if (error) throw error;
    areaIdCache = data.id;
    return areaIdCache;
  };
  root.LIDUTEC_PRODUCAO_MACHARIA_DATA = {
    support: async () => {
      const [maquinas, machos, categories, sectors] = await Promise.all([
        result(client().from("linhas_maquinas_producao").select("id,codigo,nome,numero_estacoes,areas_checklist!inner(codigo)").eq("areas_checklist.codigo", "MACHARIA").eq("ativo", true).order("codigo")),
        result(client().from("machos_macharia").select("id,caixa,macho,machos_por_sopro,machos_macharia_produtos(produtos(codigo))").eq("status", "APROVADO").eq("ativo", true).order("caixa").order("macho")),
        result(client().from("categorias_parada_producao").select("id,codigo,nome").eq("ativo", true).order("nome")),
        result(client().from("setores_responsaveis_parada").select("id,codigo,nome").eq("ativo", true).order("nome"))
      ]);
      return { maquinas, machos, categories, sectors };
    },
    produtos: () => result(client().from("produtos").select("id,codigo,nome").eq("status", "ATIVO").order("codigo")),
    scheduledStopsAll: async () => {
      const rows = await result(client().from("paradas_programadas")
        .select("linha_maquina_id,turno,tipo_parada_codigo,horario_inicial,horario_final,dias_semana,vigencia_inicio,vigencia_fim,equipamentos_planejamento(codigo)")
        .eq("area_id", await areaId()));
      return rows.map((row) => ({ ...row, equipamento_codigo: row.equipamentos_planejamento?.codigo ?? null }));
    },
    fichas: (status) => result(client().from("machos_macharia")
      .select("id,caixa,macho,machos_por_sopro,peso_macho_kg,kg_areia_por_sopro,sopro_por_hora,status,ativo,substitui_id,motivo_reprovacao,criado_em,usuarios!machos_macharia_criado_por_fkey(nome),machos_macharia_produtos(produto_id,machos_por_peca,produtos(codigo,nome))")
      .eq("status", status).order("criado_em", { ascending: false })),
    salvarFicha: (payload) => result(client().rpc("salvar_ficha_macho", payload), null),
    avaliarFicha: (payload) => result(client().rpc("avaliar_ficha_macho", payload), null),
    importarFichas: (linhas) => result(client().rpc("importar_machos_macharia", { p_linhas: linhas }), null),
    records: (filters = {}) => result(applyFilters(client()
      .from("registros_producao_macharia")
      .select("*,linhas_maquinas_producao(codigo,nome),machos_macharia(caixa,macho,machos_por_sopro,sopro_por_hora,machos_macharia_produtos(produtos(codigo)))")
      .order("horario_previsto", { ascending: false }), filters)),
    stops: (filters = {}) => result(applyFilters(client()
      .from("paradas_producao_macharia")
      .select("*,linhas_maquinas_producao(codigo,nome),categorias_parada_producao(nome),setores_responsaveis_parada(nome)")
      .order("data_operacional", { ascending: false }), filters)),
    descartes: (filters = {}) => result(applyFilters(client()
      .from("descartes_producao_macharia")
      .select("*,linhas_maquinas_producao(codigo,nome),machos_macharia(caixa,macho,machos_por_sopro,machos_macharia_produtos(produtos(codigo)))")
      .order("data_operacional", { ascending: false }), filters)),
    shift: (date, turno) => result(client().from("turnos_producao_macharia")
      .select("id,status,versao,rascunho_producoes,rascunho_paradas,rascunho_descartes,atualizado_por,atualizado_em,usuarios!turnos_producao_macharia_atualizado_por_fkey(nome)")
      .eq("data_operacional", date).eq("turno", turno).maybeSingle(), null),
    shiftProductions: (id) => result(client().from("registros_producao_macharia")
      .select("linha_maquina_id,estacao,horario_previsto,macho_id,quantidade_sopros")
      .eq("turno_producao_id", id).order("linha_maquina_id").order("estacao").order("horario_previsto")),
    shiftStops: (id) => result(client().from("paradas_producao_macharia")
      .select("linha_maquina_id,setor_responsavel_id,categoria_id,inicio,fim,observacao")
      .eq("turno_producao_id", id).order("linha_maquina_id").order("inicio")),
    shiftDescartes: (id) => result(client().from("descartes_producao_macharia")
      .select("linha_maquina_id,macho_id,quantidade_descartada,observacao")
      .eq("turno_producao_id", id).order("linha_maquina_id").order("macho_id")),
    history: (id) => result(client().from("historico_edicoes_turno_macharia")
      .select("alterado_em,descricao,dados_anteriores,dados_novos,usuarios(nome)")
      .eq("turno_producao_id", id).order("alterado_em", { ascending: false })),
    closeShift: (payload) => result(client().rpc("fechar_turno_producao_macharia", payload)),
    saveShiftDraft: (payload) => result(client().rpc("salvar_rascunho_turno_producao_macharia", payload), null),
    editShift: (payload) => result(client().rpc("editar_turno_producao_macharia", payload)),
    deleteShift: (id) => result(client().rpc("excluir_turno_producao_macharia", { p_turno_id: id }))
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
