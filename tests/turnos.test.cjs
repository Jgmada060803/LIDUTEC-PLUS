const assert = require("node:assert/strict");
const shifts = require("../assets/js/turnos.js");

assert.equal(shifts.determineShift(new Date(2026, 6, 24, 6, 0)).codigo, "MANHA");
assert.equal(shifts.determineShift(new Date(2026, 6, 24, 13, 19)).codigo, "MANHA");
assert.equal(shifts.determineShift(new Date(2026, 6, 24, 13, 20)).codigo, "TARDE");
assert.equal(shifts.determineShift(new Date(2026, 6, 24, 21, 30)).codigo, "NOITE");
assert.equal(
  shifts.determineShift(new Date(2026, 7, 7, 5, 59)).dataOperacional,
  "2026-08-06"
);
assert.equal(
  shifts.determineShift(new Date(2026, 7, 7, 6, 0)).dataOperacional,
  "2026-08-07"
);
assert.equal(
  shifts.determineShift(new Date(2026, 6, 25, 2, 0)).dataOperacional,
  "2026-07-24"
);
assert.equal(
  shifts.stopDurationMinutes("2026-07-24T23:30:00", "2026-07-25T00:15:00"),
  45
);
assert.throws(
  () => shifts.stopDurationMinutes("2026-07-25T01:00:00", "2026-07-24T23:00:00"),
  /negativa/
);
assert.equal(shifts.effectiveMinutes(440, 500), 0);
assert.equal(shifts.effectiveMinutes(490, 70), 420);
assert.equal(shifts.planAttendance(90, 100), 90);
assert.equal(shifts.scrapPercentage(5, 100), 5);
const nightBounds = shifts.shiftBounds("2026-07-24", "NOITE");
assert.equal(nightBounds.start.getDate(), 24);
assert.equal(nightBounds.end.getDate(), 25);
assert.equal(
  shifts.resolveShiftTime("2026-07-24", "NOITE", "23:30").toISOString(),
  new Date("2026-07-24T23:30:00").toISOString()
);
assert.equal(
  shifts.resolveShiftTime("2026-07-24", "NOITE", "00:15").toISOString(),
  new Date("2026-07-25T00:15:00").toISOString()
);
assert.equal(
  shifts.stopDurationMinutes(
    shifts.resolveShiftTime("2026-07-24", "NOITE", "23:30"),
    shifts.resolveShiftTime("2026-07-24", "NOITE", "00:15")
  ),
  45
);
assert.equal(
  new Date(shifts.resolveShiftTime("2026-07-24", "NOITE", "00:15").getTime() - 60000).getMinutes(),
  14
);
assert.equal(shifts.resolveShiftTime("2026-07-24", "NOITE", "06:01"), null);
assert.equal(
  shifts.productionEndTime("2026-08-06", "MANHA", "08:15", "", "2026-08-06T08:15:42"),
  "08:15"
);
assert.equal(
  shifts.productionEndTime("2026-08-06", "MANHA", "08:15", "09:00", "2026-08-06T08:30:00"),
  "08:59"
);
assert.equal(
  shifts.productionEndTime("2026-08-06", "MANHA", "12:00", "", "2026-08-06T15:00:00"),
  "13:20"
);
assert.equal(
  shifts.productionEndTime("2026-08-06", "NOITE", "23:30", "", "2026-08-07T00:15:00"),
  "00:15"
);
assert.equal(
  shifts.productionEndTime("2026-08-06", "TARDE", "15:00", "", "2026-08-06T14:00:00"),
  ""
);
assert.equal(
  shifts.productionEndTime("2026-08-06", "TARDE", "13:20", "16:54", "2026-08-07T08:00:00"),
  "16:53"
);
assert.equal(
  shifts.productionEndTime("2026-08-06", "TARDE", "16:54", "", "2026-08-07T08:00:00"),
  "21:30"
);
assert.equal(shifts.isScheduledShiftDay("2026-08-08", "MANHA"), true);
assert.equal(shifts.isScheduledShiftDay("2026-08-09", "MANHA"), false);
assert.equal(shifts.isScheduledShiftDay("2026-08-08", "TARDE"), false);
assert.equal(shifts.isScheduledShiftDay("2026-08-07", "TARDE"), true);
assert.equal(shifts.isScheduledShiftDay("2026-08-09", "NOITE"), true);
assert.equal(shifts.isScheduledShiftDay("2026-08-08", "NOITE"), false);
const checklistShiftStart = new Date(2026, 7, 7, 6, 0);
const checklistShiftEnd = new Date(2026, 7, 7, 13, 20);
assert.equal(shifts.checklistIntervalStatus(checklistShiftStart, checklistShiftEnd, 30, 0, new Date(2026, 7, 7, 6, 29)), null);
assert.deepEqual(
  shifts.checklistIntervalStatus(checklistShiftStart, checklistShiftEnd, 30, 0, new Date(2026, 7, 7, 7, 15)),
  {due:new Date(2026,7,7,6,30),dueCount:2,completedCount:0,missingCount:2,late:true}
);
assert.deepEqual(
  shifts.checklistIntervalStatus(checklistShiftStart, checklistShiftEnd, 30, 1, new Date(2026, 7, 7, 7, 15)),
  {due:new Date(2026,7,7,7,0),dueCount:2,completedCount:1,missingCount:1,late:false}
);
assert.equal(shifts.checklistIntervalStatus(checklistShiftStart, checklistShiftEnd, 30, 2, new Date(2026, 7, 7, 7, 15)), null);
assert.equal(
  shifts.intervalWithinShift(
    "2026-07-24", "NOITE",
    "2026-07-24T22:00:00", "2026-07-25T05:30:00"
  ),
  true
);
assert.equal(
  shifts.intervalWithinShift(
    "2026-07-24", "MANHA",
    "2026-07-24T05:59:00", "2026-07-24T07:00:00"
  ),
  false
);
assert.deepEqual(
  shifts.productionCalculation(10, 2, 6, 6.82),
  { totalMolds: 12, totalPieces: 60, tons: 0.4092 }
);

// OEE — Acabamento
assert.equal(
  shifts.minutosDisponiveisProducao({ minutosTurno: 440, operadoresPlanejados: 10, operadoresPresentes: 10, minutosParada: 0 }),
  440
);
assert.equal(
  shifts.minutosDisponiveisProducao({ minutosTurno: 440, operadoresPlanejados: 10, operadoresPresentes: 8, minutosParada: 20 }),
  332
);
assert.equal(
  shifts.minutosDisponiveisProducao({ minutosTurno: 440, operadoresPlanejados: 0, operadoresPresentes: 5, minutosParada: 0 }),
  440
);
assert.equal(shifts.calcularDisponibilidade({ minutosTurno: 0, operadoresPlanejados: 10, operadoresPresentes: 10, minutosParada: 0 }), 0);
assert.equal(
  shifts.calcularDisponibilidade({ minutosTurno: 440, operadoresPlanejados: 10, operadoresPresentes: 10, minutosParada: 44 }),
  0.9
);
assert.equal(shifts.calcularTempoTeorico({ pecasLiberadas: 100, pecasRefugadas: 20, tempoCicloSegundos: 30 }), 60);
assert.equal(shifts.calcularTempoTeorico({ pecasLiberadas: 0, pecasRefugadas: 0, tempoCicloSegundos: 30 }), 0);
assert.equal(shifts.calcularEficiencia({ tempoTeoricoMinutos: 60, tempoDisponivelMinutos: 80 }), 0.75);
assert.equal(shifts.calcularEficiencia({ tempoTeoricoMinutos: 60, tempoDisponivelMinutos: 0 }), 0);
assert.equal(shifts.calcularQualidade({ pecasLiberadas: 90, pecasRefugadas: 10 }), 0.9);
assert.equal(shifts.calcularQualidade({ pecasLiberadas: 0, pecasRefugadas: 0 }), 0);
assert.equal(
  Number(shifts.calcularOEE({ disponibilidade: 0.9, eficiencia: 0.75, qualidade: 0.9 }).toFixed(4)),
  0.6075
);
assert.equal(shifts.calcularOEE({ disponibilidade: 0, eficiencia: 0.9, qualidade: 0.9 }), 0);

// Disponibilidade por posto (Acabamento) — numeroPostos=1 deve se comportar
// exatamente como antes (compatibilidade retroativa).
assert.equal(
  shifts.calcularDisponibilidade({ minutosTurno: 440, operadoresPlanejados: 10, operadoresPresentes: 10, minutosParada: 44 }),
  0.9
);
// Linha com 7 postos: 1 posto parado 70 min não derruba a linha inteira —
// a perda é só a fatia desse posto dentro da capacidade total (440*7=3080).
assert.equal(
  shifts.calcularDisponibilidade({ minutosTurno: 440, numeroPostos: 7, operadoresPlanejados: 7, operadoresPresentes: 7, minutosParada: 70 }),
  (3080 - 70) / 3080
);
assert.equal(
  shifts.minutosDisponiveisProducao({ minutosTurno: 440, numeroPostos: 7, operadoresPlanejados: 7, operadoresPresentes: 7, minutosParada: 0 }),
  3080
);
assert.equal(shifts.calcularDisponibilidade({ minutosTurno: 0, numeroPostos: 7, operadoresPlanejados: 7, operadoresPresentes: 7, minutosParada: 0 }), 0);

// Taxa de equipamento avulso
assert.equal(shifts.calcularTaxaEquipamento({ minutosPeriodo: 1000, minutosParada: 100 }), 0.9);
assert.equal(shifts.calcularTaxaEquipamento({ minutosPeriodo: 0, minutosParada: 0 }), 0);
assert.equal(shifts.calcularTaxaEquipamento({ minutosPeriodo: 1000, minutosParada: 0 }), 1);

// Sobreposição de parada real com janela de parada programada (refeição/manutenção)
// Turno MANHA começa 06:00; parada cobre o almoço 11:00-11:30 por inteiro (30min).
assert.equal(
  shifts.minutosParadaProgramadaSobreposta({
    turnoInicio: "2026-07-24T06:00:00", paradaInicio: "2026-07-24T10:50:00", paradaFim: "2026-07-24T11:40:00",
    horarioInicial: "11:00", horarioFinal: "11:30"
  }),
  30
);
// Parada parcialmente dentro da janela: só a fração sobreposta conta.
assert.equal(
  shifts.minutosParadaProgramadaSobreposta({
    turnoInicio: "2026-07-24T06:00:00", paradaInicio: "2026-07-24T11:15:00", paradaFim: "2026-07-24T12:00:00",
    horarioInicial: "11:00", horarioFinal: "11:30"
  }),
  15
);
// Parada totalmente fora da janela: nenhuma sobreposição.
assert.equal(
  shifts.minutosParadaProgramadaSobreposta({
    turnoInicio: "2026-07-24T06:00:00", paradaInicio: "2026-07-24T08:00:00", paradaFim: "2026-07-24T08:30:00",
    horarioInicial: "11:00", horarioFinal: "11:30"
  }),
  0
);
// Janela atravessando a meia-noite (turno NOITE): 23:45 até 00:15 do dia seguinte.
assert.equal(
  shifts.minutosParadaProgramadaSobreposta({
    turnoInicio: "2026-07-24T21:30:00", paradaInicio: "2026-07-24T23:50:00", paradaFim: "2026-07-25T00:10:00",
    horarioInicial: "23:45", horarioFinal: "00:15"
  }),
  20
);

// Colunas de checklist por horário planejado (turno MANHA 06:00-13:20, intervalo 30min).
// Chegou às 06:00; às 07:31 já teria as colunas de 06:30, 07:00 e 07:30.
assert.deepEqual(
  shifts.checklistDueSlots("INTERVALO", "2026-07-24T06:00:00", "2026-07-24T13:20:00", 30, new Date("2026-07-24T07:31:00")).map((d) => d.toISOString()),
  ["2026-07-24T06:30:00", "2026-07-24T07:00:00", "2026-07-24T07:30:00"].map((v) => new Date(v).toISOString())
);
// Antes do primeiro intervalo vencer, nenhuma coluna ainda.
assert.deepEqual(
  shifts.checklistDueSlots("INTERVALO", "2026-07-24T06:00:00", "2026-07-24T13:20:00", 30, new Date("2026-07-24T06:15:00")),
  []
);
// Não passa do fim do turno mesmo se "agora" for mais tarde.
assert.equal(
  shifts.checklistDueSlots("INTERVALO", "2026-07-24T06:00:00", "2026-07-24T13:20:00", 30, new Date("2026-07-24T23:00:00")).length,
  14
);
// Início de turno: sempre 1 coluna só, já disponível assim que o turno começa.
assert.equal(
  shifts.checklistDueSlots("INICIO_TURNO", "2026-07-24T06:00:00", "2026-07-24T13:20:00", null, new Date("2026-07-24T06:00:00")).length,
  1
);
assert.equal(
  shifts.checklistDueSlots("INICIO_TURNO", "2026-07-24T06:00:00", "2026-07-24T13:20:00", null, new Date("2026-07-24T05:59:00")).length,
  0
);

// hourlySlots: buckets de hora cheia (apontamento hora a hora da Macharia),
// diferente de checklistDueSlots que ancora no início do turno.
// Turno MANHA (06:00-13:20): primeiro bucket completo fecha às 07:00; o
// resto (13:00-13:20) não fecha hora cheia, fica de fora.
assert.deepEqual(
  shifts.hourlySlots("2026-07-24T06:00:00", "2026-07-24T13:20:00", new Date("2026-07-24T23:00:00")).map((d) => d.toISOString()),
  ["07:00", "08:00", "09:00", "10:00", "11:00", "12:00", "13:00"].map((h) => new Date(`2026-07-24T${h}:00`).toISOString())
);
// Turno TARDE (13:20-21:30): não começa na hora cheia, primeiro bucket fecha às 14:00.
assert.deepEqual(
  shifts.hourlySlots("2026-07-24T13:20:00", "2026-07-24T21:30:00", new Date("2026-07-24T23:00:00")).map((d) => d.toISOString()),
  ["14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00", "21:00"].map((h) => new Date(`2026-07-24T${h}:00`).toISOString())
);
// Turno NOITE (21:30-06:00 do dia seguinte): cobre a virada de dia, e como o
// turno termina exatamente na hora cheia (06:00), esse último bucket entra.
assert.deepEqual(
  shifts.hourlySlots("2026-07-24T21:30:00", "2026-07-25T06:00:00", new Date("2026-07-25T08:00:00")).map((d) => d.toISOString()),
  [
    "2026-07-24T22:00:00", "2026-07-24T23:00:00",
    "2026-07-25T00:00:00", "2026-07-25T01:00:00", "2026-07-25T02:00:00",
    "2026-07-25T03:00:00", "2026-07-25T04:00:00", "2026-07-25T05:00:00", "2026-07-25T06:00:00"
  ].map((v) => new Date(v).toISOString())
);
// "Agora" no meio do turno: só os buckets já vencidos.
assert.deepEqual(
  shifts.hourlySlots("2026-07-24T06:00:00", "2026-07-24T13:20:00", new Date("2026-07-24T09:15:00")).map((d) => d.toISOString()),
  ["07:00", "08:00", "09:00"].map((h) => new Date(`2026-07-24T${h}:00`).toISOString())
);
// Antes do primeiro bucket fechar, nenhum slot ainda.
assert.deepEqual(
  shifts.hourlySlots("2026-07-24T06:00:00", "2026-07-24T13:20:00", new Date("2026-07-24T06:30:00")),
  []
);

// findOverlappingInterval: usado para bloquear paradas com horário
// sobreposto (Moldagem: turno inteiro; Acabamento: mesmo posto/equipamento).
assert.equal(
  shifts.findOverlappingInterval([
    { inicio: "2026-07-24T06:00:00", fim: "2026-07-24T06:30:00" },
    { inicio: "2026-07-24T07:00:00", fim: "2026-07-24T07:30:00" }
  ]),
  null
);
assert.notEqual(
  shifts.findOverlappingInterval([
    { inicio: "2026-07-24T06:00:00", fim: "2026-07-24T07:00:00" },
    { inicio: "2026-07-24T06:30:00", fim: "2026-07-24T06:45:00" }
  ]),
  null
);
// Paradas encostadas (fim de uma = início da outra) não contam como sobreposição.
assert.equal(
  shifts.findOverlappingInterval([
    { inicio: "2026-07-24T06:00:00", fim: "2026-07-24T06:30:00" },
    { inicio: "2026-07-24T06:30:00", fim: "2026-07-24T07:00:00" }
  ]),
  null
);

console.log("Testes de turnos e indicadores: OK");
