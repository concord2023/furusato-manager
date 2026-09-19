// Data model and normalization for the ふるさと納税マネージャー.
const FurusatoModel = (() => {
  const DEFAULT = {
    schemaVersion: 6, year: 2026, asOf: '2026-09-17', actualThrough: 9, importSettings:{targetYear:2026,priorYear:2025}, importHistory:[],
    salaryRecords: [],
    forecastSalary: [],
    forecastMethod:{salary:'2026年4〜9月実績平均',social:'2026年4〜9月実績平均',bonus:'対象年の未支給シーズンは前年同シーズン賞与を参考'},
    bonusRecords:[{date:'2026-07',amount:5550000,source:'pdf:1219856-Bonus-202607.pdf',status:'actual',document:'1219856-Bonus-202607.pdf',note:'第122期 後半期賞与'}],
    forecastBonus:0,
    bonusSocialRecords:[{date:'2026-07',amount:388387,source:'pdf:1219856-Bonus-202607.pdf',status:'actual',note:'雇用保険・健康保険・介護保険・子ども子育て支援金・年金保険の合計。持株会・所得税は含めない'}],
    socialRecords:[],
    forecastSocial:[],
    deductions:{ideco:0,earthquake:0,other:0,basicOverride:null},
    adjustments:{temporary:0,temporaryTaxable:true,otherIncome:0},
    taxableAdjustments:[],
    prior:{salary:0,bonus:0,social:0},
    sourceDocuments:[{file:'1219856-Bonus-202607.pdf',type:'bonus_slip',status:'imported',note:'2026年7月賞与・支給合計5,550,000円'},{file:'1219856-Assets-202608.pdf',type:'asset_statement',status:'review_needed',note:'資産形成・DC等の記載あり。給与/控除には自動反映しない'}],
    donations:[
      {id:'r1',site:'楽天',city:'○○市',item:'米10kg',amount:30000,status:'確定',delivery:'9/27予定',orderId:'R-001',source:'sample'},
      {id:'s1',site:'さとふる',city:'△△市',item:'牛肉',amount:20000,status:'確定',delivery:'9/30頃',orderId:'S-001',source:'sample'},
      {id:'c1',site:'ふるさとチョイス',city:'□□市',item:'果物',amount:15000,status:'確定',delivery:'10月上旬',orderId:'C-001',source:'sample'},
      {id:'a1',site:'Amazon等',city:'確認待ち',item:'その他',amount:10000,status:'確認待ち',delivery:'未確定',orderId:'',source:'sample'}
    ]
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
    s.schemaVersion=6;
    s.importSettings=s.importSettings||{targetYear:s.year||2026,priorYear:(s.year||2026)-1};
    s.importSettings.targetYear=Number(s.importSettings.targetYear)||Number(s.year)||2026;
    s.importSettings.priorYear=s.importSettings.targetYear-1;
    s.salaryRecords=(s.salaryRecords||[]).map(r=>({...r,taxableGross:r.taxableGross==null?Number(r.gross)||0:Number(r.taxableGross)})).filter(r=>Number(r.taxableGross)>0 || r.source==='manual');
    s.taxableAdjustments=Array.isArray(s.taxableAdjustments)?s.taxableAdjustments:[];
    s.bonusSocialRecords=Array.isArray(s.bonusSocialRecords)?s.bonusSocialRecords:[];
    if(!s.salaryRecords?.length && Array.isArray(raw?.salary)) s.salaryRecords=raw.salary.map((gross,i)=>({month:i+1,gross,source:'auto',status:i+1<=9?'actual':'forecast'}));
    return s;
  }
  const IMPORT_HISTORY_KEY='furusatoImportHistory';
  function load(){try{const raw=JSON.parse(localStorage.getItem('furusatoState')||'null');const s=normalize(raw);const h=JSON.parse(localStorage.getItem(IMPORT_HISTORY_KEY)||'null');if(Array.isArray(h))s.importHistory=h.slice(0,200);return s}catch{return clone(DEFAULT)}}
  function save(s){const n=normalize(s);const h=Array.isArray(n.importHistory)?n.importHistory.slice(0,200):[];localStorage.setItem('furusatoState',JSON.stringify(n));localStorage.setItem(IMPORT_HISTORY_KEY,JSON.stringify(h))}
  return {DEFAULT,clone,merge,normalize,load,save};
})();
if(typeof window!=='undefined') window.FurusatoModel=FurusatoModel;
if(typeof module!=='undefined') module.exports=FurusatoModel;
