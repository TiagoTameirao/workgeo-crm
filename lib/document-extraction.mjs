import path from 'node:path';
import {pathToFileURL} from 'node:url';
let pdfjs;
async function openPdf(bytes) {
  if(!pdfjs) {
    const canvas=await import('@napi-rs/canvas');
    for(const key of ['DOMMatrix','ImageData','Path2D'])globalThis[key] ||= canvas[key];
    pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc=pathToFileURL(path.join(process.cwd(),'node_modules','pdfjs-dist','legacy','build','pdf.worker.mjs')).href;
  }
  const assets=path.join(process.cwd(),'node_modules','pdfjs-dist');
  const task=pdfjs.getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useSystemFonts:false,standardFontDataUrl:path.join(assets,'standard_fonts')+'/',cMapUrl:path.join(assets,'cmaps')+'/',cMapPacked:true,wasmUrl:path.join(assets,'wasm')+'/',maxImageSize:16_000_000,verbosity:0});
  try { return {document:await task.promise,close:()=>task.destroy()}; }
  catch(error) { await task.destroy(); throw error; }
}
export async function extractDocument(bytes,contentType) {
  if(contentType!=='application/pdf')return {pages:[],complete:false,reason:'A leitura automática aceita PDF, PNG e JPG. Outros formatos exigem conversão ou revisão humana.'};
  let opened;
  try {
    opened=await openPdf(bytes);const pdf=opened.document;
    if(pdf.numPages>200)return {pages:[],complete:false,reason:'Documento acima de 200 páginas: divida em arquivos menores para conferência.'};
    const pages=[];let count=0;
    for(let number=1;number<=pdf.numPages;number++) {
      const page=await pdf.getPage(number),content=await page.getTextContent(),text=content.items.map(i=>i.str+(i.hasEOL?'\n':' ')).join('');
      count+=text.length;
      if(count>200_000)return {pages,complete:false,reason:'Documento muito extenso para análise integral. Divida-o antes de conferir.'};
      pages.push({number,text,needs_visual:true,needs_ocr:text.replace(/\s/g,'').length<40});
      page.cleanup();
    }
    return {pages,complete:true};
  } catch { return {pages:[],complete:false,reason:'Não foi possível ler o PDF. Confira se está íntegro, legível e sem senha.'}; }
  finally { await opened?.close(); }
}
export async function documentPageImage(bytes,type,number=1) {
  const {createCanvas,loadImage}=await import('@napi-rs/canvas');
  if(type==='application/pdf') {
    const opened=await openPdf(bytes);
    try {
      const p=await opened.document.getPage(number),base=p.getViewport({scale:1});
      const viewport=p.getViewport({scale:Math.min(2,1800/Math.max(base.width,base.height))}),canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));
      await p.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
      return canvas.toBuffer('image/png');
    } finally { await opened.close(); }
  }
  const image=await loadImage(bytes);
  if(image.width*image.height>40_000_000)throw Error('Imagem muito grande.');
  const ratio=Math.min(1,1800/Math.max(image.width,image.height)),canvas=createCanvas(Math.ceil(image.width*ratio),Math.ceil(image.height*ratio));
  canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
  return canvas.toBuffer('image/png');
}
