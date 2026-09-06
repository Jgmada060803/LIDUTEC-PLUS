const fq = (selector) => document.querySelector(selector);
const fEsc = (value = "") => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fNumber = (value) => Number(value || 0);
const fusaoPage = document.body.dataset.productionPage;
const fusaoState = { user: null, permissions: null, materiais: [], fornos: [], produtos: [], volumeAtual: {} };
const fusaoCorridaCache = { corrida: null, itens: [], transferencias: { entradas: [], saidas: [] }, panelasHolding: [] };

const FUSAO_STATUS_NOMES = { ABERTA: "Aberta", FECHADA: "Fechada" };

// Hora digitada pelo operador (não a hora do clique) — mesmo padrão de
// inicio/fim já usado nas paradas de produção dos outros módulos.
function fusaoHoraAgora() {
  const agora = new Date();
  return `${String(agora.getHours()).padStart(2, "0")}:${String(agora.getMinutes()).padStart(2, "0")}`;
}
// Data (calendário, local) de hoje — não confundir com "dia operacional"
// do turno (esse é só pra agrupar/reiniciar contagem; antes das 06:00 ele
// aponta pro dia anterior, o que é errado pra montar o horário digitado
// de um evento que está acontecendo agora mesmo).
function fusaoDataHojeLocal() {
  const agora = new Date();
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}-${String(agora.getDate()).padStart(2, "0")}`;
}
function fusaoMontarDataHora(dataOperacional, horaHHMM) {
  return new Date(`${dataOperacional}T${horaHHMM}:00`).toISOString();
}
// Data (calendário, local) de um timestamp já existente — NÃO usar
// `.slice(0, 10)` num timestamptz vindo do banco: ele chega em UTC, e
// fatiar a string pega o dia em UTC, não o dia local. Perto da virada
// (21h-23h59 no horário de Brasília) isso adianta o dia em 1, fazendo o
// horário digitado depois parecer ~24h no futuro.
function fusaoDataLocalDe(iso) {
  const data = new Date(iso);
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-${String(data.getDate()).padStart(2, "0")}`;
}
// Botão "Atualizar" (pedido explícito) — os tablets do chão de fábrica
// ficam com a tela aberta por horas e o navegador segura versão antiga em
// cache; um F5/pull-to-refresh comum nem sempre busca os arquivos de novo.
// Aqui força de verdade: limpa Cache Storage e Service Worker (se algum
// dia existirem) e navega pra uma URL com marca de tempo, garantindo que o
// HTML em si não venha do cache do navegador.
async function fusaoForcarAtualizacao() {
  try {
    if (window.caches?.keys) {
      const chaves = await caches.keys();
      await Promise.all(chaves.map((chave) => caches.delete(chave)));
    }
    if (navigator.serviceWorker?.getRegistrations) {
      const registros = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registros.map((registro) => registro.unregister()));
    }
  } catch (error) {
    // Segue pra recarregar mesmo se a limpeza de cache falhar.
  }
  const url = new URL(location.href);
  url.searchParams.set("_att", Date.now().toString());
  location.replace(url.toString());
}
(function fusaoLigarBotaoAtualizar() {
  const botao = document.getElementById("fusao-atualizar-pagina");
  if (!botao) return;
  botao.addEventListener("click", () => {
    botao.disabled = true;
    botao.textContent = "Atualizando...";
    fusaoForcarAtualizacao();
  });
})();
// Trava horário digitado que estoure mais de 30 min no futuro (hora do
// tratamento no Holding, início/fim do vazamento) — pedido explícito,
// reforçado também no servidor (RPCs correspondentes).
function fusaoValidarHorarioNaoFuturo(iso, rotulo) {
  if (new Date(iso).getTime() > Date.now() + 30 * 60000) {
    throw new Error(`O horário de ${rotulo} não pode ser mais de 30 minutos no futuro.`);
  }
}
function fusaoKg(valor) {
  return fNumber(valor).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}
// Máscara de exibição do código da corrida (ex.: F1002676 -> F1.002.676) —
// os 6 últimos dígitos são ciclo(3)+sequência(3) (ver criar_corrida_fusao);
// o resto é o código do forno, que fica como prefixo sem ponto.
function fusaoCodigoCorridaMascarado(codigo) {
  if (!codigo || codigo.length <= 6) return codigo || "";
  const numero = codigo.slice(-6);
  const prefixo = codigo.slice(0, -6);
  return `${prefixo}.${numero.slice(0, 3)}.${numero.slice(3)}`;
}
// Identificação da panela na vazadora: código da corrida (mascarado) + V +
// sequencial do dia (só panela efetivamente vazada tem isso) — ex.:
// "H1.052.085-V1". Reinicia por dia, pedido explícito.
function fusaoIdentificacaoVazamento(codigoCorrida, sequencialVazamento) {
  const codigo = fusaoCodigoCorridaMascarado(codigoCorrida);
  return sequencialVazamento != null ? `${codigo}-V${sequencialVazamento}` : codigo;
}

async function loadFusaoSupport() {
  const [materiais, fornos, produtos, volumeRows, tiposMaterial, limitesTemperaturaVazamento] = await Promise.all([
    window.LIDUTEC_PRODUCAO_FUSAO_DATA.materiais(true),
    window.LIDUTEC_PRODUCAO_FUSAO_DATA.fornos(),
    window.LIDUTEC_PRODUCAO_FUSAO_DATA.produtos(),
    window.LIDUTEC_PRODUCAO_FUSAO_DATA.volumeAtualFornos(),
    window.LIDUTEC_PRODUCAO_FUSAO_DATA.tiposMaterialProdutos(),
    window.LIDUTEC_PRODUCAO_FUSAO_DATA.limitesTemperaturaVazamentoProdutos()
  ]);
  fusaoState.materiais = materiais;
  fusaoState.produtos = produtos;
  fusaoState.volumeAtual = Object.fromEntries(volumeRows.map((row) => [row.forno_id, row.volume_atual_kg]));
  // "Ferro base" no cabeçalho do card da Ponte — Tipo de material da ficha
  // técnica vigente do produto (Cinzento/Nodular).
  fusaoState.tipoMaterialPorProduto = Object.fromEntries(tiposMaterial.map((row) => [row.produto_id, row.tipo_material]));
  // Faixa de temperatura de liberação da panela de vazamento (ficha
  // técnica vigente) — usada pra colorir a coluna "Temp. vazamento" no
  // histórico do Vazamento.
  fusaoState.limiteTemperaturaVazamentoPorProduto = Object.fromEntries(
    limitesTemperaturaVazamento.map((row) => [row.produto_id, { min: row.temp_minima, max: row.temp_maxima }])
  );
  // Fusão em cima, Holding embaixo — os dois elaboram corrida própria.
  fusaoState.fornos = [...fornos].sort((a, b) => a.tipo === b.tipo ? a.codigo.localeCompare(b.codigo) : a.tipo === "FUSAO" ? -1 : 1);
}
// A ficha técnica às vezes traz o "Tipo de material" com prefixo tipo
// "F°F° Cinzento" — pedido explícito: mostrar só "Cinzento"/"Nodular",
// sem essa marcação (maiúsculo vem via CSS, não aqui).
function fusaoLimparFerroBase(texto) {
  if (!texto) return "—";
  return texto.replace(/^f\s*[°ºo.]\s*f\s*[°ºo.]\s*/i, "").trim() || "—";
}
// Volume atual muda com pesagens, fechamento e transferências — recarregado
// só depois de ações que mexem nele (não fica reconsultando à toa).
async function refreshVolumeAtual() {
  const volumeRows = await window.LIDUTEC_PRODUCAO_FUSAO_DATA.volumeAtualFornos();
  fusaoState.volumeAtual = Object.fromEntries(volumeRows.map((row) => [row.forno_id, row.volume_atual_kg]));
}

// ---------------------------------------------------------------------------
// Tela "index" — 1 bloco por forno (cada forno elabora 1 corrida por vez):
// mostra o formulário de nova carga se o forno estiver livre, ou o status
// da corrida em andamento se já tiver uma — mais a lista de recentes.
// ---------------------------------------------------------------------------
function fusaoMaterialOptions() {
  return fusaoState.materiais.map((m) => `<option value="${m.id}">${fEsc(m.nome)}</option>`).join("");
}
// Caixa de produto: campo de texto com lista de sugestões filtrada em JS —
// pedido explícito (digitar e aparecer as opções). <datalist> nativo foi
// testado antes, mas o filtro por navegador é inconsistente (alguns só
// mostram a lista inteira, igual um select); esse combobox próprio garante
// o comportamento certo em qualquer navegador.
// Combobox genérico (input de texto + sugestões filtradas em JS) — usado
// tanto pro produto quanto pro material agora ("igual o produto", pedido
// explícito). Cada uso passa sua própria lista/texto/callback de seleção.
function fusaoComboboxHtml(inputClass, valorInicial, inputAttrs, placeholder) {
  return `<span class="fusao-combobox">
      <input type="text" class="fusao-combobox-input ${inputClass}" autocomplete="off" placeholder="${placeholder}" value="${fEsc(valorInicial)}" ${inputAttrs}>
      <ul class="fusao-combobox-sugestoes" hidden></ul>
    </span>`;
}
function bindCombobox(wrapper, { itens, textoFn, onSelecionado }) {
  if (!wrapper || wrapper.dataset.bound) return;
  wrapper.dataset.bound = "1";
  const input = wrapper.querySelector(".fusao-combobox-input");
  const lista = wrapper.querySelector(".fusao-combobox-sugestoes");
  let encontrados = [];
  const atualizarSugestoes = () => {
    const termo = input.value.trim().toLowerCase();
    encontrados = (termo ? itens().filter((it) => textoFn(it).toLowerCase().includes(termo)) : itens()).slice(0, 8);
    if (!encontrados.length) { lista.hidden = true; lista.innerHTML = ""; return; }
    lista.innerHTML = encontrados.map((it, indice) => `<li data-indice="${indice}">${fEsc(textoFn(it))}</li>`).join("");
    lista.hidden = false;
  };
  input.addEventListener("input", () => { delete input.dataset.selecionadoId; atualizarSugestoes(); onSelecionado?.(null); });
  input.addEventListener("focus", atualizarSugestoes);
  // mousedown (não click) dispara antes do blur do input, senão a lista
  // some antes do clique ser processado.
  lista.addEventListener("mousedown", (event) => {
    const li = event.target.closest("li");
    if (!li) return;
    event.preventDefault();
    const item = encontrados[Number(li.dataset.indice)];
    if (!item) return;
    input.value = textoFn(item);
    input.dataset.selecionadoId = String(item.id);
    lista.hidden = true;
    onSelecionado?.(item);
  });
  // Sai do campo sem escolher nada da lista (nem digitar o texto exato de
  // um item existente) -> limpa, não deixa um valor "meio digitado" parecendo
  // válido. O timeout dá tempo do mousedown da sugestão rodar antes do blur.
  input.addEventListener("blur", () => {
    setTimeout(() => {
      lista.hidden = true;
      const idValido = input.dataset.selecionadoId && itens().some((it) => String(it.id) === input.dataset.selecionadoId);
      if (idValido) return;
      const alvo = input.value.trim();
      const encontrado = itens().find((it) => textoFn(it) === alvo);
      if (encontrado) {
        input.dataset.selecionadoId = String(encontrado.id);
        return;
      }
      input.value = "";
      delete input.dataset.selecionadoId;
      onSelecionado?.(null);
    }, 150);
  });
}
// Item escolhido pra esse campo — prioriza o clique na sugestão (id gravado
// no input); se digitou o texto certinho sem clicar, também aceita.
function fusaoItemDoInput(input, itens, textoFn) {
  if (input.dataset.selecionadoId) {
    const item = itens().find((it) => String(it.id) === input.dataset.selecionadoId);
    if (item) return item;
  }
  const alvo = input.value.trim();
  return itens().find((it) => textoFn(it) === alvo) || null;
}
function fusaoProdutoTexto(produto) {
  return produto ? `${produto.codigo} — ${produto.nome}` : "";
}
function fusaoProdutoComboboxHtml(valorInicial, inputAttrs) {
  return fusaoComboboxHtml("fusao-produto-input", valorInicial, inputAttrs, "Digite o código ou nome");
}
function bindProdutoCombobox(wrapper) {
  bindCombobox(wrapper, { itens: () => fusaoState.produtos, textoFn: fusaoProdutoTexto });
}
function fusaoProdutoDoInput(input) {
  return fusaoItemDoInput(input, () => fusaoState.produtos, fusaoProdutoTexto);
}
function fusaoMaterialTexto(material) {
  return material ? material.nome : "";
}
function fusaoMaterialComboboxHtml(valorInicial, inputAttrs) {
  return fusaoComboboxHtml("fusao-material-input", valorInicial, inputAttrs, "Digite o nome do material");
}
function bindMaterialCombobox(wrapper, onSelecionado) {
  bindCombobox(wrapper, { itens: () => fusaoState.materiais, textoFn: fusaoMaterialTexto, onSelecionado });
}
function fusaoMaterialDoInput(input) {
  return fusaoItemDoInput(input, () => fusaoState.materiais, fusaoMaterialTexto);
}
function fusaoProdutoLabel(produto, destacarCodigo = false) {
  if (!produto) return "—";
  const codigo = destacarCodigo ? `<span class="fusao-produto-codigo-destaque">${fEsc(produto.codigo)}</span>` : fEsc(produto.codigo);
  return `${codigo} — ${fEsc(produto.nome)}`;
}
// Produto editável no card — pedido explícito: pode trocar mesmo depois da
// corrida já ter começado (o RPC só exige que ela continue aberta).
function fusaoProdutoEditavelHtml(corrida, produto) {
  return `<span class="fusao-produto-editavel" data-corrida-id="${corrida.id}">
      <strong class="fusao-produto-display">${fusaoProdutoLabel(produto, true)}</strong>
      <button type="button" class="fusao-editable-toggle" data-produto-atual="${corrida.produto_id ?? ""}" title="Trocar produto">...</button>
    </span>`;
}
function bindProdutoEditavel(container, corridaId) {
  const el = container.querySelector(".fusao-produto-editavel");
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
      await window.LIDUTEC_PRODUCAO_FUSAO_DATA.atualizarProduto(corridaId, produto.id);
      el.querySelector(".fusao-combobox").outerHTML = `<strong class="fusao-produto-display">${fusaoProdutoLabel(produto, true)}</strong>`;
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
// Temperatura programada (setpoint) do Holding — só faz sentido pra forno
// tipo HOLDING, associada à corrida (período) em vez de ficar solta no
// cadastro do forno; ajustável quantas vezes precisar enquanto ABERTA.
function fusaoTemperaturaProgramadaHtml(corrida) {
  const valor = corrida.temperatura_programada_c;
  const display = `<strong class="fusao-temperatura-display">${valor != null ? `${fNumber(valor).toLocaleString("pt-BR")} °C` : "—"}</strong>`;
  return ` · Temp. programada: <span class="fusao-temperatura-editavel">${display}
      <button type="button" class="fusao-editable-toggle" title="Ajustar temperatura programada">...</button>
    </span>`;
}
function bindTemperaturaProgramada(container, corrida) {
  const el = container.querySelector(".fusao-temperatura-editavel");
  if (!el || el.dataset.bound) return;
  el.dataset.bound = "1";
  const toggle = el.querySelector(".fusao-editable-toggle");
  toggle.dataset.mode = "editar";
  toggle.addEventListener("click", async () => {
    if (toggle.dataset.mode !== "salvar") {
      const valorAtual = corrida.temperatura_programada_c ?? "";
      el.querySelector(".fusao-temperatura-display").outerHTML = `<input type="number" step="1" class="fusao-numero-input" value="${valorAtual}">`;
      toggle.dataset.mode = "salvar";
      toggle.textContent = "OK";
      toggle.title = "Salvar temperatura";
      el.querySelector("input").focus();
      return;
    }
    const input = el.querySelector("input");
    const novoValor = input.value === "" ? null : Number(input.value);
    const voltarParaDisplay = (valor) => {
      input.outerHTML = `<strong class="fusao-temperatura-display">${valor != null ? `${fNumber(valor).toLocaleString("pt-BR")} °C` : "—"}</strong>`;
      toggle.dataset.mode = "editar";
      toggle.textContent = "...";
      toggle.title = "Ajustar temperatura programada";
    };
    try {
      toggle.disabled = true; input.disabled = true;
      await window.LIDUTEC_PRODUCAO_FUSAO_DATA.atualizarTemperaturaProgramada(corrida.id, novoValor);
      corrida.temperatura_programada_c = novoValor;
      voltarParaDisplay(novoValor);
    } catch (error) {
      input.disabled = false;
      alert(error.message);
    } finally {
      toggle.disabled = false;
    }
  });
}
// Corrigir o número da corrida (item planejado: número normal continua
// automático — isso é só uma correção manual pontual, exige
// producao_fusao.editar). Só o número (3 últimos dígitos do código) é
// editável; forno+ciclo (prefixo) nunca mudam aqui.
function fusaoNumeroCorridaHtml(corrida) {
  const codigoHtml = `<strong class="fusao-corrida-codigo-destaque fusao-numero-display">${fEsc(fusaoCodigoCorridaMascarado(corrida.codigo))}</strong>`;
  if (!fusaoState.permissions.has("producao_fusao.editar")) return codigoHtml;
  return `<span class="fusao-numero-editavel" data-numero-atual="${corrida.numero_sequencia}">
      ${codigoHtml}
      <button type="button" class="fusao-editable-toggle" title="Corrigir número da corrida">...</button>
    </span>`;
}
function bindNumeroEditavel(container, corrida, forno) {
  const el = container.querySelector(".fusao-numero-editavel");
  if (!el || el.dataset.bound) return;
  el.dataset.bound = "1";
  const toggle = el.querySelector(".fusao-editable-toggle");
  toggle.dataset.mode = "editar";
  toggle.addEventListener("click", async () => {
    if (toggle.dataset.mode !== "salvar") {
      const numeroAtual = Number(el.dataset.numeroAtual);
      el.querySelector(".fusao-numero-display").outerHTML = `<input type="number" min="1" step="1" class="fusao-numero-input" value="${numeroAtual}">`;
      toggle.dataset.mode = "salvar";
      toggle.textContent = "OK";
      toggle.title = "Salvar número";
      el.querySelector(".fusao-numero-input").focus();
      return;
    }
    const input = el.querySelector(".fusao-numero-input");
    const numeroAtual = Number(el.dataset.numeroAtual);
    const novoNumero = Number(input.value);
    const voltarParaDisplay = (codigo) => {
      el.querySelector(".fusao-numero-input").outerHTML = `<strong class="fusao-corrida-codigo-destaque fusao-numero-display">${fEsc(fusaoCodigoCorridaMascarado(codigo))}</strong>`;
      toggle.dataset.mode = "editar";
      toggle.textContent = "...";
      toggle.title = "Corrigir número da corrida";
    };
    if (!novoNumero || novoNumero <= 0) { alert("Informe um número de corrida válido."); return; }
    if (novoNumero === numeroAtual) { voltarParaDisplay(corrida.codigo); return; }
    try {
      const maximo = await window.LIDUTEC_PRODUCAO_FUSAO_DATA.maxNumeroSequenciaCiclo(corrida.ciclo_refratario_id, corrida.id);
      const proximoEsperado = maximo + 1;
      if (novoNumero > proximoEsperado) {
        const confirma = confirm(
          `ATENÇÃO\nA corrida ${proximoEsperado} ainda não foi registrada neste forno.\n\nDeseja realmente usar o número ${novoNumero}?`
        );
        if (!confirma) return;
      }
      const motivo = (prompt("Motivo da correção (opcional):", "") || "").trim() || null;
      toggle.disabled = true; input.disabled = true;
      await window.LIDUTEC_PRODUCAO_FUSAO_DATA.corrigirNumeroCorrida(corrida.id, novoNumero, motivo);
      // Só o número (3 últimos dígitos) muda — forno/ciclo (prefixo) ficam iguais.
      corrida.numero_sequencia = novoNumero;
      corrida.codigo = corrida.codigo.slice(0, -3) + String(novoNumero).padStart(3, "0");
      el.dataset.numeroAtual = String(novoNumero);
      voltarParaDisplay(corrida.codigo);
      await loadCorridasList();
    } catch (error) {
      input.disabled = false;
      alert(error.message);
    } finally {
      toggle.disabled = false;
    }
  });
}
function novaCorridaItemRow() {
  const row = document.createElement("div");
  row.className = "fusao-item-row";
  row.innerHTML = `<label class="fusao-item-material-label">${fusaoMaterialComboboxHtml("", 'name="material_texto" required')}</label>
    <input name="quantidade_planejada_kg" type="number" min="0" step="0.01" placeholder="Qtd (kg)" required>
    <select name="estado_fisico" hidden><option value="">Sólido ou líquido?</option><option value="SOLIDO">Sólido</option><option value="LIQUIDO">Líquido</option></select>
    <button type="button" class="button button-secondary" data-remove-item>Remover</button>`;
  row.querySelector("[data-remove-item]").addEventListener("click", () => row.remove());
  // Sólido/líquido só existe pro Gusa — não é propriedade fixa do material,
  // é escolhido item a item na hora de montar a carga.
  bindMaterialCombobox(row.querySelector(".fusao-combobox"), (material) => {
    const estadoField = row.querySelector('[name="estado_fisico"]');
    const isGusa = material?.tipo === "GUSA";
    estadoField.hidden = !isGusa;
    estadoField.required = isGusa;
    if (!isGusa) estadoField.value = "";
  });
  return row;
}
function fusaoRefratarioClass(count, forno) {
  if (count > forno.limite_critico_corridas) return "is-critical";
  if (count > forno.limite_atencao_corridas) return "is-warning";
  return "is-good";
}
function fusaoCorridaStatusBadgeClass(status) {
  if (status === "FECHADA") return "is-done";
  return "is-current";
}
// Calcula os campos derivados (saldo/entrada/saída/%) uma vez só, guardado
// junto com a linha bruta -- permite ordenar por qualquer coluna sem
// recalcular a cada clique no cabeçalho.
function corridaRecenteComputar(item) {
  const itens = item.corridas_fusao_carga_itens || [];
  let totalCargaKg = 0, gusaKg = 0, sucataKg = 0, alternativoKg = 0, retornoKg = 0, liquidoKg = 0;
  for (const it of itens) {
    const kg = fNumber(it.quantidade_realizada_kg);
    totalCargaKg += kg;
    const tipo = it.materiais_fusao?.tipo;
    if (tipo === "GUSA") gusaKg += kg; else if (tipo === "SUCATA") sucataKg += kg;
    else if (tipo === "ALTERNATIVO") alternativoKg += kg; else if (tipo === "RETORNO") retornoKg += kg;
    if (it.estado_fisico === "LIQUIDO") liquidoKg += kg;
  }
  const transferenciasEntradaKg = (item.transferencias_entrada || []).reduce((soma, t) => soma + fNumber(t.quantidade_kg), 0);
  const transferenciasSaidaKg = (item.transferencias_saida || []).reduce((soma, t) => soma + fNumber(t.quantidade_kg), 0);
  const panelasKg = (item.panelas_holding || []).reduce((soma, p) => soma + fNumber(p.peso_kg), 0);
  const saldoInicial = fNumber(item.sobra_inicial_kg);
  const entrada = totalCargaKg + transferenciasEntradaKg;
  const saida = transferenciasSaidaKg + fNumber(item.escoria_kg) + fNumber(item.lingote_kg) + fNumber(item.ajuste_kg) + panelasKg;
  const pct = (parte) => totalCargaKg > 0 ? parte / totalCargaKg * 100 : null;
  return {
    id: item.id, codigo: item.codigo, forno: item.fornos_fusao?.codigo || "", dataOperacional: item.data_operacional || "",
    turno: item.turno, produtoCodigo: item.produtos?.codigo || "",
    materialBase: fusaoLimparFerroBase(fusaoState.tipoMaterialPorProduto?.[item.produto_id]),
    saldoInicial, entrada, saida, saldoFinal: saldoInicial + entrada - saida,
    pctRetorno: pct(retornoKg), pctGusa: pct(gusaKg), pctSucata: pct(sucataKg), pctAlternativo: pct(alternativoKg), pctLiquida: pct(liquidoKg),
    energia: item.energia_kwh, status: item.status, fechamento: item.fim || ""
  };
}
function corridaRecenteRowHtml(c) {
  const pctTexto = (v) => v != null ? `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "—";
  const dataHora = (v) => v ? new Date(v).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
  const dataCurta = (v) => v ? new Date(`${v}T12:00:00`).toLocaleDateString("pt-BR") : "—";
  return `<tr>
      <td>${fEsc(c.forno || "—")}</td>
      <td><a href="./corrida.html?id=${c.id}">${fEsc(fusaoCodigoCorridaMascarado(c.codigo))}</a></td>
      <td>${dataCurta(c.dataOperacional)}</td>
      <td>${c.turno}</td>
      <td>${fEsc(c.produtoCodigo || "—")}</td>
      <td>${fEsc(c.materialBase)}</td>
      <td>${fusaoKg(c.saldoInicial)}</td>
      <td>${fusaoKg(c.entrada)}</td>
      <td>${fusaoKg(c.saida)}</td>
      <td>${fusaoKg(c.saldoFinal)}</td>
      <td>${pctTexto(c.pctRetorno)}</td>
      <td>${pctTexto(c.pctGusa)}</td>
      <td>${pctTexto(c.pctSucata)}</td>
      <td>${pctTexto(c.pctAlternativo)}</td>
      <td>${pctTexto(c.pctLiquida)}</td>
      <td>${c.energia != null ? fNumber(c.energia).toLocaleString("pt-BR") : "—"}</td>
      <td><span class="fusao-status-step ${fusaoCorridaStatusBadgeClass(c.status)}">${FUSAO_STATUS_NOMES[c.status] || c.status}</span></td>
      <td>${dataHora(c.fechamento)}</td>
    </tr>`;
}
const fusaoCorridasRecentesState = { dados: [], ordenacaoColuna: null, ordenacaoAsc: true };
function renderCorridasRecentesTabela() {
  let dados = fusaoCorridasRecentesState.dados;
  const coluna = fusaoCorridasRecentesState.ordenacaoColuna;
  if (coluna) {
    const asc = fusaoCorridasRecentesState.ordenacaoAsc ? 1 : -1;
    dados = [...dados].sort((a, b) => {
      const va = a[coluna], vb = b[coluna];
      if (va == null && vb == null) return 0;
      if (va == null) return 1; if (vb == null) return -1;
      if (typeof va === "number") return (va - vb) * asc;
      return String(va).localeCompare(String(vb), "pt-BR") * asc;
    });
  }
  fq("#corridas-rows").innerHTML = dados.map(corridaRecenteRowHtml).join("");
  fq("#corridas-empty").hidden = dados.length > 0;
}
async function loadCorridasList(filtros = {}) {
  const rows = await window.LIDUTEC_PRODUCAO_FUSAO_DATA.corridas(filtros);
  fusaoCorridasRecentesState.dados = rows.map(corridaRecenteComputar);
  renderCorridasRecentesTabela();
  return rows;
}
function initializeFusaoCorridasFiltro() {
  const fornoSelect = fq("#corridas-filtro-forno");
  if (!fornoSelect || fornoSelect.dataset.bound) return;
  fornoSelect.dataset.bound = "1";
  fornoSelect.innerHTML += fusaoState.fornos.map((f) => `<option value="${f.id}">${fEsc(f.codigo)}</option>`).join("");

  const produtoWrapper = fq("#corridas-filtro-produto");
  produtoWrapper.innerHTML = fusaoProdutoComboboxHtml("", `id="corridas-filtro-produto-input"`);
  bindProdutoCombobox(produtoWrapper);

  const buscar = () => {
    const produto = fusaoProdutoDoInput(fq("#corridas-filtro-produto-input"));
    loadCorridasList({
      fornoId: fq("#corridas-filtro-forno").value || undefined,
      turno: fq("#corridas-filtro-turno").value || undefined,
      produtoId: produto?.id,
      dataInicio: fq("#corridas-filtro-data-inicio").value || undefined,
      dataFim: fq("#corridas-filtro-data-fim").value || undefined
    });
  };
  fq("#corridas-filtro-buscar").addEventListener("click", buscar);
  fq("#corridas-filtro-limpar").addEventListener("click", () => {
    fq("#corridas-filtro-forno").value = "";
    fq("#corridas-filtro-turno").value = "";
    fq("#corridas-filtro-produto-input").value = "";
    fq("#corridas-filtro-data-inicio").value = "";
    fq("#corridas-filtro-data-fim").value = "";
    loadCorridasList();
  });

  document.querySelectorAll(".fusao-corridas-tabela [data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const coluna = th.dataset.sort;
      if (fusaoCorridasRecentesState.ordenacaoColuna === coluna) {
        fusaoCorridasRecentesState.ordenacaoAsc = !fusaoCorridasRecentesState.ordenacaoAsc;
      } else {
        fusaoCorridasRecentesState.ordenacaoColuna = coluna;
        fusaoCorridasRecentesState.ordenacaoAsc = true;
      }
      document.querySelectorAll(".fusao-corridas-tabela [data-sort]").forEach((outro) => outro.classList.remove("is-asc", "is-desc"));
      th.classList.add(fusaoCorridasRecentesState.ordenacaoAsc ? "is-asc" : "is-desc");
      renderCorridasRecentesTabela();
    });
  });
}
function fornoFormHtml(forno, volumeAtualKg) {
  return `<p class="fusao-volume-atual-linha">Volume atual do forno <strong>${fusaoKg(volumeAtualKg)} kg</strong></p>
    <form class="meta-form fusao-forno-form" data-forno-id="${forno.id}">
    <p class="fusao-codigo-info">Próxima corrida: <strong class="fusao-codigo-prefixo">…</strong> <span class="production-muted">(número gerado automaticamente)</span></p>
    <label>Produto${fusaoProdutoComboboxHtml("", 'name="produto_texto" required')}</label>
    <label>Início<input name="inicio" type="time" value="${fusaoHoraAgora()}" required></label>
    <fieldset class="fusao-carga-itens">
      <legend>Carga planejada</legend>
      <div class="fusao-itens-rows"></div>
      <button type="button" class="button button-secondary" data-add-item>+ Material</button>
    </fieldset>
    <div class="form-message fusao-forno-message" hidden></div>
    <div class="meta-form-actions">
      <a href="./trocar-refratario.html?forno=${forno.id}" class="button button-secondary">Trocar refratário</a>
      <button class="button button-primary">Iniciar corrida</button>
    </div>
  </form>`;
}
async function bindFornoForm(form, forno) {
  // Carga planejada é opcional pra abrir a corrida — começa vazia; o
  // operador inclui material com "+ Material" quando/se precisar, ou deixa
  // pra incluir depois já com a corrida aberta.
  const rows = form.querySelector(".fusao-itens-rows");
  form.querySelector("[data-add-item]").addEventListener("click", () => rows.appendChild(novaCorridaItemRow()));
  bindProdutoCombobox(form.querySelector(".fusao-combobox"));

  const ciclo = await window.LIDUTEC_PRODUCAO_FUSAO_DATA.cicloAtivo(forno.id);
  const numeroCiclo = ciclo?.numero_ciclo ?? 1;
  form.querySelector(".fusao-codigo-prefixo").textContent = `${forno.codigo}.${String(numeroCiclo).padStart(3, "0")}.···`;
  const card = form.closest(".fusao-forno-card");
  card.classList.remove("is-good", "is-warning", "is-critical");
  if (ciclo) {
    window.LIDUTEC_PRODUCAO_FUSAO_DATA.corridasNoCiclo(ciclo.id).then(({ count }) => {
      card.classList.add(fusaoRefratarioClass(count, forno));
    }).catch(() => {});
  } else {
    card.classList.add("is-good");
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    try {
      const itens = [...rows.querySelectorAll(".fusao-item-row")].map((row) => {
        const material = fusaoMaterialDoInput(row.querySelector('[name="material_texto"]'));
        if (!material) throw new Error("Selecione um material válido da lista.");
        return {
          material_id: material.id,
          quantidade_planejada_kg: Number(row.querySelector('[name="quantidade_planejada_kg"]').value),
          estado_fisico: row.querySelector('[name="estado_fisico"]').value || null
        };
      });
      const produtoSelecionado = fusaoProdutoDoInput(form.elements.produto_texto);
      if (!produtoSelecionado) throw new Error("Selecione um produto válido da lista.");
      const produtoId = produtoSelecionado.id;
      const horaInicio = form.elements.inicio.value;
      if (!horaInicio) throw new Error("Informe o horário de início.");
      const dataOperacional = fq("#fusao-data-global").value;
      if (!dataOperacional) throw new Error("Informe a data.");
      await window.LIDUTEC_PRODUCAO_FUSAO_DATA.criarCorrida({
        p_forno_id: forno.id, p_turno: fq("#fusao-turno-global").value, p_data_operacional: dataOperacional,
        p_produto_id: produtoId, p_inicio: fusaoMontarDataHora(dataOperacional, horaInicio), p_itens: itens
      });
      await refreshVolumeAtual();
      await renderFornoCard(forno);
      await loadCorridasList();
    } catch (error) {
      const el = form.querySelector(".fusao-forno-message");
      el.textContent = error.message; el.className = "form-message error"; el.hidden = false;
      button.disabled = false;
    }
  });
}
// Corrida aberta fica embutida no próprio card — sem navegar pra outra tela:
// o operador da ponte edita "Real" (na tela da Ponte) e aqui já aparece
// atualizado sozinho; fechar/cancelar volta o card pro formulário de nova
// carga, pronto pra próxima corrida.
// Separado de corridaCardHtml pra dar pra atualizar só as tabelas depois de
// incluir um material novo, sem re-renderizar o card inteiro (isso fechava
// o formulário de inclusão e obrigava reabrir a cada material).
// Célula com valor + botão Editar/Salvar — clique explícito pra entrar em
// edição e outro pra confirmar, em vez de um campo sempre ativo que salva
// sozinho a cada mudança (achado confuso — ficava recalculando a toda
// hora). "kind" decide qual RPC bindEditableCells chama ao salvar.
// Material concluído (realizado >= planejado) trava a edição por padrão —
// evita mexer sem querer numa carga já fechada. "Colocar carga" pede
// confirmação explícita antes de liberar o Editar de novo.
function fusaoItemConcluido(item) {
  return fNumber(item.quantidade_realizada_kg) > 0 && fNumber(item.quantidade_realizada_kg) >= fNumber(item.quantidade_planejada_kg);
}
const FUSAO_UNLOCK_CONFIRM = {
  planejado: "Este material já foi concluído. Alterar a quantidade planejada mesmo assim?",
  realizado: "Este material já foi concluído. Adicionar material acima do solicitado?"
};
function fusaoEditableCellHtml(kind, item) {
  const valor = kind === "planejado" ? item.quantidade_planejada_kg : item.quantidade_realizada_kg;
  const exibicao = valor != null ? fNumber(valor).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "—";
  const travado = fusaoItemConcluido(item);
  const botao = travado
    ? `<button type="button" class="button button-secondary fusao-editable-unlock" title="Colocar carga">+</button>`
    : `<button type="button" class="button button-secondary fusao-editable-toggle" title="Editar">...</button>`;
  return `<span class="fusao-editable-cell${travado ? " fusao-editable-locked" : ""}" data-kind="${kind}" data-item-id="${item.id}" data-valor="${valor ?? ""}">
      <span class="fusao-editable-display">${exibicao}</span>
      ${botao}
    </span>`;
}
function fusaoNomeItemHtml(item) {
  const estadoLabel = { SOLIDO: "Sólido", LIQUIDO: "Líquido" };
  return `<span class="fusao-nome-material">${fEsc(item.materiais_fusao?.nome || "")}</span>${item.estado_fisico ? ` <span class="production-muted">(${estadoLabel[item.estado_fisico] || item.estado_fisico})</span>` : ""}`;
}
// Barrinha de progresso (% do planejado já pesado) — usada tanto por item
// quanto pro total do forno (soma de todos os itens do card).
function fusaoProgressoHtml(realizado, planejado) {
  const pct = fNumber(planejado) > 0 ? Math.round((fNumber(realizado) / fNumber(planejado)) * 100) : (fNumber(realizado) > 0 ? 100 : 0);
  const pctExibido = Math.min(100, Math.max(0, pct));
  const concluido = pct >= 100 && fNumber(realizado) > 0;
  return `<span class="fusao-progress" title="${pct}% do planejado">
      <span class="fusao-progress-track"><span class="fusao-progress-fill${concluido ? " is-concluido" : ""}" style="width:${pctExibido}%"></span></span>
      <span class="fusao-progress-label">${pct}%</span>
    </span>`;
}
// Forma de carregamento como coluna (não como título de tabela à parte) —
// pedido explícito, pra não abrir uma segunda tabela só por causa de um
// material líquido/direto.
function fusaoFormaCarregamentoHtml(item) {
  const modo = fusaoModoCarregamento(item);
  if (modo === "PONTE") return `<span class="fusao-forma-badge fusao-forma-ponte">Ponte</span>`;
  if (modo === "CARRO") return `<span class="fusao-forma-badge fusao-forma-carro">Carro</span>`;
  return `<span class="fusao-forma-badge fusao-forma-direto">Direto</span>`;
}
// Remover só é oferecido enquanto nada foi pesado ainda — depois de
// qualquer pesagem, o material fica preso ao histórico da corrida.
function fusaoRemoverItemBtnHtml(item) {
  if (fNumber(item.quantidade_realizada_kg) > 0) return "";
  return `<button type="button" class="fusao-remover-x fusao-remover-item" data-item-id="${item.id}" title="Remover material planejado">✕</button>`;
}
function fusaoCardRowHtml(item) {
  const viaPonte = fusaoItemVaiParaPonte(item);
  return `<tr data-item-id="${item.id}" data-planejado="${item.quantidade_planejada_kg}" data-realizado="${item.quantidade_realizada_kg ?? ""}">
      <td>${fusaoNomeItemHtml(item)}</td>
      <td>${fusaoFormaCarregamentoHtml(item)}</td>
      <td>${fusaoEditableCellHtml("planejado", item)}</td>
      <td>${viaPonte
        ? (item.quantidade_realizada_kg != null ? fNumber(item.quantidade_realizada_kg).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "—")
        : fusaoEditableCellHtml("realizado", item)}</td>
      <td><span class="fusao-progresso-cell">${fusaoProgressoHtml(item.quantidade_realizada_kg, item.quantidade_planejada_kg)}${fusaoRemoverItemBtnHtml(item)}</span></td>
    </tr>`;
}
// Transferência vira linha no topo da tabela de materiais do card — mesmas
// colunas, só a de Real preenchida. Saída mostra a corrida de destino
// (pra onde foi); entrada mostra a corrida de origem (de onde veio).
function fusaoTransferenciaCardRowHtml(direcao, transferencia) {
  const rotulo = direcao === "saida" ? "Saída" : "Entrada";
  return `<tr class="fusao-transferencia-row fusao-transferencia-${direcao}" data-transferencia-id="${transferencia.id}" data-quantidade-kg="${fNumber(transferencia.quantidade_kg)}">
      <td colspan="3">TRANSFERÊNCIA (${rotulo}) ${fEsc(fusaoCodigoCorridaMascarado(transferencia.corridaCodigo) || "—")}</td>
      <td><span class="fusao-transferencia-display">${fNumber(transferencia.quantidade_kg).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}</span></td>
      <td><span class="fusao-transferencia-acoes">
        <button type="button" class="fusao-editar-transferencia" title="Editar quantidade">...</button>
        <button type="button" class="fusao-remover-x fusao-remover-transferencia" title="Remover transferência">✕</button>
      </span></td>
    </tr>`;
}
// "Retorno Disa" — metal que volta pro forno (hoje: panela rejeitada
// devolvida; na etapa de lingotamento, a sobra do vazamento vai usar a
// mesma linha/nome, "afinal é a mesma coisa" — pedido explícito. Verde
// como entrada, sem ações (não é editável/removível por aqui).
function fusaoRetornoDisaRowHtml(quantidadePanelas, quantidadeKg) {
  return `<tr class="fusao-transferencia-row fusao-transferencia-entrada">
      <td colspan="3">RETORNO DISA (${quantidadePanelas} panela${quantidadePanelas === 1 ? "" : "s"})</td>
      <td>${fNumber(quantidadeKg).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}</td>
      <td></td>
    </tr>`;
}
// Panela retirada do Holding — mesma ideia da "Retorno Disa", só que é
// saída (vermelho) em vez de entrada. Pedido explícito: sair do cabeçalho
// e virar linha na tabela de materiais, igual transferência/retorno.
function fusaoPanelasRetiradasRowHtml(quantidadePanelas, quantidadeKg) {
  return `<tr class="fusao-transferencia-row fusao-transferencia-saida">
      <td colspan="3">PANELAS RETIRADAS (${quantidadePanelas} panela${quantidadePanelas === 1 ? "" : "s"})</td>
      <td>${fNumber(quantidadeKg).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}</td>
      <td></td>
    </tr>`;
}
// Panelas rejeitadas aguardando retorno — o operador escolhe o forno de
// destino e confirma; credita o saldo daquele forno (mantendo vínculo com
// a panela original, corrida e produto — nada some sem rastro). Reaproveitada
// tanto na tela do Vazamento quanto no painel flutuante do planejamento
// (índice), pra quem decide o destino não precisar trocar de tela.
function fusaoRejeitadaRowHtml(panela) {
  const holding = panela.corridas_fusao?.fornos_fusao;
  const corridaCodigo = panela.corridas_fusao?.codigo;
  const produto = panela.produtos;
  const opcoesFornos = fusaoState.fornos.map((f) => `<option value="${f.id}">${fEsc(f.codigo)} — ${fEsc(f.nome)}</option>`).join("");
  return `<tr data-panela-id="${panela.id}">
      <td>${fEsc(holding?.codigo || "—")}</td>
      <td>${panela.sequencial}</td>
      <td>${fEsc(fusaoCodigoCorridaMascarado(corridaCodigo))}</td>
      <td>${fEsc(produto?.codigo || "—")}</td>
      <td>${fusaoKg(panela.peso_kg)}</td>
      <td>${fEsc(panela.motivo_rejeicao || "—")}</td>
      <td><select name="forno_destino"><option value="">Forno destino</option>${opcoesFornos}</select></td>
      <td><button type="button" class="button button-primary" data-confirmar-retorno>Registrar retorno</button></td>
    </tr>`;
}
function fusaoBindRejeitadaRow(tbody, panela, aoConcluir) {
  const row = tbody.querySelector(`tr[data-panela-id="${panela.id}"]`);
  if (!row) return;
  const botao = row.querySelector("[data-confirmar-retorno]");
  botao.addEventListener("click", async () => {
    const fornoId = Number(row.querySelector('[name="forno_destino"]').value);
    if (!fornoId) { alert("Selecione o forno de destino."); return; }
    try {
      botao.disabled = true;
      await window.LIDUTEC_PRODUCAO_FUSAO_DATA.registrarRetornoPanelaHolding(panela.id, fornoId);
      await aoConcluir();
    } catch (error) {
      alert(error.message);
      botao.disabled = false;
    }
  });
}
// Renderiza dentro de qualquer container (seletor) e devolve a quantidade
// de panelas pendentes — quem chama decide o que fazer com esse número
// (ex.: mostrar/esconder o painel flutuante do índice).
async function fusaoRenderRejeitadasAguardandoRetorno(containerSeletor) {
  const panelas = await window.LIDUTEC_PRODUCAO_FUSAO_DATA.panelasRejeitadasAguardandoRetorno();
  const container = fq(containerSeletor);
  if (!container) return panelas.length;
  if (!panelas.length) { container.innerHTML = ""; return 0; }
  container.innerHTML = `<div class="panel-header"><h3>Panelas rejeitadas aguardando retorno</h3></div>
    <div class="table-wrapper"><table class="products-table">
      <thead><tr class="fusao-cabecalho-retirada"><th>Holding</th><th>Panela Nº</th><th>Corrida</th><th>Produto</th><th>Peso (kg)</th><th>Motivo</th><th>Forno destino</th><th></th></tr></thead>
      <tbody>${panelas.map(fusaoRejeitadaRowHtml).join("")}</tbody>
    </table></div>`;
  const tbody = container.querySelector("tbody");
  panelas.forEach((panela) => fusaoBindRejeitadaRow(tbody, panela, () => fusaoRenderRejeitadasAguardandoRetorno(containerSeletor)));
  return panelas.length;
}
// Painel flutuante do planejamento (índice) — mesma tabela acima, só que
// sobreposta à tela (não empurra o grid de fornos) e arrastável, pra dar
// pra decidir o destino do retorno sem sair da tela de carregamento nem
// perder o que já estava vendo. Some sozinho quando não há pendência.
function fusaoTornarArrastavel(painel, alca) {
  let arrastando = false, offsetX = 0, offsetY = 0;
  alca.addEventListener("pointerdown", (event) => {
    arrastando = true;
    const rect = painel.getBoundingClientRect();
    offsetX = event.clientX - rect.left;
    offsetY = event.clientY - rect.top;
    painel.style.left = `${rect.left}px`;
    painel.style.top = `${rect.top}px`;
    painel.style.right = "auto";
    painel.style.bottom = "auto";
    alca.setPointerCapture(event.pointerId);
  });
  alca.addEventListener("pointermove", (event) => {
    if (!arrastando) return;
    const maxX = Math.max(0, window.innerWidth - painel.offsetWidth);
    const maxY = Math.max(0, window.innerHeight - painel.offsetHeight);
    painel.style.left = `${Math.min(Math.max(0, event.clientX - offsetX), maxX)}px`;
    painel.style.top = `${Math.min(Math.max(0, event.clientY - offsetY), maxY)}px`;
  });
  const soltar = () => { arrastando = false; };
  alca.addEventListener("pointerup", soltar);
  alca.addEventListener("pointercancel", soltar);
}
async function fusaoAtualizarRetornoFlutuante() {
  const painel = fq("#fusao-retorno-flutuante");
  if (!painel) return;
  const quantidade = await fusaoRenderRejeitadasAguardandoRetorno("#fusao-retorno-flutuante-corpo");
  painel.hidden = quantidade === 0;
}
// Lingotamento (Etapa 9) aguardando definição — não é por panela, é por
// CICLO de vazamento (o operador do Vazamento decide a hora de lingotar,
// quando um problema interrompe o ciclo contínuo de panelas se
// misturando na vazadora; o peso teórico já vem calculado pelo
// servidor). Quem decide o destino (forno ou "BLOCO") e informa o peso
// REAL medido é o operador da Fusão — mesmo padrão do retorno de panela
// rejeitada.
function fusaoLingotamentoRowHtml(lingotamento) {
  const opcoesFornos = fusaoState.fornos.map((f) => `<option value="${f.id}">${fEsc(f.codigo)} — ${fEsc(f.nome)}</option>`).join("");
  const hora = (v) => v ? new Date(v).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—";
  return `<tr data-lingotamento-id="${lingotamento.id}">
      <td>${hora(lingotamento.ciclo_inicio)}–${hora(lingotamento.ciclo_fim)}</td>
      <td>${fusaoKg(lingotamento.peso_teorico_kg)}</td>
      <td><input type="number" step="0.01" name="peso_real" placeholder="Peso real (kg)"></td>
      <td><select name="forno_destino"><option value="">BLOCO (sem forno)</option>${opcoesFornos}</select></td>
      <td><button type="button" class="button button-primary" data-confirmar-lingotamento>Registrar</button></td>
    </tr>`;
}
function fusaoBindLingotamentoRow(tbody, lingotamento, aoConcluir) {
  const row = tbody.querySelector(`tr[data-lingotamento-id="${lingotamento.id}"]`);
  if (!row) return;
  const botao = row.querySelector("[data-confirmar-lingotamento]");
  botao.addEventListener("click", async () => {
    const pesoReal = row.querySelector('[name="peso_real"]').value;
    if (pesoReal === "") { alert("Informe o peso real do lingote."); return; }
    const fornoId = row.querySelector('[name="forno_destino"]').value;
    try {
      botao.disabled = true;
      await window.LIDUTEC_PRODUCAO_FUSAO_DATA.registrarLingotamentoVazamento(lingotamento.id, Number(pesoReal), fornoId === "" ? null : Number(fornoId));
      await aoConcluir();
    } catch (error) {
      alert(error.message);
      botao.disabled = false;
    }
  });
}
async function fusaoRenderLingotamentoAguardandoDefinicao(containerSeletor) {
  const lingotamentos = await window.LIDUTEC_PRODUCAO_FUSAO_DATA.lingotamentosAguardandoDefinicao();
  const container = fq(containerSeletor);
  if (!container) return lingotamentos.length;
  if (!lingotamentos.length) { container.innerHTML = ""; return 0; }
  container.innerHTML = `<div class="panel-header"><h3>Lingotamento aguardando definição</h3></div>
    <div class="table-wrapper"><table class="products-table">
      <thead><tr class="fusao-cabecalho-retirada"><th>Ciclo (início–fim)</th><th>Peso teórico (kg)</th><th>Peso real (kg)</th><th>Forno destino</th><th></th></tr></thead>
      <tbody>${lingotamentos.map(fusaoLingotamentoRowHtml).join("")}</tbody>
    </table></div>`;
  const tbody = container.querySelector("tbody");
  lingotamentos.forEach((lingotamento) => fusaoBindLingotamentoRow(tbody, lingotamento, () => fusaoRenderLingotamentoAguardandoDefinicao(containerSeletor)));
  return lingotamentos.length;
}
async function fusaoAtualizarLingotamentoFlutuante() {
  const painel = fq("#fusao-lingotamento-flutuante");
  if (!painel) return;
  const quantidade = await fusaoRenderLingotamentoAguardandoDefinicao("#fusao-lingotamento-flutuante-corpo");
  painel.hidden = quantidade === 0;
}
function fusaoTabelaTotalRowHtml(itens) {
  const planejado = itens.reduce((soma, item) => soma + fNumber(item.quantidade_planejada_kg), 0);
  const realizado = itens.reduce((soma, item) => soma + fNumber(item.quantidade_realizada_kg), 0);
  return `<tr class="fusao-tabela-total-row">
      <td><strong>Total</strong></td>
      <td></td>
      <td><strong class="fusao-total-planejado">${fusaoKg(planejado)}</strong></td>
      <td><strong class="fusao-total-realizado">${fusaoKg(realizado)}</strong></td>
      <td class="fusao-total-progresso">${fusaoProgressoHtml(realizado, planejado)}</td>
    </tr>`;
}
function fusaoTabelasCargaHtml(itens, transferencias, retornosDisa = [], panelasRetiradas = []) {
  const carregamentoConcluido = itens.length > 0 && itens.every((item) =>
    fNumber(item.quantidade_realizada_kg) > 0 && fNumber(item.quantidade_realizada_kg) >= fNumber(item.quantidade_planejada_kg)
  );
  const entradaLinhas = (transferencias?.entradas || []).map((t) => fusaoTransferenciaCardRowHtml("entrada", t));
  const saidaLinhas = (transferencias?.saidas || []).map((t) => fusaoTransferenciaCardRowHtml("saida", t));
  const retornoKgTotal = retornosDisa.reduce((soma, p) => soma + fNumber(p.peso_kg), 0);
  const retornoLinhas = retornosDisa.length ? [fusaoRetornoDisaRowHtml(retornosDisa.length, retornoKgTotal)] : [];
  const panelasRetiradasKg = panelasRetiradas.reduce((soma, p) => soma + fNumber(p.peso_kg), 0);
  const panelasRetiradasLinhas = panelasRetiradas.length ? [fusaoPanelasRetiradasRowHtml(panelasRetiradas.length, panelasRetiradasKg)] : [];
  if (!itens.length && !entradaLinhas.length && !saidaLinhas.length && !retornoLinhas.length && !panelasRetiradasLinhas.length) return { carregamentoConcluido, html: "" };
  const html = `<table class="products-table"><thead><tr><th>Material</th><th>Carregamento</th><th>Planejado (kg)</th><th>Real (kg)</th><th>Progresso</th></tr></thead>
      <tbody>${entradaLinhas.join("")}${retornoLinhas.join("")}${itens.map(fusaoCardRowHtml).join("")}${saidaLinhas.join("")}${panelasRetiradasLinhas.join("")}</tbody>
      ${itens.length ? `<tfoot>${fusaoTabelaTotalRowHtml(itens)}</tfoot>` : ""}</table>`;
  return { carregamentoConcluido, html };
}
// Resumo compacto no topo do card — pedido explícito: peso inicial = sobra
// da corrida anterior; entrada = volume carregado nesta corrida (pesagem
// Ponte/direto) + recebido por transferência (pra fechar a conta certinho
// quando é um Holding recebendo de outro forno); saída = transferido pra
// fora; volume atual = inicial + entrada − saída.
function fusaoResumoCorridaHtml(corrida, todosItens, transferencias, volumeAtualKg, panelasHoldingKg = 0, retornadoKg = 0) {
  const pesoInicial = fNumber(corrida.sobra_inicial_kg);
  const totalCarregado = todosItens.reduce((soma, item) => soma + fNumber(item.quantidade_realizada_kg), 0);
  const totalRecebido = (transferencias?.entradas || []).reduce((soma, t) => soma + fNumber(t.quantidade_kg), 0);
  // Metal de panela rejeitada que retornou pra este forno também é
  // entrada — sem isso o Volume atual (que já credita esse retorno) não
  // batia com Inicial+Entrada-Saída.
  const entrada = totalCarregado + totalRecebido + fNumber(retornadoKg);
  // Panela retirada do Holding é saída igual escória/lingote/ajuste — sem
  // isso o saldo do forno abatia mas a linha "Saída" não explicava por quê.
  const saida = (transferencias?.saidas || []).reduce((soma, t) => soma + fNumber(t.quantidade_kg), 0)
    + fNumber(corrida.escoria_kg) + fNumber(corrida.lingote_kg) + fNumber(corrida.ajuste_kg) + fNumber(panelasHoldingKg);
  // Corrida fechada não deve mais "andar" na tela conforme o forno segue
  // sendo usado depois — mostra o saldo congelado no instante do fechamento,
  // não o saldo ao vivo do forno. Corrida ABERTA calcula aqui mesmo (inicial
  // + entrada − saída, os 3 valores já prontos acima) em vez de usar
  // volumeAtualKg (buscado à parte, só atualizado após ações específicas
  // como fechar/transferir — ficava desatualizado após só incluir material).
  const volume = corrida.status === "ABERTA" ? pesoInicial + entrada - saida : fNumber(corrida.saldo_forno_no_fechamento_kg);
  const kg = (valor) => `${fusaoKg(valor)}<span class="fusao-resumo-unidade">Kg</span>`;
  return `<div class="fusao-resumo-corrida" data-peso-inicial="${pesoInicial}" data-saida-kg="${saida}" data-panelas-kg="${fNumber(panelasHoldingKg)}" data-retorno-kg="${fNumber(retornadoKg)}">
      <div class="fusao-resumo-item"><span class="fusao-resumo-label">Peso Inicial</span><strong class="fusao-resumo-valor fusao-resumo-inicial">${kg(pesoInicial)}</strong></div>
      <div class="fusao-resumo-item"><span class="fusao-resumo-label">Entrada</span><strong class="fusao-resumo-valor fusao-resumo-entrada">${kg(entrada)}</strong></div>
      <div class="fusao-resumo-item"><span class="fusao-resumo-label">Saída</span><strong class="fusao-resumo-valor fusao-resumo-saida">${kg(saida)}</strong></div>
      <div class="fusao-resumo-item"><span class="fusao-resumo-label">Volume atual</span><strong class="fusao-resumo-valor fusao-resumo-volume">${kg(volume)}</strong></div>
    </div>`;
}
// Já recebe tudo embutido numa consulta só (corridaAbertaCompletaDoForno) —
// antes fazia mais 3 idas ao banco aqui dentro; agora só monta o HTML.
function corridaCardHtml(corrida, volumeAtualKg, retornosDisa = []) {
  const todosItens = corrida.corridas_fusao_carga_itens || [];
  const transferencias = {
    saidas: (corrida.saidas || []).map((t) => ({ id: t.id, quantidade_kg: t.quantidade_kg, corridaCodigo: t.corridas_fusao?.codigo })),
    entradas: (corrida.entradas || []).map((t) => ({ id: t.id, quantidade_kg: t.quantidade_kg, corridaCodigo: t.corridas_fusao?.codigo }))
  };
  const mensagens = corrida.corridas_fusao_mensagens || [];
  const retornadoKg = retornosDisa.reduce((soma, p) => soma + fNumber(p.peso_kg), 0);
  const panelasHoldingLista = corrida.panelas_holding || [];
  const panelasHoldingKg = panelasHoldingLista.reduce((soma, p) => soma + fNumber(p.peso_kg), 0);
  const { carregamentoConcluido, html: tabelasHtml } = fusaoTabelasCargaHtml(todosItens, transferencias, retornosDisa, panelasHoldingLista);
  const produto = fusaoState.produtos.find((p) => p.id === corrida.produto_id) || corrida.produtos;
  const forno = fusaoState.fornos.find((f) => f.id === corrida.forno_id);
  return `<div class="fusao-corrida-inline" data-corrida-id="${corrida.id}" data-versao="${corrida.versao}" data-forno-id="${corrida.forno_id}">
      <p><span class="fusao-status-step ${fusaoCorridaStatusBadgeClass(corrida.status)}">${FUSAO_STATUS_NOMES[corrida.status] || corrida.status}</span>
        ${fusaoNumeroCorridaHtml(corrida)} — ${corrida.turno}
        <span class="fusao-carregamento-badge">${carregamentoConcluido ? `<span class="fusao-ponte-status is-concluido">✓ Carregamento concluído</span>` : ""}</span></p>
      <p class="fusao-corrida-meta">${fusaoProdutoEditavelHtml(corrida, produto)}
        <span class="fusao-corrida-horarios">Início: <strong>${corrida.inicio ? new Date(corrida.inicio).toLocaleString("pt-BR") : "—"}</strong>
        ${corrida.fim ? ` · Fim: <strong>${new Date(corrida.fim).toLocaleString("pt-BR")}</strong>` : ""}
        ${forno?.tipo === "HOLDING" ? fusaoTemperaturaProgramadaHtml(corrida) : ""}</span></p>
      ${fusaoResumoCorridaHtml(corrida, todosItens, transferencias, volumeAtualKg, panelasHoldingKg, retornadoKg)}
      <div class="fusao-tabelas-carga">${tabelasHtml}</div>
      <div class="fusao-add-item-area">
        <button type="button" class="button button-secondary" data-toggle-add-item>+ Incluir material</button>
        <button type="button" class="button button-secondary" data-toggle-transferir>Transferir</button>
        <div class="fusao-itens-rows" hidden></div>
        <div class="fusao-transferir-rows" hidden></div>
      </div>
      ${fusaoMensagensPainelHtml(corrida.id, mensagens)}
      <div class="form-message fusao-forno-message" hidden></div>
      <div class="meta-form-actions fusao-saidas-diversas">
        <label>Escória (kg)<input type="number" min="0" step="0.01" class="fusao-saida-escoria" value="${corrida.escoria_kg ?? ""}"></label>
        <label>Ajuste (saída)<input type="number" min="0" step="0.01" class="fusao-saida-ajuste" value="${corrida.ajuste_kg ?? ""}"></label>
        <button type="button" class="button button-primary fusao-salvar-saidas" data-salvar-saidas hidden>OK</button>
        <label>Lingote (kg)<input type="number" min="0" step="0.01" class="fusao-saida-lingote" value="${corrida.lingote_kg ?? ""}"></label>
        <label>Energia (kWh)<input type="number" min="0" step="0.01" class="fusao-saida-energia" value="${corrida.energia_kwh ?? ""}"></label>
        <button type="button" class="button button-primary" data-acao="fechar">Fechar corrida</button>
      </div>
    </div>`;
}
// Recalcula o selo "Carregamento concluído" e a barra de total do card a
// partir do que já tá na tela (soma das linhas), sem precisar buscar tudo
// de novo.
function atualizarBadgeCarregamento(cardContainer) {
  const linhas = cardContainer.querySelectorAll(".fusao-tabelas-carga tr[data-planejado]");
  const badge = cardContainer.querySelector(".fusao-carregamento-badge");
  if (badge) {
    const concluido = linhas.length > 0 && [...linhas].every((row) =>
      fNumber(row.dataset.realizado) > 0 && fNumber(row.dataset.realizado) >= fNumber(row.dataset.planejado)
    );
    badge.innerHTML = concluido ? `<span class="fusao-ponte-status is-concluido">✓ Carregamento concluído</span>` : "";
  }
  const totalEl = cardContainer.querySelector(".fusao-total-progresso");
  let planejado = 0, realizado = 0;
  linhas.forEach((row) => {
    planejado += fNumber(row.dataset.planejado);
    realizado += fNumber(row.dataset.realizado);
  });
  if (totalEl) totalEl.innerHTML = fusaoProgressoHtml(realizado, planejado);
  const totalPlanejadoEl = cardContainer.querySelector(".fusao-total-planejado");
  const totalRealizadoEl = cardContainer.querySelector(".fusao-total-realizado");
  if (totalPlanejadoEl) totalPlanejadoEl.textContent = fusaoKg(planejado);
  if (totalRealizadoEl) totalRealizadoEl.textContent = fusaoKg(realizado);
  // Entrada/Volume atual do resumo (topo do card) dependem do realizado —
  // sem isso só atualizavam recarregando a página (pedido explícito).
  const resumoEl = cardContainer.querySelector(".fusao-resumo-corrida");
  const entradaEl = cardContainer.querySelector(".fusao-resumo-entrada");
  if (resumoEl && entradaEl) {
    const totalRecebido = [...cardContainer.querySelectorAll(".fusao-transferencia-entrada[data-quantidade-kg]")]
      .reduce((soma, row) => soma + fNumber(row.dataset.quantidadeKg), 0);
    const entrada = realizado + totalRecebido + fNumber(resumoEl.dataset.retornoKg);
    const kg = (valor) => `${fusaoKg(valor)}<span class="fusao-resumo-unidade">Kg</span>`;
    entradaEl.innerHTML = kg(entrada);
    const volumeEl = cardContainer.querySelector(".fusao-resumo-volume");
    if (volumeEl) {
      const pesoInicial = fNumber(resumoEl.dataset.pesoInicial);
      const saida = fNumber(resumoEl.dataset.saidaKg);
      volumeEl.innerHTML = kg(pesoInicial + entrada - saida);
    }
  }
}
const FUSAO_EDITABLE_RPC = {
  planejado: (corridaId, itemId, valor) => window.LIDUTEC_PRODUCAO_FUSAO_DATA.atualizarPlanejado(corridaId, itemId, valor),
  realizado: (corridaId, itemId, valor) => window.LIDUTEC_PRODUCAO_FUSAO_DATA.atualizarPesagem(corridaId, itemId, valor)
};
// Editar troca o valor por um campo; Salvar chama o RPC certo (planejado ou
// realizado, pelo data-kind da célula) e só então volta pro texto — nada
// muda sem clicar em Salvar, igual ao "OK" da tela da Ponte.
function bindEditableToggle(cell, corridaId, onSaved) {
  const toggle = cell.querySelector(".fusao-editable-toggle");
  toggle.dataset.mode = "editar";
  toggle.addEventListener("click", async () => {
    if (toggle.dataset.mode === "editar") {
      cell.querySelector(".fusao-editable-display").outerHTML =
        `<input type="number" min="0" step="0.01" class="fusao-editable-input" value="${cell.dataset.valor}">`;
      toggle.dataset.mode = "salvar";
      toggle.textContent = "OK";
      toggle.title = "Salvar";
      cell.querySelector(".fusao-editable-input").focus();
      return;
    }
    const input = cell.querySelector(".fusao-editable-input");
    const valor = input.value === "" ? null : Number(input.value);
    const kind = cell.dataset.kind;
    const itemId = Number(cell.dataset.itemId);
    toggle.disabled = true; input.disabled = true;
    try {
      await FUSAO_EDITABLE_RPC[kind](corridaId, itemId, valor);
      cell.dataset.valor = valor ?? "";
      input.outerHTML = `<span class="fusao-editable-display">${valor != null ? fNumber(valor).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "—"}</span>`;
      toggle.dataset.mode = "editar";
      toggle.textContent = "...";
      toggle.title = "Editar";
      onSaved?.(cell, kind, valor);
    } catch (error) {
      alert(error.message);
    } finally {
      toggle.disabled = false;
    }
  });
}
function bindEditableCells(container, corridaId, onSaved) {
  container.querySelectorAll(".fusao-editable-cell").forEach((cell) => {
    if (cell.dataset.bound) return;
    cell.dataset.bound = "1";
    const unlock = cell.querySelector(".fusao-editable-unlock");
    if (unlock) {
      unlock.addEventListener("click", () => {
        if (!confirm(FUSAO_UNLOCK_CONFIRM[cell.dataset.kind])) return;
        cell.classList.remove("fusao-editable-locked");
        unlock.outerHTML = `<button type="button" class="button button-secondary fusao-editable-toggle" title="Editar">...</button>`;
        bindEditableToggle(cell, corridaId, onSaved);
      });
      return;
    }
    bindEditableToggle(cell, corridaId, onSaved);
  });
}
// onSaved comum do card: atualiza o status da linha (Pendente/Concluído)
// com o par planejado/real mais recente e o selo geral do carregamento.
function fusaoOnSavedCard(container) {
  return (cell, kind, valor) => {
    // Qualquer edição bem-sucedida muda a situação da corrida (ex.: pode
    // ter passado dos 10.000 kg pra fechar) — uma mensagem de erro antiga
    // não faz mais sentido depois disso.
    const mensagem = container.querySelector(".fusao-forno-message");
    if (mensagem) mensagem.hidden = true;
    const row = cell.closest("tr");
    if (!row) return;
    row.dataset[kind] = valor ?? "";
    atualizarBadgeCarregamento(container);
  };
}
// Antes de confirmar a transferência (card do forno e corrida.html), mostra
// a situação atual do forno destino (corrida aberta, início, metal atual,
// capacidade) e o saldo estimado depois — pedido explícito, pra não
// estourar o forno sem o operador perceber. Sem corrida aberta no destino,
// deixa a RPC recusar com a mensagem dela (não duplica essa checagem aqui).
async function fusaoConfirmarTransferencia(fornoDestinoId, quantidadeKg) {
  const fornoDestino = fusaoState.fornos.find((f) => f.id === fornoDestinoId);
  const corridaDestino = await window.LIDUTEC_PRODUCAO_FUSAO_DATA.corridaAbertaDoForno(fornoDestinoId);
  if (!corridaDestino) return true;
  const metalAtual = fusaoState.volumeAtual[fornoDestinoId] ?? 0;
  const capacidade = fornoDestino?.capacidade_kg;
  const saldoDepois = metalAtual + quantidadeKg;
  const linhas = [
    fornoDestino?.nome || fornoDestino?.codigo || "Forno destino",
    `Corrida atual: ${fusaoCodigoCorridaMascarado(corridaDestino.codigo)}`,
    corridaDestino.inicio ? `Início: ${new Date(corridaDestino.inicio).toLocaleString("pt-BR")}` : null,
    `Metal atual: ${fusaoKg(metalAtual)} kg`,
    `Transferência solicitada: ${fusaoKg(quantidadeKg)} kg`,
    `Saldo após transferência: ${fusaoKg(saldoDepois)} kg`,
    capacidade != null ? `Capacidade: ${fusaoKg(capacidade)} kg` : null,
    capacidade != null && saldoDepois > capacidade ? "\nATENÇÃO: o saldo após a transferência ultrapassa a capacidade cadastrada!" : null
  ].filter(Boolean).join("\n");
  return confirm(`${linhas}\n\nConfirma a transferência para este forno?`);
}
function bindCorridaCard(container, forno, corrida) {
  const corridaId = Number(container.querySelector(".fusao-corrida-inline")?.dataset.corridaId);
  bindEditableCells(container, corridaId, fusaoOnSavedCard(container));
  bindProdutoEditavel(container, corridaId);
  bindNumeroEditavel(container, corrida, forno);
  bindTemperaturaProgramada(container, corrida);
  fusaoBindMensagens(container.querySelector(".fusao-mensagens"));
  // Delegado no container (sobrevive a re-render parcial da tabela ao
  // incluir material) — remove só o que ainda não foi pesado.
  container.addEventListener("click", async (event) => {
    const botao = event.target.closest(".fusao-remover-item");
    if (!botao) return;
    if (!confirm("Remover este material planejado? Essa ação não pode ser desfeita.")) return;
    const mensagem = container.querySelector(".fusao-forno-message");
    if (mensagem) mensagem.hidden = true;
    const itemId = Number(botao.dataset.itemId);
    botao.disabled = true;
    try {
      await window.LIDUTEC_PRODUCAO_FUSAO_DATA.removerItemCarga(corridaId, itemId);
      botao.closest("tr")?.remove();
      atualizarBadgeCarregamento(container);
    } catch (error) {
      botao.disabled = false;
      if (mensagem) { mensagem.textContent = error.message; mensagem.className = "form-message error"; mensagem.hidden = false; }
      else alert(error.message);
    }
  });
  // Remover/editar transferência — só funciona (a validação real é no RPC)
  // enquanto origem e destino ainda estiverem abertas. Depois de qualquer
  // mudança, redesenha todos os cards: a transferência mexe no resumo
  // (Entrada/Saída/Volume atual) dos dois fornos envolvidos.
  container.addEventListener("click", async (event) => {
    const removerBtn = event.target.closest(".fusao-remover-transferencia");
    const editarBtn = event.target.closest(".fusao-editar-transferencia");
    if (!removerBtn && !editarBtn) return;
    const linha = (removerBtn || editarBtn).closest("tr");
    const transferenciaId = Number(linha?.dataset.transferenciaId);
    const mensagem = container.querySelector(".fusao-forno-message");
    const atualizarTudo = async () => {
      if (mensagem) mensagem.hidden = true;
      await refreshVolumeAtual();
      await Promise.all(fusaoState.fornos.map((f) => renderFornoCard(f).catch(() => {})));
    };
    if (removerBtn) {
      if (!confirm("Remover esta transferência? Só é possível enquanto as duas corridas envolvidas estiverem abertas.")) return;
      removerBtn.disabled = true;
      try {
        await window.LIDUTEC_PRODUCAO_FUSAO_DATA.removerTransferencia(transferenciaId);
        await atualizarTudo();
      } catch (error) {
        removerBtn.disabled = false;
        if (mensagem) { mensagem.textContent = error.message; mensagem.className = "form-message error"; mensagem.hidden = false; }
        else alert(error.message);
      }
      return;
    }
    if (editarBtn.dataset.mode !== "salvar") {
      linha.querySelector(".fusao-transferencia-display").outerHTML =
        `<input type="number" min="0.01" step="0.01" class="fusao-transferencia-input" value="${linha.dataset.quantidadeKg}">`;
      editarBtn.dataset.mode = "salvar";
      editarBtn.textContent = "OK";
      editarBtn.title = "Salvar";
      linha.querySelector(".fusao-transferencia-input").focus();
      return;
    }
    const input = linha.querySelector(".fusao-transferencia-input");
    const quantidade = Number(input.value);
    editarBtn.disabled = true; input.disabled = true;
    try {
      if (!quantidade || quantidade <= 0) throw new Error("Informe uma quantidade maior que zero.");
      await window.LIDUTEC_PRODUCAO_FUSAO_DATA.editarTransferencia(transferenciaId, quantidade);
      await atualizarTudo();
    } catch (error) {
      editarBtn.disabled = false; input.disabled = false;
      if (mensagem) { mensagem.textContent = error.message; mensagem.className = "form-message error"; mensagem.hidden = false; }
      else alert(error.message);
    }
  });
  container.querySelectorAll("[data-acao]").forEach((button) => {
    button.addEventListener("click", async () => {
      const acao = button.dataset.acao;
      const mensagemAntiga = container.querySelector(".fusao-forno-message");
      if (mensagemAntiga) mensagemAntiga.hidden = true;
      button.disabled = true;
      try {
        const atual = await window.LIDUTEC_PRODUCAO_FUSAO_DATA.corridaAbertaDoForno(forno.id);
        if (!atual) throw new Error("Esta corrida não está mais aberta — a tela foi atualizada.");
        if (acao === "fechar") {
          // O horário de fim é sempre o primeiro informado — se a corrida já
          // foi fechada antes (reaberta pra corrigir algo), não pergunta de
          // novo: a RPC mantém o horário original de qualquer forma.
          let fimIso = atual.fim;
          if (!fimIso) {
            const hora = prompt("Horário de fim da corrida (HH:MM):", fusaoHoraAgora());
            if (hora === null) { button.disabled = false; return; }
            if (!/^\d{2}:\d{2}$/.test(hora)) throw new Error("Horário inválido. Use HH:MM.");
            fimIso = fusaoMontarDataHora(atual.data_operacional, hora);
          }
          // Escória/lingote/energia são salvos junto do fechamento, não têm
          // botão próprio — lidas da caixa na hora de fechar (pedido explícito).
          const escoria = container.querySelector(".fusao-saida-escoria")?.value;
          const lingote = container.querySelector(".fusao-saida-lingote")?.value;
          const energia = container.querySelector(".fusao-saida-energia")?.value;
          const ajuste = container.querySelector(".fusao-saida-ajuste")?.value;
          await window.LIDUTEC_PRODUCAO_FUSAO_DATA.atualizarSaidasDiversas(
            atual.id, escoria ? Number(escoria) : null, lingote ? Number(lingote) : null, energia ? Number(energia) : null, ajuste ? Number(ajuste) : null
          );
          await window.LIDUTEC_PRODUCAO_FUSAO_DATA.fecharCorrida(atual.id, atual.versao, fimIso);
        }
        await refreshVolumeAtual();
        await renderFornoCard(forno);
        await loadCorridasList();
      } catch (error) {
        const el = container.querySelector(".fusao-forno-message");
        if (el) { el.textContent = error.message; el.className = "form-message error"; el.hidden = false; }
        else alert(error.message);
        button.disabled = false;
      }
    });
  });
  // "Ajuste (saída)" tem botão OK próprio — não espera o fechamento da
  // corrida como escória/lingote/energia; ao salvar, atualiza os quatro
  // campos vizinhos juntos e recalcula o saldo do forno na hora.
  const ajusteInput = container.querySelector(".fusao-saida-ajuste");
  const salvarSaidasBtn = container.querySelector("[data-salvar-saidas]");
  if (ajusteInput && salvarSaidasBtn) {
    ajusteInput.addEventListener("focus", () => { salvarSaidasBtn.hidden = false; });
    ajusteInput.addEventListener("input", () => { salvarSaidasBtn.hidden = false; });
    salvarSaidasBtn.addEventListener("click", async () => {
      const mensagem = container.querySelector(".fusao-forno-message");
      if (mensagem) mensagem.hidden = true;
      salvarSaidasBtn.disabled = true;
      try {
        const escoria = container.querySelector(".fusao-saida-escoria")?.value;
        const lingote = container.querySelector(".fusao-saida-lingote")?.value;
        const energia = container.querySelector(".fusao-saida-energia")?.value;
        const ajuste = ajusteInput.value;
        await window.LIDUTEC_PRODUCAO_FUSAO_DATA.atualizarSaidasDiversas(
          corridaId, escoria ? Number(escoria) : null, lingote ? Number(lingote) : null, energia ? Number(energia) : null, ajuste ? Number(ajuste) : null
        );
        await refreshVolumeAtual();
        const resumoEl = container.querySelector(".fusao-resumo-corrida");
        if (resumoEl) {
          const transferenciaSaidaTotal = [...container.querySelectorAll(".fusao-transferencia-saida[data-quantidade-kg]")]
            .reduce((soma, row) => soma + fNumber(row.dataset.quantidadeKg), 0);
          const novaSaida = transferenciaSaidaTotal + fNumber(escoria) + fNumber(lingote) + fNumber(ajuste) + fNumber(resumoEl.dataset.panelasKg);
          resumoEl.dataset.saidaKg = novaSaida;
          const saidaEl = container.querySelector(".fusao-resumo-saida");
          if (saidaEl) saidaEl.innerHTML = `${fusaoKg(novaSaida)}<span class="fusao-resumo-unidade">Kg</span>`;
          atualizarBadgeCarregamento(container);
        }
        salvarSaidasBtn.hidden = true;
      } catch (error) {
        if (mensagem) { mensagem.textContent = error.message; mensagem.className = "form-message error"; mensagem.hidden = false; }
        else alert(error.message);
      } finally {
        salvarSaidasBtn.disabled = false;
      }
    });
  }
  // Incluir material numa corrida já aberta — o formulário fica aberto
  // depois de adicionar (só limpa os campos), pra dar pra incluir vários
  // materiais em sequência sem reabrir nada; as tabelas de cima atualizam
  // sozinhas, sem re-renderizar o card inteiro (o que fechava esse form).
  const rowsContainer = container.querySelector(".fusao-itens-rows");
  const toggleButton = container.querySelector("[data-toggle-add-item]");
  const criarLinhaIncluirMaterial = () => {
    rowsContainer.innerHTML = "";
    const row = novaCorridaItemRow();
    row.querySelector("button[data-remove-item]").remove();
    const confirmar = document.createElement("button");
    confirmar.type = "button";
    confirmar.className = "button button-primary";
    confirmar.textContent = "Adicionar";
    row.appendChild(confirmar);
    confirmar.addEventListener("click", async () => {
      // O card pode ter sido redesenhado em segundo plano (Realtime) enquanto
      // esse mini-formulário estava aberto — se o elemento não existe mais,
      // não trava a ação inteira (antes isso quebrava tudo silenciosamente,
      // sem mostrar nenhum erro).
      const el = container.querySelector(".fusao-forno-message");
      if (el) el.hidden = true;
      const materialInput = row.querySelector('[name="material_texto"]');
      const quantidadeInput = row.querySelector('[name="quantidade_planejada_kg"]');
      try {
        const material = fusaoMaterialDoInput(materialInput);
        const quantidade = Number(quantidadeInput.value);
        const estadoFisico = row.querySelector('[name="estado_fisico"]').value || null;
        if (!material || !quantidade) throw new Error("Selecione o material e informe a quantidade.");
        confirmar.disabled = true;
        const atual = await window.LIDUTEC_PRODUCAO_FUSAO_DATA.corridaAbertaDoForno(forno.id);
        if (!atual) throw new Error("Esta corrida não está mais aberta — a tela foi atualizada.");
        await window.LIDUTEC_PRODUCAO_FUSAO_DATA.adicionarItemCarga(atual.id, material.id, quantidade, estadoFisico);
        const [itensAtualizados, transferenciasAtuais] = await Promise.all([
          window.LIDUTEC_PRODUCAO_FUSAO_DATA.cargaItens(atual.id),
          window.LIDUTEC_PRODUCAO_FUSAO_DATA.transferenciasDaCorrida(atual.id)
        ]);
        const { html } = fusaoTabelasCargaHtml(itensAtualizados, transferenciasAtuais);
        const tabelasEl = container.querySelector(".fusao-tabelas-carga");
        if (tabelasEl) tabelasEl.innerHTML = html;
        bindEditableCells(container, atual.id, fusaoOnSavedCard(container));
        atualizarBadgeCarregamento(container);
        materialInput.value = "";
        delete materialInput.dataset.selecionadoId;
        quantidadeInput.value = "";
        row.querySelector('[name="estado_fisico"]').hidden = true;
        materialInput.focus();
      } catch (error) {
        if (el) { el.textContent = error.message; el.className = "form-message error"; el.hidden = false; }
        else alert(error.message);
      } finally {
        confirmar.disabled = false;
      }
    });
    rowsContainer.appendChild(row);
  };
  toggleButton?.addEventListener("click", () => {
    if (rowsContainer.hidden) {
      rowsContainer.hidden = false;
      criarLinhaIncluirMaterial();
    } else {
      rowsContainer.hidden = true;
    }
  });

  // Transferir metal pra outro forno — parcial ou total; pra mandar pra
  // mais de um forno, o operador repete a ação (uma transferência por vez).
  const transferirRows = container.querySelector(".fusao-transferir-rows");
  const toggleTransferirButton = container.querySelector("[data-toggle-transferir]");
  const criarLinhaTransferir = () => {
    transferirRows.innerHTML = "";
    const fornosDestino = fusaoState.fornos.filter((f) => f.id !== forno.id);
    const row = document.createElement("div");
    row.className = "fusao-item-row";
    row.innerHTML = `<select name="forno_destino_id" required><option value="">Forno destino</option>${fornosDestino.map((f) => `<option value="${f.id}">${fEsc(f.codigo)} — ${fEsc(f.nome)}</option>`).join("")}</select>
      <input name="quantidade_kg" type="number" min="0.01" step="0.01" placeholder="Qtd (kg)" required>
      <button type="button" class="button button-primary">Transferir</button>`;
    const confirmar = row.querySelector("button");
    confirmar.addEventListener("click", async () => {
      // Mesma proteção: o card pode ter sido redesenhado em segundo plano
      // enquanto esse mini-formulário estava aberto (por isso "não ia" sem
      // erro nenhum aparecer — a exceção acontecia antes do try/catch).
      const el = container.querySelector(".fusao-forno-message");
      if (el) el.hidden = true;
      try {
        const fornoDestinoId = Number(row.querySelector('[name="forno_destino_id"]').value);
        const quantidade = Number(row.querySelector('[name="quantidade_kg"]').value);
        if (!fornoDestinoId || !quantidade) throw new Error("Selecione o forno destino e informe a quantidade.");
        if (!(await fusaoConfirmarTransferencia(fornoDestinoId, quantidade))) return;
        confirmar.disabled = true;
        const atual = await window.LIDUTEC_PRODUCAO_FUSAO_DATA.corridaAbertaDoForno(forno.id);
        if (!atual) throw new Error("Esta corrida não está mais aberta — a tela foi atualizada.");
        await window.LIDUTEC_PRODUCAO_FUSAO_DATA.transferirMetal(atual.id, fornoDestinoId, quantidade);
        await refreshVolumeAtual();
        await renderFornoCard(forno);
        // Forno destino pode estar no mesmo painel — atualiza na hora, sem
        // esperar a sincronização de tempos em tempos.
        const fornoDestino = fusaoState.fornos.find((f) => f.id === fornoDestinoId);
        if (fornoDestino) await renderFornoCard(fornoDestino).catch(() => {});
      } catch (error) {
        if (el) { el.textContent = error.message; el.className = "form-message error"; el.hidden = false; }
        else alert(error.message);
        confirmar.disabled = false;
      }
    });
    transferirRows.appendChild(row);
  };
  toggleTransferirButton?.addEventListener("click", () => {
    if (transferirRows.hidden) {
      transferirRows.hidden = false;
      criarLinhaTransferir();
    } else {
      transferirRows.hidden = true;
    }
  });
}
// Realtime do painel de fornos: só a linha do item que mudou é redesenhada
// dentro do card da corrida aberta correspondente (Ponte pesando, outro
// supervisor editando/incluindo material) — sem re-render do card inteiro
// nem consulta periódica de todos os fornos.
function patchIndexCargaItemRow(item) {
  const inline = fq(`.fusao-corrida-inline[data-corrida-id="${item.corrida_id}"]`);
  if (!inline) return; // essa corrida não está sendo exibida neste momento
  const row = inline.querySelector(`tr[data-item-id="${item.id}"]`);
  if (!row) return; // material incluído por outro usuário — pega na próxima abertura/recarga do card
  if (row.querySelector(".fusao-editable-input")) return; // usuário está editando essa linha agora
  row.outerHTML = fusaoCardRowHtml(item);
  const card = inline.closest(".fusao-forno-card");
  if (!card) return;
  bindEditableCells(inline, item.corrida_id, fusaoOnSavedCard(card));
  atualizarBadgeCarregamento(card);
}
function handleIndexCargaItemChange(payload) {
  if (payload.eventType === "DELETE") return;
  const novo = payload.new;
  const material = fusaoState.materiais.find((m) => m.id === novo.material_id);
  if (!material) {
    // Material fora da lista de ativos (raro) — recarrega só o card certo
    // em vez de arriscar mostrar nome ou tabela errados.
    const inline = fq(`.fusao-corrida-inline[data-corrida-id="${novo.corrida_id}"]`);
    const card = inline?.closest(".fusao-forno-card");
    const forno = card ? fusaoState.fornos.find((f) => f.id === Number(card.dataset.fornoCard)) : null;
    if (forno) renderFornoCard(forno).catch(() => {});
    return;
  }
  patchIndexCargaItemRow({
    id: novo.id, corrida_id: Number(novo.corrida_id), material_id: novo.material_id,
    quantidade_planejada_kg: novo.quantidade_planejada_kg, quantidade_realizada_kg: novo.quantidade_realizada_kg,
    estado_fisico: novo.estado_fisico,
    materiais_fusao: { nome: material.nome, tipo: material.tipo, modo_pesagem: material.modo_pesagem }
  });
}
function handleIndexCorridaChange(payload) {
  const fornoId = (payload.new || payload.old)?.forno_id;
  const forno = fusaoState.fornos.find((f) => f.id === fornoId);
  if (!forno) return;
  refreshVolumeAtual().then(() => renderFornoCard(forno)).catch(() => {});
}
// Transferência feita por outro usuário/dispositivo — atualiza o volume de
// todos os fornos na hora (não dá pra saber os 2 fornos envolvidos sem
// mais uma consulta, e como é um evento raro, atualizar todo o painel sai
// mais barato do que ficar mapeando corrida->forno).
function handleIndexTransferenciaChange() {
  refreshVolumeAtual()
    .then(() => fusaoState.fornos.forEach((forno) => renderFornoCard(forno).catch(() => {})))
    .catch(() => {});
}
// Mensagem nova (ex.: mandada pela Ponte) — redesenha só o card do forno
// dessa corrida, achado pelo data-forno-id já gravado no card.
function handleIndexMensagemInsert(payload) {
  fusaoAtualizarPainelMensagens(payload.new?.corrida_id).catch(() => {});
}
// Local + Realtime podem chamar isso quase ao mesmo tempo (ex.: acabou de
// criar a corrida e o evento da própria criação chega logo em seguida) —
// sem essa trava, as duas chamadas se intercalam (innerHTML de uma limpa
// o que a outra já tinha inserido) e o card acaba com linha em dobro. Só a
// chamada mais recente pra esse forno tem permissão de mexer no DOM.
const fusaoRenderTokenPorForno = {};
async function renderFornoCard(forno) {
  const card = fq(`[data-forno-card="${forno.id}"]`);
  if (!card) return;
  const focusWasInside = card.contains(document.activeElement);
  if (focusWasInside) return; // não pisa em cima de quem está digitando
  const token = (fusaoRenderTokenPorForno[forno.id] = (fusaoRenderTokenPorForno[forno.id] || 0) + 1);
  const corridaAberta = await window.LIDUTEC_PRODUCAO_FUSAO_DATA.corridaAbertaCompletaDoForno(forno.id);
  let retornosDisa = [];
  if (corridaAberta) {
    const [retornos, lingotes] = await Promise.all([
      window.LIDUTEC_PRODUCAO_FUSAO_DATA.panelasRetornadasParaCorrida(corridaAberta.id),
      window.LIDUTEC_PRODUCAO_FUSAO_DATA.lingotamentosParaCorrida(corridaAberta.id)
    ]);
    retornosDisa = [...retornos, ...lingotes];
  }
  const volumeAtualKg = fusaoState.volumeAtual[forno.id] ?? 0;
  const corridaHtml = corridaAberta ? corridaCardHtml(corridaAberta, volumeAtualKg, retornosDisa) : null;
  if (fusaoRenderTokenPorForno[forno.id] !== token) return; // uma chamada mais nova já assumiu
  const tipoChipClasse = forno.tipo === "HOLDING" ? "holding" : "fusor";
  card.innerHTML = `<h3>${fEsc(forno.nome)} <span class="fusao-forno-chip fusao-forno-chip--${tipoChipClasse}">${fEsc(forno.codigo)}</span></h3>`;
  if (corridaAberta) {
    card.insertAdjacentHTML("beforeend", corridaHtml);
    bindCorridaCard(card, forno, corridaAberta);
    return;
  }
  card.classList.remove("is-good", "is-warning", "is-critical");
  card.insertAdjacentHTML("beforeend", fornoFormHtml(forno, volumeAtualKg));
  await bindFornoForm(card.querySelector(".fusao-forno-form"), forno);
}
async function initializeFusaoIndex() {
  const turnoSelect = fq("#fusao-turno-global");
  const dataInput = fq("#fusao-data-global");
  if (turnoSelect && dataInput) {
    const shift = window.LIDUTEC_TURNOS.determineShift();
    turnoSelect.value = shift.codigo;
    dataInput.value = shift.dataOperacional;
  }
  const grid = fq("#fornos-grid");
  grid.innerHTML = fusaoState.fornos.map((forno) =>
    `<article class="panel fusao-forno-card" data-forno-card="${forno.id}"></article>`
  ).join("");
  // "Corridas recentes" carrega junto com os cards, não depois — não
  // depende deles, então não precisa esperar (era uma viagem a mais em
  // série no carregamento da tela).
  initializeFusaoCorridasFiltro();
  await Promise.all([
    ...fusaoState.fornos.map((forno) => renderFornoCard(forno).catch((error) => alert(error.message))),
    loadCorridasList()
  ]);
  const retornoPainel = fq("#fusao-retorno-flutuante");
  if (retornoPainel) {
    fusaoTornarArrastavel(retornoPainel, fq("#fusao-retorno-flutuante-header"));
    await fusaoAtualizarRetornoFlutuante().catch(() => {});
    setInterval(() => {
      const focoDentro = document.activeElement?.closest("#fusao-retorno-flutuante");
      if (!focoDentro) fusaoAtualizarRetornoFlutuante().catch(() => {});
    }, 20000);
  }
  const lingotamentoPainel = fq("#fusao-lingotamento-flutuante");
  if (lingotamentoPainel) {
    fusaoTornarArrastavel(lingotamentoPainel, fq("#fusao-lingotamento-flutuante-header"));
    await fusaoAtualizarLingotamentoFlutuante().catch(() => {});
    setInterval(() => {
      const focoDentro = document.activeElement?.closest("#fusao-lingotamento-flutuante");
      if (!focoDentro) fusaoAtualizarLingotamentoFlutuante().catch(() => {});
    }, 20000);
  }
  // Corrida aberta atualiza sozinha (reflete o que a Ponte for registrando,
  // ou outro supervisor editando) via Realtime — só a linha/card que mudou
  // de fato é redesenhado, sem consultar todos os fornos de tempos em
  // tempos (ver conversa sobre o "pisca" da tela de planejamento).
  const canalIndex = window.supabaseClient
    .channel("fusao-index")
    .on("postgres_changes", { event: "*", schema: "public", table: "corridas_fusao_carga_itens" }, handleIndexCargaItemChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "corridas_fusao" }, handleIndexCorridaChange)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "transferencias_fusao" }, handleIndexTransferenciaChange)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "corridas_fusao_mensagens" }, handleIndexMensagemInsert)
    .subscribe();
  window.addEventListener("pagehide", () => window.supabaseClient.removeChannel(canalIndex), { once: true });
  // Rede de segurança: cobre só o caso raro de perder um evento (reconexão).
  setInterval(() => {
    refreshVolumeAtual()
      .then(() => fusaoState.fornos.forEach((forno) => renderFornoCard(forno).catch(() => {})))
      .catch(() => {});
  }, 180000);
}

// ---------------------------------------------------------------------------
// Tela "corrida" — carga (planejado × realizado), adições e status. Vários
// papéis mexem ao mesmo tempo, então cada campo salva sozinho (RPC própria)
// em vez de um "salvar tudo" — ver comentário na migração
// 202608260001_modulo_fusao_fase1.sql.
// ---------------------------------------------------------------------------
function fusaoCorridaId() {
  return new URLSearchParams(location.search).get("id");
}
function renderCorridaStepper(corrida) {
  const cls = corrida.status === "FECHADA" ? "is-done" : "is-current";
  fq("#corrida-stepper").innerHTML = `<span class="fusao-status-step ${cls}">${FUSAO_STATUS_NOMES[corrida.status] || corrida.status}</span>`;
}
function renderCorridaStatusActions(corrida) {
  const container = fq("#corrida-status-actions");
  const podeEditar = fusaoState.permissions.has("producao_fusao.lancar");
  if (!podeEditar) { container.innerHTML = ""; return; }
  const botoes = [];
  if (corrida.status === "ABERTA") {
    botoes.push(`<button type="button" class="button button-primary" data-acao="fechar">Fechar corrida</button>`);
    botoes.push(`<button type="button" class="button button-danger" data-acao="excluir">Excluir corrida</button>`);
  }
  if (corrida.status === "FECHADA") botoes.push(`<button type="button" class="button button-secondary" data-acao="reabrir">Editar (reabrir)</button>`);
  container.innerHTML = botoes.join("");
  container.querySelectorAll("[data-acao]").forEach((button) => {
    button.addEventListener("click", () => executarAcaoCorrida(button.dataset.acao));
  });
}
async function executarAcaoCorrida(acao) {
  if (acao === "excluir" && !confirm("Excluir esta corrida? Essa ação não pode ser desfeita.")) return;
  fq("#corrida-status-message").hidden = true;
  try {
    const corrida = await window.LIDUTEC_PRODUCAO_FUSAO_DATA.corrida(fusaoCorridaId());
    if (acao === "fechar") {
      // Mesma regra do card: horário de fim é sempre o primeiro informado.
      let fimIso = corrida.fim;
      if (!fimIso) {
        const hora = prompt("Horário de fim da corrida (HH:MM):", fusaoHoraAgora());
        if (hora === null) return;
        if (!/^\d{2}:\d{2}$/.test(hora)) throw new Error("Horário inválido. Use HH:MM.");
        fimIso = fusaoMontarDataHora(corrida.data_operacional, hora);
      }
      await window.LIDUTEC_PRODUCAO_FUSAO_DATA.fecharCorrida(fusaoCorridaId(), corrida.versao, fimIso);
    }
    if (acao === "reabrir") await window.LIDUTEC_PRODUCAO_FUSAO_DATA.reabrirCorrida(fusaoCorridaId(), corrida.versao);
    if (acao === "excluir") {
      await window.LIDUTEC_PRODUCAO_FUSAO_DATA.excluirCorrida(fusaoCorridaId(), corrida.versao);
      // A corrida não existe mais — não dá pra recarregar esta tela.
      location.href = "./index.html";
      return;
    }
    await loadCorridaDetail();
  } catch (error) {
    const el = fq("#corrida-status-message");
    const isConflito = /CONFLITO_RASCUNHO|40001/i.test(`${error.message || ""} ${error.code || ""}`);
    el.textContent = isConflito ? "Esta corrida foi atualizada por outro usuário — a tela foi recarregada." : error.message;
    el.className = "form-message error"; el.hidden = false;
    if (isConflito) await loadCorridaDetail();
  }
}
function fusaoSaldoCell(planejado, realizado) {
  if (realizado == null) return `<span class="production-muted">—</span>`;
  const saldo = fNumber(planejado) - fNumber(realizado);
  const cls = saldo < 0 ? "fusao-saldo-negativo" : "fusao-saldo-positivo";
  return `<span class="${cls}">${saldo.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}</span>`;
}
function fusaoDataHoraCurta(iso) {
  return iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
}
// Quem planejou (criado_por, na inclusão) e quem pesou (agrupados numa
// linha só, abaixo do material, pra não precisar de mais 2 colunas). Pesou
// lista TODO MUNDO que contribuiu (log da Ponte, item pode ser pesado em
// mais de uma leva por gente diferente) — se não tem log (item Direto,
// editado de uma vez só), cai pra "quem editou por último".
function fusaoOperadorInfoHtml(item) {
  const planejou = item.criado_por_usuario?.nome
    ? `Planejado por <strong>${fEsc(item.criado_por_usuario.nome)}</strong> (${fusaoDataHoraCurta(item.criado_em)})`
    : null;
  const log = item.corridas_fusao_pesagens_ponte_log || [];
  let pesou = null;
  if (log.length) {
    const grupos = fusaoAgruparPesagens(log).map(fusaoResumoOperadorHtml).join(", ");
    pesou = `Pesado por ${grupos}`;
  } else if (item.quantidade_realizada_kg != null && item.atualizado_por_usuario?.nome) {
    pesou = `Pesado por <strong>${fEsc(item.atualizado_por_usuario.nome)}</strong> (${fusaoDataHoraCurta(item.atualizado_em)})`;
  }
  const partes = [planejou, pesou].filter(Boolean);
  return partes.length ? `<span class="production-muted fusao-operador-info">${partes.join(" · ")}</span>` : "";
}
function cargaRowHtml(item, podeEditar) {
  const estadoLabel = { SOLIDO: "Sólido", LIQUIDO: "Líquido" };
  const info = fusaoOperadorInfoHtml(item);
  return `<tr data-item-id="${item.id}">
      <td>${fEsc(item.materiais_fusao?.nome || "")}${item.estado_fisico ? ` <span class="production-muted">(${estadoLabel[item.estado_fisico] || item.estado_fisico})</span>` : ""}</td>
      <td>${podeEditar ? fusaoEditableCellHtml("planejado", item) : fNumber(item.quantidade_planejada_kg).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}</td>
      <td>${podeEditar ? fusaoEditableCellHtml("realizado", item) : (item.quantidade_realizada_kg != null ? fNumber(item.quantidade_realizada_kg).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "—")}</td>
      <td class="fusao-saldo-cell">${fusaoSaldoCell(item.quantidade_planejada_kg, item.quantidade_realizada_kg)}</td>
    </tr>${info ? `<tr class="fusao-info-row" data-item-id="${item.id}"><td colspan="4">${info}</td></tr>` : ""}`;
}
// Total (Planejado/Realizado/Saldo) no rodapé da tabela de carga da
// corrida — pedido explícito, mesmo padrão do total já usado no card.
// Realizado do total soma também as transferências (entrada soma, saída
// abate) — senão uma corrida só com transferência (comum no Holding)
// ficava sem total nenhum, mesmo tendo linhas na tabela.
function cargaTotalRealizado(itens, transferencias, retornoKg = 0, panelasRetiradasKg = 0) {
  return itens.reduce((soma, i) => soma + fNumber(i.quantidade_realizada_kg), 0)
    + (transferencias?.entradas || []).reduce((soma, t) => soma + fNumber(t.quantidade_kg), 0)
    - (transferencias?.saidas || []).reduce((soma, t) => soma + fNumber(t.quantidade_kg), 0)
    + fNumber(retornoKg) - fNumber(panelasRetiradasKg);
}
function cargaTotalRowHtml(itens, transferencias, retornoKg = 0, panelasRetiradasKg = 0) {
  const planejado = itens.reduce((soma, i) => soma + fNumber(i.quantidade_planejada_kg), 0);
  const realizado = cargaTotalRealizado(itens, transferencias, retornoKg, panelasRetiradasKg);
  return `<tr class="fusao-tabela-total-row" id="carga-total-row">
      <td><strong>Total</strong></td>
      <td><strong class="fusao-total-planejado">${fusaoKg(planejado)}</strong></td>
      <td><strong class="fusao-total-realizado">${fusaoKg(realizado)}</strong></td>
      <td class="fusao-saldo-cell">${fusaoSaldoCell(planejado, realizado)}</td>
    </tr>`;
}
function atualizarTotalCarga(itens) {
  const totalRow = fq("#carga-total-row");
  if (!totalRow) return;
  const retornoKg = (fusaoCorridaCache.retornosDisa || []).reduce((soma, p) => soma + fNumber(p.peso_kg), 0);
  const panelasRetiradasKg = (fusaoCorridaCache.panelasHolding || []).reduce((soma, p) => soma + fNumber(p.peso_kg), 0);
  const planejado = itens.reduce((soma, i) => soma + fNumber(i.quantidade_planejada_kg), 0);
  const realizado = cargaTotalRealizado(itens, fusaoCorridaCache.transferencias, retornoKg, panelasRetiradasKg);
  totalRow.querySelector(".fusao-total-planejado").textContent = fusaoKg(planejado);
  totalRow.querySelector(".fusao-total-realizado").textContent = fusaoKg(realizado);
  totalRow.querySelector(".fusao-saldo-cell").innerHTML = fusaoSaldoCell(planejado, realizado);
}
function cargaOnSaved(itens) {
  return (cell, kind, valor) => {
    // Mesma lógica do card: uma edição bem-sucedida pode ter mudado se dá
    // pra fechar a corrida agora, então uma mensagem de erro antiga (ex.:
    // "precisa movimentar mais de 10.000 kg") não vale mais.
    fq("#corrida-status-message").hidden = true;
    const row = cell.closest("tr");
    const itemId = Number(row.dataset.itemId);
    const item = itens.find((i) => i.id === itemId);
    if (item) {
      if (kind === "planejado") item.quantidade_planejada_kg = valor;
      if (kind === "realizado") item.quantidade_realizada_kg = valor;
      row.querySelector(".fusao-saldo-cell").innerHTML = fusaoSaldoCell(item.quantidade_planejada_kg, item.quantidade_realizada_kg);
      atualizarTotalCarga(itens);
    }
  };
}
// Transferência vira linha no topo/rodapé da tabela de carga — mesma ideia
// do card do índice, só que na tabela de 4 colunas desta tela (sem coluna
// de progresso/ações). Sem isso, metal recebido por transferência (comum
// no Holding) não aparecia em lugar nenhum aqui.
function transferenciaRowCorridaHtml(direcao, transferencia) {
  const rotulo = direcao === "saida" ? "Saída" : "Entrada";
  return `<tr class="fusao-transferencia-row fusao-transferencia-${direcao}">
      <td colspan="2">TRANSFERÊNCIA (${rotulo}) ${fEsc(fusaoCodigoCorridaMascarado(transferencia.corridaCodigo) || "—")}</td>
      <td>${fNumber(transferencia.quantidade_kg).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}</td>
      <td>—</td>
    </tr>`;
}
// Mesma ideia da linha "Retorno Disa" do card do índice, só que consolidada
// numa única linha (quantidade de panelas + kg total) em vez de uma linha
// por panela — pedido explícito pra não poluir a tabela.
function retornoDisaRowCorridaHtml(quantidadePanelas, quantidadeKg) {
  return `<tr class="fusao-transferencia-row fusao-transferencia-entrada">
      <td colspan="2">RETORNO DISA (${quantidadePanelas} panela${quantidadePanelas === 1 ? "" : "s"})</td>
      <td>${fNumber(quantidadeKg).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}</td>
      <td>—</td>
    </tr>`;
}
// Mesma ideia, só que saída (vermelho) — panela retirada do Holding.
function panelasRetiradasRowCorridaHtml(quantidadePanelas, quantidadeKg) {
  return `<tr class="fusao-transferencia-row fusao-transferencia-saida">
      <td colspan="2">PANELAS RETIRADAS (${quantidadePanelas} panela${quantidadePanelas === 1 ? "" : "s"})</td>
      <td>${fNumber(quantidadeKg).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}</td>
      <td>—</td>
    </tr>`;
}
async function renderCargaTable(itens, corrida) {
  const podeEditar = fusaoState.permissions.has("producao_fusao.lancar") && corrida.status === "ABERTA";
  const transferencias = fusaoCorridaCache.transferencias;
  const entradaLinhas = (transferencias?.entradas || []).map((t) => transferenciaRowCorridaHtml("entrada", t));
  const saidaLinhas = (transferencias?.saidas || []).map((t) => transferenciaRowCorridaHtml("saida", t));
  const retornosDisa = fusaoCorridaCache.retornosDisa || [];
  const retornoKg = retornosDisa.reduce((soma, p) => soma + fNumber(p.peso_kg), 0);
  const retornoLinhas = retornosDisa.length ? [retornoDisaRowCorridaHtml(retornosDisa.length, retornoKg)] : [];
  const panelasRetiradas = fusaoCorridaCache.panelasHolding || [];
  const panelasRetiradasKg = panelasRetiradas.reduce((soma, p) => soma + fNumber(p.peso_kg), 0);
  const panelasRetiradasLinhas = panelasRetiradas.length ? [panelasRetiradasRowCorridaHtml(panelasRetiradas.length, panelasRetiradasKg)] : [];
  const temAlgumaLinha = itens.length || entradaLinhas.length || saidaLinhas.length || retornoLinhas.length || panelasRetiradasLinhas.length;
  fq("#carga-rows").innerHTML = entradaLinhas.join("") + retornoLinhas.join("") + itens.map((item) => cargaRowHtml(item, podeEditar)).join("") + saidaLinhas.join("") + panelasRetiradasLinhas.join("")
    + (temAlgumaLinha ? cargaTotalRowHtml(itens, transferencias, retornoKg, panelasRetiradasKg) : "");
  if (!podeEditar) return;
  bindEditableCells(fq("#carga-rows"), fusaoCorridaId(), cargaOnSaved(itens));
}
// Realtime da carga: só a linha do item que mudou é redesenhada (Ponte
// pesando, supervisor incluindo/editando material) — o resto da tabela
// nem é tocado. Uma linha com célula em edição (foco) não é sobrescrita.
function patchCargaItemRow(item) {
  const podeEditar = fusaoState.permissions.has("producao_fusao.lancar") && fusaoCorridaCache.corrida?.status === "ABERTA";
  const row = fq(`#carga-rows tr[data-item-id="${item.id}"]`);
  if (row?.querySelector(".fusao-editable-input")) return;
  if (row) {
    // A linha de info (planejado/pesado por) vem logo depois — some junto
    // com a principal, senão fica uma duplicada quando reinsere as duas.
    if (row.nextElementSibling?.classList.contains("fusao-info-row")) row.nextElementSibling.remove();
    row.outerHTML = cargaRowHtml(item, podeEditar);
  } else {
    // Material novo entra antes da linha de Total (senão apareceria
    // embaixo dela) — se ainda não existe total (primeiro item), cria.
    const totalRow = fq("#carga-total-row");
    if (totalRow) totalRow.insertAdjacentHTML("beforebegin", cargaRowHtml(item, podeEditar));
    else fq("#carga-rows").insertAdjacentHTML("beforeend", cargaRowHtml(item, podeEditar) + cargaTotalRowHtml(fusaoCorridaCache.itens, fusaoCorridaCache.transferencias));
  }
  atualizarTotalCarga(fusaoCorridaCache.itens);
  if (podeEditar) bindEditableCells(fq("#carga-rows"), fusaoCorridaId(), cargaOnSaved(fusaoCorridaCache.itens));
}
function handleCargaItemRealtimeChange(payload) {
  if (payload.eventType === "DELETE") return;
  const novo = payload.new;
  const material = fusaoState.materiais.find((m) => m.id === novo.material_id);
  const idx = fusaoCorridaCache.itens.findIndex((i) => i.id === novo.id);
  const anterior = fusaoCorridaCache.itens[idx];
  // Realtime só traz colunas cruas (uuid), não o nome já unido via join —
  // se foi o próprio usuário que mexeu, já sabemos o nome; senão mantém o
  // que já estava em cache (só fica desatualizado se for outro usuário
  // pesando, corrige sozinho na próxima recarga/"Atualizar").
  const atualizadoPorUsuario = novo.atualizado_por === fusaoState.user?.id
    ? { nome: fusaoState.userNome }
    : anterior?.atualizado_por_usuario ?? null;
  const item = {
    id: novo.id, material_id: novo.material_id,
    quantidade_planejada_kg: novo.quantidade_planejada_kg, quantidade_realizada_kg: novo.quantidade_realizada_kg,
    estado_fisico: novo.estado_fisico, criado_em: novo.criado_em, atualizado_em: novo.atualizado_em,
    criado_por_usuario: anterior?.criado_por_usuario ?? null,
    atualizado_por_usuario: atualizadoPorUsuario,
    corridas_fusao_pesagens_ponte_log: anterior?.corridas_fusao_pesagens_ponte_log,
    materiais_fusao: material ? { nome: material.nome, tipo: material.tipo, modo_pesagem: material.modo_pesagem } : anterior?.materiais_fusao
  };
  if (idx >= 0) fusaoCorridaCache.itens[idx] = item; else fusaoCorridaCache.itens.push(item);
  patchCargaItemRow(item);
}
function fusaoCorridaStatusLinhaTexto(corrida) {
  const produto = fusaoState.produtos.find((p) => p.id === corrida.produto_id) || corrida.produtos;
  return `Status atual: ${FUSAO_STATUS_NOMES[corrida.status] || corrida.status}` +
    ` · Produto: ${fusaoProdutoLabel(produto)}` +
    (corrida.inicio ? ` · Início: ${new Date(corrida.inicio).toLocaleString("pt-BR")}` : "") +
    (corrida.fim ? ` · Fim: ${new Date(corrida.fim).toLocaleString("pt-BR")}` : "");
}
function handleCorridaRealtimeChange(payload) {
  fusaoCorridaCache.corrida = { ...fusaoCorridaCache.corrida, ...payload.new };
  fq("#corrida-status-linha").textContent = fusaoCorridaStatusLinhaTexto(fusaoCorridaCache.corrida);
  renderCorridaStepper(fusaoCorridaCache.corrida);
  renderCorridaStatusActions(fusaoCorridaCache.corrida);
  renderCargaTable(fusaoCorridaCache.itens, fusaoCorridaCache.corrida);
  renderResumoCorrida();
  const adicaoForm = fq("#adicao-form");
  if (adicaoForm) adicaoForm.hidden = fusaoCorridaCache.corrida.status !== "ABERTA";
  const transferirPanel = fq("#transferir-panel");
  if (transferirPanel) transferirPanel.hidden = fusaoCorridaCache.corrida.status !== "ABERTA";
}
// Mesmo resumo (Peso Inicial/Entrada/Saída/Volume atual) do card do forno,
// agora também na tela da corrida — pedido explícito.
// Escória/Lingote/Energia/Ajuste só existem depois que a corrida já
// começou (nunca na abertura) — pedido explícito: deixar visível na tela
// da corrida o que foi ajustado, já que o resumo só mostra o total
// agregado em "Saída".
function fusaoAjustesRegistradosHtml(corrida) {
  const campos = [
    ["Escória (kg)", corrida.escoria_kg],
    ["Lingote (kg)", corrida.lingote_kg],
    ["Energia (kWh)", corrida.energia_kwh],
    ["Ajuste — saída (kg)", corrida.ajuste_kg]
  ].filter(([, valor]) => valor != null);
  if (!campos.length) return "";
  return `<p class="fusao-ajustes-registrados"><strong>Ajustes registrados:</strong> ${campos
    .map(([label, valor]) => `${label} ${fusaoKg(valor)}`).join(" · ")}</p>`;
}
function renderResumoCorrida() {
  const el = fq("#corrida-resumo");
  if (!el || !fusaoCorridaCache.corrida) return;
  const volumeAtualKg = fusaoState.volumeAtual[fusaoCorridaCache.corrida.forno_id] ?? 0;
  const panelasHoldingKg = (fusaoCorridaCache.panelasHolding || []).reduce((soma, p) => soma + fNumber(p.peso_kg), 0);
  const retornadoKg = (fusaoCorridaCache.retornosDisa || []).reduce((soma, p) => soma + fNumber(p.peso_kg), 0);
  el.innerHTML = fusaoResumoCorridaHtml(fusaoCorridaCache.corrida, fusaoCorridaCache.itens, fusaoCorridaCache.transferencias, volumeAtualKg, panelasHoldingKg, retornadoKg);
  const ajustesEl = fq("#corrida-ajustes");
  if (ajustesEl) ajustesEl.innerHTML = fusaoAjustesRegistradosHtml(fusaoCorridaCache.corrida);
}
async function refreshResumoCorrida() {
  const transferencias = await window.LIDUTEC_PRODUCAO_FUSAO_DATA.transferenciasDaCorrida(fusaoCorridaId());
  fusaoCorridaCache.transferencias = transferencias;
  await refreshVolumeAtual();
  renderResumoCorrida();
  // As linhas de transferência (e o total) da tabela de carga também
  // dependem disso — sem isso, uma transferência nova só aparecia depois
  // de recarregar a página inteira.
  if (fusaoCorridaCache.corrida) await renderCargaTable(fusaoCorridaCache.itens, fusaoCorridaCache.corrida);
}
async function refreshMensagensCorrida() {
  await fusaoAtualizarPainelMensagens(fusaoCorridaId());
}
// Alteração da carga chegou via Realtime — recarrega a lista (o payload cru
// não traz o nome do autor já unido, mais simples reconsultar do que
// resolver o uuid na mão).
async function refreshAlteracoesCorrida() {
  const alteracoes = await window.LIDUTEC_PRODUCAO_FUSAO_DATA.alteracoesDaCorrida(fusaoCorridaId());
  const el = fq("#alteracoes-painel");
  if (el) el.innerHTML = fusaoAlteracoesPainelHtml(fusaoCorridaId(), alteracoes);
}
// Nova entrega na Ponte pra um material desta corrida — recarrega a carga
// pra "Pesado por" listar o novo nome/horário junto com quem já pesou.
async function refreshCargaItens() {
  const itens = await window.LIDUTEC_PRODUCAO_FUSAO_DATA.cargaItens(fusaoCorridaId());
  fusaoCorridaCache.itens = itens;
  await renderCargaTable(itens, fusaoCorridaCache.corrida);
}
function handleAdicaoRealtimeInsert(payload) {
  const novo = payload.new;
  const material = fusaoState.materiais.find((m) => m.id === novo.material_id);
  fq("#adicoes-rows").insertAdjacentHTML("afterbegin", `<tr>
      <td>${new Date(novo.adicionado_em).toLocaleString("pt-BR")}</td>
      <td>${fEsc(material?.nome || "")}</td>
      <td>${fNumber(novo.quantidade_kg).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}</td>
    </tr>`);
  fq("#adicoes-empty").hidden = true;
}
async function renderAdicoes(adicoes) {
  fq("#adicoes-rows").innerHTML = adicoes.map((item) => `<tr>
      <td>${new Date(item.adicionado_em).toLocaleString("pt-BR")}</td>
      <td>${fEsc(item.materiais_fusao?.nome || "")}</td>
      <td>${fNumber(item.quantidade_kg).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}</td>
    </tr>`).join("");
  fq("#adicoes-empty").hidden = adicoes.length > 0;
}
// Histórico de panelas retiradas — só aparece na corrida de um Holding.
// Leitura simples (sem edição, essa fica na tela dedicada do Holding).
const PANELA_HOLDING_STATUS_NOMES_CORRIDA = {
  SAIDA_HOLDING: "Saída Holding", EM_TRANSITO: "Em trânsito", RECEBIDA_VAZAMENTO: "Recebida Vazamento",
  EM_VAZAMENTO: "Em vazamento", VAZADA: "Vazada", REJEITADA: "Rejeitada",
  RETORNO_PENDENTE: "Retorno pendente", RETORNADA: "Retornada"
};
function fusaoPanelasHoldingHtml(panelas, codigoCorrida) {
  if (!panelas.length) return `<p class="production-muted">Nenhuma panela retirada ainda.</p>`;
  const kg = (valor) => valor != null ? fNumber(valor).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "—";
  const linhas = panelas.map((p) => `<tr>
      <td>${p.sequencial}</td>
      <td>${p.hora_retirada ? new Date(p.hora_retirada).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
      <td>${fEsc(p.produtos?.codigo || "—")}</td>
      <td>${kg(p.peso_kg)}</td>
      <td>${kg(p.temperatura_c)}</td>
      <td>${kg(p.carbono_equivalente)}</td>
      <td>${kg(p.fesimg_liga1_kg)}</td>
      <td>${kg(p.fesimg_liga4_kg)}</td>
      <td>${kg(p.inoculante_kg)}</td>
      <td>${kg(p.silicio_kg)}</td>
      <td>${kg(p.grafite_kg)}</td>
      <td>${kg(p.sucata_cobertura_kg)}</td>
      <td>${fEsc(fusaoIdentificacaoVazamento(codigoCorrida, p.sequencial_vazamento) || "—")}</td>
      <td>${PANELA_HOLDING_STATUS_NOMES_CORRIDA[p.status] || p.status}</td>
    </tr>`).join("");
  const soma = (campo) => panelas.reduce((total, p) => total + fNumber(p[campo]), 0);
  const totalRow = `<tr class="fusao-tabela-total-row">
      <td colspan="3"><strong>Total</strong></td>
      <td><strong>${kg(soma("peso_kg"))}</strong></td>
      <td>—</td>
      <td>—</td>
      <td><strong>${kg(soma("fesimg_liga1_kg"))}</strong></td>
      <td><strong>${kg(soma("fesimg_liga4_kg"))}</strong></td>
      <td><strong>${kg(soma("inoculante_kg"))}</strong></td>
      <td><strong>${kg(soma("silicio_kg"))}</strong></td>
      <td><strong>${kg(soma("grafite_kg"))}</strong></td>
      <td><strong>${kg(soma("sucata_cobertura_kg"))}</strong></td>
      <td></td>
      <td></td>
    </tr>`;
  return `<div class="table-wrapper"><table class="products-table">
      <thead><tr class="fusao-cabecalho-retirada"><th>Nº</th><th>Hora</th><th>Produto</th><th>Peso (kg)</th><th>Temp (°C)</th><th>CE</th>
        <th>FeSiMg L1 (kg)</th><th>FeSiMg L4 (kg)</th><th>Inoculante (kg)</th><th>Silício (kg)</th><th>Grafite (kg)</th><th>Sucata cobertura (kg)</th><th>Vazamento</th><th>Status</th></tr></thead>
      <tbody>${linhas}</tbody>
      <tfoot>${totalRow}</tfoot></table></div>`;
}
async function loadCorridaDetail() {
  const id = fusaoCorridaId();
  const [corrida, itens, adicoes, transferencias, mensagens, alteracoes, panelasHolding] = await Promise.all([
    window.LIDUTEC_PRODUCAO_FUSAO_DATA.corrida(id),
    window.LIDUTEC_PRODUCAO_FUSAO_DATA.cargaItens(id),
    window.LIDUTEC_PRODUCAO_FUSAO_DATA.adicoes(id),
    window.LIDUTEC_PRODUCAO_FUSAO_DATA.transferenciasDaCorrida(id),
    window.LIDUTEC_PRODUCAO_FUSAO_DATA.mensagensDaCorrida(id),
    window.LIDUTEC_PRODUCAO_FUSAO_DATA.alteracoesDaCorrida(id),
    window.LIDUTEC_PRODUCAO_FUSAO_DATA.panelasDaCorrida(id)
  ]);
  if (!corrida) { fq("#corrida-titulo").textContent = "Corrida não encontrada"; return; }
  fusaoCorridaCache.corrida = corrida;
  fusaoCorridaCache.itens = itens;
  fusaoCorridaCache.transferencias = transferencias;
  fusaoCorridaCache.panelasHolding = panelasHolding;
  const [retornosDaCorrida, lingotesDaCorrida] = await Promise.all([
    window.LIDUTEC_PRODUCAO_FUSAO_DATA.panelasRetornadasParaCorrida(corrida.id),
    window.LIDUTEC_PRODUCAO_FUSAO_DATA.lingotamentosParaCorrida(corrida.id)
  ]);
  fusaoCorridaCache.retornosDisa = [...retornosDaCorrida, ...lingotesDaCorrida];
  const panelasPanel = fq("#panelas-holding-panel");
  if (panelasPanel) {
    const ehHolding = corrida.fornos_fusao?.tipo === "HOLDING";
    panelasPanel.hidden = !ehHolding;
    if (ehHolding) fq("#panelas-holding-painel").innerHTML = fusaoPanelasHoldingHtml(panelasHolding, corrida.codigo);
  }
  fq("#mensagens-painel").innerHTML = fusaoMensagensPainelHtml(id, mensagens, true);
  fusaoBindMensagens(fq("#mensagens-painel .fusao-mensagens"));
  const alteracoesEl = fq("#alteracoes-painel");
  if (alteracoesEl) alteracoesEl.innerHTML = fusaoAlteracoesPainelHtml(id, alteracoes);
  fq("#corrida-titulo").textContent = `Corrida ${fusaoCodigoCorridaMascarado(corrida.codigo)}`;
  fq("#corrida-subtitulo").textContent = `${corrida.fornos_fusao?.nome || ""} · ${corrida.turno} · ${new Date(`${corrida.data_operacional}T12:00:00`).toLocaleDateString("pt-BR")}`;
  fq("#corrida-codigo").textContent = fusaoCodigoCorridaMascarado(corrida.codigo);
  fq("#corrida-status-linha").textContent = fusaoCorridaStatusLinhaTexto(corrida);
  renderCorridaStepper(corrida);
  renderCorridaStatusActions(corrida);
  await renderCargaTable(itens, corrida);
  renderResumoCorrida();
  await renderAdicoes(adicoes);
  const adicaoForm = fq("#adicao-form");
  if (adicaoForm) adicaoForm.hidden = corrida.status !== "ABERTA";
  const transferirPanel = fq("#transferir-panel");
  if (transferirPanel) {
    transferirPanel.hidden = corrida.status !== "ABERTA";
    fq("#tr-forno-destino").innerHTML = fusaoState.fornos
      .filter((f) => f.id !== corrida.forno_id)
      .map((f) => `<option value="${f.id}">${fEsc(f.codigo)} — ${fEsc(f.nome)}</option>`).join("");
  }
}
async function initializeFusaoCorrida() {
  fq("#ad-material").innerHTML = `<option value="">Selecione</option>${fusaoMaterialOptions()}`;
  fq("#corrida-refresh").addEventListener("click", () => loadCorridaDetail().catch((error) => alert(error.message)));
  fq("#adicao-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = event.submitter;
    button.disabled = true;
    try {
      const materialId = Number(form.elements.material_id.value);
      const quantidade = Number(form.elements.quantidade_kg.value);
      if (!materialId || !quantidade) throw new Error("Selecione o material e informe a quantidade.");
      await window.LIDUTEC_PRODUCAO_FUSAO_DATA.registrarAdicao(fusaoCorridaId(), materialId, quantidade);
      form.reset();
      await loadCorridaDetail();
    } catch (error) {
      const el = fq("#adicao-message");
      el.textContent = error.message; el.className = "form-message error"; el.hidden = false;
    } finally {
      button.disabled = false;
    }
  });
  fq("#transferir-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = event.submitter;
    try {
      const fornoDestinoId = Number(form.elements.forno_destino_id.value);
      const quantidade = Number(form.elements.quantidade_kg.value);
      if (!fornoDestinoId || !quantidade) throw new Error("Selecione o forno destino e informe a quantidade.");
      if (!(await fusaoConfirmarTransferencia(fornoDestinoId, quantidade))) return;
      button.disabled = true;
      await window.LIDUTEC_PRODUCAO_FUSAO_DATA.transferirMetal(fusaoCorridaId(), fornoDestinoId, quantidade);
      form.reset();
    } catch (error) {
      const el = fq("#transferir-message");
      el.textContent = error.message; el.className = "form-message error"; el.hidden = false;
    } finally {
      button.disabled = false;
    }
  });
  await loadCorridaDetail();
  // Vários papéis mexem na mesma corrida ao mesmo tempo (Ponte pesando,
  // outro supervisor editando) — em vez de reconsultar tudo de tempos em
  // tempos, assina mudanças ao vivo e só redesenha a linha/campo que
  // realmente mudou (ver conversa sobre o "pisca" da tela).
  const corridaId = fusaoCorridaId();
  const canal = window.supabaseClient
    .channel(`corrida-fusao-${corridaId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "corridas_fusao_carga_itens", filter: `corrida_id=eq.${corridaId}` }, handleCargaItemRealtimeChange)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "corridas_fusao", filter: `id=eq.${corridaId}` }, handleCorridaRealtimeChange)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "corridas_fusao_adicoes", filter: `corrida_id=eq.${corridaId}` }, handleAdicaoRealtimeInsert)
    .on("postgres_changes", { event: "*", schema: "public", table: "transferencias_fusao", filter: `corrida_origem_id=eq.${corridaId}` }, () => refreshResumoCorrida().catch(() => {}))
    .on("postgres_changes", { event: "*", schema: "public", table: "transferencias_fusao", filter: `corrida_destino_id=eq.${corridaId}` }, () => refreshResumoCorrida().catch(() => {}))
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "corridas_fusao_mensagens", filter: `corrida_id=eq.${corridaId}` }, () => refreshMensagensCorrida().catch(() => {}))
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "corridas_fusao_pesagens_ponte_log", filter: `corrida_id=eq.${corridaId}` }, () => refreshCargaItens().catch(() => {}))
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "corridas_fusao_alteracoes", filter: `corrida_id=eq.${corridaId}` }, () => refreshAlteracoesCorrida().catch(() => {}))
    .subscribe();
  window.addEventListener("pagehide", () => window.supabaseClient.removeChannel(canal), { once: true });
  // Rede de segurança: o realtime cobre o dia a dia; se algum evento se
  // perder (reconexão etc.) essa sincronização esporádica evita que a tela
  // fique desatualizada indefinidamente.
  setInterval(() => {
    if (document.activeElement?.classList.contains("fusao-editable-input")) return;
    loadCorridaDetail().catch(() => {});
  }, 180000);
}

// ---------------------------------------------------------------------------
// Tela "trocar-refratario" — encerra o ciclo aberto do forno (motivo,
// situação do forno, observações) e já abre o próximo ciclo.
// ---------------------------------------------------------------------------
function fusaoFornoIdDaUrl() {
  return new URLSearchParams(location.search).get("forno");
}
async function initializeFusaoTrocarRefratario() {
  const fornoId = fusaoFornoIdDaUrl();
  const forno = fusaoState.fornos.find((f) => String(f.id) === fornoId);
  if (!forno) { fq("#tr-forno-nome").textContent = "Forno não encontrado."; return; }
  fq("#tr-forno-nome").textContent = forno.nome;
  const ciclo = await window.LIDUTEC_PRODUCAO_FUSAO_DATA.cicloAtivo(forno.id);
  if (ciclo) {
    const { count } = await window.LIDUTEC_PRODUCAO_FUSAO_DATA.corridasNoCiclo(ciclo.id);
    fq("#tr-ciclo-info").textContent = `Ciclo atual: nº ${ciclo.numero_ciclo}, com ${count} corrida(s) realizadas. Ao confirmar, esse ciclo é encerrado e o ciclo nº ${ciclo.numero_ciclo + 1} começa automaticamente.`;
  } else {
    fq("#tr-ciclo-info").textContent = "Este forno ainda não tem nenhum ciclo de refratário aberto.";
  }
  fq("#trocar-refratario-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = event.submitter;
    button.disabled = true;
    try {
      await window.LIDUTEC_PRODUCAO_FUSAO_DATA.trocarRefratario(
        forno.id, form.elements.motivo.value, form.elements.situacao_forno.value, form.elements.observacoes.value
      );
      location.href = "./index.html";
    } catch (error) {
      const el = fq("#trocar-refratario-message");
      el.textContent = error.message; el.className = "form-message error"; el.hidden = false;
      button.disabled = false;
    }
  });
}

// ---------------------------------------------------------------------------
// Tela "ponte" — cada carro (ponte rolante) só serve um par de fornos; a
// tela junta os materiais pendentes das corridas abertas desse par, pra o
// operador não precisar entrar em cada corrida separadamente.
// ---------------------------------------------------------------------------
// Cada entrega é uma parcela que SOMA ao real acumulado (pedido explícito —
// material pode chegar em mais de uma leva); o acumulado fica só leitura,
// bem visível, e o campo de entrada limpa sozinho depois de confirmar.
// Concluído = já chegou pelo menos o planejado (pode passar, não trava) —
// dá pro operador ver de longe o que ainda falta sem fazer conta de cabeça.
// Cadastro "Direto" (ex.: elementos de liga) nunca passa pela ponte.
// Cadastro "Ponte" é só pra material que sempre vai líquido (panela).
// Cadastro "Carro" é o material que normalmente vai sólido na cesta da
// ponte, mas o mesmo material pode ser lançado líquido numa corrida —
// quem decide isso é o estado físico do item, não o cadastro: líquido
// sempre aparece como "Ponte", sólido continua "Carro".
function fusaoModoCarregamento(item) {
  const modo = item.materiais_fusao?.modo_pesagem ?? "CARRO";
  if (modo === "DIRETO") return "DIRETO";
  if (modo === "PONTE") return "PONTE";
  return item.estado_fisico === "LIQUIDO" ? "PONTE" : "CARRO";
}
// Só "Carro" (cesta içada pelo operador, incremento por incremento) precisa
// da tela da Ponte e trava o Real no card. "Ponte" (líquido, lançado numa
// vez só pelo supervisor) e "Direto" ficam editáveis direto no card.
function fusaoItemVaiParaPonte(item) {
  return fusaoModoCarregamento(item) === "CARRO";
}
// Bipe simples quando uma carga nova chega na Ponte — sem depender de
// arquivo de áudio, um beep curto via Web Audio API. audioContext fica
// suspenso até o navegador liberar (autoplay); qualquer clique na página
// já destrava (ver listener em initializeFusaoPonte).
let fusaoAudioContext = null;
function fusaoAudioContextGarantido() {
  if (!fusaoAudioContext) fusaoAudioContext = new (window.AudioContext || window.webkitAudioContext)();
  return fusaoAudioContext;
}
function fusaoBip() {
  try {
    fusaoAudioContext = fusaoAudioContextGarantido();
    if (fusaoAudioContext.state === "suspended") fusaoAudioContext.resume();
    const oscillator = fusaoAudioContext.createOscillator();
    const ganho = fusaoAudioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    ganho.gain.setValueAtTime(0.3, fusaoAudioContext.currentTime);
    ganho.gain.exponentialRampToValueAtTime(0.001, fusaoAudioContext.currentTime + 0.35);
    oscillator.connect(ganho);
    ganho.connect(fusaoAudioContext.destination);
    oscillator.start();
    oscillator.stop(fusaoAudioContext.currentTime + 0.35);
  } catch { /* navegador sem suporte a áudio — ignora */ }
}
// Agrupa pesagens pelo mesmo operador — pedido explícito: o nome aparece
// uma vez só, com o total pesado e o período (primeira à última leva), em
// vez de repetir o nome/kg pra cada leva individual.
function fusaoAgruparPesagens(log) {
  const grupos = [];
  const porNome = new Map();
  for (const entrada of [...log].sort((a, b) => new Date(a.registrado_em) - new Date(b.registrado_em))) {
    const nome = entrada.usuarios?.nome || entrada.nome || "—";
    let grupo = porNome.get(nome);
    if (!grupo) { grupo = { nome, entradas: [] }; porNome.set(nome, grupo); grupos.push(grupo); }
    grupo.entradas.push(entrada);
  }
  return grupos;
}
function fusaoDataHoraVirgula(iso) {
  const d = new Date(iso);
  return `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}, ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}
function fusaoResumoOperadorHtml(grupo) {
  const total = grupo.entradas.reduce((soma, e) => soma + fNumber(e.quantidade_kg), 0);
  const totalTxt = `${fNumber(total).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} kg`;
  const nome = `<strong>${fEsc(grupo.nome)}</strong>`;
  if (grupo.entradas.length === 1) {
    return `${nome} ${totalTxt} (${fusaoDataHoraVirgula(grupo.entradas[0].registrado_em)})`;
  }
  const inicio = fusaoDataHoraVirgula(grupo.entradas[0].registrado_em);
  const fim = fusaoDataHoraVirgula(grupo.entradas[grupo.entradas.length - 1].registrado_em);
  return `${nome} ${totalTxt} entre ${inicio} e ${fim}`;
}
// Rastreabilidade pedida explicitamente: precisa dar pra ver cada entrega
// individual (quem, quando, quanto) — não um total. Nome só repete quando
// troca de operador; data só repete quando muda o dia — economiza releitura
// numa lista com várias pesagens seguidas da mesma pessoa no mesmo dia.
function ponteLogHtml(log) {
  if (!log?.length) return `<span class="production-muted">Nenhuma entrega registrada ainda.</span>`;
  let nomeAnterior = null;
  let dataAnterior = null;
  return log.map((entrada) => {
    const nome = entrada.usuarios?.nome || entrada.nome || "—";
    const d = new Date(entrada.registrado_em);
    const dataTxt = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
    const horaTxt = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    const partes = [];
    if (nome !== nomeAnterior) partes.push(`<strong>${fEsc(nome)}</strong>`);
    if (dataTxt !== dataAnterior) partes.push(dataTxt);
    partes.push(horaTxt);
    nomeAnterior = nome; dataAnterior = dataTxt;
    const peso = fNumber(entrada.quantidade_kg).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
    return `<span class="fusao-ponte-log-entry">${partes.join(", ")} <span class="fusao-log-peso">${peso}</span> kg</span>`;
  }).join("");
}
// Inserção otimista (sem round-trip) na hora de confirmar uma entrega —
// mostra nome/data completos por segurança; o próximo poll/realtime
// redesenha a lista toda com a deduplicação certa.
function fusaoPesagemEntradaCompletaHtml(entrada) {
  const d = new Date(entrada.registrado_em);
  const dataTxt = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  const horaTxt = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const nome = fEsc(entrada.usuarios?.nome || entrada.nome || "—");
  const peso = fNumber(entrada.quantidade_kg).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  return `<span class="fusao-ponte-log-entry"><strong>${nome}</strong>, ${dataTxt}, ${horaTxt} <span class="fusao-log-peso">${peso}</span> kg</span>`;
}
// Histórico de alterações da carga — log automático (incluir/editar/
// excluir material), separado do quadro de recados que é conversa livre.
// Deixa o operador da Ponte ciente do que o supervisor mexeu.
function fusaoAlteracaoLinhaHtml(alteracao) {
  return `<p class="fusao-alteracao"><strong>${fEsc(alteracao.usuarios?.nome || "—")}</strong> ${fEsc(alteracao.descricao)} <span class="production-muted">(${fusaoDataHoraCurta(alteracao.criado_em)})</span></p>`;
}
function fusaoAlteracoesListaHtml(alteracoes) {
  if (!alteracoes?.length) return `<p class="production-muted fusao-alteracoes-vazio">Nenhuma alteração registrada ainda.</p>`;
  return alteracoes.map(fusaoAlteracaoLinhaHtml).join("");
}
// Painel completo (corrida.html) — mais recente no topo.
function fusaoAlteracoesPainelHtml(corridaId, alteracoes) {
  return `<div class="fusao-alteracoes" data-corrida-id="${corridaId}">${fusaoAlteracoesListaHtml(alteracoes)}</div>`;
}
// Resumo compacto (Ponte) — só as 2 mais recentes visíveis, resto atrás de
// um "+N alterações" nativo (<details>, sem JS de abrir/fechar).
function fusaoAlteracoesResumoHtml(alteracoes) {
  if (!alteracoes?.length) return "";
  const visiveis = alteracoes.slice(0, 2);
  const resto = alteracoes.slice(2);
  const restoHtml = resto.length
    ? `<details class="fusao-alteracoes-mais"><summary>+ ${resto.length} alteraç${resto.length > 1 ? "ões" : "ão"}</summary>${resto.map(fusaoAlteracaoLinhaHtml).join("")}</details>`
    : "";
  return `<div class="fusao-alteracoes-resumo"><h5>Alterações</h5>${visiveis.map(fusaoAlteracaoLinhaHtml).join("")}${restoHtml}</div>`;
}
// Quadro de recados da corrida — comunicação entre quem planeja e quem
// pesa na Ponte. Simples de propósito: sem "lido/não lido", só a lista
// com quem escreveu, quando e o quê.
function fusaoMensagemHtml(mensagem) {
  const hora = new Date(mensagem.criado_em).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const origemClasse = mensagem.origem === "PONTE" ? "fusao-mensagem-ponte" : "fusao-mensagem-supervisor";
  return `<p class="fusao-mensagem ${origemClasse}"><strong>${fEsc(mensagem.usuarios?.nome || "—")}</strong> <span class="production-muted">(${hora})</span>: ${fEsc(mensagem.mensagem)}</p>`;
}
function fusaoMensagensListaHtml(mensagens) {
  if (!mensagens?.length) return `<p class="production-muted fusao-mensagens-vazio">Nenhuma mensagem ainda.</p>`;
  return mensagens.map(fusaoMensagemHtml).join("");
}
function fusaoMensagensPainelHtml(corridaId, mensagens, somenteLeitura = false) {
  return `<div class="fusao-mensagens" data-corrida-id="${corridaId}">
      <div class="fusao-mensagens-lista">${fusaoMensagensListaHtml(mensagens)}</div>
      ${somenteLeitura ? "" : `<div class="fusao-mensagem-form">
        <input type="text" class="fusao-mensagem-input" maxlength="500" placeholder="Falar com quem planeja/pesa esta corrida...">
        <button type="button" class="button button-secondary" data-enviar-mensagem>Enviar</button>
      </div>`}
    </div>`;
}
// Liga o botão/Enter de um painel de mensagens — reaproveitado nas 3 telas
// (Ponte, card do forno, corrida).
function fusaoBindMensagens(painel) {
  if (!painel) return;
  // Rola pro final sempre que a lista é (re)desenhada — carregamento
  // inicial, Realtime ou poll da Ponte — pra manter as últimas visíveis.
  const listaAtual = painel.querySelector(".fusao-mensagens-lista");
  if (listaAtual) listaAtual.scrollTop = listaAtual.scrollHeight;
  if (painel.dataset.bound) return;
  painel.dataset.bound = "1";
  const corridaId = Number(painel.dataset.corridaId);
  const input = painel.querySelector(".fusao-mensagem-input");
  const botao = painel.querySelector("[data-enviar-mensagem]");
  if (!input || !botao) return; // painel só-leitura (ex.: corrida.html) — sem formulário de envio
  const enviar = async () => {
    const texto = input.value.trim();
    if (!texto) { input.focus(); return; }
    input.disabled = true; botao.disabled = true;
    // Cor da mensagem depende de onde foi digitada — Ponte (roxo) ou
    // Supervisor/card do forno/corrida.html (marrom), pedido explícito.
    const origem = fusaoPage === "ponte" ? "PONTE" : "SUPERVISOR";
    try {
      await window.LIDUTEC_PRODUCAO_FUSAO_DATA.enviarMensagemCorrida(corridaId, texto, origem);
      // Mostra na hora, sem esperar Realtime/poll — o foco continua no
      // campo depois de enviar, e a atualização automática das outras
      // telas não mexe em quem está digitando (por design).
      const lista = painel.querySelector(".fusao-mensagens-lista");
      if (lista.querySelector(".fusao-mensagens-vazio")) lista.innerHTML = "";
      lista.insertAdjacentHTML("beforeend", fusaoMensagemHtml({
        mensagem: texto, criado_em: new Date().toISOString(), origem, usuarios: { nome: fusaoState.userNome }
      }));
      lista.scrollTop = lista.scrollHeight;
      input.value = "";
    } catch (error) {
      alert(error.message);
    } finally {
      input.disabled = false; botao.disabled = false;
      input.focus();
    }
  };
  botao.addEventListener("click", enviar);
  input.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); enviar(); } });
}
// Chega mensagem nova de outra pessoa (Realtime, em qualquer tela): busca
// só o painel dessa corrida onde quer que ele esteja na página e troca só
// a lista — nunca redesenha o card/bloco inteiro, então não perde o que a
// pessoa esteja digitando em outro campo (peso, planejado etc.) nem no
// próprio campo de mensagem.
async function fusaoAtualizarPainelMensagens(corridaId) {
  const painel = document.querySelector(`.fusao-mensagens[data-corrida-id="${corridaId}"]`);
  if (!painel) return;
  const mensagens = await window.LIDUTEC_PRODUCAO_FUSAO_DATA.mensagensDaCorrida(corridaId);
  painel.querySelector(".fusao-mensagens-lista").innerHTML = fusaoMensagensListaHtml(mensagens);
  fusaoBindMensagens(painel);
}
// Item concluído trava a célula de entrega igual acontece nas telas do
// supervisor: a caixa de digitar some, e quem quiser lançar mais precisa
// confirmar "Colocar carga" antes (evita passar do planejado sem querer).
function fusaoPonteEntregaDestravadaHtml(corridaId, itemId) {
  // Só número inteiro na Ponte (pedido explícito) — inputmode="numeric" +
  // pattern="[0-9]*" garante o teclado só-números no tablet (o pattern é o
  // que faz o Safari/iOS esconder ponto e sinal, que o inputmode sozinho
  // às vezes não tira). A validação de verdade (recusar fração) continua
  // acontecendo em confirmarEntrega.
  return `<span class="fusao-ponte-entrega-flex">
      <input type="number" inputmode="numeric" pattern="[0-9]*" min="1" step="1" class="fusao-entrega-input" data-corrida-id="${corridaId}" data-item-id="${itemId}">
      <button type="button" class="button button-primary" data-confirmar-entrega>OK</button>
    </span>`;
}
function fusaoPonteEntregaTravadaHtml(corridaId, itemId) {
  return `<span class="fusao-ponte-entrega-travada">
      <span class="production-muted">Concluído</span>
      <button type="button" class="button button-secondary fusao-ponte-desbloquear" data-corrida-id="${corridaId}" data-item-id="${itemId}" title="Colocar carga">+</button>
    </span>`;
}
function fusaoPonteEntregaCellHtml(corridaId, item) {
  return fusaoItemConcluido(item) ? fusaoPonteEntregaTravadaHtml(corridaId, item.id) : fusaoPonteEntregaDestravadaHtml(corridaId, item.id);
}
// Uma célula só de "Saldo": planejado/acumulado empilhados à esquerda, o
// que falta em destaque no meio, barra de progresso à direita — condensa
// 3 colunas antigas (Planejado/Acumulado/Progresso) numa só, pedido
// explícito (mockup enviado pelo usuário).
function fusaoPonteSaldoCelHtml(item) {
  const planejado = fNumber(item.quantidade_planejada_kg);
  const acumulado = fNumber(item.quantidade_realizada_kg);
  const saldo = Math.max(0, planejado - acumulado);
  const kg = (v) => v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  return `<span class="fusao-ponte-saldo-flex">
      <span class="fusao-ponte-saldo-labels">
        <span>Planejado <strong>${kg(planejado)}</strong></span>
        <span>Acumulado <strong class="fusao-ponte-acumulado">${kg(acumulado)}</strong></span>
      </span>
      <strong class="fusao-ponte-saldo-numero">${kg(saldo)}</strong>
      <span class="fusao-ponte-progresso">${fusaoProgressoHtml(acumulado, planejado)}</span>
    </span>`;
}
// Zebra entre materiais (não status verde/vermelho, pedido explícito) — a
// mesma classe vai na linha do material E na linha de log logo abaixo,
// senão a faixinha do log fica branca destoando da cor do material.
function fusaoPonteMaterialRowHtml(corridaId, item, indice) {
  const estadoLabel = { SOLIDO: "Sólido", LIQUIDO: "Líquido" };
  const zebra = indice % 2 === 0 ? "fusao-ponte-linha-par" : "fusao-ponte-linha-impar";
  const concluido = fNumber(item.quantidade_realizada_kg) >= fNumber(item.quantidade_planejada_kg) && fNumber(item.quantidade_realizada_kg) > 0;
  return `<tr data-item-id="${item.id}" data-planejado="${item.quantidade_planejada_kg}" class="${zebra}${concluido ? " is-concluido" : ""}">
      <td class="fusao-ponte-material-cel">${fEsc(item.materiais_fusao?.nome || "")}${item.estado_fisico ? ` <span class="production-muted">(${estadoLabel[item.estado_fisico] || item.estado_fisico})</span>` : ""}</td>
      <td class="fusao-ponte-saldo-cel">${fusaoPonteSaldoCelHtml(item)}</td>
      <td class="fusao-ponte-entrega">${fusaoPonteEntregaCellHtml(corridaId, item)}</td>
    </tr>
    <tr class="fusao-ponte-log-row ${zebra}"><td colspan="3"><div class="fusao-ponte-log" data-log-item-id="${item.id}">${ponteLogHtml(item.corridas_fusao_pesagens_ponte_log)}</div></td></tr>`;
}
function pontePreencherCorrida(container, corrida) {
  const itens = (corrida.corridas_fusao_carga_itens || []).filter(fusaoItemVaiParaPonte);
  if (!itens.length) return;
  const ferroBase = fusaoLimparFerroBase(fusaoState.tipoMaterialPorProduto[corrida.produto_id]);
  container.insertAdjacentHTML("beforeend", `<article class="fusao-ponte-corrida">
      <h4 class="fusao-ponte-carro-titulo">Carro ${fEsc(corrida.fornos_fusao?.carro ?? "—")}</h4>
      <p class="fusao-ponte-corrida-linha2">
        <span class="fusao-ponte-cod-corrida">${fEsc(fusaoCodigoCorridaMascarado(corrida.codigo))}</span>
        <span class="fusao-ponte-ferro-base">${fEsc(ferroBase)}</span>
        <span class="fusao-ponte-cod-produto">${fEsc(corrida.produtos?.codigo || "—")}</span>
      </p>
      <table class="products-table"><thead><tr><th>Material</th><th>Saldo</th><th>Nova entrega (kg)</th></tr></thead>
      <tbody>${itens.map((item, indice) => fusaoPonteMaterialRowHtml(corrida.id, item, indice)).join("")}</tbody></table>
      ${fusaoAlteracoesResumoHtml(corrida.corridas_fusao_alteracoes)}
      ${fusaoMensagensPainelHtml(corrida.id, [...(corrida.corridas_fusao_mensagens || [])].reverse())}
    </article>`);
}
// Bipa quando uma corrida nova aparece nesse carro — nunca no carregamento
// inicial da página, só em cima do que já era conhecido. Material incluído/
// planejado alterado/excluído tem canal Realtime próprio (corridas_fusao_
// alteracoes, instantâneo) que já cuida do bipe deles; mensagem idem.
const fusaoPonteConhecidos = {};
function fusaoPonteDetectarNovidade(carro, corridas) {
  const atual = { corridas: new Set() };
  for (const corrida of corridas) atual.corridas.add(corrida.id);
  const anterior = fusaoPonteConhecidos[carro];
  let novidade = false;
  if (anterior) {
    for (const id of atual.corridas) if (!anterior.corridas.has(id)) novidade = true;
  }
  fusaoPonteConhecidos[carro] = atual;
  return Boolean(anterior) && novidade;
}
async function loadPonteCarro(carro) {
  const container = fq(`#ponte-carro-${carro}`);
  const focusWasInside = container.contains(document.activeElement);
  if (focusWasInside) return;
  const corridas = await window.LIDUTEC_PRODUCAO_FUSAO_DATA.corridasAbertasPorCarro(carro);
  if (fusaoPonteDetectarNovidade(carro, corridas)) fusaoBip();
  container.innerHTML = "";
  for (const corrida of corridas) pontePreencherCorrida(container, corrida);
  fq(`[data-empty-carro="${carro}"]`).hidden = container.children.length > 0;
  container.querySelectorAll(".fusao-mensagens").forEach(fusaoBindMensagens);
  const confirmarEntrega = async (row) => {
    const input = row.querySelector(".fusao-entrega-input");
    const valor = Number(input.value);
    if (!valor) { input.focus(); return; }
    if (!Number.isInteger(valor)) { alert("Informe um número inteiro, sem casas decimais."); input.focus(); return; }
    const button = row.querySelector("[data-confirmar-entrega]");
    input.disabled = true; button.disabled = true;
    try {
      const total = await window.LIDUTEC_PRODUCAO_FUSAO_DATA.adicionarPesagem(
        Number(input.dataset.corridaId), Number(input.dataset.itemId), valor
      );
      row.querySelector(".fusao-ponte-acumulado").textContent = fNumber(total).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
      row.querySelector(".fusao-ponte-saldo-numero").textContent = Math.max(0, fNumber(row.dataset.planejado) - fNumber(total)).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
      row.querySelector(".fusao-ponte-progresso").innerHTML = fusaoProgressoHtml(total, row.dataset.planejado);
      const concluido = fNumber(total) > 0 && fNumber(total) >= fNumber(row.dataset.planejado);
      row.classList.toggle("is-concluido", concluido);
      const logEl = row.nextElementSibling?.querySelector(`[data-log-item-id="${input.dataset.itemId}"]`);
      if (logEl) {
        if (logEl.querySelector(".production-muted")) logEl.innerHTML = "";
        logEl.insertAdjacentHTML("afterbegin", fusaoPesagemEntradaCompletaHtml({ quantidade_kg: valor, registrado_em: new Date().toISOString(), nome: fusaoState.userNome }));
      }
      if (concluido) {
        // Concluiu agora — a caixa de digitar some e vira o aviso "Colocar
        // carga" (linha de baixo), igual as telas do supervisor.
        const cell = row.querySelector(".fusao-ponte-entrega");
        cell.innerHTML = fusaoPonteEntregaTravadaHtml(input.dataset.corridaId, input.dataset.itemId);
        bindEntregaControls(cell);
      } else {
        input.value = "";
        input.disabled = false; button.disabled = false;
        input.focus();
      }
    } catch (error) {
      alert(error.message);
      input.disabled = false; button.disabled = false;
      input.focus();
    }
  };
  const bindEntregaControls = (scope) => {
    scope.querySelectorAll("[data-confirmar-entrega]").forEach((button) => {
      button.addEventListener("click", () => confirmarEntrega(button.closest("tr")));
    });
    scope.querySelectorAll(".fusao-entrega-input").forEach((input) => {
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") { event.preventDefault(); confirmarEntrega(input.closest("tr")); return; }
        // Bloqueia o ponto/vírgula decimal na digitação — só inteiro na Ponte.
        if (event.key === "." || event.key === ",") event.preventDefault();
      });
    });
    scope.querySelectorAll(".fusao-ponte-desbloquear").forEach((button) => {
      button.addEventListener("click", () => {
        if (!confirm(FUSAO_UNLOCK_CONFIRM.realizado)) return;
        const cell = button.closest(".fusao-ponte-entrega");
        cell.innerHTML = fusaoPonteEntregaDestravadaHtml(button.dataset.corridaId, button.dataset.itemId);
        bindEntregaControls(cell);
        cell.querySelector(".fusao-entrega-input").focus();
      });
    });
  };
  bindEntregaControls(container);
}
async function initializeFusaoPonte() {
  // Destrava o áudio do bipe assim que o operador tocar na tela pela
  // primeira vez (navegadores só liberam som criado numa interação real).
  document.addEventListener("click", () => {
    try { fusaoAudioContextGarantido().resume(); } catch { /* sem suporte a áudio */ }
  }, { once: true });
  await Promise.all([loadPonteCarro(1), loadPonteCarro(2)]);
  // Mensagens chegam na hora (Realtime), sem esperar o próximo poll — e
  // sem depender de "ninguém estar digitando" (só troca a lista, não o
  // bloco da corrida inteiro).
  const canalPonteMensagens = window.supabaseClient
    .channel("fusao-ponte-mensagens")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "corridas_fusao_mensagens" }, (payload) => {
      // Não bipa a própria mensagem que acabou de mandar, só a de quem
      // planeja a carga.
      if (payload.new?.autor_id !== fusaoState.user?.id) fusaoBip();
      fusaoAtualizarPainelMensagens(payload.new?.corrida_id).catch(() => {});
    })
    .subscribe();
  window.addEventListener("pagehide", () => window.supabaseClient.removeChannel(canalPonteMensagens), { once: true });
  // Alteração da carga (incluir/editar/excluir material) também é
  // instantânea — bipa e recarrega os dois carros (não dá pra saber de qual
  // sem mais uma consulta, e é raro o bastante pra não pesar).
  const canalPonteAlteracoes = window.supabaseClient
    .channel("fusao-ponte-alteracoes")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "corridas_fusao_alteracoes" }, (payload) => {
      if (payload.new?.autor_id !== fusaoState.user?.id) fusaoBip();
      loadPonteCarro(1).catch(() => {});
      loadPonteCarro(2).catch(() => {});
    })
    .subscribe();
  window.addEventListener("pagehide", () => window.supabaseClient.removeChannel(canalPonteAlteracoes), { once: true });
  // Reflete entregas lançadas por outro operador/dispositivo sem precisar
  // recarregar a página — não mexe na linha se tiver campo em edição.
  setInterval(() => { loadPonteCarro(1).catch(() => {}); loadPonteCarro(2).catch(() => {}); }, 15000);
}

async function initializeFusaoProduction() {
  const user = await window.LIDUTEC_APP.requireAuthenticatedUser();
  if (!user) return;
  const [profile, permissions] = await Promise.all([
    window.LIDUTEC_APP.getCurrentUserProfile(user.id),
    window.LIDUTEC_APP.getUserPermissions(user.id)
  ]);
  if (!profile || profile.status !== "ATIVO") { alert("Seu usuário não possui acesso ativo."); await window.LIDUTEC_APP.signOut(); return; }
  // Ponte e Vazamento aceitam também suas permissões restritas (só a
  // própria tela, sem acesso ao planejamento/corrida) — as outras páginas
  // do módulo continuam exigindo a permissão geral de visualizar.
  const podeVerFusao = permissions.has("producao_fusao.visualizar");
  const podeVerPonte = podeVerFusao || permissions.has("producao_fusao.lancar_ponte");
  const podeVerVazamento = podeVerFusao || permissions.has("producao_fusao.lancar_vazamento");
  const podeVerPagina = fusaoPage === "ponte" ? podeVerPonte : (fusaoPage === "vazamento" || fusaoPage === "vazamento-historico") ? podeVerVazamento : podeVerFusao;
  if (!podeVerPagina) { location.replace("../dashboard.html"); return; }
  fusaoState.user = user;
  fusaoState.userNome = profile.nome;
  fusaoState.permissions = permissions;
  window.LIDUTEC_APP.applyPermissionVisibility(permissions);
  fq("#user-name").textContent = profile.nome;
  fq("#user-profile").textContent = profile.perfil || "Usuário";
  fq("#user-avatar").textContent = profile.nome.slice(0, 1).toUpperCase();

  await loadFusaoSupport();
  fq("#production-loading")?.setAttribute("hidden", "");

  if (fusaoPage === "index") await initializeFusaoIndex();
  if (fusaoPage === "corrida") await initializeFusaoCorrida();
  if (fusaoPage === "trocar-refratario") await initializeFusaoTrocarRefratario();
  if (fusaoPage === "ponte") await initializeFusaoPonte();
  // Tela de saída de panelas do Holding vive no próprio arquivo
  // producao-fusao-holding.js (carregado depois deste na página) — só o
  // gancho de inicialização fica aqui, junto dos das outras telas.
  if (fusaoPage === "holding" && window.initializeFusaoHolding) await window.initializeFusaoHolding();
  // Mesmo esquema do Holding: a tela do Vazamento vive no próprio arquivo
  // producao-fusao-vazamento.js.
  if (fusaoPage === "vazamento" && window.initializeFusaoVazamento) await window.initializeFusaoVazamento();
  // Histórico do Vazamento (consulta) vive no próprio arquivo
  // producao-fusao-vazamento-historico.js.
  if (fusaoPage === "vazamento-historico" && window.initializeFusaoVazamentoHistorico) await window.initializeFusaoVazamentoHistorico();
  // Dashboard mensal vive no próprio arquivo producao-fusao-graficos.js.
  if (fusaoPage === "graficos" && window.initializeFusaoGraficos) await window.initializeFusaoGraficos();

  fq("#menu-button")?.addEventListener("click", () => fq("#sidebar").classList.toggle("open"));
  fq("#logout-button")?.addEventListener("click", () => window.LIDUTEC_APP.signOut());
}

initializeFusaoProduction().catch((error) => {
  const loading = fq("#production-loading");
  if (loading) loading.textContent = error.message;
  else alert(error.message);
});
