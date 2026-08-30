// Tela de saída de panelas do Holding (etapa 4 do roadmap da Fusão).
// Reaproveita fusaoState/fEsc/fNumber/fusaoKg/fusaoCodigoCorridaMascarado/
// fusaoHoraAgora/fusaoMontarDataHora, todos globais em producao-fusao.js
// (carregado antes deste arquivo) — sem duplicar essas funções aqui.
const PANELA_CAMPOS = [
  { campo: "peso_kg", label: "Peso (kg)" },
  { campo: "temperatura_c", label: "Temp (°C)" },
  { campo: "carbono_equivalente", label: "CE" },
  { campo: "fesimg_liga1_kg", label: "FeSiMg L1 (kg)" },
  { campo: "fesimg_liga4_kg", label: "FeSiMg L4 (kg)" },
  { campo: "inoculante_kg", label: "Inoculante (kg)" },
  { campo: "silicio_kg", label: "Silício (kg)" },
  { campo: "grafite_kg", label: "Grafite (kg)" },
  { campo: "sucata_cobertura_kg", label: "Sucata cobertura (kg)" }
];
const PANELA_STATUS_NOMES = {
  SAIDA_HOLDING: "Saída Holding", EM_TRANSITO: "Em trânsito", RECEBIDA_VAZAMENTO: "Recebida Vazamento",
  EM_VAZAMENTO: "Em vazamento", VAZADA: "Vazada", REJEITADA: "Rejeitada",
  RETORNO_PENDENTE: "Retorno pendente", RETORNADA: "Retornada"
};

// Célula editável genérica (clica, edita, OK) — igual ao padrão já usado em
// produto/número da corrida, só que reaproveitada pra qualquer um dos
// campos numéricos da panela (whitelist fica na RPC).
function fusaoPanelaCampoHtml(panela, campo) {
  const valor = panela[campo];
  return `<span class="fusao-holding-campo-editavel" data-panela-id="${panela.id}" data-campo="${campo}">
      <span class="fusao-holding-campo-display" data-valor="${valor ?? ""}">${valor != null ? fNumber(valor).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "—"}</span>
      <button type="button" class="fusao-editable-toggle" title="Editar">...</button>
    </span>`;
}
function bindPanelaCampoEditavel(scope, onSaved) {
  scope.querySelectorAll(".fusao-holding-campo-editavel").forEach((cell) => {
    if (cell.dataset.bound) return;
    cell.dataset.bound = "1";
    const toggle = cell.querySelector(".fusao-editable-toggle");
    toggle.dataset.mode = "editar";
    toggle.addEventListener("click", async () => {
      const panelaId = Number(cell.dataset.panelaId);
      const campo = cell.dataset.campo;
      if (toggle.dataset.mode !== "salvar") {
        const display = cell.querySelector(".fusao-holding-campo-display");
        display.outerHTML = `<input type="number" step="0.01" class="fusao-holding-campo-input" value="${display.dataset.valor}">`;
        toggle.dataset.mode = "salvar";
        toggle.textContent = "OK";
        toggle.title = "Salvar";
        cell.querySelector("input").focus();
        return;
      }
      const input = cell.querySelector("input");
      const novoValor = input.value === "" ? null : Number(input.value);
      try {
        toggle.disabled = true; input.disabled = true;
        await window.LIDUTEC_PRODUCAO_FUSAO_DATA.atualizarCampoPanelaHolding(panelaId, campo, novoValor);
        input.outerHTML = `<span class="fusao-holding-campo-display" data-valor="${novoValor ?? ""}">${novoValor != null ? fNumber(novoValor).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "—"}</span>`;
        toggle.dataset.mode = "editar";
        toggle.textContent = "...";
        toggle.title = "Editar";
        if (campo === "peso_kg") await onSaved?.();
      } catch (error) {
        input.disabled = false;
        alert(error.message);
      } finally {
        toggle.disabled = false;
      }
    });
  });
}
function panelaRowHtml(panela) {
  const produto = panela.produtos;
  return `<tr data-panela-id="${panela.id}">
      <td>${panela.sequencial}</td>
      <td>${panela.hora_retirada ? new Date(panela.hora_retirada).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
      ${PANELA_CAMPOS.map((c) => `<td>${fusaoPanelaCampoHtml(panela, c.campo)}</td>`).join("")}
      <td>${fEsc(produto?.codigo || "—")}</td>
      <td>${PANELA_STATUS_NOMES[panela.status] || panela.status}</td>
    </tr>`;
}
// Temperatura e CE não entram na soma (são medições, não quantidades).
const PANELA_CAMPOS_SEM_SOMA = new Set(["temperatura_c", "carbono_equivalente"]);
function panelasTotalRowHtml(panelas) {
  const celulas = PANELA_CAMPOS.map((c) => {
    if (PANELA_CAMPOS_SEM_SOMA.has(c.campo)) return "<td>—</td>";
    const soma = panelas.reduce((total, p) => total + fNumber(p[c.campo]), 0);
    return `<td><strong>${fNumber(soma).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}</strong></td>`;
  }).join("");
  return `<tr class="fusao-tabela-total-row"><td colspan="2"><strong>Total</strong></td>${celulas}<td></td><td></td></tr>`;
}
function panelasTabelaHtml(panelas) {
  if (!panelas.length) return `<p class="production-muted">Nenhuma panela retirada ainda nesta corrida.</p>`;
  return `<div class="fusao-holding-table-wrapper"><table class="fusao-holding-table">
      <thead><tr class="fusao-cabecalho-retirada"><th>Nº</th><th>Hora</th>${PANELA_CAMPOS.map((c) => `<th>${c.label}</th>`).join("")}<th>Produto</th><th>Status</th></tr></thead>
      <tbody>${panelas.map(panelaRowHtml).join("")}</tbody>
      <tfoot>${panelasTotalRowHtml(panelas)}</tfoot>
    </table></div>`;
}
// "+ Nova panela" — herda a maioria dos campos metalúrgicos direto no
// banco (a RPC cuida disso); só peso e hora são sempre novos. FeSiMg Liga
// 1/4 aparecem já no formulário, pré-preenchidos com o valor da última
// panela desse Holding, mas editáveis antes de confirmar (pedido
// explícito — os outros campos herdados continuam só editáveis depois,
// na tabela).
async function criarLinhaNovaPanela(corridaId, dataOperacional, fornoId, onCriada) {
  const ultima = await window.LIDUTEC_PRODUCAO_FUSAO_DATA.ultimaPanelaHolding(fornoId);
  const row = document.createElement("div");
  row.className = "fusao-item-row fusao-nova-panela-campos";
  row.innerHTML = `<input name="hora_retirada" type="time" value="${fusaoHoraAgora()}" required>
    <input name="peso_kg" type="number" min="0.01" step="0.01" placeholder="Peso (kg)" required>
    <input name="fesimg_liga1_kg" type="number" min="0" step="0.01" placeholder="FeSiMg Liga 1 (kg)" value="${ultima?.fesimg_liga1_kg ?? ""}">
    <input name="fesimg_liga4_kg" type="number" min="0" step="0.01" placeholder="FeSiMg Liga 4 (kg)" value="${ultima?.fesimg_liga4_kg ?? ""}">
    <button type="button" class="button button-primary">Adicionar</button>`;
  const confirmar = row.querySelector("button");
  confirmar.addEventListener("click", async () => {
    try {
      const hora = row.querySelector('[name="hora_retirada"]').value;
      const peso = Number(row.querySelector('[name="peso_kg"]').value);
      const fesimgLiga1 = row.querySelector('[name="fesimg_liga1_kg"]').value;
      const fesimgLiga4 = row.querySelector('[name="fesimg_liga4_kg"]').value;
      if (!hora || !peso) throw new Error("Informe o horário e o peso da panela.");
      confirmar.disabled = true;
      await window.LIDUTEC_PRODUCAO_FUSAO_DATA.criarPanelaHolding(
        corridaId, peso, fusaoMontarDataHora(dataOperacional, hora),
        fesimgLiga1 === "" ? null : Number(fesimgLiga1), fesimgLiga4 === "" ? null : Number(fesimgLiga4)
      );
      await onCriada();
    } catch (error) {
      alert(error.message);
    } finally {
      confirmar.disabled = false;
    }
  });
  return row;
}
async function renderHoldingCard(forno) {
  const card = document.querySelector(`[data-holding-card="${forno.id}"]`);
  if (!card) return;
  if (card.contains(document.activeElement)) return; // não pisa em cima de quem está editando
  const corrida = await window.LIDUTEC_PRODUCAO_FUSAO_DATA.corridaAbertaDoForno(forno.id);
  card.innerHTML = `<h3>${fEsc(forno.nome)}</h3>`;
  if (!corrida) {
    card.insertAdjacentHTML("beforeend", `<p class="production-muted">Nenhuma corrida aberta neste Holding.</p>`);
    return;
  }
  const produto = fusaoState.produtos.find((p) => p.id === corrida.produto_id);
  const volumeAtual = fusaoState.volumeAtual[forno.id] ?? 0;
  card.insertAdjacentHTML("beforeend", `
    <div class="fusao-holding-cabecalho">
      <p class="fusao-holding-corrida-linha">
        <strong>${fEsc(fusaoCodigoCorridaMascarado(corrida.codigo))}</strong>
        · <strong>${fEsc(produto?.codigo || "—")}</strong>
      </p>
      <p class="fusao-holding-saldo-destaque">Saldo do forno<br><strong class="fusao-holding-saldo">${fusaoKg(volumeAtual)} kg</strong></p>
    </div>
    <button type="button" class="button button-secondary" data-toggle-nova-panela>+ Nova panela</button>
    <div class="fusao-nova-panela-row" hidden></div>
    <div class="fusao-holding-tabela"></div>
    <div class="fusao-holding-acoes">
      <button type="button" class="button button-primary" data-fechar-corrida>Fechar corrida</button>
    </div>
    <div class="form-message fusao-holding-message" hidden></div>
  `);
  const panelas = await window.LIDUTEC_PRODUCAO_FUSAO_DATA.panelasDaCorrida(corrida.id);
  const tabelaEl = card.querySelector(".fusao-holding-tabela");
  const atualizarSaldoExibido = async () => {
    const volumeRows = await window.LIDUTEC_PRODUCAO_FUSAO_DATA.volumeAtualFornos();
    fusaoState.volumeAtual = Object.fromEntries(volumeRows.map((r) => [r.forno_id, r.volume_atual_kg]));
    const saldoEl = card.querySelector(".fusao-holding-saldo");
    if (saldoEl) saldoEl.textContent = `${fusaoKg(fusaoState.volumeAtual[forno.id] ?? 0)} kg`;
  };
  const desenharTabela = () => {
    tabelaEl.innerHTML = panelasTabelaHtml(panelas);
    bindPanelaCampoEditavel(tabelaEl, atualizarSaldoExibido);
  };
  desenharTabela();
  const rowsContainer = card.querySelector(".fusao-nova-panela-row");
  card.querySelector("[data-toggle-nova-panela]").addEventListener("click", async () => {
    if (rowsContainer.hidden) {
      rowsContainer.hidden = false;
      rowsContainer.innerHTML = `<p class="production-muted">Carregando...</p>`;
      const linha = await criarLinhaNovaPanela(corrida.id, corrida.data_operacional, forno.id, async () => {
        await atualizarSaldoExibido();
        await renderHoldingCard(forno);
      });
      rowsContainer.innerHTML = "";
      rowsContainer.appendChild(linha);
    } else {
      rowsContainer.hidden = true;
    }
  });
  // Fechar corrida direto por aqui — sem precisar ir pro planejamento
  // (mesmo horário de fim sempre-o-primeiro-informado das outras telas).
  card.querySelector("[data-fechar-corrida]").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const mensagem = card.querySelector(".fusao-holding-message");
    if (mensagem) mensagem.hidden = true;
    try {
      let fimIso = corrida.fim;
      if (!fimIso) {
        const hora = prompt("Horário de fim da corrida (HH:MM):", fusaoHoraAgora());
        if (hora === null) return;
        if (!/^\d{2}:\d{2}$/.test(hora)) throw new Error("Horário inválido. Use HH:MM.");
        fimIso = fusaoMontarDataHora(corrida.data_operacional, hora);
      }
      button.disabled = true;
      await window.LIDUTEC_PRODUCAO_FUSAO_DATA.fecharCorrida(corrida.id, corrida.versao, fimIso);
      await renderHoldingCard(forno);
    } catch (error) {
      if (mensagem) { mensagem.textContent = error.message; mensagem.className = "form-message error"; mensagem.hidden = false; }
      else alert(error.message);
      button.disabled = false;
    }
  });
}
async function initializeFusaoHolding() {
  const grid = document.querySelector("#holding-grid");
  const fornosHolding = fusaoState.fornos.filter((f) => f.tipo === "HOLDING");
  grid.innerHTML = fornosHolding.map((forno) => `<article class="panel fusao-holding-card" data-holding-card="${forno.id}"></article>`).join("");
  await Promise.all(fornosHolding.map((forno) => renderHoldingCard(forno)));
  // Outros papéis (planejamento, Ponte) podem mexer na mesma corrida do
  // Holding ao mesmo tempo — reconsulta em intervalo, sem pisar em quem
  // está editando uma célula (mesma proteção do card do índice).
  setInterval(() => { fornosHolding.forEach((forno) => renderHoldingCard(forno).catch(() => {})); }, 15000);
}
window.initializeFusaoHolding = initializeFusaoHolding;
