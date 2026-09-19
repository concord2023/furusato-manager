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
  async function listCandidateFiles(targetYear){
    if(!accessToken)await authorize();
    const currentYear=Number(targetYear)||new Date().getFullYear();
    const priorYear=currentYear-1;
    const years=[priorYear,currentYear];
    const queries=[];
    // Search payroll document names even when the year/month exists only inside the PDF.
    // Parsed PDF year is still checked before import, so unrelated years are never stored.
    for(const term of SEARCH_NAME_TERMS){
      const safe=term.replace(/'/g,"\\'");
      queries.push(`trashed = false and name contains '${safe}'`);
    }
    for(const term of SEARCH_TEXT_TERMS){
      const safe=term.replace(/'/g,"\\'");
      queries.push(`trashed = false and fullText contains '${safe}'`);
    }
    const seen=new Map();
    for(const q of queries){
      let rows=[]; try{rows=await listAllFilesByQuery(q)}catch(e){continue}
      for(const f of rows){
        const name=String(f.name||'');
        const isPdf=/\.pdf$/i.test(name)||f.mimeType==='application/pdf';
        if(!isPdf)continue;
        const y=yearFromName(name);
        // A filename year, when present, is authoritative. Otherwise the query's year is carried as a hint.
        if(y!==null && !years.includes(y))continue;
        const type=candidateTypeFromName(name);
        if(!seen.has(f.id))seen.set(f.id,{...f,candidate:true,candidateType:type,filenameYear:y});
        else if(seen.get(f.id).candidateType==='unknown'&&type!=='unknown')seen.get(f.id).candidateType=type;
      }
    }
    return [...seen.values()].sort((a,b)=>String(b.modifiedTime||'').localeCompare(String(a.modifiedTime||'')));
  }
  async function downloadPdf(fileId){if(!accessToken)await authorize();const r=await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,{headers:{Authorization:`Bearer ${accessToken}`}});if(!r.ok)throw new Error(`Drive download failed: ${r.status}`);return await r.arrayBuffer()}
  async function pdfText(arrayBuffer){
    if(!window.pdfjsLib)await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
    const pdf=window.pdfjsLib||window.pdfjs;if(!pdf)throw new Error('PDF解析ライブラリを読み込めませんでした');
    if(pdf.GlobalWorkerOptions)pdf.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    let doc;
    try{doc=await pdf.getDocument({data:arrayBuffer,disableWorker:true}).promise}
    catch(first){
      if(pdf.GlobalWorkerOptions)pdf.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      doc=await pdf.getDocument({data:arrayBuffer}).promise;
    }
    let text=''; const pages=[];
    for(let i=1;i<=doc.numPages;i++){
      const page=await doc.getPage(i); const c=await page.getTextContent();
      const items=(c.items||[]).filter(x=>String(x.str||'').trim()).map(x=>({str:String(x.str||''),x:Number(x.transform?.[4]||0),y:Number(x.transform?.[5]||0),width:Number(x.width||0),height:Number(x.height||0)}));
      pages.push(items); text+=items.map(x=>x.str).join(' ')+'\n';
    }
    return {text,pages};
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
  function numericTokens(items){
    const arr=(items||[]).filter(x=>String(x.str||'').trim()); const out=[];
    for(let i=0;i<arr.length;i++){
      const raw=String(arr[i].str||'').trim();
      const one=parseAmountToken(raw);
      if(one!=null){out.push({it:arr[i],value:one});continue}
      if(/^[0-9]{1,3}$/.test(raw)){
        let joined=raw, end=i;
        while(end+1<arr.length && end-i<5 && /^[0-9,]+$/.test(String(arr[end+1].str||'').trim())){
          const next=String(arr[end+1].str||'').trim();
          if(joined.length+next.replace(/,/g,'').length>9)break;
          joined+=next; end++;
          const v=parseAmountToken(joined); if(v!=null){out.push({it:arr[i],value:v,end});i=end;break}
        }
      }
    }
    return out;
  }
  function isAmountToken(s){return parseAmountToken(s)!=null}
  function compactPdfText(text){return String(text||'').replace(/[\u00a0\u3000\s]/g,'').replace(/[（）()]/g,'').toLowerCase();}
  function labelRegexVariants(label){
    const raw=String(label||'');
    const compact=normalizeLabel(raw);
    const spaced=raw.split('').map(ch=>/[\u3040-\u30ff\u3400-\u9fff]/.test(ch)?`${ch}\\s*`:ch.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('');
    return [raw.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),compact.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),spaced].filter(Boolean);
  }
  function rowGroups(items, tolerance=5){
    const rows=[];
    for(const it of (items||[]).filter(x=>String(x.str||'').trim()).sort((a,b)=>b.y-a.y||a.x-b.x)){
      let row=rows.find(r=>Math.abs(r.y-it.y)<=tolerance);
      if(!row){row={y:it.y,items:[]};rows.push(row)}
      row.items.push(it);
    }
    rows.forEach(r=>r.items.sort((a,b)=>a.x-b.x));
    return rows;
  }
  function findAmountInRowAfterLabel(items,label){
    const wanted=normalizeLabel(label);
    for(const row of rowGroups(items,7)){
      const arr=row.items;
      const normalized=arr.map(it=>normalizeLabel(it.str));
      for(let i=0;i<arr.length;i++){
        let joined='';
        for(let end=i;end<arr.length && end<i+10;end++){
          joined+=normalized[end];
          if(joined.includes(wanted)){
            const nums=numericTokens(arr.slice(end+1));
            if(nums.length)return nums[0].value;
            break;
          }
        }
      }
    }
    return null;
  }

  function extractLabeledNumber(textOrPdf, labels){
    const text=typeof textOrPdf==='string'?textOrPdf:(textOrPdf?.text||''); const layout=textOrPdf?.pages;
    if(Array.isArray(layout)){
      for(const page of layout){
        const items=page||[];
        for(const label of labels||[]){
          const rowValue=findAmountInRowAfterLabel(items,label);
          if(rowValue!=null)return rowValue;
          const wanted=normalizeLabel(label);
          const exact=items.filter(it=>normalizeLabel(it.str)===wanted);
          const labelsOnPage=exact.length?exact:items.filter(it=>normalizeLabel(it.str).includes(wanted));
          for(const li of labelsOnPage){
            const candidates=numericTokens(items.filter(it=>it!==li && Math.abs(it.y-li.y)<=24 && it.x>=li.x-10))
              .map(n=>({it:n.it,value:n.value,d:Math.abs(n.it.y-li.y)*4+Math.max(0,n.it.x-(li.x+li.width))})).sort((a,b)=>a.d-b.d);
            if(candidates.length)return candidates[0].value;
            const nearby=numericTokens(items.filter(it=>it!==li && Math.abs(it.x-(li.x+li.width))<500 && Math.abs(it.y-li.y)<=45))
              .map(n=>({it:n.it,value:n.value,d:Math.abs(n.it.y-li.y)*6+Math.abs(n.it.x-(li.x+li.width))})).sort((a,b)=>a.d-b.d);
            if(nearby.length)return nearby[0].value;
          }
        }
      }
    }
    const raw=cleanPdfText(text); const compact=compactPdfText(text);
    for(const label of labels||[]){
      for(const pattern of labelRegexVariants(label)){
        const m=raw.match(new RegExp(pattern+'[^0-9]{0,80}([0-9][0-9,]{2,})','i'));
        if(m)return Number(m[1].replace(/,/g,''));
      }
      const wanted=normalizeLabel(label); const idx=compact.indexOf(wanted);
      if(idx>=0){const tail=compact.slice(idx+wanted.length,idx+wanted.length+100);const m=tail.match(/[^0-9]{0,30}([0-9][0-9,]{2,})/);if(m)return Number(m[1].replace(/,/g,''));}
    }
    return null;
  }

  function parseSalaryComponents(text){
    const s=cleanPdfText(typeof text==='string'?text:text?.text||'');
    const taxableAmount=extractLabeledNumber(text,['課税対象額','Taxable Amount','課税支給額','Taxable Pay']);
    const grossTotal=extractLabeledNumber(text,['支給合計 (A)','支給合計（A)','支給合計','Total Payment','総支給額']);
    const nonTaxableTotal=extractLabeledNumber(text,['内 通勤補助費等非課税分','内通勤補助費等非課税分','Non-taxable Amount']);
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
    const taxableBase=taxableAmount!=null?taxableAmount:(grossTotal!=null&&nonTaxableTotal!=null?grossTotal-nonTaxableTotal:null);
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
    const raw=typeof text==='string'?text:(text?.text||''); const d=mergeDateFallback(extractDateParts(raw,name),name),c=parseSalaryComponents(text);
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
    state.salaryRecords.push({year:targetYear,month:x.month,gross:x.taxableGross,taxableGross:x.taxableGross,grossTotal:x.grossTotal,nonTaxableTotal:x.nonTaxableTotal,social:x.social,socialComponents:x.socialComponents||{},components:x.components||[],source:'google-drive',status:'actual',document:f.name,driveFileId:f.id,needsReview:x.needsReview});
    state.sourceDocuments=state.sourceDocuments||[]; const oldDoc=state.sourceDocuments.find(d=>d.driveFileId===f.id||d.file===f.name); const salaryDoc={file:f.name,type:'salary_slip',status:x.needsReview?'review_needed':'imported',source:'google-drive',driveFileId:f.id,year:x.year,month:x.month,taxableGross:x.taxableGross,grossTotal:x.grossTotal,nonTaxableTotal:x.nonTaxableTotal,social:x.social||0,note:x.needsReview?'給与明細を取得しましたが一部確認待ちです。':'給与明細を取得・解析しました。'}; if(oldDoc)Object.assign(oldDoc,salaryDoc); else state.sourceDocuments.push(salaryDoc);
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
  async function scanAndImport(state,onProgress){
    const targetYear=Number(state.importSettings?.targetYear||state.year||new Date().getFullYear()); const priorYear=targetYear-1; state.year=targetYear;
    const files=await listCandidateFiles(targetYear);
    const result={files:files.length,added:0,review:0,skipped:0,errors:[],salaryCandidates:files.filter(f=>f.candidateType==='salary').length,salaryImported:0,salaryReview:0,salaryParsed:0,salaryRejected:0,candidates:files.map(f=>({name:f.name,type:f.candidateType,year:f.filenameYear}))};
    state.priorSalaryRecords=(state.priorSalaryRecords||[]).filter(x=>Number(x.year)===priorYear); state.priorBonusRecords=(state.priorBonusRecords||[]).filter(x=>Number(x.year)===priorYear); state.priorSocialRecords=(state.priorSocialRecords||[]).filter(x=>Number(x.year)===priorYear);
    state.lastDriveFiles=files.map(f=>({id:f.id,name:f.name,mimeType:f.mimeType||'application/pdf',modifiedTime:f.modifiedTime||'',filenameYear:f.filenameYear,candidateType:f.candidateType}));
    for(const f of files){
      try{
        onProgress?.(`解析中: ${f.name}`); const buf=await downloadPdf(f.id),pdf=await pdfText(buf),text=pdf.text,detectedType=classifyPdfText(text,f.name),type=detectedType==='unknown' ? ({salary:'salary_slip',bonus:'bonus_slip',withholding:'withholding'}[f.candidateType]||detectedType) : detectedType;
        const diag={name:f.name,id:f.id,candidateType:f.candidateType,type,filenameYear:f.filenameYear}; result.candidates.find(v=>v.name===f.name).detectedType=detectedType; result.candidates.find(v=>v.name===f.name).resolvedType=type;
        if(type==='salary_slip'){
          const x=parseSalaryPdf(pdf,f.name); const cd=result.candidates.find(v=>v.name===f.name); if(cd)Object.assign(cd,{parsedYear:x.year,parsedMonth:x.month,taxableGross:x.taxableGross,grossTotal:x.grossTotal,social:x.social,needsReview:x.needsReview}); if(![targetYear,priorYear].includes(Number(x.year))){result.skipped++;continue}
          if(upsertSalaryRecord(state,x,f,targetYear,result)){}
          else if(x.year===priorYear&&x.month&&x.gross){uniquePush(state.priorSalaryRecords,{year:priorYear,month:x.month,gross:x.taxableGross,taxableGross:x.taxableGross,grossTotal:x.grossTotal,nonTaxableTotal:x.nonTaxableTotal,components:x.components||[],source:'google-drive',status:'prior',document:f.name,driveFileId:f.id,needsReview:x.needsReview},v=>`${v.year}-${v.month}-${v.document}`);if(x.social!=null)uniquePush(state.priorSocialRecords,{year:priorYear,month:x.month,amount:x.social,components:x.socialComponents||{},source:'google-drive',status:'prior',document:f.name,driveFileId:f.id},v=>`${v.year}-${v.month}-${v.document}`);result.added++}else {
            state.sourceDocuments=state.sourceDocuments||[];
            const old=state.sourceDocuments.find(d=>d.driveFileId===f.id||d.file===f.name);
            const failedDoc={file:f.name,type:'salary_slip',status:'review_needed',source:'google-drive',driveFileId:f.id,year:x.year||null,month:x.month||null,taxableGross:x.taxableGross||null,grossTotal:x.grossTotal||null,nonTaxableTotal:x.nonTaxableTotal||null,social:x.social||null,needsReview:true,unknownComponents:x.unknownComponents||[],note:`給与明細は取得済みですが給与実績に登録できませんでした。課税対象額=${x.taxableGross??'取得失敗'}／年月=${x.year??'不明'}-${x.month??'不明'}。`};
            if(old)Object.assign(old,failedDoc); else state.sourceDocuments.push(failedDoc);
            result.review++; if(f.candidateType==='salary'){result.salaryReview++;result.salaryRejected++;}
          }
        }else if(type==='bonus_slip'){
          const x=parseBonusPdf(pdf,f.name); if(![targetYear,priorYear].includes(Number(x.year))){result.skipped++;continue}
          if(!upsertBonusRecord(state,x,f,targetYear,result) && x.year===priorYear && x.date&&x.amount){state.priorBonusRecords=state.priorBonusRecords||[];uniquePush(state.priorBonusRecords,{year:priorYear,date:x.date,month:x.month,amount:x.amount,social:x.social,socialComponents:x.socialComponents||{},standardBonusHealth:x.standardBonusHealth,standardBonusPension:x.standardBonusPension,source:'prior',status:'prior',document:f.name,driveFileId:f.id},v=>`${v.date}-${v.document}`);result.added++;}else if(!(x.date&&x.amount))result.review++;
        }else if(type==='withholding'){
          const x=parseWithholdingPdf(text,f.name); if(x.year&&![targetYear,priorYear].includes(Number(x.year))){result.skipped++;continue}
          state.sourceDocuments=state.sourceDocuments||[];const old=state.sourceDocuments.find(d=>d.file===f.name);const doc={file:f.name,type,status:'imported',source:'google-drive',driveFileId:f.id,note:`源泉徴収票を取得。${x.year===priorYear?'前年参考値として保持':'対象年の参考資料として保持'}。`,annualSalary:x.annualSalary||0,social:x.social||0,incomeTax:x.incomeTax||0,year:x.year||null};if(old)Object.assign(old,doc);else state.sourceDocuments.push(doc);
          if(x.year===priorYear){state.prior=state.prior||{salary:0,bonus:0,social:0};if(x.annualSalary)state.prior.salary=x.annualSalary;if(x.social)state.prior.social=x.social} result.review++;
        }else result.skipped++;
      }catch(e){result.errors.push(`${f.name}: ${e.message}`)}
    }
    rebuildPriorSummary(state,priorYear); buildForecastFromPrior(state,targetYear,Number(state.actualThrough||9)); state.importDiagnostics={at:new Date().toISOString(),targetYear,files:result.files,salaryCandidates:result.salaryCandidates,salaryImported:result.salaryImported,salaryParsed:result.salaryParsed,salaryRejected:result.salaryRejected,salaryReview:result.salaryReview,errors:result.errors.slice(),candidates:result.candidates}; state.importSettings={...(state.importSettings||{}),targetYear,priorYear};
    return result;
  }
  return {CLIENT_KEY,getClientId,setClientId,ready,authorize,signOut,listCandidateFiles,scanAndImport,classifyPdfText,parseSalaryPdf,parseBonusPdf,parseWithholdingPdf,extractLabeledNumber,upsertSalaryRecord,upsertBonusRecord};
})();
if(typeof window!=='undefined')window.FurusatoGoogleDrive=FurusatoGoogleDrive;
if(typeof module!=='undefined')module.exports={FurusatoImport,FurusatoGoogleDrive};
