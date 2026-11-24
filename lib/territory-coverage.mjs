const EPSILON = 1e-10;

function onSegment(a, b, point) {
  const cross =
    (point[0] - a[0]) * (b[1] - a[1]) -
    (point[1] - a[1]) * (b[0] - a[0]);
  return (
    Math.abs(cross) <= EPSILON &&
    point[0] >= Math.min(a[0], b[0]) - EPSILON &&
    point[0] <= Math.max(a[0], b[0]) + EPSILON &&
    point[1] >= Math.min(a[1], b[1]) - EPSILON &&
    point[1] <= Math.max(a[1], b[1]) + EPSILON
  );
}

export function pointInRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j];
    const b = ring[i];
    if (onSegment(a, b, point)) return true;
    if (
      (a[1] > point[1]) !== (b[1] > point[1]) &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}

function orientation(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function segmentsIntersect(a, b, c, d) {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  if (Math.abs(abC) <= EPSILON && onSegment(a, b, c)) return true;
  if (Math.abs(abD) <= EPSILON && onSegment(a, b, d)) return true;
  if (Math.abs(cdA) <= EPSILON && onSegment(c, d, a)) return true;
  if (Math.abs(cdB) <= EPSILON && onSegment(c, d, b)) return true;
  return (abC > 0) !== (abD > 0) && (cdA > 0) !== (cdB > 0);
}

export function geometryRings(geometry) {
  if (geometry?.type === "Polygon") return [geometry.coordinates];
  if (geometry?.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

export function pointInGeometry(point, geometry) {
  const shape = geometry?.type === "Feature" ? geometry.geometry : geometry;
  if (!Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) return false;
  return geometryRings(shape).some((rings) => pointInPolygon(point, rings));
}

function pointInPolygon(point, polygonRings) {
  if (!polygonRings.length || !pointInRing(point, polygonRings[0])) return false;
  return !polygonRings.slice(1).some((hole) => pointInRing(point, hole));
}

function bounds(ring) {
  return ring.reduce(
    ([minX, minY, maxX, maxY], [x, y]) => [
      Math.min(minX, x),
      Math.min(minY, y),
      Math.max(maxX, x),
      Math.max(maxY, y),
    ],
    [Infinity, Infinity, -Infinity, -Infinity],
  );
}

function boundsOverlap(a, b) {
  return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
}

export function polygonIntersectsGeometry(polygon, geometry) {
  const territoryBounds = bounds(polygon);
  for (const rings of geometryRings(geometry)) {
    if (!rings?.[0]?.length || !boundsOverlap(territoryBounds, bounds(rings[0])))
      continue;
    if (
      polygon.some((point) => pointInPolygon(point, rings)) ||
      rings[0].some((point) => pointInRing(point, polygon))
    )
      return true;
    const boundaries = [...rings, polygon];
    for (const ring of boundaries) {
      for (let i = 1; i < ring.length; i++) {
        for (let j = 1; j < (ring === polygon ? rings[0] : polygon).length; j++) {
          const other = ring === polygon ? rings[0] : polygon;
          if (segmentsIntersect(ring[i - 1], ring[i], other[j - 1], other[j]))
            return true;
        }
      }
    }
  }
  return false;
}
