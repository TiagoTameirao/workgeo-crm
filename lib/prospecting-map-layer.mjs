export function groupVisibleMapPoints(points, project, contains, cellSize = 48) {
  const groups = new Map();
  for (const point of points) {
    if (!contains(point)) continue;
    const pixel = project(point);
    const key = `${Math.floor(pixel.x / cellSize)}:${Math.floor(pixel.y / cellSize)}`;
    const group = groups.get(key);
    if (group) { group.members.push(point); group.count++; group.latitude += point.latitude; group.longitude += point.longitude; }
    else groups.set(key, { point, members: [point], count: 1, latitude: point.latitude, longitude: point.longitude });
  }
  return [...groups.values()].map((group) => ({ ...group, latitude: group.latitude / group.count, longitude: group.longitude / group.count }));
}

export function createProspectingLayer(L, map, onSelect) {
  const layer = L.layerGroup().addTo(map);
  const renderer = L.canvas({ padding: 0.2 });
  let points = [], disposed = false;
  function render() {
    if (disposed) return;
    layer.clearLayers();
    const bounds = map.getBounds().pad(0.1);
    const groups = groupVisibleMapPoints(points,
      (point) => map.project([point.latitude, point.longitude]),
      (point) => bounds.contains([point.latitude, point.longitude]), map.getZoom() >= 16 ? 1 : 48);
    for (const group of groups) {
      const point = group.point;
      const marker = (group.count > 1 ? L.marker([group.latitude, group.longitude], {
        icon: L.divIcon({ className: 'crm-map-cluster', html: String(group.count), iconSize: [28, 28], iconAnchor: [14, 14] }),
        title: `${group.count} candidatos agrupados — amplie para ver as posições individuais`,
      }) : L.circleMarker([point.latitude, point.longitude], {
        renderer, radius: 3,
        color: '#fff', weight: 0.75, fillOpacity: 0.8,
        fillColor: point.coordinate_confirmed ? '#245f87' : point.within_radius ? '#32845f' : '#c14131',
      })).addTo(layer);
      marker.bindTooltip(() => {
        const info = document.createElement('div');
        info.textContent = group.count > 1
          ? `${group.count.toLocaleString('pt-BR')} candidatos agrupados · posição representativa do grupo, não de uma empresa · amplie para conferir as coordenadas individuais`
          : `${point.company_name || point.cnpj} · ${point.coordinate_confirmed ? 'Coordenada confirmada' : 'Sugestão — revisar'} · ${point.distance_km.toLocaleString('pt-BR')} km · clique para abrir a ficha e a fonte`;
        return info;
      });
      marker.on('click', () => {
        if (group.count === 1) onSelect(point);
        else if (map.getZoom() < map.getMaxZoom()) map.setView([group.latitude, group.longitude], Math.min(map.getMaxZoom(), map.getZoom() + 2), { animate: false });
        else {
          const list = document.createElement('div');
          const title = document.createElement('p');
          title.textContent = `${group.count} registros nesta posição`;
          list.append(title);
          const select = document.createElement('select');
          const members = group.members;
          for (const item of members) { const option = document.createElement('option'); option.value = item.id; option.textContent = item.company_name || item.cnpj; select.append(option); }
          const button = document.createElement('button'); button.textContent = 'Abrir ficha';
          button.onclick = () => { const selected = members.find((item) => item.id === select.value); if (selected) onSelect(selected); };
          list.append(select, button); marker.bindPopup(list).openPopup();
        }
      });
    }
  }
  map.on('moveend', render);
  return {
    setPoints(next) { points = next; render(); },
    dispose() {
      disposed = true;
      map.off('moveend', render);
      layer.clearLayers();
      renderer.remove();
      layer.remove();
    },
  };
}

export function removeProspectingMap(L, map) {
  if (!map) return;
  map.stop();
  // Paths must leave before their canvas renderer, otherwise removal schedules
  // a redraw on an already destroyed canvas in Leaflet 1.9.
  map.eachLayer((layer) => { if (layer instanceof L.Path) map.removeLayer(layer); });
  map.remove();
}
