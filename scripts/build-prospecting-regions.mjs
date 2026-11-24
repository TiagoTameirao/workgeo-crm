import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { polygonIntersectsGeometry } from "../lib/territory-coverage.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.resolve(root, process.argv[2] || "data/prospecting-regions");
const centersPath = path.join(root, "data/prospecting-regions/region-centers.json");
const existingMunicipalitiesPath = path.join(root, "data/prospecting-territory/municipalities.json");
const existingKmlPath = path.join(root, "data/area_170km.original.kml");
const stateCodes = [11,12,13,14,15,16,17,21,22,23,24,25,26,27,28,29,31,32,33,35,41,42,43,50,51,52,53];
const earthRadiusMeters = 6_371_008.8;
const sourceDate = new Date().toISOString().slice(0, 10);
const meshUrl = (state) => `https://servicodados.ibge.gov.br/api/v3/malhas/estados/${state}?formato=application/vnd.geo+json&intrarregiao=municipio&qualidade=minima`;
const localityUrl = (state) => `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${state}/municipios`;

function circleRing(center, radiusKm, vertices = 720) {
  const latitude = center.latitude * Math.PI / 180;
  const longitude = center.longitude * Math.PI / 180;
  const angularDistance = radiusKm * 1000 / earthRadiusMeters;
  const ring = [];
  for (let index = 0; index < vertices; index++) {
    const bearing = 2 * Math.PI * index / vertices;
    const destinationLatitude = Math.asin(
      Math.sin(latitude) * Math.cos(angularDistance) +
      Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(bearing),
    );
    const destinationLongitude = longitude + Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude),
      Math.cos(angularDistance) - Math.sin(latitude) * Math.sin(destinationLatitude),
    );
    ring.push([destinationLongitude * 180 / Math.PI, destinationLatitude * 180 / Math.PI]);
  }
  ring.push([...ring[0]]);
  return ring;
}

function parseKmlPolygon(kml) {
  const coordinates = kml.match(/<coordinates\b[^>]*>([\s\S]*?)<\/coordinates>/i)?.[1];
  if (!coordinates) throw new Error("O KML original não contém coordenadas.");
  const ring = coordinates.trim().split(/\s+/).map((coordinate) => coordinate.split(",").slice(0, 2).map(Number));
  if (ring.length < 4 || ring.some(([longitude, latitude]) => !Number.isFinite(longitude) || !Number.isFinite(latitude)))
    throw new Error("O contorno KML original está incompleto.");
  if (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1]) ring.push([...ring[0]]);
  return { type: "Polygon", coordinates: [ring] };
}

async function getJson(url) {
  const response = await fetch(url, { headers: { accept: "application/geo+json, application/json" } });
  if (!response.ok) throw new Error(`IBGE respondeu HTTP ${response.status} para ${url}`);
  return response.json();
}

const centers = JSON.parse(await readFile(centersPath, "utf8"));
const oldUniverse = JSON.parse(await readFile(existingMunicipalitiesPath, "utf8"));
const oldKml = parseKmlPolygon(await readFile(existingKmlPath, "utf8"));
const lookup = new Map();
for (let start = 0; start < stateCodes.length; start += 3) {
  const batch = stateCodes.slice(start, start + 3);
  const results = await Promise.all(batch.map(async (code) => {
    const [mesh, localities] = await Promise.all([getJson(meshUrl(code)), getJson(localityUrl(code))]);
    if (!Array.isArray(mesh.features) || !Array.isArray(localities)) throw new Error(`Malha municipal incompleta para UF IBGE ${code}.`);
    return { code, mesh, localities };
  }));
  for (const { code, mesh, localities } of results) {
    const names = new Map(localities.map((item) => [String(item.id), item.nome]));
    const state = localities[0]?.microrregiao?.mesorregiao?.UF?.sigla;
    if (!state) throw new Error(`UF não identificada para ${code}.`);
    for (const feature of mesh.features) {
      const ibgeCode = String(feature.properties?.codarea || feature.id || "");
      const municipality = names.get(ibgeCode);
      if (!ibgeCode || !municipality || !feature.geometry) throw new Error(`A malha IBGE ${code} contém município sem código, nome ou geometria.`);
      lookup.set(ibgeCode, { ibge_code: ibgeCode, municipality, uf: state, geometry: feature.geometry });
    }
  }
}

const regions = [];
for (const configured of centers.regions) {
  const circle = { type: "Polygon", coordinates: [circleRing(configured.center, configured.radius_km)] };
  let municipalities;
  let geometry;
  let intersectionSource;
  if (configured.id === "belo-horizonte-170km") {
    municipalities = oldUniverse.municipalities.map(({ ibge_code, municipality, state, evidence }) => ({
      ibge_code: String(ibge_code), municipality, uf: state, evidence: evidence || "Interseção do limite municipal com o KML histórico.",
    }));
    geometry = oldKml;
    intersectionSource = oldUniverse.boundary_source;
  } else {
    const hits = [];
    for (const stateCode of stateCodes) {
      const localityState = [...lookup.values()].find((item) => Number(item.ibge_code.slice(0, 2)) === stateCode)?.uf;
      if (!localityState) throw new Error(`Nenhum município encontrado para UF IBGE ${stateCode}.`);
      for (const municipality of lookup.values()) {
        if (municipality.uf !== localityState) continue;
        if (polygonIntersectsGeometry(circle.coordinates[0], municipality.geometry)) hits.push(municipality);
      }
    }
    municipalities = hits.map(({ ibge_code, municipality, uf }) => ({
      ibge_code, municipality, uf, evidence: `Interseção do limite municipal com o círculo geodésico de ${configured.radius_km} km; não confirma a localização de cada estabelecimento.`,
    }));
    geometry = circle;
    intersectionSource = "API de malhas e API de Localidades do IBGE; consulta em " + sourceDate + ". Produto oficial mais recente revalidado: Malha Municipal 2025.";
  }
  municipalities.sort((a, b) => a.uf.localeCompare(b.uf) || a.municipality.localeCompare(b.municipality, "pt-BR"));
  regions.push({
    ...configured,
    geometry,
    reference_circle_geometry: circle,
    source_date: sourceDate,
    municipality_intersection_source: intersectionSource,
    municipalities_count: municipalities.length,
    municipalities,
  });
}

const result = {
  title: centers.title,
  generated_at: new Date().toISOString(),
  classification: centers.classification,
  distance_method: centers.distance_method,
  boundary_api: "https://servicodados.ibge.gov.br/api/v3/malhas/estados/{codigo-uf}?formato=application/vnd.geo+json&intrarregiao=municipio&qualidade=minima",
  municipality_api: "https://servicodados.ibge.gov.br/api/v1/localidades/estados/{codigo-uf}/municipios",
  boundary_period: "A API de malhas foi consultada na data indicada sem parâmetro de período. O IBGE apresenta 2025 como a edição municipal mais recente publicada na data desta pesquisa; a API não devolveu metadado de edição por município.",
  boundary_resolution: "qualidade=minima; geometria simplificada para triagem territorial, não para demarcação cadastral.",
  source_date: sourceDate,
  limitations: [
    "A interseção municipal é um universo de busca: não prova que cada estabelecimento esteja dentro do círculo.",
    "Os contornos circulares são aproximações geodésicas de 720 segmentos, com erro de corda inferior a 2,4 m para o maior raio.",
    "A API de malhas atual não informou a edição no retorno; a publicação oficial mais recente revalidada é a Malha Municipal 2025.",
    "As coordenadas dos centros são referências de prospecção, não endereços WorkGeo.",
  ],
  regions,
};

await mkdir(outputDirectory, { recursive: true });
await writeFile(path.join(outputDirectory, "regions.json"), JSON.stringify(result, null, 2) + "\n");
const csv = [
  "regiao;raio_km;codigo_ibge;municipio;uf;criterio;fonte_coordenada;data_fonte",
  ...regions.flatMap((region) => region.municipalities.map((item) => [
    region.id, region.radius_km, item.ibge_code, item.municipality, item.uf,
    item.evidence, region.center_source, sourceDate,
  ].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(";"))),
].join("\r\n");
await writeFile(path.join(outputDirectory, "municipalities.csv"), "\uFEFF" + csv + "\r\n");
console.log(JSON.stringify({ generated_at: result.generated_at, regions: regions.map(({ id, municipalities_count }) => ({ id, municipalities_count })), output: outputDirectory }));
