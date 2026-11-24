export const segmentColors = {
  Mineração: "#d76522",
  Pedreira: "#3676b0",
  Siderurgia: "#964853",
  Concreteira: "#248a8b",
  Cimenteira: "#638640",
  Sucateiro: "#b88926",
  Madeireira: "#956440",
  "Serviços Ferroviários": "#7958a7",
  Areal: "#ad9659",
  Cerâmica: "#ac6041",
  Indústria: "#4d6773",
  Agro: "#4f9465",
  Outros: "#6e7b85",
  "Não informado": "#919ca4",
};
export const segmentColor = (name) => segmentColors[name] || "#6e7b85";
