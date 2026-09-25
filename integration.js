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
  const RUNTIME_BUILD='2026-09-26-v43';
  const SCOPES='https://www.googleapis.com/auth/drive.readonly';
  let tokenClient=null, accessToken=null;
  let readyPromise=null;
  const runtimeDiagnostics=[];
  const DEBUG_LOG_KEY='furusatoDebugLog';
  const DEBUG_SESSION_KEY='furusatoDebugSession';
  const DEBUG_VERSION='20260926-debug2';
  const debugSessionId=(()=>{try{return localStorage.getItem(DEBUG_SESSION_KEY)||('dbg-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8))}catch{return 'dbg-runtime'}})();
  try{localStorage.setItem(DEBUG_SESSION_KEY,debugSessionId)}catch{}
  function safeDebugValue(v,max=12000){
    try{
      const s=typeof v==='string'?v:JSON.stringify(v);
      return String(s??'').length>max?String(s??'').slice(0,max)+'…[truncated]':String(s??'');
    }catch{return String(v??'')}
  }
  function debugLog(stage,data={}){
    const entry={debugVersion:DEBUG_VERSION,sessionId:debugSessionId,at:new Date().toISOString(),stage,...data};
    try{
      runtimeDiagnostics.push(entry);
      if(runtimeDiagnostics.length>500)runtimeDiagnostics.splice(0,runtimeDiagnostics.length-500);
      const existing=JSON.parse(localStorage.getItem(DEBUG_LOG_KEY)||'[]');
      existing.push(entry);
      const trimmed=existing.slice(-500);
      localStorage.setItem(DEBUG_LOG_KEY,JSON.stringify(trimmed));
    }catch{}
    return entry;
  }
  function getPersistedDebugLog(){try{return JSON.parse(localStorage.getItem(DEBUG_LOG_KEY)||'[]')}catch{return []}}
  function clearPersistedDebugLog(){try{localStorage.removeItem(DEBUG_LOG_KEY);localStorage.removeItem(DEBUG_SESSION_KEY)}catch{}}
  // Keep the latest rendered OCR PNG in memory so the Settings page can export it.
  // This must be declared in the same closure as ocrPageFromPdfDoc().
  let lastOcrImageDataUrl=null;
  function diag(entry){debugLog(entry.stage||'runtime',entry);}
  function getRuntimeDiagnostics(){return runtimeDiagnostics.slice()}
  function getPersistedDiagnostics(){return getPersistedDebugLog()}
  function clearRuntimeDiagnostics(){runtimeDiagnostics.length=0}
  function getClientId(){return localStorage.getItem(CLIENT_KEY)||''}
  function setClientId(v){const x=String(v||'').trim(); if(x)localStorage.setItem(CLIENT_KEY,x); else localStorage.removeItem(CLIENT_KEY); return x}
  function loadScript(src){return new Promise((resolve,reject)=>{const old=document.querySelector(`script[src="${src}"]`);if(old){old.dataset.loaded==='1'?resolve():old.addEventListener('load',resolve,{once:true});return}const s=document.createElement('script');s.src=src;s.async=true;s.defer=true;s.onload=()=>{s.dataset.loaded='1';resolve()};s.onerror=reject;document.head.appendChild(s)})}
  async function ready(){
    if(readyPromise)return readyPromise;
    readyPromise=(async()=>{await loadScript('https://accounts.google.com/gsi/client');await loadScript('https://apis.google.com/js/api.js');await new Promise((resolve,reject)=>{if(window.gapi?.client?.drive)return resolve();if(!window.gapi?.load)return reject(new Error('Google API client could not load'));window.gapi.load('client',{callback:resolve,ontimeout:()=>reject(new Error('Google API client load timeout')),timeout:10000})});await gapi.client.load('https://www.googleapis.com/discovery/v1/apis/drive/v3/rest');const id=getClientId();if(!id)throw new Error('Google Client ID未設定');tokenClient=google.accounts.oauth2.initTokenClient({client_id:id,scope:SCOPES,callback:()=>{}});return true})();return readyPromise
  }
  async function authorize(forceRefresh=false){await ready();return new Promise((resolve,reject)=>{tokenClient.callback=(resp)=>{if(resp?.error){reject(new Error(resp.error));return}accessToken=resp.access_token;gapi.client.setToken({access_token:accessToken});debugLog('auth:success',{forceRefresh:!!forceRefresh});resolve(accessToken)};debugLog('auth:request',{forceRefresh:!!forceRefresh,hadToken:!!accessToken});tokenClient.requestAccessToken({prompt:forceRefresh?'':(accessToken?'':'consent')})})}
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
    // A single import action is the database refresh: read every supported
    // calendar year from 2024 through the selected/current year.  The annual
    // result pages decide which year's records are used for calculation.
    const endYear=Math.max(currentYear,new Date().getFullYear());
    const years=[]; for(let y=2024;y<=endYear;y++)years.push(y);
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
  async function downloadPdf(fileId,retried401=false){
    debugLog('download:start',{fileId,retried401:!!retried401});
    if(!accessToken)await authorize();
    const url=`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
    const started=performance.now();
    const r=await fetch(url,{headers:{Authorization:`Bearer ${accessToken}`,Accept:'application/pdf,application/octet-stream;q=0.9,*/*;q=0.1'},cache:'no-store'});
    const contentType=r.headers.get('content-type')||'';
    const contentLength=r.headers.get('content-length')||'';
    if(r.status===401 && !retried401){
      diag({stage:'download401',fileId,status:r.status,contentType,contentLength,action:'reauthorize-and-retry'});
      debugLog('auth:expired',{fileId,status:401});
      accessToken=null; try{gapi.client.setToken(null)}catch{}
      await authorize(true);
      return downloadPdf(fileId,true);
    }
    if(!r.ok){diag({stage:'download',fileId,status:r.status,contentType,contentLength,error:`Drive download failed: ${r.status}`});throw new Error(`Drive download failed: ${r.status}`)}
    const buf=await r.arrayBuffer();
    debugLog('download:body',{fileId,status:r.status,contentType,contentLength,bytes:buf.byteLength});
    const bytes=new Uint8Array(buf);
    const head=Array.from(bytes.slice(0,16)).map(x=>x.toString(16).padStart(2,'0')).join(' ');
    const ascii=String.fromCharCode(...bytes.slice(0,16));
    const isPdf=ascii.startsWith('%PDF-');
    const meta={stage:'download',fileId,status:r.status,contentType,contentLength,bytes:bytes.byteLength,headHex:head,headAscii:ascii,isPdf,ms:Math.round(performance.now()-started),retried401:!!retried401};
    diag(meta);
    if(bytes.byteLength<100||!isPdf)throw new Error(`PDF取得内容が不正です: ${isPdf?'サイズ不足':'PDF署名なし'} / ${bytes.byteLength} bytes / ${contentType}`);
    return buf;
  }
  async function pdfText(arrayBuffer){
    debugLog('pdfText:start',{bytes:arrayBuffer?.byteLength||0});
    if(!window.pdfjsLib)await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
    const pdf=window.pdfjsLib||window.pdfjs;if(!pdf)throw new Error('PDF解析ライブラリを読み込めませんでした');
    if(pdf.GlobalWorkerOptions)pdf.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const bytes=arrayBuffer instanceof ArrayBuffer?new Uint8Array(arrayBuffer.slice(0)):new Uint8Array(arrayBuffer);
    // These Toyota PDFs are generated by an old JasperReports/iText stack and
    // declare Helvetica + HeiseiKakuGo-W5 without embedding the font files. On
    // iPhone/Safari, PDF.js can therefore draw the table lines but omit the
    // actual glyphs unless its CMaps/standard-font fallback paths are supplied.
    // Keep these options on BOTH open paths so text extraction and canvas OCR
    // see the same correctly rendered document.
    const PDFJS_BASE='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
    const pdfOpenOptions={
      cMapUrl:PDFJS_BASE+'cmaps/',
      cMapPacked:true,
      standardFontDataUrl:PDFJS_BASE+'standard_fonts/',
      useSystemFonts:true,
      disableFontFace:false
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
    if(itemCount===0){
      // Regression guard: Safari/iOS can return an empty text layer on the first
      // Blob/worker pass even though the same PDF has a valid text layer. Retry
      // from raw bytes with the worker disabled before falling back to OCR.
      debugLog('pdfText:retry',{reason:'zero-text-first-pass',firstPassTextItemCount:0,action:'reopen-data-disableWorker'});
      diag({stage:'pdfTextRetry',reason:'zero-text-first-pass',action:'reopen-data-disableWorker'});
      try{await doc.destroy()}catch{}
      const retry=await tryOpen({data:new Uint8Array(bytes),disableWorker:true});
      if(retry){
        doc=retry; text=''; pages.length=0; itemCount=0;
        for(let i=1;i<=doc.numPages;i++){
          const page=await doc.getPage(i);
          const c=await page.getTextContent({normalizeWhitespace:false,disableCombineTextItems:true});
          const items=(c.items||[]).filter(x=>String(x.str||'').trim()).map(x=>({str:String(x.str||''),x:Number(x.transform?.[4]||0),y:Number(x.transform?.[5]||0),width:Number(x.width||0),height:Number(x.height||0)}));
          itemCount+=items.length; pages.push(items);
          const lines=[]; for(const it of items){let g=lines.find(v=>Math.abs(v.y-it.y)<=3);if(!g){g={y:it.y,items:[]};lines.push(g)}g.items.push(it)}
          lines.sort((a,b)=>b.y-a.y); text+=lines.map(g=>g.items.slice().sort((a,b)=>a.x-b.x).map(x=>x.str).join(' ')).join('\n')+'\n';
        }
      } else {
        debugLog('pdfText:retryFailed',{reason:'retry-open-failed'});
        diag({stage:'pdfTextRetryFailed',reason:'retry-open-failed'});
      }
    }
    const pageMeta=pages.map((items,i)=>({page:i+1,items:items.length,textChars:items.reduce((n,x)=>n+String(x.str||'').length,0),sample:items.slice(0,12).map(x=>String(x.str||'')).join(' | ')}));
    diag({stage:'pdfText',pageCount:doc.numPages,textItemCount:itemCount,textChars:text.length,textSample:text.slice(0,1000),pageMeta:pageMeta.slice(0,8),cMapEnabled:true,extractionMode:'known-good-v4'});
    debugLog('pdfText:result',{pageCount:doc.numPages,textItemCount:itemCount,textChars:text.length,pageMeta:pageMeta.slice(0,20),extractionMode:'known-good-v4-retry'});
    return {text,pages,pageCount:doc.numPages,textItemCount:itemCount,pageMeta,ocrUsed:false,pdfDoc:doc};
  }
  async function ocrPageFromPdfDoc(doc,region=null,options={}){
    if(!doc)throw new Error('OCR用PDFドキュメントがありません');
    const pageNumber=Math.max(1,Math.min(Number(options.pageNumber||1),doc.numPages||1));
    const page=await doc.getPage(pageNumber); const scale=Number(options.scale||region?.scale||3.0); const full=page.getViewport({scale});
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
    lastOcrImageDataUrl=imageDataUrl;
    const rOcr=await window.Tesseract.recognize(imageDataUrl,lang,{tessedit_pageseg_mode:psm,preserve_interword_spaces:'1'});
    const data=rOcr?.data||{};
    const result={text:String(data.text||''),words:Array.isArray(data.words)?data.words:[],pages:[],pageCount:doc.numPages,pageNumber,textItemCount:0,ocrUsed:true,ocrConfidence:Number(data.confidence||0),ocrPsm:psm,ocrLang:lang,ocrWidth:cw,ocrHeight:ch,ocrRegion:!!region,imageBytes:imageDataUrl.length,cornerNonWhite:nonWhite,cornerMean:sample.length?sum/(sample.length/4):255,renderSampleWidth:statW,renderSampleHeight:statH,renderNonWhite:fullNonWhite,renderNonWhiteRatio:fullPixels?fullNonWhite/fullPixels:0,renderMean:fullPixels?fullSum/fullPixels:255,renderMin:fullMin,renderMax:fullMax};
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
    debugLog('ensurePdfText:start',{name,type,textChars:raw.length,textItemCount:Number(base.textItemCount||0),pageCount:Number(base.pageCount||0)});
    // One-character/empty text layers are not successful extraction. They must
    // go through the OCR fallback instead of being recorded as a readable PDF.
    const minChars=type==='withholding'?80:(type==='bonus'?100:120);
    let structuralOk=(base.textItemCount||0)>=8 && raw.length>=minChars;
    try{
      if(type==='salary'){const q=parseSalaryComponents(base);structuralOk=structuralOk&&q.grossTotal!=null&&q.taxableGross!=null&&q.socialTotal!=null&&!q.needsReview;}
      else if(type==='bonus'){const q=parseBonusPdf(base,name);structuralOk=structuralOk&&q.date&&q.amount!=null&&q.social!=null&&!q.needsReview;}
      else if(type==='withholding'){const q=parseWithholdingPdf(base,name);structuralOk=structuralOk&&q.year!=null&&q.annualSalary!=null&&q.incomeTax!=null&&q.social!=null&&!q.needsReview;}
    }catch(e){structuralOk=false;debugLog('ensurePdfText:structuralError',{name,type,error:e?.message||String(e)})}
    debugLog('ensurePdfText:structuralCheck',{name,type,structuralOk,textChars:raw.length,textItemCount:Number(base.textItemCount||0)});
    if(structuralOk){debugLog('ensurePdfText:acceptedTextLayer',{name,type});return base;}
    if(!base.pdfDoc){debugLog('ensurePdfText:noPdfDoc',{name,type,error:'PDFの文字レイヤーが取得できず、OCR用PDFドキュメントもありません'});return {...base,ocrUsed:false,ocrError:'PDFの文字レイヤーが取得できませんでした'};}
    const attempts=[];
    try{
      // OCR every page, not just page 1. Some Drive PDFs have a cover/header page
      // followed by the actual payroll data. The previous implementation silently
      // discarded those later pages, which is why the DB could contain only a few
      // dozen OCR characters even though the PDF visibly had much more information.
      const pageCount=Math.max(1,Number(base.pageCount||base.pdfDoc.numPages||1));
      for(let pageNumber=1;pageNumber<=pageCount;pageNumber++){
        attempts.push(await ocrPageFromPdfDoc(base.pdfDoc,null,{scale:2.5,psm:11,lang:'jpn',pageNumber}));
        const pageText=String(attempts[attempts.length-1]?.text||'');
        const pageQuality=ocrQuality(pageText,Number(attempts[attempts.length-1]?.ocrConfidence||0));
        if(pageQuality<260){
          attempts.push(await ocrPageFromPdfDoc(base.pdfDoc,null,{scale:2.5,psm:6,lang:'jpn',pageNumber}));
        }
        if(pageQuality<180){
          attempts.push(await ocrPageFromPdfDoc(base.pdfDoc,null,{scale:2.5,psm:11,lang:'eng',pageNumber}));
        }
      }
      const firstText=attempts.map(x=>String(x.text||'')).join('\n');
      // If the full-page passes are still sparse, retry the lower portion of each
      // salary page where the summary/social-insurance rows are located.
      if(type==='salary' && ocrQuality(firstText,Math.max(...attempts.map(x=>Number(x.ocrConfidence||0))))<260){
        const pageCount2=Math.max(1,Number(base.pageCount||base.pdfDoc.numPages||1));
        for(let pageNumber=1;pageNumber<=pageCount2;pageNumber++){
          attempts.push(await ocrPageFromPdfDoc(base.pdfDoc,{x0:0,y0:0.62,x1:1,y1:1},{scale:2.8,psm:11,lang:'jpn',pageNumber}));
        }
      }
      const nonEmpty=attempts.filter(x=>String(x.text||'').trim().length>=20);
      if(!nonEmpty.length)throw new Error('OCR結果が空または短すぎます');
      const mergedText=nonEmpty.map(x=>`[Page ${x.pageNumber||1}]\n${String(x.text||'')}`).join('\n');
      const parseAttempt=(attempt)=>{
        try{
          const q={...attempt,ocrText:attempt.text,ocrUsed:true};
          if(type==='salary')return !parseSalaryPdf(q,name).needsReview;
          if(type==='bonus')return !parseBonusPdf(q,name).needsReview;
          if(type==='withholding')return !parseWithholdingPdf(q,name).needsReview;
        }catch{}
        return false;
      };
      const valid=nonEmpty.filter(parseAttempt);
      const ranked=(valid.length?valid:nonEmpty).slice().sort((left,right)=>{
        const av=ocrQuality(left.text,left.ocrConfidence),bv=ocrQuality(right.text,right.ocrConfidence);
        return bv-av;
      });
      const best=ranked[0];
      const wordSource=valid.find(x=>!x.ocrRegion&&Array.isArray(x.words)&&x.words.length)
        ||nonEmpty.find(x=>!x.ocrRegion&&Array.isArray(x.words)&&x.words.length)
        ||best;
      debugLog('ensurePdfText:ocrResult',{name,type,attempts:attempts.map(x=>({page:x.pageNumber,psm:x.ocrPsm,lang:x.ocrLang,chars:String(x.text||'').length,confidence:Number(x.ocrConfidence||0),words:Array.isArray(x.words)?x.words.length:0,region:!!x.ocrRegion})),mergedChars:String(mergedText||'').length});
      return {...base,text:raw,ocrText:mergedText,ocrUsed:true,ocrConfidence:Math.max(...attempts.map(x=>Number(x.ocrConfidence||0))),ocrPsm:attempts.map(x=>`p${x.pageNumber||1}:${x.ocrPsm}`).join(','),ocrWords:wordSource.words||[],ocrWordCount:Array.isArray(wordSource.words)?wordSource.words.length:0,ocrWidth:wordSource.ocrWidth,ocrHeight:wordSource.ocrHeight,ocrPages:nonEmpty.map(x=>({pageNumber:x.pageNumber||1,text:String(x.text||''),confidence:Number(x.ocrConfidence||0),psm:x.ocrPsm,lang:x.ocrLang,words:Array.isArray(x.words)?x.words:[],width:x.ocrWidth,height:x.ocrHeight,region:!!x.ocrRegion})),ocrAttempts:attempts.map(x=>({pageNumber:x.pageNumber||1,psm:x.ocrPsm,lang:x.ocrLang,chars:String(x.text||'').length,confidence:x.ocrConfidence||0,words:Array.isArray(x.words)?x.words.length:0,valid:valid.includes(x),region:!!x.ocrRegion})),ocrValidated:valid.length>0};
    }catch(e){diag({stage:'ocrError',type,name,error:e?.stack||e?.message||String(e),attempts:attempts.map(x=>({psm:x.ocrPsm,lang:x.ocrLang,chars:String(x.text||'').length,confidence:x.ocrConfidence||0,words:Array.isArray(x.words)?x.words.length:0,sample:String(x.text||'').slice(0,300),width:x.ocrWidth||0,height:x.ocrHeight||0,imageBytes:x.imageBytes||0,cornerNonWhite:x.cornerNonWhite||0,cornerMean:x.cornerMean||0}))});return {...base,text:raw,ocrText:'',ocrUsed:true,ocrError:e?.message||String(e),ocrAttempts:attempts.map(x=>({psm:x.ocrPsm,lang:x.ocrLang,chars:String(x.text||'').length,confidence:x.ocrConfidence||0,words:Array.isArray(x.words)?x.words.length:0,valid:false})),ocrValidated:false};}
    return {...base,text:raw,ocrUsed:true,ocrError:'OCR結果が空でした'};
  }
  function buildReadData(pdf,name=''){
    const pdfText=String(pdf?.text||'');
    const ocrText=String(pdf?.ocrText||'');
    const combined=[pdfText,ocrText].filter(Boolean).join('\n');
    const lines=[];
    const seen=new Set();
    for(const rawLine of combined.replace(/\r/g,'').split(/\n+/)){
      const line=String(rawLine||'').replace(/[ \t\u3000]+/g,' ').trim();
      if(!line)continue;
      const amounts=extractNumericTokens(line).map(x=>({value:x.n,raw:x.text,index:x.index}));
      const key=line+'|'+amounts.map(x=>x.value).join(',');
      if(seen.has(key))continue;
      seen.add(key);
      lines.push({text:line,amounts});
    }
    const numericValues=[]; const nvSeen=new Set();
    for(const row of lines){
      for(const a of row.amounts){
        const key=`${a.value}|${row.text}`;
        if(nvSeen.has(key))continue; nvSeen.add(key);
        numericValues.push({value:a.value,raw:a.raw,context:row.text});
      }
    }
    return {
      version:'20260926-readout11',
      document:String(name||''),
      pdfText,
      ocrText,
      preferredText:pdfText||ocrText,
      lines,
      numericValues,
      pageCount:Number(pdf?.pageCount||0),
      textItemCount:Number(pdf?.textItemCount||0),
      ocrUsed:!!pdf?.ocrUsed,
      ocrConfidence:Number(pdf?.ocrConfidence||0),
      ocrWordCount:Number(pdf?.ocrWordCount||0),
      ocrValidated:!!pdf?.ocrValidated,
      pageTexts:Array.isArray(pdf?.pages)?pdf.pages.map((items,i)=>({page:i+1,text:(items||[]).slice().sort((a,b)=>Number(b.y||0)-Number(a.y||0)||Number(a.x||0)-Number(b.x||0)).map(x=>String(x.str||'')).join(' '),items:(items||[]).map(x=>({str:String(x.str||''),x:Number(x.x||0),y:Number(x.y||0),width:Number(x.width||0),height:Number(x.height||0)}))})):[],
      ocrPages:Array.isArray(pdf?.ocrPages)?pdf.ocrPages.map(x=>({pageNumber:Number(x.pageNumber||1),text:String(x.text||''),confidence:Number(x.confidence||0),psm:x.psm||'',lang:x.lang||'',words:Array.isArray(x.words)?x.words.map(w=>({text:String(w.text||w.str||''),bbox:w.bbox||null,confidence:Number(w.confidence??w.conf??0)})):[],width:Number(x.width||0),height:Number(x.height||0),region:!!x.region})):[]
    };
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
    const matchesLabel=(acc,label)=>{
      const a=normalizeLabel(acc);
      if(label==='taxableamount'&&a.includes('nontaxableamount'))return false;
      return a.includes(label);
    };
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
    const validAmount=(n)=>Number.isFinite(n)&&n>=100&&n<1000000000&&!(n>=1900&&n<=2100);
    for(const label of (labels||[])){
      const l=norm(label); if(!l)continue;
      let sawLabel=false;
      for(let li=0;li<rawLines.length;li++){
        const rawLine=rawLines[li];
        const line=norm(rawLine); const idx=line.indexOf(l); if(idx<0)continue; sawLabel=true;
        // Search only the same visual/text row first. Ignore year-like tokens;
        // a header such as 「2026年08月〜今回支払給与分 Taxable amount...」
        // contains the label but is not the payroll field value.
        const after=line.slice(idx+l.length);
        for(const v of extractNumericTokens(after))if(validAmount(v.n))return v.n;
        const textTail=after.replace(/[0-9, .\-]/g,'').trim();
        const nextLine=rawLines[li+1]||'';
        const nextVals=extractNumericTokens(nextLine).filter(v=>validAmount(v.n));
        // A label with a short descriptive tail can place its value on the next
        // line. Never accept a date/year from that line.
        if(nextVals.length && (textTail.length<=80 || !/[A-Za-z]{3,}/.test(textTail)))return nextVals[0].n;
      }
      if(sawLabel)continue;
      // Last-resort compact fallback for labels split by PDF text extraction.
      const source=String(raw).replace(/\r/g,''); let from=0;
      while(true){
        const compact=norm(source.slice(from)); const pos=compact.indexOf(l); if(pos<0)break;
        const approx=source.slice(from+pos+l.length,from+pos+l.length+180);
        for(const v of extractNumericTokens(approx))if(validAmount(v.n))return v.n;
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
    // Tesseract commonly splits 19,132,057 into three words. Recombine only
    // adjacent numeric-looking words on the same visual row.
    const out=[];
    for(const w of raw){
      const isNum=/^[-+]?\d[\d,.]*$/.test(w.text);
      if(!isNum)continue;
      const prev=out[out.length-1];
      if(prev&&Math.abs(prev.y-w.y)<=10&&w.x-prev.x1<=30&&/[,\.]$/.test(prev.text)){
        prev.text+=w.text;prev.x1=w.x1;prev.y1=Math.max(prev.y1,w.y1);prev.conf=Math.min(prev.conf||0,w.conf||0);
      }else{out.push({...w});}
    }
    return out.map(w=>{const n=normalizeNumericToken(w.text);return {...w,n}}).filter(w=>Number.isFinite(w.n)&&w.n>=100&&w.n<1000000000&&!(w.n>=1900&&w.n<=2100));
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
  function extractToyotaSalarySummary(textOrPdf){
    const raw=String(typeof textOrPdf==='string'?textOrPdf:textOrPdf?.text||'');
    const out={taxableGross:null,grossTotal:null,nonTaxableTotal:null};
    // First use the exact summary labels independently. This prevents the
    // nearby 基準賃金等 / 通勤費 rows from being mistaken for the summary.
    const taxable=extractExactYenAfterLabel(textOrPdf,['課税対象額']);
    const nonTaxable=extractExactYenAfterLabel(textOrPdf,['（内通勤補助費等非課税分)','(内通勤補助費等非課税分)','Non-taxable Amount','Non‑taxable Amount','Non-taxabl e Anount','Non‑taxabl e Anount','Non-taxable Anount']);
    if(taxable!=null)out.taxableGross=taxable;
    if(nonTaxable!=null)out.nonTaxableTotal=nonTaxable;
    if(out.taxableGross!=null&&out.nonTaxableTotal!=null){out.grossTotal=out.taxableGross+out.nonTaxableTotal;return out;}
    // Narrow fallback for PDFs whose summary labels are split in the text stream.
    const re=/課税対象額/g; let m;
    while((m=re.exec(raw))){
      const tail=raw.slice(m.index+m[0].length,m.index+m[0].length+520);
      if(!/支給合計/.test(tail))continue;
      const stop=tail.search(/健康保険料|雇用保険料|所得税|住民税/);
      const block=stop>=0?tail.slice(0,stop):tail;
      const vals=extractNumericTokens(block).map(x=>x.n).filter(n=>!(n>=1900&&n<=2100));
      if(vals.length>=3){
        if(out.taxableGross==null)out.taxableGross=vals[0];
        if(out.nonTaxableTotal==null){
          const small=vals.find((n,i)=>i>0&&n>=1000&&n<100000);
          out.nonTaxableTotal=small??null;
        }
        if(out.taxableGross!=null&&out.nonTaxableTotal!=null)out.grossTotal=out.taxableGross+out.nonTaxableTotal;
        break;
      }
    }
    return out;
  }
  function extractToyotaSalarySocial(textOrPdf){
    const raw=String(typeof textOrPdf==='string'?textOrPdf:textOrPdf?.text||'');
    const out={employmentInsurance:null,healthInsurance:null,healthInsuranceSpecial:null,nursingCare:null,childSupport:null,pension:null};
    const emp=/雇用保険料[ \u3000]*([0-9][0-9,]*)/.exec(raw);
    if(emp)out.employmentInsurance=Number(emp[1].replace(/,/g,''));
    const start=raw.search(/健康保険料[（(]基本/);
    if(start<0)return out;
    const tail=raw.slice(start,start+420);
    const end=tail.search(/所得税|住民税|控除合計|加算明細/);
    const block=end>=0?tail.slice(0,end):tail;
    const vals=extractNumericTokens(block).map(x=>x.n).filter(n=>!(n>=1900&&n<=2100));
    const child=/子ども[・\s]*子育て支援金/.test(block.replace(/[（）()]/g,''));
    if(child && vals.length>=5){
      [out.healthInsurance,out.healthInsuranceSpecial,out.nursingCare,out.childSupport,out.pension]=vals.slice(0,5);
    }else if(!child && vals.length>=4){
      [out.healthInsurance,out.healthInsuranceSpecial,out.nursingCare,out.pension]=vals.slice(0,4);
    }
    return out;
  }
  function parseSalaryComponents(text){
    const s=cleanPdfText(typeof text==='string'?text:text?.text||'');
    // Structured summary fields are authoritative. Parse them by exact label,
    // not by visual-nearest-number heuristics: the slip contains many other
    // amounts (bank transfers, standard remuneration, deductions, etc.).
    const toyotaSummary=extractToyotaSalarySummary(text);
    // The Toyota monthly slip's 支給合計(A) stream position is unreliable: the
    // old parser captured an unrelated 923円. Keep that candidate for audit,
    // but derive the real gross total from taxable + non-taxable when both are known.
    const rawGrossTotalCandidate=extractExactYenAfterLabel(text,['支給合計（A)','支給合計(A)','Total Payment']);
    let grossTotal=null;
    let nonTaxableTotal=toyotaSummary.nonTaxableTotal ?? extractExactYenAfterLabel(text,['（内通勤補助費等非課税分)','(内通勤補助費等非課税分)','Non-taxable Amount','Non‑taxable Amount','Non-taxabl e Anount','Non‑taxabl e Anount','Non-taxable Anount']);
    // Prefer the Japanese summary label. The PDF header also contains the
    // phrase "Taxable amount from January"; treating that as the field label
    // can grab an unrelated nearby number (this is what made April look like
    // 13,500円 in an earlier parser). Only fall back to the standalone English
    // label when the Japanese label is genuinely absent.
    const rawSalaryForLabel=String(typeof text==='string'?text:text?.text||'');
    const hasJapaneseTaxableLabel=/課税対象額/.test(rawSalaryForLabel);
    let explicitTaxable=toyotaSummary.taxableGross ?? (hasJapaneseTaxableLabel
      ? extractExactYenAfterLabel(text,['課税対象額'])
      : extractExactYenAfterLabel(text,['Taxable Amount']));
    if(text&&typeof text==='object'&&text.ocrUsed)explicitTaxable=extractOcrSameLineNumber(text,['Taxable Anount','Taxable Amount'])??explicitTaxable;
    // OCR can drop the labels but still recognize all three summary numbers.
    // Recover them only when an exact arithmetic relation proves the values.
    const nums=allOcrNumbers(text);
    if(nonTaxableTotal==null){
      const pair=findArithmeticTriple(nums,(g,t,n)=>g>t&&g-t===n);
      if(pair)nonTaxableTotal=pair.c;
    }
    // Recompute after OCR recovery. The raw 923 candidate is never allowed to
    // override the arithmetic result from the two explicit payroll amounts.
    if(explicitTaxable!=null && nonTaxableTotal!=null)grossTotal=explicitTaxable+nonTaxableTotal;
    else grossTotal=rawGrossTotalCandidate;
    if(explicitTaxable==null && grossTotal!=null && nonTaxableTotal!=null)explicitTaxable=grossTotal-nonTaxableTotal;
    const derivedTaxable=(grossTotal!=null&&nonTaxableTotal!=null&&grossTotal>=nonTaxableTotal)?grossTotal-nonTaxableTotal:null;
    const taxableBase=derivedTaxable!=null?derivedTaxable:(explicitTaxable!=null?explicitTaxable:null);
    // Toyota's PDF text layer sometimes drops the closing parenthesis in
    // labels such as "健康保険料（基本）" -> "健康保険料（基本".
    // Do not let that formatting loss invalidate the entire social-insurance
    // row: the amount is on the same visual/text line and can be recovered
    // safely by a punctuation-tolerant, same-line matcher.
    const socialLabels={
      employmentInsurance:['雇用保険料'],
      healthInsurance:['健康保険料（基本）','健康保険料 (基本)','健康保険料（基本'],
      healthInsuranceSpecial:['健康保険料（特定）','健康保険料 (特定)','健康保険料（特定'],
      nursingCare:['介護保険料'],
      childSupport:['子ども・子育て支援金','子ども 子育て支援金','子ども子育て支援金'],
      pension:['年金保険料','厚生年金保険料']
    };
    const flexibleSameLineAmount=(source,labels)=>{
      const raw=typeof source==='string'?source:String(source?.text||'');
      const compact=v=>String(v||'').replace(/[\s\u3000()（）「」［］【】・･:：]/g,'').toLowerCase();
      const lines=raw.replace(/\r/g,'').split(/\n+/);
      for(const line of lines){
        const lc=compact(line); if(!lc)continue;
        for(const label of labels||[]){
          const l=compact(label); if(!l)continue;
          const idx=lc.indexOf(l); if(idx<0)continue;
          // Map the compacted label end back to the raw line. This preserves
          // thousands separators and avoids accidentally taking the next row.
          let rp=0,cp=0;
          while(rp<line.length && cp<idx+l.length){
            const ch=line[rp++];
            if(/[\s\u3000()（）「」［］【】・･:：]/.test(ch))continue;
            cp++;
          }
          const after=line.slice(rp);
          const vals=extractNumericTokens(after).map(x=>x.n).filter(n=>n<1900||n>2100);
          if(vals.length)return vals[0];
        }
      }
      return null;
    };
    const socialComponents={};
    const toyotaSocial=extractToyotaSalarySocial(text);
    for(const [k,labels] of Object.entries(socialLabels)){
      // The exact label/value row is the authoritative source. The older
      // Toyota block parser can shift values when the PDF interleaves two
      // columns, so it is used only as a fallback for a genuinely missing row.
      socialComponents[k]=extractExactYenAfterLabel(text,labels);
      if(!Number.isFinite(socialComponents[k])&&Number.isFinite(toyotaSocial[k]))socialComponents[k]=toyotaSocial[k];
      if(!Number.isFinite(socialComponents[k]))socialComponents[k]=flexibleSameLineAmount(text,labels);
    }
    const requiredSocialKeys=['employmentInsurance','healthInsurance','healthInsuranceSpecial','nursingCare','pension'];
    const socialRequiredOk=requiredSocialKeys.every(k=>Number.isFinite(socialComponents[k]));
    // Child-support funding is a separate payroll row and is not present on
    // every historical slip. Its absence means "not listed on this slip", not
    // "the whole social-insurance total is unreadable". If the label is present
    // but its amount is missing, it is still reported as missing below.
    const socialTotal=socialRequiredOk ? requiredSocialKeys.reduce((a,k)=>a+(Number(socialComponents[k])||0),0)+(Number.isFinite(socialComponents.childSupport)?Number(socialComponents.childSupport):0) : null;
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
    for(const k of ['employmentInsurance','healthInsurance','healthInsuranceSpecial','nursingCare','pension']){
      if(!Number.isFinite(socialComponents[k]))unknown.push(`社会保険料:${k}`);
    }
    // Only require child-support when the PDF actually contains that label.
    // This preserves the distinction between "not applicable/not listed" and
    // "label exists but amount could not be extracted".
    const rawForPresence=String(typeof text==='string'?text:text?.text||'');
    const childLabelPresent=/子ども[・\s]*子育て支援金/.test(rawForPresence.replace(/[（）()]/g,''));
    if(childLabelPresent&&!Number.isFinite(socialComponents.childSupport))unknown.push('社会保険料:childSupport');
    const arithmeticOk=(derivedTaxable!=null&&explicitTaxable!=null&&derivedTaxable===explicitTaxable) || (grossTotal!=null&&nonTaxableTotal!=null&&explicitTaxable==null&&grossTotal-nonTaxableTotal>=0);
    return {grossTotal,taxableGross:taxableBase,explicitTaxableGross:explicitTaxable,rawGrossTotalCandidate:rawGrossTotalCandidate??null,nonTaxableTotal,socialComponents,socialTotal,grossComponents,unknownComponents:unknown,arithmeticOk,needsReview:unknown.length>0||!arithmeticOk};
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
      const mergedSocial={...(c.socialComponents||{})};
      for(const source of [o.socialComponents||{},f.socialComponents||{}]){
        for(const k of ['employmentInsurance','healthInsurance','healthInsuranceSpecial','nursingCare','childSupport','pension']){
          if(Number.isFinite(source[k]))mergedSocial[k]=source[k];
        }
      }
      c={...c,
        taxableGross:f.taxableGross??o.taxableGross??c.taxableGross,
        grossTotal:f.grossTotal??o.grossTotal??c.grossTotal,
        nonTaxableTotal:f.nonTaxableTotal??o.nonTaxableTotal??c.nonTaxableTotal,
        socialTotal:f.socialTotal??o.socialTotal??c.socialTotal,
        socialComponents:mergedSocial
      };
      if(!c.components?.length&&o.grossComponents?.length)c={...c,grossComponents:o.grossComponents};
      if(c.taxableGross!=null&&c.nonTaxableTotal!=null&&c.grossTotal==null)c.grossTotal=c.taxableGross+c.nonTaxableTotal;
      const derived=(c.grossTotal!=null&&c.nonTaxableTotal!=null)?c.grossTotal-c.nonTaxableTotal:null;
      const requiredSocialKeys=['employmentInsurance','healthInsurance','healthInsuranceSpecial','nursingCare','pension'];
      const socialOk=requiredSocialKeys.every(k=>Number.isFinite(c.socialComponents?.[k]));
      const socialTotal=(socialOk?requiredSocialKeys.reduce((a,k)=>a+(Number(c.socialComponents?.[k])||0),0)+(Number.isFinite(c.socialComponents?.childSupport)?Number(c.socialComponents.childSupport):0):null);
      const unknown=[...(c.grossTotal==null?['支給合計']:[]),...(c.nonTaxableTotal==null?['非課税分']:[]),...(c.taxableGross==null?['課税対象額']:[])];
      for(const k of requiredSocialKeys)if(!Number.isFinite(c.socialComponents?.[k]))unknown.push(`社会保険料:${k}`);
      const ocrChildLabelPresent=/子ども[・\s]*子育て支援金/.test(String((text&&typeof text==='object'?text.ocrText:'')||'').replace(/[（）()]/g,''));
      if(ocrChildLabelPresent&&!Number.isFinite(c.socialComponents?.childSupport))unknown.push('社会保険料:childSupport');
      c={...c,socialTotal,unknownComponents:unknown,arithmeticOk:derived!=null&&c.taxableGross===derived&&socialOk,needsReview:!(derived!=null&&c.taxableGross===derived&&socialOk)};
    }
    const taxableGross=Number.isFinite(c.taxableGross)&&c.taxableGross>0?c.taxableGross:null;
    const grossTotal=Number.isFinite(c.grossTotal)&&c.grossTotal>0?c.grossTotal:null;
    const requiredSocialKeys=['employmentInsurance','healthInsurance','healthInsuranceSpecial','nursingCare','pension'];
    const rawForPresence=String(typeof text==='string'?text:text?.text||'');
    const childSupportLabelPresent=/子ども[・\s]*子育て支援金/.test(rawForPresence.replace(/[（）()]/g,''));
    const socialOk=requiredSocialKeys.every(k=>Number.isFinite(c.socialComponents?.[k])) && (!childSupportLabelPresent || Number.isFinite(c.socialComponents?.childSupport));
    const socialTotal=socialOk ? (requiredSocialKeys.reduce((a,k)=>a+(Number(c.socialComponents?.[k])||0),0) + (Number.isFinite(c.socialComponents?.childSupport)?Number(c.socialComponents.childSupport):0)) : null;
    const missing=[...(c.grossTotal==null?['支給合計']:[]),...(c.nonTaxableTotal==null?['非課税分']:[]),...(taxableGross==null?['課税対象額']:[])];
    for(const k of requiredSocialKeys)if(!Number.isFinite(c.socialComponents?.[k]))missing.push(`社会保険料:${k}`);
    if(childSupportLabelPresent&&!Number.isFinite(c.socialComponents?.childSupport))missing.push('社会保険料:childSupport');
    const derived=(grossTotal!=null&&c.nonTaxableTotal!=null)?grossTotal-c.nonTaxableTotal:null;
    const arithmeticOk=derived!=null&&taxableGross===derived;
    const needsReview=!(arithmeticOk&&socialOk);
    return {year:d.year,month:d.month,gross:taxableGross,taxableGross,grossTotal,rawGrossTotalCandidate:c.rawGrossTotalCandidate??null,nonTaxableTotal:c.nonTaxableTotal,social:socialTotal,socialComponents:c.socialComponents,childSupportLabelPresent,components:c.grossComponents,unknownComponents:missing,source:'google-drive',status:'actual',document:name,needsReview};
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
  function extractToyotaBonusSocial(textOrPdf){
    const raw=String(typeof textOrPdf==='string'?textOrPdf:textOrPdf?.text||'');
    const out={employmentInsurance:null,healthInsurance:null,healthInsuranceSpecial:null,nursingCare:null,childSupport:null,pension:null};
    const start=raw.search(/雇用保険料/);
    if(start<0)return out;
    const tail=raw.slice(start,start+1200);
    const pensionLabel=tail.search(/年金保険料/);
    if(pensionLabel<0)return out;
    const valueArea=tail.slice(pensionLabel+'年金保険料'.length);
    const end=valueArea.search(/標準賞与額|※社会保険料/);
    const block=end>=0?valueArea.slice(0,end):valueArea;
    const vals=extractNumericTokens(block).map(x=>x.n).filter(n=>!(n>=1900&&n<=2100));
    const child=/子ども[・\s]*子育て支援金/.test(tail.replace(/[（）()]/g,''));
    if(child && vals.length>=6){
      [out.employmentInsurance,out.healthInsurance,out.healthInsuranceSpecial,out.nursingCare,out.childSupport,out.pension]=vals.slice(0,6);
    }else if(!child && vals.length>=5){
      [out.employmentInsurance,out.healthInsurance,out.healthInsuranceSpecial,out.nursingCare,out.pension]=vals.slice(0,5);
    }
    return out;
  }
  function parseBonusPdf(text,name){
    const raw=typeof text==='string'?text:(text?.text||''); const d=extractDateParts(raw,name);
    let amount=extractExactYenAfterLabel(text,['支給額','支給合計（A)','支給合計(A)','Total Payment']);
    const taxableGross=extractExactYenAfterLabel(text,['課税対象額','Taxable Amount']) ?? amount;
    const socialLabels={employmentInsurance:['雇用保険料'],healthInsurance:['健康保険料（基本）','健康保険料 (基本)','健康保険料（基本'],healthInsuranceSpecial:['健康保険料（特定）','健康保険料 (特定)','健康保険料（特定'],nursingCare:['介護保険料'],childSupport:['子ども・子育て支援金','子ども 子育て支援金','子ども子育て支援金'],pension:['年金保険料','厚生年金保険料']};
    const socialComponents={};
    const toyotaBonusSocial=extractToyotaBonusSocial(text);
    for(const [k,labels] of Object.entries(socialLabels)){
      // Exact label/value extraction wins. The broad Toyota block fallback can
      // shift columns because the bonus slip interleaves payment and deduction
      // tables on the same visual rows.
      socialComponents[k]=extractExactYenAfterLabel(text,labels);
      if(!Number.isFinite(socialComponents[k])&&Number.isFinite(toyotaBonusSocial[k]))socialComponents[k]=toyotaBonusSocial[k];
      if(!Number.isFinite(socialComponents[k])){
        const raw=typeof text==='string'?text:String(text?.text||'');
        const compact=v=>String(v||'').replace(/[\s\u3000()（）「」［］【】・･:：]/g,'').toLowerCase();
        for(const line of raw.replace(/\r/g,'').split(/\n+/)){
          const lc=compact(line);
          const hit=(labels||[]).find(label=>lc.includes(compact(label)));
          if(!hit)continue;
          const idx=lc.indexOf(compact(hit)); let rp=0,cp=0;
          while(rp<line.length&&cp<idx+compact(hit).length){const ch=line[rp++];if(/[\s\u3000()（）「」［］【】・･:：]/.test(ch))continue;cp++;}
          const v=extractNumericTokens(line.slice(rp)).map(x=>x.n).find(n=>n<1900||n>2100);
          if(v!=null){socialComponents[k]=v;break;}
        }
      }
    }
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
    const requiredBonusSocialKeys=['employmentInsurance','healthInsurance','healthInsuranceSpecial','nursingCare','pension']; const socialRequiredOk=requiredBonusSocialKeys.every(k=>Number.isFinite(socialComponents[k])); const social=socialRequiredOk ? requiredBonusSocialKeys.reduce((a,k)=>a+(Number(socialComponents[k])||0),0)+(Number.isFinite(socialComponents.childSupport)?Number(socialComponents.childSupport):0) : null;
    let standardHealth=extractThousandAfterLabel(text,['健康保険/介護保険','健康保険／介護保険']);
    let standardPension=extractThousandAfterLabel(text,['厚生年金保険（150万/回）','厚生年金保険 (150万/回)','厚生年金保険（150万／回）']);
    const stdStart=raw.search(/標準賞与額/);
    if(stdStart>=0){
      const stdTail=raw.slice(stdStart,stdStart+700);
      const welfareIdx=stdTail.search(/Welfare Pension Insurance/);
      if(welfareIdx>=0){
        const vals=[...stdTail.slice(welfareIdx).matchAll(/(?<!\d)(\d{1,3}(?:,\d{3})?|\d+)(?!\d)/g)]
          .map(m=>Number(m[1].replace(/,/g,'')))
          .filter(n=>n<10000&&!(n>=1900&&n<=2100));
        // The three values are: standard bonus amount, health/nursing base,
        // welfare-pension base. The labels above contain the 573万/150万 caps,
        // so parsing from the English value-section avoids those metadata numbers.
        if(vals.length>=3){standardHealth=vals[1];standardPension=vals[2];}
      }
    }
    const derivedNet=(amount!=null&&deduction!=null)?amount-deduction:null;
    const netConflict=derivedNet!=null && ((transferNet!=null && transferNet!==derivedNet) || (transferNet==null && labelNet!=null && labelNet!==derivedNet));
    if(derivedNet!=null)net=derivedNet;
    const finalNet=derivedNet!=null?derivedNet:net;
    const arithmeticOk=amount!=null&&deduction!=null&&derivedNet>=0&&!netConflict;
    const date=d.year&&d.month?`${d.year}-${String(d.month).padStart(2,'0')}`:'';
    const season=d.month?(Number(d.month)>=10?'winter':'summer'):null;
    return {year:d.year,month:d.month,date,season,amount,taxableGross,social,socialComponents,standardBonusHealth:standardHealth!=null?standardHealth*1000:null,standardBonusPension:standardPension!=null?standardPension*1000:null,deductionTotal:deduction,netPayment:finalNet,explicitNetPayment:net,source:'google-drive',status:'actual',document:name,arithmeticOk,needsReview:!(date&&amount&&arithmeticOk)||social==null};
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
    const ideco=pick('小規模企業共済等掛金の額')??pick('小規模企業共済等掛金');
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
    return {year,annualSalary,salaryIncomeAfterDeduction,deductionsTotal,social,incomeTax,lifeInsuranceDeduction,earthquakeInsuranceDeduction,housingLoanDeduction,specialDependent,basicDeduction,incomeAdjustment,newLifeInsurance,oldLifeInsurance,nursingInsurance,newPension,oldPension,ideco:ideco||0,smallBusinessDeduction:ideco||0,document:name,source:'google-drive',status:'actual',arithmeticOk,needsReview:!arithmeticOk};
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
  function estimateForecastBonusSocial(state,base,targetYear){
    const amount=Math.max(0,Number(base?.amount)||0); if(!amount)return {total:0,components:{},standardBonusHealth:0,standardBonusPension:0};
    const healthCap=5730000, pensionCap=1500000;
    const currentBonuses=(state.bonusRecords||[]).filter(r=>r.status==='actual'&&Number(r.amount)>0);
    let usedHealth=0;
    for(const r of currentBonuses)usedHealth+=Math.min(healthCap,Math.floor((Number(r.amount)||0)/1000)*1000);
    const standardHealth=Math.max(0,Math.min(Math.floor(amount/1000)*1000,healthCap-usedHealth));
    const standardPension=Math.min(Math.floor(amount/1000)*1000,pensionCap);
    const ref=currentBonuses.slice().sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))).find(r=>Number(r.amount)>0&&r.socialComponents&&Object.values(r.socialComponents).some(v=>Number(v)>0))
      ||(state.priorBonusRecords||[]).slice().sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))).find(r=>Number(r.amount)>0&&r.socialComponents&&Object.values(r.socialComponents).some(v=>Number(v)>0));
    const refBase=Math.max(0,Number(ref?.standardBonusHealth)||Number(ref?.amount)||0);
    const comp=ref?.socialComponents||{};
    const rate=k=>refBase>0&&Number(comp[k])>0?Number(comp[k])/refBase:0;
    const components={employmentInsurance:Math.floor(amount*0.005),healthInsurance:Math.floor(standardHealth*rate('healthInsurance')),healthInsuranceSpecial:Math.floor(standardHealth*rate('healthInsuranceSpecial')),nursingCare:Math.floor(standardHealth*rate('nursingCare')),childSupport:Number(targetYear)>=2026?Math.floor(standardHealth*0.00115):0,pension:Math.floor(standardPension*0.0915)};
    return {total:Object.values(components).reduce((a,v)=>a+(Number(v)||0),0),components,standardBonusHealth:standardHealth,standardBonusPension:standardPension,referenceBonus:ref?.document||ref?.date||''};
  }
  function buildForecastFromPrior(state,targetYear,actualThrough){
    const priorYear=targetYear-1, currentSalary=state.salaryRecords||[], currentSocial=state.socialRecords||[], priorBonus=state.priorBonusRecords||[];
    const avg=(rows,key)=>{const vals=rows.filter(x=>Number(x.month)>=4&&Number(x.month)<=Math.min(9,actualThrough)).map(x=>Number(x[key])||0).filter(v=>v>0);return vals.length?vals.reduce((a,v)=>a+v,0)/vals.length:0};
    const salaryAvg=avg(currentSalary,'taxableGross'), socialAvg=avg(currentSocial,'amount'), forecastMonths=Math.max(0,12-actualThrough);
    state.forecastSalary=Array.from({length:forecastMonths},()=>Math.round(salaryAvg)); state.forecastSocial=Array.from({length:forecastMonths},()=>Math.round(socialAvg));
    const currentBonus=state.bonusRecords||[], season=m=>Number(m)>=10?'winter':'summer', bonusMonth=x=>Number(String(x.date||'').slice(5,7))||Number(x.month)||0;
    let forecastBonus=0; state.bonusSocialRecords=(state.bonusSocialRecords||[]).filter(x=>x.status!=='forecast'); state.forecastBonusBreakdown=[];
    for(const seasonName of ['summer','winter']){
      const currentSeason=currentBonus.filter(x=>Number(x.amount)>0&&season(bonusMonth(x))===seasonName); if(currentSeason.length)continue;
      const priorSeason=priorBonus.filter(x=>season(bonusMonth(x))===seasonName&&Number(x.amount)>0); if(!priorSeason.length)continue;
      const amount=priorSeason.reduce((a,x)=>a+(Number(x.amount)||0),0); forecastBonus+=amount;
      const last=priorSeason[priorSeason.length-1], base={...last,amount,date:`${targetYear}-${String(bonusMonth(last)).padStart(2,'0')}`,month:bonusMonth(last),season:seasonName};
      const fs=estimateForecastBonusSocial(state,base,targetYear);
      state.bonusSocialRecords.push({date:base.date,month:base.month,season:seasonName,amount:fs.total,components:fs.components,standardBonusHealth:fs.standardBonusHealth,standardBonusPension:fs.standardBonusPension,source:'prior-year-reference',status:'forecast',document:base.document,note:`${priorYear}年${seasonName==='summer'?'夏':'冬'}賞与を金額予測の参考にし、${targetYear}年の制度・料率で再計算`,needsReview:false});
      state.forecastBonusBreakdown.push({season:seasonName,amount,sourceYear:priorYear,social:fs.total,socialComponents:fs.components,standardBonusHealth:fs.standardBonusHealth,standardBonusPension:fs.standardBonusPension});
    }
    state.forecastBonus=forecastBonus; state.forecastMethod={salary:actualThrough>0?`${targetYear}年4〜${Math.min(9,actualThrough)}月実績平均（未取得月を自動予測）`:`${targetYear}年の実績なし（前年給与は使用しない）`,social:actualThrough>0?`${targetYear}年4〜${Math.min(9,actualThrough)}月実績平均（未取得月を自動予測）`:`${targetYear}年の実績なし`,bonus:`対象年の未支給シーズンは${priorYear}年同シーズン賞与を金額参考`};
  }
  function upsertSalaryRecord(state,x,f,targetYear,result){
    if(!(x.year===targetYear&&x.month&&Number(x.taxableGross)>0&&!x.needsReview))return false;
    result.salaryParsed++; state.salaryRecords=state.salaryRecords||[];
    state.salaryRecords=state.salaryRecords.filter(r=>Number(r.month)!==x.month||r.source==='manual');
    state.salaryRecords.push({year:targetYear,month:x.month,gross:x.taxableGross,taxableGross:x.taxableGross,grossTotal:x.grossTotal,nonTaxableTotal:x.nonTaxableTotal,components:x.components||[],source:'google-drive',status:'actual',document:f.name,driveFileId:f.id,needsReview:x.needsReview});
    if(x.social!=null){state.socialRecords=state.socialRecords||[];state.socialRecords=state.socialRecords.filter(r=>Number(r.month)!==x.month||r.source==='manual');state.socialRecords.push({year:targetYear,month:x.month,amount:x.social,components:x.socialComponents||{},source:'google-drive',status:'actual',document:f.name,driveFileId:f.id,needsReview:false})}
    if(x.needsReview){result.review++;result.salaryReview++}result.added++;result.salaryImported++; return true;
  }
  function upsertBonusRecord(state,x,f,targetYear,result){
    if(!(x.date&&x.amount&&!x.needsReview))return false;
    if(x.year===targetYear){
      state.bonusRecords=state.bonusRecords||[];state.bonusRecords=state.bonusRecords.filter(r=>r.date!==x.date||r.source==='manual');state.bonusRecords.push({...x,driveFileId:f.id});
      if(x.social!=null){state.bonusSocialRecords=state.bonusSocialRecords||[];state.bonusSocialRecords=state.bonusSocialRecords.filter(r=>r.date!==x.date||r.source==='manual');state.bonusSocialRecords.push({date:x.date,month:x.month,amount:x.social,components:x.socialComponents||{},standardBonusHealth:x.standardBonusHealth,standardBonusPension:x.standardBonusPension,source:'google-drive',status:'actual',document:f.name,driveFileId:f.id,needsReview:false})}
      result.added++;return true;
    }
    return false;
  }
  const PARSED_DB_VERSION='20260926-v44-db1';
  function documentSignature(f){return `${f.id||f.name||''}|${f.modifiedTime||''}|${f.size||''}`;}
  function archiveYear(state,year){
    const y=Number(year); if(!Number.isFinite(y)||y<2024||y>2100)return null;
    state.yearPayrollRecords=state.yearPayrollRecords&&typeof state.yearPayrollRecords==='object'?state.yearPayrollRecords:{};
    const k=String(y); const a=state.yearPayrollRecords[k]&&typeof state.yearPayrollRecords[k]==='object'?state.yearPayrollRecords[k]:{};
    a.year=y; a.salaryRecords=Array.isArray(a.salaryRecords)?a.salaryRecords:[]; a.socialRecords=Array.isArray(a.socialRecords)?a.socialRecords:[];
    a.bonusRecords=Array.isArray(a.bonusRecords)?a.bonusRecords:[]; a.bonusSocialRecords=Array.isArray(a.bonusSocialRecords)?a.bonusSocialRecords:[]; a.documents=Array.isArray(a.documents)?a.documents:[];
    state.yearPayrollRecords[k]=a; return a;
  }
  function archiveRow(state,year,type,row,keyFn){
    const a=archiveYear(state,year); if(!a||!row)return false;
    a[type]=Array.isArray(a[type])?a[type]:[]; const key=keyFn||((r)=>String(r.id||r.date||r.month||r.document||''));
    const k=String(key(row)); const i=a[type].findIndex(r=>String(key(r))===k);
    if(i>=0)a[type][i]={...a[type][i],...FurusatoModel.clone(row)}; else a[type].push(FurusatoModel.clone(row));
    return true;
  }
  function archiveDocument(state,year,detail){
    const a=archiveYear(state,year); if(!a)return;
    a.documents=Array.isArray(a.documents)?a.documents:[];
    const key=String(detail.driveFileId||detail.id||detail.name||'');
    const i=a.documents.findIndex(d=>String(d.driveFileId||d.id||d.name||'')===key);
    if(i>=0)a.documents[i]={...a.documents[i],...FurusatoModel.clone(detail)};else a.documents.push(FurusatoModel.clone(detail));
  }
  function findCachedDocument(state,f){
    const key=String(f.id||f.name||'');
    for(const [yk,a] of Object.entries(state.yearPayrollRecords||{})){
      for(const d of (a?.documents||[])){
        if(String(d.driveFileId||d.id||d.name||'')!==key)continue;
        const sameSignature=d.signature===documentSignature(f);
        const reasons=[];
        if(!sameSignature)reasons.push('signatureChanged');
        if(d.parserVersion!==PARSED_DB_VERSION)reasons.push('parserVersion');
        if(d.readData?.version!=='20260926-readout11')reasons.push('readDataVersion');
        if(d.needsReview===true)reasons.push('needsReview');
        if(d.ocrError)reasons.push('ocrError');
        if(!(String(d.readData?.pdfText||'').length>0 || String(d.readData?.ocrText||'').length>0))reasons.push('noText');
        if(!Array.isArray(d.readData?.lines))reasons.push('noLines');
        if(!Array.isArray(d.missingFields))reasons.push('noMissingFields');
        if(Array.isArray(d.missingFields)&&d.missingFields.length>0)reasons.push('missingFields');
        debugLog('cache:check',{name:f.name,fileId:f.id,year:Number(yk),sameSignature,complete:reasons.length===0,reasons,previousMissingFields:d.missingFields||[],previousParserVersion:d.parserVersion||null});
        if(reasons.length===0)return {year:Number(yk),detail:d};
      }
    }
    debugLog('cache:none',{name:f.name,fileId:f.id});
    return null;
  }
  function hydrateLiveTarget(state,targetYear){
    const a=state.yearPayrollRecords?.[String(targetYear)]||{salaryRecords:[],socialRecords:[],bonusRecords:[]};
    state.salaryRecords=[...(state.salaryRecords||[]).filter(r=>r.source==='manual'),...(a.salaryRecords||[]).filter(r=>r.status==='actual').map(FurusatoModel.clone)];
    state.socialRecords=[...(state.socialRecords||[]).filter(r=>r.source==='manual'),...(a.socialRecords||[]).filter(r=>r.status==='actual').map(FurusatoModel.clone)];
    state.bonusRecords=[...(state.bonusRecords||[]).filter(r=>r.source==='manual'),...(a.bonusRecords||[]).filter(r=>r.status==='actual').map(FurusatoModel.clone)];
    state.priorSalaryRecords=(state.yearPayrollRecords?.[String(targetYear-1)]?.salaryRecords||[]).filter(r=>r.status==='actual').map(FurusatoModel.clone);
    state.priorSocialRecords=(state.yearPayrollRecords?.[String(targetYear-1)]?.socialRecords||[]).filter(r=>r.status==='actual').map(FurusatoModel.clone);
    state.priorBonusRecords=(state.yearPayrollRecords?.[String(targetYear-1)]?.bonusRecords||[]).filter(r=>Number(r.amount)>0).map(FurusatoModel.clone);
  }
  function salaryMissing(x){
    const missing=[...(x.year?[]:['年']),...(x.month?[]:['月']),...(Number(x.grossTotal)>0?[]:['支給合計']),...(x.nonTaxableTotal!=null?[]:['非課税分']),...(Number(x.taxableGross)>0?[]:['課税対象額'])];
    for(const k of ['employmentInsurance','healthInsurance','healthInsuranceSpecial','nursingCare','pension'])if(!Number.isFinite(x.socialComponents?.[k]))missing.push(`社会保険料:${k}`);
    // Child-support is shown only on slips that contain that payroll row. Do
    // not label a historical slip as incomplete merely because the row is absent.
    if(x.childSupportLabelPresent&&!Number.isFinite(x.socialComponents?.childSupport))missing.push('社会保険料:childSupport');
    return [...new Set(missing)];
  }
  function bonusMissing(x){return [...new Set([...(x.year?[]:['年']),...(x.date?[]:['支給日']),...(Number(x.amount)>0?[]:['賞与額']),...(x.season?[]:['夏冬区分'])])];}
  function withholdingMissing(x){return [...new Set([...(x.year?[]:['年']),...(Number(x.annualSalary)>0?[]:['給与収入']),...(Number(x.salaryIncomeAfterDeduction)>0?[]:['給与所得控除後の金額']),...(Number(x.deductionsTotal)>0?[]:['所得控除の額の合計額']),...(Number(x.social)>=0?[]:['社会保険料等の金額']),...(Number(x.basicDeduction)>0?[]:['基礎控除'])])];}
  async function scanAndImport(state,onProgress,filesOverride){
    const targetYear=new Date().getFullYear(), priorYear=targetYear-1;
    state.year=targetYear; state.yearPayrollRecords=state.yearPayrollRecords&&typeof state.yearPayrollRecords==='object'?state.yearPayrollRecords:{};
    const files=Array.isArray(filesOverride)?filesOverride:await listCandidateFiles(targetYear);
    const result={files:files.length,added:0,review:0,skipped:0,errors:[],cacheHits:0,cacheMisses:0,downloads:0,parsed:0,salaryCandidates:files.filter(f=>f.candidateType==='salary').length,salaryImported:0,salaryReview:0,salaryParsed:0,salaryOcr:0,salaryRejected:0,candidates:files.map(f=>({name:f.name,type:f.candidateType,year:f.filenameYear}))};
    state.importHistory=Array.isArray(state.importHistory)?state.importHistory:[]; state.importFileDetails=[];
    debugLog('scan:start',{targetYear,priorYear,fileCount:files.length,candidates:result.candidates});
    for(const f of files){
      const fileStart=performance.now();
      debugLog('file:start',{name:f.name,fileId:f.id,candidateType:f.candidateType,filenameYear:f.filenameYear||null,modifiedTime:f.modifiedTime||'',size:f.size||''});
      try{
        const cached=findCachedDocument(state,f);
        if(cached){result.cacheHits++;result.skipped++;state.importFileDetails.push(cached.detail);debugLog('file:cacheHit',{name:f.name,fileId:f.id,year:cached.year,missingFields:cached.detail.missingFields||[]});continue;}
        result.cacheMisses++; result.downloads++; onProgress?.(`解析中: ${f.name}`);
        debugLog('file:downloadBegin',{name:f.name,fileId:f.id});
        const buf=await downloadPdf(f.id); debugLog('file:downloadOK',{name:f.name,bytes:buf.byteLength});
        let pdf=await pdfText(buf); debugLog('file:pdfTextOK',{name:f.name,textChars:String(pdf.text||'').length,textItemCount:Number(pdf.textItemCount||0),pageCount:Number(pdf.pageCount||0)});
        pdf=await ensurePdfText(buf,pdf,f.name);
        debugLog('file:ensureTextOK',{name:f.name,textChars:String(pdf.text||'').length,ocrTextChars:String(pdf.ocrText||'').length,ocrUsed:!!pdf.ocrUsed,ocrError:pdf.ocrError||'',ocrValidated:!!pdf.ocrValidated});
        result.parsed++;
        const text=pdf.text||'', detectedType=classifyPdfText(text,f.name), type=detectedType==='unknown'?({salary:'salary_slip',bonus:'bonus_slip',withholding:'withholding'}[f.candidateType]||detectedType):detectedType;
        debugLog('file:classified',{name:f.name,candidateType:f.candidateType,detectedType,type,textChars:String(text).length,textSample:String(text).slice(0,500)});
        let detail={name:f.name,id:f.id,driveFileId:f.id,type:f.candidateType,detectedType,filenameYear:f.filenameYear||null,modifiedTime:f.modifiedTime||'',size:f.size||'',signature:documentSignature(f),parserVersion:PARSED_DB_VERSION,textChars:String(text).length,textItemCount:pdf.textItemCount||0,rawText:text,ocrUsed:!!pdf.ocrUsed,ocrConfidence:pdf.ocrConfidence||0,ocrError:pdf.ocrError||'',ocrWordCount:pdf.ocrWordCount||0,ocrValidated:!!pdf.ocrValidated,pageCount:pdf.pageCount||0,pageMeta:pdf.pageMeta||[],ocrAttempts:pdf.ocrAttempts||[],readData:buildReadData(pdf,f.name)};
        if(type==='salary_slip'){
          debugLog('parser:salary:start',{name:f.name});
          const x=parseSalaryPdf(pdf,f.name); const missing=salaryMissing(x); Object.assign(detail,{year:x.year||null,month:x.month||null,gross:x.gross||0,taxableGross:x.taxableGross||0,grossTotal:x.grossTotal||0,nonTaxableTotal:x.nonTaxableTotal??null,social:x.social??null,socialComponents:x.socialComponents||{},components:x.components||[],unknownComponents:x.unknownComponents||[],needsReview:!!x.needsReview,missingFields:missing,parsed:x});
          debugLog('parser:salary:result',{name:f.name,year:x.year,month:x.month,gross:x.gross,taxableGross:x.taxableGross,grossTotal:x.grossTotal,nonTaxableTotal:x.nonTaxableTotal,social:x.social,socialComponents:x.socialComponents||{},unknownComponents:x.unknownComponents||[],missingFields:missing,needsReview:!!x.needsReview,arithmeticOk:x.arithmeticOk??null,textEvidence:{chars:String(text).length,sample:String(text).slice(0,1800)},fileMs:Math.round(performance.now()-fileStart)});
          if(pdf.ocrUsed)result.salaryOcr++;
          const inScope=Number(x.year)>=2024 && Number(x.year)<=Math.max(targetYear,new Date().getFullYear());
          debugLog('parser:salary:scope',{name:f.name,inScope,year:x.year,targetYear});
          if(!inScope){result.skipped++;archiveDocument(state,Number(x.year)||f.filenameYear,detail);state.importFileDetails.push(detail);debugLog('file:archiveOutOfScope',{name:f.name,year:x.year});continue;}
          archiveDocument(state,Number(x.year),detail);
          if(Number(x.year)>=2024&&Number(x.year)<=Math.max(targetYear,new Date().getFullYear())&&x.taxableGross>0&&!x.needsReview){
            archiveRow(state,Number(x.year),'salaryRecords',{...x,year:Number(x.year),source:'google-drive',status:'actual',document:f.name,driveFileId:f.id,modifiedTime:f.modifiedTime||'',size:f.size||'',needsReview:false},r=>String(r.month));
            if(x.social!=null)archiveRow(state,Number(x.year),'socialRecords',{year:Number(x.year),month:x.month,amount:x.social,components:x.socialComponents||{},source:'google-drive',status:'actual',document:f.name,driveFileId:f.id,modifiedTime:f.modifiedTime||'',size:f.size||'',needsReview:false},r=>String(r.month));
            result.added++;result.salaryImported++;result.salaryParsed++; debugLog('file:salarySaved',{name:f.name,year:x.year,month:x.month,taxableGross:x.taxableGross,social:x.social});
          }else{result.review++;result.salaryReview++;result.salaryRejected++;debugLog('file:salaryReview',{name:f.name,year:x.year,month:x.month,missingFields:missing,needsReview:!!x.needsReview,reason:missing.length?`missing:${missing.join('|')}`:'parser marked needsReview'});}
        }else if(type==='bonus_slip'){
          debugLog('parser:bonus:start',{name:f.name});
          const x=parseBonusPdf(pdf,f.name); Object.assign(detail,{year:x.year||null,month:x.month||null,date:x.date||null,amount:x.amount||0,social:x.social??null,socialComponents:x.socialComponents||{},standardBonusHealth:x.standardBonusHealth,standardBonusPension:x.standardBonusPension,components:x.socialComponents||{},unknownComponents:x.unknownComponents||[],needsReview:!!x.needsReview,missingFields:bonusMissing(x),parsed:x});
          debugLog('parser:bonus:result',{name:f.name,year:x.year,date:x.date,amount:x.amount,social:x.social,socialComponents:x.socialComponents||{},unknownComponents:x.unknownComponents||[],missingFields:detail.missingFields,needsReview:!!x.needsReview});
          if(!(Number(x.year)>=2024 && Number(x.year)<=Math.max(targetYear,new Date().getFullYear()))){result.skipped++;archiveDocument(state,Number(x.year)||f.filenameYear,detail);state.importFileDetails.push(detail);debugLog('file:archiveOutOfScope',{name:f.name,year:x.year});continue;}
          archiveDocument(state,Number(x.year),detail);
          if(x.date&&x.amount&&Number(x.year)>=2024&&Number(x.year)<=Math.max(targetYear,new Date().getFullYear())&&!x.needsReview){archiveRow(state,Number(x.year),'bonusRecords',{...x,year:Number(x.year),source:'google-drive',status:'actual',document:f.name,driveFileId:f.id,modifiedTime:f.modifiedTime||'',size:f.size||'',needsReview:false},r=>String(r.date||'')); if(x.social!=null)archiveRow(state,Number(x.year),'bonusSocialRecords',{date:x.date,month:x.month,season:x.season,amount:x.social,components:x.socialComponents||{},standardBonusHealth:x.standardBonusHealth,standardBonusPension:x.standardBonusPension,source:'google-drive',status:'actual'},r=>String(r.date||'')); result.added++;debugLog('file:bonusSaved',{name:f.name,year:x.year,date:x.date,amount:x.amount,social:x.social});}
          else {result.review++;debugLog('file:bonusReview',{name:f.name,missingFields:detail.missingFields,needsReview:!!x.needsReview});}
        }else if(type==='withholding'){
          debugLog('parser:withholding:start',{name:f.name});
          const x=parseWithholdingPdf(pdf,f.name); const missing=withholdingMissing(x); Object.assign(detail,{year:x.year||null,annualSalary:x.annualSalary||0,salaryIncomeAfterDeduction:x.salaryIncomeAfterDeduction||0,deductionsTotal:x.deductionsTotal||0,social:x.social??null,incomeTax:x.incomeTax||0,lifeInsuranceDeduction:x.lifeInsuranceDeduction||0,earthquakeInsuranceDeduction:x.earthquakeInsuranceDeduction||0,housingLoanDeduction:x.housingLoanDeduction||0,specialDependent:x.specialDependent||0,basicDeduction:x.basicDeduction||0,incomeAdjustment:x.incomeAdjustment||0,newLifeInsurance:x.newLifeInsurance||0,oldLifeInsurance:x.oldLifeInsurance||0,nursingInsurance:x.nursingInsurance||0,newPension:x.newPension||0,oldPension:x.oldPension||0,ideco:x.ideco||0,smallBusinessDeduction:x.smallBusinessDeduction||0,needsReview:false,missingFields:missing,parsed:x});
          debugLog('parser:withholding:result',{name:f.name,year:x.year,annualSalary:x.annualSalary,salaryIncomeAfterDeduction:x.salaryIncomeAfterDeduction,deductionsTotal:x.deductionsTotal,social:x.social,incomeTax:x.incomeTax,basicDeduction:x.basicDeduction,missingFields:missing});
          if(!(Number(x.year)>=2024 && Number(x.year)<=Math.max(targetYear,new Date().getFullYear()))){result.skipped++;archiveDocument(state,Number(x.year)||f.filenameYear,detail);state.importFileDetails.push(detail);debugLog('file:archiveOutOfScope',{name:f.name,year:x.year});continue;}
          archiveDocument(state,Number(x.year),detail);
          state.withholdingRecords=Array.isArray(state.withholdingRecords)?state.withholdingRecords:[]; const wi=state.withholdingRecords.findIndex(w=>Number(w.year)===Number(x.year)); if(wi>=0)state.withholdingRecords[wi]=FurusatoModel.clone(x);else state.withholdingRecords.push(FurusatoModel.clone(x));
          const yr=Number(x.year); const prev=state.yearRecords?.[String(yr)]||{}; state.yearRecords=state.yearRecords||{}; state.yearRecords[String(yr)]={...prev,year:yr,status:'confirmed',withholding:FurusatoModel.clone(x),manual:{...(prev.manual||{}),nationalPension:Number(prev.manual?.nationalPension)||0},updatedAt:prev.updatedAt||new Date().toISOString()};
          state.sourceDocuments=Array.isArray(state.sourceDocuments)?state.sourceDocuments:[]; const si=state.sourceDocuments.findIndex(d=>String(d.driveFileId||d.file||'')===String(f.id)); const doc={...x,file:f.name,type:'withholding',driveFileId:f.id,source:'google-drive',status:'imported'}; if(si>=0)state.sourceDocuments[si]=doc;else state.sourceDocuments.push(doc); result.added++;debugLog('file:withholdingSaved',{name:f.name,year:x.year});
        }else{result.skipped++;archiveDocument(state,Number(f.filenameYear)||targetYear,detail);debugLog('file:unknownType',{name:f.name,detectedType,type});}
        state.importFileDetails.push(detail);
        const readFailed=!!detail.ocrError || (!Number(detail.textChars||0) && !String(detail.rawText||detail.readData?.pdfText||'').trim() && !String(detail.readData?.ocrText||'').trim());
        const historyStatus=readFailed?'解析失敗':(detail.missingFields?.length?'確認待ち':'取り込み済み');
        recordHistory(state,{at:new Date().toISOString(),name:f.name,type:f.candidateType||type,year:detail.year||f.filenameYear||null,month:detail.month||null,status:historyStatus,missingFields:detail.missingFields||[],reason:readFailed?(detail.ocrError||'PDF文字抽出・OCRの両方で有効な文字を取得できませんでした'):undefined,cache:'miss'});
        debugLog('file:done',{name:f.name,status:historyStatus,missingFields:detail.missingFields||[],readFailed,fileMs:Math.round(performance.now()-fileStart)});
      }catch(e){
        const error={name:f.name,fileId:f.id,stage:'file:error',error:e?.stack||e?.message||String(e),fileMs:Math.round(performance.now()-fileStart)};
        result.errors.push(`${f.name}: ${e.message}`); recordHistory(state,{at:new Date().toISOString(),name:f.name,type:f.candidateType||'other',year:f.filenameYear||null,status:'エラー',reason:e.message});
        debugLog('file:error',error);
        state.importFileDetails.push({name:f.name,id:f.id,driveFileId:f.id,type:f.candidateType,filenameYear:f.filenameYear||null,parserVersion:PARSED_DB_VERSION,status:'error',error:e?.message||String(e),errorStack:e?.stack||'',missingFields:['解析エラー'],readData:{version:'20260926-readout11',document:f.name,pdfText:'',ocrText:'',lines:[],numericValues:[]}});
      }
    }
    hydrateLiveTarget(state,targetYear);
    const actualMonths=(state.salaryRecords||[]).filter(r=>r.status==='actual'&&Number(r.month)>=1&&Number(r.month)<=12&&Number(r.taxableGross)>0).map(r=>Number(r.month)); const actualThrough=actualMonths.length?Math.max(...actualMonths):0; state.actualThrough=actualThrough; buildForecastFromPrior(state,targetYear,actualThrough);
    const persistedDebug=getPersistedDebugLog();
    state.importDiagnostics={at:new Date().toISOString(),debugVersion:DEBUG_VERSION,debugSessionId, targetYear,priorYear,files:result.files,cacheHits:result.cacheHits,cacheMisses:result.cacheMisses,downloads:result.downloads,parsed:result.parsed,salaryCandidates:result.salaryCandidates,salaryImported:result.salaryImported,salaryParsed:result.salaryParsed,salaryOcr:result.salaryOcr,salaryRejected:result.salaryRejected,errors:result.errors.slice(),fileDetails:state.importFileDetails||[],runtimeReadout:persistedDebug.slice(-500)};
    state.importSettings={...(state.importSettings||{}),targetYear,priorYear};
    debugLog('scan:done',{files:result.files,cacheHits:result.cacheHits,cacheMisses:result.cacheMisses,downloads:result.downloads,parsed:result.parsed,salaryImported:result.salaryImported,salaryReview:result.salaryReview,review:result.review,errors:result.errors.length,debugEvents:persistedDebug.length});
    return result;
  }
  function buildYearCalculationState(sourceState,year){
    const y=Number(year)||new Date().getFullYear();
    const t=FurusatoModel.clone(sourceState||{});
    const archive=sourceState?.yearPayrollRecords?.[String(y)]||{year:y,salaryRecords:[],socialRecords:[],bonusRecords:[],documents:[]};
    const record=(sourceState?.yearRecords||{})[String(y)]||{year:y,manual:{}};
    const actualOnly=a=>(a||[]).filter(r=>r.status==='actual').map(FurusatoModel.clone);
    t.year=y;
    const manual=record.manual||{};
    t.deductions={...(t.deductions||{})};
    if(manual.lifeInsurance)t.deductions.lifeInsurance=FurusatoModel.clone(manual.lifeInsurance);
    if(manual.earthquakeDetail)t.deductions.earthquakeDetail=FurusatoModel.clone(manual.earthquakeDetail);
    if(manual.ideco!=null)t.deductions.ideco=Number(manual.ideco)||0;
    if(manual.otherBreakdown)t.deductions.otherBreakdown=FurusatoModel.clone(manual.otherBreakdown);
    if(manual.other!=null)t.deductions.other=Number(manual.other)||0;
    t.adjustments={...(t.adjustments||{})};
    if(manual.temporary!=null)t.adjustments.temporary=Number(manual.temporary)||0;
    if(manual.temporaryTaxable!=null)t.adjustments.temporaryTaxable=manual.temporaryTaxable!==false;
    if(manual.otherIncome!=null)t.adjustments.otherIncome=Number(manual.otherIncome)||0;
    if(manual.dependents)t.family={...(t.family||{}),dependents:FurusatoModel.clone(manual.dependents)};
    if(manual.spouse)t.family={...(t.family||{}),spouse:FurusatoModel.clone(manual.spouse)};
    t.salaryRecords=actualOnly(archive.salaryRecords);
    t.socialRecords=actualOnly(archive.socialRecords);
    t.bonusRecords=actualOnly(archive.bonusRecords);
    t.bonusSocialRecords=t.bonusRecords.filter(x=>x.social!=null).map(x=>({date:x.date,month:x.month,season:x.season,amount:Number(x.social)||0,components:x.socialComponents||x.components||{},standardBonusHealth:x.standardBonusHealth,standardBonusPension:x.standardBonusPension,source:x.source||'database',status:'actual'}));
    t.yearRecords={[String(y)]:{...record,year:y,manual:{...(record.manual||{})}}};
    if(record.withholding){
      return {year:y,mode:'confirmed',archive,record,state:t,result:FurusatoCalculator.historicalCalc(record,record.manual||{})};
    }
    const currentCalendarYear=new Date().getFullYear();
    if(y===currentCalendarYear){
      const prior=sourceState?.yearPayrollRecords?.[String(y-1)]||{salaryRecords:[],socialRecords:[],bonusRecords:[]};
      t.priorSalaryRecords=actualOnly(prior.salaryRecords); t.priorSocialRecords=actualOnly(prior.socialRecords); t.priorBonusRecords=actualOnly(prior.bonusRecords);
      const months=t.salaryRecords.filter(r=>Number(r.month)>=1&&Number(r.month)<=12&&Number(r.taxableGross??r.gross)>0).map(r=>Number(r.month));
      const through=months.length?Math.max(...months):0; t.actualThrough=through;
      buildForecastFromPrior(t,y,through);
      return {year:y,mode:'forecast',archive,record,state:t,result:FurusatoCalculator.calc(t)};
    }
    t.forecastSalary=[];t.forecastSocial=[];t.forecastBonus=0;t.forecastBonusBreakdown=[];t.bonusSocialRecords=t.bonusSocialRecords.filter(x=>x.status==='actual');
    return {year:y,mode:'actual',archive,record,state:t,result:FurusatoCalculator.calc(t)};
  }
  return {buildYearCalculationState,RUNTIME_BUILD,CLIENT_KEY,DEBUG_VERSION,getClientId,setClientId,ready,authorize,signOut,listCandidateFiles,scanAndImport,classifyPdfText,parseSalaryPdf,parseBonusPdf,parseWithholdingPdf,extractLabeledNumber,extractToyotaPayrollAmount,extractExactYenAfterLabel,upsertSalaryRecord,upsertBonusRecord,ensurePdfText,getRuntimeDiagnostics,getPersistedDiagnostics,clearRuntimeDiagnostics,clearPersistedDebugLog,getLastOcrImageDataUrl:()=>lastOcrImageDataUrl};
})();
if(typeof window!=='undefined')window.FurusatoGoogleDrive=FurusatoGoogleDrive;
if(typeof module!=='undefined')module.exports={FurusatoImport,FurusatoGoogleDrive};
