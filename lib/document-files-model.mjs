import {flightFileKinds} from './flight-model.mjs';
export const documentPurposes = {
  proposals: {url:'Proposta'}, contracts:{url:'Contrato'},
  services:{data_url:'Dados coletados',delivery_url:'Entrega'},
  materials:{url:'Material'}, invoices:{bulletin:'Boletim',invoice_url:'Nota fiscal',authorization:'Autorização'},
  admin_documents:{url:'Documento'},
  flight_authorizations:Object.fromEntries(flightFileKinds.map(k=>[k,k])),
};
export const documentExtensions = ['pdf','docx','xlsx','png','jpg','jpeg','csv','kml','zip'];
export const maxDocumentBytes = 30_000_000;
export const documentAccept = documentExtensions.map(value=>'.'+value).join(',');
export const documentDownload = id => '/api/document-files/'+id;
