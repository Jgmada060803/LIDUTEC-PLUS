const assert = require("node:assert/strict");

function queryDouble() {
  const calls = [];
  const query = {
    calls,
    from(value) { calls.push(["from", value]); return this; },
    select(value) { calls.push(["select", value]); return this; },
    order(value, options) { calls.push(["order", value, options]); return this; },
    gte(column, value) { calls.push(["gte", column, value]); return this; },
    lte(column, value) { calls.push(["lte", column, value]); return this; },
    eq(column, value) { calls.push(["eq", column, value]); return this; },
    or(value) { calls.push(["or", value]); return this; },
    ilike(column, value) { calls.push(["ilike", column, value]); return this; },
    limit(value) { calls.push(["limit", value]); return this; },
    then(resolve) { return Promise.resolve(resolve({ data: [], error: null })); }
  };
  return query;
}

async function main() {
  const productionQuery = queryDouble();
  global.supabaseClient = productionQuery;
  require("../assets/js/producao-data.js");

  await global.LIDUTEC_PRODUCAO_DATA.records({
    from: "2026-08-01",
    to: "2026-08-31",
    shift: "MANHA",
    productId: 10,
    limit: 999999
  });
  assert.deepEqual(
    productionQuery.calls.filter(([method]) => ["gte", "lte", "eq", "limit"].includes(method)),
    [
      ["gte", "data_operacional", "2026-08-01"],
      ["lte", "data_operacional", "2026-08-31"],
      ["eq", "turno", "MANHA"],
      ["eq", "produto_id", 10],
      ["limit", 5000]
    ]
  );

  productionQuery.calls.length = 0;
  await global.LIDUTEC_PRODUCAO_DATA.calendarEvents("2026-12-01", "2026-12-31", "NOITE");
  assert.deepEqual(
    productionQuery.calls.filter(([method]) => ["eq", "lte", "gte", "or", "limit"].includes(method)),
    [
      ["eq", "ativo", true],
      ["lte", "data_inicio", "2026-12-31"],
      ["gte", "data_fim", "2026-12-01"],
      ["or", "turno.eq.TODOS,turno.eq.NOITE"],
      ["limit", 200]
    ]
  );

  productionQuery.calls.length = 0;
  await global.LIDUTEC_PRODUCAO_DATA.stops({ search: "falha motor", limit: 0 });
  assert.deepEqual(
    productionQuery.calls.filter(([method]) => ["ilike", "limit"].includes(method)),
    [
      ["ilike", "observacao", "%falha%"],
      ["ilike", "observacao", "%motor%"],
      ["limit", 1000]
    ]
  );

  console.log("Testes dos contratos de consulta: OK");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
