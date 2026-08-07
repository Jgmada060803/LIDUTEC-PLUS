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

console.log("Testes de turnos e indicadores: OK");
