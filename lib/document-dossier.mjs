export function documentDossiers(documents=[]) {
  const groups=new Map();
  for(const document of documents) {
    const identity=[document.unit_id||'',document.gerdau_contract||'',document.competence||''];
    const key=JSON.stringify(identity);
    if(!groups.has(key)) groups.set(key,{key,unit_id:identity[0],contract:identity[1],competence:identity[2],documents:[]});
    groups.get(key).documents.push(document);
  }
  return [...groups.values()].map(group=>({...group,current:group.documents.filter(document=>!document.archived_at&&document.status!=='Substituído'),returns:group.documents.filter(document=>document.rejection_reason),revisions:group.documents.filter(document=>document.revision>1)}));
}
