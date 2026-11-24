export function addMapBaseLayers(L, map) {
  const streets = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>',
  });
  const satellite = L.tileLayer("https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 19,
    attribution: 'Imagens: <a href="https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer" target="_blank" rel="noreferrer">Esri, Vantor, Earthstar Geographics e GIS User Community</a>',
  }).addTo(map);
  L.control.layers({ "Satélite": satellite, "Mapa": streets }, null, { collapsed: false, position: "topright" }).addTo(map);
}
