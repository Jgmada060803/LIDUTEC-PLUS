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
        id,horario_previsto,iniciado_em,concluido_em,status,
        usuarios!execucoes_checklist_operador_id_fkey(nome),
        respostas_checklist(item_id,resultado,valor_numero,valor_texto,observacao,acao_imediata)
      `)
      .eq("modelo_id", modeloId).eq("data_operacional", date).eq("turno", turno)
      .order("horario_previsto")),
    // TODO: generalizar por área quando outros setores migrarem (hoje só
    // Moldagem tem apontamento de produção com turno aberto/fechado).
    shiftStatus: (date, turno) => unwrap(client().from("turnos_producao_moldes")
      .select("status").eq("data_operacional", date).eq("turno", turno).maybeSingle(), null),
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
