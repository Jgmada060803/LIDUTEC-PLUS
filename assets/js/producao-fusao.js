const fq = (selector) => document.querySelector(selector);
const fEsc = (value = "") => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fNumber = (value) => Number(value || 0);
const fusaoPage = document.body.dataset.productionPage;
const fusaoState = { user: null, permissions: null, materiais: [], fornos: [], produtos: [], volumeAtual: {} };
const fusaoCorridaCache = { corrida: null, itens: [], transferencias: { entradas: [], saidas: [] } };

const FUSAO_STATUS_NOMES = { ABERTA: "Aberta", FECHADA: "Fechada", CANCELADA: "Cancelada" };

// Hora digitada pelo operador (não a hora do clique) — mesmo padrão de
// inicio/fim já usado nas paradas de produção dos outros módulos.
function fusaoHoraAgora() {
  const agora = new Date();
  return `${String(agora.getHours()).padStart(2, "0")}:${String(agora.getMinutes()).padStart(2, "0")}`;
}
function fusaoMontarDataHora(dataOperacional, horaHHMM) {
  return new Date(`${dataOperacional}T${horaHHMM}:00`).toISOString();
}
function fusaoKg(valor) {
  return fNumber(valor).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

async function loadFusaoSupport() {
  const [materiais, fornos, produtos, volumeRows] = await Promise.all([
    window.LIDUTEC_PRODUCAO_FUSAO_DATA.materiais(true),
    window.LIDUTEC_PRODUCAO_FUSAO_DATA.fornos(),
    window.LIDUTEC_PRODUCAO_FUSAO_DATA.produtos(),
    window.LIDUTEC_PRODUCAO_FUSAO_DATA.volumeAtualFornos()
  ]);
  fusaoState.materiais = materiais;
  fusaoState.produtos = produtos;
  fusaoState.volumeAtual = Object.fromEntries(volumeRows.map((row) => [row.forno_id, row.volume_atual_kg]));
  // Fusão em cima, Holding embaixo — os dois elaboram corrida própria.
  fusaoState.fornos = [...fornos].sort((a, b) => a.tipo === b.tipo ? a.codigo.localeCompare(b.codigo) : a.tipo === "FUSAO" ? -1 : 1);
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
function fusaoProdutoOptions() {
  return fusaoState.produtos.map((p) => `<option value="${p.id}">${fEsc(p.codigo)} — ${fEsc(p.nome)}</option>`).join("");
}
function fusaoProdutoLabel(produto) {
  return produto ? `${fEsc(produto.codigo)} — ${fEsc(produto.nome)}` : "—";
}
function novaCorridaItemRow() {
  const row = document.createElement("div");
  row.className = "fusao-item-row";
  row.innerHTML = `<select name="material_id" required><option value="">Selecione</option>${fusaoMaterialOptions()}</select>
    <input name="quantidade_planejada_kg" type="number" min="0" step="0.01" placeholder="Qtd (kg)" required>
    <select name="estado_fisico" hidden><option value="">Sólido ou líquido?</option><option value="SOLIDO">Sólido</option><option value="LIQUIDO">Líquido</option></select>
    <button type="button" class="button button-secondary" data-remove-item>Remover</button>`;
  row.querySelector("[data-remove-item]").addEventListener("click", () => row.remove());
  // Sólido/líquido só existe pro Gusa — não é propriedade fixa do material,
  // é escolhido item a item na hora de montar a carga.
  row.querySelector('[name="material_id"]').addEventListener("change", (event) => {
    const material = fusaoState.materiais.find((m) => String(m.id) === event.target.value);
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
  if (status === "CANCELADA") return "is-cancelada";
  if (status === "FECHADA") return "is-done";
  return "is-current";
}
async function loadCorridasList() {
  const rows = await window.LIDUTEC_PRODUCAO_FUSAO_DATA.corridas({});
  fq("#corridas-rows").innerHTML = rows.map((item) => `<tr>
      <td><a href="./corrida.html?id=${item.id}">${fEsc(item.codigo)}</a></td>
      <td>${fEsc(item.fornos_fusao?.nome || "—")}</td>
      <td>${item.turno}</td>
      <td>${fusaoProdutoLabel(item.produtos)}</td>
      <td><span class="fusao-status-step ${fusaoCorridaStatusBadgeClass(item.status)}">${FUSAO_STATUS_NOMES[item.status] || item.status}</span></td>
      <td>${new Date(item.criado_em).toLocaleString("pt-BR")}</td>
    </tr>`).join("");
  fq("#corridas-empty").hidden = rows.length > 0;
  return rows;
}
function fornoFormHtml(forno, volumeAtualKg) {
  return `<p class="fusao-volume-atual-linha">Volume atual do forno <strong>${fusaoKg(volumeAtualKg)} kg</strong></p>
    <form class="meta-form fusao-forno-form" data-forno-id="${forno.id}">
    <p class="fusao-codigo-info">Próxima corrida: <strong class="fusao-codigo-prefixo">…</strong> <span class="production-muted">(número gerado automaticamente)</span></p>
    <label>Produto<select name="produto_id" required><option value="">Selecione</option>${fusaoProdutoOptions()}</select></label>
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

  const ciclo = await window.LIDUTEC_PRODUCAO_FUSAO_DATA.cicloAtivo(forno.id);
  const numeroCiclo = ciclo?.numero_ciclo ?? 1;
  form.querySelector(".fusao-codigo-prefixo").textContent = `${forno.codigo}${String(numeroCiclo).padStart(3, "0")}···`;
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
      const itens = [...rows.querySelectorAll(".fusao-item-row")].map((row) => ({
        material_id: Number(row.querySelector('[name="material_id"]').value),
        quantidade_planejada_kg: Number(row.querySelector('[name="quantidade_planejada_kg"]').value),
        estado_fisico: row.querySelector('[name="estado_fisico"]').value || null
      }));
      const produtoId = Number(form.elements.produto_id.value);
      if (!produtoId) throw new Error("Selecione o produto.");
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
    ? `<button type="button" class="button button-secondary fusao-editable-unlock">Colocar carga</button>`
    : `<button type="button" class="button button-secondary fusao-editable-toggle">Editar</button>`;
  return `<span class="fusao-editable-cell${travado ? " fusao-editable-locked" : ""}" data-kind="${kind}" data-item-id="${item.id}" data-valor="${valor ?? ""}">
      <span class="fusao-editable-display">${exibicao}</span>
      ${botao}
    </span>`;
}
function fusaoNomeItemHtml(item) {
  const estadoLabel = { SOLIDO: "Sólido", LIQUIDO: "Líquido" };
  return `${fEsc(item.materiais_fusao?.nome || "")}${item.estado_fisico ? ` <span class="production-muted">(${estadoLabel[item.estado_fisico] || item.estado_fisico})</span>` : ""}`;
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
function fusaoCardPonteRowHtml(item) {
  return `<tr data-item-id="${item.id}" data-planejado="${item.quantidade_planejada_kg}" data-realizado="${item.quantidade_realizada_kg ?? ""}">
      <td>${fusaoNomeItemHtml(item)}</td>
      <td>${fusaoEditableCellHtml("planejado", item)}</td>
      <td>${item.quantidade_realizada_kg != null ? fNumber(item.quantidade_realizada_kg).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "—"}</td>
      <td>${fusaoProgressoHtml(item.quantidade_realizada_kg, item.quantidade_planejada_kg)}</td>
      <td class="fusao-status-cell">${ponteStatusHtml(item.quantidade_realizada_kg, item.quantidade_planejada_kg)}</td>
    </tr>`;
}
function fusaoCardDiretoRowHtml(item) {
  return `<tr data-item-id="${item.id}" data-planejado="${item.quantidade_planejada_kg}" data-realizado="${item.quantidade_realizada_kg ?? ""}">
      <td>${fusaoNomeItemHtml(item)}</td>
      <td>${fusaoEditableCellHtml("planejado", item)}</td>
      <td>${fusaoEditableCellHtml("realizado", item)}</td>
      <td>${fusaoProgressoHtml(item.quantidade_realizada_kg, item.quantidade_planejada_kg)}</td>
      <td class="fusao-status-cell">${ponteStatusHtml(item.quantidade_realizada_kg, item.quantidade_planejada_kg)}</td>
    </tr>`;
}
function fusaoTabelasCargaHtml(itens) {
  // Ponte: quem passa pela ponte fica só leitura ali (lançado na tela da
  // Ponte). Direto: material Manual (sem crane) ou carga líquida — digitado
  // aqui mesmo, sem passar pela Ponte.
  const itensPonte = itens.filter(fusaoItemVaiParaPonte);
  const itensDiretos = itens.filter((item) => !fusaoItemVaiParaPonte(item));
  const carregamentoConcluido = itens.length > 0 && itens.every((item) =>
    fNumber(item.quantidade_realizada_kg) > 0 && fNumber(item.quantidade_realizada_kg) >= fNumber(item.quantidade_planejada_kg)
  );
  const tabelaPonte = itensPonte.length ? `<table class="products-table"><thead><tr><th>Material (Ponte)</th><th>Planejado (kg)</th><th>Real (kg)</th><th>Progresso</th><th>Status</th></tr></thead>
      <tbody>${itensPonte.map(fusaoCardPonteRowHtml).join("")}</tbody></table>
      <p class="production-muted">O real desses é lançado na tela da Ponte.</p>` : "";
  const tabelaDireta = itensDiretos.length ? `<table class="products-table"><thead><tr><th>Material (direto)</th><th>Planejado (kg)</th><th>Real (kg)</th><th>Progresso</th><th>Status</th></tr></thead>
      <tbody>${itensDiretos.map(fusaoCardDiretoRowHtml).join("")}</tbody></table>` : "";
  return { carregamentoConcluido, html: `${tabelaPonte}${tabelaDireta}` };
}
function fusaoTotalFornoHtml(itens) {
  const planejado = itens.reduce((soma, item) => soma + fNumber(item.quantidade_planejada_kg), 0);
  const realizado = itens.reduce((soma, item) => soma + fNumber(item.quantidade_realizada_kg), 0);
  return `${fusaoProgressoHtml(realizado, planejado)} <span class="production-muted">(${fusaoKg(realizado)} kg)</span>`;
}
// Sobra herdada + transferências viram linha na carga, igual um material —
// só que numa mini-tabela à parte (não fazem parte da tabela Ponte/Direto).
function fusaoMovimentoRowHtml(label, quantidadeKg) {
  return `<tr class="fusao-movimento-row"><td><strong>${fusaoKg(quantidadeKg)} kg</strong> — ${label}</td></tr>`;
}
function fusaoMovimentosLinhas(corrida, transferencias) {
  const linhas = [];
  if (fNumber(corrida.sobra_inicial_kg) > 0) linhas.push(fusaoMovimentoRowHtml("Sobra do forno", corrida.sobra_inicial_kg));
  (transferencias?.entradas || []).forEach((t) => linhas.push(fusaoMovimentoRowHtml(`↓ Entrada — Corrida ${fEsc(t.corridaCodigo || "—")}`, t.quantidade_kg)));
  (transferencias?.saidas || []).forEach((t) => linhas.push(fusaoMovimentoRowHtml(`↑ Saída — Corrida ${fEsc(t.corridaCodigo || "—")}`, t.quantidade_kg)));
  return linhas;
}
function fusaoMovimentosCardHtml(corrida, transferencias) {
  const linhas = fusaoMovimentosLinhas(corrida, transferencias);
  return linhas.length ? `<table class="products-table"><tbody>${linhas.join("")}</tbody></table>` : "";
}
async function corridaCardHtml(corrida, volumeAtualKg) {
  const [todosItens, transferencias, mensagens] = await Promise.all([
    window.LIDUTEC_PRODUCAO_FUSAO_DATA.cargaItens(corrida.id),
    window.LIDUTEC_PRODUCAO_FUSAO_DATA.transferenciasDaCorrida(corrida.id),
    window.LIDUTEC_PRODUCAO_FUSAO_DATA.mensagensDaCorrida(corrida.id)
  ]);
  const { carregamentoConcluido, html: tabelasHtml } = fusaoTabelasCargaHtml(todosItens);
  const produto = fusaoState.produtos.find((p) => p.id === corrida.produto_id) || corrida.produtos;
  return `<div class="fusao-corrida-inline" data-corrida-id="${corrida.id}" data-versao="${corrida.versao}" data-forno-id="${corrida.forno_id}">
      <p><span class="fusao-status-step ${fusaoCorridaStatusBadgeClass(corrida.status)}">${FUSAO_STATUS_NOMES[corrida.status] || corrida.status}</span>
        Corrida <strong>${fEsc(corrida.codigo)}</strong> — turno ${corrida.turno}
        <span class="fusao-carregamento-badge">${carregamentoConcluido ? `<span class="fusao-ponte-status is-concluido">✓ Carregamento concluído</span>` : ""}</span></p>
      <p class="fusao-corrida-meta">Produto: <strong>${fusaoProdutoLabel(produto)}</strong>
        · Início: <strong>${corrida.inicio ? new Date(corrida.inicio).toLocaleString("pt-BR") : "—"}</strong>
        ${corrida.fim ? ` · Fim: <strong>${new Date(corrida.fim).toLocaleString("pt-BR")}</strong>` : ""}</p>
      <p class="fusao-card-total-linha">Total da carga <span class="fusao-card-total">${fusaoTotalFornoHtml(todosItens)}</span></p>
      <p class="fusao-volume-atual-linha">Volume atual do forno <strong class="fusao-volume-atual-valor">${fusaoKg(volumeAtualKg)} kg</strong></p>
      <div class="fusao-tabelas-carga">${tabelasHtml}${fusaoMovimentosCardHtml(corrida, transferencias)}</div>
      <div class="fusao-add-item-area">
        <button type="button" class="button button-secondary" data-toggle-add-item>+ Incluir material</button>
        <button type="button" class="button button-secondary" data-toggle-transferir>Transferir</button>
        <div class="fusao-itens-rows" hidden></div>
        <div class="fusao-transferir-rows" hidden></div>
      </div>
      ${fusaoMensagensPainelHtml(corrida.id, mensagens)}
      <div class="form-message fusao-forno-message" hidden></div>
      <div class="meta-form-actions">
        <button type="button" class="button button-danger" data-acao="cancelar">Cancelar</button>
        <button type="button" class="button button-primary" data-acao="fechar">Fechar corrida</button>
      </div>
    </div>`;
}
// Recalcula o selo "Carregamento concluído" e a barra de total do card a
// partir do que já tá na tela (soma das linhas), sem precisar buscar tudo
// de novo.
function atualizarBadgeCarregamento(cardContainer) {
  const badge = cardContainer.querySelector(".fusao-carregamento-badge");
  if (badge) {
    const statusCells = cardContainer.querySelectorAll(".fusao-status-cell");
    const concluido = statusCells.length > 0 && cardContainer.querySelectorAll(".fusao-status-cell .is-pendente").length === 0;
    badge.innerHTML = concluido ? `<span class="fusao-ponte-status is-concluido">✓ Carregamento concluído</span>` : "";
  }
  const totalEl = cardContainer.querySelector(".fusao-card-total");
  if (totalEl) {
    let planejado = 0, realizado = 0;
    cardContainer.querySelectorAll(".fusao-tabelas-carga tr[data-planejado]").forEach((row) => {
      planejado += fNumber(row.dataset.planejado);
      realizado += fNumber(row.dataset.realizado);
    });
    totalEl.innerHTML = fusaoProgressoHtml(realizado, planejado);
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
  toggle.addEventListener("click", async () => {
    if (toggle.textContent === "Editar") {
      cell.querySelector(".fusao-editable-display").outerHTML =
        `<input type="number" min="0" step="0.01" class="fusao-editable-input" value="${cell.dataset.valor}">`;
      toggle.textContent = "Salvar";
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
      toggle.textContent = "Editar";
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
        unlock.outerHTML = `<button type="button" class="button button-secondary fusao-editable-toggle">Editar</button>`;
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
    const statusCell = row.querySelector(".fusao-status-cell");
    if (statusCell) statusCell.innerHTML = ponteStatusHtml(row.dataset.realizado, row.dataset.planejado);
    atualizarBadgeCarregamento(container);
  };
}
function bindCorridaCard(container, forno) {
  const corridaId = Number(container.querySelector(".fusao-corrida-inline")?.dataset.corridaId);
  bindEditableCells(container, corridaId, fusaoOnSavedCard(container));
  fusaoBindMensagens(container.querySelector(".fusao-mensagens"));
  container.querySelectorAll("[data-acao]").forEach((button) => {
    button.addEventListener("click", async () => {
      const acao = button.dataset.acao;
      if (acao === "cancelar" && !confirm("Cancelar esta corrida? Essa ação não pode ser desfeita.")) return;
      const mensagemAntiga = container.querySelector(".fusao-forno-message");
      if (mensagemAntiga) mensagemAntiga.hidden = true;
      button.disabled = true;
      try {
        const atual = await window.LIDUTEC_PRODUCAO_FUSAO_DATA.corridaAbertaDoForno(forno.id);
        if (!atual) throw new Error("Esta corrida não está mais aberta — a tela foi atualizada.");
        if (acao === "fechar") {
          const hora = prompt("Horário de fim da corrida (HH:MM):", fusaoHoraAgora());
          if (hora === null) { button.disabled = false; return; }
          if (!/^\d{2}:\d{2}$/.test(hora)) throw new Error("Horário inválido. Use HH:MM.");
          await window.LIDUTEC_PRODUCAO_FUSAO_DATA.fecharCorrida(atual.id, atual.versao, fusaoMontarDataHora(atual.data_operacional, hora));
        }
        if (acao === "cancelar") await window.LIDUTEC_PRODUCAO_FUSAO_DATA.cancelarCorrida(atual.id, atual.versao);
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
      const materialSelect = row.querySelector('[name="material_id"]');
      const quantidadeInput = row.querySelector('[name="quantidade_planejada_kg"]');
      try {
        const materialId = Number(materialSelect.value);
        const quantidade = Number(quantidadeInput.value);
        const estadoFisico = row.querySelector('[name="estado_fisico"]').value || null;
        if (!materialId || !quantidade) throw new Error("Selecione o material e informe a quantidade.");
        confirmar.disabled = true;
        const atual = await window.LIDUTEC_PRODUCAO_FUSAO_DATA.corridaAbertaDoForno(forno.id);
        if (!atual) throw new Error("Esta corrida não está mais aberta — a tela foi atualizada.");
        await window.LIDUTEC_PRODUCAO_FUSAO_DATA.adicionarItemCarga(atual.id, materialId, quantidade, estadoFisico);
        const itensAtualizados = await window.LIDUTEC_PRODUCAO_FUSAO_DATA.cargaItens(atual.id);
        const { html } = fusaoTabelasCargaHtml(itensAtualizados);
        const tabelasEl = container.querySelector(".fusao-tabelas-carga");
        if (tabelasEl) tabelasEl.innerHTML = html;
        bindEditableCells(container, atual.id, fusaoOnSavedCard(container));
        atualizarBadgeCarregamento(container);
        materialSelect.value = "";
        quantidadeInput.value = "";
        row.querySelector('[name="estado_fisico"]').hidden = true;
        materialSelect.focus();
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
  row.outerHTML = fusaoItemVaiParaPonte(item) ? fusaoCardPonteRowHtml(item) : fusaoCardDiretoRowHtml(item);
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
  const inline = fq(`.fusao-corrida-inline[data-corrida-id="${payload.new?.corrida_id}"]`);
  const forno = inline ? fusaoState.fornos.find((f) => f.id === Number(inline.dataset.fornoId)) : null;
  if (forno) renderFornoCard(forno).catch(() => {});
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
  const corridaAberta = await window.LIDUTEC_PRODUCAO_FUSAO_DATA.corridaAbertaDoForno(forno.id);
  const volumeAtualKg = fusaoState.volumeAtual[forno.id] ?? 0;
  const corridaHtml = corridaAberta ? await corridaCardHtml(corridaAberta, volumeAtualKg) : null;
  if (fusaoRenderTokenPorForno[forno.id] !== token) return; // uma chamada mais nova já assumiu
  card.innerHTML = `<h3>${fEsc(forno.nome)}</h3>`;
  if (corridaAberta) {
    card.insertAdjacentHTML("beforeend", corridaHtml);
    bindCorridaCard(card, forno);
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
  grid.innerHTML = fusaoState.fornos.map((forno) => `<article class="panel fusao-forno-card" data-forno-card="${forno.id}"></article>`).join("");
  await Promise.all(fusaoState.fornos.map((forno) => renderFornoCard(forno).catch((error) => alert(error.message))));
  await loadCorridasList();
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
  const cls = corrida.status === "CANCELADA" ? "is-cancelada" : corrida.status === "FECHADA" ? "is-done" : "is-current";
  fq("#corrida-stepper").innerHTML = `<span class="fusao-status-step ${cls}">${FUSAO_STATUS_NOMES[corrida.status] || corrida.status}</span>`;
}
function renderCorridaStatusActions(corrida) {
  const container = fq("#corrida-status-actions");
  const podeEditar = fusaoState.permissions.has("producao_fusao.lancar");
  if (!podeEditar) { container.innerHTML = ""; return; }
  const botoes = [];
  if (corrida.status === "ABERTA") botoes.push(`<button type="button" class="button button-primary" data-acao="fechar">Fechar corrida</button>`);
  if (corrida.status === "FECHADA") botoes.push(`<button type="button" class="button button-secondary" data-acao="reabrir">Editar (reabrir)</button>`);
  if (corrida.status !== "CANCELADA") botoes.push(`<button type="button" class="button button-danger" data-acao="cancelar">Cancelar corrida</button>`);
  container.innerHTML = botoes.join("");
  container.querySelectorAll("[data-acao]").forEach((button) => {
    button.addEventListener("click", () => executarAcaoCorrida(button.dataset.acao));
  });
}
async function executarAcaoCorrida(acao) {
  if (acao === "cancelar" && !confirm("Cancelar esta corrida? Essa ação não pode ser desfeita.")) return;
  fq("#corrida-status-message").hidden = true;
  try {
    const corrida = await window.LIDUTEC_PRODUCAO_FUSAO_DATA.corrida(fusaoCorridaId());
    if (acao === "fechar") {
      const hora = prompt("Horário de fim da corrida (HH:MM):", fusaoHoraAgora());
      if (hora === null) return;
      if (!/^\d{2}:\d{2}$/.test(hora)) throw new Error("Horário inválido. Use HH:MM.");
      await window.LIDUTEC_PRODUCAO_FUSAO_DATA.fecharCorrida(fusaoCorridaId(), corrida.versao, fusaoMontarDataHora(corrida.data_operacional, hora));
    }
    if (acao === "reabrir") await window.LIDUTEC_PRODUCAO_FUSAO_DATA.reabrirCorrida(fusaoCorridaId(), corrida.versao);
    if (acao === "cancelar") await window.LIDUTEC_PRODUCAO_FUSAO_DATA.cancelarCorrida(fusaoCorridaId(), corrida.versao);
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
function cargaRowHtml(item, podeEditar) {
  const estadoLabel = { SOLIDO: "Sólido", LIQUIDO: "Líquido" };
  return `<tr data-item-id="${item.id}">
      <td>${fEsc(item.materiais_fusao?.nome || "")}${item.estado_fisico ? ` <span class="production-muted">(${estadoLabel[item.estado_fisico] || item.estado_fisico})</span>` : ""}</td>
      <td>${podeEditar ? fusaoEditableCellHtml("planejado", item) : fNumber(item.quantidade_planejada_kg).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}</td>
      <td>${podeEditar ? fusaoEditableCellHtml("realizado", item) : (item.quantidade_realizada_kg != null ? fNumber(item.quantidade_realizada_kg).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "—")}</td>
      <td class="fusao-saldo-cell">${fusaoSaldoCell(item.quantidade_planejada_kg, item.quantidade_realizada_kg)}</td>
    </tr>`;
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
    }
  };
}
async function renderCargaTable(itens, corrida) {
  const podeEditar = fusaoState.permissions.has("producao_fusao.lancar") && corrida.status === "ABERTA";
  fq("#carga-rows").innerHTML = itens.map((item) => cargaRowHtml(item, podeEditar)).join("");
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
    row.outerHTML = cargaRowHtml(item, podeEditar);
  } else {
    // Item novo vai antes das linhas de sobra/entrada/saída (que ficam
    // sempre no fim da tabela).
    const primeiraMovimento = fq("#carga-rows .fusao-movimento-row");
    if (primeiraMovimento) primeiraMovimento.insertAdjacentHTML("beforebegin", cargaRowHtml(item, podeEditar));
    else fq("#carga-rows").insertAdjacentHTML("beforeend", cargaRowHtml(item, podeEditar));
  }
  if (podeEditar) bindEditableCells(fq("#carga-rows"), fusaoCorridaId(), cargaOnSaved(fusaoCorridaCache.itens));
}
function handleCargaItemRealtimeChange(payload) {
  if (payload.eventType === "DELETE") return;
  const novo = payload.new;
  const material = fusaoState.materiais.find((m) => m.id === novo.material_id);
  const idx = fusaoCorridaCache.itens.findIndex((i) => i.id === novo.id);
  const item = {
    id: novo.id, material_id: novo.material_id,
    quantidade_planejada_kg: novo.quantidade_planejada_kg, quantidade_realizada_kg: novo.quantidade_realizada_kg,
    estado_fisico: novo.estado_fisico,
    materiais_fusao: material ? { nome: material.nome, tipo: material.tipo, modo_pesagem: material.modo_pesagem } : fusaoCorridaCache.itens[idx]?.materiais_fusao
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
  renderMovimentosCarga(fusaoCorridaCache.corrida, fusaoCorridaCache.transferencias);
  const adicaoForm = fq("#adicao-form");
  if (adicaoForm) adicaoForm.hidden = fusaoCorridaCache.corrida.status !== "ABERTA";
  const transferirPanel = fq("#transferir-panel");
  if (transferirPanel) transferirPanel.hidden = fusaoCorridaCache.corrida.status !== "ABERTA";
}
// Sobra herdada + transferências (entrada/saída) aparecem como linha na
// carga, igual um material — anexadas no fim de #carga-rows.
function renderMovimentosCarga(corrida, transferencias) {
  const linhas = fusaoMovimentosLinhas(corrida, transferencias).map((tr) => tr.replace("<td>", `<td colspan="4">`));
  fq("#carga-rows").querySelectorAll(".fusao-movimento-row").forEach((row) => row.remove());
  fq("#carga-rows").insertAdjacentHTML("beforeend", linhas.join(""));
}
async function refreshMovimentosCarga() {
  const transferencias = await window.LIDUTEC_PRODUCAO_FUSAO_DATA.transferenciasDaCorrida(fusaoCorridaId());
  fusaoCorridaCache.transferencias = transferencias;
  renderMovimentosCarga(fusaoCorridaCache.corrida, transferencias);
}
async function refreshMensagensCorrida() {
  const id = fusaoCorridaId();
  const mensagens = await window.LIDUTEC_PRODUCAO_FUSAO_DATA.mensagensDaCorrida(id);
  fq("#mensagens-painel").innerHTML = fusaoMensagensPainelHtml(id, mensagens);
  fusaoBindMensagens(fq("#mensagens-painel .fusao-mensagens"));
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
async function loadCorridaDetail() {
  const id = fusaoCorridaId();
  const [corrida, itens, adicoes, transferencias, mensagens] = await Promise.all([
    window.LIDUTEC_PRODUCAO_FUSAO_DATA.corrida(id),
    window.LIDUTEC_PRODUCAO_FUSAO_DATA.cargaItens(id),
    window.LIDUTEC_PRODUCAO_FUSAO_DATA.adicoes(id),
    window.LIDUTEC_PRODUCAO_FUSAO_DATA.transferenciasDaCorrida(id),
    window.LIDUTEC_PRODUCAO_FUSAO_DATA.mensagensDaCorrida(id)
  ]);
  if (!corrida) { fq("#corrida-titulo").textContent = "Corrida não encontrada"; return; }
  fusaoCorridaCache.corrida = corrida;
  fusaoCorridaCache.itens = itens;
  fusaoCorridaCache.transferencias = transferencias;
  fq("#mensagens-painel").innerHTML = fusaoMensagensPainelHtml(id, mensagens);
  fusaoBindMensagens(fq("#mensagens-painel .fusao-mensagens"));
  fq("#corrida-titulo").textContent = `Corrida ${corrida.codigo}`;
  fq("#corrida-subtitulo").textContent = `${corrida.fornos_fusao?.nome || ""} · ${corrida.turno} · ${new Date(`${corrida.data_operacional}T12:00:00`).toLocaleDateString("pt-BR")}`;
  fq("#corrida-codigo").textContent = corrida.codigo;
  fq("#corrida-status-linha").textContent = fusaoCorridaStatusLinhaTexto(corrida);
  renderCorridaStepper(corrida);
  renderCorridaStatusActions(corrida);
  await renderCargaTable(itens, corrida);
  renderMovimentosCarga(corrida, transferencias);
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
    button.disabled = true;
    try {
      const fornoDestinoId = Number(form.elements.forno_destino_id.value);
      const quantidade = Number(form.elements.quantidade_kg.value);
      if (!fornoDestinoId || !quantidade) throw new Error("Selecione o forno destino e informe a quantidade.");
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
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "transferencias_fusao", filter: `corrida_origem_id=eq.${corridaId}` }, () => refreshMovimentosCarga().catch(() => {}))
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "transferencias_fusao", filter: `corrida_destino_id=eq.${corridaId}` }, () => refreshMovimentosCarga().catch(() => {}))
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "corridas_fusao_mensagens", filter: `corrida_id=eq.${corridaId}` }, () => refreshMensagensCorrida().catch(() => {}))
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
// Vai pra Ponte só quem é pesado por ponte E não é carga líquida — material
// Manual (sem crane) e carga líquida (qualquer material) são lançados
// direto no card do forno, sem passar pela tela da Ponte.
function fusaoItemVaiParaPonte(item) {
  return (item.materiais_fusao?.modo_pesagem ?? "PONTE") === "PONTE" && item.estado_fisico !== "LIQUIDO";
}
function ponteStatusHtml(realizado, planejado) {
  const concluido = fNumber(realizado) > 0 && fNumber(realizado) >= fNumber(planejado);
  return concluido
    ? `<span class="fusao-ponte-status is-concluido">✓ Concluído</span>`
    : `<span class="fusao-ponte-status is-pendente">Pendente</span>`;
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
function ponteLogEntradaHtml(entrada) {
  const hora = new Date(entrada.registrado_em).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const nome = fEsc(entrada.usuarios?.nome || entrada.nome || "—");
  return `<span class="fusao-ponte-log-entry">${hora} — <strong>${nome}</strong>: +${fNumber(entrada.quantidade_kg).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} kg</span>`;
}
// Rastreabilidade pedida explicitamente: precisa dar pra ver quem lançou
// cada entrega, quanto e a que horas — não só o total acumulado.
function ponteLogHtml(log) {
  if (!log?.length) return `<span class="production-muted">Nenhuma entrega registrada ainda.</span>`;
  return log.map(ponteLogEntradaHtml).join("");
}
// Quadro de recados da corrida — comunicação entre quem planeja e quem
// pesa na Ponte. Simples de propósito: sem "lido/não lido", só a lista
// com quem escreveu, quando e o quê.
function fusaoMensagemHtml(mensagem) {
  const hora = new Date(mensagem.criado_em).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  return `<p class="fusao-mensagem"><strong>${fEsc(mensagem.usuarios?.nome || "—")}</strong> <span class="production-muted">(${hora})</span>: ${fEsc(mensagem.mensagem)}</p>`;
}
function fusaoMensagensListaHtml(mensagens) {
  if (!mensagens?.length) return `<p class="production-muted fusao-mensagens-vazio">Nenhuma mensagem ainda.</p>`;
  return mensagens.map(fusaoMensagemHtml).join("");
}
function fusaoMensagensPainelHtml(corridaId, mensagens) {
  return `<div class="fusao-mensagens" data-corrida-id="${corridaId}">
      <div class="fusao-mensagens-lista">${fusaoMensagensListaHtml(mensagens)}</div>
      <div class="fusao-mensagem-form">
        <input type="text" class="fusao-mensagem-input" maxlength="500" placeholder="Falar com quem planeja/pesa esta corrida...">
        <button type="button" class="button button-secondary" data-enviar-mensagem>Enviar</button>
      </div>
    </div>`;
}
// Liga o botão/Enter de um painel de mensagens — reaproveitado nas 3 telas
// (Ponte, card do forno, corrida).
function fusaoBindMensagens(painel) {
  if (!painel || painel.dataset.bound) return;
  painel.dataset.bound = "1";
  const corridaId = Number(painel.dataset.corridaId);
  const input = painel.querySelector(".fusao-mensagem-input");
  const botao = painel.querySelector("[data-enviar-mensagem]");
  const enviar = async () => {
    const texto = input.value.trim();
    if (!texto) { input.focus(); return; }
    input.disabled = true; botao.disabled = true;
    try {
      await window.LIDUTEC_PRODUCAO_FUSAO_DATA.enviarMensagemCorrida(corridaId, texto);
      // Mostra na hora, sem esperar Realtime/poll — o foco continua no
      // campo depois de enviar, e a atualização automática das outras
      // telas não mexe em quem está digitando (por design).
      const lista = painel.querySelector(".fusao-mensagens-lista");
      if (lista.querySelector(".fusao-mensagens-vazio")) lista.innerHTML = "";
      lista.insertAdjacentHTML("beforeend", fusaoMensagemHtml({
        mensagem: texto, criado_em: new Date().toISOString(), usuarios: { nome: fusaoState.userNome }
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
// Item concluído trava a célula de entrega igual acontece nas telas do
// supervisor: a caixa de digitar some, e quem quiser lançar mais precisa
// confirmar "Colocar carga" antes (evita passar do planejado sem querer).
function fusaoPonteEntregaDestravadaHtml(corridaId, itemId) {
  // Só número inteiro na Ponte (pedido explícito) — inputmode="numeric" +
  // pattern="[0-9]*" garante o teclado só-números no tablet (o pattern é o
  // que faz o Safari/iOS esconder ponto e sinal, que o inputmode sozinho
  // às vezes não tira). A validação de verdade (recusar fração) continua
  // acontecendo em confirmarEntrega.
  return `<input type="number" inputmode="numeric" pattern="[0-9]*" min="1" step="1" class="fusao-entrega-input" data-corrida-id="${corridaId}" data-item-id="${itemId}">
    <button type="button" class="button button-primary" data-confirmar-entrega>OK</button>`;
}
function fusaoPonteEntregaTravadaHtml(corridaId, itemId) {
  return `<span class="fusao-ponte-entrega-travada">
      <span class="production-muted">Concluído</span>
      <button type="button" class="button button-secondary fusao-ponte-desbloquear" data-corrida-id="${corridaId}" data-item-id="${itemId}">Colocar carga</button>
    </span>`;
}
function fusaoPonteEntregaCellHtml(corridaId, item) {
  return fusaoItemConcluido(item) ? fusaoPonteEntregaTravadaHtml(corridaId, item.id) : fusaoPonteEntregaDestravadaHtml(corridaId, item.id);
}
function pontePreencherCorrida(container, corrida) {
  const estadoLabel = { SOLIDO: "Sólido", LIQUIDO: "Líquido" };
  const itens = (corrida.corridas_fusao_carga_itens || []).filter(fusaoItemVaiParaPonte);
  if (!itens.length) return;
  container.insertAdjacentHTML("beforeend", `<article class="fusao-ponte-corrida">
      <h4>${fEsc(corrida.fornos_fusao?.nome || "")} — corrida ${fEsc(corrida.codigo)} (${corrida.turno})</h4>
      <table class="products-table"><thead><tr><th>Material</th><th>Planejado (kg)</th><th>Acumulado (kg)</th><th>Progresso</th><th>Nova entrega (kg)</th><th>Status</th></tr></thead>
      <tbody>${itens.map((item) => `<tr data-item-id="${item.id}" data-planejado="${item.quantidade_planejada_kg}" class="${fNumber(item.quantidade_realizada_kg) >= fNumber(item.quantidade_planejada_kg) && fNumber(item.quantidade_realizada_kg) > 0 ? "is-concluido" : ""}">
          <td>${fEsc(item.materiais_fusao?.nome || "")}${item.estado_fisico ? ` <span class="production-muted">(${estadoLabel[item.estado_fisico] || item.estado_fisico})</span>` : ""}</td>
          <td>${fNumber(item.quantidade_planejada_kg).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}</td>
          <td class="fusao-ponte-acumulado"><strong>${fNumber(item.quantidade_realizada_kg).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}</strong></td>
          <td class="fusao-ponte-progresso">${fusaoProgressoHtml(item.quantidade_realizada_kg, item.quantidade_planejada_kg)}</td>
          <td class="fusao-ponte-entrega">${fusaoPonteEntregaCellHtml(corrida.id, item)}</td>
          <td class="fusao-ponte-status-cell">${ponteStatusHtml(item.quantidade_realizada_kg, item.quantidade_planejada_kg)}</td>
        </tr>
        <tr class="fusao-ponte-log-row"><td colspan="6"><div class="fusao-ponte-log" data-log-item-id="${item.id}">${ponteLogHtml(item.corridas_fusao_pesagens_ponte_log)}</div></td></tr>`).join("")}</tbody></table>
      ${fusaoMensagensPainelHtml(corrida.id, corrida.corridas_fusao_mensagens)}
    </article>`);
}
// Bipa quando: uma corrida nova aparece nesse carro, um material novo é
// incluído na carga de uma corrida já aberta, o planejado de um material
// muda, ou chega mensagem nova (pedido explícito) — nunca no carregamento
// inicial da página, só em cima do que já era conhecido.
const fusaoPonteConhecidos = {};
function fusaoPonteDetectarNovidade(carro, corridas) {
  const atual = { corridas: new Set(), planejados: new Map(), mensagens: new Map() };
  for (const corrida of corridas) {
    atual.corridas.add(corrida.id);
    for (const item of (corrida.corridas_fusao_carga_itens || []).filter(fusaoItemVaiParaPonte)) {
      atual.planejados.set(item.id, fNumber(item.quantidade_planejada_kg));
    }
    atual.mensagens.set(corrida.id, (corrida.corridas_fusao_mensagens || []).length);
  }
  const anterior = fusaoPonteConhecidos[carro];
  let novidade = false;
  if (anterior) {
    for (const id of atual.corridas) if (!anterior.corridas.has(id)) novidade = true;
    for (const [itemId, planejado] of atual.planejados) {
      if (!anterior.planejados.has(itemId) || anterior.planejados.get(itemId) !== planejado) novidade = true;
    }
    for (const [corridaId, total] of atual.mensagens) {
      if ((anterior.mensagens.get(corridaId) ?? 0) < total) novidade = true;
    }
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
      row.querySelector(".fusao-ponte-acumulado strong").textContent = fNumber(total).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
      row.querySelector(".fusao-ponte-status-cell").innerHTML = ponteStatusHtml(total, row.dataset.planejado);
      row.querySelector(".fusao-ponte-progresso").innerHTML = fusaoProgressoHtml(total, row.dataset.planejado);
      const concluido = fNumber(total) > 0 && fNumber(total) >= fNumber(row.dataset.planejado);
      row.classList.toggle("is-concluido", concluido);
      const logEl = row.nextElementSibling?.querySelector(`[data-log-item-id="${input.dataset.itemId}"]`);
      if (logEl) {
        if (logEl.querySelector(".production-muted")) logEl.innerHTML = "";
        logEl.insertAdjacentHTML("afterbegin", ponteLogEntradaHtml({ quantidade_kg: valor, registrado_em: new Date().toISOString(), nome: fusaoState.userNome }));
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
  // Ponte aceita também a permissão restrita (só pesagem, sem acesso ao
  // planejamento/corrida) — as outras páginas do módulo continuam exigindo
  // a permissão geral de visualizar.
  const podeVerFusao = permissions.has("producao_fusao.visualizar");
  const podeVerPonte = podeVerFusao || permissions.has("producao_fusao.lancar_ponte");
  if (fusaoPage === "ponte" ? !podeVerPonte : !podeVerFusao) { location.replace("../dashboard.html"); return; }
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

  fq("#menu-button")?.addEventListener("click", () => fq("#sidebar").classList.toggle("open"));
  fq("#logout-button")?.addEventListener("click", () => window.LIDUTEC_APP.signOut());
}

initializeFusaoProduction().catch((error) => {
  const loading = fq("#production-loading");
  if (loading) loading.textContent = error.message;
  else alert(error.message);
});
