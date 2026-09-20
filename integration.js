/* Provider-independent import layer. OAuth credentials are never stored here. */
const FurusatoImport={
 normalizeText(s){return String(s||'').replace(/[\u3000\s]+/g,' ').trim()},
 normalizeOrderId(s){return this.normalizeText(s).replace(/^(注文番号|注文ID|Order\s*ID|受付番号|申込番号)\s*[:：#]?\s*/i,'').trim()},
 extractAmount(text){const s=this.normalizeText(text).replace(/,/g,'');const ps=[/(?:寄附|寄付|支払|決済|合計|注文|金額)[^\d]{0,30}(\d{3,})\s*円/i,/(\d{3,})\s*円/];for(const p of ps){const m=s.match(p);if(m)return Number(m[1])}return null},
 detectSite(text){const s=this.normalizeText(text).toLowerCase();if(s.includes('楽天')||s.includes('rakuten'))return '楽天';if(s.includes('さとふる')||s.includes('satofull'))return 'さとふる';if(s.includes('ふるさとチョイス')||s.includes('furusato choice'))return 'ふるさとチョイス';if(s.includes('amazon'))return 'Amazon等';return 'その他'},
 extractOrderId(text){const s=this.normalizeText(text);const ps=[/(?:注文番号|注文id|order\s*id|受付番号|申込番号)\s*[:：#]?\s*([A-Z0-9][A-Z0-9\-_./]{4,})/i];for(const p of ps){const m=s.match(p);if(m)return this.normalizeOrderId(m[1])}return ''},
 detectDelivery(text){const s=this.normalizeText(text);if(!/(発送|出荷|配送中|お届け|配達)/i.test(s))return '未確定';const m=s.match(/(\d{1,2})\s*[月/]\s*(\d{1,2})\s*日?/);return m?`${m[1]}/${m[2]}頃`:'配送情報あり・日付未確定'},
 isLikelyDonation(text){return /ふるさと納税|寄附|寄付|返礼品|自治体|ワンストップ/i.test(String(text||''))},
 makeFingerprint(x){return [x.site,this.normalizeOrderId(x.orderId),Number(x.amount)||0,this.normalizeText(x.subject).toLowerCase()].join('|')},
 isDuplicate(candidate,existing){const id=this.normalizeOrderId(candidate.orderId);if(id&&existing.some(x=>this.normalizeOrderId(x.orderId)===id))return true;const fp=this.makeFingerprint(candidate);return existing.some(x=>this.makeFingerprint(x)===fp)},
 parseEmail({subject='',body='',date='',messageId=''}){const text=`${subject}\n${body}`,amount=this.extractAmount(text),orderId=this.extractOrderId(text),site=this.detectSite(text),donation=this.isLikelyDonation(text);return {site,amount,orderId,delivery:this.detectDelivery(text),date,messageId,subject,donation,confidence:amount&&donation?'medium':'low',needsReview:!(amount&&donation&&orderId)}},
 importEmails(emails,state){
  const existing=state.donations||[]; const result={added:0,duplicates:0,review:0};
  for(const e of emails||[]){
    const parsed=this.parseEmail(e); if(!parsed.donation) continue;
    const candidate={id:'mail-'+(parsed.messageId||Date.now()+'-'+Math.random()),site:parsed.site,city:'未確定',item:'メールから抽出',amount:Number(parsed.amount)||0,status:parsed.needsReview?'確認待ち':'確定',delivery:parsed.delivery,orderId:parsed.orderId,source:'yahoo-mail',sourceMessageId:parsed.messageId||'',subject:parsed.subject||''};
    if(candidate.amount<=0){result.review++;continue;}
    if(this.isDuplicate(candidate,existing)){result.duplicates++;continue;}
    existing.push(candidate); result.added++; if(candidate.status==='確認待ち') result.review++;
  }
  state.donations=existing; return result;
 },
 parseSalaryCSV(text){const rows=String(text||'').trim().split(/\r?\n/).filter(Boolean);if(rows.length<2)return [];const header=rows.shift().split(',').map(x=>x.trim().toLowerCase());const mi=header.findIndex(x=>/month|月/.test(x));const gi=header.findIndex(x=>/gross|salary|給与|支給額/.test(x));return rows.map((line,i)=>{const c=line.split(',').map(x=>x.trim().replace(/^"|"$/g,''));const month=Number(c[mi>=0?mi:0]);const gross=Number((c[gi>=0?gi:1]||'').replace(/,/g,''));return {month,gross,source:'auto',status:'actual'}}).filter(x=>x.month>=1&&x.month<=12&&Number.isFinite(x.gross)&&x.gross>0)}
};
if(typeof window!=='undefined')window.FurusatoImport=FurusatoImport;if(typeof module!=='undefined')module.exports=FurusatoImport;


/* Google Drive browser OAuth integration.
 * Client ID is public (not a secret) and is stored only in localStorage.
 * Access tokens are kept in memory only and are never written to app data.
 * Uses Google Identity Services token model for a browser PWA.
 */
const FurusatoGoogleDrive = (() => {
  const CLIENT_KEY='furusatoGoogleClientId';
  const SCOPES='https://www.googleapis.com/auth/drive.readonly';
  let tokenClient=null, accessToken=null;
  let readyPromise=null;
  const runtimeDiagnostics=[];
  // Keep the latest rendered OCR PNG in memory so the Settings page can export it.
  // This must be declared in the same closure as ocrPageFromPdfDoc().
  let lastOcrImageDataUrl=null;
  function diag(entry){try{runtimeDiagnostics.push({...entry,at:new Date().toISOString()});if(runtimeDiagnostics.length>80)runtimeDiagnostics.splice(0,runtimeDiagnostics.length-80)}catch{}}
  function getRuntimeDiagnostics(){return runtimeDiagnostics.slice()}
  function clearRuntimeDiagnostics(){runtimeDiagnostics.length=0}
  function getClientId(){return localStorage.getItem(CLIENT_KEY)||''}
  function setClientId(v){const x=String(v||'').trim(); if(x)localStorage.setItem(CLIENT_KEY,x); else localStorage.removeItem(CLIENT_KEY); return x}
  function loadScript(src){return new Promise((resolve,reject)=>{const old=document.querySelector(`script[src="${src}"]`);if(old){old.dataset.loaded==='1'?resolve():old.addEventListener('load',resolve,{once:true});return}const s=document.createElement('script');s.src=src;s.async=true;s.defer=true;s.onload=()=>{s.dataset.loaded='1';resolve()};s.onerror=reject;document.head.appendChild(s)})}
  async function ready(){
    if(readyPromise)return readyPromise;
    readyPromise=(async()=>{await loadScript('https://accounts.google.com/gsi/client');await loadScript('https://apis.google.com/js/api.js');await new Promise((resolve,reject)=>{if(window.gapi?.client?.drive)return resolve();if(!window.gapi?.load)return reject(new Error('Google API client could not load'));window.gapi.load('client',{callback:resolve,ontimeout:()=>reject(new Error('Google API client load timeout')),timeout:10000})});await gapi.client.load('https://www.googleapis.com/discovery/v1/apis/drive/v3/rest');const id=getClientId();if(!id)throw new Error('Google Client ID未設定');tokenClient=google.accounts.oauth2.initTokenClient({client_id:id,scope:SCOPES,callback:()=>{}});return true})();return readyPromise
  }
  async function authorize(){await ready();return new Promise((resolve,reject)=>{tokenClient.callback=(resp)=>{if(resp?.error){reject(new Error(resp.error));return}accessToken=resp.access_token;gapi.client.setToken({access_token:accessToken});resolve(accessToken)};tokenClient.requestAccessToken({prompt:accessToken?'':'consent'})})}
  function signOut(){if(accessToken&&window.google?.accounts?.oauth2)google.accounts.oauth2.revoke(accessToken,()=>{});accessToken=null;try{gapi.client.setToken(null)}catch{} }
  const SEARCH_NAME_TERMS=['Chinginmeisai','chingin','Gensen','gensen','Bonus','bonus','給与','給料','賃金','賞与','ボーナス','源泉','源泉徴収','年末調整','salary','withholding'];
  const SEARCH_TEXT_TERMS=['給与明細票','賞与明細票','源泉徴収票','支給合計','Total Payment'];
  function yearAliases(year){
    const y=Number(year); if(!Number.isInteger(y))return [];
    const reiwa=y-2018;
    return [String(y),`${y}年`,`R${reiwa}`,`R${String(reiwa).padStart(2,'0')}`,`令和${reiwa}年`];
  }
  function candidateTypeFromName(name=''){
    const n=String(name);
    if(/bonus|賞与|ボーナス/i.test(n))return 'bonus';
    if(/gensen|源泉|withholding/i.test(n))return 'withholding';
    if(/chinginmeisai|chingin|給与|給料|賃金|salary/i.test(n))return 'salary';
    return 'unknown';
  }
  function yearFromName(name=''){
    const n=String(name);
    let m=n.match(/(20\d{2})[-_](0[1-9]|1[0-2])(?:[-_]\d{1,2})?/); if(m)return Number(m[1]);
    m=n.match(/(20\d{2})(0[1-9]|1[0-2])(?![\d,])/); if(m)return Number(m[1]);
    m=n.match(/(20\d{2})年/); if(m)return Number(m[1]);
    m=n.match(/(?:R|令和)\s*0?(\d{1,2})年/i); if(m)return 2018+Number(m[1]);
    return null;
  }
  function fileYearAllowed(name,years){
    const y=yearFromName(name); if(y!==null)return years.includes(y);
    // If the filename has no year, it is only admitted from a year-qualified fullText query.
    return false;
  }
  async function listAllFilesByQuery(q){
    const out=[]; let pageToken='';
    do{
      const params={q,orderBy:'modifiedTime desc',pageSize:100,fields:'nextPageToken,files(id,name,mimeType,size,modifiedTime,createdTime,webViewLink,parents)',supportsAllDrives:true,includeItemsFromAllDrives:true};
      if(pageToken)params.pageToken=pageToken;
      const r=await gapi.client.drive.files.list(params);
      out.push(...(r.result.files||[])); pageToken=r.result.nextPageToken||'';
    }while(pageToken);
    return out;
  }
  // All relevant source PDFs use this prefix. Restricting the Drive query to it avoids
  // scanning unrelated PDFs. A filename year is mandatory: if it is missing, or outside
  // the target/prior year, the file is skipped BEFORE download/PDF analysis.
  const TARGET_FILE_PREFIX='1219856';
  async function listCandidateFiles(targetYear){
    if(!accessToken)await authorize();
    const currentYear=Number(targetYear)||new Date().getFullYear();
    const priorYear=currentYear-1;
    const years=[priorYear,currentYear];
    const safe=TARGET_FILE_PREFIX.replace(/'/g,"\\'");
    const q=`trashed = false and mimeType = 'application/pdf' and name contains '${safe}'`;
    let rows=[];
    try{rows=await listAllFilesByQuery(q)}catch(e){throw new Error(`Google Drive検索に失敗しました: ${e.message||e}`)}
    const out=[];
    for(const f of rows){
      const name=String(f.name||'');
      const isPdf=/\.pdf$/i.test(name)||f.mimeType==='application/pdf';
      if(!isPdf||!name.includes(TARGET_FILE_PREFIX))continue;
      const y=yearFromName(name);
      if(y===null || !years.includes(y))continue;
      const type=candidateTypeFromName(name);
      if(type==='unknown')continue;
      out.push({...f,candidate:true,candidateType:type,filenameYear:y});
    }
    return out.sort((a,b)=>String(b.modifiedTime||'').localeCompare(String(a.modifiedTime||'')));
  }
  async function downloadPdf(fileId){
    if(!accessToken)await authorize();
    const url=`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
    const started=performance.now();
    const r=await fetch(url,{headers:{Authorization:`Bearer ${accessToken}`,Accept:'application/pdf,application/octet-stream;q=0.9,*/*;q=0.1'},cache:'no-store'});
    const contentType=r.headers.get('content-type')||'';
    const contentLength=r.headers.get('content-length')||'';
    if(!r.ok){diag({stage:'download',fileId,status:r.status,contentType,contentLength,error:`Drive download failed: ${r.status}`});throw new Error(`Drive download failed: ${r.status}`)}
    const buf=await r.arrayBuffer();
    const bytes=new Uint8Array(buf);
    const head=Array.from(bytes.slice(0,16)).map(x=>x.toString(16).padStart(2,'0')).join(' ');
    const ascii=String.fromCharCode(...bytes.slice(0,16));
    const isPdf=ascii.startsWith('%PDF-');
    const meta={stage:'download',fileId,status:r.status,contentType,contentLength,bytes:bytes.byteLength,headHex:head,headAscii:ascii,isPdf,ms:Math.round(performance.now()-started)};
    diag(meta);
    if(bytes.byteLength<100||!isPdf)throw new Error(`PDF取得内容が不正です: ${isPdf?'サイズ不足':'PDF署名なし'} / ${bytes.byteLength} bytes / ${contentType}`);
    return buf
  }
  async function pdfText(arrayBuffer){
    // Toyota's PDFs are generated by an older JasperReports/iText stack and
    // declare Japanese CID fonts without embedding the font files. The old
    // PDF.js 3.11 path could draw the table/vector layer while losing Japanese
    // glyphs on iPhone/Safari. Use a newer Mozilla PDF.js build and explicitly
    // provide CMaps + standard fonts for the same rendering path used by OCR.
    if(!window.pdfjsLib){
      const mod=await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/legacy/build/pdf.min.mjs');
      window.pdfjsLib=mod;
    }
    const pdf=window.pdfjsLib||window.pdfjs;if(!pdf)throw new Error('PDF解析ライブラリを読み込めませんでした');
    const PDFJS_BASE='https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/';
    if(pdf.GlobalWorkerOptions)pdf.GlobalWorkerOptions.workerSrc=PDFJS_BASE+'legacy/build/pdf.worker.min.mjs';
    const bytes=arrayBuffer instanceof ArrayBuffer?new Uint8Array(arrayBuffer.slice(0)):new Uint8Array(arrayBuffer);
    const pdfOpenOptions={
      cMapUrl:PDFJS_BASE+'cmaps/',
      cMapPacked:true,
      standardFontDataUrl:PDFJS_BASE+'standard_fonts/',
      useSystemFonts:true,
      disableFontFace:false,
      useWorkerFetch:true
    };
    const tryOpen=async(opts)=>{try{return await pdf.getDocument({...pdfOpenOptions,...opts}).promise}catch(e){return null}};
    // Safari/iOS can expose an empty text layer for these Toyota PDFs. Prefer a
    // Blob URL so PDF.js can use its normal worker/render path, then fall back to
    // a copied Uint8Array with the worker disabled. Never reuse a transferred buffer.
    let doc=null;
    const blob=new Blob([bytes],{type:'application/pdf'}); const url=URL.createObjectURL(blob);
    try{doc=await tryOpen({url})}finally{URL.revokeObjectURL(url)}
    if(!doc)doc=await tryOpen({data:new Uint8Array(bytes),disableWorker:true});
    if(!doc)throw new Error('PDFを開けませんでした');
    let text=''; const pages=[]; let itemCount=0;
    for(let i=1;i<=doc.numPages;i++){
      const page=await doc.getPage(i);
      let c=await page.getTextContent({normalizeWhitespace:false,disableCombineTextItems:true});
      let items=(c.items||[]).filter(x=>String(x.str||'').trim()).map(x=>({str:String(x.str||''),x:Number(x.transform?.[4]||0),y:Number(x.transform?.[5]||0),width:Number(x.width||0),height:Number(x.height||0)}));
      // A second extraction pass is useful for PDFs whose first text layer
      // resolves to an empty array on mobile PDF.js.
      if(items.length===0){
        c=await page.getTextContent({normalizeWhitespace:true,disableCombineTextItems:false});
        items=(c.items||[]).filter(x=>String(x.str||'').trim()).map(x=>({str:String(x.str||''),x:Number(x.transform?.[4]||0),y:Number(x.transform?.[5]||0),width:Number(x.width||0),height:Number(x.height||0)}));
      }
      itemCount+=items.length; pages.push(items);
      const lines=[];
      for(const it of items){let g=lines.find(v=>Math.abs(v.y-it.y)<=3);if(!g){g={y:it.y,items:[]};lines.push(g)}g.items.push(it)}
      lines.sort((a,b)=>b.y-a.y);
      text+=lines.map(g=>g.items.slice().sort((a,b)=>a.x-b.x).map(x=>x.str).join(' ')).join('\n')+'\n';
    }
    const pageMeta=pages.map((items,i)=>({page:i+1,items:items.length,textChars:items.reduce((n,x)=>n+String(x.str||'').length,0),sample:items.slice(0,12).map(x=>String(x.str||'')).join(' | ')}));
    diag({stage:'pdfText',pageCount:doc.numPages,textItemCount:itemCount,textChars:text.length,textSample:text.slice(0,1000),pageMeta:pageMeta.slice(0,8)});
    return {text,pages,pageCount:doc.numPages,textItemCount:itemCount,pageMeta,ocrUsed:false,pdfDoc:doc};
  }
  async function ocrPageFromPdfDoc(doc,region=null,options={}){
    if(!doc)throw new Error('OCR用PDFドキュメントがありません');
    const page=await doc.getPage(1); const scale=Number(options.scale||region?.scale||3.0); const full=page.getViewport({scale});
    const r=region||{x0:0,y0:0,x1:1,y1:1};
    const sx=Math.max(0,Math.min(1,Number(r.x0)||0)),sy=Math.max(0,Math.min(1,Number(r.y0)||0));
    const ex=Math.max(sx,Math.min(1,Number(r.x1)==null?1:Number(r.x1))),ey=Math.max(sy,Math.min(1,Number(r.y1)==null?1:Number(r.y1)));
    const canvas=document.createElement('canvas'); const cw=Math.max(1,Math.round(full.width*(ex-sx))),ch=Math.max(1,Math.round(full.height*(ey-sy)));
    canvas.width=cw;canvas.height=ch; const ctx=canvas.getContext('2d',{willReadFrequently:true});
    // iOS/Safari guard: force an opaque white page before OCR. Transparent PDF canvas
    // backgrounds can be serialized into PNG in a way that makes Tesseract see a blank page.
    ctx.save(); ctx.globalCompositeOperation='source-over'; ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,cw,ch); ctx.restore();
    await page.render({canvasContext:ctx,viewport:full,background:'#ffffff',transform:[1,0,0,1,-full.width*sx,-full.height*sy]}).promise;
    if(!window.Tesseract)await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js');
    if(!window.Tesseract?.recognize)throw new Error('OCRライブラリを読み込めませんでした');
    const psm=String(options.psm||11);
    const lang=String(options.lang||'jpn+eng');
    const sample=ctx.getImageData(0,0,Math.min(cw,64),Math.min(ch,64)).data;
    let nonWhite=0,sum=0; for(let i=0;i<sample.length;i+=4){const v=(sample[i]+sample[i+1]+sample[i+2])/3;sum+=v;if(v<245)nonWhite++;}
    // Inspect the rendered pixels across the image, not only the top-left corner.
    const statW=Math.min(cw,160),statH=Math.min(ch,160);
    const fullSample=ctx.getImageData(0,0,statW,statH).data;
    let fullNonWhite=0,fullSum=0,fullMin=255,fullMax=0;
    for(let i=0;i<fullSample.length;i+=4){const v=(fullSample[i]+fullSample[i+1]+fullSample[i+2])/3;fullSum+=v;fullMin=Math.min(fullMin,v);fullMax=Math.max(fullMax,v);if(v<245)fullNonWhite++;}
    const fullPixels=fullSample.length/4;
    // Passing an explicit opaque PNG data URL is more stable on iOS Safari.
    const imageDataUrl=canvas.toDataURL('image/png');
    // Keep the FULL PAGE as the user-facing preview/save image. Region OCR is
    // intentionally allowed to run for parsing, but must never replace the
    // preview with a cropped rectangle.
    if(!region) lastOcrImageDataUrl=imageDataUrl;
    const rOcr=await window.Tesseract.recognize(imageDataUrl,lang,{tessedit_pageseg_mode:psm,preserve_interword_spaces:'1'});
    const data=rOcr?.data||{};
    const result={text:String(data.text||''),words:Array.isArray(data.words)?data.words:[],pages:[],pageCount:doc.numPages,textItemCount:0,ocrUsed:true,ocrConfidence:Number(data.confidence||0),ocrPsm:psm,ocrLang:lang,ocrWidth:cw,ocrHeight:ch,ocrRegion:!!region,imageBytes:imageDataUrl.length,cornerNonWhite:nonWhite,cornerMean:sample.length?sum/(sample.length/4):255,renderSampleWidth:statW,renderSampleHeight:statH,renderNonWhite:fullNonWhite,renderNonWhiteRatio:fullPixels?fullNonWhite/fullPixels:0,renderMean:fullPixels?fullSum/fullPixels:255,renderMin:fullMin,renderMax:fullMax};
    diag({stage:'ocr',psm,lang,chars:result.text.length,words:result.words.length,confidence:result.ocrConfidence,width:cw,height:ch,imageBytes:result.imageBytes,cornerNonWhite:result.cornerNonWhite,cornerMean:result.cornerMean,renderSampleWidth:statW,renderSampleHeight:statH,renderNonWhite:fullNonWhite,renderNonWhiteRatio:result.renderNonWhiteRatio,renderMean:result.renderMean,renderMin:result.renderMin,renderMax:result.renderMax,region:!!region,sample:result.text.slice(0,300)});
    return result;
  }
  function ocrQuality(text,confidence=0){
    const t=String(text||''); const digits=(t.match(/\d/g)||[]).length;
    const labels=(t.match(/給与|支給|課税|非課税|保険|源泉|賞与|控除|Payment|Taxable|Total|Insurance|Withholding/gi)||[]).length;
    return digits*2+labels*8+Math.min(120,t.length/8)+Number(confidence||0);
  }
  async function ensurePdfText(arrayBuffer,pdf,name){
    const base=pdf||await pdfText(arrayBuffer); const type=candidateTypeFromName(name); const raw=String(base.text||'');
    // One-character/empty text layers are not successful extraction. They must
    // go through the OCR fallback instead of being recorded as a readable PDF.
    const minChars=type==='withholding'?80:(type==='bonus'?100:120);
    let structuralOk=(base.textItemCount||0)>=8 && raw.length>=minChars;
    try{
      if(type==='salary'){const q=parseSalaryComponents(base);structuralOk=structuralOk&&q.taxableGross!=null&&!q.needsReview;}
      else if(type==='bonus'){const q=parseBonusPdf(base,name);structuralOk=structuralOk&&q.date&&q.amount!=null&&!q.needsReview;}
      else if(type==='withholding'){const q=parseWithholdingPdf(base,name);structuralOk=structuralOk&&q.year!=null&&q.annualSalary!=null&&q.incomeTax!=null&&q.social!=null&&!q.needsReview;}
    }catch{structuralOk=false}
    if(structuralOk)return base;
    if(!base.pdfDoc)return {...base,ocrUsed:false,ocrError:'PDFの文字レイヤーが取得できませんでした'};
    const attempts=[];
    try{
      // Keep both layouts. Sparse PSM 11 is good at Japanese labels, while PSM
      // 6 often preserves the numeric summary row. Choosing only one can lose
      // either the label or its value, so the parser receives their union.
      attempts.push(await ocrPageFromPdfDoc(base.pdfDoc,null,{scale:2.5,psm:11,lang:'jpn'}));
      attempts.push(await ocrPageFromPdfDoc(base.pdfDoc,null,{scale:2.5,psm:6,lang:'jpn'}));
      const firstText=attempts.map(x=>String(x.text||'')).join('\n');
      // Numeric fields on this payroll are often recognized more reliably by the
      // English model than by the mixed Japanese model. Use it only when the
      // first OCR pass is too sparse; this is a fallback, not the primary parser.
      if(ocrQuality(firstText,Math.max(...attempts.map(x=>Number(x.ocrConfidence||0))))<260){
        attempts.push(await ocrPageFromPdfDoc(base.pdfDoc,null,{scale:2.5,psm:11,lang:'eng'}));
      }
      if(type==='salary' && ocrQuality(attempts.map(x=>x.text).join('\n'),Math.max(...attempts.map(x=>x.ocrConfidence||0)))<260){
        attempts.push(await ocrPageFromPdfDoc(base.pdfDoc,{x0:0,y0:0.68,x1:0.75,y1:1},{scale:2.5,psm:11,lang:'jpn'}));
      }
      const nonEmpty=attempts.filter(x=>String(x.text||'').trim().length>=20);
      if(!nonEmpty.length)throw new Error('OCR結果が空または短すぎます');
      const mergedText=nonEmpty.map(x=>String(x.text||'')).join('\n');
      // Do not merely choose the OCR pass with the most characters. A pass can
      // be long but still be useless for payroll parsing. Prefer a pass that
      // independently produces a validated record, then use quality as the
      // tie-breaker. This directly guards the former "OCR=実行／文字数だけ"
      // false-success path.
      const parseAttempt=(a)=>{
        try{
          const q={...a,ocrText:a.text,ocrUsed:true};
          if(type==='salary')return !parseSalaryPdf(q,name).needsReview;
          if(type==='bonus')return !parseBonusPdf(q,name).needsReview;
          if(type==='withholding')return !parseWithholdingPdf(q,name).needsReview;
        }catch{}
        return false;
      };
      const valid=nonEmpty.filter(parseAttempt);
      const ranked=(valid.length?valid:nonEmpty).slice().sort((a,b)=>{
        const av=ocrQuality(a.text,a.ocrConfidence),bv=ocrQuality(b.text,b.ocrConfidence);
        return bv-av;
      });
      const best=ranked[0];
      const wordSource=valid.find(x=>!x.ocrRegion&&Array.isArray(x.words)&&x.words.length)
        ||nonEmpty.find(x=>!x.ocrRegion&&Array.isArray(x.words)&&x.words.length)
        ||best;
      return {...base,text:mergedText,ocrText:mergedText,ocrUsed:true,ocrConfidence:Math.max(...attempts.map(x=>Number(x.ocrConfidence||0))),ocrPsm:attempts.map(x=>x.ocrPsm).join(','),ocrWords:wordSource.words||[],ocrWordCount:Array.isArray(wordSource.words)?wordSource.words.length:0,ocrWidth:wordSource.ocrWidth,ocrHeight:wordSource.ocrHeight,ocrAttempts:attempts.map(x=>({psm:x.ocrPsm,lang:x.ocrLang,chars:String(x.text||'').length,confidence:x.ocrConfidence||0,words:Array.isArray(x.words)?x.words.length:0,valid:valid.includes(x)})),ocrValidated:valid.length>0};
    }catch(e){diag({stage:'ocrError',type,name,error:e?.stack||e?.message||String(e),attempts:attempts.map(x=>({psm:x.ocrPsm,lang:x.ocrLang,chars:String(x.text||'').length,confidence:x.ocrConfidence||0,words:Array.isArray(x.words)?x.words.length:0,sample:String(x.text||'').slice(0,300),width:x.ocrWidth||0,height:x.ocrHeight||0,imageBytes:x.imageBytes||0,cornerNonWhite:x.cornerNonWhite||0,cornerMean:x.cornerMean||0}))});return {...base,text:raw,ocrText:'',ocrUsed:true,ocrError:e?.message||String(e),ocrAttempts:attempts.map(x=>({psm:x.ocrPsm,lang:x.ocrLang,chars:String(x.text||'').length,confidence:x.ocrConfidence||0,words:Array.isArray(x.words)?x.words.length:0,valid:false})),ocrValidated:false};}
    return {...base,text:raw,ocrUsed:true,ocrError:'OCR結果が空でした'};
  }
  function classifyPdfText(text,name=''){
    const n=String(name||''); const t=`${n}\n${String(text||'')}`;
    const byName=candidateTypeFromName(n);
    if(byName==='bonus')return 'bonus_slip'; if(byName==='withholding')return 'withholding'; if(byName==='salary')return 'salary_slip';
    if(/賞与明細票|賞与|ボーナス|bonus/i.test(t))return 'bonus_slip';
    if(/源泉徴収票|給与所得の源泉徴収票|withholding/i.test(t))return 'withholding';
    if(/給与明細票|給与|給料|賃金|salary|支給合計|Total\s*Payment/i.test(t))return 'salary_slip';
    return 'unknown';
  }
  function cleanPdfText(text){return String(text||'').replace(/[\u00a0\u3000]/g,' ').replace(/\s+/g,' ').trim()}
  function extractNumberAfter(text,patterns){const s=cleanPdfText(text);for(const p of patterns){const m=s.match(p);if(m)return Number(String(m[1]).replace(/,/g,''))}return null}
  function extractDateParts(text,name=''){
    const s=`${name}\n${text}`; let m=String(name).match(/(20\d{2})[-_](0[1-9]|1[0-2])(?:[-_]\d{1,2})?/); if(m)return {year:Number(m[1]),month:Number(m[2])};
    m=String(name).match(/(20\d{2})(0[1-9]|1[0-2])(?![\d,])/); if(m)return {year:Number(m[1]),month:Number(m[2])};
    m=s.match(/(20\d{2})年\s*(\d{1,2})月/); if(m)return {year:Number(m[1]),month:Number(m[2])};
    m=s.match(/(20\d{2})[/-](\d{1,2})(?:[/-]\d{1,2})?/); if(m)return {year:Number(m[1]),month:Number(m[2])};
    m=s.match(/(20\d{2})(0[1-9]|1[0-2])(?![\d,])/); if(m)return {year:Number(m[1]),month:Number(m[2])};
    return {year:null,month:null};
  }
  function normalizeLabel(s){return String(s||'').replace(/[\u3000\s]/g,'').replace(/[（）()]/g,'').toLowerCase()}
  function parseAmountToken(s){const t=String(s||'').replace(/[￥¥,\s]/g,'');return /^-?\d{3,}$/.test(t)?Number(t):null}
  function isAmountToken(s){return parseAmountToken(s)!=null}
  function extractLabeledNumber(textOrPdf, labels){
    const text=typeof textOrPdf==='string'?textOrPdf:(textOrPdf?.text||'');
    const layout=textOrPdf?.pages;
    const wantedLabels=(labels||[]).map(normalizeLabel).filter(Boolean);
    const toAmount=(s)=>{
      // Do not concatenate a payroll amount with the following year/month.
      // Toyota's PDF text stream can be laid out as "6,760 2026" with only
      // whitespace/line-order information separating the tokens.
      const raw=String(s||'').replace(/[￥¥\s\u3000]/g,' ');
      const matches=raw.match(/(?<![\d,])(?:\d{1,3}(?:,\d{3})+|\d{3,})(?![\d,])/g)||[];
      for(const token of matches){
        const n=Number(token.replace(/,/g,''));
        if(Number.isFinite(n)&&n>=100&&n<1000000000&&!(n>=1900&&n<=2100))return n;
      }
      return null;
    };
    const joinAmountTokens=(arr,start,max=6)=>{
      let joined='';
      for(let j=start;j<Math.min(arr.length,start+max);j++){
        joined+=String(arr[j].str||'');
        const n=toAmount(joined);
        if(n!=null)return n;
      }
      return null;
    };
    const findInLine=(line,label)=>{
      const items=line.slice().sort((a,b)=>a.x-b.x);
      for(let a=0;a<items.length;a++){
        let acc='';
        for(let b=a;b<Math.min(items.length,a+12);b++){
          acc+=items[b].str;
          if(!normalizeLabel(acc).includes(label))continue;
          const lx=items[b].x+items[b].width;
          // Only accept a number immediately following this occurrence.
          // This is important because Toyota's header also contains the words
          // 「各種手当の課税対象額」 but no value. Looking far across that line
          // can accidentally pick the 基準賃金等 amount instead.
          const tail=items.slice(b+1,b+7).filter(it=>it.x>=lx-3);
          for(let k=0;k<tail.length;k++){
            const n=toAmount(tail[k].str)||joinAmountTokens(tail,k);
            if(n!=null)return n;
          }
        }
      }
      return null;
    };
    if(Array.isArray(layout)){
      for(const page of layout){
        const items=(page||[]).filter(it=>String(it.str||'').trim()).map(it=>({...it,str:String(it.str||'').trim()}));
        const lines=[];
        for(const it of items){
          let line=lines.find(g=>Math.abs(g.y-it.y)<=4);
          if(!line){line={y:it.y,items:[]};lines.push(line)}
          line.items.push(it);
        }
        for(const label of wantedLabels){
          for(const line of lines){
            const n=findInLine(line.items,label);
            if(n!=null)return n;
          }
        }
        // Second pass: handle labels whose value is in a neighbouring table
        // cell / slightly different baseline. Search every label occurrence,
        // but limit the numeric candidate to a small visual neighbourhood.
        for(const label of wantedLabels){
          const hits=[];
          for(const line of lines){
            const items=line.items.slice().sort((a,b)=>a.x-b.x);
            for(let i=0;i<items.length;i++){
              let acc='';
              for(let j=i;j<Math.min(items.length,i+12);j++){
                acc+=items[j].str;
                if(matchesLabel(acc,label)){
                  hits.push({x:items[j].x+items[j].width,y:line.y});
                  break;
                }
              }
            }
          }
          for(const hit of hits){
            const candidates=[];
            for(const line of lines){
              for(const it of line.items){
                const n=toAmount(it.str);
                if(n==null)continue;
                const dx=it.x-hit.x,dy=Math.abs(line.y-hit.y);
                // A table value can be on a neighbouring baseline, but should
                // still be visually close. Avoid jumping to another payroll row.
                if(dx>=-5&&dx<=260&&dy<=24)candidates.push({n,score:dy*30+Math.max(0,dx)});
              }
            }
            candidates.sort((a,b)=>a.score-b.score);
            if(candidates.length)return candidates[0].n;
          }
        }
      }
    }
    // Raw text fallback. Search EVERY occurrence and require the amount to be
    // close to the label. This prevents a header occurrence from consuming the
    // next unrelated salary amount.
    const compact=String(text||'').replace(/[\s\u3000\u00a0]+/g,'').replace(/[（）()]/g,'').toLowerCase();
    for(const label of wantedLabels){
      let from=0;
      while(true){
        const idx=compact.indexOf(label,from);
        if(idx<0)break;
        const tail=compact.slice(idx+label.length,idx+label.length+8);
        const n=toAmount(tail);
        if(n!=null)return n;
        from=idx+label.length;
      }
    }
    return null;
  }
  function extractToyotaPayrollAmount(textOrPdf, labels){
    const wanted=(labels||[]).map(normalizeLabel).filter(Boolean);
    const matchesLabel=(acc,label)=>{const a=normalizeLabel(acc);if(label==='taxableamount'&&a.includes('nontaxableamount'))return false;return a.includes(label)};
    const layout=textOrPdf?.pages;
    const text=typeof textOrPdf==='string'?textOrPdf:(textOrPdf?.text||'');
    const toAmount=(s)=>{
      const raw=String(s||'').replace(/[￥¥\s\u3000]/g,' ');
      const matches=raw.match(/(?<![\d,])(?:\d{1,3}(?:,\d{3})+|\d{3,})(?![\d,])/g)||[];
      for(const token of matches){
        const n=Number(token.replace(/,/g,''));
        if(Number.isFinite(n)&&n>=100&&n<1000000000&&!(n>=1900&&n<=2100))return n;
      }
      return null;
    };
    if(Array.isArray(layout)){
      const allLines=[];
      for(const page of layout){
        const items=(page||[]).filter(it=>String(it.str||'').trim()).map(it=>({...it,str:String(it.str||'').trim()}));
        const lines=[];
        for(const it of items){
          let g=lines.find(x=>Math.abs(x.y-it.y)<=5);
          if(!g){g={y:it.y,items:[]};lines.push(g)}
          g.items.push(it);
        }
        for(const g of lines)allLines.push(g);
      }
      // IMPORTANT: evaluate each requested label independently. The previous
      // implementation mixed hits from different labels, so asking for
      // 「課税対象額」 could accidentally return the nearby
      // 「非課税額」/「通勤費」 value. That is exactly the kind of silent
      // misread that can turn a real salary into the wrong number.
      for(const label of wanted){
        const hits=[];
        for(const line of allLines){
          const ordered=line.items.slice().sort((a,b)=>a.x-b.x);
          for(let i=0;i<ordered.length;i++){
            let acc='';
            for(let j=i;j<Math.min(ordered.length,i+20);j++){
              acc+=ordered[j].str;
              if(matchesLabel(acc,label)){
                hits.push({x:ordered[j].x+ordered[j].width,y:line.y});
                break;
              }
            }
          }
        }
        // PDF coordinates usually increase upward, so lower y is physically
        // lower on the page. Prefer the actual summary block, but only after
        // requiring a nearby numeric value for THIS label.
        hits.sort((a,b)=>a.y-b.y);
        for(const hit of hits){
          const candidates=[];
          for(const line of allLines){
            const dy=Math.abs(line.y-hit.y);
            if(dy>28)continue;
            for(const it of line.items){
              const n=toAmount(it.str); if(n==null)continue;
              const dx=it.x-hit.x;
              if(dx>=-15&&dx<=380)candidates.push({n,score:dy*100+Math.max(0,dx)});
            }
          }
          candidates.sort((a,b)=>a.score-b.score);
          if(candidates.length)return candidates[0].n;
        }
      }
    }
    const compact=String(text||'').replace(/[\u3000\s]+/g,'').toLowerCase();
    for(const label of wanted){
      let from=0;
      while(true){
        const idx=compact.indexOf(label,from);
        if(idx<0)break;
        if(label==='taxableamount' && idx>=3 && compact.slice(Math.max(0,idx-3),idx)==='non'){from=idx+label.length;continue}
        const tail=compact.slice(idx+label.length,idx+label.length+24);
        const m=tail.match(/((?:\d{1,3}(?:,\d{3})+|\d{3,}))/);
        if(m){const n=Number(m[1].replace(/,/g,''));if(Number.isFinite(n)&&n>=100&&!(n>=1900&&n<=2100))return n;}
        from=idx+label.length;
      }
    }
    return null;
  }
  function normalizeNumericToken(token){
    let t=String(token||'').replace(/[￥¥\s\u3000]/g,'');
    // OCR often turns comma grouping into periods (19.132.057) or inserts
    // spaces around separators (19, 132, 057). Treat only 3-digit grouping
    // separators as thousands separators; do not turn ordinary decimals into yen.
    if(/^[-+]?\d{1,3}(?:[,.]\d{3})+$/.test(t))t=t.replace(/[,.]/g,'');
    else if(/^[-+]?\d{1,3}(?:\d{3})+$/.test(t))t=t.replace(/\s/g,'');
    else t=t.replace(/,/g,'');
    return /^[-+]?\d{3,}$/.test(t)?Number(t):null;
  }
  function extractNumericTokens(s){
    const src=String(s||'');
    const out=[];
    const re=/(?<!\d)([-+]?\d{1,3}(?:(?:[,.]\s*)\d{3})+|[-+]?\d{3,})(?!\d)/g;
    for(const m of src.matchAll(re)){
      const n=normalizeNumericToken(m[1]);
      if(Number.isFinite(n)&&n>=100&&n<1000000000)out.push({n,index:m.index,text:m[1]});
    }
    return out;
  }
  function extractExactYenAfterLabel(textOrPdf, labels){
    const raw=typeof textOrPdf==='string'?textOrPdf:(textOrPdf?.text||'');
    const norm=(v)=>String(v||'').replace(/[ \t\r\u3000()（）]/g,'').replace(/−/g,'-').toLowerCase();
    const rawLines=String(raw).replace(/\r/g,'').split(/\n+/);
    for(const label of (labels||[])){
      const l=norm(label); if(!l)continue; let sawLabel=false;
      for(const rawLine of rawLines){
        const line=norm(rawLine); const idx=line.indexOf(l); if(idx<0)continue; sawLabel=true;
        // Map the whitespace-stripped label end back to the original line so
        // thousands separators/spaces in OCR numbers remain intact.
        let rawPos=0,normPos=0;
        while(rawPos<rawLine.length && normPos<idx+l.length){
          const ch=rawLine[rawPos++]; if(/[ \t\r\u3000()（）]/.test(ch))continue; normPos++;
        }
        const after=rawLine.slice(rawPos);
        for(const v of extractNumericTokens(after)){if(v.n>=1900&&v.n<=2100)continue;return v.n;}
        const textTail=after.replace(/[0-9, .\-]/g,'').trim();
        const li=rawLines.indexOf(rawLine);
        // A payroll form often places the value on the next line while another
        // table label sits to the right of the field label. Accept that next
        // line only when it actually contains a number; do not scan two or
        // more lines here, which could jump into the next table row.
        const nextLine=rawLines[li+1]||'';
        const nextVals=extractNumericTokens(nextLine);
        if(nextVals.length && (textTail.length<=80 || !/[A-Za-z]{3,}/.test(textTail))){
          for(const v of nextVals){if(v.n>=1900&&v.n<=2100)continue;return v.n;}
        }
      }
      if(sawLabel)continue;
      const source=String(raw).replace(/\r/g,''); let from=0;
      while(true){
        const compact=norm(source.slice(from)); const pos=compact.indexOf(l); if(pos<0)break;
        // Last-resort fallback is deliberately narrow; use the raw source after
        // the matched compact prefix and never accept a year token.
        const approx=source.slice(from+pos+l.length,from+pos+l.length+180);
        for(const v of extractNumericTokens(approx)){if(v.n>=1900&&v.n<=2100)continue;return v.n;}
        from+=pos+l.length;
      }
    }
    return null;
  }
  function extractOcrSameLineNumber(textOrPdf, labels){
    const raw=typeof textOrPdf==='string'?textOrPdf:(textOrPdf?.text||'');
    const norm=v=>String(v||'').replace(/[ \t\r\u3000()（）]/g,'').replace(/−/g,'-').toLowerCase();
    for(const line of String(raw).replace(/\r/g,'').split(/\n+/)){
      const nl=norm(line);
      for(const label of labels||[]){
        const l=norm(label); const idx=nl.indexOf(l); if(idx<0)continue;
        // Only accept a numeric token on the same OCR line. This deliberately
        // avoids the header occurrence "Taxable amount from January".
        const tail=nl.slice(idx+l.length);
        for(const v of extractNumericTokens(tail)){if(v.n>=1900&&v.n<=2100)continue;return v.n;}
      }
    }
    return null;
  }
  function extractNearbyNumberAfterLabel(textOrPdf, labels, maxLines=8){
    const raw=typeof textOrPdf==='string'?textOrPdf:(textOrPdf?.text||'');
    const lines=String(raw).replace(/\r/g,'').split(/\n+/);
    const norm=v=>String(v||'').replace(/[ \t\r\u3000()（）]/g,'').toLowerCase();
    for(let i=0;i<lines.length;i++){
      const nl=norm(lines[i]);
      for(const label of labels||[]){const l=norm(label);const idx=nl.indexOf(l);if(idx<0)continue;
        const same=extractNumericTokens(lines[i].slice(Math.min(lines[i].length,idx)));
        if(same.length)return same[0].n;
        for(let j=i+1;j<=Math.min(lines.length-1,i+maxLines);j++){const vals=extractNumericTokens(lines[j]);if(vals.length)return vals[0].n;}
      }
    }
    return null;
  }
  function findArithmeticTriple(values,relation){
    const nums=[...new Set((values||[]).map(v=>Number(v)).filter(v=>Number.isFinite(v)&&v>=100))];
    for(const a of nums)for(const b of nums){if(a===b)continue;for(const c of nums){if(c===a||c===b)continue;if(relation(a,b,c))return {a,b,c}}}
    return null;
  }
  function allOcrNumbers(textOrPdf){
    const raw=typeof textOrPdf==='string'?textOrPdf:(textOrPdf?.text||'');
    return extractNumericTokens(raw).map(x=>x.n).filter(n=>n<1000000000&&!(n>=1900&&n<=2100));
  }
  function ocrWordNumbers(textOrPdf){
    const words=Array.isArray(textOrPdf?.ocrWords)?textOrPdf.ocrWords:[];
    const raw=[];
    for(const w of words){
      const text=String(w?.text||w?.str||'').trim(); if(!text)continue;
      const b=w.bbox||{}; const x=Number(b.x0??w.x??0),y=Number(b.y0??w.y??0),x1=Number(b.x1??(x+Number(w.width||0))),y1=Number(b.y1??(y+Number(w.height||0)));
      raw.push({text,x,y,x1,y1,conf:Number(w.confidence??w.conf??0)});
    }
    // Tesseract can split yen amounts into separate numeric words, e.g.
    // `5` + `550` + `000` for 5,550,000. Keep the original tokens and add
    // conservative same-row grouped candidates so a bonus amount is not lost.
    const out=[];
    for(const w of raw){
      const isNum=/^[-+]?\d[\d,.]*$/.test(w.text);
      if(!isNum)continue;
      const prev=out[out.length-1];
      if(prev&&Math.abs(prev.y-w.y)<=10&&w.x-prev.x1<=30&&/[,\.]$/.test(prev.text)){
        prev.text+=w.text;prev.x1=w.x1;prev.y1=Math.max(prev.y1,w.y1);prev.conf=Math.min(prev.conf||0,w.conf||0);
      }else{out.push({...w});}
    }
    const candidates=out.map(w=>({...w}));
    for(let i=0;i<out.length;i++){
      let text=out[i].text, x1=out[i].x1, conf=out[i].conf||0, last=out[i];
      const first=normalizeNumericToken(text);
      if(!Number.isFinite(first)||first<1||first>=1000000000||(first>=1900&&first<=2100))continue;
      for(let j=i+1;j<Math.min(out.length,i+4);j++){
        const w=out[j];
        if(Math.abs(w.y-out[i].y)>10||w.x-last.x1>35)break;
        const wt=w.text.replace(/[,.]/g,'');
        if(!/^\d{3}$/.test(wt))break;
        text+=wt; x1=w.x1; conf=Math.min(conf,w.conf||0); last=w;
        const n=normalizeNumericToken(text);
        if(Number.isFinite(n)&&n>=100000&&n<1000000000&&!(n>=1900&&n<=2100))candidates.push({...out[i],text,x1,conf,n});
      }
    }
    return candidates.map(w=>{const n=Number.isFinite(w.n)?w.n:normalizeNumericToken(w.text);return {...w,n}}).filter(w=>Number.isFinite(w.n)&&w.n>=100&&w.n<1000000000&&!(w.n>=1900&&w.n<=2100));
  }
  function ocrRegionNumbers(textOrPdf,region){
    const nums=ocrWordNumbers(textOrPdf); if(!nums.length)return [];
    const maxX=Number(textOrPdf.ocrWidth)||Math.max(...nums.map(x=>x.x1),1),maxY=Number(textOrPdf.ocrHeight)||Math.max(...nums.map(x=>x.y1),1);
    const x0=(region.x0??0)*maxX,x1=(region.x1??1)*maxX,y0=(region.y0??0)*maxY,y1=(region.y1??1)*maxY;
    return nums.filter(n=>n.x>=x0&&n.x1<=x1&&n.y>=y0&&n.y<=y1).sort((a,b)=>a.y-b.y||a.x-b.x);
  }
  function ocrPayrollFallback(textOrPdf,type){
    if(!textOrPdf?.ocrUsed||!Array.isArray(textOrPdf?.ocrWords)||!textOrPdf.ocrWords.length)return null;
    if(type==='salary'){
      const summary=ocrRegionNumbers(textOrPdf,{x0:.16,x1:.34,y0:.84,y1:1});
      const social=ocrRegionNumbers(textOrPdf,{x0:.36,x1:.47,y0:.24,y1:.46});
      const byY=[]; for(const n of social){let g=byY.find(v=>Math.abs(v.y-n.y)<12);if(!g){g={y:n.y,n:n.n};byY.push(g)}else if(String(n.n).length>=String(g.n).length)g.n=n.n;}
      const vals=byY.sort((a,b)=>a.y-b.y).map(x=>x.n);
      const svals=summary.sort((a,b)=>a.y-b.y).map(x=>x.n);
      const out={};
      // The Toyota slip has a stable bottom summary: non-taxable then taxable.
      const nonTax=svals.find(n=>n>=1000&&n<100000);
      const taxable=svals.find(n=>n>=100000&&n<2000000);
      if(nonTax!=null)out.nonTaxableTotal=nonTax;
      if(taxable!=null)out.taxableGross=taxable;
      if(taxable!=null&&nonTax!=null)out.grossTotal=taxable+nonTax;
      if(vals.length>=6){out.socialComponents={employmentInsurance:vals[0],healthInsurance:vals[1],healthInsuranceSpecial:vals[2],nursingCare:vals[3],childSupport:vals[4],pension:vals[5]};out.socialTotal=vals.reduce((a,v)=>a+v,0)}
      return out;
    }
    if(type==='withholding'){
      const top=ocrRegionNumbers(textOrPdf,{x0:.24,x1:.97,y0:.18,y1:.27});
      const topRows=[];for(const n of top){let g=topRows.find(v=>Math.abs(v.y-n.y)<18);if(!g){g={y:n.y,items:[n]}}else g.items.push(n);if(!topRows.includes(g))topRows.push(g)}
      const row=(topRows.sort((a,b)=>a.y-b.y)[0]?.items||[]).sort((a,b)=>a.x-b.x).map(x=>x.n);
      const sec=ocrRegionNumbers(textOrPdf,{x0:.10,x1:.70,y0:.34,y1:.40});
      const secRow=[];for(const n of sec){let g=secRow.find(v=>Math.abs(v.y-n.y)<18);if(!g)secRow.push({y:n.y,items:[n]});else g.items.push(n)}
      const sv=(secRow.sort((a,b)=>a.y-b.y)[0]?.items||[]).sort((a,b)=>a.x-b.x).map(x=>x.n);
      const lower=ocrRegionNumbers(textOrPdf,{x0:.68,x1:.98,y0:.57,y1:.66});
      const lowerRow=lower.sort((a,b)=>a.x-b.x).map(x=>x.n);
      const out={};
      if(row.length>=4){out.annualSalary=row[0];out.salaryIncomeAfterDeduction=row[1];out.deductionsTotal=row[2];out.incomeTax=row[3]}
      if(sv.length>=3){out.specialDependent=sv[0];out.social=sv[1];out.lifeInsuranceDeduction=sv[2]}
      const basics=ocrRegionNumbers(textOrPdf,{x0:.68,x1:.98,y0:.55,y1:.65});
      const basicVals=basics.sort((a,b)=>a.x-b.x).map(x=>x.n); if(basicVals.length>=2){out.basicDeduction=basicVals[0];out.incomeAdjustment=basicVals[basicVals.length-1]}
      return out;
    }
    return null;
  }
  function parseSalaryComponents(text){
    const s=cleanPdfText(typeof text==='string'?text:text?.text||'');
    // Structured summary fields are authoritative. Parse them by exact label,
    // not by visual-nearest-number heuristics: the slip contains many other
    // amounts (bank transfers, standard remuneration, deductions, etc.).
    let grossTotal=extractExactYenAfterLabel(text,['支給合計（A)','支給合計(A)','Total Payment']);
    let nonTaxableTotal=extractExactYenAfterLabel(text,['（内通勤補助費等非課税分)','(内通勤補助費等非課税分)','Non-taxable Amount','Non‑taxable Amount','Non-taxabl e Anount','Non‑taxabl e Anount','Non-taxable Anount']);
    let explicitTaxable=extractExactYenAfterLabel(text,['課税対象額','Taxable Amount']);
    if(text&&typeof text==='object'&&text.ocrUsed)explicitTaxable=extractOcrSameLineNumber(text,['Taxable Anount','Taxable Amount'])??explicitTaxable;
    // OCR can drop the labels but still recognize all three summary numbers.
    // Recover them only when an exact arithmetic relation proves the values.
    const nums=allOcrNumbers(text);
    if(nonTaxableTotal==null){
      const pair=findArithmeticTriple(nums,(g,t,n)=>g>t&&g-t===n);
      if(pair)nonTaxableTotal=pair.c;
    }
    if(explicitTaxable==null && grossTotal!=null && nonTaxableTotal!=null)explicitTaxable=grossTotal-nonTaxableTotal;
    if(grossTotal==null && explicitTaxable!=null && nonTaxableTotal!=null)grossTotal=explicitTaxable+nonTaxableTotal;
    if(explicitTaxable==null && grossTotal!=null && nonTaxableTotal!=null)explicitTaxable=grossTotal-nonTaxableTotal;
    const derivedTaxable=(grossTotal!=null&&nonTaxableTotal!=null&&grossTotal>=nonTaxableTotal)?grossTotal-nonTaxableTotal:null;
    const taxableBase=derivedTaxable!=null?derivedTaxable:(explicitTaxable!=null?explicitTaxable:null);
    const socialLabels={
      employmentInsurance:['雇用保険料'],
      healthInsurance:['健康保険料（基本）','健康保険料 (基本)'],
      healthInsuranceSpecial:['健康保険料（特定）','健康保険料 (特定)'],
      nursingCare:['介護保険料'],
      childSupport:['子ども・子育て支援金','子ども 子育て支援金','子ども子育て支援金'],
      pension:['年金保険料','厚生年金保険料']
    };
    const socialComponents={};
    for(const [k,labels] of Object.entries(socialLabels)) socialComponents[k]=extractExactYenAfterLabel(text,labels);
    const socialValues=Object.values(socialComponents);
    const socialTotal=socialValues.every(v=>Number.isFinite(v))?socialValues.reduce((a,v)=>a+v,0):null;
    const grossComponents=[];
    const base=extractExactYenAfterLabel(text,['基準賃金等']);
    const commuting=extractExactYenAfterLabel(text,['通勤費補助']);
    const stockSubsidy=extractExactYenAfterLabel(text,['持株会補助手当']);
    if(base!=null)grossComponents.push({label:'基準賃金等',amount:base,taxTreatment:'taxable',source:'explicit'});
    if(commuting!=null){
      const nonTaxable=nonTaxableTotal!=null?Math.min(commuting,nonTaxableTotal):null;
      const taxable=nonTaxable!=null?Math.max(0,commuting-nonTaxable):null;
      grossComponents.push({label:'通勤費補助',amount:commuting,taxTreatment:taxable!=null?'mixed':'unknown',taxableAmount:taxable,nonTaxableAmount:nonTaxable,source:'explicit'});
    }
    if(stockSubsidy!=null)grossComponents.push({label:'持株会補助手当',amount:stockSubsidy,taxTreatment:'taxable',source:'explicit'});
    const unknown=[];
    if(grossTotal==null)unknown.push('支給合計');
    if(nonTaxableTotal==null)unknown.push('非課税分');
    if(taxableBase==null)unknown.push('課税対象額');
    if(socialTotal==null)unknown.push('社会保険料');
    const arithmeticOk=derivedTaxable!=null&&explicitTaxable!=null&&derivedTaxable===explicitTaxable;
    const coreOk=taxableBase!=null&&Number(taxableBase)>0;
    return {grossTotal,taxableGross:taxableBase,explicitTaxableGross:explicitTaxable,nonTaxableTotal,socialComponents,socialTotal,grossComponents,unknownComponents:unknown,arithmeticOk,coreOk,needsReview:!coreOk};
  }
  function parseSalaryPdf(text,name){
    const raw=typeof text==='string'?text:(text?.text||'');
    // For monthly payroll, the filename is authoritative. The PDF body can
    // contain cumulative phrases such as 2026年1月〜今回支払給与分, which
    // must not turn every monthly slip into January.
    const fd=filenameDateFallback(name);
    const bodyDate=extractDateParts(raw,name);
    const d={year:fd.year??bodyDate.year,month:fd.month??bodyDate.month};
    let c=parseSalaryComponents(text);
    if(text&&typeof text==='object'&&text.taxableGrossRecovered!=null&&c.taxableGross==null)c={...c,taxableGross:Number(text.taxableGrossRecovered)};
    // If OCR was used only for the missing field, combine the best values from
    // the normal PDF parser and the OCR parser.
    if(text&&typeof text==='object'&&text.ocrText){
      const o=parseSalaryComponents({text:text.ocrText,pages:[]});
      const f=ocrPayrollFallback(text,'salary')||{};
      // Prefer exact PDF text values over OCR. OCR is only a recovery path for
      // fields that the PDF text layer did not yield; otherwise a noisy OCR pass
      // could overwrite a correct taxable amount and make a valid salary fail.
      c={...c,
        taxableGross:c.taxableGross??o.taxableGross??f.taxableGross,
        grossTotal:c.grossTotal??o.grossTotal??f.grossTotal,
        nonTaxableTotal:c.nonTaxableTotal??o.nonTaxableTotal??f.nonTaxableTotal,
        socialTotal:c.socialTotal??o.socialTotal??f.socialTotal,
        socialComponents:(c.socialComponents&&Object.values(c.socialComponents).some(v=>Number.isFinite(v)))?c.socialComponents:(o.socialComponents&&Object.values(o.socialComponents).some(v=>Number.isFinite(v)))?o.socialComponents:(f.socialComponents??c.socialComponents)
      };
      if(!c.components?.length&&o.grossComponents?.length)c={...c,grossComponents:o.grossComponents};
      if(c.taxableGross!=null&&c.nonTaxableTotal!=null&&c.grossTotal==null)c.grossTotal=c.taxableGross+c.nonTaxableTotal;
      const derived=(c.grossTotal!=null&&c.nonTaxableTotal!=null)?c.grossTotal-c.nonTaxableTotal:null;
      const socialOk=Object.values(c.socialComponents||{}).length===6&&Object.values(c.socialComponents||{}).every(v=>Number.isFinite(v));
      c={...c,unknownComponents:[...(c.grossTotal==null?['支給合計']:[]),...(c.nonTaxableTotal==null?['非課税分']:[]),...(c.taxableGross==null?['課税対象額']:[]),...(c.socialTotal==null?['社会保険料']:[])],arithmeticOk:derived!=null&&c.taxableGross===derived&&socialOk,coreOk:Number(c.taxableGross)>0,needsReview:!(Number(c.taxableGross)>0)};
    }
    const taxableGross=Number.isFinite(c.taxableGross)&&c.taxableGross>0?c.taxableGross:null;
    const grossTotal=Number.isFinite(c.grossTotal)&&c.grossTotal>0?c.grossTotal:null;
    return {year:d.year,month:d.month,gross:taxableGross,taxableGross,grossTotal,nonTaxableTotal:c.nonTaxableTotal,social:c.socialTotal,socialComponents:c.socialComponents,components:c.grossComponents,unknownComponents:c.unknownComponents,source:'google-drive',status:'actual',document:name,needsReview:!!c.needsReview};
  }
  function filenameDateFallback(name){
    const n=String(name||'');
    let m=n.match(/(20\d{2})[-_](0[1-9]|1[0-2])(?:[-_]\d{1,2})?/);
    if(m)return {year:Number(m[1]),month:Number(m[2])};
    m=n.match(/(20\d{2})(0[1-9]|1[0-2])(?![\d,])/);
    return m?{year:Number(m[1]),month:Number(m[2])}:{year:null,month:null};
  }
  function mergeDateFallback(parsed,name){
    const f=filenameDateFallback(name);
    return {year:parsed.year??f.year,month:parsed.month??f.month};
  }
  function extractStandardBonusHealth(textOrPdf){
    const layout=textOrPdf?.pages;
    if(Array.isArray(layout)){const n=extractLabeledNumber(textOrPdf,['健康保険/介護保険']);if(n!=null)return n;}
    const s=String(typeof textOrPdf==='string'?textOrPdf:textOrPdf?.text||'');
    const m=s.match(/健康保険[／/]介護保険[\s\S]{0,180}?([0-9][0-9,]{2,})/i); return m?Number(m[1].replace(/,/g,'')):null;
  }
  function extractStandardBonusPension(textOrPdf){
    const layout=textOrPdf?.pages;
    if(Array.isArray(layout)){const n=extractLabeledNumber(textOrPdf,['厚生年金保険（150万/回）','厚生年金保険 (150万/回)']);if(n!=null)return n;}
    const s=String(typeof textOrPdf==='string'?textOrPdf:textOrPdf?.text||'');
    const m=s.match(/厚生年金保険\s*[（(]150万\/回[）)][\s\S]{0,500}Welfare Pension Insurance/i); if(!m)return null; const nums=(m[0].match(/\d[\d,]*/g)||[]).map(v=>Number(v.replace(/,/g,''))).filter(v=>v>=100); return nums.length?nums[nums.length-1]:null;
  }
  function extractNthAmountAfterLabel(textOrPdf, labels, ordinal=1){
    const raw=typeof textOrPdf==='string'?textOrPdf:(textOrPdf?.text||'');
    const normalize=v=>String(v||'').replace(/[ \t\r\u3000()（）]/g,'').replace(/−/g,'-');
    const source=normalize(raw);
    for(const label of (labels||[])){
      const l=normalize(label); let from=0;
      while(true){
        const i=source.indexOf(l,from); if(i<0)break;
        const tail=source.slice(i+l.length,i+l.length+120);
        const vals=[];
        for(const m of tail.matchAll(/((?:\d{1,3}(?:,\d{3})+|\d{3,}))(?![\d,])/g)){
          const n=Number(m[1].replace(/,/g,''));
          if(Number.isFinite(n)&&n>=100&&n<1000000000&&(n<1900||n>2100))vals.push(n);
          if(vals.length>=ordinal)return vals[ordinal-1];
        }
        from=i+l.length;
      }
    }
    return null;
  }
  function extractThousandAfterLabel(textOrPdf, labels){
    const raw=typeof textOrPdf==='string'?textOrPdf:(textOrPdf?.text||'');
    const normalize=v=>String(v||'').replace(/[ \t\r\u3000()（）]/g,'').replace(/−/g,'-');
    const source=normalize(raw);
    for(const label of (labels||[])){
      const l=normalize(label); let from=0;
      while(true){
        const i=source.indexOf(l,from); if(i<0)break;
        const tail=source.slice(i+l.length,i+l.length+300);
        for(const m of tail.matchAll(/((?:\d{1,3}(?:,\d{3})+|\d{3,}))(?![\d,])/g)){
          const n=Number(m[1].replace(/,/g,''));
          if(n>=100&&n<=10000)return n;
        }
        from=i+l.length;
      }
    }
    return null;
  }
  function bonusSeason(month){
    const m=Number(month)||0;
    // Toyotaの年2回賞与を前提に、夏（5〜9月）・冬（10〜2月）の2枠で管理。
    // 代表月は夏=6月、冬=12月だが、支給月そのものはPDFから保持する。
    if(m>=5&&m<=9)return 'summer';
    if(m>=10&&m<=12)return 'winter';
    if(m>=1&&m<=2)return 'winter';
    return '';
  }
  function parseBonusPdf(text,name){
    const raw=typeof text==='string'?text:(text?.text||''); const d=extractDateParts(raw,name);
    let amount=extractExactYenAfterLabel(text,['支給合計（A)','支給合計(A)','支給総額','総支給額','賞与額','Bonus Amount','Total Payment']);
    // Only use a bare 「支給額」 label as a fallback, and never take
    // 「差引支給額」 (net pay) as the bonus gross amount.
    if(amount==null){
      const lines=String(typeof text==='string'?text:text?.text||'').replace(/\r/g,'').split(/\n+/);
      for(const line of lines){
        if(/差引|控除|合計/.test(line))continue;
        if(/支給額/.test(line)){const vals=extractNumericTokens(line);if(vals.length){amount=vals[0].n;break}}
      }
    }
    if(amount==null){const candidates=allOcrNumbers(text).filter(n=>n>=100000&&n<20000000).sort((a,b)=>b-a);if(candidates.length)amount=candidates[0];}
    const taxableGross=extractExactYenAfterLabel(text,['課税対象額','Taxable Amount','Taxable Bonus']) ?? amount;
    const socialLabels={employmentInsurance:['雇用保険料'],healthInsurance:['健康保険料（基本）','健康保険料 (基本)'],healthInsuranceSpecial:['健康保険料（特定）','健康保険料 (特定)'],nursingCare:['介護保険料'],childSupport:['子ども・子育て支援金','子ども 子育て支援金','子ども子育て支援金'],pension:['年金保険料','厚生年金保険料']};
    const socialComponents={}; for(const [k,labels] of Object.entries(socialLabels))socialComponents[k]=extractExactYenAfterLabel(text,labels);
    const nums=allOcrNumbers(text);
    // OCR sometimes loses every summary label. Recover the bonus amount,
    // deduction and net only from the identity amount = deduction + net.
    let deduction=extractExactYenAfterLabel(text,['控除合計（B)','控除合計(B)','Total Deduction']);
    const labelNet=extractExactYenAfterLabel(text,['差引支給額（A−B)','差引支給額(A−B)','Net Payment Amount','Net Paynent Amount','Net Paynent Anount']);
    const transferNet=extractNearbyNumberAfterLabel(text,['振込額(円)','振込額（円）','Amount(JPY)','Amount ( JPY)','Anount ( JPY)'],8);
    let net=transferNet??labelNet;
    if(amount==null||deduction==null||net==null){
      const tris=[]; const uniq=[...new Set(nums)];
      for(const a of uniq)for(const b of uniq)for(const c of uniq){if(a>b&&a>c&&a-b===c)tris.push({amount:a,deduction:b,net:c});}
      // If a transfer/net value is known, select the identity that matches it.
      // Otherwise prefer the larger of the two remainder terms as deduction;
      // this avoids swapping deduction and take-home in symmetric OCR output.
      const tri=(net!=null?tris.find(x=>x.net===net):null)||tris.sort((x,y)=>y.deduction-x.deduction)[0];
      if(tri){amount=amount??tri.amount;deduction=deduction??tri.deduction;if(net==null||net===amount||net!==tri.net)net=tri.net;}
    }
    const socialValues=Object.values(socialComponents); const socialKnown=socialValues.filter(v=>Number.isFinite(v)); const social=socialKnown.length?socialKnown.reduce((a,v)=>a+v,0):null;
    const standardHealth=extractThousandAfterLabel(text,['健康保険/介護保険','健康保険／介護保険']);
    const standardPension=extractThousandAfterLabel(text,['厚生年金保険（150万/回）','厚生年金保険 (150万/回)','厚生年金保険（150万／回）']);
    const derivedNet=(amount!=null&&deduction!=null)?amount-deduction:null;
    const netConflict=derivedNet!=null && ((transferNet!=null && transferNet!==derivedNet) || (transferNet==null && labelNet!=null && labelNet!==derivedNet));
    if(derivedNet!=null)net=derivedNet;
    const finalNet=derivedNet!=null?derivedNet:net;
    const arithmeticOk=amount!=null&&deduction!=null&&derivedNet>=0&&!netConflict;
    const date=d.year&&d.month?`${d.year}-${String(d.month).padStart(2,'0')}`:'';
    const coreOk=!!date&&Number(amount)>0; return {year:d.year,month:d.month,date,season:bonusSeason(d.month),amount,taxableGross,social,socialComponents,standardBonusHealth:standardHealth!=null?standardHealth*1000:null,standardBonusPension:standardPension!=null?standardPension*1000:null,deductionTotal:deduction,netPayment:finalNet,explicitNetPayment:net,source:'google-drive',status:'actual',document:name,arithmeticOk,coreOk,needsReview:!coreOk};
  }
  function extractLabeledNumberByLayout(textOrPdf, label){
    const pages=textOrPdf?.pages; if(!Array.isArray(pages))return null;
    const norm=v=>String(v||'').replace(/[\u3000\s()（）]/g,'');
    const wanted=norm(label); if(!wanted)return null;
    for(const page of pages){
      const items=(page||[]).filter(it=>String(it.str||'').trim()).map(it=>({...it,str:String(it.str||'').trim()}));
      const nums=items.map(it=>({...it,n:Number(String(it.str).replace(/[￥¥,]/g,''))})).filter(it=>Number.isFinite(it.n)&&it.n>=1000&&it.n<1000000000);
      for(let i=0;i<items.length;i++){
        const it=items[i];
        if(!norm(it.str).includes(wanted))continue;
        const lx=Number(it.x||0)+Number(it.width||0)/2, ly=Number(it.y||0);
        const preferRight=/調整控除額|基礎控除の額/.test(wanted);
        const candidates=nums.filter(n=>{
          const nx=n.x+n.width/2, ny=n.y;
          const dx=Math.abs(nx-lx), dy=Math.abs(ny-ly);
          return dx<=85 && dy>=0 && dy<=55 && (!preferRight || nx>=lx-2);
        }).sort((a,b)=>{
          const sa=Math.abs((a.x+a.width/2)-lx)+Math.abs(a.y-ly)*2;
          const sb=Math.abs((b.x+b.width/2)-lx)+Math.abs(b.y-ly)*2;
          return sa-sb;
        });
        if(candidates.length)return candidates[0].n;
      }
    }
    return null;
  }
  function parseWithholdingPdf(text,name){
    const raw=typeof text==='string'?text:(text?.text||'');
    const reiwa=String(raw).match(/令\s*和\s*(\d{1,2})\s*年\s*分/);
    const fd=filenameDateFallback(name); const d=extractDateParts(raw,name);
    const year=reiwa?2018+Number(reiwa[1]):(fd.year??d.year);
    const lines=String(raw).split(/\n+/);
    const pick=(label,aliases=[])=>{const vals=[label,...aliases];for(const v of vals){const n=extractExactYenAfterLabel(text,[v]);if(n!=null)return n}return null};
    let annualSalary=pick('支払金額')??pick('給与・賞与');
    let salaryIncomeAfterDeduction=pick('給与所得控除後の金額');
    let deductionsTotal=pick('所得控除の額の合計額');
    let incomeTax=pick('源泉徴収税額');
    let top=[];
    for(const line of lines){
      const row=extractNumericTokens(line).map(x=>x.n).filter(n=>n>=100000);
      if(row.length>=4){top=row.slice(0,4);break;}
    }
    if(top.length<4)top=allOcrNumbers(raw).filter(n=>n>=1000000).slice(0,4);
    if(top.length>=4){annualSalary=annualSalary??top[0];salaryIncomeAfterDeduction=salaryIncomeAfterDeduction??top[1];deductionsTotal=deductionsTotal??top[2];incomeTax=incomeTax??top[3];}
    const secondaryLine=lines.findIndex(x=>x.includes('特定親族特別控除'));
    let specialRow=null,socialRow=null,lifeRow=null;
    if(secondaryLine>=0){
      const vals=[];
      for(let i=secondaryLine+1;i<=Math.min(lines.length-1,secondaryLine+15);i++){
        for(const v of extractNumericTokens(lines[i]).map(x=>x.n)){
          if(v>=100&&v<1000000000&&!(v>=1900&&v<=2100))vals.push(v);
        }
      }
      if(vals.length>=3){specialRow=vals[0];socialRow=vals[1];lifeRow=vals[2];}
    }
    let specialDependent=specialRow??pick('特定親族特別控除の額');
    let social=socialRow??pick('社会保険料等の金額');
    let lifeInsuranceDeduction=lifeRow??pick('生命保険料の控除額');
    const earthquakeInsuranceDeduction=extractOcrSameLineNumber(text,['地震保険料の控除額']);
    const housingLoanDeduction=extractOcrSameLineNumber(text,['住宅借入金等特別控除の額']);
    let basicDeduction=pick('基礎控除の額');
    let incomeAdjustment=null;
    const basicIdx=lines.findIndex(x=>x.includes('基礎控除の額'));
    const adjIdx=lines.findIndex(x=>x.includes('調整控除額'));
    if(basicDeduction==null&&basicIdx>=0){for(let i=basicIdx+1;i<=Math.min(basicIdx+4,lines.length-1);i++){const v=extractNumericTokens(lines[i]).map(x=>x.n).find(n=>n>=10000&&n<1000000);if(v!=null){basicDeduction=v;break}}}
    if(incomeAdjustment==null&&adjIdx>=0){const vals=[];for(let i=adjIdx+1;i<=Math.min(adjIdx+6,lines.length-1);i++)for(const v of extractNumericTokens(lines[i]).map(x=>x.n).filter(n=>n>=10000&&n<1000000))vals.push(v);const preferred=vals.find(v=>basicDeduction==null||v!==basicDeduction);if(preferred!=null)incomeAdjustment=preferred;}
    let detailIdx=lines.findIndex(x=>String(x).replace(/\s/g,'').includes('(摘要)'));
    let detailVals=[];
    if(detailIdx>=0){for(let i=detailIdx+1;i<=Math.min(lines.length-1,detailIdx+45);i++)detailVals.push(...extractNumericTokens(lines[i]).map(x=>x.n).filter(n=>n>=10000&&n<1000000));}
    const newLifeInsurance=detailVals[0]??pick('新生命保険料の金額');
    const oldLifeInsurance=detailVals[1]??pick('旧生命保険料の金額');
    const nursingInsurance=detailVals[2]??pick('介護医療保険料の金額');
    const newPension=pick('新個人年金保険料の金額');
    const oldPension=detailVals[3]??pick('旧個人年金保険料の金額');
    if(text&&typeof text==='object'&&text.ocrWords?.length){
      const f=ocrPayrollFallback(text,'withholding')||{};
      annualSalary=f.annualSalary??annualSalary;
      salaryIncomeAfterDeduction=f.salaryIncomeAfterDeduction??salaryIncomeAfterDeduction;
      deductionsTotal=f.deductionsTotal??deductionsTotal;
      incomeTax=f.incomeTax??incomeTax;
      social=f.social??social;
      lifeInsuranceDeduction=f.lifeInsuranceDeduction??lifeInsuranceDeduction;
      specialDependent=f.specialDependent??specialDependent;
      basicDeduction=f.basicDeduction??basicDeduction;
      // OCR can read the 580,000 field as just "580" when the trailing
      // zeros are visually merged with the neighboring cell. In a yen-valued
      // basic-deduction field, a three-digit OCR result is incomplete.
      if(Number.isFinite(basicDeduction)&&basicDeduction>=100&&basicDeduction<1000)basicDeduction*=1000;
      incomeAdjustment=f.incomeAdjustment??incomeAdjustment;
    }
    const required=[annualSalary,salaryIncomeAfterDeduction,deductionsTotal,incomeTax,social];
    const fieldsPresent=required.every(Number.isFinite);
    const relationsOk=fieldsPresent&&annualSalary>salaryIncomeAfterDeduction&&salaryIncomeAfterDeduction>0&&deductionsTotal>=social&&incomeTax>=0&&incomeTax<=annualSalary;
    const arithmeticOk=fieldsPresent&&relationsOk;
    return {year,annualSalary,salaryIncomeAfterDeduction,deductionsTotal,social,incomeTax,lifeInsuranceDeduction,earthquakeInsuranceDeduction,housingLoanDeduction,specialDependent,basicDeduction,incomeAdjustment,newLifeInsurance,oldLifeInsurance,nursingInsurance,newPension,oldPension,document:name,source:'google-drive',status:'actual',arithmeticOk,needsReview:!arithmeticOk};
  }
  function uniquePush(arr,item,key){const k=key(item);if(!arr.some(x=>key(x)===k))arr.push(item);}
  function recordHistory(state,item){
    state.importHistory=Array.isArray(state.importHistory)?state.importHistory:[];
    const same=x=>x&&item&&x.name===item.name&&x.type===item.type&&Number(x.year||0)===Number(item.year||0)&&Number(x.month||0)===Number(item.month||0);
    state.importHistory=state.importHistory.filter(x=>!same(x));
    state.importHistory.unshift(item);
  }
  function rebuildPriorSummary(state,priorYear){
    const ps=(state.priorSalaryRecords||[]); const pb=(state.priorBonusRecords||[]); const pso=(state.priorSocialRecords||[]);
    state.prior={salary:ps.reduce((a,x)=>a+(Number(x.taxableGross??x.gross)||0),0),bonus:pb.reduce((a,x)=>a+(Number(x.amount)||0),0),social:pso.reduce((a,x)=>a+(Number(x.amount)||0),0)+pb.reduce((a,x)=>a+(Number(x.social)||0),0),year:priorYear};
    // Keep only last year's values in the reference bucket.
    state.priorSalaryRecords=ps.filter(x=>Number(x.year)===priorYear); state.priorBonusRecords=pb.filter(x=>Number(x.year)===priorYear); state.priorSocialRecords=pso.filter(x=>Number(x.year)===priorYear);
  }
  function buildForecastFromPrior(state,targetYear,actualThrough){
    const priorYear=targetYear-1;
    const currentSalary=state.salaryRecords||[], currentSocial=state.socialRecords||[];
    const priorBonus=state.priorBonusRecords||[];
    // 給与・給与分社会保険料は前年を参照しない。4〜9月の当年実績平均を10〜12月へ横置きする。
    const avg=(rows,key)=>{
      const vals=rows.filter(x=>Number(x.month)>=4&&Number(x.month)<=Math.min(9,actualThrough)).map(x=>Number(x[key])||0).filter(v=>v>0);
      return vals.length?vals.reduce((a,v)=>a+v,0)/vals.length:0;
    };
    const salaryAvg=avg(currentSalary,'taxableGross');
    const socialAvg=avg(currentSocial,'amount');
    state.forecastSalary=Array.from({length:Math.max(0,12-actualThrough)},()=>Math.round(salaryAvg));
    state.forecastSocial=Array.from({length:Math.max(0,12-actualThrough)},()=>Math.round(socialAvg));

    // 賞与だけは前年同時期を参照。対象年にその季節の賞与が支給済みなら前年分は足さない。
    const currentBonus=state.bonusRecords||[];
    const season=m=>bonusSeason(Number(m));
    const bonusMonth=x=>Number(String(x.date||'').slice(5,7))||Number(x.month)||0;
    let forecastBonus=0;
    state.bonusSocialRecords=(state.bonusSocialRecords||[]).filter(x=>x.status!=='forecast');
    for(const s of ['summer','winter']){
      const currentSeason=currentBonus.filter(x=>Number(x.amount)>0&&season(bonusMonth(x))===s);
      if(currentSeason.length)continue;
      const priorSeason=priorBonus.filter(x=>season(bonusMonth(x))===s);
      forecastBonus+=priorSeason.reduce((a,x)=>a+(Number(x.amount)||0),0);
      priorSeason.forEach(x=>{if(x.social!=null)state.bonusSocialRecords.push({date:`${targetYear}-${String(bonusMonth(x)).padStart(2,'0')}`,month:bonusMonth(x),amount:Number(x.social)||0,components:x.socialComponents||{},standardBonusHealth:x.standardBonusHealth,standardBonusPension:x.standardBonusPension,source:'prior-year-reference',status:'forecast',document:x.document,note:`${priorYear}年${s==='summer'?'夏':'冬'}賞与の社会保険料を参考`,needsReview:false})});
    }
    state.forecastBonus=forecastBonus;
    state.forecastMethod={
      salary:`${targetYear}年4〜${Math.min(9,actualThrough)}月実績平均`,
      social:`${targetYear}年4〜${Math.min(9,actualThrough)}月実績平均`,
      bonus:`対象年の未支給シーズンは${priorYear}年の同シーズン賞与を参考`
    };
  }
  function upsertSalaryRecord(state,x,f,targetYear,result){
    // 登録の必須条件は「対象年・月・課税対象額」。
    // OCRで控除内訳などが欠けても、課税対象額まで読めていれば給与本体は登録する。
    if(!(Number(x.year)===Number(targetYear)&&Number(x.month)>=1&&Number(x.month)<=12&&Number(x.taxableGross)>0))return false;
    result.salaryParsed++; state.salaryRecords=state.salaryRecords||[];
    state.salaryRecords=state.salaryRecords.filter(r=>Number(r.month)!==x.month||r.source==='manual');
    state.salaryRecords.push({year:targetYear,month:x.month,gross:x.taxableGross,taxableGross:x.taxableGross,grossTotal:x.grossTotal,nonTaxableTotal:x.nonTaxableTotal,components:x.components||[],source:'google-drive',status:'actual',document:f.name,driveFileId:f.id,needsReview:x.needsReview});
    if(x.social!=null){state.socialRecords=state.socialRecords||[];state.socialRecords=state.socialRecords.filter(r=>Number(r.month)!==x.month||r.source==='manual');state.socialRecords.push({year:targetYear,month:x.month,amount:x.social,components:x.socialComponents||{},source:'google-drive',status:'actual',document:f.name,driveFileId:f.id,needsReview:false})}
    if(x.needsReview){result.review++;result.salaryReview++}result.added++;result.salaryImported++; return true;
  }
  function upsertBonusRecord(state,x,f,targetYear,result){
    // 賞与本体の必須条件は「対象年・支給日・総支給額・夏/冬」。
    // 控除内訳や算術検証がOCRで欠けても、賞与本体は登録する。
    if(!(x.date&&Number(x.amount)>0&&x.season))return false;
    if(Number(x.year)!==Number(targetYear))return false;
    state.bonusRecords=state.bonusRecords||[];
    const season=x.season||bonusSeason(x.month);
    state.bonusRecords=state.bonusRecords.filter(r=>{
      if(r.source==='manual')return true;
      const ry=Number(r.year||String(r.date||'').slice(0,4));
      const rs=r.season||bonusSeason(Number(String(r.date||'').slice(5,7))||r.month);
      return !(ry===Number(targetYear)&&rs&&season&&rs===season);
    });
    state.bonusRecords.push({...x,season,driveFileId:f.id});
    if(x.social!=null){
      state.bonusSocialRecords=state.bonusSocialRecords||[];
      state.bonusSocialRecords=state.bonusSocialRecords.filter(r=>{
        if(r.source==='manual')return true;
        const ry=Number(String(r.date||'').slice(0,4));
        const rs=r.season||bonusSeason(Number(String(r.date||'').slice(5,7))||r.month);
        return !(ry===Number(targetYear)&&rs&&season&&rs===season);
      });
      state.bonusSocialRecords.push({date:x.date,month:x.month,season,amount:x.social,components:x.socialComponents||{},standardBonusHealth:x.standardBonusHealth,standardBonusPension:x.standardBonusPension,source:'google-drive',status:'actual',document:f.name,driveFileId:f.id,needsReview:false});
    }
    result.added++;return true;
  }
  async function scanAndImport(state,onProgress,filesOverride){
    const targetYear=Number(state.importSettings?.targetYear||state.year||new Date().getFullYear()); const priorYear=targetYear-1; state.year=targetYear;
    const files=Array.isArray(filesOverride)?filesOverride:await listCandidateFiles(targetYear);
    const result={files:files.length,added:0,review:0,skipped:0,errors:[],salaryCandidates:files.filter(f=>f.candidateType==='salary').length,salaryImported:0,salaryReview:0,salaryParsed:0,salaryOcr:0,salaryRejected:0,candidates:files.map(f=>({name:f.name,type:f.candidateType,year:f.filenameYear}))}; state.importHistory=Array.isArray(state.importHistory)?state.importHistory:[]; state.importFileDetails=[];
    state.priorSalaryRecords=(state.priorSalaryRecords||[]).filter(x=>Number(x.year)===priorYear); state.priorBonusRecords=(state.priorBonusRecords||[]).filter(x=>Number(x.year)===priorYear); state.priorSocialRecords=(state.priorSocialRecords||[]).filter(x=>Number(x.year)===priorYear);
    state.salaryRecords=(state.salaryRecords||[]).filter(x=>x.source==='manual'||Number(x.year||targetYear)===targetYear);
    state.bonusRecords=(state.bonusRecords||[]).filter(x=>x.source==='manual'||Number(x.year||String(x.date||'').slice(0,4))===targetYear);
    for(const f of files){
      try{
        onProgress?.(`解析中: ${f.name}`); const buf=await downloadPdf(f.id); let pdf=await pdfText(buf); pdf=await ensurePdfText(buf,pdf,f.name); const text=pdf.text,detectedType=classifyPdfText(text,f.name),type=detectedType==='unknown' ? ({salary:'salary_slip',bonus:'bonus_slip',withholding:'withholding'}[f.candidateType]||detectedType) : detectedType; const detail={name:f.name,id:f.id,type:f.candidateType,filenameYear:f.filenameYear||null,detectedType:type,textChars:String(text||'').length,textItemCount:pdf.textItemCount||0,ocrUsed:!!pdf.ocrUsed,ocrConfidence:pdf.ocrConfidence||0,ocrError:pdf.ocrError||'',ocrWordCount:pdf.ocrWordCount||0,ocrValidated:!!pdf.ocrValidated,ocrAttempts:pdf.ocrAttempts||[],pageCount:pdf.pageCount||0,pageMeta:pdf.pageMeta||[],ocrWidth:pdf.ocrWidth||0,ocrHeight:pdf.ocrHeight||0,ocrImageBytes:pdf.imageBytes||0,ocrCornerNonWhite:pdf.cornerNonWhite||0,ocrCornerMean:pdf.cornerMean||0}; state.importFileDetails.push(detail);
        if(type==='salary_slip'){
          const x=parseSalaryPdf(pdf,f.name); Object.assign(detail,{year:x.year||null,month:x.month||null,gross:x.gross||0,taxableGross:x.taxableGross||0,grossTotal:x.grossTotal||0,nonTaxableTotal:x.nonTaxableTotal||0,social:x.social||0,components:x.components||{},socialComponents:x.socialComponents||{},needsReview:!!x.needsReview,registrationCore:!!(x.year&&x.month&&Number(x.taxableGross)>0)}); x.ocrUsed=!!pdf.ocrUsed; if(x.ocrUsed)result.salaryOcr++; x.ocrConfidence=pdf.ocrConfidence||0; x.textItemCount=pdf.textItemCount||0; x.textChars=String(pdf.text||'').length; x.ocrError=pdf.ocrError||''; const inScope=[targetYear,priorYear].includes(Number(x.year));
          if(!inScope){result.skipped++; recordHistory(state,{at:new Date().toISOString(),name:f.name,type:'salary',year:x.year||f.filenameYear||null,status:'対象外',reason:'対象年/前年ではない'});continue}
          if(upsertSalaryRecord(state,x,f,targetYear,result)){
            recordHistory(state,{at:new Date().toISOString(),name:f.name,type:'salary',year:x.year,month:x.month,status:'取り込み済み',taxableGross:x.taxableGross,grossTotal:x.grossTotal,social:x.social,needsReview:!!x.needsReview,ocrUsed:!!x.ocrUsed,ocrConfidence:x.ocrConfidence||0,textChars:x.textChars||0,textItemCount:x.textItemCount||0,ocrWordCount:pdf.ocrWordCount||0,ocrValidated:!!pdf.ocrValidated,ocrError:x.ocrError||''});
          } else if(x.year===priorYear&&x.month&&x.gross){uniquePush(state.priorSalaryRecords,{year:priorYear,month:x.month,gross:x.taxableGross,taxableGross:x.taxableGross,grossTotal:x.grossTotal,nonTaxableTotal:x.nonTaxableTotal,components:x.components||[],source:'google-drive',status:'prior',document:f.name,driveFileId:f.id,needsReview:x.needsReview},v=>`${v.year}-${v.month}-${v.document}`);if(x.social!=null)uniquePush(state.priorSocialRecords,{year:priorYear,month:x.month,amount:x.social,components:x.socialComponents||{},source:'google-drive',status:'prior',document:f.name,driveFileId:f.id},v=>`${v.year}-${v.month}-${v.document}`);result.added++;recordHistory(state,{at:new Date().toISOString(),name:f.name,type:'salary',year:x.year,month:x.month,status:'前年保存',taxableGross:x.taxableGross,grossTotal:x.grossTotal,social:x.social,needsReview:!!x.needsReview,ocrUsed:!!x.ocrUsed,ocrConfidence:x.ocrConfidence||0,textChars:x.textChars||0,textItemCount:x.textItemCount||0,ocrWordCount:pdf.ocrWordCount||0,ocrValidated:!!pdf.ocrValidated,ocrError:x.ocrError||''});}else {result.review++; if(f.candidateType==='salary'){result.salaryReview++;result.salaryRejected++;}recordHistory(state,{at:new Date().toISOString(),name:f.name,type:'salary',year:x.year||f.filenameYear||null,month:x.month||null,status:'確認待ち',taxableGross:x.taxableGross,grossTotal:x.grossTotal,social:x.social,needsReview:true,reason:`給与登録できませんでした：課税対象額=${x.taxableGross==null?'取得失敗':x.taxableGross}／支給合計=${x.grossTotal==null?'取得失敗':x.grossTotal}／非課税=${x.nonTaxableTotal==null?'取得失敗':x.nonTaxableTotal}／年月=${x.year||f.filenameYear||'不明'}-${x.month||'不明'}／OCR=${x.ocrUsed?'実行':'未実行'}${x.ocrError?`／OCRエラー=${x.ocrError}`:''}／文字数=${x.textChars||0}／文字項目=${x.textItemCount||0}`});}
        }else if(type==='bonus_slip'){
          const x=parseBonusPdf(pdf,f.name); Object.assign(detail,{year:x.year||null,month:x.month||null,date:x.date||null,amount:x.amount||0,social:x.social||0,socialComponents:x.socialComponents||{},needsReview:!!x.needsReview,registrationCore:!!(x.date&&Number(x.amount)>0&&x.season)}); if(![targetYear,priorYear].includes(Number(x.year))){result.skipped++;continue}
          if(!upsertBonusRecord(state,x,f,targetYear,result) && Number(x.year)===Number(priorYear) && x.date&&x.amount&&x.season){state.priorBonusRecords=state.priorBonusRecords||[];const season=x.season||bonusSeason(x.month);state.priorBonusRecords=state.priorBonusRecords.filter(v=>!(Number(v.year)===Number(priorYear)&&(v.season||bonusSeason(v.month))===season));state.priorBonusRecords.push({year:priorYear,date:x.date,month:x.month,season,amount:x.amount,social:x.social,socialComponents:x.socialComponents||{},standardBonusHealth:x.standardBonusHealth,standardBonusPension:x.standardBonusPension,source:'prior',status:'prior',document:f.name,driveFileId:f.id});result.added++;recordHistory(state,{at:new Date().toISOString(),name:f.name,type:'bonus',year:x.year||f.filenameYear||null,month:x.month||null,date:x.date||null,status:'取り込み済み',amount:x.amount||null,social:x.social||null,needsReview:false});}else if(!(x.date&&x.amount&&x.season)){result.review++;state.importHistory.unshift({at:new Date().toISOString(),name:f.name,type:'bonus',year:x.year||f.filenameYear||null,status:'確認待ち',amount:x.amount||null,social:x.social||null,needsReview:true,reason:x.date&&x.amount&&!x.season?'賞与月が夏（5〜9月）/冬（10〜2月）のどちらにも判定できませんでした':'賞与額または年月を取得できませんでした'});}
        }else if(type==='withholding'){
          const x=parseWithholdingPdf(pdf,f.name); Object.assign(detail,{year:x.year||null,annualSalary:x.annualSalary||0,salaryIncomeAfterDeduction:x.salaryIncomeAfterDeduction||0,deductionsTotal:x.deductionsTotal||0,social:x.social||0,incomeTax:x.incomeTax||0,lifeInsuranceDeduction:x.lifeInsuranceDeduction||0,earthquakeInsuranceDeduction:x.earthquakeInsuranceDeduction||0,housingLoanDeduction:x.housingLoanDeduction||0,specialDependent:x.specialDependent||0,basicDeduction:x.basicDeduction||0,incomeAdjustment:x.incomeAdjustment||0,newLifeInsurance:x.newLifeInsurance||0,oldLifeInsurance:x.oldLifeInsurance||0,nursingInsurance:x.nursingInsurance||0,newPension:x.newPension||0,oldPension:x.oldPension||0,needsReview:!!x.needsReview}); if(x.year&&![targetYear,priorYear].includes(Number(x.year))){result.skipped++;continue}
          state.sourceDocuments=state.sourceDocuments||[];const old=state.sourceDocuments.find(d=>d.file===f.name);const doc={file:f.name,type,status:'imported',source:'google-drive',driveFileId:f.id,note:`源泉徴収票を取得。${x.year===priorYear?'前年参考値として保持':'対象年の参考資料として保持'}。`,annualSalary:x.annualSalary||0,social:x.social||0,incomeTax:x.incomeTax||0,year:x.year||null};if(old)Object.assign(old,doc);else state.sourceDocuments.push(doc);
          if(x.year===priorYear){state.prior=state.prior||{salary:0,bonus:0,social:0};if(x.annualSalary)state.prior.salary=x.annualSalary;if(x.social)state.prior.social=x.social} result.review++;
        }else {result.skipped++;state.importHistory.unshift({at:new Date().toISOString(),name:f.name,type:type||f.candidateType||'other',year:f.filenameYear||null,status:'対象外'});}
      }catch(e){result.errors.push(`${f.name}: ${e.message}`);recordHistory(state,{at:new Date().toISOString(),name:f.name,type:f.candidateType||'other',year:f.filenameYear||null,status:'エラー',reason:e.message});}
    }
    rebuildPriorSummary(state,priorYear); buildForecastFromPrior(state,targetYear,Number(state.actualThrough||9)); state.importDiagnostics={at:new Date().toISOString(),targetYear,files:result.files,salaryCandidates:result.salaryCandidates,salaryImported:result.salaryImported,salaryParsed:result.salaryParsed,salaryOcr:result.salaryOcr,salaryRejected:result.salaryRejected,errors:result.errors.slice(),fileDetails:state.importFileDetails||[],runtimeReadout:runtimeDiagnostics.slice()}; state.importHistory=state.importHistory.filter(x=>{if(!String(x?.name||'').startsWith(TARGET_FILE_PREFIX))return true;const y=Number(x?.year||0);return !y||y===targetYear||y===priorYear}).slice(0,200); state.importSettings={...(state.importSettings||{}),targetYear,priorYear};
    return result;
  }
  return {CLIENT_KEY,getClientId,setClientId,ready,authorize,signOut,listCandidateFiles,scanAndImport,classifyPdfText,parseSalaryPdf,parseBonusPdf,parseWithholdingPdf,extractLabeledNumber,extractToyotaPayrollAmount,extractExactYenAfterLabel,upsertSalaryRecord,upsertBonusRecord,ensurePdfText,getRuntimeDiagnostics,clearRuntimeDiagnostics,getLastOcrImageDataUrl:()=>lastOcrImageDataUrl};
})();
if(typeof window!=='undefined')window.FurusatoGoogleDrive=FurusatoGoogleDrive;
if(typeof module!=='undefined')module.exports={FurusatoImport,FurusatoGoogleDrive};
