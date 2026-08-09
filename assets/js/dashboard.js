const dashboard = {
  sidebar: document.querySelector("#sidebar"),
  from: document.querySelector("#dashboard-from"),
  to: document.querySelector("#dashboard-to"),
  refresh: document.querySelector("#dashboard-refresh"),
  loading: document.querySelector("#dashboard-loading"),
  message: document.querySelector("#dashboard-message"),
  activeFilters: document.querySelector("#dashboard-active-filters"),
  filterChips: document.querySelector("#dashboard-filter-chips"),
  clearFilters: document.querySelector("#dashboard-clear-filters"),
  data: { records: [], stops: [], turns: [], scheduledStops: [] },
  filters: { date: null, shift: null, product: null, sector: null, reason: null }
};

const shifts = ["MANHA", "TARDE", "NOITE"];
const shiftLabels = { MANHA: "Manhã", TARDE: "Tarde", NOITE: "Noite" };
const shiftShortLabels = { MANHA: "M", TARDE: "T", NOITE: "N" };
const shiftColors = { MANHA: "#f2ef85", TARDE: "#79e98d", NOITE: "#82bdf2" };
const chartColors = ["#1687f8", "#172eaa", "#ef6c2f", "#73139a", "#e23e9d", "#7147c7", "#65c84a", "#f2c230"];
const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const number = value => Number(value || 0);
const formatNumber = value => number(value).toLocaleString("pt-BR");
const sum = (rows, selector) => rows.reduce((total, row) => total + number(selector(row)), 0);
const formatTime = value => value ? new Date(value).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—";
const durationLabel = minutes => `${Math.floor(minutes / 60)}h ${String(Math.round(minutes % 60)).padStart(2, "0")}min`;
const displayDate = value => new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

function today() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
}

function yesterday() {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
}

function datesBetween(from, to) {
  const dates = [];
  for (const date = new Date(`${from}T12:00:00`), end = new Date(`${to}T12:00:00`); date <= end; date.setDate(date.getDate() + 1)) {
    const local = new Date(date);
    local.setMinutes(local.getMinutes() - local.getTimezoneOffset());
    dates.push(local.toISOString().slice(0, 10));
  }
  return dates;
}

function filterClass(type, value) {
  const selected = dashboard.filters[type];
  return selected === value ? " filter-active" : selected ? " filter-dimmed" : "";
}

function filterAttributes(type, value) {
  return `data-filter="${type}" data-value="${escapeHtml(value)}" class="${filterClass(type, value).trim()}"`;
}

function filteredData() {
  const filters = dashboard.filters;
  const common = row => (!filters.date || row.data_operacional === filters.date) && (!filters.shift || row.turno === filters.shift);
  return {
    records: dashboard.data.records.filter(row => common(row) && (!filters.product || (row.produtos?.codigo || row.produtos?.nome) === filters.product)),
    stops: dashboard.data.stops.filter(row => common(row) && (!filters.sector || (row.setores_responsaveis_parada?.nome || "Não informado") === filters.sector) && (!filters.reason || (row.categorias_parada_producao?.nome || row.motivo || "Não informado") === filters.reason))
  };
}

function group(rows, labelSelector, valueSelector) {
  const grouped = new Map();
  for (const row of rows) {
    const label = labelSelector(row) || "Não informado";
    const current = grouped.get(label) || { label, MANHA: 0, TARDE: 0, NOITE: 0, total: 0 };
    const value = number(valueSelector(row));
    if (shifts.includes(row.turno)) current[row.turno] += value;
    current.total += value;
    grouped.set(label, current);
  }
  return [...grouped.values()].sort((left, right) => right.total - left.total || left.label.localeCompare(right.label, "pt-BR"));
}

function summaryRows(rows, filterType) {
  if (!rows.length) return '<tr><td colspan="5" class="empty-state">Sem dados no período.</td></tr>';
  return rows.map(row => `<tr ${filterAttributes(filterType, row.label)}><td>${escapeHtml(row.label)}</td>${shifts.map(shift => `<td>${row[shift] ? formatNumber(row[shift]) : ""}</td>`).join("")}<td><strong>${formatNumber(row.total)}</strong></td></tr>`).join("");
}

function summaryTotal(rows) {
  return `<tr><th>Total</th>${shifts.map(shift => `<th>${formatNumber(sum(rows, row => row[shift]))}</th>`).join("")}<th>${formatNumber(sum(rows, row => row.total))}</th></tr>`;
}

function renderHorizontalBars(stops) {
  const data = shifts.map(shift => ({ shift, value: sum(stops.filter(row => row.turno === shift), row => row.duracao_minutos) }));
  const maximum = Math.max(1, ...data.map(item => item.value));
  document.querySelector("#shift-stop-bars").innerHTML = data.map(item => `<div ${filterAttributes("shift", item.shift)}><span>${shiftLabels[item.shift]}</span><i><b style="width:${item.value / maximum * 100}%;background:${shiftColors[item.shift]}"></b></i><strong>${formatNumber(item.value)}</strong></div>`).join("");
  for (const element of document.querySelectorAll("#shift-stop-bars>[data-filter]")) element.classList.add("report-horizontal-bar");
}

function renderVerticalBars(records) {
  const data = shifts.map(shift => ({ shift, value: sum(records.filter(row => row.turno === shift), row => row.moldes_vazados) }));
  const maximum = Math.max(1, ...data.map(item => item.value));
  document.querySelector("#shift-production-bars").innerHTML = data.map(item => `<div ${filterAttributes("shift", item.shift)}><strong>${formatNumber(item.value)}</strong><i style="height:${Math.max(item.value ? 8 : 0, item.value / maximum * 100)}%;background:${shiftColors[item.shift]}"></i><span>${shiftLabels[item.shift]}</span></div>`).join("");
  for (const element of document.querySelectorAll("#shift-production-bars>[data-filter]")) element.classList.add("report-vertical-bar");
}

function renderDonut(rows) {
  const total = sum(rows, row => row.total);
  let angle = 0;
  const segments = rows.map((row, index) => {
    const start = angle;
    angle += total ? row.total / total * 360 : 0;
    return `${chartColors[index % chartColors.length]} ${start}deg ${angle}deg`;
  });
  document.querySelector("#sector-donut").style.background = segments.length ? `conic-gradient(${segments.join(",")})` : "#e6e6e6";
  document.querySelector("#sector-legend").innerHTML = rows.map((row, index) => `<span ${filterAttributes("sector", row.label)}><i style="background:${chartColors[index % chartColors.length]}"></i>${escapeHtml(row.label)} <strong>${total ? (row.total / total * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) : 0}%</strong></span>`).join("");
}

function mergeSegments(segments) {
  const merged = [];
  for (const segment of segments) {
    const last = merged.at(-1);
    if (last?.type === segment.type) last.minutes += segment.minutes;
    else merged.push({ ...segment });
  }
  return merged;
}

function shiftTimeline(date, shift, turn, stops, now, scheduled) {
  const bounds = LIDUTEC_TURNOS.shiftBounds(date, shift);
  const start = bounds.start.getTime(), end = bounds.end.getTime(), total = (end - start) / 60000;
  const effectiveEnd = !turn ? start : turn.status === "ABERTO" ? Math.max(start, Math.min(end, now.getTime())) : end;
  const relevant = stops.filter(row => row.turno === shift).map(row => [Math.max(start, new Date(row.inicio).getTime()), Math.min(effectiveEnd, new Date(row.fim).getTime())]).filter(([from, to]) => to > from).sort((a, b) => a[0] - b[0]);
  // Janela de parada programada aparece em amarelo mesmo sem parada real
  // lançada, e tem prioridade sobre a parada real (mesma regra da linha do
  // tempo do apontamento: a amarela sobrepõe a vermelha).
  const planned = LIDUTEC_PARADAS_PROGRAMADAS.overlapIntervals({ janelas: scheduled || [], turnoInicio: bounds.start, paradaInicio: bounds.start, paradaFim: bounds.end, turno: shift, dataOperacional: date }).map(interval => [interval.start.getTime(), interval.end.getTime()]);
  const points = new Set([start, effectiveEnd, end]);
  for (const [from, to] of relevant) { points.add(from); points.add(to); }
  for (const [from, to] of planned) { points.add(from); points.add(to); }
  const sorted = [...points].sort((a, b) => a - b), segments = [];
  for (let index = 0; index < sorted.length - 1; index++) {
    const from = sorted[index], to = sorted[index + 1];
    if (to <= from) continue;
    const middle = (from + to) / 2;
    const type = from >= effectiveEnd ? "inactive"
      : planned.some(([plannedFrom, plannedTo]) => middle >= plannedFrom && middle < plannedTo) ? "planned"
      : relevant.some(([stopFrom, stopTo]) => middle >= stopFrom && middle < stopTo) ? "stopped"
      : "productive";
    segments.push({ type, minutes: (to - from) / 60000 });
  }
  return { shift, total, segments: mergeSegments(segments) };
}

function renderTimeline(stops) {
  const now = new Date(), dates = datesBetween(dashboard.from.value, dashboard.to.value);
  const turnMap = new Map(dashboard.data.turns.map(turn => [`${turn.data_operacional}|${turn.turno}`, turn]));
  const totals = { productive: 0, stopped: 0, planned: 0, inactive: 0 };
  const days = dates.map(date => {
    const dayStops = stops.filter(stop => stop.data_operacional === date);
    const tracks = shifts.map(shift => shiftTimeline(date, shift, turnMap.get(`${date}|${shift}`), dayStops, now, dashboard.data.scheduledStops));
    for (const track of tracks) for (const segment of track.segments) {
      if ((!dashboard.filters.date || dashboard.filters.date === date) && (!dashboard.filters.shift || dashboard.filters.shift === track.shift)) totals[segment.type] += segment.minutes;
    }
    return `<div class="report-timeline-day${filterClass("date", date)}"><button type="button" class="report-timeline-day-label" data-filter="date" data-value="${date}">${displayDate(date)}</button><div class="report-timeline-day-shifts">${tracks.map(track => `<div class="report-timeline-cell${filterClass("shift", track.shift)}"><button type="button" data-filter="shift" data-value="${track.shift}" title="${shiftLabels[track.shift]}">${shiftShortLabels[track.shift]}</button><div class="report-continuous-track">${track.segments.map(segment => `<b class="${segment.type}" style="width:${segment.minutes / track.total * 100}%" title="${durationLabel(segment.minutes)}"></b>`).join("")}</div></div>`).join("")}</div></div>`;
  }).join("");
  document.querySelector("#period-timeline").innerHTML = `<div class="report-timeline-flow">${days}</div>`;
  document.querySelector("#timeline-production-total").textContent = durationLabel(totals.productive);
  document.querySelector("#timeline-stop-total").textContent = durationLabel(totals.stopped);
  document.querySelector("#timeline-planned-total").textContent = durationLabel(totals.planned);
  document.querySelector("#timeline-inactive-total").textContent = durationLabel(totals.inactive);
}

function renderFilters() {
  const labels = { date: "Data", shift: "Turno", product: "Produto", sector: "Setor", reason: "Motivo" };
  const entries = Object.entries(dashboard.filters).filter(([, value]) => value);
  dashboard.activeFilters.hidden = !entries.length;
  dashboard.filterChips.innerHTML = entries.map(([type, value]) => `<button type="button" class="report-filter-chip" data-remove-filter="${type}">${labels[type]}: ${escapeHtml(type === "shift" ? shiftLabels[value] : type === "date" ? displayDate(value) : value)} ×</button>`).join("");
}

function render() {
  const { records, stops } = filteredData();
  const products = group(records, row => row.produtos?.codigo || row.produtos?.nome, row => row.moldes_vazados);
  const sectors = group(stops, row => row.setores_responsaveis_parada?.nome, row => row.duracao_minutos);
  const reasons = group(stops, row => row.categorias_parada_producao?.nome || row.motivo, row => row.duracao_minutos);
  const stoppedMinutes = sum(stops, row => row.duracao_minutos);
  document.querySelector("#poured-molds").textContent = formatNumber(sum(records, row => row.moldes_vazados));
  document.querySelector("#stop-occurrences").textContent = formatNumber(stops.length);
  document.querySelector("#stop-total").textContent = `${formatNumber(stoppedMinutes)} min`;
  document.querySelector("#produced-tons").textContent = sum(records, row => row.toneladas_produzidas).toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  renderHorizontalBars(stops); renderVerticalBars(records);
  for (const [body, foot, rows, type] of [["#product-summary", "#product-summary-total", products, "product"], ["#sector-summary", "#sector-summary-total", sectors, "sector"], ["#reason-summary", "#reason-summary-total", reasons, "reason"]]) {
    document.querySelector(body).innerHTML = summaryRows(rows, type);
    document.querySelector(foot).innerHTML = summaryTotal(rows);
  }
  document.querySelector("#stop-details").innerHTML = stops.length ? stops.map(row => `<tr><td>${escapeHtml(shiftLabels[row.turno] || row.turno)}</td><td>${formatTime(row.inicio)}</td><td>${formatTime(row.fim)}</td><td>${formatNumber(row.duracao_minutos)}</td><td>${escapeHtml(row.setores_responsaveis_parada?.nome || "—")}</td><td>${escapeHtml(row.categorias_parada_producao?.nome || row.motivo || "—")}</td><td>${escapeHtml(row.observacao || "—")}</td></tr>`).join("") : '<tr><td colspan="7" class="empty-state">Sem ocorrências no período.</td></tr>';
  document.querySelector("#stop-details-total").innerHTML = `<tr><th colspan="3">Total</th><th>${formatNumber(stoppedMinutes)}</th><th colspan="3"></th></tr>`;
  renderDonut(sectors); renderTimeline(stops); renderFilters();
}

async function loadDashboard() {
  dashboard.loading.hidden = false; dashboard.message.hidden = true; dashboard.refresh.disabled = true;
  try {
    if (!dashboard.from.value || !dashboard.to.value || dashboard.from.value > dashboard.to.value) throw new Error("Informe um período válido.");
    const { data: area, error: areaError } = await supabaseClient.from("areas_checklist").select("id").eq("codigo", "MOLDAGEM").single();
    if (areaError) throw areaError;
    const [production, stops, turns, scheduledStops] = await Promise.all([
      supabaseClient.from("registros_producao_moldes").select("data_operacional,turno,moldes_vazados,toneladas_produzidas,produtos(codigo,nome)").gte("data_operacional", dashboard.from.value).lte("data_operacional", dashboard.to.value).order("data_operacional").limit(5000),
      supabaseClient.from("paradas_producao_moldes").select("data_operacional,turno,inicio,fim,duracao_minutos,motivo,observacao,categorias_parada_producao(nome),setores_responsaveis_parada(nome)").gte("data_operacional", dashboard.from.value).lte("data_operacional", dashboard.to.value).order("inicio").limit(5000),
      supabaseClient.from("turnos_producao_moldes").select("data_operacional,turno,status").gte("data_operacional", dashboard.from.value).lte("data_operacional", dashboard.to.value).limit(5000),
      supabaseClient.from("paradas_programadas").select("linha_maquina_id,turno,tipo_parada_codigo,horario_inicial,horario_final,dias_semana,vigencia_inicio,vigencia_fim,equipamentos_planejamento(codigo)").eq("area_id", area.id)
    ]);
    if (production.error) throw production.error; if (stops.error) throw stops.error; if (turns.error) throw turns.error; if (scheduledStops.error) throw scheduledStops.error;
    dashboard.data = { records: production.data || [], stops: stops.data || [], turns: turns.data || [], scheduledStops: (scheduledStops.data || []).map(row => ({ ...row, equipamento_codigo: row.equipamentos_planejamento?.codigo ?? null })) };
    dashboard.filters = { date: null, shift: null, product: null, sector: null, reason: null };
    render();
  } catch (error) {
    dashboard.message.textContent = `Não foi possível carregar o dashboard: ${error.message}`; dashboard.message.hidden = false;
  } finally { dashboard.loading.hidden = true; dashboard.refresh.disabled = false; }
}

async function initializeDashboard() {
  const user = await LIDUTEC_APP.requireAuthenticatedUser(); if (!user) return;
  const [profile, permissions] = await Promise.all([LIDUTEC_APP.getCurrentUserProfile(user.id), LIDUTEC_APP.getUserPermissions(user.id)]);
  if (!profile || profile.status !== "ATIVO") { await LIDUTEC_APP.signOut(); return; }
  LIDUTEC_APP.applyPermissionVisibility(permissions);
  document.querySelector("#user-name").textContent = profile.nome;
  document.querySelector("#user-profile").textContent = profile.perfil || "Usuário";
  document.querySelector("#user-avatar").textContent = profile.nome.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();
  document.querySelector("#current-date").textContent = new Intl.DateTimeFormat("pt-BR", { dateStyle: "full" }).format(new Date());
  dashboard.from.value = yesterday(); dashboard.to.value = today(); await loadDashboard();
}

document.addEventListener("click", event => {
  const target = event.target.closest("[data-filter]");
  if (target) {
    const type = target.dataset.filter, value = target.dataset.value;
    dashboard.filters[type] = dashboard.filters[type] === value ? null : value;
    render();
    return;
  }
  const chip = event.target.closest("[data-remove-filter]");
  if (chip) { dashboard.filters[chip.dataset.removeFilter] = null; render(); }
});
dashboard.clearFilters.addEventListener("click", () => { dashboard.filters = { date: null, shift: null, product: null, sector: null, reason: null }; render(); });
dashboard.refresh.addEventListener("click", loadDashboard);
document.querySelector("#menu-button")?.addEventListener("click", () => dashboard.sidebar?.classList.toggle("open"));
document.querySelector("#logout-button")?.addEventListener("click", () => LIDUTEC_APP.signOut());
initializeDashboard().catch(error => { dashboard.loading.textContent = `Erro: ${error.message}`; });
