(function initializeFusaoProductionData(root) {
  const client = () => root.supabaseClient;
  const result = async (request, fallback = []) => {
    const response = await request;
    if (response.error) throw response.error;
    return response.data ?? fallback;
  };
  root.LIDUTEC_PRODUCAO_FUSAO_DATA = {
    materiais: (somenteAtivos = true) => {
      let query = client().from("materiais_fusao").select("id,nome,tipo,ativo,modo_pesagem").order("nome");
      if (somenteAtivos) query = query.eq("ativo", true);
      return result(query);
    },
    fornos: (tipo = null) => {
      let query = client().from("fornos_fusao").select("id,codigo,nome,tipo,limite_atencao_corridas,limite_critico_corridas,ativo,carro,capacidade_kg").eq("ativo", true).order("codigo");
      if (tipo) query = query.eq("tipo", tipo);
      return result(query);
    },
    materiaisTodos: () => result(client().from("materiais_fusao")
      .select("id,nome,tipo,ativo,pct_c,pct_si,pct_mn,pct_p,pct_cr,pct_s,pct_sn,pct_cu,pct_mo,pct_al,pct_pb,modo_pesagem")
      .order("nome")),
    fornosTodos: () => result(client().from("fornos_fusao").select("id,codigo,nome,tipo,limite_atencao_corridas,limite_critico_corridas,ativo,carro,capacidade_kg").order("codigo")),
    produtos: () => result(client().from("produtos").select("id,codigo,nome").eq("status", "ATIVO").order("codigo")),
    volumeAtualFornos: () => result(client().from("fornos_fusao_volume_atual").select("forno_id,volume_atual_kg")),
    tiposMaterialProdutos: () => result(client().rpc("tipos_material_produtos_fusao")),
    // CE/temperatura min-max (já existiam na ficha técnica, só faltava
    // ler) e peso metálico por molde — usado pelos gráficos e pelo
    // balanço de massa (etapas seguintes do roadmap).
    especificacoesFusaoVazamentoProdutos: () => result(client().rpc("especificacoes_fusao_vazamento_produtos")),
    salvarMaterial: (payload) => result(client().rpc("salvar_material_fusao", payload), null),
    salvarForno: (payload) => result(client().rpc("salvar_forno_fusao", payload), null),
    trocarRefratario: (fornoId, motivo, situacaoForno, observacoes) => result(client().rpc("trocar_refratario_fusao", {
      p_forno_id: fornoId, p_motivo: motivo, p_situacao_forno: situacaoForno, p_observacoes: observacoes
    }), null),
    cicloAtivo: (fornoId) => result(client().from("ciclos_refratario_fusao")
      .select("id,numero_ciclo,iniciado_em")
      .eq("forno_id", fornoId).is("encerrado_em", null).maybeSingle(), null),
    corridasNoCiclo: async (cicloId) => {
      const response = await client().from("corridas_fusao")
        .select("id", { count: "exact", head: true }).eq("ciclo_refratario_id", cicloId);
      if (response.error) throw response.error;
      return { count: response.count ?? 0 };
    },
    corridas: (filters = {}) => {
      let query = client().from("corridas_fusao")
        .select("id,codigo,forno_id,ciclo_refratario_id,numero_sequencia,data_operacional,turno,status,versao,criado_em,fornos_fusao(codigo,nome),produtos(codigo,nome)")
        .order("criado_em", { ascending: false }).limit(200);
      if (filters.fornoId) query = query.eq("forno_id", filters.fornoId);
      if (filters.status) query = query.eq("status", filters.status);
      return result(query);
    },
    corridaAbertaDoForno: (fornoId) => result(client().from("corridas_fusao")
      .select("id,codigo,forno_id,turno,status,versao,data_operacional,produto_id,inicio,fim,sobra_inicial_kg,produtos(codigo,nome)")
      .eq("forno_id", fornoId).eq("status", "ABERTA").maybeSingle(), null),
    // Card do forno (index.html): tudo numa consulta só (corrida + itens +
    // transferências dos dois lados + mensagens) — antes eram 4 idas ao
    // banco por card (1 pra achar a corrida + 3 em paralelo depois de
    // saber o id); agora é 1 só, feita direto pelo forno_id.
    corridaAbertaCompletaDoForno: (fornoId) => result(client().from("corridas_fusao")
      .select("id,codigo,forno_id,ciclo_refratario_id,numero_sequencia,turno,status,versao,data_operacional,produto_id,inicio,fim,sobra_inicial_kg,escoria_kg,lingote_kg,energia_kwh,ajuste_kg,temperatura_programada_c,produtos(codigo,nome)," +
        "corridas_fusao_carga_itens(id,material_id,quantidade_planejada_kg,quantidade_realizada_kg,estado_fisico,materiais_fusao(nome,tipo,modo_pesagem))," +
        "corridas_fusao_mensagens(id,mensagem,criado_em,origem,usuarios(nome))," +
        "saidas:transferencias_fusao!corrida_origem_id(id,quantidade_kg,corridas_fusao!corrida_destino_id(codigo))," +
        "entradas:transferencias_fusao!corrida_destino_id(id,quantidade_kg,corridas_fusao!corrida_origem_id(codigo))," +
        "panelas_holding!holding_corrida_id(peso_kg)")
      .eq("forno_id", fornoId).eq("status", "ABERTA")
      .order("id", { foreignTable: "corridas_fusao_carga_itens" })
      .order("criado_em", { foreignTable: "corridas_fusao_mensagens" })
      .maybeSingle(), null),
    corrida: (id) => result(client().from("corridas_fusao")
      .select("id,codigo,forno_id,ciclo_refratario_id,numero_sequencia,data_operacional,turno,status,versao,criado_em,produto_id,inicio,fim,sobra_inicial_kg,escoria_kg,lingote_kg,energia_kwh,ajuste_kg,temperatura_programada_c,saldo_forno_no_fechamento_kg,fornos_fusao(codigo,nome,tipo),produtos(codigo,nome)")
      .eq("id", id).maybeSingle(), null),
    // Movimentos de transferência da corrida, dos dois lados: saídas (essa
    // corrida mandou pra outro forno) e entradas (recebeu de outra) — vira
    // uma linha "Entrada/Saída" na carga, igual a um item de material.
    transferenciasDaCorrida: async (corridaId) => {
      const [comoOrigem, comoDestino] = await Promise.all([
        result(client().from("transferencias_fusao").select("id,quantidade_kg,corridas_fusao!corrida_destino_id(codigo)").eq("corrida_origem_id", corridaId)),
        result(client().from("transferencias_fusao").select("id,quantidade_kg,corridas_fusao!corrida_origem_id(codigo)").eq("corrida_destino_id", corridaId))
      ]);
      return {
        saidas: comoOrigem.map((t) => ({ id: t.id, quantidade_kg: t.quantidade_kg, corridaCodigo: t.corridas_fusao?.codigo })),
        entradas: comoDestino.map((t) => ({ id: t.id, quantidade_kg: t.quantidade_kg, corridaCodigo: t.corridas_fusao?.codigo }))
      };
    },
    cargaItens: (corridaId) => result(client().from("corridas_fusao_carga_itens")
      .select("id,material_id,quantidade_planejada_kg,quantidade_realizada_kg,estado_fisico,criado_em,atualizado_em,materiais_fusao(nome,tipo,modo_pesagem),criado_por_usuario:usuarios!criado_por(nome),atualizado_por_usuario:usuarios!atualizado_por(nome),corridas_fusao_pesagens_ponte_log(quantidade_kg,registrado_em,usuarios(nome))")
      .eq("corrida_id", corridaId).order("id")),
    adicoes: (corridaId) => result(client().from("corridas_fusao_adicoes")
      .select("id,material_id,quantidade_kg,adicionado_em,materiais_fusao(nome)")
      .eq("corrida_id", corridaId).order("adicionado_em", { ascending: false })),
    criarCorrida: (payload) => result(client().rpc("criar_corrida_fusao", payload), null),
    adicionarItemCarga: (corridaId, materialId, quantidade, estadoFisico) => result(client().rpc("adicionar_item_carga_fusao", {
      p_corrida_id: corridaId, p_material_id: materialId, p_quantidade_planejada_kg: quantidade, p_estado_fisico: estadoFisico
    }), null),
    removerItemCarga: (corridaId, itemId) => result(client().rpc("remover_item_carga_fusao", {
      p_corrida_id: corridaId, p_item_id: itemId
    }), null),
    atualizarPesagem: (corridaId, itemId, quantidade) => result(client().rpc("atualizar_pesagem_carga_fusao", {
      p_corrida_id: corridaId, p_material_id: itemId, p_quantidade_realizada_kg: quantidade
    }), null),
    atualizarPlanejado: (corridaId, itemId, quantidade) => result(client().rpc("atualizar_planejado_carga_fusao", {
      p_corrida_id: corridaId, p_item_id: itemId, p_quantidade_planejada_kg: quantidade
    }), null),
    adicionarPesagem: (corridaId, materialId, quantidade) => result(client().rpc("adicionar_pesagem_carga_fusao", {
      p_corrida_id: corridaId, p_material_id: materialId, p_quantidade_kg: quantidade
    }), null),
    registrarAdicao: (corridaId, materialId, quantidade) => result(client().rpc("registrar_adicao_fusao", {
      p_corrida_id: corridaId, p_material_id: materialId, p_quantidade_kg: quantidade
    }), null),
    fecharCorrida: (corridaId, versao, fim) => result(client().rpc("fechar_corrida_fusao", { p_corrida_id: corridaId, p_versao: versao, p_fim: fim }), null),
    reabrirCorrida: (corridaId, versao) => result(client().rpc("reabrir_corrida_fusao", { p_corrida_id: corridaId, p_versao: versao }), null),
    excluirCorrida: (corridaId, versao) => result(client().rpc("excluir_corrida_fusao", { p_corrida_id: corridaId, p_versao: versao }), null),
    // Maior número já usado no ciclo (pra avisar o operador quando a
    // correção manual pula numeração — não conta a própria corrida). Nunca
    // fica abaixo do número inicial do ciclo (a numeração real já praticada
    // antes de o sistema existir, guardada no ciclo do refratário).
    maxNumeroSequenciaCiclo: async (cicloId, corridaId) => {
      const [maiorCorrida, ciclo] = await Promise.all([
        client().from("corridas_fusao").select("numero_sequencia").eq("ciclo_refratario_id", cicloId).neq("id", corridaId)
          .order("numero_sequencia", { ascending: false }).limit(1).maybeSingle(),
        client().from("ciclos_refratario_fusao").select("numero_sequencia_inicial").eq("id", cicloId).maybeSingle()
      ]);
      if (maiorCorrida.error) throw maiorCorrida.error;
      if (ciclo.error) throw ciclo.error;
      return Math.max(maiorCorrida.data?.numero_sequencia ?? 0, ciclo.data?.numero_sequencia_inicial ?? 0);
    },
    corrigirNumeroCorrida: (corridaId, novoNumero, motivo) => result(client().rpc("corrigir_numero_corrida_fusao", {
      p_corrida_id: corridaId, p_novo_numero: novoNumero, p_motivo: motivo
    }), null),
    atualizarTemperaturaProgramada: (corridaId, temperaturaC) => result(client().rpc("atualizar_temperatura_programada_fusao", {
      p_corrida_id: corridaId, p_temperatura_c: temperaturaC
    }), null),
    // Saída de panelas do Holding — uma linha por panela retirada.
    panelasDaCorrida: (corridaId) => result(client().from("panelas_holding")
      .select("id,sequencial,sequencial_vazamento,produto_id,hora_retirada,peso_kg,temperatura_c,carbono_equivalente,fesimg_liga1_kg,fesimg_liga4_kg,inoculante_kg,silicio_kg,grafite_kg,sucata_cobertura_kg,status,produtos(codigo,nome)")
      .eq("holding_corrida_id", corridaId).order("sequencial", { ascending: false })),
    criarPanelaHolding: (corridaId, pesoKg, horaRetirada, fesimgLiga1Kg, fesimgLiga4Kg) => result(client().rpc("criar_panela_holding", {
      p_holding_corrida_id: corridaId, p_peso_kg: pesoKg, p_hora_retirada: horaRetirada,
      p_fesimg_liga1_kg: fesimgLiga1Kg, p_fesimg_liga4_kg: fesimgLiga4Kg
    }), null),
    // Última panela válida (não rejeitada) desse Holding, de qualquer
    // corrida — usada só pra pré-preencher FeSiMg Liga 1/4 na hora de criar
    // uma panela nova (o resto dos campos herdados fica por conta da RPC).
    ultimaPanelaHolding: async (fornoId) => {
      const response = await client().from("panelas_holding")
        .select("fesimg_liga1_kg,fesimg_liga4_kg,corridas_fusao!holding_corrida_id!inner(forno_id)")
        .eq("corridas_fusao.forno_id", fornoId).neq("status", "REJEITADA")
        .order("criado_em", { ascending: false }).limit(1).maybeSingle();
      if (response.error) throw response.error;
      return response.data ?? null;
    },
    // Análise térmica do Holding — vale até a próxima, sem repetir a cada
    // panela; "última" é sempre a mais recente por forno.
    ultimaAnaliseTermicaHolding: (fornoId) => result(client().from("analises_termicas_holding")
      .select("carbono_equivalente,carbono,delta_t,temp_liquidus,temp_solidus,medido_em")
      .eq("forno_id", fornoId).order("medido_em", { ascending: false }).limit(1).maybeSingle(), null),
    // Últimas 5 análises térmicas completas (CE, Carbono, ΔT, Liquidus,
    // Solidus) — não só o CE isolado.
    ultimasAnalisesTermicasHolding: (fornoId, limite = 5) => result(client().from("analises_termicas_holding")
      .select("carbono_equivalente,carbono,delta_t,temp_liquidus,temp_solidus,medido_em")
      .eq("forno_id", fornoId).order("medido_em", { ascending: false }).limit(limite)),
    registrarAnaliseTermicaHolding: (fornoId, ce, carbono, deltaT, liquidus, solidus) => result(client().rpc("registrar_analise_termica_holding", {
      p_forno_id: fornoId, p_carbono_equivalente: ce, p_carbono: carbono,
      p_delta_t: deltaT, p_temp_liquidus: liquidus, p_temp_solidus: solidus
    }), null),
    atualizarCampoPanelaHolding: (panelaId, campo, valor) => result(client().rpc("atualizar_campo_panela_holding", {
      p_panela_id: panelaId, p_campo: campo, p_valor: valor
    }), null),
    atualizarHoraRetiradaPanelaHolding: (panelaId, horaRetirada) => result(client().rpc("atualizar_hora_retirada_panela_holding", {
      p_panela_id: panelaId, p_hora_retirada: horaRetirada
    }), null),
    // Fila do Vazamento — panelas que já saíram do Holding e ainda não
    // foram vazadas nem rejeitadas, mais antigas primeiro (FIFO).
    panelasAguardandoVazamento: () => result(client().from("panelas_holding")
      .select("id,sequencial,hora_retirada,peso_kg,temperatura_c,status,produto_id,produtos(codigo,nome)," +
        "carbono_equivalente_vazamento,carbono_vazamento,delta_t_vazamento,temp_liquidus_vazamento,temp_solidus_vazamento," +
        "temp_recalescencia_eutetica_vazamento,temp_final_vazamento,analise_vazamento_em," +
        "corridas_fusao!holding_corrida_id(codigo,forno_id,fornos_fusao(codigo,nome))")
      .in("status", ["SAIDA_HOLDING", "EM_TRANSITO"]).order("hora_retirada", { ascending: true })),
    apontarVazamentoPanela: (panelaId, inicioIso, fimIso, temperaturaC, moldeInicial, moldeFinal, inoculador, inoculanteGS) => result(client().rpc("apontar_vazamento_panela", {
      p_panela_id: panelaId, p_inicio: inicioIso, p_fim: fimIso, p_temperatura_c: temperaturaC,
      p_molde_inicial: moldeInicial, p_molde_final: moldeFinal,
      p_inoculador: inoculador, p_inoculante_g_s: inoculanteGS
    }), null),
    // Análise térmica do Vazamento — ação por panela (não "vale pra
    // frente"): o operador escolhe a linha da fila e o valor fica só ali,
    // pra não aparecer em panela nenhuma que não foi de fato analisada.
    registrarAnaliseTermicaPanelaVazamento: (panelaId, ce, carbono, deltaT, liquidus, solidus, recalescenciaEutetica, tempFinal) => result(client().rpc("registrar_analise_termica_panela_vazamento", {
      p_panela_id: panelaId, p_carbono_equivalente: ce, p_carbono: carbono, p_delta_t: deltaT,
      p_temp_liquidus: liquidus, p_temp_solidus: solidus,
      p_temp_recalescencia_eutetica: recalescenciaEutetica, p_temp_final: tempFinal
    }), null),
    atualizarProdutoPanelaHolding: (panelaId, produtoId) => result(client().rpc("atualizar_produto_panela_holding", {
      p_panela_id: panelaId, p_produto_id: produtoId
    }), null),
    rejeitarPanelaHolding: (panelaId, motivo) => result(client().rpc("rejeitar_panela_holding", {
      p_panela_id: panelaId, p_motivo: motivo
    }), null),
    registrarRetornoPanelaHolding: (panelaId, fornoDestinoId) => result(client().rpc("registrar_retorno_panela_holding", {
      p_panela_id: panelaId, p_forno_destino_id: fornoDestinoId
    }), null),
    // Rejeitadas ainda sem retorno registrado — aparecem na própria tela
    // do Vazamento pra o operador escolher o forno e confirmar.
    panelasRejeitadasAguardandoRetorno: () => result(client().from("panelas_holding")
      .select("id,sequencial,peso_kg,motivo_rejeicao,produtos(codigo,nome),corridas_fusao!holding_corrida_id(codigo,fornos_fusao(codigo,nome))")
      .eq("status", "REJEITADA").order("atualizado_em", { ascending: true })),
    // Histórico de quem já foi vazada — some da fila de espera, mas
    // precisa continuar visível pra quem só acessa a tela do Vazamento
    // (perfil restrito não entra no Holding nem na corrida).
    panelasVazadasRecentes: (limite = 20) => result(client().from("panelas_holding")
      .select("id,sequencial,sequencial_vazamento,peso_kg,hora_retirada,hora_inicio_vazamento,hora_fim_vazamento,molde_inicial,molde_final,quantidade_moldes," +
        "carbono_equivalente_vazamento,temp_liquidus_vazamento,temp_solidus_vazamento,temp_recalescencia_eutetica_vazamento,temp_final_vazamento,analise_vazamento_em," +
        "inoculador_vazamento,inoculante_vazamento_g_s,produtos(codigo,nome),corridas_fusao!holding_corrida_id(codigo,fornos_fusao(codigo,nome))")
      .eq("status", "VAZADA").order("hora_fim_vazamento", { ascending: false }).limit(limite)),
    // Metal de panela rejeitada ("Retorno Disa") que voltou pra este forno
    // — credita o saldo (volume_atual_forno_fusao) e também vira linha na
    // tabela de materiais, igual transferência. Escopado pela corrida
    // destino (não só pelo forno): o retorno só existe hoje com corrida
    // aberta no destino (mesma exigência da transferência), então dá pra
    // saber com certeza em qual card mostrar sem contar duas vezes (a
    // próxima corrida já nasce com esse valor embutido no peso inicial).
    panelasRetornadasParaCorrida: (corridaId) => result(client().from("panelas_holding")
      .select("id,sequencial,peso_kg,corridas_fusao!holding_corrida_id(codigo,fornos_fusao(codigo))")
      .eq("status", "RETORNADA").eq("retorno_corrida_destino_id", corridaId)),
    atualizarProduto: (corridaId, produtoId) => result(client().rpc("atualizar_produto_corrida_fusao", {
      p_corrida_id: corridaId, p_produto_id: produtoId
    }), null),
    // Escória/lingote (saídas, abatem no saldo do forno) e energia (só
    // acompanha a corrida) — valor único, atualizável quantas vezes precisar.
    atualizarSaidasDiversas: (corridaId, escoriaKg, lingoteKg, energiaKwh, ajusteKg) => result(client().rpc("atualizar_saidas_diversas_corrida_fusao", {
      p_corrida_id: corridaId, p_escoria_kg: escoriaKg, p_lingote_kg: lingoteKg, p_energia_kwh: energiaKwh, p_ajuste_kg: ajusteKg
    }), null),
    transferirMetal: (corridaOrigemId, fornoDestinoId, quantidade) => result(client().rpc("transferir_metal_fusao", {
      p_corrida_origem_id: corridaOrigemId, p_forno_destino_id: fornoDestinoId, p_quantidade_kg: quantidade
    }), null),
    editarTransferencia: (transferenciaId, quantidade) => result(client().rpc("editar_transferencia_fusao", {
      p_transferencia_id: transferenciaId, p_quantidade_kg: quantidade
    }), null),
    removerTransferencia: (transferenciaId) => result(client().rpc("remover_transferencia_fusao", {
      p_transferencia_id: transferenciaId
    }), null),
    // Histórico de alterações da carga (incluir/editar/excluir material) —
    // deixa o operador da Ponte ciente do que o supervisor mexeu.
    alteracoesDaCorrida: (corridaId) => result(client().from("corridas_fusao_alteracoes")
      .select("id,descricao,criado_em,usuarios(nome)")
      .eq("corrida_id", corridaId).order("criado_em", { ascending: false })),
    // Quadro de recados da corrida — comunicação entre quem planeja e quem
    // pesa na Ponte, nos dois sentidos.
    mensagensDaCorrida: (corridaId) => result(client().from("corridas_fusao_mensagens")
      .select("id,mensagem,criado_em,origem,usuarios(nome)")
      .eq("corrida_id", corridaId).order("criado_em")),
    enviarMensagemCorrida: (corridaId, mensagem, origem) => result(client().rpc("enviar_mensagem_corrida_fusao", {
      p_corrida_id: corridaId, p_mensagem: mensagem, p_origem: origem
    }), null),
    // Ponte: corridas abertas dos fornos de um carro (1 ou 2), com a carga
    // de cada uma — a tela agrupa por forno e mostra planejado × real.
    corridasAbertasPorCarro: async (carro) => {
      const response = await client().from("corridas_fusao")
        .select("id,codigo,forno_id,turno,produto_id,fornos_fusao!inner(nome,carro),produtos(codigo),corridas_fusao_carga_itens(id,material_id,quantidade_planejada_kg,quantidade_realizada_kg,estado_fisico,materiais_fusao(nome,tipo,modo_pesagem),corridas_fusao_pesagens_ponte_log(quantidade_kg,registrado_em,usuarios(nome))),corridas_fusao_mensagens(id,mensagem,criado_em,origem,usuarios(nome)),corridas_fusao_alteracoes(id,descricao,criado_em,usuarios(nome))")
        .eq("status", "ABERTA").eq("fornos_fusao.carro", carro)
        // Mesma ordem de inserção que o supervisor montou na carga (aço,
        // gusa, aço, gusa...) — não pode ficar mudando pro operador da ponte.
        .order("id", { foreignTable: "corridas_fusao_carga_itens" })
        // Histórico (pesagens/mensagens/alterações) limitado às últimas N —
        // isso recarrega a cada 15s, sem limite crescia sem parar ao longo
        // do turno. Mensagens em ordem decrescente pra pegar as últimas —
        // pontePreencherCorrida inverte de volta pra exibir mais antiga
        // primeiro (padrão de chat).
        .order("registrado_em", { foreignTable: "corridas_fusao_carga_itens.corridas_fusao_pesagens_ponte_log", ascending: false })
        .limit(10, { foreignTable: "corridas_fusao_carga_itens.corridas_fusao_pesagens_ponte_log" })
        .order("criado_em", { foreignTable: "corridas_fusao_mensagens", ascending: false })
        .limit(20, { foreignTable: "corridas_fusao_mensagens" })
        .order("criado_em", { foreignTable: "corridas_fusao_alteracoes", ascending: false })
        .limit(10, { foreignTable: "corridas_fusao_alteracoes" })
        .order("codigo");
      if (response.error) throw response.error;
      return response.data ?? [];
    }
  };
})(window);
