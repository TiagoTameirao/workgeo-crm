import { query, get, list, transaction } from "./db.mjs";
import { audit, fail, saveRecord, territory } from "./domain.mjs";
import { findCompanyMatches } from "./company-matches.mjs";
import { normalizeImportKey } from "./client-csv.mjs";
import { pointInGeometry } from "./territory-coverage.mjs";
import { canWrite } from "./model.mjs";

const activityChannel = (channel) => ({ Telefone: "Ligação", WhatsApp: "WhatsApp", "E-mail": "E-mail" })[channel] || "Interno";

export async function convertProspectToClient(user, input) {
  if (!canWrite(user?.role, "units")) fail("Seu perfil não pode cadastrar clientes.", 403);
  if (!input?.candidate_id || !["new", "existing"].includes(input.company_mode)) fail("Escolha o candidato e o destino da empresa.");
  return transaction(async () => {
    const row = (await query("SELECT * FROM prospecting_candidates WHERE id=$1", [input.candidate_id]))[0];
    if (!row) fail("Candidato não encontrado.",404);
    if (row.converted_unit_id) fail("Este candidato já foi convertido em cliente.",409);
    if (row.review_status !== "Aderente" || row.location_status !== "Dentro do KML" || row.latitude == null || row.longitude == null)
      fail("Confirme aderência e localização dentro do KML antes de cadastrar o cliente.");
    const area = await territory();
    if (!area?.geometry || !pointInGeometry([row.longitude,row.latitude],area.geometry))
      fail("A localização deste candidato não está confirmada dentro do território.");
    const candidate = JSON.parse(row.data);
    const companies = await list("companies");
    const matches = findCompanyMatches(candidate.company_name,candidate.cnpj,companies,5);
    let company;
    if (input.company_mode === "existing") {
      const match = matches.find(({company: item})=>item.id===input.company_id);
      if (!match) fail("Selecione uma das empresas semelhantes encontradas.");
      company = await get("companies",match.company.id);
    } else {
      if (typeof input.company_name !== "string" || input.company_name.trim().length<2 || input.company_name.trim().length>200)
        fail("Informe o nome da nova empresa.");
      company = await saveRecord(user,"companies",{
        name:input.company_name.trim(),cnpj:candidate.cnpj||null,
        source:candidate.source||"Dados abertos CNPJ da Receita Federal",
        notes:`Prospecção territorial · snapshot ${candidate.source_date||"sem data"} · candidato ${candidate.cnpj}. Porte cadastral: ${candidate.size_label||"não informado"}. Não equivale a porte operacional confirmado.`,
      });
    }
    const unitName = String(input.unit_name||"").trim();
    if (unitName.length<2 || unitName.length>160) fail("Informe um nome de unidade entre 2 e 160 caracteres.");
    const units = await list("units");
    const normalized = normalizeImportKey(unitName);
    if (units.some((unit)=>unit.company_id===company.id && normalizeImportKey(unit.name)===normalized))
      fail("Essa unidade já existe na empresa. Confira a ficha antes de continuar.",409);
    const source = candidate.source||"Dados abertos CNPJ da Receita Federal";
    const qualification = {
      status: candidate.qualification_status || "Validação pendente",
      segment: candidate.segment_fit || "Não avaliado",
      operating_size: candidate.operating_size || "Não avaliado",
      materials: candidate.materials_fit || "Não avaliado",
      source: candidate.qualification_source || "",
      evidence: candidate.qualification_evidence || "",
      by: candidate.qualification_by || "",
      at: candidate.qualification_at || "",
    };
    const hasQualification = qualification.segment !== "Não avaliado" || qualification.operating_size !== "Não avaliado" || qualification.materials !== "Não avaliado";
    const qualificationNote = hasQualification
      ? `\nQualificação humana na prospecção (${qualification.status}): segmento ${qualification.segment}; porte operacional ${qualification.operating_size}; materiais/estoque ${qualification.materials}. Fonte: ${qualification.source || "não informada"}. Evidência: ${qualification.evidence || "não informada"}. Responsável: ${qualification.by || "não informado"}. Data: ${qualification.at || "não informada"}.`
      : "";
    const unit = await saveRecord(user,"units",{
      company_id:company.id,name:unitName,segment:"Não informado",
      materials:`CNAE candidato: ${candidate.categories||candidate.cnae_primary_description||"não informado"}`,
      size:"Desconhecido",size_evidence:"Desconhecido",size_source:"",
      priority:"Não definida",priority_reason:"",status:"Pesquisa",city:candidate.municipality||"",
      address:candidate.address||"",latitude:Number(row.latitude),longitude:Number(row.longitude),
      source,source_date:/^\d{4}-\d{2}-\d{2}$/.test(candidate.source_date||"")?candidate.source_date:new Date().toISOString().slice(0,10),
      fit:"Aderência indicada pelo CNAE; estoque e demanda ainda precisam ser confirmados.",
      notes:`Convertido da fila de prospecção. CNPJ do estabelecimento: ${candidate.cnpj}. CNAE ${candidate.cnae_primary||""} — ${candidate.cnae_primary_description||""}. Porte cadastral informado pela Receita: ${candidate.size_label||"não informado"}; porte operacional não confirmado. Município e endereço devem ser confirmados antes da abordagem.${qualificationNote}`,
    });
    let contact = null;
    if (candidate.phone || candidate.email) contact = await saveRecord(user,"contacts",{
      unit_id:unit.id,name:"Canal geral — pessoa a confirmar",role:"",
      phone:candidate.phone||"",email:candidate.email||"",source,verified_at:"",
    });
    const prospectActivities = await query("SELECT * FROM prospecting_activities WHERE candidate_id=$1 ORDER BY created_at,id", [row.id]);
    const activeOwners = new Set((await query("SELECT id FROM users WHERE active=1")).map((person) => person.id));
    for (const activity of prospectActivities) {
      const activityDate = /^\d{4}-\d{2}-\d{2}/.test(activity.created_at || "") ? activity.created_at.slice(0, 10) : new Date().toISOString().slice(0, 10);
      await saveRecord(user, "activities", {
        unit_id: unit.id,
        opportunity_id: "",
        name: `Histórico de prospecção · ${activity.channel}`,
        owner_id: activeOwners.has(activity.created_by) ? activity.created_by : user.id,
        due_date: activityDate,
        channel: activityChannel(activity.channel),
        status: "Concluída",
        result: `${activity.result}${activity.notes ? ` · ${activity.notes}` : ""}`,
        notes: `Registro migrado da triagem de Leads. Autor original: ${activity.author_name}. Próxima ação originalmente planejada: ${activity.next_action} (${activity.next_date}).`,
      }, undefined, undefined, { notify: false });
    }
    const latestLeadActivity = prospectActivities.at(-1);
    if (latestLeadActivity) {
      await saveRecord(user, "activities", {
        unit_id: unit.id,
        opportunity_id: "",
        name: latestLeadActivity.next_action,
        owner_id: activeOwners.has(latestLeadActivity.created_by) ? latestLeadActivity.created_by : user.id,
        due_date: latestLeadActivity.next_date,
        channel: "Interno",
        status: "Pendente",
        result: "",
        notes: `Próxima ação transferida da triagem de Leads. Último contato: ${latestLeadActivity.channel} · ${latestLeadActivity.result}.`,
      });
    }
    const now = new Date().toISOString();
    await query("UPDATE prospecting_candidates SET converted_unit_id=$1,converted_at=$2,converted_by=$3,updated_at=$2 WHERE id=$4",[unit.id,now,user.name,row.id]);
    await audit(user,"prospecting_candidates",row.id,"converted_to_client",{converted_unit_id:null},{converted_unit_id:unit.id,company_id:company.id,converted_at:now});
    return {company,unit,contact,transferred_activity_count:prospectActivities.length,next_action_created:Boolean(latestLeadActivity)};
  });
}
