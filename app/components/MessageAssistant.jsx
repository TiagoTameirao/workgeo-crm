"use client";
import {useEffect,useRef,useState} from 'react';
export default function MessageAssistant({text,entity,id,onApply}){
 const [enabled,setEnabled]=useState(false),[busy,setBusy]=useState(false),[result,setResult]=useState(null),[notice,setNotice]=useState('');
 const latest=useRef(text); latest.current=text;
 useEffect(()=>{let active=true;fetch('/api/message-assistant').then(r=>r.ok?r.json():{enabled:false}).then(value=>{if(active)setEnabled(value.enabled);}).catch(()=>{});return()=>{active=false;};},[]);
 async function rewrite(action){const original=text;setBusy(true);setResult(null);setNotice('');try{const response=await fetch('/api/message-assistant',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({entity,id,text:original,action})});const data=await response.json();if(!response.ok)throw Error(data.error);if(latest.current!==original){setNotice('O rascunho mudou durante a revisão. Solicite uma nova sugestão.');return;}setResult({original,suggestion:data.suggestion});}catch(error){setNotice(error.message||'Não foi possível preparar a sugestão. Seu rascunho foi preservado.');}finally{setBusy(false);}}
 return <section className="message-assistant"><p className="form-hint">{enabled?'A IA recebe apenas este rascunho. Retire dados sensíveis desnecessários e confira fatos e compromissos antes de usar a sugestão.':'IA opcional desativada. Os modelos de mensagem continuam disponíveis para revisão manual.'}</p>
 {enabled&&<div className="admin-message-actions">{[['improve','Melhorar clareza'],['shorten','Encurtar'],['tone','Ajustar tom']].map(([action,label])=><button key={action} type="button" disabled={busy||!id||!text.trim()} onClick={()=>rewrite(action)}>{busy?'Preparando…':label}</button>)}</div>}
 {enabled&&!id&&<p>Salve o acompanhamento antes de pedir uma sugestão.</p>}
 {result&&<><h4>Sugestão para comparar com seu rascunho</h4><p className="assistant-suggestion">{result.suggestion}</p><p>Confira destinatário, fatos, prazos e compromissos. A revisão não envia a mensagem.</p><button type="button" disabled={text!==result.original} onClick={()=>{onApply(result.suggestion);setResult(null);}}>Usar no rascunho</button><button type="button" onClick={()=>setResult(null)}>Descartar sugestão</button>{text!==result.original&&<p>O rascunho foi alterado; solicite uma nova sugestão.</p>}</>}
 {notice&&<p role="status">{notice}</p>}
 </section>;
}
