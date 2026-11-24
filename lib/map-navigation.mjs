export function addMapNavigation(L, map, resetView) {
  const control = L.control({ position: "topleft" });
  control.onAdd = () => {
    const container = L.DomUtil.create("div", "crm-map-navigation leaflet-bar");
    container.setAttribute("role", "group");
    container.setAttribute("aria-label", "Mover e reenquadrar o mapa");
    const actions = [
      ["↑", "Mover mapa para norte", "north", () => map.panBy([0, -map.getSize().y * 0.35], { animate: false })],
      ["←", "Mover mapa para oeste", "west", () => map.panBy([-map.getSize().x * 0.35, 0], { animate: false })],
      ["⌂", "Reenquadrar mapa", "home", resetView],
      ["→", "Mover mapa para leste", "east", () => map.panBy([map.getSize().x * 0.35, 0], { animate: false })],
      ["↓", "Mover mapa para sul", "south", () => map.panBy([0, map.getSize().y * 0.35], { animate: false })],
    ];
    for (const [symbol, label, direction, action] of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = symbol;
      button.title = label;
      button.setAttribute("aria-label", label);
      button.className = direction;
      L.DomEvent.on(button, "click", action);
      container.append(button);
    }
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);
    return container;
  };
  return control.addTo(map);
}
