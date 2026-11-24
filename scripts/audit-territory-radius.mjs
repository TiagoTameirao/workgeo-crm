import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { distanceMeters, deriveCircleCenter, geodesicCircle } from "../lib/territory-radius.mjs";
import { polygonIntersectsGeometry } from "../lib/territory-coverage.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argumentsByName = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const name = process.argv[index], value = process.argv[index + 1];
  if (!name?.startsWith("--") || value == null) throw new Error("Use pares --opção valor.");
  argumentsByName.set(name, value);
}
const kmlPath = path.resolve(root, argumentsByName.get("--kml") || "data/area_170km.original.kml");
const outputPath = path.resolve(root, argumentsByName.get("--output") || "deliverables/prospecting-cnpj/territory-radius-170km-audit.json");
const radiusKm = Number(argumentsByName.get("--radius-km") || 170);
const explicitLongitude = argumentsByName.has("--center-lon") ? Number(argumentsByName.get("--center-lon")) : null;
const explicitLatitude = argumentsByName.has("--center-lat") ? Number(argumentsByName.get("--center-lat")) : null;
if (!Number.isFinite(radiusKm) || radiusKm <= 0 || (explicitLongitude === null) !== (explicitLatitude === null))
  throw new Error("Informe raio válido e, se necessário, longitude e latitude centrais juntas.");

const kmlText = await readFile(kmlPath, "utf8");
const coordinateText = kmlText.match(/<coordinates\b[^>]*>([\s\S]*?)<\/coordinates>/i)?.[1];
if (!coordinateText) throw new Error("O KML não contém um contorno fechado.");
const polygon = coordinateText.trim().split(/\s+/).map((coordinate) => coordinate.split(",").slice(0, 2).map(Number));
if (polygon.length < 4 || polygon.flat().some((number) => !Number.isFinite(number))) throw new Error("O KML contém coordenadas inválidas.");
if (polygon[0][0] !== polygon.at(-1)[0] || polygon[0][1] !== polygon.at(-1)[1]) polygon.push([...polygon[0]]);
const fitted = deriveCircleCenter(polygon);
const center = explicitLongitude === null ? fitted : { longitude: explicitLongitude, latitude: explicitLatitude, method: "ponto informado explicitamente na linha de comando" };
if (center.longitude < -180 || center.longitude > 180 || center.latitude < -90 || center.latitude > 90) throw new Error("As coordenadas centrais estão fora dos limites geográficos.");
const circle = geodesicCircle(center, radiusKm * 1000);
const kmlRadii = polygon.slice(0, -1).map((point) => distanceMeters([center.longitude, center.latitude], point) / 1000);

const stateCodes = [11, 12, 13, 14, 15, 16, 17, 21, 22, 23, 24, 25, 26, 27, 28, 29, 31, 32, 33, 35, 41, 42, 43, 50, 51, 52, 53];
const meshUrl = (state) => `https://servicodados.ibge.gov.br/api/v3/malhas/estados/${state}?formato=application/vnd.geo+json&intrarregiao=municipio&qualidade=minima`;
const localityUrl = (state) => `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${state}/municipios`;
async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: "application/geo+json, application/json" }, signal: AbortSignal.timeout(45_000) });
  if (!response.ok) throw new Error(`IBGE respondeu ${response.status} para ${url}`);
  return response.json();
}

const kmlMunicipalities = [], circleMunicipalities = [];
for (const state of stateCodes) {
  const mesh = await fetchJson(meshUrl(state));
  if (!Array.isArray(mesh.features)) throw new Error(`Malha municipal incompleta para a UF ${state}.`);
  const matches = mesh.features.filter((feature) => polygonIntersectsGeometry(polygon, feature.geometry) || polygonIntersectsGeometry(circle, feature.geometry));
  if (!matches.length) continue;
  const localities = await fetchJson(localityUrl(state));
  const namesByCode = new Map(localities.map((locality) => [String(locality.id), { name: locality.nome, state: locality.microrregiao?.mesorregiao?.UF?.sigla || "NÃO ENCONTRADO", state_name: locality.microrregiao?.mesorregiao?.UF?.nome || "NÃO ENCONTRADO" }]));
  for (const feature of matches) {
    const code = String(feature.properties?.codarea || feature.id || "");
    const locality = namesByCode.get(code) || { name: "NÃO ENCONTRADO", state: "NÃO ENCONTRADO", state_name: "NÃO ENCONTRADO" };
    const record = { ibge_code: code, municipality: locality.name, state: locality.state, state_code: String(state), state_name: locality.state_name };
    if (polygonIntersectsGeometry(polygon, feature.geometry)) kmlMunicipalities.push(record);
    if (polygonIntersectsGeometry(circle, feature.geometry)) circleMunicipalities.push(record);
  }
}
const sortMunicipalities = (rows) => rows.sort((a, b) => a.municipality.localeCompare(b.municipality, "pt-BR") || a.state.localeCompare(b.state));
sortMunicipalities(kmlMunicipalities); sortMunicipalities(circleMunicipalities);
const circleCodes = new Set(circleMunicipalities.map((row) => row.ibge_code));
const kmlCodes = new Set(kmlMunicipalities.map((row) => row.ibge_code));
const onlyKml = kmlMunicipalities.filter((row) => !circleCodes.has(row.ibge_code));
const onlyCircle = circleMunicipalities.filter((row) => !kmlCodes.has(row.ibge_code));
const content = {
  generated_at: new Date().toISOString(),
  source: { kml: path.relative(root, kmlPath).replaceAll("\\", "/"), kml_sha256: createHash("sha256").update(kmlText).digest("hex"), municipality_boundaries: "IBGE API v3 malhas municipais, qualidade mínima; API consultada nesta execução" },
  circle: { radius_km: radiusKm, center: { longitude: center.longitude, latitude: center.latitude }, center_method: center.method, center_status: explicitLongitude === null ? "PROVISÓRIO: centro ajustado ao contorno KML; confirmar se este é o ponto de referência pretendido em Belo Horizonte" : "Ponto informado explicitamente", polygon_segments: circle.length - 1, max_chord_deviation_m: radiusKm * 1000 * (1 - Math.cos(Math.PI / (circle.length - 1))) },
  kml_radius_from_selected_center_km: { minimum: Math.min(...kmlRadii), maximum: Math.max(...kmlRadii), mean: kmlRadii.reduce((sum, value) => sum + value, 0) / kmlRadii.length },
  municipality_intersection: { kml_count: kmlMunicipalities.length, circle_count: circleMunicipalities.length, only_kml_count: onlyKml.length, only_circle_count: onlyCircle.length, only_kml: onlyKml, only_circle: onlyCircle, kml_municipalities: kmlMunicipalities, circle_municipalities: circleMunicipalities },
  limitations: ["Município que cruza o círculo pode conter endereços fora do raio; a interseção produz um conjunto de candidatos possíveis, não prova localização individual.", "Endereços CNEFE são sugestões de 2022 e precisam de confirmação; resultados fora do círculo não são apagados automaticamente.", "Se o centro pretendido em Belo Horizonte não for o centro ajustado ao KML, gere novamente informando --center-lon e --center-lat.", "Limites municipais vêm da malha simplificada do IBGE e servem para gerar um universo conservador de busca; não substituem coordenada do estabelecimento."]
};
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(content, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ output: path.relative(root, outputPath), center: content.circle.center, radius_range_km: content.kml_radius_from_selected_center_km, kml_municipalities: kmlMunicipalities.length, circle_municipalities: circleMunicipalities.length, only_kml: onlyKml.map(({ ibge_code, municipality }) => ({ ibge_code, municipality })), only_circle: onlyCircle.map(({ ibge_code, municipality }) => ({ ibge_code, municipality })) }));
