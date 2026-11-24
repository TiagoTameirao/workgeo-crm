export function pointInTerritory(lon, lat, ring) {
  if (
    lon === null ||
    lat === null ||
    lon === "" ||
    lat === "" ||
    lon === undefined ||
    lat === undefined
  )
    return "Localização pendente";
  if (
    !Number.isFinite(+lon) ||
    !Number.isFinite(+lat) ||
    +lon < -180 ||
    +lon > 180 ||
    +lat < -90 ||
    +lat > 90
  )
    throw new Error("Coordenadas inválidas.");
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x1, y1] = ring[j],
      [x2, y2] = ring[i];
    const cross = (+lon - x1) * (y2 - y1) - (+lat - y1) * (x2 - x1);
    if (
      Math.abs(cross) < 1e-10 &&
      +lon >= Math.min(x1, x2) - 1e-10 &&
      +lon <= Math.max(x1, x2) + 1e-10 &&
      +lat >= Math.min(y1, y2) - 1e-10 &&
      +lat <= Math.max(y1, y2) + 1e-10
    )
      return "Dentro";
    if (
      y1 > +lat !== y2 > +lat &&
      +lon < ((x2 - x1) * (+lat - y1)) / (y2 - y1) + x1
    )
      inside = !inside;
  }
  return inside ? "Dentro" : "Fora";
}
