// Histórico do Vazamento (consulta, com filtro) — pedido explícito
// separado da tela operacional do Vazamento, que só mostra as últimas 50
// panelas sem filtro nenhum. Reaproveita fEsc/fNumber/fusaoKg/fusaoState/
// fusaoIdentificacaoVazamento/fusaoProdutoComboboxHtml/bindProdutoCombobox/
// fusaoProdutoDoInput, todos globais em producao-fusao.js (carregado antes
// deste arquivo). Só consulta — edição continua na tela operacional.

function fusaoVazamentoHistoricoRowHtml(panela) {
  const corridaCodigo = panela.corridas_fusao?.codigo;
  const forno = panela.corridas_fusao?.fornos_fusao;
  const produto = panela.produtos;
  const identificacao = fusaoIdentificacaoVazamento(corridaCodigo, panela.sequencial_vazamento);
  const num = (v, casas = 2) => v != null ? fNumber(v).toLocaleString("pt-BR", { maximumFractionDigits: casas }) : "—";
  const dataHora = (v) => v ? new Date(v).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
  const turno = panela.hora_retirada ? window.LIDUTEC_TURNOS.determineShift(new Date(panela.hora_retirada)).nome : "—";
  const materialBase = fusaoLimparFerroBase(fusaoState.tipoMaterialPorProduto?.[panela.produto_id]);
  const temAnalise = panela.analise_vazamento_em != null;
  return `<tr>
      <td>${fEsc(identificacao || "—")}</td>
      <td>${fEsc(forno?.codigo || "—")}</td>
      <td>${turno}</td>
      <td>${fEsc(produto?.codigo || "—")}</td>
      <td>${fEsc(produto?.nome || "—")}</td>
      <td>${fEsc(materialBase)}</td>
      <td>${fusaoKg(panela.peso_kg)}</td>
      <td>${dataHora(panela.hora_inicio_vazamento)}</td>
      <td>${dataHora(panela.hora_fim_vazamento)}</td>
      <td>${num(panela.temperatura_vazamento_c, 0)}</td>
      <td>${panela.molde_inicial ?? "—"}–${panela.molde_final ?? "—"} (${panela.quantidade_moldes ?? "—"})</td>
      <td>${fEsc(panela.inoculador_vazamento || "—")}</td>
      <td>${temAnalise ? num(panela.temp_liquidus_vazamento) : "—"}</td>
      <td>${temAnalise ? num(panela.carbono_equivalente_vazamento) : "—"}</td>
      <td>${temAnalise ? num(panela.temp_solidus_vazamento) : "—"}</td>
      <td>${temAnalise ? num(panela.temp_recalescencia_eutetica_vazamento) : "—"}</td>
      <td>${temAnalise ? num(panela.temp_final_vazamento) : "—"}</td>
    </tr>`;
}

const FUSAO_VAZAMENTO_HISTORICO_TURNOS = { MANHA: "Manhã", TARDE: "Tarde", NOITE: "Noite" };

async function fusaoVazamentoHistoricoBuscar() {
  const container = fq("#vazamento-historico-resultado");
  container.innerHTML = `<p class="production-muted">Buscando...</p>`;

  const dataInicioInput = fq("#vazamento-historico-data-inicio").value;
  const dataFimInput = fq("#vazamento-historico-data-fim").value;
  const turnoSelecionado = fq("#vazamento-historico-turno").value;
  const produtoInput = fq("#vazamento-historico-produto-input");
  const produto = produtoInput ? fusaoProdutoDoInput(produtoInput) : null;
  const corridaBusca = fq("#vazamento-historico-corrida").value.trim().replace(/[^A-Za-z0-9]/g, "");

  const filtros = {};
  if (dataInicioInput) filtros.dataInicio = new Date(`${dataInicioInput}T00:00:00`).toISOString();
  // Fim é exclusivo (< dataFim) -- soma 1 dia pra incluir o dia inteiro escolhido.
  if (dataFimInput) filtros.dataFim = new Date(new Date(`${dataFimInput}T00:00:00`).getTime() + 86400000).toISOString();
  if (produto) filtros.produtoId = produto.id;
  if (corridaBusca) filtros.corridaBusca = corridaBusca;

  let panelas = await window.LIDUTEC_PRODUCAO_FUSAO_DATA.panelasVazadasHistorico(filtros);
  if (turnoSelecionado) {
    panelas = panelas.filter((p) => p.hora_retirada && window.LIDUTEC_TURNOS.determineShift(new Date(p.hora_retirada)).codigo === turnoSelecionado);
  }

  if (!panelas.length) {
    container.innerHTML = `<p class="production-muted">Nenhuma panela vazada encontrada para esse filtro.</p>`;
    return;
  }
  const totalPeso = panelas.reduce((soma, p) => soma + fNumber(p.peso_kg), 0);
  container.innerHTML = `<p class="production-muted">${panelas.length} panela(s) — ${fusaoKg(totalPeso)} no total${panelas.length >= 500 ? " (mostrando as 500 mais recentes do filtro; refine a busca pra ver o resto)" : ""}</p>
    <div class="table-wrapper"><table class="products-table">
      <thead><tr>
        <th>Vazamento</th><th>Forno</th><th>Turno</th><th>Cód. produto</th><th>Nome produto</th><th>Material base</th><th>Peso (kg)</th>
        <th>Início vazamento</th><th>Fim vazamento</th><th>Temp. (°C)</th><th>Moldes (ini.–fim / qtd)</th><th>Inoculador</th>
        <th>TL</th><th>CE</th><th>TSE</th><th>TRE</th><th>TF</th>
      </tr></thead>
      <tbody>${panelas.map(fusaoVazamentoHistoricoRowHtml).join("")}</tbody>
    </table></div>`;
}

async function initializeFusaoVazamentoHistorico() {
  const turnoSelect = fq("#vazamento-historico-turno");
  turnoSelect.innerHTML = `<option value="">Todos</option>` +
    Object.entries(FUSAO_VAZAMENTO_HISTORICO_TURNOS).map(([codigo, nome]) => `<option value="${codigo}">${nome}</option>`).join("");

  const produtoWrapper = fq("#vazamento-historico-produto");
  produtoWrapper.innerHTML = fusaoProdutoComboboxHtml("", `id="vazamento-historico-produto-input"`);
  bindProdutoCombobox(produtoWrapper);

  fq("#vazamento-historico-filtrar").addEventListener("click", () => fusaoVazamentoHistoricoBuscar());
  fq("#vazamento-historico-limpar").addEventListener("click", () => {
    fq("#vazamento-historico-data-inicio").value = "";
    fq("#vazamento-historico-data-fim").value = "";
    fq("#vazamento-historico-turno").value = "";
    fq("#vazamento-historico-corrida").value = "";
    fq("#vazamento-historico-produto-input").value = "";
    fusaoVazamentoHistoricoBuscar();
  });

  // Filtro inicial: mês corrente, igual ao Dashboard, pra não abrir a tela
  // já disparando uma busca de todo o histórico de uma vez.
  const hoje = new Date();
  fq("#vazamento-historico-data-inicio").value = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-01`;
  await fusaoVazamentoHistoricoBuscar();
}
window.initializeFusaoVazamentoHistorico = initializeFusaoVazamentoHistorico;
