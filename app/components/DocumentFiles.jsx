"use client";
import {useEffect,useState,useCallback} from 'react';
import {requestJson} from '../../lib/client-http.mjs';
import {uploadRecordFile} from '../../lib/document-upload-client.mjs';
import {documentPurposes,documentAccept,maxDocumentBytes,documentDownload} from '../../lib/document-files-model.mjs';

export function FileDrop({onFile,disabled=false,accept=documentAccept,label='Arraste o arquivo aqui ou clique para selecionar',multiple=false}) {
 const [dragging,setDragging]=useState(false);
 const choose=files=>{if(!disabled)for(const file of Array.from(files||[]).slice(0,multiple?undefined:1))onFile(file);};
 return <label className={'document-drop'+(dragging?' dragging':'')} onDragOver={e=>{e.preventDefault();if(!disabled)setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={e=>{e.preventDefault();setDragging(false);choose(e.dataTransfer.files);}}>
  <span className="document-drop-icon" aria-hidden="true">↑</span><strong>{label}</strong><span className="document-drop-action">Selecionar arquivo</span><input aria-label="Selecionar arquivo" type="file" accept={accept} disabled={disabled} multiple={multiple} onChange={e=>{choose(e.target.files);e.target.value='';}} /><small>{accept===documentAccept?'PDF, documentos, planilhas ou imagens':'PDF ou imagem'} · até 30 MB</small>
 </label>;
}
export default function DocumentFiles({entity,record,onRecord,onEnsureRecord,onPending,pending,disabled=false}) {
 const purposes=documentPurposes[entity],keys=Object.keys(purposes||{});
 const [files,setFiles]=useState([]),[purpose,setPurpose]=useState(keys[0]),[file,setFile]=useState(pending?.file||null),[busy,setBusy]=useState(false),[progress,setProgress]=useState(null),[error,setError]=useState('');
 const load=useCallback(async()=>{if(record.id)setFiles(await requestJson(`/api/document-files?entity=${entity}&record_id=${encodeURIComponent(record.id)}`));},[entity,record.id,record.version]);
 useEffect(()=>{load().catch(e=>setError(e.message));},[load]);
 useEffect(()=>{if(pending===null)setFile(null);else if(pending?.file)setFile(pending.file);},[pending]);
 if(!purposes)return null;
 function choose(value){setFile(value);setError(value.size>maxDocumentBytes?'Limite: 30 MB.':'');onPending?.(value?{file:value,purpose}:null);}
 async function upload(){setBusy(true);setError('');setProgress(0);try{
  if(!file||file.size>maxDocumentBytes||!file.size)throw Error('Selecione um arquivo com até 30 MB.');
  const target=onEnsureRecord?await onEnsureRecord({skipAttachment:true}):record;
  if(!target?.id)throw Error('Preencha cliente, referência e os campos obrigatórios para anexar.');
  const saved=await uploadRecordFile(entity,target,purpose,file,setProgress);
  onPending?.(null);onRecord?.(saved);setFile(null);setProgress(100);
 }catch(e){setError(e.message);}finally{setBusy(false);}}
 return <section className="document-panel document-attachments wide" aria-label="Anexar documentos"><h3>Anexar documentos</h3><p>Coloque o arquivo diretamente no CRM. O link do Drive é opcional.</p>{error&&<p role="alert" className="error">{error}</p>}
 {!disabled&&<>{keys.length>1&&<label>Qual documento você vai anexar?<select value={purpose} disabled={busy} onChange={e=>{setPurpose(e.target.value);if(file)onPending?.({file,purpose:e.target.value});}}>{keys.map(k=><option key={k} value={k}>{purposes[k]}</option>)}</select></label>}<FileDrop disabled={busy} onFile={choose}/>{file&&<div className="document-selected"><strong>{file.name}</strong><small>{(file.size/1e6).toFixed(2)} MB · {purposes[purpose]}</small><button type="button" disabled={busy} onClick={()=>{setFile(null);onPending?.(null);}}>Remover seleção</button></div>}{progress!=null&&<p role="status">{busy?'Enviando':'Progresso'}: {progress}%</p>}<button type="button" className="primary" disabled={busy||!file||file.size>maxDocumentBytes} onClick={upload}>{busy?'Anexando…':error?'Tentar anexar novamente':record.id?'Anexar arquivo':'Salvar cadastro e anexar arquivo'}</button></>}
 {files.length>0&&<details className="document-history" open><summary>Arquivos anexados ({files.length})</summary>{files.map(f=><div key={f.id} className="document-file"><span><strong>{f.filename}</strong><small>{purposes[f.purpose]} · {(Number(f.size_bytes)/1e6).toFixed(2)} MB · {new Date(f.created_at).toLocaleDateString('pt-BR')}{record.document_file_ids?.[f.purpose]===f.id?' · Atual':' · Histórico'}</small></span><a href={documentDownload(f.id)} download>Baixar</a></div>)}</details>}
 </section>;
}
