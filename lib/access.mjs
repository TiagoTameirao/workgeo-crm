export const internalRoles = ["Administrador", "Administração", "Geo Processador", "Piloto de Drone", "Comercial"];
export const legacyRoles = { Administrativo: "Administração", "Aprovação comercial": "Administração", Campo: "Piloto de Drone", Técnico: "Geo Processador" };
export const canonicalRole = (role) => legacyRoles[role] || role;
export const operationalRoles = ["Geo Processador", "Piloto de Drone"];
export const isOperational = (user) => operationalRoles.includes(user?.role);
export const roleDescriptions = {
  Administrador: "Acesso completo ao CRM e gestão dos acessos internos.",
  Administração: "Todas as unidades, cadastros, agenda, comercial, financeiro e gestão da equipe.",
  "Geo Processador": "Todas as unidades e contatos, dados de medições, processamento e documentos operacionais; sem financeiro ou gestão de acessos.",
  "Piloto de Drone": "Todas as unidades e contatos, trabalhos de campo e envio/conferência das autorizações de voo; sem financeiro ou gestão de acessos.",
  Comercial: "Prospecção, clientes, contatos, oportunidades e atendimento comercial. Perfil existente preservado fora das funções do diagrama.",
};
export const flightReaders = (user) => ["Administrador", "Administração", ...operationalRoles].includes(canonicalRole(user?.role));
export const flightEditors = (user) => flightReaders(user) && canonicalRole(user?.role) !== "Geo Processador";
