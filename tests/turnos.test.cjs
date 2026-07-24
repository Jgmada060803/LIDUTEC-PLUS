const assert = require("node:assert/strict");
const shifts = require("../assets/js/turnos.js");

assert.equal(shifts.determineShift(new Date(2026, 6, 24, 6, 0)).codigo, "MANHA");
assert.equal(shifts.determineShift(new Date(2026, 6, 24, 13, 19)).codigo, "MANHA");
assert.equal(shifts.determineShift(new Date(2026, 6, 24, 13, 20)).codigo, "TARDE");
assert.equal(shifts.determineShift(new Date(2026, 6, 24, 21, 30)).codigo, "NOITE");
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

console.log("Testes de turnos e indicadores: OK");
