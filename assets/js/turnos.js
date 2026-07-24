(function initializeShiftUtilities(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.LIDUTEC_TURNOS = api;
})(typeof globalThis !== "undefined" ? globalThis : window, () => {
  const shifts = {
    MANHA: { nome: "Manhã", inicio: "06:00", fim: "13:20", minutos: 440 },
    TARDE: { nome: "Tarde", inicio: "13:20", fim: "21:30", minutos: 490 },
    NOITE: { nome: "Noite", inicio: "21:30", fim: "06:00", minutos: 510 }
  };
  const pad = (value) => String(value).padStart(2, "0");
  const localDate = (date) =>
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  function determineShift(value = new Date()) {
    const date = value instanceof Date ? new Date(value) : new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error("Data e hora inválidas.");
    const minute = date.getHours() * 60 + date.getMinutes();
    const code = minute >= 360 && minute < 800
      ? "MANHA" : minute >= 800 && minute < 1290 ? "TARDE" : "NOITE";
    const operational = new Date(date);
    if (code === "NOITE" && minute < 360) {
      operational.setDate(operational.getDate() - 1);
    }
    return {
      codigo: code,
      ...shifts[code],
      dataOperacional: localDate(operational)
    };
  }
  function stopDurationMinutes(startValue, endValue) {
    const start = new Date(startValue);
    let end = new Date(endValue);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new Error("Início e fim da parada são obrigatórios.");
    }
    if (end < start && String(endValue).length <= 5) {
      end = new Date(start);
      const [hours, minutes] = String(endValue).split(":").map(Number);
      end.setDate(end.getDate() + 1);
      end.setHours(hours, minutes, 0, 0);
    }
    const duration = Math.round((end - start) / 60000);
    if (duration < 0) throw new Error("A duração da parada não pode ser negativa.");
    return duration;
  }
  const effectiveMinutes = (scheduled, stops) =>
    Math.max(0, Number(scheduled || 0) - Math.max(0, Number(stops || 0)));
  const percentage = (part, total) =>
    Number(total) > 0 ? Number(((Number(part || 0) / Number(total)) * 100).toFixed(2)) : 0;
  return {
    shifts,
    determineShift,
    stopDurationMinutes,
    effectiveMinutes,
    planAttendance: (actual, planned) => percentage(actual, planned),
    scrapPercentage: (scrap, produced) => percentage(scrap, produced)
  };
});
