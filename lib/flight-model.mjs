export const flightStatuses = ["Em preparação", "Solicitada", "Parecer favorável registrado", "Parecer desfavorável", "Cancelada"];
export const flightFileKinds = ["Autorização SARPAS", "Solicitação / protocolo", "Termo de coordenação", "Anuência do responsável pelo local", "Documento ANAC", "Homologação ANATEL", "Avaliação de risco", "Seguro", "Outro documento"];
export const flightSources = [
  { title: "DECEA — Portal Drone e orientações SARPAS", url: "https://www.decea.mil.br/drone/" },
  { title: "ICA 100-40/2026 — acesso ao espaço aéreo", url: "https://www.sislaer.fab.mil.br/TerminalWebCENDOC/VisualizadorHtml?codigoArquivo=45351&tipoMidia=0" },
  { title: "ANAC — RBAC 100", url: "https://www.anac.gov.br/assuntos/legislacao/legislacao-1/boletim-de-pessoal/2026/bps-v-21-no-24-15-a-19-06-2026/rbac-100-emd-00/visualizar_ato_normativo" },
];
export function flightLabel(record, now = new Date().toISOString()) {
  return record.status === "Parecer favorável registrado" && record.authorization_end < now ? "Validade encerrada" : record.status;
}
