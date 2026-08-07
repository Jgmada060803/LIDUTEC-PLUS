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

console.log("Testes de turnos e indicadores: OK");
