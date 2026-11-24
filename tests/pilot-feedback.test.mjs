import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.DATABASE_URL = "";
process.env.NODE_ENV = "test";
const dir = mkdtempSync(path.join(tmpdir(), "workgeo-feedback-test-"));
process.env.CRM_SQLITE_PATH = path.join(dir, "test.sqlite");
const { migrate, query, close } = await import("../lib/db.mjs");
const { createFeedback, listFeedback, updateFeedbackStatus, validateFeedback } = await import("../lib/pilot-feedback.mjs");
const admin = { id: "admin-feedback", name: "Admin", role: "Administrador" };
const member = { id: "member-feedback", name: "Equipe", role: "Comercial" };

before(async () => {
  await migrate();
  for (const [u, email] of [[admin, "admin-feedback@example.invalid"], [member, "member-feedback@example.invalid"]])
    await query("INSERT INTO users(id,name,email,password_hash,role,active) VALUES($1,$2,$3,'unused',$4,1)", [u.id, u.name, email, u.role]);
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

test("validates relato and rejects unknown screen, category, impact and text sizes", () => {
  const valid = { screen: "units", category: "Erro", impact: "Atrapalha", title: "Não salva contato", description: "Ao tentar salvar o contato, aparece uma falha." };
  assert.equal(validateFeedback(valid).screen, "units");
  for (const override of [{ screen: "customer-data" }, { category: "Urgente" }, { impact: "Crítico" }, { title: "oi" }, { description: "curto" }])
    assert.throws(() => validateFeedback({ ...valid, ...override }));
});

test("reporter creates their own audited report and admin triages it", async () => {
  const created = await createFeedback(member, { screen: "materials", category: "Dificuldade", impact: "Impede meu trabalho", title: "Não encontro o material", description: "A busca não mostra o portfólio que preciso enviar." });
  await assert.rejects(listFeedback(member), (error) => error.status === 403);
  await assert.rejects(updateFeedbackStatus(member, { id: created.id, status: "Resolvido" }), (error) => error.status === 403);
  const rows = await listFeedback(admin);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].reporter, member.name);
  assert.equal(rows[0].status, "Novo");
  await assert.rejects(updateFeedbackStatus(admin, { id: created.id, status: "Apagado" }));
  await assert.rejects(updateFeedbackStatus(admin, { id: "missing", status: "Resolvido" }), (error) => error.status === 404);
  const updated = await updateFeedbackStatus(admin, { id: created.id, status: "Em análise" });
  assert.equal(updated.status, "Em análise");
  assert.equal((await query("SELECT COUNT(*) AS n FROM audit WHERE entity='pilot_feedback'"))[0].n, 2);
});
test('amostra de tempo permanece ligada ao relato e exige classificação válida',async()=>{
 const input={screen:'services',category:'Dificuldade',impact:'Melhoria',title:'Preparação da passagem',description:'Amostra manual de preparação e conferência.',measurement_kind:'Passagem entre equipes',measurement_phase:'Referência',measurement_variant:'Não se aplica',measurement_minutes:'3.5'};
 assert.throws(()=>validateFeedback({...input,measurement_minutes:'-1'}),/tempo/);
 const created=await createFeedback(member,input);
 const row=(await listFeedback(admin)).find(item=>item.id===created.id);
 assert.deepEqual(row.measurement,{kind:'Passagem entre equipes',phase:'Referência',variant:'Não se aplica',minutes:3.5});
});
