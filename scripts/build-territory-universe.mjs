import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { polygonIntersectsGeometry } from "../lib/territory-coverage.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const kmlPath = path.resolve(root, process.argv[2] || "data/area_170km.original.kml");
const outputDir = path.resolve(root, process.argv[3] || "data/prospecting-territory");
const stateCodes = [
  11, 12, 13, 14, 15, 16, 17, 21, 22, 23, 24, 25, 26, 27, 28, 29, 31, 32,
  33, 35, 41, 42, 43, 50, 51, 52, 53,
];
const ibgeMesh = (state) =>
  `https://servicodados.ibge.gov.br/api/v3/malhas/estados/${state}?formato=application/vnd.geo+json&intrarregiao=municipio&qualidade=minima`;
const ibgeLocalities = (state) =>
  `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${state}/municipios`;

function parseKmlPolygon(kml) {
  const coordinates = kml.match(/<coordinates\b[^>]*>([\s\S]*?)<\/coordinates>/i)?.[1];
  if (!coordinates) throw new Error("O KML não contém uma lista de coordenadas.");
  const ring = coordinates
    .trim()
    .split(/\s+/)
    .map((coordinate) => coordinate.split(",").slice(0, 2).map(Number));
  if (
    ring.length < 4 ||
    ring.some(([longitude, latitude]) => !Number.isFinite(longitude) || !Number.isFinite(latitude))
  )
    throw new Error("O KML contém um contorno incompleto ou coordenadas inválidas.");
  const first = ring[0];
  const last = ring.at(-1);
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first]);
  return ring;
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: "application/geo+json, application/json" } });
  if (!response.ok) throw new Error(`IBGE respondeu ${response.status} para ${url}`);
  return response.json();
}

const kml = await readFile(kmlPath, "utf8");
const polygon = parseKmlPolygon(kml);
const intersecting = [];
const statesWithIntersection = new Set();

for (const state of stateCodes) {
  const collection = await fetchJson(ibgeMesh(state));
  if (!Array.isArray(collection.features)) throw new Error(`Malha municipal incompleta para a UF ${state}.`);
  const matches = collection.features.filter((feature) =>
    polygonIntersectsGeometry(polygon, feature.geometry),
  );
  if (!matches.length) continue;
  statesWithIntersection.add(state);
  const localities = await fetchJson(ibgeLocalities(state));
  const namesByCode = new Map(localities.map((locality) => [String(locality.id), locality.nome]));
  const stateSigla = localities[0]?.microrregiao?.mesorregiao?.UF?.sigla || "NÃO ENCONTRADO";
  const stateName = localities[0]?.microrregiao?.mesorregiao?.UF?.nome || "NÃO ENCONTRADO";
  for (const feature of matches) {
    const code = String(feature.properties?.codarea || feature.id || "");
    intersecting.push({
      ibge_code: code,
      municipality: namesByCode.get(code) || "NÃO ENCONTRADO",
      state_code: String(state),
      state: stateSigla,
      state_name: stateName,
      intersects_kml: true,
      evidence: "Interseção geométrica do limite municipal com o contorno KML.",
    });
  }
}

intersecting.sort((a, b) =>
  a.municipality.localeCompare(b.municipality, "pt-BR") || a.state_code.localeCompare(b.state_code),
);
const generatedAt = new Date().toISOString();
const result = {
  title: "Municípios que intersectam a área de prospecção WorkGeo",
  classification: "RECORTE GEOGRÁFICO; não é lista de empresas nem confirmação de aderência comercial.",
  generated_at: generatedAt,
  polygon_source: path.relative(root, kmlPath).replaceAll("\\", "/"),
  polygon_vertices_including_closure: polygon.length,
  boundary_source: "Malhas municipais e API de Localidades do IBGE, consultadas em tempo de execução.",
  boundary_api: "https://servicodados.ibge.gov.br/api/v3/malhas/estados/{UF}?formato=application/vnd.geo+json&intrarregiao=municipio&qualidade=minima",
  municipality_api: "https://servicodados.ibge.gov.br/api/v1/localidades/estados/{UF}/municipios",
  inclusion_rule: "Inclui município cujo polígono tenha área ou contato de borda com o polígono KML. Sedes fora do KML podem ser incluídas quando parte do território municipal intersecta a área.",
  limitations: [
    "A malha municipal representa limites administrativos; não valida estrada, tempo de viagem nem acesso operacional.",
    "A interseção indica cobertura territorial, não existência de empresa elegível.",
    "O resultado preserva a geometria do KML; não recalcula um círculo de 170 km.",
  ],
  source_date: generatedAt.slice(0, 10),
  municipalities_count: intersecting.length,
  states_count: statesWithIntersection.size,
  municipalities: intersecting,
};

await mkdir(outputDir, { recursive: true });
await writeFile(path.join(outputDir, "municipalities.json"), JSON.stringify(result, null, 2) + "\n");
const csv = [
  "codigo_ibge;municipio;uf;intersecta_kml;criterio",
  ...intersecting.map((item) =>
    [item.ibge_code, item.municipality, item.state, "sim", item.evidence]
      .map((value) => `"${String(value).replaceAll('"', '""')}"`)
      .join(";"),
  ),
].join("\r\n");
await writeFile(path.join(outputDir, "municipalities.csv"), "\uFEFF" + csv + "\r\n");
console.log(
  `Gerados ${intersecting.length} municípios em ${statesWithIntersection.size} UF(s): ${outputDir}`,
);
