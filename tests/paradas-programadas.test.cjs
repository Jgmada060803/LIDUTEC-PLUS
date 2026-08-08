const assert = require("node:assert/strict");
global.LIDUTEC_TURNOS = require("../assets/js/turnos.js");
const paradasProgramadas = require("../assets/js/paradas-programadas.js");

const janelaGeral = {
  linha_maquina_id: null, equipamento_codigo: null, turno: null,
  dias_semana: [1, 2, 3, 4, 5], horario_inicial: "11:00", horario_final: "11:30",
  vigencia_inicio: "2026-01-01", vigencia_fim: null
};

// Parada cobre o almoço por inteiro (turno MANHA, 06:00 início).
assert.deepEqual(
  paradasProgramadas.overlapIntervals({
    janelas: [janelaGeral], turnoInicio: "2026-07-24T06:00:00",
    paradaInicio: "2026-07-24T10:50:00", paradaFim: "2026-07-24T11:40:00",
    turno: "MANHA", dataOperacional: "2026-07-24"
  }).map((i) => [i.start.toISOString(), i.end.toISOString()]),
  [[new Date("2026-07-24T11:00:00").toISOString(), new Date("2026-07-24T11:30:00").toISOString()]]
);
assert.equal(
  paradasProgramadas.overlapMinutos({
    janelas: [janelaGeral], turnoInicio: "2026-07-24T06:00:00",
    paradaInicio: "2026-07-24T10:50:00", paradaFim: "2026-07-24T11:40:00",
    turno: "MANHA", dataOperacional: "2026-07-24"
  }),
  30
);

// Janela de linha específica não se aplica a um equipamento, e vice-versa.
const janelaLinha = { ...janelaGeral, linha_maquina_id: 5 };
assert.equal(
  paradasProgramadas.overlapMinutos({
    janelas: [janelaLinha], turnoInicio: "2026-07-24T06:00:00",
    paradaInicio: "2026-07-24T10:50:00", paradaFim: "2026-07-24T11:40:00",
    turno: "MANHA", dataOperacional: "2026-07-24", equipamentoCodigo: "JATO_1"
  }),
  0
);
assert.equal(
  paradasProgramadas.overlapMinutos({
    janelas: [janelaLinha], turnoInicio: "2026-07-24T06:00:00",
    paradaInicio: "2026-07-24T10:50:00", paradaFim: "2026-07-24T11:40:00",
    turno: "MANHA", dataOperacional: "2026-07-24", linhaId: 5
  }),
  30
);

// Dia da semana fora da janela (sábado=6) não aplica.
assert.equal(
  paradasProgramadas.overlapMinutos({
    janelas: [janelaGeral], turnoInicio: "2026-07-25T06:00:00",
    paradaInicio: "2026-07-25T10:50:00", paradaFim: "2026-07-25T11:40:00",
    turno: "MANHA", dataOperacional: "2026-07-25"
  }),
  0
);

// subtractIntervals: parada de 10:50-11:40 menos o almoço 11:00-11:30 sobra em duas pontas.
const base = { start: new Date("2026-07-24T10:50:00"), end: new Date("2026-07-24T11:40:00") };
const cuts = [{ start: new Date("2026-07-24T11:00:00"), end: new Date("2026-07-24T11:30:00") }];
assert.deepEqual(
  paradasProgramadas.subtractIntervals(base, cuts).map((i) => [i.start.toISOString(), i.end.toISOString()]),
  [
    [new Date("2026-07-24T10:50:00").toISOString(), new Date("2026-07-24T11:00:00").toISOString()],
    [new Date("2026-07-24T11:30:00").toISOString(), new Date("2026-07-24T11:40:00").toISOString()]
  ]
);

console.log("Testes de paradas programadas (compartilhado): OK");
