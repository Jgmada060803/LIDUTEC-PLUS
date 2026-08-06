const temperatureElements = {
  loading: document.querySelector("#temperature-loading"),
  message: document.querySelector("#temperature-message"),
  item: document.querySelector("#temperature-item"),
  from: document.querySelector("#temperature-from"),
  to: document.querySelector("#temperature-to"),
  last24h: document.querySelector("#temperature-last-24h"),
  refresh: document.querySelector("#temperature-refresh"),
  total: document.querySelector("#temperature-total"),
  conforming: document.querySelector("#temperature-conforming"),
  outside: document.querySelector("#temperature-outside"),
  average: document.querySelector("#temperature-average"),
  chart: document.querySelector("#temperature-chart"),
  chartEmpty: document.querySelector("#temperature-chart-empty"),
  records: document.querySelector("#temperature-records")
};

const temperatureState = {
  records: [],
  itemsLoaded: false,
  rolling24Hours: true
};

function escapeTemperatureHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toLocalInputValue(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function setLast24Hours() {
  const end = new Date();
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
  temperatureElements.from.value = toLocalInputValue(start);
  temperatureElements.to.value = toLocalInputValue(end);
}

function parseFilterDate(input, label) {
  const date = new Date(input.value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Informe uma data válida em ${label}.`);
  }
  return date;
}

function getTemperatureStatus(record) {
  const value = Number(record.temperatura);
  const minimum = record.temperatura_minima;
  const maximum = record.temperatura_maxima;
  if (minimum === null || maximum === null) return "UNSPECIFIED";
  return value >= Number(minimum) && value <= Number(maximum)
    ? "CONFORMING"
    : "OUTSIDE";
}

function isConforming(record) {
  return getTemperatureStatus(record) === "CONFORMING";
}

function formatTemperature(value) {
  if (value === null || value === undefined) return "—";
  return `${Number(value).toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1
  })} °C`;
}

function showTemperatureMessage(text, type = "error") {
  temperatureElements.message.textContent = text;
  temperatureElements.message.className = `form-message ${type}`;
  temperatureElements.message.hidden = !text;
}

function populateItemFilter(records) {
  const current = temperatureElements.item.value;
  const items = [...new Set(records.map((record) => record.item))]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));

  temperatureElements.item.innerHTML = [
    '<option value="">Todos os moldes</option>',
    ...items.map(
      (item) =>
        `<option value="${escapeTemperatureHtml(item)}">${escapeTemperatureHtml(item)}</option>`
    )
  ].join("");

  if (items.includes(current)) {
    temperatureElements.item.value = current;
  }
}

function renderTemperatureSummary(records) {
  const conforming = records.filter(isConforming).length;
  const outside = records.filter(
    (record) => getTemperatureStatus(record) === "OUTSIDE"
  ).length;
  const temperatures = records.map((record) => Number(record.temperatura));
  const average = temperatures.length
    ? temperatures.reduce((total, value) => total + value, 0) /
      temperatures.length
    : null;

  temperatureElements.total.textContent = records.length.toLocaleString("pt-BR");
  temperatureElements.conforming.textContent = conforming.toLocaleString("pt-BR");
  temperatureElements.outside.textContent = outside.toLocaleString("pt-BR");
  temperatureElements.average.textContent = formatTemperature(average);
}

function linePath(records, xFor, yFor, property) {
  const points = records
    .filter((record) => record[property] !== null)
    .map((record) => `${xFor(record)},${yFor(Number(record[property]))}`);
  return points.length ? `M${points.join(" L")}` : "";
}

function renderTemperatureChart(records) {
  const maximumChartPoints = 5000;
  if (records.length > maximumChartPoints) {
    const step = (records.length - 1) / (maximumChartPoints - 1);
    records = Array.from(
      { length: maximumChartPoints },
      (_, index) => records[Math.round(index * step)]
    );
  }
  temperatureElements.chartEmpty.hidden = records.length > 0;
  temperatureElements.chart.hidden = records.length === 0;

  if (!records.length) {
    temperatureElements.chart.replaceChildren();
    return;
  }

  const width = Math.max(900, Math.min(records.length * 18, 12000));
  const height = 430;
  const margin = { top: 22, right: 26, bottom: 58, left: 62 };
  const values = records.flatMap((record) => [
    Number(record.temperatura),
    record.temperatura_minima === null
      ? Number(record.temperatura)
      : Number(record.temperatura_minima),
    record.temperatura_maxima === null
      ? Number(record.temperatura)
      : Number(record.temperatura_maxima)
  ]);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const padding = Math.max(10, (rawMax - rawMin) * 0.12);
  const minY = Math.floor((rawMin - padding) / 10) * 10;
  const maxY = Math.ceil((rawMax + padding) / 10) * 10;
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const timeMin = new Date(records[0].medido_em).getTime();
  const timeMax = new Date(records.at(-1).medido_em).getTime();
  const timeRange = Math.max(1, timeMax - timeMin);
  const xFor = (record) =>
    margin.left +
    ((new Date(record.medido_em).getTime() - timeMin) / timeRange) * plotWidth;
  const yFor = (value) =>
    margin.top + ((maxY - value) / Math.max(1, maxY - minY)) * plotHeight;
  const ticks = 6;
  const grid = Array.from({ length: ticks }, (_, index) => {
    const value = minY + ((maxY - minY) * index) / (ticks - 1);
    const y = yFor(value);
    return `
      <line x1="${margin.left}" y1="${y}" x2="${width - margin.right}"
            y2="${y}" class="temperature-grid-line"/>
      <text x="${margin.left - 10}" y="${y + 4}"
            class="temperature-axis-label" text-anchor="end">${Math.round(value)} °C</text>
    `;
  }).join("");
  const measuredPath = linePath(records, xFor, yFor, "temperatura");
  const minimumPath = linePath(records, xFor, yFor, "temperatura_minima");
  const maximumPath = linePath(records, xFor, yFor, "temperatura_maxima");
  const points = records.map((record) => {
    const status = getTemperatureStatus(record);
    const date = new Date(record.medido_em).toLocaleString("pt-BR");
    const title = `${record.item} · ${date} · Encontrada: ${formatTemperature(
      record.temperatura
    )} · Faixa: ${formatTemperature(
      record.temperatura_minima
    )} a ${formatTemperature(record.temperatura_maxima)}`;
    return `
      <circle cx="${xFor(record)}" cy="${yFor(Number(record.temperatura))}" r="4"
              class="${
                status === "OUTSIDE"
                  ? "temperature-point-outside"
                  : status === "UNSPECIFIED"
                    ? "temperature-point-unspecified"
                    : "temperature-point"
              }">
        <title>${escapeTemperatureHtml(title)}</title>
      </circle>
    `;
  }).join("");
  const startLabel = new Date(records[0].medido_em).toLocaleString("pt-BR");
  const endLabel = new Date(records.at(-1).medido_em).toLocaleString("pt-BR");

  temperatureElements.chart.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"
         aria-hidden="true">
      ${grid}
      <line x1="${margin.left}" y1="${margin.top + plotHeight}"
            x2="${width - margin.right}" y2="${margin.top + plotHeight}"
            class="temperature-axis"/>
      <path d="${minimumPath}" class="temperature-limit-min"/>
      <path d="${maximumPath}" class="temperature-limit-max"/>
      <path d="${measuredPath}" class="temperature-measured-line"/>
      ${points}
      <text x="${margin.left}" y="${height - 18}"
            class="temperature-axis-label">${escapeTemperatureHtml(startLabel)}</text>
      <text x="${width - margin.right}" y="${height - 18}"
            class="temperature-axis-label" text-anchor="end">${escapeTemperatureHtml(endLabel)}</text>
    </svg>
  `;
}

function renderTemperatureRecords(records) {
  temperatureElements.records.innerHTML = records
    .slice()
    .reverse()
    .slice(0, 500)
    .map((record) => {
      const status = getTemperatureStatus(record);
      const statusText =
        status === "CONFORMING"
          ? "Conforme"
          : status === "OUTSIDE"
            ? "Fora da faixa"
            : "Sem especificação";
      const statusClass =
        status === "CONFORMING"
          ? "ativo"
          : status === "OUTSIDE"
            ? "obsoleto"
            : "rascunho";
      return `
        <tr>
          <td>${new Date(record.medido_em).toLocaleString("pt-BR")}</td>
          <td><strong>${escapeTemperatureHtml(record.item)}</strong></td>
          <td>${formatTemperature(record.temperatura)}</td>
          <td>${formatTemperature(record.temperatura_minima)}</td>
          <td>${formatTemperature(record.temperatura_maxima)}</td>
          <td>${record.tempo_vazamento ?? "—"}</td>
          <td><span class="status-badge ${statusClass}">${statusText}</span></td>
        </tr>
      `;
    })
    .join("");
}

function renderTemperatureDashboard() {
  renderTemperatureSummary(temperatureState.records);
  renderTemperatureChart(temperatureState.records);
  renderTemperatureRecords(temperatureState.records);
}

async function loadTemperatureRecords() {
  showTemperatureMessage("");
  temperatureElements.loading.hidden = false;
  temperatureElements.refresh.disabled = true;

  try {
    const from = parseFilterDate(temperatureElements.from, "Início");
    const to = parseFilterDate(temperatureElements.to, "Fim");
    if (from >= to) {
      throw new Error("A data inicial deve ser anterior à data final.");
    }

    let query = window.supabaseClient
      .from("medicoes_temperatura_vazamento")
      .select(
        "id,medido_em,item,temperatura,temperatura_minima,temperatura_maxima,tempo_vazamento"
      )
      .gte("medido_em", from.toISOString())
      .lte("medido_em", to.toISOString())
      .order("medido_em", { ascending: true })
      .limit(5000);

    if (temperatureElements.item.value) {
      query = query.eq("item", temperatureElements.item.value);
    }

    let { data, error } = await query;
    if (error) throw error;

    if (!data?.length && temperatureState.rolling24Hours) {
      const { data: latestRows, error: latestError } =
        await window.supabaseClient
          .from("medicoes_temperatura_vazamento")
          .select("medido_em")
          .order("medido_em", { ascending: false })
          .limit(1);
      if (latestError) throw latestError;

      const latestTimestamp = latestRows?.[0]?.medido_em;
      if (latestTimestamp) {
        const historicalEnd = new Date(latestTimestamp);
        historicalEnd.setMinutes(historicalEnd.getMinutes() + 1);
        const historicalStart = new Date(
          historicalEnd.getTime() - 24 * 60 * 60 * 1000
        );
        temperatureElements.from.value = toLocalInputValue(historicalStart);
        temperatureElements.to.value = toLocalInputValue(historicalEnd);

        let historicalQuery = window.supabaseClient
          .from("medicoes_temperatura_vazamento")
          .select(
            "id,medido_em,item,temperatura,temperatura_minima,temperatura_maxima,tempo_vazamento"
          )
          .gte("medido_em", historicalStart.toISOString())
          .lte("medido_em", historicalEnd.toISOString())
          .order("medido_em", { ascending: true })
          .limit(5000);
        if (temperatureElements.item.value) {
          historicalQuery = historicalQuery.eq(
            "item",
            temperatureElements.item.value
          );
        }

        const historicalResult = await historicalQuery;
        if (historicalResult.error) throw historicalResult.error;
        data = historicalResult.data ?? [];
        temperatureState.rolling24Hours = false;
        showTemperatureMessage(
          "Não há medições nas últimas 24 horas atuais. Exibindo as últimas 24 horas históricas disponíveis.",
          "success"
        );
      }
    }

    temperatureState.records = data ?? [];
    if (!temperatureState.itemsLoaded || !temperatureElements.item.value) {
      populateItemFilter(temperatureState.records);
      temperatureState.itemsLoaded = true;
    }
    renderTemperatureDashboard();
  } catch (error) {
    console.error("Erro ao carregar carta de temperatura:", error);
    showTemperatureMessage(
      `Não foi possível carregar as medições: ${error.message}`
    );
    temperatureState.records = [];
    renderTemperatureDashboard();
  } finally {
    temperatureElements.loading.hidden = true;
    temperatureElements.refresh.disabled = false;
  }
}

async function initializeTemperatureDashboard() {
  const user = await window.LIDUTEC_APP.requireAuthenticatedUser();
  if (!user) return;

  const [profile, permissions] = await Promise.all([
    window.LIDUTEC_APP.getCurrentUserProfile(user.id),
    window.LIDUTEC_APP.getUserPermissions(user.id)
  ]);

  if (!permissions.has("controle_processo.visualizar")) {
    window.location.replace("./lista.html");
    return;
  }

  window.LIDUTEC_APP.applyPermissionVisibility(permissions);
  document.querySelector("#user-name").textContent = profile?.nome ?? user.email;
  document.querySelector("#user-profile").textContent = profile?.perfil ?? "Usuário";
  document.querySelector("#user-avatar").textContent = (
    profile?.nome ?? user.email ?? "U"
  ).slice(0, 1).toUpperCase();

  setLast24Hours();
  await loadTemperatureRecords();
}

temperatureElements.last24h.addEventListener("click", async () => {
  temperatureState.rolling24Hours = true;
  setLast24Hours();
  await loadTemperatureRecords();
});
temperatureElements.refresh.addEventListener("click", loadTemperatureRecords);
temperatureElements.item.addEventListener("change", loadTemperatureRecords);
temperatureElements.from.addEventListener("change", () => {
  temperatureState.rolling24Hours = false;
});
temperatureElements.to.addEventListener("change", () => {
  temperatureState.rolling24Hours = false;
});

initializeTemperatureDashboard().catch((error) => {
  console.error(error);
  temperatureElements.loading.hidden = true;
  showTemperatureMessage(`Falha ao iniciar a carta: ${error.message}`);
});
