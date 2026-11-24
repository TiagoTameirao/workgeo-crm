export function matchesUnitReview(unit, type) {
  switch (type) {
    case "porte":
      return unit.size === "Desconhecido";
    case "localizacao":
      return unit.latitude == null;
    case "responsavel":
      return !unit.owner;
    case "proxima-acao":
      return !unit.next_action;
    default:
      return true;
  }
}
