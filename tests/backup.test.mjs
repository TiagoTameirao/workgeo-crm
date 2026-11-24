import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
process.env.DATABASE_URL = "";
process.env.NODE_ENV = "test";
process.env.BACKUP_KEY = randomBytes(32).toString("hex");
const root = mkdtempSync(path.join(tmpdir(), "wg-restore-"));
process.env.CRM_SQLITE_PATH = path.join(root, "restore.sqlite");
test("backup criptografado restaura uma base vazia e recusa sobrescrever dados", async () => {
  const { migrate, query, close } = await import("../lib/db.mjs");
  const { seedDatabase } = await import("../lib/seed.mjs");
  const { snapshot, encryptBackup, decryptBackup, restoreSnapshot } =
    await import("../lib/backup.mjs");
  try {
    await migrate();
    await seedDatabase();
    await query("INSERT INTO users(id,name,email,password_hash,role) VALUES('backup-user','Backup QA','backup@example.invalid','unused','Administrador')");
    const { saveRecord } = await import("../lib/domain.mjs");
    await saveRecord({ id: "backup-user", name: "Backup QA", role: "Administrador" }, "activities", { name: "Tarefa para restaurar", owner_id: "backup-user", participant_ids: [], category: "Tarefa geral", area: "Escritório" });
    await query("INSERT INTO user_profiles(user_id,data) VALUES('backup-user',$1)", [JSON.stringify({ phone: "31999990000", department: "Escritório" })]);
    const data = await snapshot();
    const encrypted = encryptBackup(data);
    assert.ok(!encrypted.includes(Buffer.from("Siderbom")));
    assert.deepEqual(
      decryptBackup(encrypted),
      JSON.parse(JSON.stringify(data)),
    );
    await assert.rejects(restoreSnapshot(data), /base vazia/);
    const broken = Buffer.from(encrypted);
    broken[broken.length - 1] ^= 1;
    assert.throws(() => decryptBackup(broken));
    await close();
    process.env.CRM_SQLITE_PATH = path.join(root, "new.sqlite");
    await migrate();
    await restoreSnapshot(data);
    assert.equal((await query("SELECT COUNT(*) AS n FROM units"))[0].n, 27);
    assert.equal((await query("SELECT COUNT(*) AS n FROM notifications"))[0].n, 1);
    assert.equal(JSON.parse((await query("SELECT data FROM user_profiles"))[0].data).department, "Escritório");
  } finally {
    await close();
    rmSync(root, { recursive: true, force: true });
  }
});
