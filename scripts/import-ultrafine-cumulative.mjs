import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { close, isTurso, query, writeBatch } from "../lib/db.mjs";
import { readProspectingSnapshot } from "../lib/prospecting-snapshot-csv.mjs";

const directory = path.resolve(process.argv[2] || "deliverables/prospecting-cnpj-2026-10/ultrafine-broad/cumulative-through-100-30-all-units");
const files = [
  ["selected", "leads-ultrafine-cumulative-selected-2026-10.csv"],
  ["pending", "leads-ultrafine-cumulative-pending-2026-10.csv"],
  ["outside", "leads-ultrafine-cumulative-outside-2026-10.csv"],
];
const dryRun = process.argv.includes("--dry-run");
const backupDirectory = path.resolve("backups/ultrafine-integration-2026-11-04");
const backupPath = path.join(backupDirectory, "cumulative-candidates-before-update.enc");
const sourceHash = createHash("sha256");
const rowsByCnpj = new Map();
const seenLinks = new Set();
const systemUser = { id: null, name: "Peneira ultrafina ampla · 2026-10-30", role: "Administrador" };

if (!dryRun && !isTurso()) throw new Error("A integração autorizada exige a conexão Turso de produção.");
if (!dryRun && (!/^[a-f0-9]{64}$/i.test(process.env.BACKUP_KEY || "")) && existsSync(".env.local")) {
  delete process.env.BACKUP_KEY;
  process.loadEnvFile(".env.local");
}
const backupKey = Buffer.from(process.env.BACKUP_KEY || "", "hex");
if (!dryRun && backupKey.length !== 32) throw new Error("BACKUP_KEY precisa estar configurada para a cópia criptografada antes da atualização.");

function coordinateFrom(row) {
  const lat = row.latitude_confirmed || row.latitude_suggested;
  const lon = row.longitude_confirmed || row.longitude_suggested;
  if (!lat || !lon) return null;
  const latitude = Number(lat), longitude = Number(lon);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new Error(`Coordenada inválida para ${row.cnpj}.`);
  return {
    latitude,
    longitude,
    kind: row.latitude_confirmed && row.longitude_confirmed ? "fonte pública vinculada ao local" : "ponto sugerido",
    source: row.coordinate_source || "Peneira ultrafina ampla — ponto para revisão no CRM",
    scope: row.coordinate_scope || "Ponto de referência para conferência; não tratar como perímetro da instalação",
    distance_km: row.distance_km_confirmed || row.distance_km_suggested || null,
  };
}

try {
  let sourceRows = 0;
  for (const [fileStatus, filename] of files) {
    const filePath = path.join(directory, filename);
    const batchHash = createHash("sha256");
    const records = await readProspectingSnapshot(createReadStream(filePath), async (rows) => {
      for (const row of rows) {
        sourceRows++;
        const cnpj = String(row.cnpj || "").replace(/[.\-/]/g, "");
        if (!/^\d{14}$/.test(cnpj)) throw new Error(`CNPJ inválido no arquivo ${filename}: ${row.cnpj}`);
        const regionId = row.research_region_id;
        if (!regionId || !JSON.parse(row.prospecting_region_ids || "[]").includes(regionId)) throw new Error(`Vínculo regional inválido para ${cnpj}.`);
        const link = `${cnpj}:${regionId}`;
        if (seenLinks.has(link)) throw new Error(`Vínculo CNPJ-região repetido: ${link}.`);
        seenLinks.add(link);
        let entry = rowsByCnpj.get(cnpj);
        if (!entry) {
          entry = { cnpj, company_name: row.company_name, regions: new Set(), status_by_region: [], mapPoint: null };
          rowsByCnpj.set(cnpj, entry);
        } else if (entry.company_name !== row.company_name) throw new Error(`Nome divergente entre unidades/recortes para ${cnpj}.`);
        const associations = JSON.parse(row.prospecting_region_ids || "[]");
        for (const id of associations) entry.regions.add(id);
        const status = row.research_status === "selecionada" ? "selected" : row.research_status === "fora_do_perfil" ? "outside" : "pending";
        const point = coordinateFrom(row);
        if (point && (!entry.mapPoint || point.kind === "fonte pública vinculada ao local")) entry.mapPoint = point;
        entry.status_by_region.push({
          region_id: regionId,
          status,
          source_status: row.research_status || fileStatus,
          batch: row.research_batch || "",
          reason: row.status_reason || "",
          operational_evidence: row.operational_evidence || "",
          materials_or_stock: row.materials_or_stock || "",
          size_assessment: row.size_assessment || "",
          public_contact_assessment: row.public_contact_assessment || "",
          public_channel_usable: row.public_channel_usable === "true",
          address_assessment: row.address_assessment || "",
          operational_address_confirmed: row.operational_address_confirmed === "true",
          research_date: row.research_date || "",
          research_notes: row.research_notes || "",
          sources: String(row.research_sources || "").split(" | ").filter(Boolean),
          coordinate: point,
        });
      }
    }, 250, (chunk) => { sourceHash.update(chunk); batchHash.update(chunk); });
    console.log(JSON.stringify({ file: filename, rows: records, sha256: batchHash.digest("hex") }));
  }
  const sha256 = sourceHash.digest("hex");
  if (sourceRows !== 5112 || seenLinks.size !== 5112 || rowsByCnpj.size !== 4948) throw new Error(`Integridade inesperada: ${sourceRows} linhas, ${seenLinks.size} vínculos e ${rowsByCnpj.size} CNPJs únicos.`);
  const statusCounts = { selected: 0, pending: 0, outside: 0 };
  for (const entry of rowsByCnpj.values()) for (const row of entry.status_by_region) statusCounts[row.status]++;
  if (dryRun) {
    console.log(JSON.stringify({ status: "validated", source_rows: sourceRows, unique_candidates: rowsByCnpj.size, unique_region_links: seenLinks.size, status_counts: statusCounts, source_sha256: sha256 }));
  } else {
    const cnpjs = [...rowsByCnpj.keys()];
    const priorRows = [];
    for (let index = 0; index < cnpjs.length; index += 250) {
      const batch = cnpjs.slice(index, index + 250);
      priorRows.push(...await query(`SELECT * FROM prospecting_candidates WHERE cnpj IN (${batch.map((_, i) => `$${i + 1}`).join(",")})`, batch));
    }
    if (priorRows.length !== rowsByCnpj.size) throw new Error(`Somente ${priorRows.length} de ${rowsByCnpj.size} candidatos existem na base; a atualização foi interrompida.`);
    const priorByCnpj = new Map(priorRows.map((row) => [row.cnpj, row]));
    mkdirSync(backupDirectory, { recursive: true });
    let backupComplete = false;
    if (existsSync(backupPath)) {
      const bytes = readFileSync(backupPath);
      if (bytes.subarray(0, 5).toString() !== "WGUF1") throw new Error(`Cópia de segurança existente não reconhecida: ${backupPath}`);
      const decipher = createDecipheriv("aes-256-gcm", backupKey, bytes.subarray(5, 17));
      decipher.setAuthTag(bytes.subarray(17, 33));
      const priorBackup = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(33)), decipher.final()]).toString("utf8"));
      if (priorBackup.source_sha256 !== sha256 || priorBackup.rows?.length !== priorRows.length) throw new Error("A cópia de segurança existente pertence a outra versão ou contagem; nenhum dado foi alterado.");
      backupComplete = true;
    }
    if (!backupComplete) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", backupKey, iv);
      const plaintext = Buffer.from(JSON.stringify({ created_at: new Date().toISOString(), source_sha256: sha256, rows: priorRows }));
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      writeFileSync(backupPath, Buffer.concat([Buffer.from("WGUF1"), iv, cipher.getAuthTag(), ciphertext]), { flag: "wx" });
    }
    const now = new Date().toISOString();
    const updates = [];
    let mapPointsAdded = 0;
    for (const [cnpj, entry] of rowsByCnpj) {
      const prior = priorByCnpj.get(cnpj), oldData = JSON.parse(prior.data);
      const regionIds = [...new Set([...(oldData.prospecting_region_ids || []), ...entry.regions])];
      const tag = {
        status_by_region: entry.status_by_region,
        source: "Peneira ultrafina ampla — todas as unidades pesquisadas/amostradas",
        source_as_of: "2026-10-30",
        source_file: "cumulative-through-100-30-all-units",
      };
      const data = { ...oldData, prospecting_region_ids: regionIds, ultrafine_sieve: tag };
      let suggestedLatitude = prior.suggested_latitude, suggestedLongitude = prior.suggested_longitude;
      let geocodeSource = prior.geocode_source, geocodeDate = prior.geocode_date;
      let geocodeConfidence = prior.geocode_confidence, geocodeMatchMethod = prior.geocode_match_method, geocodedAt = prior.geocoded_at;
      if (prior.latitude == null && prior.longitude == null && suggestedLatitude == null && suggestedLongitude == null && entry.mapPoint) {
        suggestedLatitude = entry.mapPoint.latitude; suggestedLongitude = entry.mapPoint.longitude;
        geocodeSource = `Peneira ultrafina ampla — ${entry.mapPoint.kind}`;
        geocodeDate = "2026-10-30"; geocodeConfidence = "Baixa — aguarda revisão pela equipe no CRM";
        geocodeMatchMethod = "Ponto pesquisado individualmente; revisar evidências da região no cadastro"; geocodedAt = now;
        mapPointsAdded++;
      }
      data.geocode_source = geocodeSource || ""; data.geocode_date = geocodeDate || "";
      data.geocode_confidence = geocodeConfidence || ""; data.geocode_match_method = geocodeMatchMethod || "";
      updates.push({ sql: "UPDATE prospecting_candidates SET data=$1,suggested_latitude=$2,suggested_longitude=$3,geocode_source=$4,geocode_date=$5,geocode_confidence=$6,geocode_match_method=$7,geocoded_at=$8,updated_at=$9 WHERE cnpj=$10", args: [JSON.stringify(data), suggestedLatitude, suggestedLongitude, geocodeSource, geocodeDate, geocodeConfidence, geocodeMatchMethod, geocodedAt, now, cnpj] });
    }
    for (let index = 0; index < updates.length; index += 250) {
      await writeBatch(updates.slice(index, index + 250));
      if ((index + 250) % 1000 === 0 || index + 250 >= updates.length) console.log(JSON.stringify({ updated: Math.min(index + 250, updates.length), total: updates.length }));
    }
    const summary = { unique_candidates: rowsByCnpj.size, region_links: seenLinks.size, status_counts: statusCounts, map_points_added_from_research: mapPointsAdded, source_sha256: sha256, backup: backupPath, imported_at: now };
    await writeBatch([{ sql: "INSERT INTO audit(id,entity,record_id,action,before_data,after_data,created_at) VALUES($1,'prospecting_candidates','ultrafine-cumulative-2026-10','import_ultrafine_cumulative',NULL,$2,$3)", args: [randomUUID(), JSON.stringify(summary), now] }]);
    console.log(JSON.stringify({ status: "complete", ...summary }));
  }
} finally {
  await close();
}
