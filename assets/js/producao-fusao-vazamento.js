// Tela do Vazamento (etapa 7 do roadmap da Fusão) — fila de panelas
// aguardando + apontamento direto na linha da tabela. Reaproveita
// fEsc/fNumber/fusaoKg/fusaoState/fusaoCodigoCorridaMascarado/
// fusaoHoraAgora/fusaoMontarDataHora/fusaoProdutoComboboxHtml/
// bindProdutoCombobox/fusaoProdutoDoInput/fusaoProdutoTexto, todos globais
// em producao-fusao.js (carregado antes deste arquivo).
// Continuidade do vazamento: o fim de uma panela (ou o horário de uma
// devolução) vira a sugestão de início da próxima — pedido explícito, pra
// não redigitar a mesma hora toda vez. Início/Fim começam vazios; só essa
// sugestão pré-preenche o Início (continua editável).
let fusaoUltimoFimVazamento = null;

// Análise térmica do Vazamento — mesmo modelo da do Holding (vale até a
// próxima, sem repetir a cada panela); aqui não tem forno, é uma estação
// só. O CE dela vira o padrão pré-preenchido no "CE medido" de cada
// panela, editável antes de confirmar o apontamento.
function analiseTermicaVazamentoResumoHtml(analise) {
  if (!analise) return `<p class="production-muted fusao-holding-analise-resumo">Nenhuma análise térmica do Vazamento registrada ainda.</p>`;
  const v = (valor) => valor != null ? fNumber(valor).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "—";
  const hora = new Date(analise.medido_em).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  return `<p class="fusao-holding-analise-resumo">Última análise térmica do Vazamento (${hora}): CE ${v(analise.carbono_equivalente)} · C ${v(analise.carbono)}% · ΔT ${v(analise.delta_t)} · Liquidus ${v(analise.temp_liquidus)} °C · Solidus ${v(analise.temp_solidus)} °C</p>`;
}
function criarLinhaNovaAnaliseVazamento(onRegistrada) {
  const row = document.createElement("div");
  row.className = "fusao-item-row fusao-nova-analise-campos";
  row.innerHTML = `<input name="ce" type="number" step="0.01" placeholder="CE">
    <input name="carbono" type="number" step="0.01" placeholder="Carbono (%)">
    <input name="delta_t" type="number" step="0.01" placeholder="ΔT">
    <input name="liquidus" type="number" step="0.01" placeholder="Liquidus (°C)">
    <input name="solidus" type="number" step="0.01" placeholder="Solidus (°C)">
    <button type="button" class="button button-primary">Registrar</button>`;
  const confirmar = row.querySelector("button");
  confirmar.addEventListener("click", async () => {
    const valor = (nome) => {
      const texto = row.querySelector(`[name="${nome}"]`).value;
      return texto === "" ? null : Number(texto);
    };
    try {
      confirmar.disabled = true;
      await window.LIDUTEC_PRODUCAO_FUSAO_DATA.registrarAnaliseTermicaVazamento(
        valor("ce"), valor("carbono"), valor("delta_t"), valor("liquidus"), valor("solidus")
      );
      await onRegistrada();
    } catch (error) {
      alert(error.message);
    } finally {
      confirmar.disabled = false;
    }
  });
  return row;
}
async function renderAnaliseTermicaVazamento() {
  const analise = await window.LIDUTEC_PRODUCAO_FUSAO_DATA.ultimaAnaliseTermicaVazamento();
  const container = fq("#vazamento-analise");
  container.innerHTML = `
    ${analiseTermicaVazamentoResumoHtml(analise)}
    <button type="button" class="button button-secondary" data-toggle-nova-analise-vazamento>+ Nova análise térmica</button>
    <div class="fusao-nova-analise-row" hidden></div>
  `;
  const rowsContainer = container.querySelector(".fusao-nova-analise-row");
  container.querySelector("[data-toggle-nova-analise-vazamento]").addEventListener("click", () => {
    if (rowsContainer.hidden) {
      rowsContainer.hidden = false;
      rowsContainer.innerHTML = "";
      rowsContainer.appendChild(criarLinhaNovaAnaliseVazamento(async () => { await renderAnaliseTermicaVazamento(); }));
    } else {
      rowsContainer.hidden = true;
    }
  });
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
function bindPanelaProdutoEditavel(cell, panelaId) {
  const el = cell.querySelector(".fusao-produto-editavel");
  if (!el || el.dataset.bound) return;
  el.dataset.bound = "1";
  const toggle = el.querySelector(".fusao-editable-toggle");
  toggle.dataset.mode = "editar";
  toggle.addEventListener("click", async () => {
    if (toggle.dataset.mode !== "salvar") {
      const produtoAtual = fusaoState.produtos.find((p) => p.id === Number(toggle.dataset.produtoAtual));
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
      el.querySelector(".fusao-combobox").outerHTML = `<strong class="fusao-produto-display">${fEsc(produto.codigo)}</strong>`;
      toggle.dataset.mode = "editar";
      toggle.dataset.produtoAtual = String(produto.id);
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
function filaRowHtml(panela) {
  const corridaCodigo = panela.corridas_fusao?.codigo;
  const kg1 = (valor) => valor != null ? fNumber(valor).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) : "—";
  const ceValor = panela.carbono_equivalente != null ? fNumber(panela.carbono_equivalente).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "—";
  const ceCelula = panela.ce_medido_nesta_panela
    ? `<strong title="CE medido nesta panela">${ceValor}*</strong>` : ceValor;
  return `<tr data-panela-id="${panela.id}" data-data-operacional="${panela.hora_retirada.slice(0, 10)}">
      <td>${fEsc(fusaoIdentificacaoVazamento(corridaCodigo, panela.sequencial_vazamento))}</td>
      <td class="fusao-vazamento-produto-cel">${panelaProdutoCelHtml(panela)}</td>
      <td>${fusaoKg(panela.peso_kg)}</td>
      <td>${kg1(panela.temperatura_c)}</td>
      <td>${ceCelula}</td>
      <td><input type="time" class="fusao-vazamento-input" name="inicio" value="${fusaoUltimoFimVazamento ?? ""}"></td>
      <td><input type="time" class="fusao-vazamento-input" name="fim"></td>
      <td><input type="number" step="0.01" class="fusao-vazamento-input fusao-vazamento-input-num" name="temperatura"></td>
      <td><input type="number" step="1" class="fusao-vazamento-input fusao-vazamento-input-num" name="molde_inicial"></td>
      <td><input type="number" step="1" class="fusao-vazamento-input fusao-vazamento-input-num" name="molde_final"></td>
      <td><input type="number" step="0.01" class="fusao-vazamento-input fusao-vazamento-input-num" name="ce" placeholder="—"></td>
      <td class="fusao-vazamento-acoes-cel">
        <button type="button" class="button button-primary" data-confirmar-vazamento>Vazar</button>
        <button type="button" class="button button-danger" data-rejeitar-panela>Devolver</button>
      </td>
    </tr>`;
}
function bindFilaRow(tbody, panela) {
  const row = tbody.querySelector(`tr[data-panela-id="${panela.id}"]`);
  if (!row) return;
  bindPanelaProdutoEditavel(row.querySelector(".fusao-vazamento-produto-cel"), panela.id);
  const botao = row.querySelector("[data-confirmar-vazamento]");
  botao.addEventListener("click", async () => {
    const valor = (nome) => row.querySelector(`[name="${nome}"]`).value;
    try {
      const inicio = valor("inicio");
      const fim = valor("fim");
      const moldeInicial = valor("molde_inicial");
      const moldeFinal = valor("molde_final");
      if (!inicio || !fim || !moldeInicial || !moldeFinal) {
        throw new Error("Informe início, fim e os moldes inicial/final.");
      }
      const temperatura = valor("temperatura");
      const ce = valor("ce");
      botao.disabled = true;
      const dataOperacional = row.dataset.dataOperacional;
      await window.LIDUTEC_PRODUCAO_FUSAO_DATA.apontarVazamentoPanela(
        panela.id,
        fusaoMontarDataHora(dataOperacional, inicio),
        fusaoMontarDataHora(dataOperacional, fim),
        temperatura === "" ? null : Number(temperatura),
        Number(moldeInicial), Number(moldeFinal),
        ce === "" ? null : Number(ce)
      );
      fusaoUltimoFimVazamento = fim;
      await renderFilaVazamento();
      await renderPanelasVazadasRecentes();
    } catch (error) {
      alert(error.message);
      botao.disabled = false;
    }
  });
  const rejeitar = row.querySelector("[data-rejeitar-panela]");
  rejeitar.addEventListener("click", async () => {
    const motivo = prompt("Motivo da rejeição:", "");
    if (motivo === null) return;
    if (!motivo.trim()) { alert("Informe o motivo da rejeição."); return; }
    try {
      rejeitar.disabled = true;
      await window.LIDUTEC_PRODUCAO_FUSAO_DATA.rejeitarPanelaHolding(panela.id, motivo.trim());
      fusaoUltimoFimVazamento = fusaoHoraAgora();
      await renderFilaVazamento();
      await renderRejeitadasAguardandoRetorno();
    } catch (error) {
      alert(error.message);
      rejeitar.disabled = false;
    }
  });
}
async function renderFilaVazamento() {
  const panelas = await window.LIDUTEC_PRODUCAO_FUSAO_DATA.panelasAguardandoVazamento();
  const container = fq("#vazamento-fila");
  fq("#vazamento-vazio").hidden = panelas.length > 0;
  if (!panelas.length) { container.innerHTML = ""; return; }
  const totalPeso = panelas.reduce((soma, p) => soma + fNumber(p.peso_kg), 0);
  container.innerHTML = `<div class="table-wrapper"><table class="products-table fusao-vazamento-tabela">
      <thead><tr class="fusao-cabecalho-retirada">
        <th>Vazamento</th><th>Produto</th>
        <th>Peso (kg)</th><th>Temp. origem</th><th>Último CE</th>
        <th>Início</th><th>Fim</th><th>Temp. (°C)</th><th>Molde ini.</th><th>Molde fim</th><th>CE medido</th><th></th>
      </tr></thead>
      <tbody>${panelas.map(filaRowHtml).join("")}</tbody>
      <tfoot><tr class="fusao-tabela-total-row">
        <td colspan="2"><strong>Total</strong></td>
        <td><strong>${fusaoKg(totalPeso)}</strong></td>
        <td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td>
      </tr></tfoot>
    </table></div>`;
  const tbody = container.querySelector("tbody");
  panelas.forEach((panela) => bindFilaRow(tbody, panela));
}
// Panelas rejeitadas aguardando retorno — a tabela em si (linha, bind e
// render) agora mora em producao-fusao.js (fusaoRenderRejeitadasAguardandoRetorno),
// reaproveitada também pelo painel flutuante do planejamento (índice).
async function renderRejeitadasAguardandoRetorno() {
  await fusaoRenderRejeitadasAguardandoRetorno("#vazamento-rejeitadas");
}
// Histórico de vazadas — some da fila assim que confirmada, então precisa
// continuar visível aqui (o perfil restrito do Vazamento não entra no
// Holding nem na corrida pra ver de outro jeito).
function vazadaRowHtml(panela) {
  const corridaCodigo = panela.corridas_fusao?.codigo;
  const produto = panela.produtos;
  const identificacao = fusaoIdentificacaoVazamento(corridaCodigo, panela.sequencial_vazamento);
  const ceValor = panela.carbono_equivalente != null ? fNumber(panela.carbono_equivalente).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "—";
  const ce = panela.ce_medido_nesta_panela ? `${ceValor}*` : ceValor;
  const hora = (v) => v ? new Date(v).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—";
  return `<tr>
      <td>${fEsc(identificacao || "—")}</td>
      <td>${fEsc(produto?.codigo || "—")}</td>
      <td>${fusaoKg(panela.peso_kg)}</td>
      <td>${hora(panela.hora_inicio_vazamento)}–${hora(panela.hora_fim_vazamento)}</td>
      <td>${panela.molde_inicial ?? "—"}–${panela.molde_final ?? "—"} (${panela.quantidade_moldes ?? "—"})</td>
      <td>${ce}</td>
    </tr>`;
}
async function renderPanelasVazadasRecentes() {
  const panelas = await window.LIDUTEC_PRODUCAO_FUSAO_DATA.panelasVazadasRecentes(20);
  const container = fq("#vazamento-historico");
  if (!container) return;
  if (!panelas.length) { container.innerHTML = ""; return; }
  const totalPeso = panelas.reduce((soma, p) => soma + fNumber(p.peso_kg), 0);
  const totalMoldes = panelas.reduce((soma, p) => soma + fNumber(p.quantidade_moldes), 0);
  const cesComValor = panelas.map((p) => p.carbono_equivalente).filter((v) => v != null);
  const mediaCe = cesComValor.length ? cesComValor.reduce((soma, v) => soma + fNumber(v), 0) / cesComValor.length : null;
  container.innerHTML = `<div class="panel-header"><h3>Histórico de panelas vazadas</h3></div>
    <div class="table-wrapper"><table class="products-table">
      <thead><tr class="fusao-cabecalho-retirada">
        <th>Vazamento</th><th>Produto</th><th>Peso (kg)</th><th>Início–Fim</th><th>Moldes (qtd)</th><th>CE</th>
      </tr></thead>
      <tbody>${panelas.map(vazadaRowHtml).join("")}</tbody>
      <tfoot><tr class="fusao-tabela-total-row">
        <td colspan="2"><strong>Total / Média</strong></td>
        <td><strong>${fusaoKg(totalPeso)}</strong></td>
        <td></td>
        <td><strong>${totalMoldes}</strong></td>
        <td><strong>${mediaCe != null ? fNumber(mediaCe).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "—"}</strong></td>
      </tr></tfoot>
    </table></div>`;
}
async function initializeFusaoVazamento() {
  await renderAnaliseTermicaVazamento();
  await renderFilaVazamento();
  await renderRejeitadasAguardandoRetorno();
  await renderPanelasVazadasRecentes();
  // A fila é reconsultada de tempos em tempos (nova panela do Holding, ou
  // uma já apontada por outra pessoa) — mas nunca por cima de quem está
  // digitando um apontamento.
  setInterval(() => {
    const focoDentro = document.activeElement?.closest("#vazamento-fila");
    if (!focoDentro) renderFilaVazamento().catch(() => {});
  }, 20000);
  setInterval(() => {
    const focoDentro = document.activeElement?.closest("#vazamento-rejeitadas");
    if (!focoDentro) renderRejeitadasAguardandoRetorno().catch(() => {});
  }, 20000);
  setInterval(() => { renderPanelasVazadasRecentes().catch(() => {}); }, 20000);
}
window.initializeFusaoVazamento = initializeFusaoVazamento;
