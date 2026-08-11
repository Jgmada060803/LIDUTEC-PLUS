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
    return query.limit(Math.min(Math.max(Number(filters.limit) || 1000, 1), 5000));
  }
  root.LIDUTEC_PRODUCAO_MACHARIA_DATA = {
    support: async () => {
      const [maquinas, machos] = await Promise.all([
        result(client().from("linhas_maquinas_producao").select("id,codigo,nome,numero_estacoes,areas_checklist!inner(codigo)").eq("areas_checklist.codigo", "MACHARIA").eq("ativo", true).order("codigo")),
        result(client().from("machos_macharia").select("id,caixa,macho").eq("status", "APROVADO").eq("ativo", true).order("caixa").order("macho"))
      ]);
      return { maquinas, machos };
    },
    produtos: () => result(client().from("produtos").select("id,codigo,nome").eq("status", "ATIVO").order("codigo")),
    fichas: (status) => result(client().from("machos_macharia")
      .select("id,caixa,macho,machos_por_sopro,peso_macho_kg,kg_areia_por_sopro,sopro_por_hora,status,ativo,substitui_id,motivo_reprovacao,criado_em,usuarios!machos_macharia_criado_por_fkey(nome),machos_macharia_produtos(produto_id,machos_por_peca,produtos(codigo,nome))")
      .eq("status", status).order("criado_em", { ascending: false })),
    salvarFicha: (payload) => result(client().rpc("salvar_ficha_macho", payload), null),
    avaliarFicha: (payload) => result(client().rpc("avaliar_ficha_macho", payload), null),
    importarFichas: (linhas) => result(client().rpc("importar_machos_macharia", { p_linhas: linhas }), null),
    records: (filters = {}) => result(applyFilters(client()
      .from("registros_producao_macharia")
      .select("*,linhas_maquinas_producao(codigo,nome),machos_macharia(caixa,macho,machos_por_sopro)")
      .order("horario_previsto", { ascending: false }), filters)),
    shift: (date, turno) => result(client().from("turnos_producao_macharia")
      .select("id,status,versao,rascunho_producoes,atualizado_por,atualizado_em,usuarios!turnos_producao_macharia_atualizado_por_fkey(nome)")
      .eq("data_operacional", date).eq("turno", turno).maybeSingle(), null),
    shiftProductions: (id) => result(client().from("registros_producao_macharia")
      .select("linha_maquina_id,estacao,horario_previsto,macho_id,quantidade_sopros")
      .eq("turno_producao_id", id).order("linha_maquina_id").order("estacao").order("horario_previsto")),
    history: (id) => result(client().from("historico_edicoes_turno_macharia")
      .select("alterado_em,descricao,dados_anteriores,dados_novos,usuarios(nome)")
      .eq("turno_producao_id", id).order("alterado_em", { ascending: false })),
    closeShift: (payload) => result(client().rpc("fechar_turno_producao_macharia", payload)),
    saveShiftDraft: (payload) => result(client().rpc("salvar_rascunho_turno_producao_macharia", payload), null),
    editShift: (payload) => result(client().rpc("editar_turno_producao_macharia", payload)),
    deleteShift: (id) => result(client().rpc("excluir_turno_producao_macharia", { p_turno_id: id }))
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
