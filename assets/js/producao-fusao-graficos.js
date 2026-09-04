// Dashboard mensal da Fusão (Parte A: KPIs + composição da carga).
// Reaproveita fusaoState/fEsc/fNumber/fusaoKg/fusaoLimparFerroBase,
// globais em producao-fusao.js (carregado antes deste arquivo).

const FUSAO_MATERIAL_TIPO_LABEL = {
  GUSA: "Gusa", SUCATA: "Sucata", ALTERNATIVO: "Alternativos",
  LIGA_CORRECAO: "Ligas em geral", RETORNO: "Retorno", OUTRO: "Outros"
};
const FUSAO_MATERIAL_TIPO_COR = {
  GUSA: "#f0932b", SUCATA: "#7f8c8d", ALTERNATIVO: "#c0392b",
  LIGA_CORRECAO: "#8e44ad", RETORNO: "#185abd", OUTRO: "#b0b0b0"
};

// Início/fim do mês escolhido — em data (pra corridas_fusao.data_operacional)
// e em timestamp local (pra hora_retirada/hora_inicio_vazamento). Monta os
// limites com componentes de Date locais, não string, pra não cair no
// mesmo bug de fuso já corrigido no Vazamento (UTC vs. dia local).
function fusaoGraficosLimitesMes(mesValue) {
  const [ano, mes] = mesValue.split("-").map(Number);
  const ultimoDia = new Date(ano, mes, 0).getDate();
  return {
    dataInicio: `${mesValue}-01`,
    dataFim: `${mesValue}-${String(ultimoDia).padStart(2, "0")}`,
    horaInicioIso: new Date(ano, mes - 1, 1, 0, 0, 0).toISOString(),
    horaFimIso: new Date(ano, mes, 1, 0, 0, 0).toISOString()
  };
}

function fusaoCalcularIndicadoresMes(corridas, panelasRetiradas, panelasVazadas) {
  const materialPorProduto = fusaoState.tipoMaterialPorProduto || {};
  const materialBaseDoProduto = (produtoId) => fusaoLimparFerroBase(materialPorProduto[produtoId]).toLowerCase();

  let totalCargaKg = 0;
  let energiaKwhFusoresTotal = 0, cargaFusoresKg = 0;
  const cargaPorTipo = {};
  let gusaLiquidoKg = 0, gusaSolidoKg = 0;
  // Gusa UTG/Siderurgia e as corridas do denominador só contam nos fornos
  // Fusores (pedido explícito) — Holding não "funde", só recebe/trata.
  let gusaUtgKgFusores = 0, gusaSiderKgFusores = 0;
  let corridasCinzentoFusores = 0, corridasNodularFusores = 0;
  let corridasFusores = 0, corridasHoldings = 0;

  for (const corrida of corridas) {
    const ehFusor = corrida.fornos_fusao?.tipo === "FUSAO";
    if (ehFusor) corridasFusores++;
    if (corrida.fornos_fusao?.tipo === "HOLDING") corridasHoldings++;
    if (ehFusor) energiaKwhFusoresTotal += fNumber(corrida.energia_kwh);
    for (const item of corrida.corridas_fusao_carga_itens || []) {
      const kg = fNumber(item.quantidade_realizada_kg);
      totalCargaKg += kg;
      if (ehFusor) cargaFusoresKg += kg;
      const tipo = item.materiais_fusao?.tipo || "OUTRO";
      cargaPorTipo[tipo] = (cargaPorTipo[tipo] || 0) + kg;
      if (tipo === "GUSA") {
        if (item.estado_fisico === "LIQUIDO") gusaLiquidoKg += kg; else gusaSolidoKg += kg;
        if (ehFusor) {
          const nomeMaterial = (item.materiais_fusao?.nome || "").toUpperCase();
          if (nomeMaterial.includes("UTG")) gusaUtgKgFusores += kg;
          if (nomeMaterial.includes("SIDERURGIA")) gusaSiderKgFusores += kg;
        }
      }
    }
    if (ehFusor) {
      const materialBase = materialBaseDoProduto(corrida.produto_id);
      if (materialBase === "cinzento") corridasCinzentoFusores++;
      if (materialBase === "nodular") corridasNodularFusores++;
    }
  }

  let fesimgKg = 0;
  for (const panela of panelasRetiradas) {
    fesimgKg += fNumber(panela.fesimg_liga1_kg) + fNumber(panela.fesimg_liga4_kg);
  }

  let cinzentoVazadoKg = 0, nodularVazadoKg = 0;
  for (const panela of panelasVazadas) {
    const materialBase = materialBaseDoProduto(panela.produto_id);
    if (materialBase === "nodular") nodularVazadoKg += fNumber(panela.peso_kg);
    else if (materialBase === "cinzento") cinzentoVazadoKg += fNumber(panela.peso_kg);
  }

  return {
    totalCargaKg, energiaKwhFusoresTotal, cargaFusoresKg, cargaPorTipo,
    gusaLiquidoKg, gusaSolidoKg, gusaUtgKgFusores, gusaSiderKgFusores,
    corridasCinzentoFusores, corridasNodularFusores, corridasFusores, corridasHoldings,
    fesimgKg, cinzentoVazadoKg, nodularVazadoKg
  };
}

function fusaoRenderDonutComposicaoCarga(container, cargaPorTipo, totalCargaKg) {
  const entradas = Object.keys(FUSAO_MATERIAL_TIPO_LABEL)
    .map((tipo) => ({ tipo, valor: fNumber(cargaPorTipo[tipo]) }))
    .filter((e) => e.valor > 0);
  if (!entradas.length) { container.innerHTML = `<p class="production-muted">Sem carga lançada no período.</p>`; return; }
  let offset = 0;
  const segmentos = entradas.map((e) => {
    const inicio = offset;
    offset += e.valor / totalCargaKg * 360;
    return `${FUSAO_MATERIAL_TIPO_COR[e.tipo]} ${inicio}deg ${offset}deg`;
  });
  container.innerHTML = `<div class="fusao-donut" style="--donut-segments:${segmentos.join(",")}" role="img" aria-label="Composição da carga">
      <div><strong>${fusaoKg(totalCargaKg)}</strong><span>carregados</span></div>
    </div>
    <div class="fusao-donut-legend">${entradas.map((e) => `<div><i style="--legend-color:${FUSAO_MATERIAL_TIPO_COR[e.tipo]}"></i><span>${fEsc(FUSAO_MATERIAL_TIPO_LABEL[e.tipo])}</span><strong>${(e.valor / totalCargaKg * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</strong></div>`).join("")}</div>`;
}

function fusaoKpiRowHtml(label, valor, destaque) {
  return `<tr${destaque ? ' class="fusao-kpi-destaque"' : ""}><td>${fEsc(label)}</td><td>${valor}</td></tr>`;
}

function fusaoRenderKpisMes(indicadores) {
  const tbody = fq("#fusao-kpi-tbody");
  if (!tbody) return;
  const num = (v, casas = 0) => v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
  const tonMetalFundido = indicadores.totalCargaKg / 1000;
  // Energia = kwh dos Fusores / tonelada fundida NOS FUSORES (Holding não
  // funde, só recebe/trata) — pedido explícito.
  const tonFundidoFusores = indicadores.cargaFusoresKg / 1000;
  const energiaKwhPorT = tonFundidoFusores > 0 ? indicadores.energiaKwhFusoresTotal / tonFundidoFusores : 0;
  // FeSiMg = kg de liga / tonelada de metal NODULAR VAZADO (não sobre todo
  // o peso retirado do Holding) — pedido explícito.
  const fesimgPct = indicadores.nodularVazadoKg > 0 ? indicadores.fesimgKg / indicadores.nodularVazadoKg * 100 : 0;
  const gusaTotalKg = indicadores.gusaLiquidoKg + indicadores.gusaSolidoKg;
  const gusaLiquidoPct = gusaTotalKg > 0 ? indicadores.gusaLiquidoKg / gusaTotalKg * 100 : 0;
  const gusaUtgPorCorridaNodularT = indicadores.corridasNodularFusores > 0 ? (indicadores.gusaUtgKgFusores / 1000) / indicadores.corridasNodularFusores : 0;
  const gusaSiderPorCorridaCinzentoT = indicadores.corridasCinzentoFusores > 0 ? (indicadores.gusaSiderKgFusores / 1000) / indicadores.corridasCinzentoFusores : 0;
  const cinzentoT = indicadores.cinzentoVazadoKg / 1000;
  const nodularT = indicadores.nodularVazadoKg / 1000;
  tbody.innerHTML = [
    fusaoKpiRowHtml("Consumo de energia (KWH/t)", num(energiaKwhPorT)),
    fusaoKpiRowHtml("Consumo de FeSiMg (%)", `${num(fesimgPct, 2)}%`),
    fusaoKpiRowHtml("Gusa líquido / Gusa sólido", `${num(gusaLiquidoPct)}%`),
    fusaoKpiRowHtml("Gusa UTG / Forno Nodular (t/corrida)", num(gusaUtgPorCorridaNodularT, 1)),
    fusaoKpiRowHtml("Gusa Sider. / Forno Cinzento (t/corrida)", num(gusaSiderPorCorridaCinzentoT, 1)),
    fusaoKpiRowHtml("Ton. metal fundido", num(tonMetalFundido)),
    fusaoKpiRowHtml("Total de corridas Fusores", String(indicadores.corridasFusores)),
    fusaoKpiRowHtml("Total de corridas Holdings", String(indicadores.corridasHoldings)),
    fusaoKpiRowHtml("Cinzento (t)", num(cinzentoT)),
    fusaoKpiRowHtml("Nodular (t)", num(nodularT)),
    fusaoKpiRowHtml("Metal enviado a Disa (t)", num(cinzentoT + nodularT), true)
  ].join("");
}

// Parte B — 5 gráficos diários de barra com linha de meta (Energia, Gusa
// Líq/Sól, FeSiMg, Gusa Sider./Cinzento, Gusa UTG/Nodular). Não existe
// função genérica de "barra + meta" no resto do app (cada tela desenha o
// próprio SVG à mão) — mas como são 5 gráficos praticamente idênticos
// aqui, compensa ter uma função só, ao contrário do padrão do resto do
// sistema.
function fusaoDiasDoMes(mesValue) {
  const [ano, mes] = mesValue.split("-").map(Number);
  const ultimoDia = new Date(ano, mes, 0).getDate();
  return Array.from({ length: ultimoDia }, (_, i) => `${mesValue}-${String(i + 1).padStart(2, "0")}`);
}

function fusaoCalcularSeriesDiarias(dias, corridas, panelasRetiradas, panelasVazadas) {
  const materialPorProduto = fusaoState.tipoMaterialPorProduto || {};
  const materialBaseDoProduto = (produtoId) => fusaoLimparFerroBase(materialPorProduto[produtoId]).toLowerCase();
  const mapaZerado = () => new Map(dias.map((d) => [d, 0]));

  const energiaFusoresPorDia = mapaZerado(), cargaFusoresPorDia = mapaZerado();
  const gusaLiquidoPorDia = mapaZerado(), gusaSolidoPorDia = mapaZerado();
  const gusaUtgFusoresPorDia = mapaZerado(), gusaSiderFusoresPorDia = mapaZerado();
  const corridasCinzentoFusoresPorDia = mapaZerado(), corridasNodularFusoresPorDia = mapaZerado();

  for (const corrida of corridas) {
    const dia = corrida.data_operacional;
    if (!energiaFusoresPorDia.has(dia)) continue;
    const ehFusor = corrida.fornos_fusao?.tipo === "FUSAO";
    if (ehFusor) energiaFusoresPorDia.set(dia, energiaFusoresPorDia.get(dia) + fNumber(corrida.energia_kwh));
    for (const item of corrida.corridas_fusao_carga_itens || []) {
      const kg = fNumber(item.quantidade_realizada_kg);
      if (ehFusor) cargaFusoresPorDia.set(dia, cargaFusoresPorDia.get(dia) + kg);
      if ((item.materiais_fusao?.tipo || "OUTRO") === "GUSA") {
        if (item.estado_fisico === "LIQUIDO") gusaLiquidoPorDia.set(dia, gusaLiquidoPorDia.get(dia) + kg);
        else gusaSolidoPorDia.set(dia, gusaSolidoPorDia.get(dia) + kg);
        if (ehFusor) {
          const nome = (item.materiais_fusao?.nome || "").toUpperCase();
          if (nome.includes("UTG")) gusaUtgFusoresPorDia.set(dia, gusaUtgFusoresPorDia.get(dia) + kg);
          if (nome.includes("SIDERURGIA")) gusaSiderFusoresPorDia.set(dia, gusaSiderFusoresPorDia.get(dia) + kg);
        }
      }
    }
    if (ehFusor) {
      const materialBase = materialBaseDoProduto(corrida.produto_id);
      if (materialBase === "cinzento") corridasCinzentoFusoresPorDia.set(dia, corridasCinzentoFusoresPorDia.get(dia) + 1);
      if (materialBase === "nodular") corridasNodularFusoresPorDia.set(dia, corridasNodularFusoresPorDia.get(dia) + 1);
    }
  }

  const fesimgPorDia = mapaZerado();
  for (const panela of panelasRetiradas) {
    const dia = fusaoDataLocalDe(panela.hora_retirada);
    if (fesimgPorDia.has(dia)) fesimgPorDia.set(dia, fesimgPorDia.get(dia) + fNumber(panela.fesimg_liga1_kg) + fNumber(panela.fesimg_liga4_kg));
  }
  const nodularVazadoPorDia = mapaZerado();
  for (const panela of panelasVazadas) {
    const dia = fusaoDataLocalDe(panela.hora_inicio_vazamento);
    if (nodularVazadoPorDia.has(dia) && materialBaseDoProduto(panela.produto_id) === "nodular") {
      nodularVazadoPorDia.set(dia, nodularVazadoPorDia.get(dia) + fNumber(panela.peso_kg));
    }
  }

  return {
    energiaPorDia: dias.map((d) => cargaFusoresPorDia.get(d) > 0 ? energiaFusoresPorDia.get(d) / (cargaFusoresPorDia.get(d) / 1000) : null),
    gusaLiquidoPctPorDia: dias.map((d) => {
      const total = gusaLiquidoPorDia.get(d) + gusaSolidoPorDia.get(d);
      return total > 0 ? gusaLiquidoPorDia.get(d) / total * 100 : null;
    }),
    fesimgPctPorDia: dias.map((d) => nodularVazadoPorDia.get(d) > 0 ? fesimgPorDia.get(d) / nodularVazadoPorDia.get(d) * 100 : null),
    gusaSiderPorCorridaPorDia: dias.map((d) => corridasCinzentoFusoresPorDia.get(d) > 0 ? (gusaSiderFusoresPorDia.get(d) / 1000) / corridasCinzentoFusoresPorDia.get(d) : null),
    gusaUtgPorCorridaPorDia: dias.map((d) => corridasNodularFusoresPorDia.get(d) > 0 ? (gusaUtgFusoresPorDia.get(d) / 1000) / corridasNodularFusoresPorDia.get(d) : null)
  };
}

// Uma barra por dia + linha tracejada de meta; barra fica vermelha nos
// dias fora da meta (mesma ideia do dashed-line + cor por status já usado
// em Acabamento, sem precisar de marcador à parte).
function fusaoGraficoBarraMetaHtml(opcoes) {
  const {
    titulo, dias, valores, meta, metaComparacao = "menor",
    corBarra = "#185abd", corForaDaMeta = "#c0392b", altura = 260,
    formatarValor = (v) => v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })
  } = opcoes;
  const width = 900, height = altura;
  const margin = { top: 20, right: 14, bottom: 26, left: 46 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const valoresValidos = valores.filter((v) => v != null);
  const maiorValor = Math.max(1, ...valoresValidos, meta != null ? meta : 0);
  const yMax = maiorValor * 1.15;
  const yFor = (v) => margin.top + (1 - v / yMax) * plotHeight;
  const groupWidth = plotWidth / dias.length;
  const barWidth = Math.max(2, groupWidth * 0.62);

  const ticks = 4;
  const grid = Array.from({ length: ticks + 1 }, (_, i) => {
    const valor = yMax / ticks * i;
    const y = yFor(valor);
    return `<line x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" class="fusao-grafico-grid"/>
      <text x="${margin.left - 6}" y="${y + 4}" class="fusao-grafico-eixo" text-anchor="end">${Math.round(valor).toLocaleString("pt-BR")}</text>`;
  }).join("");

  const barras = dias.map((dia, index) => {
    const valor = valores[index];
    const diaLabel = dia.slice(8, 10);
    const rotuloEixo = `<text x="${margin.left + index * groupWidth + groupWidth / 2}" y="${height - 8}" class="fusao-grafico-eixo" text-anchor="middle">${diaLabel}</text>`;
    if (valor == null) return rotuloEixo;
    const x = margin.left + index * groupWidth + (groupWidth - barWidth) / 2;
    const y = yFor(valor);
    const altura = Math.max(0, margin.top + plotHeight - y);
    const foraDaMeta = meta != null && (metaComparacao === "menor" ? valor > meta : valor < meta);
    const cor = foraDaMeta ? corForaDaMeta : corBarra;
    return `<rect x="${x}" y="${y}" width="${barWidth}" height="${altura}" fill="${cor}"><title>${fEsc(diaLabel)}: ${formatarValor(valor)}</title></rect>${rotuloEixo}`;
  }).join("");

  const linhaMeta = meta != null
    ? `<line x1="${margin.left}" y1="${yFor(meta)}" x2="${width - margin.right}" y2="${yFor(meta)}" class="fusao-grafico-meta-line"/>`
    : "";

  return `<div class="fusao-grafico-bloco">
      <div class="fusao-grafico-cabecalho"><h3>${fEsc(titulo)}</h3>${meta != null ? `<span class="fusao-grafico-meta-label">Meta ${metaComparacao === "menor" ? "&lt;" : "&gt;"} ${formatarValor(meta)}</span>` : ""}</div>
      <div class="fusao-grafico-svg-wrap"><svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${fEsc(titulo)}">${grid}${barras}${linhaMeta}</svg></div>
    </div>`;
}

async function fusaoRenderGraficosDiarios(mesValue, corridas, panelasRetiradas, panelasVazadas) {
  const container = fq("#fusao-graficos-diarios");
  const containerEnergia = fq("#fusao-grafico-energia");
  if (!container || !containerEnergia) return;
  const dias = fusaoDiasDoMes(mesValue);
  const series = fusaoCalcularSeriesDiarias(dias, corridas, panelasRetiradas, panelasVazadas);
  const dataReferencia = `${mesValue}-01`;
  const [metaEnergia, metaGusaLiquido, metaFesimg, metaGusaSider, metaGusaUtg] = await Promise.all([
    window.LIDUTEC_PRODUCAO_FUSAO_DATA.metaFusaoMes("FUSAO_ENERGIA_KWH_T", dataReferencia),
    window.LIDUTEC_PRODUCAO_FUSAO_DATA.metaFusaoMes("FUSAO_GUSA_LIQUIDO_PCT", dataReferencia),
    window.LIDUTEC_PRODUCAO_FUSAO_DATA.metaFusaoMes("FUSAO_FESIMG_PCT", dataReferencia),
    window.LIDUTEC_PRODUCAO_FUSAO_DATA.metaFusaoMes("FUSAO_GUSA_SIDER_T_CORRIDA", dataReferencia),
    window.LIDUTEC_PRODUCAO_FUSAO_DATA.metaFusaoMes("FUSAO_GUSA_UTG_T_CORRIDA", dataReferencia)
  ]);
  const fmtPct = (v) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
  const fmtT = (v) => v.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  // Energia fica em destaque na linha de cima, junto do donut/KPIs (mesmo
  // lugar de honra da planilha de referência); os outros 4 formam uma
  // segunda fileira só — tudo cabe na tela sem rolar.
  containerEnergia.innerHTML = fusaoGraficoBarraMetaHtml({ titulo: "Produção vs consumo de energia elétrica (KWH/t)", dias, valores: series.energiaPorDia, meta: metaEnergia, metaComparacao: "menor", altura: 170 });
  container.innerHTML = [
    fusaoGraficoBarraMetaHtml({ titulo: "Gusa líquido vs Gusa sólido (%)", dias, valores: series.gusaLiquidoPctPorDia, meta: metaGusaLiquido, metaComparacao: "maior", formatarValor: fmtPct }),
    fusaoGraficoBarraMetaHtml({ titulo: "Consumo de FeSiMg (%)", dias, valores: series.fesimgPctPorDia, meta: metaFesimg, metaComparacao: "menor", formatarValor: fmtPct }),
    fusaoGraficoBarraMetaHtml({ titulo: "Gusa Siderurgia / corrida Cinzento (t/corrida)", dias, valores: series.gusaSiderPorCorridaPorDia, meta: metaGusaSider, metaComparacao: "menor", formatarValor: fmtT }),
    fusaoGraficoBarraMetaHtml({ titulo: "Gusa UTG / corrida Nodular (t/corrida)", dias, valores: series.gusaUtgPorCorridaPorDia, meta: metaGusaUtg, metaComparacao: "menor", formatarValor: fmtT })
  ].join("");
}

async function fusaoRenderGraficosMes(mesValue) {
  const { dataInicio, dataFim, horaInicioIso, horaFimIso } = fusaoGraficosLimitesMes(mesValue);
  const [corridas, panelasRetiradas, panelasVazadas] = await Promise.all([
    window.LIDUTEC_PRODUCAO_FUSAO_DATA.corridasParaGraficosMes(dataInicio, dataFim),
    window.LIDUTEC_PRODUCAO_FUSAO_DATA.panelasRetiradasParaGraficosMes(horaInicioIso, horaFimIso),
    window.LIDUTEC_PRODUCAO_FUSAO_DATA.panelasVazadasParaGraficosMes(horaInicioIso, horaFimIso)
  ]);
  const indicadores = fusaoCalcularIndicadoresMes(corridas, panelasRetiradas, panelasVazadas);
  fusaoRenderDonutComposicaoCarga(fq("#fusao-donut-composicao"), indicadores.cargaPorTipo, indicadores.totalCargaKg);
  fusaoRenderKpisMes(indicadores);
  await fusaoRenderGraficosDiarios(mesValue, corridas, panelasRetiradas, panelasVazadas);
}

async function initializeFusaoGraficos() {
  const mesInput = fq("#fusao-graficos-mes");
  if (!mesInput) return;
  if (!mesInput.value) {
    const hoje = new Date();
    mesInput.value = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
  }
  mesInput.addEventListener("change", () => {
    if (mesInput.value) fusaoRenderGraficosMes(mesInput.value).catch((error) => alert(error.message));
  });
  await fusaoRenderGraficosMes(mesInput.value);
}
window.initializeFusaoGraficos = initializeFusaoGraficos;
