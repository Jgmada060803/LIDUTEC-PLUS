// Tela do Vazamento (etapa 7 do roadmap da Fusão) — fila de panelas
// aguardando + apontamento direto na linha da tabela. Reaproveita
// fEsc/fNumber/fusaoKg/fusaoState/fusaoCodigoCorridaMascarado/
// fusaoHoraAgora/fusaoMontarDataHora/fusaoProdutoComboboxHtml/
// bindProdutoCombobox/fusaoProdutoDoInput/fusaoProdutoTexto, todos globais
// em producao-fusao.js (carregado antes deste arquivo).
// Continuidade do vazamento: o fim de uma panela (ou o horário de uma
// devolução) vira a sugestão de início da próxima — pedido explícito, pra
// não redigitar a mesma hora toda vez. Início/Fim começam vazios; só essa
// sugestão pré-preenche o Início (continua editável). O molde inicial da
// próxima sugere o final da anterior + 1, e o inoculador lembra a última
// escolha — tudo editável, só reduz redigitação.
let fusaoUltimoFimVazamento = null;
let fusaoUltimoMoldeFinal = null;
let fusaoUltimoInoculador = null;

// Colunas da fila hoje (sem o "+A.N"): Vazamento, Produto, Peso, Temp.
// origem, Início, Fim, Temp.(°C), Molde ini., Molde fim, Inoculador,
// g/s — usado pro colspan da linha de análise abaixo de cada panela.
const FUSAO_VAZAMENTO_FILA_COLUNAS = 12;

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
  const moldeInicialSugerido = fusaoUltimoMoldeFinal != null ? fusaoUltimoMoldeFinal + 1 : "";
  const opcaoSelecionada = (valor) => fusaoUltimoInoculador === valor ? " selected" : "";
  return `<tr data-panela-id="${panela.id}" data-data-operacional="${panela.hora_retirada.slice(0, 10)}">
      <td>${fEsc(fusaoIdentificacaoVazamento(corridaCodigo, panela.sequencial_vazamento))}</td>
      <td class="fusao-vazamento-produto-cel">${panelaProdutoCelHtml(panela)}</td>
      <td>${fusaoKg(panela.peso_kg)}</td>
      <td>${kg1(panela.temperatura_c)}</td>
      <td><input type="time" class="fusao-vazamento-input" name="inicio" value="${fusaoUltimoFimVazamento ?? ""}"></td>
      <td><input type="time" class="fusao-vazamento-input" name="fim"></td>
      <td><input type="number" step="0.01" class="fusao-vazamento-input fusao-vazamento-input-num" name="temperatura"></td>
      <td><input type="number" step="1" class="fusao-vazamento-input fusao-vazamento-input-num" name="molde_inicial" value="${moldeInicialSugerido}"></td>
      <td><input type="number" step="1" class="fusao-vazamento-input fusao-vazamento-input-num" name="molde_final"></td>
      <td><select class="fusao-vazamento-input" name="inoculador">
        <option value=""${opcaoSelecionada("")}>—</option>
        <option value="MV01"${opcaoSelecionada("MV01")}>MV01</option>
        <option value="MV02"${opcaoSelecionada("MV02")}>MV02</option>
      </select></td>
      <td><input type="number" step="0.01" class="fusao-vazamento-input fusao-vazamento-input-num" name="inoculante_g_s" placeholder="g/s"></td>
      <td class="fusao-vazamento-acoes-cel">
        <button type="button" class="button button-primary" data-confirmar-vazamento>Vazar</button>
        <button type="button" class="button button-danger" data-rejeitar-panela>Devolver</button>
        <button type="button" class="button button-secondary" data-toggle-analise title="Análise térmica desta panela">+A.N</button>
      </td>
    </tr>${analisePanelaRowHtml(panela)}`;
}
function bindFilaRow(tbody, panela) {
  const row = tbody.querySelector(`tr[data-panela-id="${panela.id}"]`);
  if (!row) return;
  bindPanelaProdutoEditavel(row.querySelector(".fusao-vazamento-produto-cel"), panela.id);
  bindAnalisePanelaRow(tbody, panela);
  row.querySelector("[data-toggle-analise]").addEventListener("click", () => toggleAnalisePanelaRow(tbody, panela.id));
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
      const inoculador = valor("inoculador");
      const inoculanteGS = valor("inoculante_g_s");
      botao.disabled = true;
      const dataOperacional = row.dataset.dataOperacional;
      await window.LIDUTEC_PRODUCAO_FUSAO_DATA.apontarVazamentoPanela(
        panela.id,
        fusaoMontarDataHora(dataOperacional, inicio),
        fusaoMontarDataHora(dataOperacional, fim),
        temperatura === "" ? null : Number(temperatura),
        Number(moldeInicial), Number(moldeFinal),
        inoculador === "" ? null : inoculador,
        inoculanteGS === "" ? null : Number(inoculanteGS)
      );
      fusaoUltimoFimVazamento = fim;
      fusaoUltimoMoldeFinal = Number(moldeFinal);
      fusaoUltimoInoculador = inoculador === "" ? null : inoculador;
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
      <thead><tr class="fusao-cabecalho-aguardando">
        <th>Vazamento</th><th>Produto</th>
        <th>Peso (kg)</th><th>Temp. origem</th>
        <th>Início</th><th>Fim</th><th>Temp. (°C)</th><th>Molde ini.</th><th>Molde fim</th><th>Inoculador</th><th>g/s</th><th></th>
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
  const forno = panela.corridas_fusao?.fornos_fusao;
  const produto = panela.produtos;
  const identificacao = fusaoIdentificacaoVazamento(corridaCodigo, panela.sequencial_vazamento);
  const num = (v) => v != null ? fNumber(v).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "—";
  const hora = (v) => v ? new Date(v).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—";
  const inoculador = panela.inoculador_vazamento
    ? `${fEsc(panela.inoculador_vazamento)} (${num(panela.inoculante_vazamento_g_s)} g/s)` : "—";
  // TL/CE/TSE/TRE/TF só aparecem na panela onde a análise foi realmente
  // registrada — sem "herdar" da última análise feita em outra panela.
  const temAnalise = panela.analise_vazamento_em != null;
  const ce = temAnalise ? num(panela.carbono_equivalente_vazamento) : "—";
  const tl = temAnalise ? num(panela.temp_liquidus_vazamento) : "—";
  const tse = temAnalise ? num(panela.temp_solidus_vazamento) : "—";
  const tre = temAnalise ? num(panela.temp_recalescencia_eutetica_vazamento) : "—";
  const tf = temAnalise ? num(panela.temp_final_vazamento) : "—";
  return `<tr>
      <td>${fEsc(identificacao || "—")}</td>
      <td>${fEsc(forno?.codigo || "—")}</td>
      <td>${hora(panela.hora_retirada)}</td>
      <td>${fEsc(produto?.codigo || "—")}</td>
      <td>${fusaoKg(panela.peso_kg)}</td>
      <td>${hora(panela.hora_inicio_vazamento)}–${hora(panela.hora_fim_vazamento)}</td>
      <td>${panela.molde_inicial ?? "—"}–${panela.molde_final ?? "—"} (${panela.quantidade_moldes ?? "—"})</td>
      <td>${inoculador}</td>
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
        <th>Vazamento</th><th>Forno</th><th>Hora tratamento</th><th>Produto</th><th>Peso (kg)</th><th>Início–Fim</th><th>Moldes (qtd)</th>
        <th>Inoculador</th><th>TL</th><th>CE</th><th>TSE</th><th>TRE</th><th>TF</th>
      </tr></thead>
      <tbody>${panelas.map(vazadaRowHtml).join("")}</tbody>
      <tfoot><tr class="fusao-tabela-total-row">
        <td colspan="4"><strong>Total / Média</strong></td>
        <td><strong>${fusaoKg(totalPeso)}</strong></td>
        <td></td>
        <td><strong>${totalMoldes}</strong></td>
        <td></td><td></td>
        <td><strong>${mediaCe != null ? fNumber(mediaCe).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "—"}</strong></td>
        <td></td><td></td><td></td>
      </tr></tfoot>
    </table></div>`;
}
async function initializeFusaoVazamento() {
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
