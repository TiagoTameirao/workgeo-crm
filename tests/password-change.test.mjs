import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.DATABASE_URL = "";
process.env.NODE_ENV = "test";
const dir = mkdtempSync(path.join(tmpdir(), "workgeo-password-test-"));
process.env.CRM_SQLITE_PATH = path.join(dir, "test.sqlite");
const { migrate, query, close } = await import("../lib/db.mjs");
const { changePassword, digest, hashPassword, verifyPassword } = await import("../lib/password.mjs");
const userId = "password-test-user";
const limitedUserId = "password-limit-test-user";
const token = "current-session-token";
const limitedToken = "password-limit-session";
const oldPassword = "SenhaAtualSegura123";

before(async () => {
  await migrate();
  await query(
    "INSERT INTO users(id,name,email,password_hash,role,active) VALUES($1,$2,$3,$4,$5,1)",
    [userId, "Usuário QA", "password@example.invalid", hashPassword(oldPassword), "Comercial"],
  );
  for (const sessionToken of [token, "other-session-token"])
    await query("INSERT INTO sessions(id,user_id,expires_at) VALUES($1,$2,$3)", [
      digest(sessionToken),
      userId,
      new Date(Date.now() + 60_000).toISOString(),
    ]);
  await query(
    "INSERT INTO users(id,name,email,password_hash,role,active) VALUES($1,$2,$3,$4,$5,1)",
    [limitedUserId, "Usuário de limite QA", "limited@example.invalid", hashPassword("SenhaLimitadaSegura123"), "Comercial"],
  );
  await query("INSERT INTO sessions(id,user_id,expires_at) VALUES($1,$2,$3)", [
    digest(limitedToken),
    limitedUserId,
    new Date(Date.now() + 60_000).toISOString(),
  ]);
});

after(async () => {
  await close();
  rmSync(dir, { recursive: true, force: true });
});

test("senha atual inválida, senha repetida e senha curta não alteram a conta", async () => {
  await assert.rejects(
    changePassword(userId, token, "senha errada", "NovaSenhaSegura456"),
    /senha atual está incorreta/,
  );
  await assert.rejects(
    changePassword(userId, token, oldPassword, oldPassword),
    /diferente da atual/,
  );
  await assert.rejects(
    changePassword(userId, token, oldPassword, "curta"),
    /12 a 200 caracteres/,
  );
  const saved = (await query("SELECT password_hash FROM users WHERE id=$1", [userId]))[0];
  assert.equal(verifyPassword(oldPassword, saved.password_hash), true);
  assert.equal((await query("SELECT id FROM sessions WHERE user_id=$1", [userId])).length, 2);
});

test("troca a senha, preserva a sessão atual, invalida as demais e não audita o segredo", async () => {
  const newPassword = "NovaSenhaSegura456";
  assert.deepEqual(await changePassword(userId, token, oldPassword, newPassword), { ok: true });
  const saved = (await query("SELECT password_hash FROM users WHERE id=$1", [userId]))[0];
  assert.equal(verifyPassword(oldPassword, saved.password_hash), false);
  assert.equal(verifyPassword(newPassword, saved.password_hash), true);
  const sessions = await query("SELECT id FROM sessions WHERE user_id=$1", [userId]);
  assert.deepEqual(sessions.map((session) => session.id), [digest(token)]);
  const auditRow = (await query("SELECT action,before_data,after_data FROM audit WHERE record_id=$1", [userId]))[0];
  assert.equal(auditRow.action, "senha alterada");
  assert.equal(auditRow.before_data, null);
  assert.equal(auditRow.after_data, null);
});

test("não altera senha por sessão vencida ou ausente", async () => {
  await query("UPDATE sessions SET expires_at=$1 WHERE id=$2", [
    new Date(Date.now() - 60_000).toISOString(),
    digest(token),
  ]);
  await assert.rejects(
    changePassword(userId, token, "NovaSenhaSegura456", "OutraSenhaSegura789"),
    /sessão expirou/,
  );
  await assert.rejects(
    changePassword(userId, "", "NovaSenhaSegura456", "OutraSenhaSegura789"),
    /sessão expirou/,
  );
});

test("limita tentativas de senha atual incorreta", async () => {
  for (let attempt = 0; attempt < 8; attempt++)
    await assert.rejects(
      changePassword(
        limitedUserId,
        limitedToken,
        "senha incorreta",
        "NovaSenhaSegura456",
      ),
      /senha atual está incorreta/,
    );
  await assert.rejects(
    changePassword(
      limitedUserId,
      limitedToken,
      "senha incorreta",
      "NovaSenhaSegura456",
    ),
    /Muitas tentativas. Aguarde 15 minutos/,
  );
});
