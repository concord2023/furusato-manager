/* furusato-manager integration layer
 * Google Drive OAuth + PDF/OCR import.
 * No OAuth token is persisted; only the public Google Client ID is stored.
 */
const FurusatoImport={
  normalizeText(s){return String(s||'').replace(/[\u3000\s]+/g,' ').trim()},
  normalizeOrderId(s){return this.normalizeText(s).replace(/^(注文番号|注文ID|Order\s*ID|受付番号|申込番号)\s*[:：#]?\s*/i,'').trim()},
  extractAmount(text){
    const s=this.normalizeText(text).replace(/,/g,'');
    const ps=[/(?:寄附|寄付|支払|決済|合計|注文|金額)[^\d]{0,30}(\d{3,})\s*円/i,/(\d{3,})\s*円/];
    for(const p of ps){const m=s.match(p);if(m)return Number(m[1])}
    return null
  },
  detectSite(text){
    const s=this.normalizeText(text).toLowerCase();
    if(s.includes('楽天')||s.includes('rakuten'))return '楽天';
    if(s.includes('さとふる')||s.includes('satofull'))return 'さとふる';
    if(s.includes('ふるさとチョイス')||s.includes('furusato choice'))return 'ふるさとチョイス';
    if(s.includes('amazon'))return 'Amazon等';
    return 'その他'
  },
  extractOrderId(text){
    const s=this.normalizeText(text),p=/(?:注文番号|注文id|order\s*id|受付番号|申込番号)\s*[:：#]?\s*([A-Z0-9][A-Z0-9\-_./]{4,})/i,m=s.match(p);
    return m?this.normalizeOrderId(m[1]):''
  },
  detectDelivery(text){
    const s=this.normalizeText(text);
    if(!/(発送|出荷|配送中|お届け|配達)/i.test(s))return '未確定';
    const m=s.match(/(\d{1,2})\s*[月/]\s*(\d{1,2})\s*日?/);
    return m?`${m[1]}/${m[2]}頃`:'配送情報あり・日付未確定'
  },
  isLikelyDonation(text){return /ふるさと納税|寄附|寄付|返礼品|自治体|ワンストップ/i.test(String(text||''))},
  makeFingerprint(x){return [x.site,this.normalizeOrderId(x.orderId),Number(x.amount)||0,this.normalizeText(x.subject).toLowerCase()].join('|')},
  isDuplicate(candidate,existing){
    const id=this.normalizeOrderId(candidate.orderId);
    if(id&&existing.some(x=>this.normalizeOrderId(x.orderId)===id))return true;
    const fp=this.makeFingerprint(candidate);return existing.some(x=>this.makeFingerprint(x)===fp)
  },
  parseEmail({subject='',body='',date='',messageId=''}) {
    const text=`${subject}\n${body}`,amount=this.extractAmount(text),orderId=this.extractOrderId(text),site=this.detectSite(text),donation=this.isLikelyDonation(text);
    return {site,amount,orderId,delivery:this.detectDelivery(text),date,messageId,subject,donation,confidence:amount&&donation?'medium':'low',needsReview:!(amount&&donation&&orderId)}
  },
  importEmails(emails,state){
    const existing=state.donations||[],result={added:0,duplicates:0,review:0};
    for(const e of emails||[]){
      const p=this.parseEmail(e);if(!p.donation)continue;
      const c={id:'mail-'+(p.messageId||Date.now()+'-'+Math.random()),site:p.site,city:'未確定',item:'メールから抽出',amount:Number(p.amount)||0,status:p.needsReview?'確認待ち':'確定',delivery:p.delivery,orderId:p.orderId,source:'yahoo-mail',sourceMessageId:p.messageId||'',subject:p.subject||''};
      if(c.amount<=0){result.review++;continue}
      if(this.isDuplicate(c,existing)){result.duplicates++;continue}
      existing.push(c);result.added++;if(c.status==='確認待ち')result.review++
    }
    state.donations=existing;return result
  },
  parseSalaryCSV(text){
    const rows=String(text||'').trim().split(/\r?\n/).filter(Boolean);if(rows.length<2)return [];
    const h=rows.shift().split(',').map(x=>x.trim().toLowerCase()),mi=h.findIndex(x=>/month|月/.test(x)),gi=h.findIndex(x=>/gross|salary|給与|支給額/.test(x));
    return rows.map(line=>{
      const c=line.split(',').map(x=>x.trim().replace(/^"|"$/g,'')),month=Number(c[mi>=0?mi:0]),gross=Number((c[gi>=0?gi:1]||'').replace(/,/g,''));
      return {month,gross,source:'auto',status:'actual'}
    }).filter(x=>x.month>=1&&x.month<=12&&Number.isFinite(x.gross)&&x.gross>0)
  }
};
if(typeof window!=='undefined')window.FurusatoImport=FurusatoImport;
if(typeof module!=='undefined')module.exports=FurusatoImport;

const FurusatoGoogleDrive=(()=>{
  const CLIENT_KEY='furusatoGoogleClientId';
  const SCOPES='https://www.googleapis.com/auth/drive.readonly';
  let tokenClient=null,accessToken=null,readyPromise=null,lastOcrImageDataUrl=null;
  const runtimeLog=[];

  function log(stage,data={}){runtimeLog.push({stage,...data,at:new Date().toISOString()});if(runtimeLog.length>300)runtimeLog.shift()}
  function getClientId(){return localStorage.getItem(CLIENT_KEY)||''}
  function setClientId(v){const x=String(v||'').trim();if(x)localStorage.setItem(CLIENT_KEY,x);else localStorage.removeItem(CLIENT_KEY);return x}
  function clearRuntimeDiagnostics(){runtimeLog.length=0}
  function getRuntimeDiagnostics(){return runtimeLog.slice()}
  function loadScript(src){
    return new Promise((resolve,reject)=>{
      const old=document.querySelector(`script[src="${src}"]`);
      if(old){if(old.dataset.loaded==='1')return resolve();old.addEventListener('load',resolve,{once:true});old.addEventListener('error',reject,{once:true});return}
      const s=document.createElement('script');s.src=src;s.async=true;s.defer=true;
      s.onload=()=>{s.dataset.loaded='1';resolve()};s.onerror=()=>reject(new Error(`外部ライブラリを読み込めません: ${src}`));document.head.appendChild(s)
    })
  }
  async function ready(){
    if(readyPromise)return readyPromise;
    readyPromise=(async()=>{
      const id=getClientId();if(!id)throw new Error('Google Client ID未設定');
      await loadScript('https://accounts.google.com/gsi/client');
      await loadScript('https://apis.google.com/js/api.js');
      await new Promise((resolve,reject)=>{
        if(window.gapi?.client)return resolve();
        if(!window.gapi?.load)return reject(new Error('Google API client could not load'));
        window.gapi.load('client',{callback:resolve,ontimeout:()=>reject(new Error('Google API client load timeout')),timeout:10000})
      });
      await gapi.client.load('https://www.googleapis.com/discovery/v1/apis/drive/v3/rest');
      tokenClient=google.accounts.oauth2.initTokenClient({client_id:id,scope:SCOPES,callback:()=>{}});
      return true
    })().catch(e=>{readyPromise=null;throw e});
    return readyPromise
  }
  async function authorize(){
    await ready();
    return new Promise((resolve,reject)=>{
      tokenClient.callback=(resp)=>{
        if(resp?.error){accessToken=null;reject(new Error(resp.error));return}
        accessToken=resp.access_token;gapi.client.setToken({access_token:accessToken});resolve(accessToken)
      };
      tokenClient.requestAccessToken({prompt:accessToken?'':'consent'})
    })
  }
  function signOut(){
    if(accessToken&&window.google?.accounts?.oauth2)try{google.accounts.oauth2.revoke(accessToken,()=>{})}catch{}
    accessToken=null;try{gapi.client.setToken(null)}catch{}
  }
  function filenameInfo(name){
    const s=String(name||'');
    const y=s.match(/(?:20)(\d{2})/),ym=s.match(/(20\d{2})[._-]?(\d{2})/);
    let year=ym?Number(ym[1]):y?2000+Number(y[1]):null,month=ym?Number(ym[2]):null;
    if(month&&month>12)month=null;
    const candidateType=/賞与|bonus|ボーナス/i.test(s)?'bonus':/源泉徴収|gensen|withholding/i.test(s)?'withholding':/給与|給料|賃金|chinginmeisai|salary/i.test(s)?'salary':'unknown';
    return {year,month,candidateType}
  }
  async function listCandidateFiles(){
    if(!accessToken)await authorize();
    const q="trashed = false and mimeType = 'application/pdf'";
    const r=await gapi.client.drive.files.list({q,orderBy:'modifiedTime desc',pageSize:100,fields:'files(id,name,mimeType,size,modifiedTime,createdTime,webViewLink,parents)'});
    const key=/給与|給料|賃金|賞与|ボーナス|源泉徴収|年末調整|給与所得|chinginmeisai|gensen|salary|bonus|withholding/i;
    return (r.result.files||[]).map(f=>({...f,...filenameInfo(f.name)})).filter(f=>key.test(f.name))
  }
  async function downloadPdf(fileId){
    if(!accessToken)await authorize();
    const r=await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,{headers:{Authorization:`Bearer ${accessToken}`}});
    if(!r.ok)throw new Error(`Drive PDF取得失敗: HTTP ${r.status}`);
    const b=await r.arrayBuffer();log('download',{fileId,status:r.status,bytes:b.byteLength});return b
  }
  async function pdfText(arrayBuffer){
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
    const pdf=window.pdfjsLib||window.pdfjs;if(!pdf)throw new Error('PDF解析ライブラリを読み込めませんでした');
    if(pdf.GlobalWorkerOptions)pdf.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const doc=await pdf.getDocument({data:arrayBuffer}).promise,texts=[],pageMeta=[];
    for(let i=1;i<=doc.numPages;i++){const page=await doc.getPage(i),c=await page.getTextContent(),t=c.items.map(x=>x.str).join(' ');texts.push(t);pageMeta.push({page:i,items:c.items.length,textChars:t.length,sample:t.slice(0,120)})}
    const text=texts.join('\n');return {text,pageCount:doc.numPages,textItemCount:pageMeta.reduce((a,x)=>a+x.items,0),pageMeta,pdfDoc:doc}
  }
  async function renderPage(pdfDoc,pageNo=1,scale=2.5){
    const page=await pdfDoc.getPage(pageNo),vp=page.getViewport({scale}),canvas=document.createElement('canvas');
    canvas.width=Math.ceil(vp.width);canvas.height=Math.ceil(vp.height);await page.render({canvasContext:canvas.getContext('2d'),viewport:vp}).promise;
    lastOcrImageDataUrl=canvas.toDataURL('image/png');return canvas
  }
  function cleanOcr(s){return String(s||'').replace(/\r/g,'\n').replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n').trim()}
  async function ocrCanvas(canvas,lang='jpn+eng',psm=6){
    await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js');
    const T=window.Tesseract;if(!T)throw new Error('OCRライブラリを読み込めませんでした');
    const worker=await T.createWorker(lang,1,{logger:m=>{}});
    try{await worker.setParameters({tessedit_pageseg_mode:String(psm),preserve_interword_spaces:'1'});const r=await worker.recognize(canvas);return {text:cleanOcr(r.data?.text),confidence:Number(r.data?.confidence)||0,words:r.data?.words?.length||0}}
    finally{await worker.terminate()}
  }
  function classifyPdfText(text,name=''){
    const t=`${name}\n${text}`;
    if(/賞与|bonus|ボーナス/i.test(name)||/賞与|標準賞与額/i.test(t))return 'bonus_slip';
    if(/源泉徴収|gensen|withholding/i.test(name)||/給与所得の源泉徴収票|源泉徴収票/i.test(t))return 'withholding';
    if(/給与|給料|賃金|chinginmeisai|salary|支給合計/i.test(name)||/支給合計|総支給額|給与/i.test(t))return 'salary_slip';
    return 'unknown'
  }
  function normalizeDigits(s){return String(s||'').replace(/[０-９]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xfee0)).replace(/[，,]/g,'').replace(/[¥￥]/g,'')}
  function yenCandidates(s){return [...String(s||'').matchAll(/(?:¥|￥)?\s*([0-9０-９][0-9０-９,，]{2,})\s*円?/g)].map(m=>Number(normalizeDigits(m[1]))).filter(Number.isFinite)}
  function nearNumber(text,label,max=120){
    const re=new RegExp(label+'[^\\d０-９¥￥]{0,'+max+'}(?:[¥￥]\\s*)?([0-9０-９][0-9０-９,，]{2,})','i'),m=String(text||'').match(re);
    return m?Number(normalizeDigits(m[1])):null
  }
  function extractDateParts(text,name=''){
    const s=`${text}\n${name}`,m1=s.match(/(20\d{2})年\s*(\d{1,2})月/),m2=s.match(/(20\d{2})[\/._-](\d{1,2})/);
    if(m1)return {year:Number(m1[1]),month:Number(m1[2])};
    if(m2&&Number(m2[2])<=12)return {year:Number(m2[1]),month:Number(m2[2])};
    return filenameInfo(name)
  }
  function parseSalaryPdf(text,name=''){
    const d=extractDateParts(text,name),grossTotal=nearNumber(text,'(?:支給合計|総支給額|支給額|支給金額)',80),nonTaxableTotal=nearNumber(text,'(?:非課税|非課税合計)',80);
    let taxableGross=nearNumber(text,'(?:課税対象額|課税支給額)',80);
    if(taxableGross==null&&grossTotal!=null&&nonTaxableTotal!=null)taxableGross=grossTotal-nonTaxableTotal;
    const social=nearNumber(text,'(?:社会保険料合計|社会保険料)',80);
    const components={
      employmentInsurance:nearNumber(text,'(?:雇用保険)',60),
      healthInsurance:nearNumber(text,'(?:健康保険)(?!.*特定)',60),
      healthInsuranceSpecial:nearNumber(text,'(?:特定保険料|健康保険.*特定)',60),
      nursingCare:nearNumber(text,'(?:介護保険)',60),
      childSupport:nearNumber(text,'(?:子ども.*子育て支援金|子育て支援金)',60),
      pension:nearNumber(text,'(?:厚生年金|年金)',60)
    };
    return {year:d.year,month:d.month,gross:grossTotal,taxableGross,grossTotal,nonTaxableTotal,social,socialComponents:components,components:Object.entries(components).filter(([,v])=>v!=null),source:'google-drive',status:'actual',document:name,needsReview:!(d.year&&d.month&&grossTotal!=null&&taxableGross!=null&&social!=null)}
  }
  function parseBonusPdf(text,name=''){
    const d=extractDateParts(text,name),amount=nearNumber(text,'(?:支給合計|総支給額|支給額|賞与額)',100)??nearNumber(text,'(?:標準賞与額)',100);
    const social=nearNumber(text,'(?:社会保険料合計|社会保険料)',100);
    const standardHealth=nearNumber(text,'(?:標準賞与額).{0,80}(?:健康保険|介護保険)',120);
    const standardPension=nearNumber(text,'(?:標準賞与額).{0,120}(?:厚生年金|年金)',160);
    const date=d.year&&d.month?`${d.year}-${String(d.month).padStart(2,'0')}`:'';
    return {year:d.year,month:d.month,date,amount,social,standardHealth,standardPension,source:'google-drive',status:'actual',document:name,needsReview:!(date&&amount!=null&&social!=null)}
  }
  function parseWithholdingPdf(text,name=''){
    const d=extractDateParts(text,name);
    const year=(String(text||'').match(/(20\d{2})年分/)||String(text||'').match(/(20\d{2})年度/)||[])[1]?Number((String(text||'').match(/(20\d{2})年分/)||String(text||'').match(/(20\d{2})年度/))[1]):d.year;
    const annualSalary=nearNumber(text,'(?:支払金額)',100);
    const employmentIncome=nearNumber(text,'(?:給与所得控除後の金額|給与所得控除後)',100);
    const deductions=nearNumber(text,'(?:所得控除の額の合計額|所得控除合計)',120);
    const incomeTax=nearNumber(text,'(?:源泉徴収税額)',100);
    const social=nearNumber(text,'(?:社会保険料等の金額|社会保険料)',100);
    const life=nearNumber(text,'(?:生命保険料の控除額|生命保険料控除)',100);
    const basic=nearNumber(text,'(?:基礎控除)',80);
    const adjustment=nearNumber(text,'(?:所得金額調整控除)',100);
    const specialFamily=nearNumber(text,'(?:特定親族特別控除)',100);
    return {year,annualSalary,employmentIncome,deductions,incomeTax,social,lifeInsuranceDeduction:life,basicDeduction:basic,incomeAdjustmentDeduction:adjustment,specialDependentDeduction:specialFamily,source:'google-drive',status:'actual',document:name,needsReview:!(year&&annualSalary!=null&&incomeTax!=null&&social!=null)}
  }
  async function ensurePdfText(arrayBuffer,pdf,name=''){
    const base=pdf||await pdfText(arrayBuffer),type=classifyPdfText(base.text,name),raw=String(base.text||'');
    const minChars=type==='withholding'?80:type==='bonus'?100:120;
    let structuralOk=(base.textItemCount||0)>=8&&raw.length>=minChars;
    try{
      if(type==='salary_slip'){const q=parseSalaryPdf(raw,name);structuralOk=structuralOk&&q.grossTotal!=null&&q.taxableGross!=null&&q.social!=null}
      else if(type==='bonus_slip'){const q=parseBonusPdf(raw,name);structuralOk=structuralOk&&q.date&&q.amount!=null&&q.social!=null}
      else if(type==='withholding'){const q=parseWithholdingPdf(raw,name);structuralOk=structuralOk&&q.year!=null&&q.annualSalary!=null&&q.incomeTax!=null&&q.social!=null}
    }catch{structuralOk=false}
    if(structuralOk)return {...base,ocrUsed:false,ocrValidated:true};
    if(!base.pdfDoc)return {...base,ocrUsed:false,ocrValidated:false,ocrError:'PDFの文字レイヤーが不足しています'};
    const attempts=[];let best={text:'',confidence:0,words:0};
    const scales=[2.5,3.5];
    for(const scale of scales){
      try{
        const canvas=await renderPage(base.pdfDoc,1,scale);
        const ctx=canvas.getContext('2d'),img=ctx.getImageData(0,0,canvas.width,canvas.height);
        const variants=[canvas];
        const gray=document.createElement('canvas');gray.width=canvas.width;gray.height=canvas.height;const g=gray.getContext('2d');g.drawImage(canvas,0,0);const d=g.getImageData(0,0,gray.width,gray.height);
        for(let i=0;i<d.data.length;i+=4){const y=Math.round(.299*d.data[i]+.587*d.data[i+1]+.114*d.data[i+2]);const v=y>205?255:0;d.data[i]=d.data[i+1]=d.data[i+2]=v}g.putImageData(d,0,0);variants.push(gray);
        for(const [vi,v] of variants.entries())for(const psm of [6,11]){
          try{const r=await ocrCanvas(v,'jpn+eng',psm);attempts.push({scale,variant:vi,psm,chars:r.text.length,confidence:r.confidence,words:r.words,valid:r.text.length>=40&&r.confidence>=8});if(r.text.length>best.text.length||(r.text.length===best.text.length&&r.confidence>best.confidence))best=r}catch(e){attempts.push({scale,variant:vi,psm,error:String(e)})}
        }
        if(best.text.length>=180&&best.confidence>=12)break
      }catch(e){attempts.push({scale,error:String(e)})}
    }
    if(best.text){
      lastOcrImageDataUrl=lastOcrImageDataUrl||null;
      const out={...base,text:best.text,textItemCount:0,ocrUsed:true,ocrConfidence:best.confidence,ocrWordCount:best.words,ocrValidated:best.text.length>=40&&best.confidence>=8,ocrAttempts:attempts,ocrWidth:0,ocrHeight:0};
      log('ocr',{name,chars:best.text.length,confidence:best.confidence,attempts:attempts.length});
      return out
    }
    log('ocrError',{name,error:'OCR結果が空または短すぎます'});
    return {...base,ocrUsed:true,ocrConfidence:0,ocrWordCount:0,ocrValidated:false,ocrAttempts:attempts,ocrError:'OCR結果が空または短すぎます'}
  }
  function mergeSalary(state,x,f){
    state.salaryRecords=state.salaryRecords||[];
    const i=state.salaryRecords.findIndex(r=>Number(r.year||state.year)===Number(x.year||state.year)&&Number(r.month)===Number(x.month));
    const rec={...x,year:x.year||state.year,month:x.month,gross:Number(x.gross)||0,taxableGross:Number(x.taxableGross)||0,social:Number(x.social)||0,driveFileId:f.id,source:'google-drive',status:x.needsReview?'確認待ち':'actual',document:f.name};
    if(i>=0)state.salaryRecords[i]={...state.salaryRecords[i],...rec};else state.salaryRecords.push(rec)
  }
  function mergeBonus(state,x,f){
    state.bonusRecords=state.bonusRecords||[];
    const i=state.bonusRecords.findIndex(r=>r.document===f.name||(r.date&&x.date&&r.date===x.date&&Number(r.amount)===Number(x.amount)));
    if(i>=0)state.bonusRecords[i]={...state.bonusRecords[i],...x,driveFileId:f.id};else state.bonusRecords.push({...x,driveFileId:f.id})
  }
  function mergeWithholding(state,x,f){
    state.sourceDocuments=state.sourceDocuments||[];
    const i=state.sourceDocuments.findIndex(r=>r.file===f.name||r.driveFileId===f.id);
    const rec={file:f.name,type:'withholding',status:x.needsReview?'確認待ち':'imported',source:'google-drive',driveFileId:f.id,...x};
    if(i>=0)state.sourceDocuments[i]={...state.sourceDocuments[i],...rec};else state.sourceDocuments.push(rec);
    state.withholdingRecords=state.withholdingRecords||[];
    const j=state.withholdingRecords.findIndex(r=>r.document===f.name||r.driveFileId===f.id);
    if(j>=0)state.withholdingRecords[j]={...state.withholdingRecords[j],...x,driveFileId:f.id};else state.withholdingRecords.push({...x,driveFileId:f.id})
  }
  async function scanAndImport(state,onProgress){
    const files=await listCandidateFiles(),result={files:files.length,added:0,review:0,skipped:0,errors:[],details:[]};
    state.importFileDetails=[];
    for(const f of files){
      try{
        onProgress?.(`解析中: ${f.name}`);
        const buf=await downloadPdf(f.id),base=await pdfText(buf),pdf=await ensurePdfText(buf,base,f.name);
        const type=classifyPdfText(pdf.text,f.name)||f.candidateType;
        const detail={name:f.name,id:f.id,type:f.candidateType,filenameYear:f.year||null,detectedType:type,textChars:String(pdf.text||'').length,textItemCount:pdf.textItemCount||0,ocrUsed:!!pdf.ocrUsed,ocrConfidence:pdf.ocrConfidence||0,ocrError:pdf.ocrError||'',ocrWordCount:pdf.ocrWordCount||0,ocrValidated:!!pdf.ocrValidated,ocrAttempts:pdf.ocrAttempts||[],pageCount:pdf.pageCount||0,pageMeta:pdf.pageMeta||[]};
        if(type==='salary_slip'){const x=parseSalaryPdf(pdf.text,f.name);Object.assign(detail,x);if(x.year===state.year&&x.month)mergeSalary(state,x,f);else detail.needsReview=true}
        else if(type==='bonus_slip'){const x=parseBonusPdf(pdf.text,f.name);Object.assign(detail,x);mergeBonus(state,x,f)}
        else if(type==='withholding'){const x=parseWithholdingPdf(pdf.text,f.name);Object.assign(detail,x);mergeWithholding(state,x,f)}
        else{result.skipped++}
        if(detail.needsReview)result.review++;else if(type!=='unknown')result.added++;
        state.importFileDetails.push(detail);result.details.push(detail)
      }catch(e){result.errors.push(`${f.name}: ${e.message}`);state.importFileDetails.push({name:f.name,id:f.id,error:String(e)})}
    }
    return result
  }
  return {CLIENT_KEY,getClientId,setClientId,ready,authorize,signOut,listCandidateFiles,scanAndImport,classifyPdfText,parseSalaryPdf,parseBonusPdf,parseWithholdingPdf,ensurePdfText,getRuntimeDiagnostics,clearRuntimeDiagnostics,getLastOcrImageDataUrl:()=>lastOcrImageDataUrl}
})();
if(typeof window!=='undefined')window.FurusatoGoogleDrive=FurusatoGoogleDrive;
