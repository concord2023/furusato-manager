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
  function candidateTypeFromName(name=''){
    const n=String(name);
    if(/bonus|賞与|ボーナス/i.test(n))return 'bonus';
    if(/gensen|源泉|withholding/i.test(n))return 'withholding';
    if(/chinginmeisai|chingin|給与|給料|賃金|salary/i.test(n))return 'salary';
    return 'unknown';
  }
  async function listAllFilesByQuery(q){
    const out=[]; let pageToken='';
    do{
      const params={q,orderBy:'modifiedTime desc',pageSize:100,fields:'nextPageToken,files(id,name,mimeType,size,modifiedTime,createdTime,webViewLink,parents)',supportsAllDrives:true,includeItemsFromAllDrives:true};
      if(pageToken)params.pageToken=pageToken;
      const r=await gapi.client.drive.files.list(params);
      out.push(...(r.result.files||[]));
      pageToken=r.result.nextPageToken||'';
    }while(pageToken);
    return out;
  }
  async function listCandidateFiles(){
    if(!accessToken)await authorize();
    const queries=[];
    for(const term of SEARCH_NAME_TERMS)queries.push(`trashed = false and name contains '${term.replace(/'/g,"\\'")}'`);
    for(const term of SEARCH_TEXT_TERMS)queries.push(`trashed = false and fullText contains '${term.replace(/'/g,"\\'")}'`);
    const seen=new Map();
    for(const q of queries){
      let rows=[];
      try{rows=await listAllFilesByQuery(q)}catch(e){continue}
      for(const f of rows){
        const name=String(f.name||'');
        const isPdf=/\.pdf$/i.test(name)||f.mimeType==='application/pdf';
        const type=candidateTypeFromName(name);
        if(!isPdf && type==='unknown')continue;
        if(type==='unknown' && !/給与|給料|賃金|賞与|ボーナス|源泉|源泉徴収|Chingin|Gensen|Bonus|salary|withholding|支給合計|Total Payment/i.test(name))continue;
        if(!seen.has(f.id))seen.set(f.id,{...f,candidate:true,candidateType:type});
        else if(seen.get(f.id).candidateType==='unknown' && type!=='unknown')seen.get(f.id).candidateType=type;
      }
    }
    return [...seen.values()].sort((a,b)=>String(b.modifiedTime||'').localeCompare(String(a.modifiedTime||'')));
  }
  async function downloadPdf(fileId){if(!accessToken)await authorize();const r=await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,{headers:{Authorization:`Bearer ${accessToken}`}});if(!r.ok)throw new Error(`Drive download failed: ${r.status}`);return await r.arrayBuffer()}
  async function pdfText(arrayBuffer){if(!window.pdfjsLib)await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');const pdf=window.pdfjsLib||window.pdfjs; if(!pdf)throw new Error('PDF解析ライブラリを読み込めませんでした'); if(pdf.GlobalWorkerOptions)pdf.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';const doc=await pdf.getDocument({data:arrayBuffer}).promise;let text='';for(let i=1;i<=doc.numPages;i++){const page=await doc.getPage(i);const c=await page.getTextContent();text+=c.items.map(x=>x.str).join(' ')+'\n'}return text}
  function classifyPdfText(text,name=''){
    const n=String(name||''); const t=`${n}\n${String(text||'')}`;
    const byName=candidateTypeFromName(n);
    if(byName==='bonus')return 'bonus_slip';
    if(byName==='withholding')return 'withholding';
    if(byName==='salary')return 'salary_slip';
    if(/賞与明細票|賞与|ボーナス|bonus/i.test(t))return 'bonus_slip';
    if(/源泉徴収票|給与所得の源泉徴収票|withholding/i.test(t))return 'withholding';
    if(/給与明細票|給与|給料|賃金|salary|支給合計|Total\s*Payment/i.test(t))return 'salary_slip';
    return 'unknown';
  }
  function cleanPdfText(text){return String(text||'').replace(/[\u00a0\u3000]/g,' ').replace(/\s+/g,' ').trim()}
  function extractNumberAfter(text,patterns){const s=cleanPdfText(text);for(const p of patterns){const m=s.match(p);if(m)return Number(String(m[1]).replace(/,/g,''))}return null}
  function extractDateParts(text,name=''){
    const s=`${name}\n${text}`;
    // Filename is preferred because it is the most stable source for YYYYMM documents.
    let m=String(name).match(/(20\d{2})[-_](0[1-9]|1[0-2])(?:[-_]\d{1,2})?/);
    if(m)return {year:Number(m[1]),month:Number(m[2])};
    m=String(name).match(/(20\d{2})(0[1-9]|1[0-2])(?!\d)/);
    if(m)return {year:Number(m[1]),month:Number(m[2])};
    m=s.match(/(20\d{2})年\s*(\d{1,2})月/);
    if(m)return {year:Number(m[1]),month:Number(m[2])};
    m=s.match(/(20\d{2})[/-](\d{1,2})(?:[/-]\d{1,2})?/);
    if(m)return {year:Number(m[1]),month:Number(m[2])};
    m=s.match(/(20\d{2})(0[1-9]|1[0-2])(?!\d)/);
    if(m)return {year:Number(m[1]),month:Number(m[2])};
    return {year:null,month:null};
  }
  function parseSalaryPdf(text,name){
    const d=extractDateParts(text,name), s=cleanPdfText(text);
    const gross=extractNumberAfter(s,[
      /(?:支給合計|総支給額|支給額)\s*(?:\([^)]*\)|（[^）]*）)?\s*[^\d￥¥]{0,80}[￥¥]?\s*([\d,]{4,})/i,
      /(?:Total\s*Payment)\s*[^\d￥¥]{0,80}[￥¥]?\s*([\d,]{4,})/i,
      /(?:給与総額|総支給)\s*[^\d￥¥]{0,50}[￥¥]?\s*([\d,]{4,})/i
    ]);
    const social=extractNumberAfter(s,[
      /(?:社会保険料(?:等)?|社会保険)\s*[^\d]{0,30}([\d,]{4,})/i
    ]);
    return {year:d.year,month:d.month,gross,social,source:'google-drive',status:'actual',document:name,needsReview:!(d.year&&d.month&&gross)};
  }
  function parseBonusPdf(text,name){
    const d=extractDateParts(text,name), s=cleanPdfText(text);
    const amount=extractNumberAfter(s,[
      /(?:支給合計|総支給額|支給額)\s*(?:\([^)]*\)|（[^）]*）)?\s*[^\d￥¥]{0,80}[￥¥]?\s*([\d,]{5,})/i,
      /(?:Total\s*Payment)\s*[^\d￥¥]{0,80}[￥¥]?\s*([\d,]{5,})/i,
      /[￥¥]\s*([\d,]{5,})/i,
      /(?:Standard\s+Bonus|標準賞与額)\s*[^\d]{0,40}([\d,]{5,})/i
    ]);
    const date=d.year&&d.month?`${d.year}-${String(d.month).padStart(2,'0')}`:'';
    return {year:d.year,month:d.month,date,amount,source:'google-drive',status:'actual',document:name,needsReview:!(date&&amount)};
  }
  function parseWithholdingPdf(text,name){
    const d=extractDateParts(text,name), s=cleanPdfText(text);
    const annualSalary=extractNumberAfter(s,[
      /(?:支払金額|給与等の支払金額|支払金額\s*\(a\))\s*[^\d]{0,60}([\d,]{5,})/i
    ]);
    const social=extractNumberAfter(s,[
      /(?:社会保険料等の金額)\s*[^\d]{0,60}([\d,]{4,})/i
    ]);
    const incomeTax=extractNumberAfter(s,[
      /(?:源泉徴収税額)\s*[^\d]{0,60}([\d,]{4,})/i
    ]);
    return {year:d.year,annualSalary,social,incomeTax,document:name,source:'google-drive'};
  }
  async function scanAndImport(state,onProgress){
    const files=await listCandidateFiles();
    const result={files:files.length,added:0,review:0,skipped:0,errors:[],candidates:files.map(f=>({name:f.name,type:f.candidateType}))};
    for(const f of files){
      try{
        onProgress?.(`解析中: ${f.name}`);
        const buf=await downloadPdf(f.id), text=await pdfText(buf), type=classifyPdfText(text,f.name);
        if(type==='salary_slip'){
          const x=parseSalaryPdf(text,f.name);
          if(x.year===state.year&&x.month&&x.gross){
            state.salaryRecords=state.salaryRecords||[];
            const same=state.salaryRecords.find(r=>Number(r.month)===x.month&&Number(r.gross)===x.gross&&r.document===f.name);
            if(!same){
              state.salaryRecords=state.salaryRecords.filter(r=>Number(r.month)!==x.month||r.source==='manual');
              state.salaryRecords.push({month:x.month,gross:x.gross,source:'google-drive',status:'actual',document:f.name,driveFileId:f.id});
              if(x.social) {state.socialRecords=state.socialRecords||[];state.socialRecords=state.socialRecords.filter(r=>Number(r.month)!==x.month||r.source==='manual');state.socialRecords.push({month:x.month,amount:x.social,source:'google-drive',status:'actual',document:f.name,driveFileId:f.id});}
              result.added++;
            }
          }else result.review++;
        }else if(type==='bonus_slip'){
          const x=parseBonusPdf(text,f.name);
          if(x.date&&x.amount){
            state.bonusRecords=state.bonusRecords||[];
            const existing=state.bonusRecords.some(r=>r.document===f.name||Number(r.amount)===Number(x.amount)&&r.date===x.date);
            if(!existing){state.bonusRecords.push({...x,driveFileId:f.id});result.added++;}
          }else result.review++;
        }else if(type==='withholding'){
          const x=parseWithholdingPdf(text,f.name);
          state.sourceDocuments=state.sourceDocuments||[];
          const old=state.sourceDocuments.find(d=>d.file===f.name);
          const doc={file:f.name,type,status:'imported',source:'google-drive',driveFileId:f.id,note:'源泉徴収票を取得。前年参考値として保持。',annualSalary:x.annualSalary||0,social:x.social||0,incomeTax:x.incomeTax||0,year:x.year||null};
          if(old)Object.assign(old,doc);else state.sourceDocuments.push(doc);
          if(x.year&&x.year<state.year){state.prior=state.prior||{salary:0,bonus:0,social:0};if(x.annualSalary)state.prior.salary=x.annualSalary;if(x.social)state.prior.social=x.social;}
          result.review++;
        }else result.skipped++;
      }catch(e){result.errors.push(`${f.name}: ${e.message}`)}
    }
    return result;
  }
  return {CLIENT_KEY,getClientId,setClientId,ready,authorize,signOut,listCandidateFiles,scanAndImport,classifyPdfText,parseSalaryPdf,parseBonusPdf,parseWithholdingPdf};
})();
if(typeof window!=='undefined')window.FurusatoGoogleDrive=FurusatoGoogleDrive;
if(typeof module!=='undefined')module.exports={FurusatoImport,FurusatoGoogleDrive};
