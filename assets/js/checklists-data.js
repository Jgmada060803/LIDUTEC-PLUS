(function initializeChecklistData(root) {
  const client = () => root.supabaseClient;
  const unwrap = async (request, fallback = []) => {
    const response = await request;
    if (response.error) throw response.error;
    return response.data ?? fallback;
  };

  root.LIDUTEC_CHECKLISTS_DATA = {
    areas: () => unwrap(client().from("areas_checklist")
      .select("id,codigo,nome,ordem,cor").eq("ativo", true).order("ordem")),
    models: () => unwrap(client().from("modelos_checklist")
      .select("*,areas_checklist(id,codigo,nome,cor)").eq("ativo", true)
      .order("codigo")),
    model: (id) => unwrap(client().from("modelos_checklist")
      .select("*,areas_checklist(id,codigo,nome,cor)").eq("id", id)
      .eq("ativo", true).maybeSingle(), null),
    items: (modelId) => unwrap(client().from("itens_checklist")
      .select("*").eq("modelo_id", modelId).eq("ativo", true)
      .order("ordem")),
    products: () => unwrap(client().from("produtos")
      .select("id,codigo,nome").eq("status", "ATIVO").order("codigo")),
    productionAt: (date, shift, moment = new Date()) => unwrap(client()
      .from("registros_producao_moldes")
      .select("produto_id,inicio,fim,produtos(id,codigo,nome)")
      .eq("data_operacional", date).eq("turno", shift)
      .lte("inicio", new Date(moment).toISOString())
      .order("inicio", { ascending: false }).limit(1).maybeSingle(), null),
    save: (payload) => unwrap(client().rpc("salvar_execucao_checklist", payload), null),
    executionsForSlots: (modeloId, date, turno) => unwrap(client().from("execucoes_checklist")
      .select(`
        id,horario_previsto,equipamento,iniciado_em,concluido_em,status,produto_id,
        produtos(id,codigo,nome),
        usuarios!execucoes_checklist_operador_id_fkey(nome),
        respostas_checklist(item_id,resultado,valor_numero,valor_texto,observacao,acao_imediata)
      `)
      .eq("modelo_id", modeloId).eq("data_operacional", date).eq("turno", turno)
      .order("horario_previsto")),
    // Moldagem e Acabamento têm apontamento de produção com turno aberto/
    // fechado; os demais setores ainda não migraram (retorna null pra eles).
    shiftStatus: (date, turno, areaCode) => areaCode === "ACABAMENTO"
      ? unwrap(client().from("turnos_producao_acabamento")
          .select("status,rascunho_producoes,rascunho_paradas,turnos_acabamento_linhas(linha_maquina_id)")
          .eq("data_operacional", date).eq("turno", turno).maybeSingle(), null)
      : unwrap(client().from("turnos_producao_moldes")
          .select("status,rascunho_producoes,rascunho_paradas").eq("data_operacional", date).eq("turno", turno).maybeSingle(), null),
    // Usado pra identificar postos marcados como parados por absenteísmo
    // (categoria Absenteísmo / setor ADM) no checklist por posto do Acabamento.
    categoriaParadaByCodigo: (codigo) => unwrap(client().from("categorias_parada_producao")
      .select("id").eq("codigo", codigo).maybeSingle(), null),
    setorParadaByCodigo: (codigo) => unwrap(client().from("setores_responsaveis_parada")
      .select("id").eq("codigo", codigo).maybeSingle(), null),
    stopsForAcabamentoShift: (date, turno) => unwrap(client().from("paradas_producao_acabamento")
      .select("posto_equipamento_id,categoria_id,setor_origem_id")
      .eq("data_operacional", date).eq("turno", turno)),
    // Postos de linha do Acabamento (ex.: rebarbação) — usado pra montar as
    // colunas do checklist por posto (ex.: A01), já com a linha a que pertencem.
    postosAcabamento: () => unwrap(client().from("postos_equipamentos_acabamento")
      .select("id,codigo,nome,linha_maquina_id,linhas_maquinas_producao(codigo)")
      .eq("tipo", "POSTO_LINHA").eq("ativo", true).order("ordem")),
    // Turno fechado já tem registro definitivo de produção; usado pra montar
    // as colunas do checklist de SETUP (uma coluna por linha de produção que
    // exige setup).
    productionsForShift: (date, turno) => unwrap(client().from("registros_producao_moldes")
      .select("produto_id,inicio,fim,produtos(id,codigo,nome)")
      .eq("data_operacional", date).eq("turno", turno).order("inicio")),
    // Idem, mas para paradas — usado pra identificar colunas do checklist de
    // intervalo em que a máquina estava parada (não exige preenchimento).
    stopsForShift: (date, turno) => unwrap(client().from("paradas_producao_moldes")
      .select("inicio,fim")
      .eq("data_operacional", date).eq("turno", turno).order("inicio")),
    previousProduction: (from, before) => unwrap(client().from("registros_producao_moldes")
      .select("produto_id,inicio").gte("inicio", from).lt("inicio", before)
      .order("inicio", { ascending: false }).limit(1).maybeSingle(), null),
    decide: (executionId, decision, justification) => unwrap(client().rpc(
      "decidir_execucao_checklist", {
        p_execucao_id: executionId,
        p_decisao: decision,
        p_justificativa: justification
      }), null),
    executions: (filters = {}) => {
      let query = client().from("execucoes_checklist").select(`
      id,data_operacional,turno,equipamento,corrida,status,iniciado_em,concluido_em,
      modelos_checklist(id,codigo,nome,areas_checklist(id,codigo,nome,cor)),
      produtos(id,codigo,nome),
      usuarios!execucoes_checklist_operador_id_fkey(nome)
      `).order("iniciado_em", { ascending: false });
      if (filters.from) query = query.gte("data_operacional", filters.from);
      if (filters.to) query = query.lte("data_operacional", filters.to);
      if (filters.status) query = query.eq("status", filters.status);
      return unwrap(query.limit(1000));
    },
    execution: (id) => unwrap(client().from("execucoes_checklist").select(`
      id,data_operacional,turno,equipamento,corrida,status,observacao,iniciado_em,concluido_em,
      modelos_checklist(id,codigo,nome,descricao,areas_checklist(id,codigo,nome,cor)),
      produtos(id,codigo,nome),usuarios!execucoes_checklist_operador_id_fkey(nome),
      respostas_checklist(id,resultado,valor_numero,valor_texto,observacao,acao_imediata,respondido_em,
        itens_checklist(id,codigo,secao,descricao,tipo_resposta,unidade,critico,ordem)),
      liberacoes_checklist(decisao,justificativa,decidido_em,
        usuarios!liberacoes_checklist_supervisor_id_fkey(nome))
    `).eq("id", id).maybeSingle(), null),
    pendingApprovals: () => unwrap(client().from("execucoes_checklist").select(`
      id,data_operacional,turno,equipamento,corrida,status,iniciado_em,
      modelos_checklist(codigo,nome,areas_checklist(nome,cor)),
      produtos(codigo,nome),usuarios!execucoes_checklist_operador_id_fkey(nome),
      respostas_checklist(resultado,observacao,acao_imediata,
        itens_checklist(descricao,plano_reacao,critico))
    `).eq("status", "AGUARDANDO_SUPERVISOR").order("iniciado_em")),
    chartItems: () => unwrap(client().from("itens_checklist").select(`
      id,descricao,unidade,valor_minimo,valor_alvo,valor_maximo,
      modelos_checklist(codigo,nome,areas_checklist(nome))
    `).eq("ativo", true).eq("gera_carta", true).order("descricao")),
    measurements: (itemId, from, to) => {
      let query = client().from("medicoes_checklist").select(`
        id,valor,limite_minimo,valor_alvo,limite_maximo,conforme,medido_em,equipamento,
        fonte_limite_tipo,fonte_limite_codigo,fonte_limite_revisao,fonte_limite_pagina,
        produtos(codigo,nome),itens_checklist(descricao,unidade)
      `).eq("item_id", itemId).order("medido_em");
      if (from) query = query.gte("medido_em", `${from}T00:00:00`);
      if (to) query = query.lte("medido_em", `${to}T23:59:59.999`);
      return unwrap(query.limit(2000));
    }
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
