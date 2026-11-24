import { prospectingIndexStatements } from "./prospecting-indexes.mjs";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { AsyncLocalStorage } from "node:async_hooks";
import { Pool } from "pg";
import { createClient } from "@libsql/client";
import { attachDatabasePool } from "@vercel/functions";
import { entityKeys, models } from "./model.mjs";
const context = new AsyncLocalStorage();
let sqlite,
  pool,
  turso,
  queue = Promise.resolve();
export const isTurso = () => process.env.CRM_DATABASE_PROVIDER === "turso";
export const isPostgres = () => !isTurso() && !!process.env.DATABASE_URL;
function tursoClient() {
  if (!turso) {
    const url = process.env.TURSO_DATABASE_URL;
    if (!url || !process.env.TURSO_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN === "[SENSITIVE]")
      throw new Error("Configure a conexão privada do Turso.");
    if ((process.env.VERCEL || process.env.NODE_ENV === "production") && !/^(libsql|https):\/\//.test(url))
      throw new Error("O banco hospedado exige uma conexão remota segura.");
    turso = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  }
  return turso;
}
export function sqliteConnection() {
  if (process.env.VERCEL || process.env.NODE_ENV === "production")
    throw new Error(
      "Configure DATABASE_URL. SQLite é exclusivo do ambiente local.",
    );
  if (!sqlite) {
    const filename =
      process.env.CRM_SQLITE_PATH ||
      path.join(process.cwd(), "runtime", "crm.sqlite");
    mkdirSync(path.dirname(filename), { recursive: true });
    sqlite = new DatabaseSync(filename);
    sqlite.exec(
      "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;",
    );
  }
  return sqlite;
}
function schema() {
  const s = process.env.CRM_DB_SCHEMA || "public";
  if (!/^[a-z][a-z0-9_]*$/.test(s)) throw new Error("CRM_DB_SCHEMA inválido.");
  return s;
}
function pgPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL.replace(
        "sslmode=require",
        "sslmode=verify-full",
      ),
      max: 5,
    });
    if (process.env.VERCEL) attachDatabasePool(pool);
  }
  return pool;
}
const tableNames = [
  "schema_versions",
  "users",
  "sessions",
  "login_attempts",
  ...entityKeys,
  "allocations",
  "audit",
  "settings",
  "files",
  "inbox_events",
  "pilot_feedback",
  "prospecting_candidates",
  "prospecting_candidate_map_regions",
  "prospecting_activities",
  "user_profiles",
  "notifications",
  "flight_authorizations",
  "flight_files",
];
export function qualifySQL(sql, targetSchema=schema()) {
  if(targetSchema==='public')return sql;
  if(!/^[a-z][a-z0-9_]*$/.test(targetSchema))throw new Error('Schema inválido.');
  const pattern=new RegExp('\\b(FROM|JOIN|INTO|UPDATE|REFERENCES|ON|(?:CREATE|ALTER) TABLE(?: IF NOT EXISTS)?)\\s+('+tableNames.join('|')+')\\b','gi');
  return sql.replace(pattern,(_,prefix,table)=>prefix+' '+targetSchema+'.'+table);
}
export async function query(sql, params = []) {
  if (isPostgres())
    return (await (context.getStore() || pgPool()).query(qualifySQL(sql), params))
      .rows;
  const ordered = [];
  const statement = sql.replace(/\$(\d+)/g, (_, n) => {
    ordered.push(params[+n - 1]);
    return "?";
  });
  if (isTurso()) {
    const result = await (context.getStore() || tursoClient()).execute({
      sql: statement,
      args: ordered.map((value) => typeof value === "boolean" ? Number(value) : value),
    });
    return result.rows.map((row) => Object.fromEntries(result.columns.map((column) => [column, row[column]])));
  }
  const s = sqliteConnection().prepare(statement);
  return /^(SELECT|WITH|PRAGMA)|\bRETURNING\b/i.test(sql.trim())
    ? s.all(...ordered)
    : (s.run(...ordered), []);
}
export async function writeBatch(statements) {
  if (!isTurso()) throw new Error("Lotes atômicos estão disponíveis apenas para o banco libSQL/Turso.");
  const normalized = statements.map(({ sql, args = [] }) => ({
    sql: sql.replace(/\$(\d+)/g, (_, n) => `?${n}`),
    args: args.map((value) => typeof value === "boolean" ? Number(value) : value),
  }));
  return tursoClient().batch(normalized, "write");
}
export async function transaction(fn) {
  if (context.getStore()) return fn();
  if (isTurso()) {
    const c = await tursoClient().transaction("write");
    try {
      const result = await context.run(c, fn);
      await c.commit();
      return result;
    } catch (error) {
      if (!c.closed) await c.rollback();
      throw error;
    } finally { c.close(); }
  }
  if (isPostgres()) {
    const c = await pgPool().connect();
    try {
      await c.query("BEGIN");
      const result = await context.run(c, fn);
      await c.query("COMMIT");
      return result;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  const prior = queue;
  let release;
  queue = new Promise((r) => {
    release = r;
  });
  await prior;
  try {
    sqliteConnection().exec("BEGIN IMMEDIATE");
    const result = await context.run(true, fn);
    sqliteConnection().exec("COMMIT");
    return result;
  } catch (e) {
    sqliteConnection().exec("ROLLBACK");
    throw e;
  } finally {
    release();
  }
}
export async function migrate() {
  if (isPostgres() && schema() !== "public")
    await query(`CREATE SCHEMA IF NOT EXISTS ${schema()}`);
  await query(
    "CREATE TABLE IF NOT EXISTS schema_versions (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  if (!isPostgres() && !isTurso() && sqliteConnection().prepare("PRAGMA table_info(services)").all().some((column) => column.name === "contract_id" && column.notnull)) {
    sqliteConnection().exec("PRAGMA foreign_keys=OFF");
    try {
      await transaction(async () => {
        await query("CREATE TABLE services_nullable_contract (id TEXT PRIMARY KEY,data TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,unit_id TEXT NOT NULL REFERENCES units(id),contract_id TEXT REFERENCES contracts(id))");
        await query("INSERT INTO services_nullable_contract SELECT id,data,version,created_at,updated_at,unit_id,contract_id FROM services");
        await query("DROP TABLE services");
        await query("ALTER TABLE services_nullable_contract RENAME TO services");
        if (sqliteConnection().prepare("PRAGMA foreign_key_check").all().length) throw new Error("A migração do serviço não preservou os vínculos.");
      });
    } finally { sqliteConnection().exec("PRAGMA foreign_keys=ON"); }
  }
  if (!isPostgres() && !isTurso() && sqliteConnection().prepare("PRAGMA table_info(activities)").all().some((column) => column.name === "unit_id" && column.notnull)) {
    sqliteConnection().exec("PRAGMA foreign_keys=OFF");
    try {
      await transaction(async () => {
        await query("CREATE TABLE activities_nullable_unit (id TEXT PRIMARY KEY,data TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,unit_id TEXT REFERENCES units(id),opportunity_id TEXT REFERENCES opportunities(id))");
        await query("INSERT INTO activities_nullable_unit SELECT id,data,version,created_at,updated_at,unit_id,opportunity_id FROM activities");
        await query("DROP TABLE activities");
        await query("ALTER TABLE activities_nullable_unit RENAME TO activities");
        if (sqliteConnection().prepare("PRAGMA foreign_key_check").all().length) throw new Error("Falha ao preservar vínculos da agenda.");
      });
    } finally { sqliteConnection().exec("PRAGMA foreign_keys=ON"); }
  }
  await transaction(async () => {
    await query(
      "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,role TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1)",
    );
    await query(
      "CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at TEXT NOT NULL)",
    );
    await query(
      "CREATE TABLE IF NOT EXISTS login_attempts (id TEXT PRIMARY KEY,count INTEGER NOT NULL,reset_at TEXT NOT NULL)",
    );
    for (const entity of [
      "companies",
      "units",
      "contacts",
      "opportunities",
      "proposals",
      "contracts",
      "services",
      "materials",
      "requests",
      "conversations",
      "messages",
      "activities",
      "templates",
      "invoices",
      "receipts",
      "admin_documents",
      "renewals",
    ]) {
      const links = models[entity].fields
        .filter((f) => f.type === "reference")
        .map(
          (f) =>
            `${f.key} TEXT ${f.required ? "NOT NULL" : ""} REFERENCES ${f.entity}(id)`,
        )
        .join(",");
      // Create parent tables first; optional circular links are not used in the model.
      await query(
        `CREATE TABLE IF NOT EXISTS ${entity} (id TEXT PRIMARY KEY,data TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL${links ? "," + links : ""}${entity === "messages" ? ",provider_id TEXT UNIQUE" : ""}${["invoices", "receipts"].includes(entity) ? ",amount_cents BIGINT NOT NULL CHECK(amount_cents>0)" : ""})`,
      );
    }
    await query(
      "CREATE TABLE IF NOT EXISTS allocations (id TEXT PRIMARY KEY,invoice_id TEXT NOT NULL REFERENCES invoices(id),receipt_id TEXT NOT NULL REFERENCES receipts(id),amount_cents BIGINT NOT NULL CHECK(amount_cents>0),created_at TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id))",
    );
    await query(
      "CREATE TABLE IF NOT EXISTS audit (id TEXT PRIMARY KEY,user_id TEXT,entity TEXT NOT NULL,record_id TEXT NOT NULL,action TEXT NOT NULL,before_data TEXT,after_data TEXT,created_at TEXT NOT NULL)",
    );
    await query(
      "CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY,data TEXT NOT NULL)",
    );
    await query(
      "CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY,material_id TEXT NOT NULL REFERENCES materials(id),filename TEXT NOT NULL,content_type TEXT NOT NULL,storage_key TEXT NOT NULL,size_bytes BIGINT NOT NULL,created_at TEXT NOT NULL)",
    );
    await query("CREATE TABLE IF NOT EXISTS record_files (id TEXT PRIMARY KEY,entity TEXT NOT NULL,record_id TEXT NOT NULL,purpose TEXT NOT NULL,filename TEXT NOT NULL,content_type TEXT NOT NULL,storage_key TEXT NOT NULL UNIQUE,size_bytes BIGINT NOT NULL,sha256 TEXT NOT NULL,uploaded_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,generation_id TEXT)");
    await query("CREATE INDEX IF NOT EXISTS record_files_record ON record_files(entity,record_id,purpose,created_at)");
    await query("CREATE TABLE IF NOT EXISTS bulletin_versions (id TEXT PRIMARY KEY,invoice_id TEXT NOT NULL REFERENCES invoices(id),revision INTEGER NOT NULL,data TEXT NOT NULL,created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,UNIQUE(invoice_id,revision))");
    await query("CREATE TABLE IF NOT EXISTS document_analyses (id TEXT PRIMARY KEY,document_id TEXT NOT NULL REFERENCES admin_documents(id),data TEXT NOT NULL,created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL)");
    await query("INSERT INTO schema_versions(version,applied_at) VALUES(17,$1) ON CONFLICT(version) DO NOTHING", [new Date().toISOString()]);
    await query(
      "CREATE TABLE IF NOT EXISTS inbox_events (id TEXT PRIMARY KEY,data TEXT NOT NULL)",
    );
    await query(
      "CREATE TABLE IF NOT EXISTS pilot_feedback (id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),screen TEXT NOT NULL,category TEXT NOT NULL,impact TEXT NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'Novo' CHECK(status IN ('Novo','Em análise','Resolvido')),created_at TEXT NOT NULL,updated_at TEXT NOT NULL)",
    );
    await query(
      "CREATE INDEX IF NOT EXISTS pilot_feedback_queue ON pilot_feedback(status,created_at)",
    );
    await query(
      "CREATE INDEX IF NOT EXISTS messages_conversation ON messages(conversation_id)",
    );
    await query("CREATE TABLE IF NOT EXISTS prospecting_candidates (id TEXT PRIMARY KEY,cnpj TEXT NOT NULL UNIQUE,cnpj_base TEXT NOT NULL,municipality TEXT NOT NULL,scope_tier TEXT NOT NULL,size_label TEXT NOT NULL,review_status TEXT NOT NULL,location_status TEXT NOT NULL,latitude DOUBLE PRECISION,longitude DOUBLE PRECISION,data TEXT NOT NULL,review_note TEXT NOT NULL DEFAULT '',reviewed_by TEXT,reviewed_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)");
    await query("CREATE INDEX IF NOT EXISTS prospecting_candidates_queue ON prospecting_candidates(review_status,location_status,municipality)");
    await query(
      "CREATE UNIQUE INDEX IF NOT EXISTS contracts_opportunity ON contracts(opportunity_id)",
    );
    await query(
      "INSERT INTO schema_versions(version,applied_at) VALUES(1,$1) ON CONFLICT(version) DO NOTHING",
      [new Date().toISOString()],
    );
    if (
      !(await query("SELECT version FROM schema_versions WHERE version=2"))[0]
    ) {
      await query("ALTER TABLE proposals ADD COLUMN revision INTEGER");
      for (const p of await query("SELECT id,data FROM proposals"))
        await query("UPDATE proposals SET revision=$1 WHERE id=$2", [
          JSON.parse(p.data).revision,
          p.id,
        ]);
      await query(
        "CREATE UNIQUE INDEX proposals_version ON proposals(opportunity_id,revision)",
      );
      await query(
        "INSERT INTO schema_versions(version,applied_at) VALUES(2,$1)",
        [new Date().toISOString()],
      );
    }
    if (!(await query("SELECT version FROM schema_versions WHERE version=3"))[0]) {
      const columnExists = isPostgres()
        ? (await query(
            "SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='conversations' AND column_name='opportunity_id'",
            [schema()],
          )).length > 0
        : (await query(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name=$1",
            ["conversations"],
          ))[0]?.sql?.includes("opportunity_id");
      if (!columnExists)
        await query(
          "ALTER TABLE conversations ADD COLUMN opportunity_id TEXT REFERENCES opportunities(id)",
        );
      await query(
        "CREATE INDEX IF NOT EXISTS conversations_opportunity ON conversations(opportunity_id)",
      );
      await query(
        "INSERT INTO schema_versions(version,applied_at) VALUES(3,$1)",
        [new Date().toISOString()],
      );
    }
    await query("INSERT INTO schema_versions(version,applied_at) VALUES(4,$1) ON CONFLICT(version) DO NOTHING", [new Date().toISOString()]);
    if (!(await query("SELECT version FROM schema_versions WHERE version=5"))[0]) {
      const columns = isPostgres()
        ? await query("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='prospecting_candidates'", [schema()])
        : await query("PRAGMA table_info(prospecting_candidates)");
      const names = new Set(columns.map((column) => column.column_name || column.name));
      if (!names.has("converted_unit_id")) await query("ALTER TABLE prospecting_candidates ADD COLUMN converted_unit_id TEXT REFERENCES units(id)");
      if (!names.has("converted_at")) await query("ALTER TABLE prospecting_candidates ADD COLUMN converted_at TEXT");
      if (!names.has("converted_by")) await query("ALTER TABLE prospecting_candidates ADD COLUMN converted_by TEXT");
      await query("CREATE UNIQUE INDEX IF NOT EXISTS prospecting_candidates_converted_unit ON prospecting_candidates(converted_unit_id) WHERE converted_unit_id IS NOT NULL");
      await query("CREATE INDEX IF NOT EXISTS prospecting_candidates_conversion ON prospecting_candidates(review_status,location_status,converted_unit_id)");
      await query("INSERT INTO schema_versions(version,applied_at) VALUES(5,$1)", [new Date().toISOString()]);
    }
    if (!(await query("SELECT version FROM schema_versions WHERE version=6"))[0]) {
      const columns = isPostgres()
        ? await query("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='prospecting_candidates'", [schema()])
        : await query("PRAGMA table_info(prospecting_candidates)");
      const names = new Set(columns.map((column) => column.column_name || column.name));
      for (const [name, type] of [
        ["suggested_latitude", "DOUBLE PRECISION"],
        ["suggested_longitude", "DOUBLE PRECISION"],
        ["geocode_source", "TEXT"],
        ["geocode_date", "TEXT"],
        ["geocode_confidence", "TEXT"],
        ["geocode_match_method", "TEXT"],
        ["geocoded_at", "TEXT"],
      ]) if (!names.has(name)) await query(`ALTER TABLE prospecting_candidates ADD COLUMN ${name} ${type}`);
      await query("CREATE INDEX IF NOT EXISTS prospecting_candidates_geocoded ON prospecting_candidates(location_status,geocoded_at)");
      await query("INSERT INTO schema_versions(version,applied_at) VALUES(6,$1)", [new Date().toISOString()]);
    }
    if (!(await query("SELECT version FROM schema_versions WHERE version=7"))[0]) {
      const columns = isPostgres()
        ? await query("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='prospecting_candidates'", [schema()])
        : await query("PRAGMA table_info(prospecting_candidates)");
      const names = new Set(columns.map((column) => column.column_name || column.name));
      if (!names.has("cnae_primary_in_scope")) await query("ALTER TABLE prospecting_candidates ADD COLUMN cnae_primary_in_scope BOOLEAN NOT NULL DEFAULT FALSE");
      await query("CREATE INDEX IF NOT EXISTS prospecting_candidates_primary_scope ON prospecting_candidates(cnae_primary_in_scope,review_status,size_label,municipality)");
      await query("INSERT INTO schema_versions(version,applied_at) VALUES(7,$1)", [new Date().toISOString()]);
    }
    if (!(await query("SELECT version FROM schema_versions WHERE version=8"))[0]) {
      const columns = isPostgres()
        ? await query("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='prospecting_candidates'", [schema()])
        : await query("PRAGMA table_info(prospecting_candidates)");
      const names = new Set(columns.map((column) => column.column_name || column.name));
      if (!names.has("lead_score")) await query("ALTER TABLE prospecting_candidates ADD COLUMN lead_score INTEGER NOT NULL DEFAULT 0");
      if (!names.has("lead_tier")) await query("ALTER TABLE prospecting_candidates ADD COLUMN lead_tier TEXT NOT NULL DEFAULT 'baixa'");
      if (!names.has("lead_scoring_version")) await query("ALTER TABLE prospecting_candidates ADD COLUMN lead_scoring_version INTEGER NOT NULL DEFAULT 0");
      await query("CREATE INDEX IF NOT EXISTS prospecting_candidates_leads ON prospecting_candidates(lead_tier,lead_score,scope_tier,size_label)");
      await query("INSERT INTO schema_versions(version,applied_at) VALUES(8,$1)", [new Date().toISOString()]);
    }
    if (!(await query("SELECT version FROM schema_versions WHERE version=9"))[0]) {
      const columns = isPostgres()
        ? await query("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='prospecting_candidates'", [schema()])
        : await query("PRAGMA table_info(prospecting_candidates)");
      const names = new Set(columns.map((column) => column.column_name || column.name));
      for (const [name, definition] of [
        ["qualification_status", "TEXT NOT NULL DEFAULT 'Validação pendente'"],
        ["segment_fit", "TEXT NOT NULL DEFAULT 'Não avaliado'"],
        ["operating_size", "TEXT NOT NULL DEFAULT 'Não avaliado'"],
        ["materials_fit", "TEXT NOT NULL DEFAULT 'Não avaliado'"],
      ]) if (!names.has(name)) await query(`ALTER TABLE prospecting_candidates ADD COLUMN ${name} ${definition}`);
      await query("CREATE INDEX IF NOT EXISTS prospecting_candidates_qualification ON prospecting_candidates(qualification_status,lead_tier,municipality)");
      await query("INSERT INTO schema_versions(version,applied_at) VALUES(9,$1)", [new Date().toISOString()]);
    }
    if (!(await query("SELECT version FROM schema_versions WHERE version=10"))[0]) {
      await query("CREATE TABLE IF NOT EXISTS prospecting_activities (id TEXT PRIMARY KEY,candidate_id TEXT NOT NULL REFERENCES prospecting_candidates(id) ON DELETE CASCADE,created_by TEXT NOT NULL REFERENCES users(id),author_name TEXT NOT NULL,channel TEXT NOT NULL,result TEXT NOT NULL,notes TEXT NOT NULL DEFAULT '',next_action TEXT NOT NULL,next_date TEXT NOT NULL,created_at TEXT NOT NULL)");
      await query("CREATE INDEX IF NOT EXISTS prospecting_activities_candidate_recent ON prospecting_activities(candidate_id,created_at DESC)");
      await query("CREATE INDEX IF NOT EXISTS prospecting_activities_followups ON prospecting_activities(next_date,created_by)");
      await query("INSERT INTO schema_versions(version,applied_at) VALUES(10,$1)", [new Date().toISOString()]);
    }
    if (!(await query("SELECT version FROM schema_versions WHERE version=13"))[0]) {
      if (isPostgres()) await query("ALTER TABLE activities ALTER COLUMN unit_id DROP NOT NULL");
      const columns = isPostgres()
        ? await query("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='activities'", [schema()])
        : await query("PRAGMA table_info(activities)");
      if (!columns.some((column) => (column.column_name || column.name) === "service_id")) await query("ALTER TABLE activities ADD COLUMN service_id TEXT REFERENCES services(id)");
      await query("CREATE TABLE IF NOT EXISTS user_profiles (user_id TEXT PRIMARY KEY REFERENCES users(id),data TEXT NOT NULL)");
      await query("CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),activity_id TEXT NOT NULL REFERENCES activities(id),activity_version INTEGER NOT NULL,kind TEXT NOT NULL,due_at TEXT NOT NULL,title TEXT NOT NULL,read_at TEXT,email_status TEXT NOT NULL DEFAULT 'Pendente',attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT,run_id TEXT,created_at TEXT NOT NULL)");
      await query("CREATE INDEX IF NOT EXISTS notifications_recipient ON notifications(user_id,due_at)");
      await query("CREATE INDEX IF NOT EXISTS notifications_pending ON notifications(email_status,due_at)");
      await query("INSERT INTO schema_versions(version,applied_at) VALUES(13,$1)", [new Date().toISOString()]);
      const { migrateOwners } = await import("./agenda-validation.mjs");
      await migrateOwners();
    }
    if (!(await query("SELECT version FROM schema_versions WHERE version=14"))[0]) {
      await query("CREATE TABLE IF NOT EXISTS flight_authorizations (id TEXT PRIMARY KEY,data TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)");
      await query("CREATE TABLE IF NOT EXISTS flight_files (id TEXT PRIMARY KEY,flight_id TEXT NOT NULL REFERENCES flight_authorizations(id),filename TEXT NOT NULL,content_type TEXT NOT NULL,storage_key TEXT NOT NULL,size_bytes BIGINT NOT NULL,kind TEXT NOT NULL,uploaded_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,sha256 TEXT NOT NULL)");
      await query("CREATE INDEX IF NOT EXISTS flight_files_flight ON flight_files(flight_id)");
      for (const [before, after] of Object.entries({ Administrativo: "Administração", "Aprovação comercial": "Administração", Campo: "Piloto de Drone", Técnico: "Geo Processador" })) {
        for (const person of await query("SELECT id FROM users WHERE role=$1", [before])) {
          await query("UPDATE users SET role=$1 WHERE id=$2", [after, person.id]);
          await query("INSERT INTO audit(id,entity,record_id,action,before_data,after_data,created_at) VALUES($1,'users',$2,$3,$4,$5,$6)", [randomUUID(), person.id, "migração de função interna BPMN", JSON.stringify({ role: before }), JSON.stringify({ role: after }), new Date().toISOString()]);
        }
      }
      await query("INSERT INTO schema_versions(version,applied_at) VALUES(14,$1)", [new Date().toISOString()]);
    }
    if (!(await query("SELECT version FROM schema_versions WHERE version=15"))[0]) {
      await query("CREATE TABLE IF NOT EXISTS prospecting_candidate_map_regions (candidate_id TEXT NOT NULL,region_id TEXT NOT NULL,PRIMARY KEY(candidate_id,region_id))");
      await query("CREATE INDEX IF NOT EXISTS prospecting_candidate_map_regions_region ON prospecting_candidate_map_regions(region_id,candidate_id)");
      await query("INSERT INTO schema_versions(version,applied_at) VALUES(15,$1)", [new Date().toISOString()]);
    }
    await query("INSERT INTO schema_versions(version,applied_at) VALUES(11,$1) ON CONFLICT(version) DO NOTHING", [new Date().toISOString()]);
    if (!(await query("SELECT version FROM schema_versions WHERE version=12"))[0]) {
      if (isPostgres()) await query("ALTER TABLE services ALTER COLUMN contract_id DROP NOT NULL");
      await query("INSERT INTO schema_versions(version,applied_at) VALUES(12,$1)", [new Date().toISOString()]);
    }
  });
  if (!isPostgres()) for (const sql of prospectingIndexStatements()) await query(sql);
}
export const unpack = (r) =>
  r
    ? {
        ...JSON.parse(r.data),
        id: r.id,
        version: r.version,
        created_at: r.created_at,
        updated_at: r.updated_at,
      }
    : null;
export async function list(entity) {
  if (!entityKeys.includes(entity)) throw new Error("Cadastro desconhecido.");
  return (await query(`SELECT * FROM ${entity} ORDER BY created_at DESC`)).map(
    unpack,
  );
}
export async function get(entity, id) {
  if (!entityKeys.includes(entity)) throw new Error("Cadastro desconhecido.");
  return unpack((await query(`SELECT * FROM ${entity} WHERE id=$1`, [id]))[0]);
}
export async function insert(entity, data, id) {
  const links = models[entity].fields
    .filter((f) => f.type === "reference")
    .map((f) => f.key);
  const extra =
    entity === "messages"
      ? ["provider_id"]
      : entity === "proposals"
        ? ["revision"]
        : ["invoices", "receipts"].includes(entity)
          ? ["amount_cents"]
          : [];
  const cols = ["id", "data", "created_at", "updated_at", ...links, ...extra];
  const now = new Date().toISOString();
  const vals = [
    id,
    JSON.stringify(data),
    now,
    now,
    ...links.map((k) => data[k] || null),
    ...extra.map((k) => data[k] ?? null),
  ];
  await query(
    `INSERT INTO ${entity} (${cols.join(",")}) VALUES (${cols.map((_, i) => "$" + (i + 1)).join(",")})`,
    vals,
  );
  return get(entity, id);
}
export async function update(entity, id, data, version) {
  const links = models[entity].fields
    .filter((f) => f.type === "reference")
    .map((f) => f.key);
  const extra =
    entity === "messages"
      ? ["provider_id"]
      : entity === "proposals"
        ? ["revision"]
        : ["invoices", "receipts"].includes(entity)
          ? ["amount_cents"]
          : [];
  const vals = [
    JSON.stringify(data),
    new Date().toISOString(),
    ...links.map((k) => data[k] || null),
    ...extra.map((k) => data[k] ?? null),
    id,
    version,
  ];
  const cols = ["data", "updated_at", ...links, ...extra];
  const rows = await query(
    `UPDATE ${entity} SET ${cols.map((k, i) => k + "=$" + (i + 1)).join(",")},version=version+1 WHERE id=$${vals.length - 1} AND version=$${vals.length} RETURNING *`,
    vals,
  );
  if (!rows.length)
    throw Object.assign(
      new Error(
        "Este registro foi alterado. Atualize a página antes de salvar.",
      ),
      { status: 409 },
    );
  return unpack(rows[0]);
}
export async function close() {
  if (turso) {
    turso.close();
    turso = null;
  }
  if (pool) {
    await pool.end();
    pool = null;
  }
  if (sqlite) {
    sqlite.close();
    sqlite = null;
  }
}
