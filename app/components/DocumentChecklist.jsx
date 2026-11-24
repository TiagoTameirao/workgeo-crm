"use client";
import {useEffect, useState} from 'react';
import {checklistResults, checklistComplete} from '../../lib/document-checklist.mjs';

export default function DocumentChecklist({document, disabled, onChange}) {
  const [templates,setTemplates]=useState([]), [notice,setNotice]=useState(''), [busy,setBusy]=useState(false);
  const value=document.document_checklist || {source:'',source_version:'',items:[]};
  useEffect(()=>{let active=true; fetch('/api/administrative/checklists').then(r=>{if(!r.ok)throw Error();return r.json();}).then(data=>{if(active)setTemplates(data.templates);}).catch(()=>{if(active)setNotice('Modelos indisponíveis; a conferência pode ser preenchida aqui.');});return()=>{active=false;};},[]);
  const update=(change,reset=false)=>onChange({...value,...change,reviewed_at:null,reviewed_by:null,...(reset?{items:(change.items||value.items).map(item=>({...item,result:'Pendente',justification:''}))}:{})});
  const matching=templates.filter(item=>item.unit_id===document.unit_id && item.contract===(document.gerdau_contract||'') && item.type===(document.bankdoc_record_type||''));
  async function saveTemplate(){setBusy(true);setNotice('');try{const response=await fetch('/api/administrative/checklists',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({unit_id:document.unit_id,contract:document.gerdau_contract||'',type:document.bankdoc_record_type||'',checklist:value})});const result=await response.json();if(!response.ok)throw Error(result.error);setTemplates(result.templates);setNotice('Modelo salvo para esta unidade, contrato e tipo. Resultados não são copiados.');}catch(error){setNotice(error.message||'Não foi possível salvar o modelo.');}finally{setBusy(false);}}
  return <fieldset><legend>Conferência interna manual</legend>
    <p className="form-hint">Não verifica o conteúdo do arquivo nem garante aceite no Bancodoc. Confira os itens na versão indicada. Alterar o documento, as instruções ou a competência exige nova conferência.</p>
    {matching.length>0 && <label>Usar instruções cadastradas<select disabled={disabled} value="" onChange={event=>{const selected=matching.find(item=>item.id===event.target.value);if(selected && (!value.items.length||window.confirm('Substituir as instruções e reiniciar a conferência?')))update(selected.checklist,true);}}><option value="">Selecione um modelo</option>{matching.map(item=><option key={item.id} value={item.id}>{item.checklist.source} · {item.checklist.source_version}</option>)}</select></label>}
    <div className="admin-form-grid"><label>Fonte das instruções<input disabled={disabled} value={value.source} maxLength={1000} onChange={event=>update({source:event.target.value},true)} placeholder="Manual ou instrução confirmada pela equipe" /></label><label>Versão / data das instruções<input disabled={disabled} value={value.source_version} maxLength={120} onChange={event=>update({source_version:event.target.value},true)} /></label></div>
    {!value.items.length && <p className="form-hint">Sem conferência estruturada. As instruções antigas permanecem preservadas.</p>}
    {value.items.map((item,index)=><div className="checklist-item" key={index}>
      <label>Item {index+1}<input disabled={disabled} value={item.label} maxLength={500} onChange={event=>update({items:value.items.map((current,i)=>i===index?{...current,label:event.target.value}:current)},true)} /></label>
      <label className="admin-toggle"><input type="checkbox" disabled={disabled} checked={item.required} onChange={event=>update({items:value.items.map((current,i)=>i===index?{...current,required:event.target.checked}:current)},true)} />Obrigatório</label>
      <label>Resultado<select disabled={disabled} value={item.result} onChange={event=>update({items:value.items.map((current,i)=>i===index?{...current,result:event.target.value}:current)})}>{checklistResults.map(result=><option key={result}>{result}</option>)}</select></label>
      {(item.result==='Não se aplica'||item.result==='Divergência')&&<label>Justificativa / divergência<textarea disabled={disabled} value={item.justification||''} maxLength={1000} onChange={event=>update({items:value.items.map((current,i)=>i===index?{...current,justification:event.target.value}:current)})} /></label>}
    </div>)}
    <div className="admin-message-actions"><button type="button" disabled={disabled||value.items.length>=60} onClick={()=>update({items:[...value.items,{label:'',required:true,result:'Pendente',justification:''}]},true)}>Adicionar item</button><button type="button" disabled={disabled||busy||!value.items.length} onClick={saveTemplate}>Salvar instruções como modelo</button></div>
    {value.reviewed_at?<p>Conferência interna concluída em {new Date(value.reviewed_at).toLocaleString('pt-BR')} · {value.reviewed_name||'Responsável registrado na auditoria'}. Histórico disponível na auditoria.</p>:checklistComplete(value)?<p>Itens resolvidos. Salve para registrar sua conferência desta versão.</p>:null}
    {notice&&<p role="status">{notice}</p>}
  </fieldset>;
}
