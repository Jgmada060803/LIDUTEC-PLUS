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
    save: (payload) => unwrap(client().rpc("salvar_execucao_checklist", payload), null),
    decide: (executionId, decision, justification) => unwrap(client().rpc(
      "decidir_execucao_checklist", {
        p_execucao_id: executionId,
        p_decisao: decision,
        p_justificativa: justification
      }), null),
    executions: () => unwrap(client().from("execucoes_checklist").select(`
      id,data_operacional,turno,equipamento,corrida,status,iniciado_em,concluido_em,
      modelos_checklist(id,codigo,nome,areas_checklist(id,codigo,nome,cor)),
      produtos(id,codigo,nome),
      usuarios!execucoes_checklist_operador_id_fkey(nome)
    `).order("iniciado_em", { ascending: false }).limit(1000)),
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
      return unwrap(query);
    }
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
