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
  function shiftBounds(operationalDate, shiftCode) {
    const shift = shifts[shiftCode];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(operationalDate)) || !shift) {
      throw new Error("Data operacional ou turno inválido.");
    }
    const start = new Date(`${operationalDate}T${shift.inicio}`);
    const end = new Date(`${operationalDate}T${shift.fim}`);
    if (end <= start) end.setDate(end.getDate() + 1);
    return { start, end };
  }
  function resolveShiftTime(operationalDate, shiftCode, timeValue) {
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(timeValue || ""))) return null;
    const bounds = shiftBounds(operationalDate, shiftCode);
    const [hours, minutes] = timeValue.split(":").map(Number);
    const date = new Date(bounds.start);
    date.setHours(hours, minutes, 0, 0);
    if (date < bounds.start) date.setDate(date.getDate() + 1);
    return date >= bounds.start && date <= bounds.end ? date : null;
  }
  function productionEndTime(operationalDate, shiftCode, startValue, nextStartValue, nowValue = new Date()) {
    const bounds = shiftBounds(operationalDate, shiftCode);
    const start = resolveShiftTime(operationalDate, shiftCode, startValue);
    if (!start) return "";
    const nextStart = nextStartValue
      ? resolveShiftTime(operationalDate, shiftCode, nextStartValue)
      : null;
    const now = nowValue instanceof Date ? new Date(nowValue) : new Date(nowValue);
    if (Number.isNaN(now.getTime())) return "";
    let end = nextStart
      ? new Date(nextStart.getTime() - 60000)
      : new Date(Math.min(now.getTime(), bounds.end.getTime()));
    end.setSeconds(0, 0);
    if (end < start || end < bounds.start || end > bounds.end) return "";
    return `${pad(end.getHours())}:${pad(end.getMinutes())}`;
  }
  function intervalWithinShift(operationalDate, shiftCode, startValue, endValue) {
    const bounds = shiftBounds(operationalDate, shiftCode);
    const start = new Date(startValue);
    const end = new Date(endValue);
    return !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) &&
      start >= bounds.start && end <= bounds.end && end >= start;
  }

  // Acha o primeiro par de paradas com horário sobreposto num mesmo grupo —
  // na Moldagem o grupo é o turno inteiro (uma parada trava tudo); no
  // Acabamento o grupo é o posto/equipamento (paradas em postos diferentes
  // podem coexistir no mesmo horário).
  function findOverlappingInterval(intervals) {
    const sorted = intervals
      .map((interval, index) => ({ index, start: new Date(interval.inicio).getTime(), end: new Date(interval.fim).getTime() }))
      .sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].start < sorted[i - 1].end) return [intervals[sorted[i - 1].index], intervals[sorted[i].index]];
    }
    return null;
  }
  function isScheduledShiftDay(operationalDate, shiftCode) {
    const date = new Date(`${operationalDate}T12:00:00`);
    if (Number.isNaN(date.getTime()) || !shifts[shiftCode]) return false;
    const day = date.getDay();
    if (shiftCode === "MANHA") return day >= 1 && day <= 6;
    if (shiftCode === "TARDE") return day >= 1 && day <= 5;
    return day >= 0 && day <= 5;
  }
  function checklistIntervalStatus(startValue, endValue, intervalMinutes, completedCount, nowValue = new Date()) {
    const start = new Date(startValue), end = new Date(endValue), now = new Date(nowValue), interval = Number(intervalMinutes);
    if ([start,end,now].some(value => Number.isNaN(value.getTime())) || interval <= 0) return null;
    const elapsedMinutes = Math.max(0, Math.min(now.getTime(), end.getTime()) - start.getTime()) / 60000;
    const dueCount = Math.floor(elapsedMinutes / interval);
    const completed = Math.max(0, Math.floor(Number(completedCount) || 0));
    const missingCount = Math.max(0, dueCount - completed);
    if (!missingCount) return null;
    const due = new Date(start.getTime() + (completed + 1) * interval * 60000);
    return { due, dueCount, completedCount: completed, missingCount, late: missingCount > 1 };
  }
  // Lista os horários planejados (colunas) de um checklist que se repete
  // dentro do turno, até "agora" (ou até o fim do turno, o que vier antes).
  // INICIO_TURNO tem sempre 1 coluna, no início do turno; INTERVALO tem uma
  // coluna a cada N minutos a partir do início (a primeira já é início+N, não
  // início — o check de início de turno é um modelo separado).
  function checklistDueSlots(frequenciaTipo, startValue, endValue, intervalMinutes, nowValue = new Date()) {
    const start = new Date(startValue), end = new Date(endValue), now = new Date(nowValue);
    if ([start, end, now].some((value) => Number.isNaN(value.getTime()))) return [];
    if (frequenciaTipo === "INICIO_TURNO") return start.getTime() <= Math.min(now.getTime(), end.getTime()) ? [new Date(start)] : [];
    if (frequenciaTipo !== "INTERVALO") return [];
    const interval = Number(intervalMinutes);
    if (!(interval > 0)) return [];
    const cap = Math.min(now.getTime(), end.getTime());
    const slots = [];
    for (let time = start.getTime() + interval * 60000; time <= cap; time += interval * 60000) {
      slots.push(new Date(time));
    }
    return slots;
  }
  function productionCalculation(moldesVazados, moldesQuebrados, pecasPorMolde, pesoPecaKg) {
    const poured = Math.max(0, Number(moldesVazados || 0));
    const broken = Math.max(0, Number(moldesQuebrados || 0));
    const cavities = Math.max(0, Number(pecasPorMolde || 0));
    const weight = Math.max(0, Number(pesoPecaKg || 0));
    const totalPieces = poured * cavities;
    return {
      totalMolds: poured + broken,
      totalPieces,
      tons: Number((totalPieces * weight / 1000).toFixed(6))
    };
  }
  const effectiveMinutes = (scheduled, stops) =>
    Math.max(0, Number(scheduled || 0) - Math.max(0, Number(stops || 0)));
  const percentage = (part, total) =>
    Number(total) > 0 ? Number(((Number(part || 0) / Number(total)) * 100).toFixed(2)) : 0;

  function minutosDisponiveisProducao({ minutosTurno, numeroPostos, operadoresPlanejados, operadoresPresentes, minutosParada }) {
    const turno = Math.max(0, Number(minutosTurno) || 0);
    const postos = Math.max(1, Number(numeroPostos) || 1);
    const capacidadeTotal = turno * postos;
    const planejados = Math.max(0, Number(operadoresPlanejados) || 0);
    const presentes = Math.max(0, Number(operadoresPresentes) || 0);
    const paradas = Math.max(0, Number(minutosParada) || 0);
    const faltaProporcional = planejados > 0 ? Math.max(0, 1 - presentes / planejados) : 0;
    const perdaAbsenteismo = capacidadeTotal * faltaProporcional;
    return Math.max(0, capacidadeTotal - perdaAbsenteismo - paradas);
  }

  // numeroPostos > 1 modela uma linha com várias estações independentes (ex.: os
  // postos do Acabamento): a parada de um posto não derruba a linha inteira, só
  // reduz a fatia de capacidade daquele posto dentro do total (turno × postos).
  // Com numeroPostos=1 (padrão) o comportamento é idêntico ao de uma linha única.
  function calcularDisponibilidade({ minutosTurno, numeroPostos, operadoresPlanejados, operadoresPresentes, minutosParada }) {
    const turno = Math.max(0, Number(minutosTurno) || 0);
    const postos = Math.max(1, Number(numeroPostos) || 1);
    const capacidadeTotal = turno * postos;
    if (capacidadeTotal <= 0) return 0;
    const disponivel = minutosDisponiveisProducao({ minutosTurno, numeroPostos, operadoresPlanejados, operadoresPresentes, minutosParada });
    return disponivel / capacidadeTotal;
  }

  // Ancora horarioInicial/horarioFinal ("HH:MM") a partir de turnoInicio (o
  // início do turno), devolvendo o intervalo absoluto da janela — com suporte
  // a janelas que atravessam a meia-noite (fim menor ou igual ao início).
  function paradaProgramadaJanelaBounds(turnoInicio, horarioInicial, horarioFinal) {
    const inicioTurno = new Date(turnoInicio);
    const anchor = (hhmm) => {
      const [hours, minutes] = String(hhmm).split(":").map(Number);
      const date = new Date(inicioTurno);
      date.setHours(hours, minutes, 0, 0);
      if (date < inicioTurno) date.setDate(date.getDate() + 1);
      return date;
    };
    const start = anchor(horarioInicial);
    let end = anchor(horarioFinal);
    if (end <= start) end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
    return { start, end };
  }

  // Minutos de uma parada real que caem dentro de uma janela de parada
  // programada (refeição, hidratação, manutenção preventiva etc.) — usado para
  // não descontar da disponibilidade um tempo que já era esperado/planejado.
  function minutosParadaProgramadaSobreposta({ turnoInicio, paradaInicio, paradaFim, horarioInicial, horarioFinal }) {
    const { start: janelaInicio, end: janelaFim } = paradaProgramadaJanelaBounds(turnoInicio, horarioInicial, horarioFinal);
    const paradaInicioMs = new Date(paradaInicio).getTime();
    const paradaFimMs = new Date(paradaFim).getTime();
    const overlapStart = Math.max(paradaInicioMs, janelaInicio.getTime());
    const overlapEnd = Math.min(paradaFimMs, janelaFim.getTime());
    return Math.max(0, Math.round((overlapEnd - overlapStart) / 60000));
  }

  // Taxa de utilização independente para equipamentos avulsos (não ligados a uma
  // linha/posto e que não entram na disponibilidade da linha).
  function calcularTaxaEquipamento({ minutosPeriodo, minutosParada }) {
    const periodo = Math.max(0, Number(minutosPeriodo) || 0);
    if (periodo <= 0) return 0;
    const parada = Math.max(0, Number(minutosParada) || 0);
    return Math.max(0, (periodo - parada) / periodo);
  }

  function calcularTempoTeorico({ pecasLiberadas, pecasRefugadas, tempoCicloSegundos }) {
    const pecas = Math.max(0, Number(pecasLiberadas) || 0) + Math.max(0, Number(pecasRefugadas) || 0);
    const cicloMinutos = Math.max(0, Number(tempoCicloSegundos) || 0) / 60;
    return pecas * cicloMinutos;
  }

  function calcularEficiencia({ tempoTeoricoMinutos, tempoDisponivelMinutos }) {
    const disponivel = Math.max(0, Number(tempoDisponivelMinutos) || 0);
    if (disponivel <= 0) return 0;
    const teorico = Math.max(0, Number(tempoTeoricoMinutos) || 0);
    return teorico / disponivel;
  }

  function calcularQualidade({ pecasLiberadas, pecasRefugadas }) {
    const liberadas = Math.max(0, Number(pecasLiberadas) || 0);
    const refugadas = Math.max(0, Number(pecasRefugadas) || 0);
    const total = liberadas + refugadas;
    return total > 0 ? liberadas / total : 0;
  }

  function calcularOEE({ disponibilidade, eficiencia, qualidade }) {
    return Math.max(0, Number(disponibilidade) || 0) *
      Math.max(0, Number(eficiencia) || 0) *
      Math.max(0, Number(qualidade) || 0);
  }

  return {
    shifts,
    determineShift,
    shiftBounds,
    resolveShiftTime,
    productionEndTime,
    intervalWithinShift,
    findOverlappingInterval,
    isScheduledShiftDay,
    checklistIntervalStatus,
    checklistDueSlots,
    productionCalculation,
    stopDurationMinutes,
    effectiveMinutes,
    planAttendance: (actual, planned) => percentage(actual, planned),
    scrapPercentage: (scrap, produced) => percentage(scrap, produced),
    minutosDisponiveisProducao,
    calcularDisponibilidade,
    calcularTempoTeorico,
    calcularEficiencia,
    calcularQualidade,
    calcularOEE,
    calcularTaxaEquipamento,
    minutosParadaProgramadaSobreposta,
    paradaProgramadaJanelaBounds
  };
});
