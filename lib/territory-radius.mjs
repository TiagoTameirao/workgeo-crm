const EARTH_RADIUS_METERS = 6_371_008.8;
const radians = (degrees) => (degrees * Math.PI) / 180;
const degrees = (radiansValue) => (radiansValue * 180) / Math.PI;

function solveLinearSystem(matrix, vector) {
  const rows = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < rows.length; column++) {
    let pivot = column;
    for (let row = column + 1; row < rows.length; row++)
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    if (Math.abs(rows[pivot][column]) < 1e-12) throw new Error("O contorno não permite estimar um centro circular estável.");
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const divisor = rows[column][column];
    for (let index = column; index <= rows.length; index++) rows[column][index] /= divisor;
    for (let row = 0; row < rows.length; row++) {
      if (row === column) continue;
      const factor = rows[row][column];
      for (let index = column; index <= rows.length; index++) rows[row][index] -= factor * rows[column][index];
    }
  }
  return rows.map((row) => row.at(-1));
}

export function deriveCircleCenter(ring) {
  const closed = ring.length > 1 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1];
  const points = closed ? ring.slice(0, -1) : ring;
  if (points.length < 3 || points.some(([lon, lat]) => !Number.isFinite(lon) || !Number.isFinite(lat)))
    throw new Error("Informe ao menos três coordenadas geográficas válidas.");
  const referenceLatitude = points.reduce((sum, point) => sum + point[1], 0) / points.length;
  const longitudeScale = Math.cos(radians(referenceLatitude));
  const planarPoints = points.map(([lon, lat]) => [lon * longitudeScale, lat]);
  const matrix = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const vector = [0, 0, 0];
  for (const [x, y] of planarPoints) {
    const row = [x, y, 1], right = -(x * x + y * y);
    for (let i = 0; i < 3; i++) {
      vector[i] += row[i] * right;
      for (let j = 0; j < 3; j++) matrix[i][j] += row[i] * row[j];
    }
  }
  const [d, e] = solveLinearSystem(matrix, vector);
  return { longitude: (-d / 2) / longitudeScale, latitude: -e / 2, method: "ajuste circular por mínimos quadrados em projeção equiretangular local" };
}

export function distanceMeters(first, second) {
  const [lon1, lat1] = first.map(radians), [lon2, lat2] = second.map(radians);
  const dLat = lat2 - lat1, dLon = lon2 - lon1;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(a));
}

export function geodesicCircle(center, radiusMeters, segments = 720) {
  if (!Number.isFinite(center?.longitude) || !Number.isFinite(center?.latitude) || !Number.isFinite(radiusMeters) || radiusMeters <= 0 || !Number.isInteger(segments) || segments < 36)
    throw new Error("Centro, raio ou resolução do círculo inválidos.");
  const angularDistance = radiusMeters / EARTH_RADIUS_METERS;
  const latitude1 = radians(center.latitude), longitude1 = radians(center.longitude);
  const ring = [];
  for (let index = 0; index <= segments; index++) {
    const bearing = (2 * Math.PI * index) / segments;
    const latitude2 = Math.asin(Math.sin(latitude1) * Math.cos(angularDistance) + Math.cos(latitude1) * Math.sin(angularDistance) * Math.cos(bearing));
    const longitude2 = longitude1 + Math.atan2(Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude1), Math.cos(angularDistance) - Math.sin(latitude1) * Math.sin(latitude2));
    ring.push([degrees(longitude2), degrees(latitude2)]);
  }
  return ring;
}
