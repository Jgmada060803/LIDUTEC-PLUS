// Tela do Vazamento (etapa 7 do roadmap da Fusão) — fila de panelas
// aguardando + apontamento direto na linha da tabela. Reaproveita
// fEsc/fNumber/fusaoKg/fusaoState/fusaoCodigoCorridaMascarado/
// fusaoHoraAgora/fusaoMontarDataHora/fusaoProdutoComboboxHtml/
// bindProdutoCombobox/fusaoProdutoDoInput/fusaoProdutoTexto, todos globais
// em producao-fusao.js (carregado antes deste arquivo).
// Uma panela vaza até o início da próxima (ou até o lingotamento) — o
// operador não informa "Fim", só o Início; o servidor fecha sozinho a
// panela que estava em aberto. Início já vem preenchido com a hora
// atual (continua editável). Molde inicial/Inoculador/g-s sugerem os
// valores da ÚLTIMA PANELA VAZADA DO MESMO PRODUTO (histórico real, não
// memória da sessão) — pedido explícito: com só 1 panela por vez na
// fila, uma variável de sessão fica vazia assim que a panela some da
// lista e a próxima entra sem nenhuma referência.

// Colunas da fila hoje: Vazamento, Produto, Peso, Temp. origem, Início,
// Temp.(°C), Molde ini., Molde fim, Inoculador, g/s, ações — usado pro
// colspan das caixas de análise/devolução abaixo de cada panela.
const FUSAO_VAZAMENTO_FILA_COLUNAS = 12;

// Motivos de devolução — lista fechada (pedido explícito, era texto livre).
const FUSAO_MOTIVOS_REJEICAO = [
  "MÁQUINA PARADA",
  "COMPOSIÇÃO QUÍMICA FORA DO ESPECIFICADO",
  "TEMPERATURA BAIXA",
  "TEMPO DE FADING ESGOTADO"
];
// Lingotamento reaproveita os mesmos motivos da devolução, mais "Setup de
// metal" (pedido explícito).
const FUSAO_MOTIVOS_LINGOTAMENTO = [...FUSAO_MOTIVOS_REJEICAO, "SETUP DE METAL"];

// Análise térmica do Vazamento — ação por panela (pedido explícito: só
// aparece na panela onde foi de fato registrada, não "vale pra frente"
// pras seguintes). Fica numa segunda linha, escondida até clicar "+A.N".
function analisePanelaRowHtml(panela) {
  const jaTemAnalise = panela.analise_vazamento_em != null;
  const v = (valor) => valor != null ? fNumber(valor).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "";
  const campo = (nome, placeholder, valor) =>
    `<input name="${nome}" type="number" step="0.01" placeholder="${placeholder}" value="${v(valor)}">`;
  return `<tr class="fusao-vazamento-analise-row" data-panela-id="${panela.id}" hidden>
      <td colspan="${FUSAO_VAZAMENTO_FILA_COLUNAS}">
        <div class="fusao-item-row fusao-nova-analise-campos fusao-nova-analise-campos--vazamento">
          ${campo("ce", "CE", panela.carbono_equivalente_vazamento)}
          ${campo("carbono", "Carbono (%)", panela.carbono_vazamento)}
          ${campo("delta_t", "ΔT", panela.delta_t_vazamento)}
          ${campo("liquidus", "Liquidus (°C)", panela.temp_liquidus_vazamento)}
          ${campo("solidus", "Solidus (°C)", panela.temp_solidus_vazamento)}
          ${campo("recalescencia_eutetica", "Recalescência Eutética (°C)", panela.temp_recalescencia_eutetica_vazamento)}
          ${campo("temp_final", "Temp. Final (°C)", panela.temp_final_vazamento)}
          <button type="button" class="button button-primary" data-registrar-analise>${jaTemAnalise ? "Atualizar" : "Registrar"}</button>
        </div>
      </td>
    </tr>`;
}
function bindAnalisePanelaRow(tbody, panela) {
  const row = tbody.querySelector(`tr.fusao-vazamento-analise-row[data-panela-id="${panela.id}"]`);
  if (!row) return;
  const confirmar = row.querySelector("[data-registrar-analise]");
  confirmar.addEventListener("click", async () => {
    const valor = (nome) => {
      const texto = row.querySelector(`[name="${nome}"]`).value;
      return texto === "" ? null : Number(texto);
    };
    try {
      confirmar.disabled = true;
      await window.LIDUTEC_PRODUCAO_FUSAO_DATA.registrarAnaliseTermicaPanelaVazamento(
        panela.id, valor("ce"), valor("carbono"), valor("delta_t"), valor("liquidus"), valor("solidus"),
        valor("recalescencia_eutetica"), valor("temp_final")
      );
      await renderFilaVazamento();
    } catch (error) {
      alert(error.message);
    } finally {
      confirmar.disabled = false;
    }
  });
}
function toggleAnalisePanelaRow(tbody, panelaId) {
  const row = tbody.querySelector(`tr.fusao-vazamento-analise-row[data-panela-id="${panelaId}"]`);
  if (row) row.hidden = !row.hidden;
}

// Devolução — mesma ideia da caixa de análise térmica: escondida até
// clicar "Devolver", com o motivo (lista fechada) e a confirmação ali
// dentro, em vez de uma coluna fixa ocupando espaço na fila inteira.
function devolverPanelaRowHtml(panela) {
  return `<tr class="fusao-vazamento-devolver-row" data-panela-id="${panela.id}" hidden>
      <td colspan="${FUSAO_VAZAMENTO_FILA_COLUNAS}">
        <div class="fusao-item-row fusao-devolver-campos">
          <select name="motivo_rejeicao">
            <option value="">Selecione o motivo</option>
            ${FUSAO_MOTIVOS_REJEICAO.map((motivo) => `<option value="${fEsc(motivo)}">${fEsc(motivo)}</option>`).join("")}
          </select>
          <button type="button" class="button button-danger" data-confirmar-devolucao>Confirmar devolução</button>
        </div>
      </td>
    </tr>`;
}
function bindDevolverPanelaRow(tbody, panela) {
  const row = tbody.querySelector(`tr.fusao-vazamento-devolver-row[data-panela-id="${panela.id}"]`);
  if (!row) return;
  const confirmar = row.querySelector("[data-confirmar-devolucao]");
  confirmar.addEventListener("click", async () => {
    const motivo = row.querySelector('[name="motivo_rejeicao"]').value;
    if (!motivo) { alert("Selecione o motivo da devolução."); return; }
    try {
      confirmar.disabled = true;
      await window.LIDUTEC_PRODUCAO_FUSAO_DATA.rejeitarPanelaHolding(panela.id, motivo);
      await renderFilaVazamento();
    } catch (error) {
      alert(error.message);
      confirmar.disabled = false;
    }
  });
}
function toggleDevolverPanelaRow(tbody, panelaId) {
  const row = tbody.querySelector(`tr.fusao-vazamento-devolver-row[data-panela-id="${panelaId}"]`);
  if (row) row.hidden = !row.hidden;
}

// Produto da panela — editável (reaproveita o combobox de produto já
// existente); muda só esta panela, nunca a corrida do Holding.
function panelaProdutoCelHtml(panela) {
  const produto = panela.produtos;
  return `<span class="fusao-produto-editavel" data-produto-atual="${panela.produto_id ?? ""}">
      <strong class="fusao-produto-display">${fEsc(produto?.codigo || "—")}</strong>
      <button type="button" class="fusao-editable-toggle" title="Trocar produto">...</button>
    </span>`;
}
function bindPanelaProdutoEditavel(cell, panelaId, onSaved) {
  const el = cell.querySelector(".fusao-produto-editavel");
  if (!el || el.dataset.bound) return;
  el.dataset.bound = "1";
  const toggle = el.querySelector(".fusao-editable-toggle");
  toggle.dataset.mode = "editar";
  toggle.addEventListener("click", async () => {
    if (toggle.dataset.mode !== "salvar") {
      const produtoAtual = fusaoState.produtos.find((p) => p.id === Number(el.dataset.produtoAtual));
      el.querySelector(".fusao-produto-display").outerHTML = fusaoProdutoComboboxHtml(fusaoProdutoTexto(produtoAtual), "");
      bindProdutoCombobox(el.querySelector(".fusao-combobox"));
      toggle.dataset.mode = "salvar";
      toggle.textContent = "OK";
      toggle.title = "Salvar";
      return;
    }
    const input = el.querySelector(".fusao-produto-input");
    const produto = fusaoProdutoDoInput(input);
    if (!produto) { alert("Selecione um produto válido da lista."); return; }
    toggle.disabled = true; input.disabled = true;
    try {
      await window.LIDUTEC_PRODUCAO_FUSAO_DATA.atualizarProdutoPanelaHolding(panelaId, produto.id);
      // No histórico (onSaved informado), a linha inteira é redesenhada —
      // Nome produto, Material base e a cor da faixa de temperatura também
      // dependem do produto, não dá pra só trocar o código na hora.
      if (onSaved) { await onSaved(); return; }
      el.querySelector(".fusao-combobox").outerHTML = `<strong class="fusao-produto-display">${fEsc(produto.codigo)}</strong>`;
      toggle.dataset.mode = "editar";
      el.dataset.produtoAtual = String(produto.id);
      toggle.textContent = "...";
      toggle.title = "Trocar produto";
    } catch (error) {
      input.disabled = false;
      alert(error.message);
    } finally {
      toggle.disabled = false;
    }
  });
}

// Apontamento direto nas colunas da própria linha (pedido explícito — nada
// de janela/linha separada): início, fim, temperatura, molde inicial/final
// e CE medido (opcional, pré-preenchido com a última análise térmica do
// Vazamento) já ficam nas últimas colunas, com um botão "OK" só pra
// confirmar essa panela.
function filaRowHtml(panela, ehAPrimeira, ultimasVazadas) {
  const corridaCodigo = panela.corridas_fusao?.codigo;
  const kg1 = (valor) => valor != null ? fNumber(valor).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) : "—";
  // Referência = última panela vazada do MESMO produto (ultimasVazadas já
  // vem ordenada da mais recente pra mais antiga) — não a última vazada
  // de qualquer produto, senão sugeriria molde/inoculador errado quando
  // o produto muda de uma panela pra outra.
  const referencia = (ultimasVazadas || []).find((v) => v.produto_id === panela.produto_id);
  const moldeInicialSugerido = referencia?.molde_final != null ? referencia.molde_final + 1 : "";
  const opcaoSelecionada = (valor) => referencia?.inoculador_vazamento === valor ? " selected" : "";
  // Início sugerido = fim da última panela vazada (qualquer produto) + 1
  // minuto — pedido explícito. Só cai pra "agora" quando essa última
  // ainda está em aberto (sem fim ainda) e não tem o que sugerir.
  const ultimaQualquerProduto = (ultimasVazadas || [])[0];
  let inicioSugerido = fusaoHoraAgora();
  if (ultimaQualquerProduto?.hora_fim_vazamento) {
    const maisUmMinuto = new Date(ultimaQualquerProduto.hora_fim_vazamento);
    maisUmMinuto.setMinutes(maisUmMinuto.getMinutes() + 1);
    inicioSugerido = `${String(maisUmMinuto.getHours()).padStart(2, "0")}:${String(maisUmMinuto.getMinutes()).padStart(2, "0")}`;
  }
  // FIFO: a panela retirada mais cedo do Holding tem que ser vazada
  // primeiro — pedido explícito, reforçado também no servidor.
  const vazarDesabilitado = ehAPrimeira ? "" : ' disabled title="Vaze primeiro a panela mais antiga aguardando"';
  const horaTratamento = panela.hora_retirada
    ? new Date(panela.hora_retirada).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : "—";
  return `<tr data-panela-id="${panela.id}" data-data-operacional="${fusaoDataLocalDe(panela.hora_retirada)}">
      <td>${fEsc(fusaoIdentificacaoVazamento(corridaCodigo, panela.sequencial_vazamento))}</td>
      <td>${horaTratamento}</td>
      <td class="fusao-vazamento-produto-cel">${panelaProdutoCelHtml(panela)}</td>
      <td>${fusaoKg(panela.peso_kg)}</td>
      <td>${kg1(panela.temperatura_c)}</td>
      <td><input type="time" class="fusao-vazamento-input" name="inicio" value="${inicioSugerido}"></td>
      <td><input type="number" step="0.01" class="fusao-vazamento-input fusao-vazamento-input-num" name="temperatura"></td>
      <td><input type="number" step="1" class="fusao-vazamento-input fusao-vazamento-input-num" name="molde_inicial" value="${moldeInicialSugerido}"></td>
      <td><input type="number" step="1" class="fusao-vazamento-input fusao-vazamento-input-num" name="molde_final"></td>
      <td><select class="fusao-vazamento-input" name="inoculador">
        <option value=""${opcaoSelecionada("")}>—</option>
        <option value="MV01"${opcaoSelecionada("MV01")}>MV01</option>
        <option value="MV02"${opcaoSelecionada("MV02")}>MV02</option>
      </select></td>
      <td><input type="number" step="0.01" class="fusao-vazamento-input fusao-vazamento-input-num" name="inoculante_g_s" placeholder="g/s" value="${referencia?.inoculante_vazamento_g_s ?? ""}"></td>
      <td class="fusao-vazamento-acoes-cel">
        <button type="button" class="button button-primary" data-confirmar-vazamento${vazarDesabilitado}>Vazar</button>
        <button type="button" class="button button-danger" data-toggle-devolver>Devolver</button>
        <button type="button" class="button button-secondary" data-toggle-analise title="Análise térmica desta panela">+A.N</button>
      </td>
    </tr>${analisePanelaRowHtml(panela)}${devolverPanelaRowHtml(panela)}`;
}
function bindFilaRow(tbody, panela) {
  const row = tbody.querySelector(`tr[data-panela-id="${panela.id}"]`);
  if (!row) return;
  bindPanelaProdutoEditavel(row.querySelector(".fusao-vazamento-produto-cel"), panela.id);
  bindAnalisePanelaRow(tbody, panela);
  bindDevolverPanelaRow(tbody, panela);
  row.querySelector("[data-toggle-devolver]").addEventListener("click", () => toggleDevolverPanelaRow(tbody, panela.id));
  row.querySelector("[data-toggle-analise]").addEventListener("click", () => toggleAnalisePanelaRow(tbody, panela.id));
  const botao = row.querySelector("[data-confirmar-vazamento]");
  botao.addEventListener("click", async () => {
    const valor = (nome) => row.querySelector(`[name="${nome}"]`).value;
    try {
      const inicio = valor("inicio");
      const moldeInicial = valor("molde_inicial");
      const moldeFinal = valor("molde_final");
      if (!inicio || !moldeInicial || !moldeFinal) {
        throw new Error("Informe início e os moldes inicial/final.");
      }
      const temperatura = valor("temperatura");
      const inoculador = valor("inoculador");
      const inoculanteGS = valor("inoculante_g_s");
      const dataOperacional = row.dataset.dataOperacional;
      const inicioIso = fusaoMontarDataHora(dataOperacional, inicio);
      fusaoValidarHorarioNaoFuturo(inicioIso, "início do vazamento");
      botao.disabled = true;
      // "Vn" reinicia às 06:00, não à meia-noite — mesma regra do dia
      // operacional já usada nos turnos (window.LIDUTEC_TURNOS).
      const diaOperacionalVazamento = window.LIDUTEC_TURNOS.determineShift(new Date(inicioIso)).dataOperacional;
      await window.LIDUTEC_PRODUCAO_FUSAO_DATA.apontarVazamentoPanela(
        panela.id,
        inicioIso,
        temperatura === "" ? null : Number(temperatura),
        Number(moldeInicial), Number(moldeFinal),
        inoculador === "" ? null : inoculador,
        inoculanteGS === "" ? null : Number(inoculanteGS),
        diaOperacionalVazamento
      );
      await renderFilaVazamento();
      await renderPanelasVazadasRecentes();
      await atualizarSaldoNegativoFlutuante().catch(() => {});
    } catch (error) {
      alert(error.message);
      botao.disabled = false;
    }
  });
}
async function renderFilaVazamento() {
  const [panelas, ultimasVazadas] = await Promise.all([
    window.LIDUTEC_PRODUCAO_FUSAO_DATA.panelasAguardandoVazamento(),
    window.LIDUTEC_PRODUCAO_FUSAO_DATA.panelasVazadasRecentes(10)
  ]);
  const container = fq("#vazamento-fila");
  fq("#vazamento-vazio").hidden = panelas.length > 0;
  if (!panelas.length) { container.innerHTML = ""; return; }
  const totalPeso = panelas.reduce((soma, p) => soma + fNumber(p.peso_kg), 0);
  container.innerHTML = `<div class="table-wrapper"><table class="products-table fusao-vazamento-tabela">
      <thead><tr class="fusao-cabecalho-aguardando">
        <th>Vazamento</th><th>Hora tratamento</th><th>Produto</th>
        <th>Peso (kg)</th><th>Temp. origem</th>
        <th>Início</th><th>Temp. (°C)</th><th>Molde ini.</th><th>Molde fim</th><th>Inoculador</th><th>g/s</th><th></th>
      </tr></thead>
      <tbody>${panelas.map((panela, index) => filaRowHtml(panela, index === 0, ultimasVazadas)).join("")}</tbody>
      <tfoot><tr class="fusao-tabela-total-row">
        <td colspan="3"><strong>Total</strong></td>
        <td><strong>${fusaoKg(totalPeso)}</strong></td>
        <td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td>
      </tr></tfoot>
    </table></div>`;
  const tbody = container.querySelector("tbody");
  panelas.forEach((panela) => bindFilaRow(tbody, panela));
}
// Lingotamento (Etapa 9) — não é por panela, é por CICLO: o operador do
// Vazamento decide A HORA (quando um problema interrompe o ciclo
// contínuo de panelas se misturando na vazadora). O servidor calcula
// sozinho o peso teórico (enviado − consumo teórico desde o último
// lingotamento) e avisa a Fusão, que depois define forno/BLOCO e o peso
// real medido — isso aparece aqui só como histórico (leitura).
function lingotamentoRowHtml(lingotamento) {
  const hora = (v) => v ? new Date(v).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
  const definido = lingotamento.definido_em != null;
  return `<tr>
      <td>${hora(lingotamento.ciclo_inicio)}–${hora(lingotamento.ciclo_fim)}</td>
      <td>${fEsc(lingotamento.motivo || "—")}</td>
      <td>${fusaoKg(lingotamento.peso_teorico_kg)}</td>
      <td>${definido ? fusaoKg(lingotamento.peso_real_kg) : "—"}</td>
      <td>${definido ? fEsc(lingotamento.forno_destino_codigo || "BLOCO") : "Aguardando a Fusão"}</td>
    </tr>`;
}
async function iniciarLingotamento(container) {
  const botao = container.querySelector("[data-confirmar-lingotamento]");
  const horario = container.querySelector("#lingotamento-horario").value;
  const motivo = container.querySelector("#lingotamento-motivo").value;
  if (!horario) { alert("Informe o horário do lingotamento."); return; }
  if (!motivo) { alert("Selecione o motivo do lingotamento."); return; }
  const horarioIso = fusaoMontarDataHora(fusaoDataHojeLocal(), horario);
  try {
    fusaoValidarHorarioNaoFuturo(horarioIso, "lingotamento");
    botao.disabled = true;
    const resultado = await window.LIDUTEC_PRODUCAO_FUSAO_DATA.iniciarLingotamentoVazamento(horarioIso, motivo);
    const lingotamento = Array.isArray(resultado) ? resultado[0] : resultado;
    alert(`Lingotamento registrado — peso teórico enviado à Fusão: ${fusaoKg(lingotamento.peso_teorico_kg)} kg.`);
    await renderLingotamentoVazamento();
    await renderLingotamentoAcao();
    await atualizarSaldoNegativoFlutuante().catch(() => {});
  } catch (error) {
    alert(error.message);
    botao.disabled = false;
  }
}
// Alerta flutuante: se o consumo teórico (moldes × peso do cacho) superar
// o metal enviado desde o último lingotamento, o saldo teórico fica
// negativo — sinal de que pode haver panela(s) vazada(s) e não
// registrada(s) no sistema. Fica visível até o saldo voltar a ser >= 0.
async function atualizarSaldoNegativoFlutuante() {
  const painel = fq("#vazamento-saldo-negativo-flutuante");
  if (!painel) return;
  const [pendente] = await window.LIDUTEC_PRODUCAO_FUSAO_DATA.resumoLingotamentoPendente();
  const saldo = pendente ? fNumber(pendente.peso_enviado_kg) - fNumber(pendente.peso_consumido_teorico_kg) : 0;
  if (!pendente || saldo >= 0) { painel.hidden = true; return; }
  fq("#vazamento-saldo-negativo-flutuante-corpo").innerHTML =
    `<p>O consumo teórico (${fusaoKg(pendente.peso_consumido_teorico_kg)} kg) está maior que o metal enviado (${fusaoKg(pendente.peso_enviado_kg)} kg) desde o último lingotamento — déficit de ${fusaoKg(Math.abs(saldo))} kg.</p>
     <p>Isso pode indicar panela(s) vazada(s) e não registrada(s) no sistema. Verifique junto à Fusão.</p>`;
  painel.hidden = false;
}
// Botão em cima do histórico de vazadas (pedido explícito) — só abre a
// caixa de horário/motivo depois de clicado (mesmo padrão do "Devolver"),
// junto com um resumo do último lingotamento; a lista completa fica numa
// seção separada, abaixo do histórico.
async function renderLingotamentoAcao() {
  const container = fq("#vazamento-lingotar-acao");
  if (!container) return;
  const [[ultimo], [pendente]] = await Promise.all([
    window.LIDUTEC_PRODUCAO_FUSAO_DATA.lingotamentosRecentes(1),
    window.LIDUTEC_PRODUCAO_FUSAO_DATA.resumoLingotamentoPendente()
  ]);
  const hora = (v) => v ? new Date(v).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—";
  const resumoUltimo = !ultimo ? "" : ultimo.definido_em
    ? `Último: ${hora(ultimo.ciclo_fim)} — ${fusaoKg(ultimo.peso_real_kg)} kg → ${fEsc(ultimo.forno_destino_codigo || "BLOCO")}`
    : `Último: ${hora(ultimo.ciclo_fim)} — aguardando a Fusão`;
  // Prévia de quanto já acumulou desde o último lingotamento — ajuda o
  // operador a decidir a hora de lingotar (pedido explícito). Fica na mesma
  // linha do botão, mas em bloco separado (espaçado) do resumo do último.
  const toTon = (kg) => (kg / 1000).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const resumoPendente = pendente && pendente.quantidade_panelas > 0
    ? `Total de ${pendente.quantidade_panelas} panela${pendente.quantidade_panelas === 1 ? "" : "s"} desde o último lingotamento (${toTon(pendente.peso_enviado_kg)} ton) vs (${toTon(pendente.peso_consumido_teorico_kg)} ton) metal vazado = Saldo teórico (${toTon(Math.max(pendente.peso_enviado_kg - pendente.peso_consumido_teorico_kg, 0))} ton)`
    : "Nenhuma panela vazada desde o último lingotamento";
  container.innerHTML = `<div class="fusao-lingotar-campos">
      <button type="button" class="button button-danger" data-toggle-lingotar>Lingotar</button>
      ${resumoUltimo ? `<span class="fusao-lingotar-ultimo">${resumoUltimo}</span>` : ""}
      <span class="fusao-lingotar-pendente">${resumoPendente}</span>
    </div>
    <div class="fusao-lingotar-definicao" hidden>
      <label>Horário real do lingotamento<input type="time" id="lingotamento-horario" value="${fusaoHoraAgora()}"></label>
      <select id="lingotamento-motivo">
        <option value="">Selecione o motivo</option>
        ${FUSAO_MOTIVOS_LINGOTAMENTO.map((motivo) => `<option value="${fEsc(motivo)}">${fEsc(motivo)}</option>`).join("")}
      </select>
      <button type="button" class="button button-danger" data-confirmar-lingotamento>Confirmar lingotamento</button>
    </div>`;
  const caixa = container.querySelector(".fusao-lingotar-definicao");
  container.querySelector("[data-toggle-lingotar]").addEventListener("click", () => { caixa.hidden = !caixa.hidden; });
  container.querySelector("[data-confirmar-lingotamento]").addEventListener("click", () => iniciarLingotamento(container));
}
async function renderLingotamentoVazamento() {
  const container = fq("#vazamento-lingotamento");
  if (!container) return;
  const lingotamentos = await window.LIDUTEC_PRODUCAO_FUSAO_DATA.lingotamentosRecentes(10);
  if (!lingotamentos.length) { container.innerHTML = ""; return; }
  container.innerHTML = `<div class="panel-header"><h3>Lingotamentos recentes</h3></div>
    <div class="table-wrapper"><table class="products-table">
      <thead><tr class="fusao-cabecalho-historico"><th>Ciclo (início–fim)</th><th>Motivo</th><th>Peso teórico (kg)</th><th>Peso real (kg)</th><th>Forno destino</th></tr></thead>
      <tbody>${lingotamentos.map(lingotamentoRowHtml).join("")}</tbody>
    </table></div>`;
}
// Histórico de vazadas — some da fila assim que confirmada, então precisa
// continuar visível aqui (o perfil restrito do Vazamento não entra no
// Holding nem na corrida pra ver de outro jeito).
// Edição do histórico de panelas vazadas (pedido explícito) — reaproveita
// as mesmas classes de célula editável já usadas no Holding
// (.fusao-holding-campo-editavel/.fusao-editable-toggle), sem precisar de
// CSS novo pros campos simples.
function isoParaInputLocal(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function vazadaCampoNumericoHtml(panela, campo, valorExibido) {
  return `<span class="fusao-holding-campo-editavel" data-panela-id="${panela.id}" data-campo="${campo}">
      <span class="fusao-holding-campo-display" data-valor="${panela[campo] ?? ""}">${valorExibido}</span>
      <button type="button" class="fusao-editable-toggle" title="Editar">...</button>
    </span>`;
}
function vazadaMoldesCelHtml(panela) {
  return `<span class="fusao-holding-campo-editavel fusao-vazado-moldes-editavel" data-panela-id="${panela.id}">
      <span class="fusao-holding-campo-display">${panela.molde_inicial ?? "—"}–${panela.molde_final ?? "—"} (${panela.quantidade_moldes ?? "—"})</span>
      <button type="button" class="fusao-editable-toggle" title="Editar">...</button>
    </span>`;
}
function vazadaInoculadorCelHtml(panela) {
  const num = (v) => v != null ? fNumber(v).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "—";
  const texto = panela.inoculador_vazamento ? `${fEsc(panela.inoculador_vazamento)} (${num(panela.inoculante_vazamento_g_s)} g/s)` : "—";
  return `<span class="fusao-holding-campo-editavel fusao-vazado-inoculador-editavel" data-panela-id="${panela.id}">
      <span class="fusao-holding-campo-display">${texto}</span>
      <button type="button" class="fusao-editable-toggle" title="Editar">...</button>
    </span>`;
}
function vazadaHorarioCelHtml(panela, campo) {
  const iso = campo === "inicio" ? panela.hora_inicio_vazamento : panela.hora_fim_vazamento;
  const dataHora = (v) => v ? new Date(v).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
  // Fim só é editável depois de finalizado — enquanto em andamento, quem
  // fecha é a próxima panela (automático) ou o lingotamento.
  if (campo === "fim" && !iso) return `<span>Em andamento</span>`;
  return `<span class="fusao-holding-campo-editavel fusao-vazado-horario-editavel" data-panela-id="${panela.id}" data-campo="${campo}">
      <span class="fusao-holding-campo-display">${dataHora(iso)}</span>
      <button type="button" class="fusao-editable-toggle" title="Editar">...</button>
    </span>`;
}
function bindVazadaEdicao(tbody, panelas, onSaved) {
  const porId = new Map(panelas.map((p) => [p.id, p]));
  tbody.querySelectorAll(".fusao-holding-campo-editavel").forEach((cell) => {
    if (cell.dataset.bound) return;
    cell.dataset.bound = "1";
    const panelaId = Number(cell.dataset.panelaId);
    const panela = porId.get(panelaId);
    const toggle = cell.querySelector(".fusao-editable-toggle");
    const abrirEdicao = () => {
      toggle.dataset.mode = "salvar"; toggle.textContent = "OK"; toggle.title = "Salvar";
    };
    const executarComTratamentoErro = async (acao) => {
      try {
        toggle.disabled = true;
        cell.querySelectorAll("input, select").forEach((el) => { el.disabled = true; });
        await acao();
        await onSaved();
      } catch (error) {
        toggle.disabled = false;
        cell.querySelectorAll("input, select").forEach((el) => { el.disabled = false; });
        alert(error.message);
      }
    };
    if (cell.classList.contains("fusao-vazado-horario-editavel")) {
      // Vem antes da checagem genérica de "cell.dataset.campo" logo
      // abaixo — essa célula TAMBÉM tem data-campo ("inicio"/"fim"), então
      // sem essa ordem ela caía no branch numérico por engano (abria
      // input type="number" em vez de datetime-local).
      const campo = cell.dataset.campo;
      toggle.addEventListener("click", () => {
        if (toggle.dataset.mode !== "salvar") {
          const display = cell.querySelector(".fusao-holding-campo-display");
          const isoAtual = campo === "inicio" ? panela.hora_inicio_vazamento : panela.hora_fim_vazamento;
          display.outerHTML = `<input type="datetime-local" class="fusao-holding-campo-input" value="${isoParaInputLocal(isoAtual)}">`;
          abrirEdicao();
          cell.querySelector("input").focus();
          return;
        }
        const input = cell.querySelector("input");
        if (!input.value) { alert("Informe data e hora."); return; }
        const horarioIso = new Date(input.value).toISOString();
        executarComTratamentoErro(() => window.LIDUTEC_PRODUCAO_FUSAO_DATA.atualizarHorarioVazamentoPanela(panelaId, campo, horarioIso));
      });
    } else if (cell.dataset.campo) {
      // Campo numérico simples: temperatura_vazamento_c ou (via
      // vazadaCampoNumericoHtml) qualquer outro futuro campo.
      toggle.addEventListener("click", () => {
        if (toggle.dataset.mode !== "salvar") {
          const display = cell.querySelector(".fusao-holding-campo-display");
          display.outerHTML = `<input type="number" step="0.01" class="fusao-holding-campo-input" value="${display.dataset.valor}">`;
          abrirEdicao();
          cell.querySelector("input").focus();
          return;
        }
        const input = cell.querySelector("input");
        const novoValor = input.value === "" ? null : Number(input.value);
        executarComTratamentoErro(() => window.LIDUTEC_PRODUCAO_FUSAO_DATA.atualizarCampoVazamentoPanela(panelaId, cell.dataset.campo, novoValor));
      });
    } else if (cell.classList.contains("fusao-vazado-moldes-editavel")) {
      toggle.addEventListener("click", () => {
        if (toggle.dataset.mode !== "salvar") {
          const display = cell.querySelector(".fusao-holding-campo-display");
          display.outerHTML = `<span class="fusao-vazado-moldes-campos">
              <input type="number" step="1" class="fusao-holding-campo-input" placeholder="inicial" value="${panela.molde_inicial ?? ""}">
              <input type="number" step="1" class="fusao-holding-campo-input" placeholder="final" value="${panela.molde_final ?? ""}">
            </span>`;
          abrirEdicao();
          cell.querySelector("input").focus();
          return;
        }
        const [inicialInput, finalInput] = cell.querySelectorAll("input");
        const novoInicial = inicialInput.value === "" ? null : Number(inicialInput.value);
        const novoFinal = finalInput.value === "" ? null : Number(finalInput.value);
        executarComTratamentoErro(async () => {
          await window.LIDUTEC_PRODUCAO_FUSAO_DATA.atualizarCampoVazamentoPanela(panelaId, "molde_inicial", novoInicial);
          await window.LIDUTEC_PRODUCAO_FUSAO_DATA.atualizarCampoVazamentoPanela(panelaId, "molde_final", novoFinal);
        });
      });
    } else if (cell.classList.contains("fusao-vazado-inoculador-editavel")) {
      toggle.addEventListener("click", () => {
        if (toggle.dataset.mode !== "salvar") {
          const display = cell.querySelector(".fusao-holding-campo-display");
          const opcaoSelecionada = (v) => panela.inoculador_vazamento === v ? " selected" : "";
          display.outerHTML = `<span class="fusao-vazado-inoculador-campos">
              <select class="fusao-holding-campo-input">
                <option value=""${opcaoSelecionada("")}>—</option>
                <option value="MV01"${opcaoSelecionada("MV01")}>MV01</option>
                <option value="MV02"${opcaoSelecionada("MV02")}>MV02</option>
              </select>
              <input type="number" step="0.01" class="fusao-holding-campo-input" placeholder="g/s" value="${panela.inoculante_vazamento_g_s ?? ""}">
            </span>`;
          abrirEdicao();
          cell.querySelector("select").focus();
          return;
        }
        const select = cell.querySelector("select");
        const input = cell.querySelector("input");
        const novoInoculante = input.value === "" ? null : Number(input.value);
        executarComTratamentoErro(async () => {
          await window.LIDUTEC_PRODUCAO_FUSAO_DATA.atualizarInoculadorVazamentoPanela(panelaId, select.value);
          await window.LIDUTEC_PRODUCAO_FUSAO_DATA.atualizarCampoVazamentoPanela(panelaId, "inoculante_vazamento_g_s", novoInoculante);
        });
      });
    }
  });
}
function vazadaRowHtml(panela) {
  const corridaCodigo = panela.corridas_fusao?.codigo;
  const produto = panela.produtos;
  const identificacao = fusaoIdentificacaoVazamento(corridaCodigo, panela.sequencial_vazamento);
  const num = (v) => v != null ? fNumber(v).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "—";
  const dataHora = (v) => v ? new Date(v).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
  const minutosEntre = (a, b) => a && b ? Math.round((new Date(b) - new Date(a)) / 60000) : null;
  const turno = panela.hora_retirada ? window.LIDUTEC_TURNOS.determineShift(new Date(panela.hora_retirada)).nome : "—";
  const materialBase = fusaoLimparFerroBase(fusaoState.tipoMaterialPorProduto[panela.produto_id]);
  // TL/CE/TSE/TRE/TF só aparecem na panela onde a análise foi realmente
  // registrada — sem "herdar" da última análise feita em outra panela.
  const temAnalise = panela.analise_vazamento_em != null;
  const ce = temAnalise ? num(panela.carbono_equivalente_vazamento) : "—";
  const tl = temAnalise ? num(panela.temp_liquidus_vazamento) : "—";
  const tse = temAnalise ? num(panela.temp_solidus_vazamento) : "—";
  const tre = temAnalise ? num(panela.temp_recalescencia_eutetica_vazamento) : "—";
  const tf = temAnalise ? num(panela.temp_final_vazamento) : "—";
  const tempoAteInicio = minutosEntre(panela.hora_retirada, panela.hora_inicio_vazamento);
  const fading = minutosEntre(panela.hora_inicio_vazamento, panela.hora_fim_vazamento);
  // Sinal de tempo de vazamento — só pra Nodular (fading é crítico nele,
  // Cinzento não tem esse problema). Enquanto em andamento, verde/
  // amarelo/vermelho conforme o tempo já passado; depois de finalizado,
  // só mantém vermelho se passou de 15 min — senão volta ao normal.
  let classeTempo = "";
  if (materialBase.toLowerCase() === "nodular") {
    if (!panela.hora_fim_vazamento) {
      const emAndamentoMin = minutosEntre(panela.hora_inicio_vazamento, new Date().toISOString());
      if (emAndamentoMin != null) {
        classeTempo = emAndamentoMin < 10 ? "fusao-vazamento-tempo-verde"
          : emAndamentoMin <= 15 ? "fusao-vazamento-tempo-amarelo"
          : "fusao-vazamento-tempo-vermelho";
      }
    } else if (fading != null && fading > 15) {
      classeTempo = "fusao-vazamento-tempo-vermelho-texto";
    }
  }
  // Temperatura de vazamento vs faixa de liberação da ficha técnica
  // (parâmetro "Liberação Panela de Vazamento") — pedido explícito: até
  // 5°C do limite (dentro da faixa) = amarelo negrito; fora da faixa =
  // vermelho.
  let classeTemperatura = "";
  const limiteTemperatura = fusaoState.limiteTemperaturaVazamentoPorProduto?.[panela.produto_id];
  if (limiteTemperatura?.min != null && limiteTemperatura?.max != null && panela.temperatura_vazamento_c != null) {
    const valor = fNumber(panela.temperatura_vazamento_c);
    if (valor < limiteTemperatura.min || valor > limiteTemperatura.max) {
      classeTemperatura = "fusao-temp-vazamento-fora";
    } else if (valor - limiteTemperatura.min <= 5 || limiteTemperatura.max - valor <= 5) {
      classeTemperatura = "fusao-temp-vazamento-proximo";
    }
  }
  return `<tr class="${classeTempo}" data-panela-id="${panela.id}">
      <td>${fEsc(identificacao || "—")}</td>
      <td>${turno}</td>
      <td>${dataHora(panela.hora_retirada)}</td>
      <td class="fusao-vazamento-produto-cel">${panelaProdutoCelHtml(panela)}</td>
      <td>${fEsc(produto?.nome || "—")}</td>
      <td>${fEsc(materialBase)}</td>
      <td>${fusaoKg(panela.peso_kg)}</td>
      <td>${vazadaHorarioCelHtml(panela, "inicio")}</td>
      <td class="${classeTemperatura}">${vazadaCampoNumericoHtml(panela, "temperatura_vazamento_c", num(panela.temperatura_vazamento_c))}</td>
      <td>${tempoAteInicio != null ? `${tempoAteInicio} min` : "—"}</td>
      <td>${vazadaMoldesCelHtml(panela)}</td>
      <td>${vazadaInoculadorCelHtml(panela)}</td>
      <td>${vazadaHorarioCelHtml(panela, "fim")}</td>
      <td>${fading != null ? `${fading} min` : "—"}</td>
      <td>${tl}</td>
      <td>${ce}</td>
      <td>${tse}</td>
      <td>${tre}</td>
      <td>${tf}</td>
    </tr>`;
}
async function renderPanelasVazadasRecentes() {
  const panelas = await window.LIDUTEC_PRODUCAO_FUSAO_DATA.panelasVazadasRecentes(20);
  const container = fq("#vazamento-historico");
  if (!container) return;
  if (!panelas.length) { container.innerHTML = ""; return; }
  const totalPeso = panelas.reduce((soma, p) => soma + fNumber(p.peso_kg), 0);
  const totalMoldes = panelas.reduce((soma, p) => soma + fNumber(p.quantidade_moldes), 0);
  const cesComValor = panelas.filter((p) => p.analise_vazamento_em != null).map((p) => p.carbono_equivalente_vazamento).filter((v) => v != null);
  const mediaCe = cesComValor.length ? cesComValor.reduce((soma, v) => soma + fNumber(v), 0) / cesComValor.length : null;
  container.innerHTML = `<div class="panel-header"><h3>Histórico de panelas vazadas</h3></div>
    <div class="table-wrapper"><table class="products-table">
      <thead><tr class="fusao-cabecalho-historico">
        <th>Vazamento</th><th>Turno</th><th>Data/hora tratamento</th><th>Cód. produto</th><th>Nome produto</th><th>Material base</th><th>Peso tratado (kg)</th>
        <th>Data/hora início</th><th>Temp. vazamento (°C)</th><th>Tempo até início</th><th>Moldes (qtd)</th><th>Inoculador</th><th>Data/hora fim</th><th>Fading</th>
        <th>TL</th><th>CE</th><th>TSE</th><th>TRE</th><th>TF</th>
      </tr></thead>
      <tbody>${panelas.map(vazadaRowHtml).join("")}</tbody>
      <tfoot><tr class="fusao-tabela-total-row">
        <td colspan="6"><strong>Total / Média</strong></td>
        <td><strong>${fusaoKg(totalPeso)}</strong></td>
        <td></td><td></td>
        <td><strong>${totalMoldes}</strong></td>
        <td></td><td></td><td></td>
        <td></td>
        <td><strong>${mediaCe != null ? fNumber(mediaCe).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "—"}</strong></td>
        <td></td><td></td><td></td>
      </tr></tfoot>
    </table></div>`;
  const tbody = container.querySelector("tbody");
  bindVazadaEdicao(tbody, panelas, renderPanelasVazadasRecentes);
  panelas.forEach((p) => {
    const row = tbody.querySelector(`tr[data-panela-id="${p.id}"]`);
    bindPanelaProdutoEditavel(row.querySelector(".fusao-vazamento-produto-cel"), p.id, renderPanelasVazadasRecentes);
  });
}
// Histórico de panelas devolvidas — só leitura aqui (quem define o forno
// destino é a Fusão, no painel flutuante do planejamento); serve pra quem
// devolveu acompanhar se/pra onde já retornou.
function devolvidaRowHtml(panela) {
  const corridaCodigo = panela.corridas_fusao?.codigo;
  const fornoDestino = panela.fornos_fusao;
  const identificacao = fusaoIdentificacaoVazamento(corridaCodigo, null);
  const hora = (v) => v ? new Date(v).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
  return `<tr>
      <td>${fEsc(identificacao || "—")}</td>
      <td>${fEsc(panela.produtos?.codigo || "—")}</td>
      <td>${fusaoKg(panela.peso_kg)}</td>
      <td>${fEsc(panela.motivo_rejeicao || "—")}</td>
      <td>${panela.status === "RETORNADA" ? `Retornada — ${fEsc(fornoDestino?.codigo || "—")}` : "Aguardando definição"}</td>
      <td>${panela.status === "RETORNADA" ? hora(panela.atualizado_em) : "—"}</td>
    </tr>`;
}
async function renderPanelasDevolvidasRecentes() {
  const panelas = await window.LIDUTEC_PRODUCAO_FUSAO_DATA.panelasDevolvidasRecentes(20);
  const container = fq("#vazamento-devolvidas");
  if (!container) return;
  if (!panelas.length) { container.innerHTML = ""; return; }
  container.innerHTML = `<div class="panel-header"><h3>Panelas devolvidas</h3></div>
    <div class="table-wrapper"><table class="products-table">
      <thead><tr class="fusao-cabecalho-retirada">
        <th>Origem</th><th>Produto</th><th>Peso (kg)</th><th>Motivo</th><th>Status</th><th>Hora do retorno</th>
      </tr></thead>
      <tbody>${panelas.map(devolvidaRowHtml).join("")}</tbody>
    </table></div>`;
}
async function initializeFusaoVazamento() {
  await renderFilaVazamento();
  await renderLingotamentoAcao();
  await renderLingotamentoVazamento();
  await renderPanelasVazadasRecentes();
  await renderPanelasDevolvidasRecentes();
  const saldoNegativoPainel = fq("#vazamento-saldo-negativo-flutuante");
  if (saldoNegativoPainel) {
    fusaoTornarArrastavel(saldoNegativoPainel, fq("#vazamento-saldo-negativo-flutuante-header"));
    await atualizarSaldoNegativoFlutuante().catch(() => {});
    setInterval(() => { atualizarSaldoNegativoFlutuante().catch(() => {}); }, 20000);
  }
  // A fila é reconsultada de tempos em tempos (nova panela do Holding, ou
  // uma já apontada por outra pessoa) — mas nunca por cima de quem está
  // digitando um apontamento.
  setInterval(() => {
    const focoDentro = document.activeElement?.closest("#vazamento-fila");
    if (!focoDentro) renderFilaVazamento().catch(() => {});
  }, 20000);
  setInterval(() => { renderLingotamentoVazamento().catch(() => {}); }, 20000);
  // Mesma proteção da fila — não redesenha por cima de uma edição em
  // andamento no histórico (agora tem célula editável).
  setInterval(() => {
    const focoDentro = document.activeElement?.closest("#vazamento-historico");
    if (!focoDentro) renderPanelasVazadasRecentes().catch(() => {});
  }, 20000);
  setInterval(() => { renderPanelasDevolvidasRecentes().catch(() => {}); }, 20000);
}
window.initializeFusaoVazamento = initializeFusaoVazamento;
