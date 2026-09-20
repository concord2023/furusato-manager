const FurusatoCalculator = (() => {
  const sum=a=>(a||[]).reduce((x,v)=>x+(Number(v?.gross??v?.amount??v)||0),0);
  function salaryDeduction(x){x=Math.max(0,Number(x)||0);if(x<=2200000)return 740000;if(x<=3600000)return x*.30+80000;if(x<=6600000)return x*.20+440000;if(x<=8500000)return x*.10+1100000;return 1950000}
  function basicDeduction2026(income){income=Math.max(0,Number(income)||0);if(income<=1320000)return 1040000;if(income<=3360000)return 680000;if(income<=4890000)return 680000;if(income<=6550000)return 670000;if(income<=23500000)return 620000;if(income<=24000000)return 480000;if(income<=24500000)return 320000;if(income<=25000000)return 160000;return 0}
  function incomeTaxRate(t){if(t<=1949000)return .05;if(t<=3299000)return .10;if(t<=6949000)return .20;if(t<=8999000)return .23;if(t<=17999000)return .33;if(t<=39999000)return .40;return .45}
  function taxableAdjustmentsTotal(s){
    const year=Number(s.year||new Date().getFullYear());
    return (s.taxableAdjustments||[]).filter(x=>x.enabled!==false && x.taxable!==false && Number(x.year||year)===year).reduce((a,x)=>{
      const start=Number(x.startMonth||1), end=Number(x.endMonth||12), amount=Number(x.amount)||0;
      const months=Math.max(0,end-start+1); return a+amount*months;
    },0);
  }
  function lifeNewPremiumDeduction(v,childUnder23=false){
    v=Math.max(0,Number(v)||0);
    if(childUnder23){if(v<=30000)return v;if(v<=60000)return v*.5+15000;if(v<=120000)return v*.25+30000;return 60000}
    if(v<=20000)return v;if(v<=40000)return v*.5+10000;if(v<=80000)return v*.25+20000;return 40000
  }
  function lifeOldPremiumDeduction(v){v=Math.max(0,Number(v)||0);if(v<=25000)return v;if(v<=50000)return v*.5+12500;if(v<=100000)return v*.25+25000;return 50000}
  function lifeMixedDeduction(n,o,childUnder23=false){
    n=Math.max(0,Number(n)||0);o=Math.max(0,Number(o)||0);
    if(o>60000)return lifeOldPremiumDeduction(o);
    const cap=childUnder23?60000:40000;
    return Math.min(cap,lifeNewPremiumDeduction(n,childUnder23)+lifeOldPremiumDeduction(o));
  }
  function calcLifeInsurance(s){
    const d=s.deductions?.lifeInsurance||{}; const child=(s.family?.dependents||[]).some(x=>Number(x.age)>=0&&Number(x.age)<23&&Number(x.income||0)<=620000);
    const general=(Number(d.newGeneral)||0)>0 && (Number(d.oldGeneral)||0)>0?lifeMixedDeduction(d.newGeneral,d.oldGeneral,child):((Number(d.oldGeneral)||0)>0?lifeOldPremiumDeduction(d.oldGeneral):lifeNewPremiumDeduction(d.newGeneral,child));
    const medical=lifeNewPremiumDeduction(d.nursingMedical||0,false);
    const pension=(Number(d.newPension)||0)>0 && (Number(d.oldPension)||0)>0?lifeMixedDeduction(d.newPension,d.oldPension,false):((Number(d.oldPension)||0)>0?lifeOldPremiumDeduction(d.oldPension):lifeNewPremiumDeduction(d.newPension,false));
    return {general,medical,pension,total:Math.min(120000,general+medical+pension),childUnder23:child};
  }
  function lifeResidentNew(v){v=Math.max(0,Number(v)||0);if(v<=12000)return v;if(v<=32000)return v*.5+6000;if(v<=56000)return v*.25+14000;return 28000}
  function lifeResidentOld(v){v=Math.max(0,Number(v)||0);if(v<=15000)return v;if(v<=40000)return v*.5+7500;if(v<=70000)return v*.25+17500;return 35000}
  function lifeResidentMixed(n,o){const a=lifeResidentNew(n),b=lifeResidentOld(o),sum=Math.min(28000,a+b);return Math.max(a,b,sum)}
  function calcLifeInsuranceResident(s){const d=s.deductions?.lifeInsurance||{};const g=Number(d.newGeneral)||0;const go=Number(d.oldGeneral)||0;const p=Number(d.newPension)||0;const po=Number(d.oldPension)||0;const general=g&&go?lifeResidentMixed(g,go):(g?lifeResidentNew(g):lifeResidentOld(go));const pension=p&&po?lifeResidentMixed(p,po):(p?lifeResidentNew(p):lifeResidentOld(po));const medical=lifeResidentNew(d.nursingMedical||0);return Math.min(70000,general+pension+medical)}
  function earthquakeDeduction(detail){const d=detail||{};const e=Math.max(0,Number(d.paid)||0),o=Math.max(0,Number(d.oldLongTerm)||0);const ec=Math.min(50000,e);const oc=o<=10000?o:o<=20000?o*.5+5000:15000;return Math.min(50000,ec+oc)}
  function earthquakeResidentDeduction(detail){const d=detail||{};const e=Math.max(0,Number(d.paid)||0),o=Math.max(0,Number(d.oldLongTerm)||0);const ec=Math.min(25000,e*.5);const oc=o<=5000?o:o<=15000?o*.5+2500:10000;return Math.min(25000,ec+oc)}
  function dependentDeductions(s){
    const deps=Array.isArray(s.family?.dependents)?s.family.dependents:[]; let income=0,resident=0,under23=false,special=0;
    for(const d of deps){const age=Number(d.age),inc=Number(d.income)||0,disabled=d.disability||''; if(age>=0&&age<23)under23=true;
      if(age>=19&&age<23&&inc>620000&&inc<=1230000){const table=[[850000,630000],[900000,610000],[950000,510000],[1000000,410000],[1050000,310000],[1100000,210000],[1150000,110000],[1200000,60000],[1230000,30000]];let v=0;for(const [lim,val] of table){if(inc<=lim){v=val;break}} special+=v;continue}
      if(inc>620000)continue;
      if(age<16)continue;
      let x=age>=70?(d.livingTogether?580000:480000):(age>=19&&age<23?630000:380000); income+=x; resident+=age>=70?(d.livingTogether?450000:380000):(age>=19&&age<23?450000:330000);
      if(disabled==='special'){income+=270000;resident+=300000} else if(disabled==='ordinary'){income+=270000;resident+=260000}
    }
    income+=special; resident+=special; return {income,resident,under23,specialDependent:special};
  }
  function spouseDeductions(s,totalIncome){const sp=s.family?.spouse||{};if(!sp.exists)return {income:0,resident:0};const inc=Number(sp.income)||0;if(totalIncome>10000000)return {income:0,resident:0};if(inc<=620000)return {income:380000,resident:330000};if(inc<=1330000){const income=Math.max(0,380000-Math.ceil((inc-620000)/10000)*10000);return {income,resident:Math.min(330000,income)}}return {income:0,resident:0}}
  function calc(s){
    const salaryActual=sum((s.salaryRecords||[]).filter(r=>r.status==='actual').map(r=>({gross:r.taxableGross??r.gross}))); 
    const salaryForecast=sum((s.salaryRecords||[]).filter(r=>r.status==='forecast').map(r=>({gross:r.taxableGross??r.gross}))) || sum(s.forecastSalary||[]);
    const explicitForecast=sum(s.forecastSalary||[]);
    const salaryForecastTotal=(s.salaryRecords||[]).some(r=>r.status==='forecast')?salaryForecast:explicitForecast;
    const bonusActual=sum((s.bonusRecords||[]).filter(r=>r.status==='actual').map(r=>({gross:r.taxableGross??r.amount}))); const bonusForecast=Number(s.forecastBonus)||0;
    const adjustmentTotal=taxableAdjustmentsTotal(s);
    const employmentGross=salaryActual+salaryForecastTotal+bonusActual+bonusForecast+adjustmentTotal;
    const tempTaxable=s.adjustments?.temporaryTaxable?Number(s.adjustments.temporary)||0:0;
    const incomeAdjustmentOverride=Number(s.deductions?.incomeAdjustmentOverride)||0;
    const incomeAdjustmentAuto=(employmentGross>8500000 && ((s.family?.dependents||[]).some(d=>Number(d.age)>=0&&Number(d.age)<23)||s.family?.selfSpecialDisability||s.family?.spouseSpecialDisability))?Math.ceil((Math.min(employmentGross,10000000)-8500000)*.1):0;
    const incomeAdjustmentDeduction=Math.max(incomeAdjustmentOverride,incomeAdjustmentAuto);
    const totalIncomeBeforeDed=Math.max(0,employmentGross-salaryDeduction(employmentGross)-incomeAdjustmentDeduction+tempTaxable+Number(s.adjustments?.otherIncome||0));
    const socialSalaryActual=sum(s.socialRecords?.filter(r=>r.status==='actual')); const socialSalaryForecast=sum(s.socialRecords?.filter(r=>r.status==='forecast'))+sum(s.forecastSocial||[]); const bonusSocialActual=sum(s.bonusSocialRecords?.filter(r=>r.status==='actual')); const bonusSocialForecast=sum(s.bonusSocialRecords?.filter(r=>r.status==='forecast')); const socialActual=socialSalaryActual+bonusSocialActual; const socialForecast=socialSalaryForecast+bonusSocialForecast; const social=socialActual+socialForecast;
    const basic=s.deductions?.basicOverride==null?basicDeduction2026(totalIncomeBeforeDed):Number(s.deductions.basicOverride)||0; const life=calcLifeInsurance(s), lifeResident=calcLifeInsuranceResident(s);
    const earthquakeDetail=s.deductions?.earthquakeDetail||{paid:Number(s.deductions?.earthquake)||0,oldLongTerm:0};
    const earthquake=earthquakeDeduction(earthquakeDetail), earthquakeResident=earthquakeResidentDeduction(earthquakeDetail);
    let dep=dependentDeductions(s); const specialOverride=Number(s.deductions?.specialDependentOverride)||0; if(!dep.income&&specialOverride){dep={...dep,income:specialOverride,resident:450000,specialDependent:specialOverride};} const spouse=spouseDeductions(s,totalIncomeBeforeDed);
    const ideco=Number(s.deductions?.ideco)||0, other=Number(s.deductions?.other)||0;
    const otherBreakdown=s.deductions?.otherBreakdown||{};
    const otherTotal=Math.max(other,(Number(otherBreakdown.medical)||0)+(Number(otherBreakdown.disability)||0)+(Number(otherBreakdown.widow)||0)+(Number(otherBreakdown.workingStudent)||0)+(Number(otherBreakdown.other)||0));
    const taxableIncome=Math.max(0,Math.floor((totalIncomeBeforeDed-social-ideco-life.total-earthquake-otherTotal-dep.income-spouse.income)/1000)*1000);
    const residentBasic=430000;
    const residentTaxable=Math.max(0,Math.floor((totalIncomeBeforeDed-social-ideco-lifeResident-earthquakeResident-otherTotal-dep.resident-spouse.resident)/1000)*1000);
    const residentLevy=residentTaxable*.10;
    const rate=incomeTaxRate(taxableIncome);
    const specialLimit=residentLevy*.20;
    const denom=Math.max(.01,.90-rate*1.021);
    const estimatedLimit=Math.max(2000,Math.floor((specialLimit/denom+2000)/1000)*1000);
    const safe=Math.max(2000,Math.floor(estimatedLimit*.90/1000)*1000);
    const donated=(s.donations||[]).filter(x=>x.status!=='確認待ち'&&x.included!==false).reduce((a,x)=>a+(Number(x.amount)||0),0);
    const pendingDonations=(s.donations||[]).filter(x=>x.status==='確認待ち'&&x.included!==false).reduce((a,x)=>a+(Number(x.amount)||0),0); const unknownInputs=[]; if(!s.deductions?.ideco) unknownInputs.push('iDeCo'); if(!(life.total||0)) unknownInputs.push('生命保険料控除'); if(!(earthquake||0)) unknownInputs.push('地震保険料控除'); if(!otherTotal) unknownInputs.push('その他所得控除'); if(dep.under23 && !incomeAdjustmentDeduction) unknownInputs.push('所得金額調整控除'); return {salaryActual,salaryForecast:salaryForecastTotal,bonusActual,bonusForecast,adjustmentTotal,employmentGross,tempTaxable,totalIncomeBeforeDed,incomeAdjustmentDeduction,socialSalaryActual,socialSalaryForecast,bonusSocialActual,bonusSocialForecast,socialActual,socialForecast,social,basic,ideco,lifeInsurance:life.total,lifeInsuranceBreakdown:life,lifeResident,earthquake,earthquakeResident,other:otherTotal,otherBreakdown,dependentDeduction:dep.income,residentDependentDeduction:dep.resident,specialDependent:dep.specialDependent,spouseDeduction:spouse.income,residentSpouseDeduction:spouse.resident,taxableIncome,residentTaxable,residentLevy,rate,specialLimit,estimatedLimit,safe,donated,pendingDonations,remaining:Math.max(0,estimatedLimit-donated),unknownInputs};
  }
  function sensitivity(s,deltaSalary=100000,deltaBonus=0){const a=calc(s);const b=FurusatoModel.clone(s);b.forecastSalary=[...(b.forecastSalary||[])];if(b.forecastSalary.length)b.forecastSalary[b.forecastSalary.length-1]=(b.forecastSalary.at(-1)||0)+deltaSalary;else b.forecastSalary=[deltaSalary];b.forecastBonus=(Number(b.forecastBonus)||0)+deltaBonus;const c=calc(b);return {base:a,changed:c,limitDelta:c.estimatedLimit-a.estimatedLimit};}
  return {calc,salaryDeduction,basicDeduction2026,incomeTaxRate,sensitivity,calcLifeInsurance,earthquakeDeduction,dependentDeductions,spouseDeductions};
})();
if(typeof window!=='undefined') window.FurusatoCalculator=FurusatoCalculator;
if(typeof module!=='undefined') module.exports=FurusatoCalculator;
