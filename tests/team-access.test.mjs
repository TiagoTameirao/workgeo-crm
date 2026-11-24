import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.DATABASE_URL = "";
process.env.NODE_ENV = "test";
const dir = mkdtempSync(path.join(tmpdir(), "workgeo-team-test-"));
process.env.CRM_SQLITE_PATH = path.join(dir, "test.sqlite");
const { migrate, query, close } = await import("../lib/db.mjs");
const { updateUserAccess } = await import("../lib/team.mjs");
const admin = { id: "admin-test", name: "Admin QA", role: "Administrador" };
const member = { id: "member-test", name: "Equipe QA", role: "Comercial" };

before(async () => {
  await migrate();
  await query(
    "INSERT INTO users(id,name,email,password_hash,role,active) VALUES($1,$2,$3,$4,$5,1)",
    [admin.id, admin.name, "admin@example.invalid", "unused", admin.role],
  );
  await query(
    "INSERT INTO users(id,name,email,password_hash,role,active) VALUES($1,$2,$3,$4,$5,1)",
    [member.id, member.name, "member@example.invalid", "unused", member.role],
  );
  await query("INSERT INTO sessions(id,user_id,expires_at) VALUES($1,$2,$3)", [
    "session-test",
    member.id,
    new Date(Date.now() + 60_000).toISOString(),
  ]);
});

after(async () => {
  await close();
  rmSync(dir, { recursive: true, force: true });
});

test("admin altera perfil, suspende sessão e reativa acesso com auditoria", async () => {
  const changed = await updateUserAccess(admin, {
    user_id: member.id,
    role: "Aprovação comercial",
  });
  assert.equal(changed.role, "Administração");

  const suspended = await updateUserAccess(admin, {
    user_id: member.id,
    active: false,
  });
  assert.equal(suspended.active, 0);
  assert.equal((await query("SELECT id FROM sessions WHERE user_id=$1", [member.id])).length, 0);

  const reactivated = await updateUserAccess(admin, {
    user_id: member.id,
    active: true,
  });
  assert.equal(reactivated.active, 1);
  assert.equal(
    (await query("SELECT id FROM audit WHERE entity='users' AND record_id=$1", [member.id])).length,
    3,
  );
});

test("protege administrador, rejeita perfis inválidos e exige permissão", async () => {
  const otherAdmin = {
    id: "other-admin-test",
    name: "Segundo Admin QA",
    role: "Administrador",
  };
  await query(
    "INSERT INTO users(id,name,email,password_hash,role,active) VALUES($1,$2,$3,$4,$5,1)",
    [otherAdmin.id, otherAdmin.name, "other-admin@example.invalid", "unused", otherAdmin.role],
  );
  await assert.rejects(
    updateUserAccess(admin, { user_id: admin.id, active: false }),
    /outro administrador/,
  );
  await assert.rejects(
    updateUserAccess(admin, { user_id: admin.id, role: "Campo" }),
    /outro administrador/,
  );
  await assert.rejects(
    updateUserAccess(member, { user_id: member.id, role: "Comercial" }),
    /outro administrador/,
  );
  await assert.rejects(
    updateUserAccess(admin, { user_id: member.id, role: "Superadmin" }),
    /Perfil de acesso inválido/,
  );
  await assert.rejects(
    updateUserAccess(admin, { user_id: member.id, active: "false" }),
    /Situação de acesso inválida/,
  );
  await updateUserAccess(admin, { user_id: otherAdmin.id, active: false });
  await assert.rejects(
    updateUserAccess(admin, { user_id: admin.id, active: false }),
    /Mantenha ao menos um administrador ativo/,
  );
});
