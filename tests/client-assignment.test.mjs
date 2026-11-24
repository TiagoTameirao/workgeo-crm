import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.DATABASE_URL = "";
process.env.NODE_ENV = "test";
const dir = mkdtempSync(path.join(tmpdir(), "workgeo-client-assignment-"));
process.env.CRM_SQLITE_PATH = path.join(dir, "test.sqlite");
const { migrate, query, get, close } = await import("../lib/db.mjs");
const { seed } = await import("../lib/seed.mjs");
const { createClient } = await import("../lib/clients.mjs");
const { assignUnits } = await import("../lib/client-assignment.mjs");
const admin = { id: "assignment-admin", name: "Admin QA", role: "Administrador" };
const commercial = {
  id: "assignment-commercial",
  name: "Comercial QA",
  role: "Comercial",
};
let units;

before(async () => {
  await migrate();
  await query("INSERT INTO settings(id,data) VALUES($1,$2)", [
    "territory",
    JSON.stringify(seed.territory),
  ]);
  for (const user of [admin, commercial])
    await query(
      "INSERT INTO users(id,name,email,password_hash,role,active) VALUES($1,$2,$3,$4,$5,1)",
      [user.id, user.name, user.id + "@example.invalid", "unused", user.role],
    );
  units = await Promise.all(
    ["Cliente QA 1", "Cliente QA 2"].map((company_name) =>
      createClient(admin, { company_name }),
    ),
  );
});

after(async () => {
  await close();
  rmSync(dir, { recursive: true, force: true });
});

test("atribui clientes em lote e registra auditoria por cadastro", async () => {
  const result = await assignUnits(commercial, {
    unit_ids: units.map((unit) => unit.id),
    owner: "Tiago",
    next_action: "Ligar para confirmar a necessidade",
    next_date: "2026-10-20",
  });
  assert.deepEqual(result, {
    assigned: 2,
    selected: 2,
    owner: "Tiago",
    next_action: "Ligar para confirmar a necessidade",
    next_date: "2026-10-20",
  });
  for (const unit of units) {
    assert.equal((await get("units", unit.id)).owner, "Tiago");
    assert.equal((await get("units", unit.id)).next_action, "Ligar para confirmar a necessidade");
    assert.equal((await get("units", unit.id)).next_date, "2026-10-20");
  }
  assert.equal(
    (await query("SELECT id FROM audit WHERE entity='units' AND action='alteração'")).length,
    2,
  );
});

test("rejeita atribuição não autorizada, destino inválido e seleção inválida", async () => {
  await assert.rejects(
    assignUnits({ ...commercial, role: "Campo" }, {
      unit_ids: [units[0].id],
      owner: "Pedro",
    }),
    /não pode distribuir/,
  );
  await assert.rejects(
    assignUnits(commercial, { unit_ids: [units[0].id], owner: "Desconhecido" }),
    /responsável válido/,
  );
  await assert.rejects(
    assignUnits(commercial, {
      unit_ids: [units[0].id],
      owner: "Tiago",
      next_action: "Ligar",
    }),
    /preencha também a data/,
  );
  await assert.rejects(
    assignUnits(commercial, {
      unit_ids: [units[0].id],
      owner: "Tiago",
      next_action: "Ligar",
      next_date: "data-inválida",
    }),
    /Data inválida/,
  );
  await assert.rejects(assignUnits(commercial, { unit_ids: [], owner: "Tiago" }), /entre 1 e 50/);
  await assert.rejects(
    assignUnits(commercial, { unit_ids: [units[0].id, units[0].id], owner: "Tiago" }),
    /seleção de clientes é inválida/,
  );
});

test("registro ausente desfaz a atribuição em lote inteira", async () => {
  await assert.rejects(
    assignUnits(commercial, {
      unit_ids: [units[0].id, "cliente-inexistente"],
      owner: "Douglas",
      next_action: "Agendar abordagem",
      next_date: "2026-10-22",
    }),
    /não foi encontrado/,
  );
  assert.equal((await get("units", units[0].id)).owner, "Tiago");
  assert.equal((await get("units", units[0].id)).next_action, "Ligar para confirmar a necessidade");
});
