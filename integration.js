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
    m=n.match(/(20\d{2})(0[1-9]|1[0-2])(?!\d)/); if(m)return Number(m[1]);
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
  async function downloadPdf(fileId){if(!accessToken)await authorize();const r=await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,{headers:{Authorization:`Bearer ${accessToken}`}});if(!r.ok)throw new Error(`Drive download failed: ${r.status}`);return await r.arrayBuffer()}
  async function pdfText(arrayBuffer){
    if(!window.pdfjsLib)await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
    const pdf=window.pdfjsLib||window.pdfjs;if(!pdf)throw new Error('PDF解析ライブラリを読み込めませんでした');
    if(pdf.GlobalWorkerOptions)pdf.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    // IMPORTANT: never let PDF.js own the caller's ArrayBuffer. Opening from a
    // Blob URL also prevents PDF.js/worker transfer from detaching the bytes that
    // the import pipeline may still need later.
    const bytes=arrayBuffer instanceof ArrayBuffer?new Uint8Array(arrayBuffer.slice(0)):arrayBuffer;
    const blob=new Blob([bytes],{type:'application/pdf'});
    const url=URL.createObjectURL(blob);
    try{
      const doc=await pdf.getDocument({url,disableWorker:true}).promise;
      let text=''; const pages=[];
      for(let i=1;i<=doc.numPages;i++){
        const page=await doc.getPage(i); const c=await page.getTextContent();
        const items=(c.items||[]).filter(x=>String(x.str||'').trim()).map(x=>({str:String(x.str||''),x:Number(x.transform?.[4]||0),y:Number(x.transform?.[5]||0),width:Number(x.width||0),height:Number(x.height||0)}));
        pages.push(items); text+=items.map(x=>x.str).join(' ')+'\n';
      }
      return {text,pages,pageCount:doc.numPages,textItemCount:pages.reduce((a,p)=>a+p.length,0),ocrUsed:false,pdfDoc:doc};
    }finally{URL.revokeObjectURL(url)}
  }
  async function ocrPageFromPdfDoc(doc,region=null){
    if(!doc)throw new Error('OCR用PDFドキュメントがありません');
    const page=await doc.getPage(1);
    const full=page.getViewport({scale:Number(region?.scale)||2.2});
    const r=region||{x0:0,y0:0,x1:1,y1:1};
    const sx=Math.max(0,Math.min(1,Number(r.x0)||0)),sy=Math.max(0,Math.min(1,Number(r.y0)||0));
    const ex=Math.max(sx,Math.min(1,Number(r.x1)==null?1:Number(r.x1))),ey=Math.max(sy,Math.min(1,Number(r.y1)==null?1:Number(r.y1)));
    const canvas=document.createElement('canvas');
    const cw=Math.max(1,Math.round(full.width*(ex-sx))),ch=Math.max(1,Math.round(full.height*(ey-sy)));
    canvas.width=cw;canvas.height=ch;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    const transform=[1,0,0,1,-full.width*sx,-full.height*sy];
    await page.render({canvasContext:ctx,viewport:full,transform}).promise;
    if(!window.Tesseract)await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js');
    if(!window.Tesseract?.recognize)throw new Error('OCRライブラリを読み込めませんでした');
    // Use the one-shot API. This avoids reusing a worker-backed buffer between
    // recognitions, which was the source of "Buffer is already detached" on iOS.
    const rOcr=await window.Tesseract.recognize(canvas,'jpn+eng',{tessedit_pageseg_mode:'12',preserve_interword_spaces:'1'});
    return {text:String(rOcr?.data?.text||''),pages:[],pageCount:doc.numPages,textItemCount:0,ocrUsed:true,ocrConfidence:Number(rOcr?.data?.confidence||0)};
  }
  async function ensurePdfText(arrayBuffer,pdf,name){
    const base=pdf||await pdfText(arrayBuffer);
    const type=candidateTypeFromName(name);
    if(type!=='salary')return base;
    const first=parseSalaryComponents(base);
    // If the text/layout parser can already recover the tax base, do NOT invoke
    // OCR at all. Salary import must not fail merely because OCR is unavailable.
    const needsTaxOcr=first.taxableGross==null;
    const needsSocialOcr=first.socialTotal==null;
    if(!needsTaxOcr&&!needsSocialOcr)return base;
    // First try a deterministic arithmetic recovery from the payroll totals.
    // Toyota's slip explicitly prints Total Payment and Non-taxable Amount.
    const derived=(first.grossTotal!=null&&first.nonTaxableTotal!=null&&first.grossTotal>=first.nonTaxableTotal)?first.grossTotal-first.nonTaxableTotal:null;
    if(needsTaxOcr&&derived!=null){
      return {...base,taxableGrossRecovered:derived};
    }
    try{
      let ocr=await ocrPageFromPdfDoc(base.pdfDoc,{x0:0,y0:0.80,x1:0.62,y1:1,scale:2.8});
      let second=parseSalaryComponents(ocr);
      if(needsTaxOcr&&second.taxableGross==null){
        ocr=await ocrPageFromPdfDoc(base.pdfDoc,null);
        second=parseSalaryComponents(ocr);
      }
      const merged={...base,ocrUsed:true,ocrConfidence:ocr.ocrConfidence||0,ocrText:ocr.text||'',ocrMissingBefore:{taxable:needsTaxOcr,social:needsSocialOcr}};
      if(needsTaxOcr&&second.taxableGross!=null)merged.ocrRecoveredTaxable=true;
      if(needsSocialOcr&&second.socialTotal!=null)merged.ocrRecoveredSocial=true;
      return merged;
    }catch(e){
      // OCR is an optional fallback. Never turn a readable payroll PDF into a
      // failed salary import because an iOS OCR runtime is unavailable.
      return {...base,ocrUsed:true,ocrError:e?.message||String(e)};
    }
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
    m=String(name).match(/(20\d{2})(0[1-9]|1[0-2])(?!\d)/); if(m)return {year:Number(m[1]),month:Number(m[2])};
    m=s.match(/(20\d{2})年\s*(\d{1,2})月/); if(m)return {year:Number(m[1]),month:Number(m[2])};
    m=s.match(/(20\d{2})[/-](\d{1,2})(?:[/-]\d{1,2})?/); if(m)return {year:Number(m[1]),month:Number(m[2])};
    m=s.match(/(20\d{2})(0[1-9]|1[0-2])(?!\d)/); if(m)return {year:Number(m[1]),month:Number(m[2])};
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
  function parseSalaryComponents(text){
    const s=cleanPdfText(typeof text==='string'?text:text?.text||'');
    const taxableAmount=extractToyotaPayrollAmount(text,['課税対象額','Taxable Amount','課税支給額','Taxable Pay']);
    const grossTotal=extractToyotaPayrollAmount(text,['支給合計 (A)','支給合計（A)','支給合計','Total Payment','総支給額']);
    const nonTaxableTotal=extractToyotaPayrollAmount(text,['内 通勤補助費等非課税分','内通勤補助費等非課税分','Non-taxable Amount']);
    const socialLabels={
      employmentInsurance:['雇用保険料'],
      healthInsurance:['健康保険料（基本','健康保険料 (基本','健康保険料（基本）'],
      healthInsuranceSpecial:['健康保険料（特定','健康保険料 (特定','健康保険料（特定）'],
      nursingCare:['介護保険料'],
      childSupport:['子ども・子育て支援金'],
      pension:['年金保険料','厚生年金保険料']
    };
    const socialComponents={};
    for(const [k,labels] of Object.entries(socialLabels)) socialComponents[k]=extractLabeledNumber(text,labels);
    const socialKnown=Object.values(socialComponents).filter(v=>Number.isFinite(v));
    const socialTotal=socialKnown.length===Object.keys(socialComponents).length?socialKnown.reduce((a,v)=>a+v,0):null;
    const derivedTaxable=(grossTotal!=null&&nonTaxableTotal!=null&&grossTotal>=nonTaxableTotal)?grossTotal-nonTaxableTotal:null;
    // Toyota's slip explicitly gives Total Payment and the non-taxable portion.
    // That arithmetic is more reliable than a text-layer match because the
    // English phrase "Taxable Amount" can occur inside "Non-taxable Amount".
    // When both totals are available, use the derived tax base and retain the
    // label-derived value only as diagnostic information.
    const taxableBase=derivedTaxable!=null?derivedTaxable:(taxableAmount!=null?taxableAmount:null);
    const grossComponents=[];
    const base=extractLabeledNumber(text,['基準賃金等','基本給']);
    const commuting=extractLabeledNumber(text,['通勤費補助','通勤手当']);
    const stockSubsidy=extractLabeledNumber(text,['持株会補助手当','持株会補助']);
    if(base!=null)grossComponents.push({label:'基準賃金等',amount:base,taxTreatment:'taxable',source:'explicit'});
    if(commuting!=null){
      const nonTaxable=nonTaxableTotal!=null?Math.min(commuting,nonTaxableTotal):null;
      const taxable=nonTaxable!=null?Math.max(0,commuting-nonTaxable):null;
      grossComponents.push({label:'通勤費補助',amount:commuting,taxTreatment:taxable!=null?'mixed':'unknown',taxableAmount:taxable,nonTaxableAmount:nonTaxable,source:'explicit'});
    }
    if(stockSubsidy!=null)grossComponents.push({label:'持株会補助手当',amount:stockSubsidy,taxTreatment:'taxable',source:'explicit'});
    const unknown=[];
    if(taxableBase==null) unknown.push('課税対象額');
    return {grossTotal,taxableGross:taxableBase,nonTaxableTotal,socialComponents,socialTotal,grossComponents,unknownComponents:unknown,needsReview:taxableBase==null||socialTotal==null};
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
      if(c.taxableGross==null&&o.taxableGross!=null)c={...c,taxableGross:o.taxableGross};
      if(c.grossTotal==null&&o.grossTotal!=null)c={...c,grossTotal:o.grossTotal};
      if(c.nonTaxableTotal==null&&o.nonTaxableTotal!=null)c={...c,nonTaxableTotal:o.nonTaxableTotal};
      if(c.socialTotal==null&&o.socialTotal!=null)c={...c,socialTotal:o.socialTotal,socialComponents:o.socialComponents};
      if(!c.components?.length&&o.grossComponents?.length)c={...c,grossComponents:o.grossComponents};
    }
    const taxableGross=Number.isFinite(c.taxableGross)&&c.taxableGross>0?c.taxableGross:null;
    const grossTotal=Number.isFinite(c.grossTotal)&&c.grossTotal>0?c.grossTotal:null;
    return {year:d.year,month:d.month,gross:taxableGross,taxableGross,grossTotal,nonTaxableTotal:c.nonTaxableTotal,social:c.socialTotal,socialComponents:c.socialComponents,components:c.grossComponents,unknownComponents:c.unknownComponents,source:'google-drive',status:'actual',document:name,needsReview:taxableGross==null||c.socialTotal==null};
  }
  function filenameDateFallback(name){
    const n=String(name||'');
    let m=n.match(/(20\d{2})[-_](0[1-9]|1[0-2])(?:[-_]\d{1,2})?/);
    if(m)return {year:Number(m[1]),month:Number(m[2])};
    m=n.match(/(20\d{2})(0[1-9]|1[0-2])(?!\d)/);
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
  function parseBonusPdf(text,name){
    const raw=typeof text==='string'?text:(text?.text||''); const d=extractDateParts(raw,name),s=cleanPdfText(raw);
    const amount=extractLabeledNumber(text,['支給合計 (A)','支給合計（A)','Total Payment','支給額']);
    const taxableGross=extractLabeledNumber(text,['課税対象額','Taxable Amount']);
    const socialLabels={employmentInsurance:['雇用保険料'],healthInsurance:['健康保険料（基本','健康保険料 (基本'],healthInsuranceSpecial:['健康保険料（特定','健康保険料 (特定'],nursingCare:['介護保険料'],childSupport:['子ども・子育て支援金'],pension:['年金保険料','厚生年金保険料']};
    const socialComponents={}; for(const [k,labels] of Object.entries(socialLabels)) socialComponents[k]=extractLabeledNumber(text,labels);
    const socialValues=Object.values(socialComponents).filter(v=>Number.isFinite(v)); const social=socialValues.length===Object.keys(socialComponents).length?socialValues.reduce((a,v)=>a+v,0):null;
    const standardHealth=extractStandardBonusHealth(text);
    const standardPension=extractStandardBonusPension(text);
    const date=d.year&&d.month?`${d.year}-${String(d.month).padStart(2,'0')}`:'';
    return {year:d.year,month:d.month,date,amount,taxableGross:taxableGross||amount,social,socialComponents,standardBonusHealth:standardHealth!=null?standardHealth*1000:null,standardBonusPension:standardPension!=null?standardPension*1000:null,source:'google-drive',status:'actual',document:name,needsReview:!(date&&amount)||social==null};
  }
  function parseWithholdingPdf(text,name){
    const raw=typeof text==='string'?text:(text?.text||''); const d=extractDateParts(raw,name),s=cleanPdfText(raw); const annualSalary=extractNumberAfter(s,[/(?:支払金額|給与等の支払金額|支払金額\s*\(a\))\s*[^\d]{0,60}([\d,]{5,})/i]); const social=extractNumberAfter(s,[/(?:社会保険料等の金額)\s*[^\d]{0,60}([\d,]{4,})/i]); const incomeTax=extractNumberAfter(s,[/(?:源泉徴収税額)\s*[^\d]{0,60}([\d,]{4,})/i]); return {year:d.year,annualSalary,social,incomeTax,document:name,source:'google-drive'};
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
    const season=m=>Number(m)>=10?'winter':'summer';
    const bonusMonth=x=>Number(String(x.date||'').slice(5,7))||Number(x.month)||0;
    let forecastBonus=0;
    state.bonusSocialRecords=(state.bonusSocialRecords||[]).filter(x=>x.status!=='forecast');
    for(const s of ['summer','winter']){
      const currentSeason=currentBonus.filter(x=>season(bonusMonth(x))===s);
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
    if(!(x.year===targetYear&&x.month&&Number(x.taxableGross)>0))return false;
    result.salaryParsed++; state.salaryRecords=state.salaryRecords||[];
    state.salaryRecords=state.salaryRecords.filter(r=>Number(r.month)!==x.month||r.source==='manual');
    state.salaryRecords.push({year:targetYear,month:x.month,gross:x.taxableGross,taxableGross:x.taxableGross,grossTotal:x.grossTotal,nonTaxableTotal:x.nonTaxableTotal,components:x.components||[],source:'google-drive',status:'actual',document:f.name,driveFileId:f.id,needsReview:x.needsReview});
    if(x.social!=null){state.socialRecords=state.socialRecords||[];state.socialRecords=state.socialRecords.filter(r=>Number(r.month)!==x.month||r.source==='manual');state.socialRecords.push({year:targetYear,month:x.month,amount:x.social,components:x.socialComponents||{},source:'google-drive',status:'actual',document:f.name,driveFileId:f.id,needsReview:false})}
    if(x.needsReview){result.review++;result.salaryReview++}result.added++;result.salaryImported++; return true;
  }
  function upsertBonusRecord(state,x,f,targetYear,result){
    if(!(x.date&&x.amount))return false;
    if(x.year===targetYear){
      state.bonusRecords=state.bonusRecords||[];state.bonusRecords=state.bonusRecords.filter(r=>r.date!==x.date||r.source==='manual');state.bonusRecords.push({...x,driveFileId:f.id});
      if(x.social!=null){state.bonusSocialRecords=state.bonusSocialRecords||[];state.bonusSocialRecords=state.bonusSocialRecords.filter(r=>r.date!==x.date||r.source==='manual');state.bonusSocialRecords.push({date:x.date,month:x.month,amount:x.social,components:x.socialComponents||{},standardBonusHealth:x.standardBonusHealth,standardBonusPension:x.standardBonusPension,source:'google-drive',status:'actual',document:f.name,driveFileId:f.id,needsReview:false})}
      result.added++;return true;
    }
    return false;
  }
  async function scanAndImport(state,onProgress,filesOverride){
    const targetYear=Number(state.importSettings?.targetYear||state.year||new Date().getFullYear()); const priorYear=targetYear-1; state.year=targetYear;
    const files=Array.isArray(filesOverride)?filesOverride:await listCandidateFiles(targetYear);
    const result={files:files.length,added:0,review:0,skipped:0,errors:[],salaryCandidates:files.filter(f=>f.candidateType==='salary').length,salaryImported:0,salaryReview:0,salaryParsed:0,salaryOcr:0,salaryRejected:0,candidates:files.map(f=>({name:f.name,type:f.candidateType,year:f.filenameYear}))}; state.importHistory=Array.isArray(state.importHistory)?state.importHistory:[];
    state.priorSalaryRecords=(state.priorSalaryRecords||[]).filter(x=>Number(x.year)===priorYear); state.priorBonusRecords=(state.priorBonusRecords||[]).filter(x=>Number(x.year)===priorYear); state.priorSocialRecords=(state.priorSocialRecords||[]).filter(x=>Number(x.year)===priorYear);
    for(const f of files){
      try{
        onProgress?.(`解析中: ${f.name}`); const buf=await downloadPdf(f.id); let pdf=await pdfText(buf); pdf=await ensurePdfText(buf,pdf,f.name); const text=pdf.text,detectedType=classifyPdfText(text,f.name),type=detectedType==='unknown' ? ({salary:'salary_slip',bonus:'bonus_slip',withholding:'withholding'}[f.candidateType]||detectedType) : detectedType;
        if(type==='salary_slip'){
          const x=parseSalaryPdf(pdf,f.name); x.ocrUsed=!!pdf.ocrUsed; if(x.ocrUsed)result.salaryOcr++; x.ocrConfidence=pdf.ocrConfidence||0; x.textItemCount=pdf.textItemCount||0; x.textChars=String(pdf.text||'').length; x.ocrError=pdf.ocrError||''; const inScope=[targetYear,priorYear].includes(Number(x.year));
          if(!inScope){result.skipped++; recordHistory(state,{at:new Date().toISOString(),name:f.name,type:'salary',year:x.year||f.filenameYear||null,status:'対象外',reason:'対象年/前年ではない'});continue}
          if(upsertSalaryRecord(state,x,f,targetYear,result)){
            recordHistory(state,{at:new Date().toISOString(),name:f.name,type:'salary',year:x.year,month:x.month,status:'取り込み済み',taxableGross:x.taxableGross,grossTotal:x.grossTotal,social:x.social,needsReview:!!x.needsReview,ocrUsed:!!x.ocrUsed,ocrConfidence:x.ocrConfidence||0,textChars:x.textChars||0,textItemCount:x.textItemCount||0,ocrError:x.ocrError||''});
          } else if(x.year===priorYear&&x.month&&x.gross){uniquePush(state.priorSalaryRecords,{year:priorYear,month:x.month,gross:x.taxableGross,taxableGross:x.taxableGross,grossTotal:x.grossTotal,nonTaxableTotal:x.nonTaxableTotal,components:x.components||[],source:'google-drive',status:'prior',document:f.name,driveFileId:f.id,needsReview:x.needsReview},v=>`${v.year}-${v.month}-${v.document}`);if(x.social!=null)uniquePush(state.priorSocialRecords,{year:priorYear,month:x.month,amount:x.social,components:x.socialComponents||{},source:'google-drive',status:'prior',document:f.name,driveFileId:f.id},v=>`${v.year}-${v.month}-${v.document}`);result.added++;recordHistory(state,{at:new Date().toISOString(),name:f.name,type:'salary',year:x.year,month:x.month,status:'前年保存',taxableGross:x.taxableGross,grossTotal:x.grossTotal,social:x.social,needsReview:!!x.needsReview,ocrUsed:!!x.ocrUsed,ocrConfidence:x.ocrConfidence||0,textChars:x.textChars||0,textItemCount:x.textItemCount||0,ocrError:x.ocrError||''});}else {result.review++; if(f.candidateType==='salary'){result.salaryReview++;result.salaryRejected++;}recordHistory(state,{at:new Date().toISOString(),name:f.name,type:'salary',year:x.year||f.filenameYear||null,month:x.month||null,status:'確認待ち',taxableGross:x.taxableGross,grossTotal:x.grossTotal,social:x.social,needsReview:true,reason:`給与登録できませんでした：課税対象額=${x.taxableGross==null?'取得失敗':x.taxableGross}／支給合計=${x.grossTotal==null?'取得失敗':x.grossTotal}／非課税=${x.nonTaxableTotal==null?'取得失敗':x.nonTaxableTotal}／年月=${x.year||f.filenameYear||'不明'}-${x.month||'不明'}／OCR=${x.ocrUsed?'実行':'未実行'}${x.ocrError?`／OCRエラー=${x.ocrError}`:''}／文字数=${x.textChars||0}／文字項目=${x.textItemCount||0}`});}
        }else if(type==='bonus_slip'){
          const x=parseBonusPdf(pdf,f.name); if(![targetYear,priorYear].includes(Number(x.year))){result.skipped++;continue}
          if(!upsertBonusRecord(state,x,f,targetYear,result) && x.year===priorYear && x.date&&x.amount){state.priorBonusRecords=state.priorBonusRecords||[];uniquePush(state.priorBonusRecords,{year:priorYear,date:x.date,month:x.month,amount:x.amount,social:x.social,socialComponents:x.socialComponents||{},standardBonusHealth:x.standardBonusHealth,standardBonusPension:x.standardBonusPension,source:'prior',status:'prior',document:f.name,driveFileId:f.id},v=>`${v.date}-${v.document}`);result.added++;state.importHistory.unshift({at:new Date().toISOString(),name:f.name,type:'bonus',year:x.year||f.filenameYear||null,date:x.date||null,status:'取り込み済み',amount:x.amount||null,social:x.social||null,needsReview:!!x.needsReview});}else if(!(x.date&&x.amount)){result.review++;state.importHistory.unshift({at:new Date().toISOString(),name:f.name,type:'bonus',year:x.year||f.filenameYear||null,status:'確認待ち',amount:x.amount||null,social:x.social||null,needsReview:true,reason:'賞与額または年月を取得できませんでした'});}
        }else if(type==='withholding'){
          const x=parseWithholdingPdf(text,f.name); if(x.year&&![targetYear,priorYear].includes(Number(x.year))){result.skipped++;continue}
          state.sourceDocuments=state.sourceDocuments||[];const old=state.sourceDocuments.find(d=>d.file===f.name);const doc={file:f.name,type,status:'imported',source:'google-drive',driveFileId:f.id,note:`源泉徴収票を取得。${x.year===priorYear?'前年参考値として保持':'対象年の参考資料として保持'}。`,annualSalary:x.annualSalary||0,social:x.social||0,incomeTax:x.incomeTax||0,year:x.year||null};if(old)Object.assign(old,doc);else state.sourceDocuments.push(doc);
          if(x.year===priorYear){state.prior=state.prior||{salary:0,bonus:0,social:0};if(x.annualSalary)state.prior.salary=x.annualSalary;if(x.social)state.prior.social=x.social} result.review++;
        }else {result.skipped++;state.importHistory.unshift({at:new Date().toISOString(),name:f.name,type:type||f.candidateType||'other',year:f.filenameYear||null,status:'対象外'});}
      }catch(e){result.errors.push(`${f.name}: ${e.message}`);recordHistory(state,{at:new Date().toISOString(),name:f.name,type:f.candidateType||'other',year:f.filenameYear||null,status:'エラー',reason:e.message});}
    }
    rebuildPriorSummary(state,priorYear); buildForecastFromPrior(state,targetYear,Number(state.actualThrough||9)); state.importDiagnostics={at:new Date().toISOString(),targetYear,files:result.files,salaryCandidates:result.salaryCandidates,salaryImported:result.salaryImported,salaryParsed:result.salaryParsed,salaryOcr:result.salaryOcr,salaryRejected:result.salaryRejected,errors:result.errors.slice()}; state.importHistory=state.importHistory.filter(x=>{if(!String(x?.name||'').startsWith(TARGET_FILE_PREFIX))return true;const y=Number(x?.year||0);return !y||y===targetYear||y===priorYear}).slice(0,200); state.importSettings={...(state.importSettings||{}),targetYear,priorYear};
    return result;
  }
  return {CLIENT_KEY,getClientId,setClientId,ready,authorize,signOut,listCandidateFiles,scanAndImport,classifyPdfText,parseSalaryPdf,parseBonusPdf,parseWithholdingPdf,extractLabeledNumber,extractToyotaPayrollAmount,upsertSalaryRecord,upsertBonusRecord,ensurePdfText};
})();
if(typeof window!=='undefined')window.FurusatoGoogleDrive=FurusatoGoogleDrive;
if(typeof module!=='undefined')module.exports={FurusatoImport,FurusatoGoogleDrive};
