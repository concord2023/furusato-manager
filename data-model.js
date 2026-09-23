// Data model and normalization for the ふるさと納税マネージャー.
const FurusatoModel = (() => {
  const DEFAULT = {
    schemaVersion: 12, year: new Date().getFullYear(), asOf: new Date().toISOString().slice(0,10), actualThrough: 0, importSettings:{targetYear:new Date().getFullYear(),priorYear:new Date().getFullYear()-1}, importHistory:[],
    salaryRecords: [],
    yearRecords: {},
    forecastSalary: [],
    forecastMethod:{salary:'対象年4〜9月実績平均（未取得月を自動予測）',social:'対象年4〜9月実績平均（未取得月を自動予測）',bonus:'対象年の未支給シーズンは前年同シーズン賞与を参考'},
    bonusRecords:[],
    forecastBonus:0,
    bonusSocialRecords:[],
    socialRecords:[],
    forecastSocial:[],
    deductions:{ideco:0,earthquake:0,other:0,basicOverride:null,lifeInsurance:{newGeneral:0,oldGeneral:0,nursingMedical:0,newPension:0,oldPension:0,source:'manual',needsConfirmation:false},earthquakeDetail:{paid:0,oldLongTerm:0,source:'manual',needsConfirmation:false},housingLoan:{deduction:0,source:'manual',needsConfirmation:false},otherBreakdown:{medical:0,disability:0,widow:0,workingStudent:0,other:0}},
    adjustments:{temporary:0,temporaryTaxable:true,otherIncome:0},
    taxableAdjustments:[],
    prior:{salary:0,bonus:0,social:0},
    priorWithholding:null,currentWithholding:null,withholdingRecords:[],
    family:{spouse:{exists:false,name:'',income:0,age:null,source:'manual',needsConfirmation:false},dependents:[],priorNote:''},
    sourceDocuments:[],
    donations:[]
  };
  const clone=x=>JSON.parse(JSON.stringify(x));
  function merge(a,b){for(const k in b){if(b[k]&&typeof b[k]==='object'&&!Array.isArray(b[k])&&a[k]&&typeof a[k]==='object'&&!Array.isArray(a[k]))a[k]=merge(a[k],b[k]);else a[k]=b[k]}return a}
  function normalize(raw){
    const s=merge(clone(DEFAULT),raw||{});
    // Remove the old built-in demo salary/social records from existing browser storage.
    // They are not user data: their exact 470000/465000/... sequence was shipped as sample data
    // and must never appear as if it had been automatically read from a payroll PDF.
    const demoSalary=[470000,465000,475000,470000,480000,470000,480000,480000,490000];
    const rawSalary=Array.isArray(raw?.salaryRecords)?raw.salaryRecords:[];
    const isDemoSalary=rawSalary.length===9 && rawSalary.every((r,i)=>Number(r?.gross)===demoSalary[i] && (r?.source==='auto'||r?.source==null) && r?.status==='actual');
    if(isDemoSalary){
      s.salaryRecords=[];
      s.forecastSalary=[];
    }
    const demoSocial=[68000,68000,69000,68000,69000,69000,70000,69000,70000];
    const rawSocial=Array.isArray(raw?.socialRecords)?raw.socialRecords:[];
    const isDemoSocial=rawSocial.length===9 && rawSocial.every((r,i)=>Number(r?.amount)===demoSocial[i] && (r?.source==='auto'||r?.source==null) && r?.status==='actual');
    if(isDemoSocial){
      s.socialRecords=[];
      s.forecastSocial=[];
    }
    // One-time migration from the earlier demo bonus value. Do not overwrite manual data.
    if(raw && raw.schemaVersion!==2 && Array.isArray(s.bonusRecords) && s.bonusRecords.length===1 && s.bonusRecords[0].source==='auto' && Number(s.bonusRecords[0].amount)===600000){
      s.bonusRecords=[clone(DEFAULT.bonusRecords[0])];
      s.forecastBonus=0;
      s.bonusSocialRecords=clone(DEFAULT.bonusSocialRecords);
    }
    if(Number(raw?.schemaVersion||0)<11){s.deductions=s.deductions||{};s.deductions.incomeAdjustmentOverride=null;s.deductions.specialDependentOverride=null;}
    s.schemaVersion=12;
    s.importSettings=s.importSettings||{targetYear:s.year||2026,priorYear:(s.year||2026)-1};
    s.importSettings.targetYear=Number(s.importSettings.targetYear)||Number(s.year)||2026;
    s.importSettings.priorYear=s.importSettings.targetYear-1;
    s.salaryRecords=(s.salaryRecords||[])
      .map(r=>({...r,taxableGross:r.taxableGross==null?Number(r.gross)||0:Number(r.taxableGross)}))
      .filter(r=>Number(r.taxableGross)>0 || r.source==='manual');
    // Old builds could leave auto-generated/demo payroll rows in localStorage.
    // A payroll row imported from Drive has a document/file id; manual rows are kept.
    // Never let a legacy auto row masquerade as a newly imported actual month.
    s.salaryRecords=s.salaryRecords.filter(r=>!(r.source==='auto' && !r.document && !r.driveFileId && !r.fileId));
    s.socialRecords=(s.socialRecords||[]).filter(r=>!(r.source==='auto' && !r.document && !r.driveFileId && !r.fileId));
    // Salary records are the authoritative monthly source. If an older build
    // saved the social-insurance amount only inside the salary row, restore it
    // here so January-April cannot disappear merely because socialRecords was
    // written by a different parser version.
    for(const r of s.salaryRecords){
      if(r.status!=='actual' || !(Number(r.social)>0 || r.socialComponents)) continue;
      const has=(s.socialRecords||[]).some(x=>Number(x.year||s.year)===Number(r.year||s.year)&&Number(x.month)===Number(r.month));
      if(!has && Number(r.social)>0){
        s.socialRecords.push({year:r.year||s.year,month:r.month,amount:Number(r.social),components:r.socialComponents||{},source:r.source||'recovered',status:'actual',document:r.document||'',driveFileId:r.driveFileId||'',needsReview:false});
      }
    }
    // Recompute the actual-through marker from actual salary records instead of trusting
    // stale metadata such as the old fixed "through September" default.
    const actualMonths=s.salaryRecords.filter(r=>r.status==='actual' && Number(r.month)>=1 && Number(r.month)<=12 && Number(r.taxableGross)>0).map(r=>Number(r.month));
    s.actualThrough=actualMonths.length?Math.max(...actualMonths):0;
    // If an old state lost its September row, its old forecast array can still
    // contain only 3 entries (Oct-Dec). Rebuild the salary/social forecast here
    // so the newly missing month is included and December cannot fall off the end.
    if(s.actualThrough>0){
      const actualRows=s.salaryRecords.filter(r=>r.status==='actual' && Number(r.month)>=4 && Number(r.month)<=Math.min(9,s.actualThrough));
      const avg=(rows,key)=>{const vals=rows.map(r=>Number(r[key])||0).filter(v=>v>0);return vals.length?Math.round(vals.reduce((a,v)=>a+v,0)/vals.length):0};
      const salaryAvg=avg(actualRows,'taxableGross');
      const socialRows=(s.socialRecords||[]).filter(r=>r.status==='actual' && Number(r.month)>=4 && Number(r.month)<=Math.min(9,s.actualThrough));
      const socialAvg=avg(socialRows,'amount');
      s.forecastSalary=Array.from({length:Math.max(0,12-s.actualThrough)},()=>salaryAvg);
      s.forecastSocial=Array.from({length:Math.max(0,12-s.actualThrough)},()=>socialAvg);
    }else{
      s.forecastSalary=[]; s.forecastSocial=[];
    }
    s.taxableAdjustments=Array.isArray(s.taxableAdjustments)?s.taxableAdjustments:[];
    s.deductions=s.deductions||{};
    if(!s.deductions.lifeInsurance)s.deductions.lifeInsurance={newGeneral:0,oldGeneral:0,nursingMedical:0,newPension:0,oldPension:0,source:'manual',needsConfirmation:false};
    if(!s.deductions.earthquakeDetail)s.deductions.earthquakeDetail={paid:Number(s.deductions.earthquake)||0,oldLongTerm:0,source:'manual',needsConfirmation:false};
    if(!s.deductions.otherBreakdown)s.deductions.otherBreakdown={medical:0,disability:0,widow:0,workingStudent:0,other:Number(s.deductions.other)||0};
    s.withholdingRecords=Array.isArray(s.withholdingRecords)?s.withholdingRecords:[];
    // Keep annual history separately from the live current-year forecast.
    // A parsed withholding certificate becomes a fixed/confirmed annual source;
    // later edits only change that year's manual inputs.
    s.yearRecords=s.yearRecords&&typeof s.yearRecords==='object'&&!Array.isArray(s.yearRecords)?s.yearRecords:{};
    for(const w of s.withholdingRecords){
      const y=Number(w?.year); if(!y||!Number(w?.annualSalary))continue;
      const prev=s.yearRecords[String(y)]||{};
      s.yearRecords[String(y)]={...prev,year:y,status:'confirmed',withholding:clone(w),manual:{nationalPension:Number(prev.manual?.nationalPension)||0},updatedAt:prev.updatedAt||new Date().toISOString()};
    }
    for(const [k,v] of Object.entries(s.yearRecords)){
      const y=Number(k); if(!y||y<2024||y>2100||!v||typeof v!=='object')delete s.yearRecords[k];
      else {v.year=y;v.manual=v.manual&&typeof v.manual==='object'?v.manual:{};v.manual.nationalPension=Math.max(0,Number(v.manual.nationalPension)||0);}
    }
    s.family=s.family&&typeof s.family==='object'?s.family:{spouse:{exists:false,name:'',income:0,age:null,source:'manual',needsConfirmation:false},dependents:[],priorNote:''};
    s.family.spouse=s.family.spouse&&typeof s.family.spouse==='object'?s.family.spouse:{exists:false,name:'',income:0,age:null,source:'manual',needsConfirmation:false};
    s.family.dependents=Array.isArray(s.family.dependents)?s.family.dependents:[];
    s.priorWithholding=s.priorWithholding||null; s.currentWithholding=s.currentWithholding||null;
    if(!s.priorWithholding){
      const candidates=[...(s.withholdingRecords||[]),...(s.sourceDocuments||[])].filter(x=>Number(x.year)===Number(s.importSettings?.priorYear||((s.year||new Date().getFullYear())-1)) && Number(x.annualSalary)>0);
      if(candidates.length)s.priorWithholding=clone(candidates.sort((a,b)=>String(b.document||b.file||'').localeCompare(String(a.document||a.file||'')))[0]);
    }
    if(!s.currentWithholding){
      const candidates=(s.withholdingRecords||[]).filter(x=>Number(x.year)===Number(s.year)&&Number(x.annualSalary)>0);
      if(candidates.length)s.currentWithholding=clone(candidates[0]);
    }
    s.bonusSocialRecords=Array.isArray(s.bonusSocialRecords)?s.bonusSocialRecords:[];
    if(!s.salaryRecords?.length && Array.isArray(raw?.salary)){
      // Legacy arrays had no reliable distinction between actual and forecast.
      // If the old state explicitly recorded actualThrough, preserve only that
      // boundary; otherwise treat the stored values as actual payroll rows.
      const legacyThrough=Number(raw?.actualThrough);
      s.salaryRecords=raw.salary.map((gross,i)=>({month:i+1,gross,source:'legacy',status:(legacyThrough>0?i+1<=legacyThrough:true)?'actual':'forecast'})).filter(r=>Number(r.gross)>0);
    }
    // Rebuild the forecast one final time after every migration above.  This is
    // intentionally after the legacy migration: otherwise a migrated 8-month
    // state could keep an old 3-month forecast and make December display 0.
    const rebuildBonusForecastSocial=()=>{
      const targetYear=Number(s.importSettings?.targetYear||s.year||new Date().getFullYear()); const healthCap=5730000;
      const fiscal=(year,month)=>Number(month)>=4?Number(year):Number(year)-1;
      const actualFor=rec=>{const month=Number(rec.month||String(rec.date||'').slice(5,7))||12; const fy=fiscal(targetYear,month); return (s.bonusRecords||[]).filter(r=>r.status==='actual'&&Number(r.amount)>0&&fiscal(Number(r.year||String(r.date||'').slice(0,4)),Number(r.month||String(r.date||'').slice(5,7)))===fy)};
      (s.bonusSocialRecords||[]).filter(r=>r.status==='forecast').forEach(rec=>{
        const prior=(s.priorBonusRecords||[]).find(r=>(r.season||'')===(rec.season||'')); const amount=Math.max(0,Number(prior?.amount)||0); if(!amount)return;
        const actual=actualFor(rec); const used=actual.reduce((a,r)=>a+Math.min(healthCap,Number(r.standardBonusHealth)||Number(r.amount)||0),0); const standardHealth=Math.max(0,Math.min(Math.floor(amount/1000)*1000,healthCap-used)); const standardPension=Math.min(Math.floor(amount/1000)*1000,1500000);
        const ref=[...actual,...(s.priorBonusRecords||[])].sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))).find(r=>Object.values(r.socialComponents||{}).some(v=>Number(v)>0))||null; const refBase=Number(ref?.standardBonusHealth)||Number(ref?.amount)||0; const c=ref?.socialComponents||{}; const rate=k=>refBase>0&&Number(c[k])>0?Number(c[k])/refBase:0;
        const components={employmentInsurance:Math.floor(amount*0.005),healthInsurance:Math.floor(standardHealth*rate('healthInsurance')),healthInsuranceSpecial:Math.floor(standardHealth*rate('healthInsuranceSpecial')),nursingCare:Math.floor(standardHealth*rate('nursingCare')),childSupport:Math.floor(standardHealth*0.00115),pension:Math.floor(standardPension*0.0915)};
        rec.amount=Object.values(components).reduce((a,v)=>a+(Number(v)||0),0); rec.components=components; rec.standardBonusHealth=standardHealth; rec.standardBonusPension=standardPension; rec.note=`${targetYear}年の実績賞与と制度上限を反映して予測。雇用保険0.5%、厚生年金18.3%の本人負担9.15%、子ども・子育て支援金0.23%の本人負担0.115%を適用。健康保険系は対象年の実績賞与から本人負担率を算出。`;
      });
    };
    const rebuildForecast=()=>{
      const actualMonths=(s.salaryRecords||[]).filter(r=>r.status==='actual'&&Number(r.month)>=1&&Number(r.month)<=12&&Number(r.taxableGross??r.gross)>0).map(r=>Number(r.month));
      s.actualThrough=actualMonths.length?Math.max(...actualMonths):0;
      if(!s.actualThrough){s.forecastSalary=[];s.forecastSocial=[];return;}
      const end=Math.min(9,s.actualThrough);
      const salaryRows=(s.salaryRecords||[]).filter(r=>r.status==='actual'&&Number(r.month)>=4&&Number(r.month)<=end);
      const avg=(rows,getter)=>{const vals=rows.map(getter).map(Number).filter(v=>Number.isFinite(v)&&v>0);return vals.length?Math.round(vals.reduce((a,v)=>a+v,0)/vals.length):0};
      const salaryAvg=avg(salaryRows,r=>r.taxableGross??r.gross);
      const socialRows=(s.socialRecords||[]).filter(r=>r.status==='actual'&&Number(r.month)>=4&&Number(r.month)<=end);
      const socialAvg=avg(socialRows,r=>r.amount);
      s.forecastSalary=Array.from({length:Math.max(0,12-s.actualThrough)},()=>salaryAvg);
      s.forecastSocial=Array.from({length:Math.max(0,12-s.actualThrough)},()=>socialAvg);
    };
    rebuildForecast();
    rebuildBonusForecastSocial();
    // Reconcile the annual certificate against monthly payroll only as a
    // reference. The certificate remains authoritative even when the totals
    // differ; incomplete months and taxable/non-taxable timing make a direct
    // equality check unsuitable as an error condition.
    for(const [k,v] of Object.entries(s.yearRecords||{})){
      const w=v?.withholding; if(!w||Number(w.annualSalary)<=0)continue;
      const y=Number(k);
      const monthlyRows=(s.salaryRecords||[]).filter(r=>Number(r.year)===y&&r.status==='actual');
      const monthlyGross=monthlyRows.reduce((a,r)=>a+(Number(r.grossTotal??r.taxableGross)||0),0);
      const bonusRows=(s.bonusRecords||[]).filter(r=>Number(r.year)===y&&r.status==='actual');
      const bonusGross=bonusRows.reduce((a,r)=>a+(Number(r.amount)||0),0);
      const referenceGross=monthlyGross+bonusGross;
      const monthlySocial=(s.socialRecords||[]).filter(r=>Number(r.year)===y&&r.status==='actual').reduce((a,r)=>a+(Number(r.amount)||0),0);
      const bonusSocial=bonusRows.reduce((a,r)=>a+(Number(r.social)||0),0);
      const referenceSocial=monthlySocial+bonusSocial;
      v.status='confirmed';
      v.withholding={...w,certificateAuthoritative:true,needsReview:false,monthlyReference:{months:monthlyRows.map(r=>Number(r.month)).filter(Boolean).sort((a,b)=>a-b),monthlyGross,bonusGross,referenceGross,annualSalary:Number(w.annualSalary)||0,difference:referenceGross-(Number(w.annualSalary)||0),monthlySocial,bonusSocial,referenceSocial,withholdingSocial:Number(w.social)||0,socialDifference:referenceSocial-(Number(w.social)||0),complete:monthlyRows.length===12,comparison:'参考情報のみ'}};
    }
    return s;
  }
  const IMPORT_HISTORY_KEY='furusatoImportHistory';
  const STATE_BACKUP_KEY='furusatoStateBackup';
  const PAYROLL_STORE_KEY='furusatoPayrollStore';
  function safeRead(key){try{return localStorage.getItem(key)}catch{return null}}
  function safeWrite(key,value){try{localStorage.setItem(key,value);return true}catch{return false}}
  function load(){
    try{
      const primary=safeRead('furusatoState');
      const backup=safeRead(STATE_BACKUP_KEY);
      let raw=null;
      if(primary){try{raw=JSON.parse(primary)}catch{raw=null}}
      if(!raw&&backup){try{raw=JSON.parse(backup)}catch{raw=null}}
      let s=normalize(raw);
      const storeRaw=safeRead(PAYROLL_STORE_KEY);
      if(storeRaw){
        try{
          const store=JSON.parse(storeRaw);
          if(store&&typeof store==='object'){
            // The main state is authoritative. The payroll store is a recovery
            // copy, not a second source that may overwrite newer data with an
            // older/empty snapshot when navigating between pages.
            for(const k of ['salaryRecords','yearRecords','socialRecords','forecastSalary','forecastSocial','bonusRecords','bonusSocialRecords','forecastBonus','priorSalaryRecords','priorSocialRecords','priorBonusRecords','prior','sourceDocuments','importScanCandidates','importFileDetails','importDiagnostics','importSettings']){
              if((s[k]===undefined || (Array.isArray(s[k])&&s[k].length===0)) && store[k]!==undefined)s[k]=clone(store[k]);
            }
            // Re-normalize after recovery data is merged so actualThrough and
            // forecasts are rebuilt from the recovered payroll records too.
            s=normalize(s);
          }
        }catch{}
      }
      const hRaw=safeRead(IMPORT_HISTORY_KEY);
      if(hRaw){try{const h=JSON.parse(hRaw);if(Array.isArray(h))s.importHistory=h.slice(0,200)}catch{}}
      return s;
    }catch{return clone(DEFAULT)}
  }
  function save(s){
    const n=normalize(s);
    const json=JSON.stringify(n);
    const h=Array.isArray(n.importHistory)?n.importHistory.slice(0,200):[];
    // Keep a second state copy so a malformed/partial primary write cannot
    // make another tab appear to have reset the application.
    safeWrite(STATE_BACKUP_KEY,json);
    safeWrite('furusatoState',json);
    safeWrite(IMPORT_HISTORY_KEY,JSON.stringify(h));
    const payrollStore={};
    for(const k of ['salaryRecords','yearRecords','socialRecords','forecastSalary','forecastSocial','bonusRecords','bonusSocialRecords','forecastBonus','priorSalaryRecords','priorSocialRecords','priorBonusRecords','prior','sourceDocuments','importScanCandidates','importFileDetails','importDiagnostics','importSettings'])payrollStore[k]=n[k];
    safeWrite(PAYROLL_STORE_KEY,JSON.stringify(payrollStore));
    return n;
  }
  return {DEFAULT,clone,merge,normalize,load,save,keys:{IMPORT_HISTORY_KEY,STATE_BACKUP_KEY,PAYROLL_STORE_KEY}};
})();
if(typeof window!=='undefined') window.FurusatoModel=FurusatoModel;
if(typeof module!=='undefined') module.exports=FurusatoModel;
