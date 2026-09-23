const FurusatoCalculator = (() => {
  const sum=a=>(a||[]).reduce((x,v)=>x+(Number(v?.gross??v?.amount??v)||0),0);
  function salaryDeduction(x){x=Math.max(0,Number(x)||0);if(x<=2200000)return 740000;if(x<=3600000)return x*.30+80000;if(x<=6600000)return x*.20+440000;if(x<=8500000)return x*.10+1100000;return 1950000}
  function basicDeduction2026(income){income=Math.max(0,Number(income)||0);if(income<=1320000)return 1040000;if(income<=3360000)return 880000;if(income<=4890000)return 680000;if(income<=6550000)return 670000;if(income<=23500000)return 620000;if(income<=24000000)return 480000;if(income<=24500000)return 320000;if(income<=25000000)return 160000;return 0}
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
    const deps=(Array.isArray(s.family?.dependents)?s.family.dependents:[]).filter(d=>d.needsConfirmation!==true); let income=0,resident=0,under23=false,special=0;
    for(const d of deps){const age=Number(d.age),inc=Number(d.income)||0,disabled=d.disability||''; if(age>=0&&age<23)under23=true;
      if(age>=19&&age<23&&inc>620000&&inc<=1230000){const table=[[850000,630000],[900000,610000],[950000,510000],[1000000,410000],[1050000,310000],[1100000,210000],[1150000,110000],[1200000,60000],[1230000,30000]];let v=0;for(const [lim,val] of table){if(inc<=lim){v=val;break}} special+=v;continue}
      if(inc>620000)continue;
      if(age<16)continue;
      let x=age>=70?(d.livingTogether?580000:480000):(age>=19&&age<23?630000:380000); income+=x; resident+=age>=70?(d.livingTogether?450000:380000):(age>=19&&age<23?450000:330000);
      if(disabled==='special'){income+=270000;resident+=300000} else if(disabled==='ordinary'){income+=270000;resident+=260000}
    }
    income+=special; resident+=special; return {income,resident,under23,specialDependent:special};
  }
  function spouseDeductions(s,totalIncome){
    const sp=s.family?.spouse||{}; if(!sp.exists||sp.needsConfirmation===true)return {income:0,resident:0};
    const inc=Math.max(0,Number(sp.income)||0), age=Number(sp.age)||0, elderly=age>=70;
    if(totalIncome>10000000)return {income:0,resident:0};
    const band=totalIncome<=9000000?0:totalIncome<=9500000?1:2;
    if(inc<=620000){const income=elderly?[480000,320000,160000][band]:[380000,260000,130000][band];const resident=elderly?[380000,260000,130000][band]:[330000,220000,110000][band];return {income,resident}}
    if(inc>1330000)return {income:0,resident:0};
    const incomeRows=[[380000,260000,130000],[360000,240000,120000],[310000,210000,110000],[260000,180000,90000],[210000,140000,70000],[160000,110000,60000],[110000,80000,40000],[60000,40000,20000],[30000,20000,10000]];
    const residentRows=[[330000,220000,110000],[330000,220000,110000],[310000,210000,110000],[260000,180000,90000],[210000,140000,70000],[160000,110000,60000],[110000,80000,40000],[60000,40000,20000],[30000,20000,10000]];
    const upper=[950000,1000000,1050000,1100000,1150000,1200000,1250000,1300000,1330000];
    const i=upper.findIndex(v=>inc<=v); return {income:i<0?0:incomeRows[i][band],resident:i<0?0:residentRows[i][band]};
  }

  function calc(s){
    const year=Number(s.year||new Date().getFullYear());
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
    const socialSalaryActual=sum(s.socialRecords?.filter(r=>r.status==='actual')); const socialSalaryForecast=sum(s.socialRecords?.filter(r=>r.status==='forecast'))+sum(s.forecastSocial||[]); const bonusSocialActual=sum(s.bonusSocialRecords?.filter(r=>r.status==='actual')); const bonusSocialForecast=sum(s.bonusSocialRecords?.filter(r=>r.status==='forecast')); const yearRecord=s.yearRecords?.[String(year)]||{}; const nationalPension=Math.max(0,Number(yearRecord.manual?.nationalPension)||0); const socialActual=socialSalaryActual+bonusSocialActual+nationalPension; const socialForecast=socialSalaryForecast+bonusSocialForecast; const social=socialActual+socialForecast;
    const basic=s.deductions?.basicOverride==null?basicDeduction2026(totalIncomeBeforeDed):Number(s.deductions.basicOverride)||0; const life=calcLifeInsurance(s), lifeResident=calcLifeInsuranceResident(s);
    const earthquakeDetail=s.deductions?.earthquakeDetail||{paid:Number(s.deductions?.earthquake)||0,oldLongTerm:0};
    const earthquake=earthquakeDeduction(earthquakeDetail), earthquakeResident=earthquakeResidentDeduction(earthquakeDetail);
    let dep=dependentDeductions(s); const specialOverride=Number(s.deductions?.specialDependentOverride)||0; if(!dep.income&&specialOverride){dep={...dep,income:specialOverride,resident:450000,specialDependent:specialOverride};} const spouse=spouseDeductions(s,totalIncomeBeforeDed);
    const ideco=Number(s.deductions?.ideco)||0, other=Number(s.deductions?.other)||0;
    const otherBreakdown=s.deductions?.otherBreakdown||{};
    const otherTotal=Math.max(other,(Number(otherBreakdown.medical)||0)+(Number(otherBreakdown.disability)||0)+(Number(otherBreakdown.widow)||0)+(Number(otherBreakdown.workingStudent)||0)+(Number(otherBreakdown.other)||0));
    const specialResident=dep.specialDependent?(()=>{const vals=[];for(const d of (s.family?.dependents||[])){const age=Number(d.age),inc=Number(d.income)||0;if(age>=19&&age<23&&inc>580000&&inc<=1230000){const table=[[850000,450000],[900000,450000],[950000,450000],[1000000,410000],[1050000,310000],[1100000,210000],[1150000,110000],[1200000,60000],[1230000,30000]];let v=0;for(const [lim,val] of table){if(inc<=lim){v=val;break}}vals.push(v)}}return vals.reduce((a,v)=>a+v,0)})():0;
    const taxableIncome=Math.max(0,Math.floor((totalIncomeBeforeDed-basic-social-ideco-life.total-earthquake-otherTotal-dep.income-spouse.income)/1000)*1000);
    const residentBasic=430000;
    const residentTaxable=Math.max(0,Math.floor((totalIncomeBeforeDed-residentBasic-social-ideco-lifeResident-earthquakeResident-otherTotal-dep.resident-specialResident-spouse.resident)/1000)*1000);
    const residentLevy=residentTaxable*.10;
    const rate=incomeTaxRate(taxableIncome);
    const incomeTaxBase=Math.max(0,taxableIncome*rate-({0.05:0,0.1:97500,0.2:427500,0.23:636000,0.33:1536000,0.4:2796000,0.45:4796000}[rate]||0));
    const incomeTaxAnnual=Math.floor((incomeTaxBase*1.021)/100)*100;
    const specialLimit=residentLevy*.20;
    const denom=Math.max(.01,.90-rate*1.021);
    const estimatedLimit=Math.max(2000,Math.floor((specialLimit/denom+2000)/1000)*1000);
    const safe=Math.max(2000,Math.floor(estimatedLimit*.90/1000)*1000);
    const salaryActualRows=(s.salaryRecords||[]).filter(r=>r.status==='actual').slice().sort((a,b)=>Number(a.month)-Number(b.month));
    const salaryForecastMonths=Math.max(0,(s.forecastSalary||[]).length);
    const salaryForecastMonthly=salaryForecastMonths?Number((s.forecastSalary||[])[0])||0:0;
    const bonusForecastBreakdown=Array.isArray(s.forecastBonusBreakdown)?s.forecastBonusBreakdown.map(v=>({...v})):[];
    const deductionBreakdown={social, nationalPension, basic, lifeInsurance:life.total, earthquake, ideco, other:otherTotal, dependent:dep.income, spouse:spouse.income, incomeAdjustment:incomeAdjustmentDeduction};
    const donated=(s.donations||[]).filter(x=>x.status!=='確認待ち'&&x.included!==false).reduce((a,x)=>a+(Number(x.amount)||0),0);
    const pendingDonations=(s.donations||[]).filter(x=>x.status==='確認待ち'&&x.included!==false).reduce((a,x)=>a+(Number(x.amount)||0),0); const unknownInputs=[]; if(!s.deductions?.ideco) unknownInputs.push('iDeCo'); if(!(life.total||0)) unknownInputs.push('生命保険料控除'); if(!(earthquake||0)) unknownInputs.push('地震保険料控除'); if(!otherTotal) unknownInputs.push('その他所得控除'); if(dep.under23 && !incomeAdjustmentDeduction) unknownInputs.push('所得金額調整控除'); return {salaryActual,salaryActualRows,salaryForecast:salaryForecastTotal,salaryForecastMonths,salaryForecastMonthly,bonusActual,bonusForecast,bonusForecastBreakdown,adjustmentTotal,employmentGross,tempTaxable,totalIncomeBeforeDed,incomeAdjustmentDeduction,basic,residentBasic,socialSalaryActual,socialSalaryForecast,bonusSocialActual,bonusSocialForecast,nationalPension,socialActual,socialForecast,social,basic,ideco,lifeInsurance:life.total,lifeInsuranceBreakdown:life,lifeResident,earthquake,earthquakeResident,other:otherTotal,otherBreakdown,dependentDeduction:dep.income,residentDependentDeduction:dep.resident,specialDependent:dep.specialDependent,specialDependentResident:specialResident,spouseDeduction:spouse.income,residentSpouseDeduction:spouse.resident,taxableIncome,residentTaxable,residentLevy,rate,incomeTaxBase,incomeTaxAnnual,specialLimit,estimatedLimit,safe,donated,pendingDonations,remaining:Math.max(0,estimatedLimit-donated),unknownInputs,deductionBreakdown};
  }
  function historicalCalc(record,manual={}){
    const w=record?.withholding||record||{}; const year=Number(record?.year||w.year||0);
    const nationalPension=Math.max(0,Number(manual?.nationalPension)||0);
    const salaryIncome=Math.max(0,Number(w.salaryIncomeAfterDeduction)||0);
    const deductions=Math.max(0,Number(w.deductionsTotal)||0);
    if(!year||!salaryIncome||!deductions)return {year,status:'review',estimatedLimit:0,safe:0,nationalPension,reason:'源泉徴収票の必要項目が不足しています。'};
    // The withholding certificate already contains the year's actual salary-income
    // calculation and total income deductions, so do not run the 2026 forecast
    // salary-deduction rules again. Manual daughter National Pension is added to
    // social-insurance deductions for this year's result.
    const taxableIncome=Math.max(0,Math.floor((salaryIncome-deductions-nationalPension)/1000)*1000);
    const basicIncome=Math.max(0,Number(w.basicDeduction)||0);
    const residentBasic=430000;
    const lifeIncome=Math.max(0,Number(w.lifeInsuranceDeduction)||0);
    // Resident-tax life insurance deduction cannot be reconstructed perfectly from
    // the withholding certificate's deduction-only field. Use the known 2026-style
    // resident cap as a transparent adjustment; historical results remain tied to
    // the actual withholding certificate and are not re-imported as forecasts.
    const lifeResident=Math.min(70000,lifeIncome);
    const earthquakeIncome=Math.max(0,Number(w.earthquakeInsuranceDeduction)||0);
    const earthquakeResident=Math.min(25000,Math.floor(earthquakeIncome/2));
    const specialIncome=Math.max(0,Number(w.specialDependent)||0);
    const specialResident=(year>=2025&&specialIncome>=60000)?Math.min(450000,specialIncome):specialIncome;
    const residentTaxable=Math.max(0,Math.floor((taxableIncome+(basicIncome-residentBasic)+(lifeIncome-lifeResident)+(earthquakeIncome-earthquakeResident)+(specialIncome-specialResident))/1000)*1000);
    const residentLevy=residentTaxable*.10;
    const rate=incomeTaxRate(taxableIncome);
    const specialLimit=residentLevy*.20;
    const denom=Math.max(.01,.90-rate*1.021);
    const estimatedLimit=Math.max(2000,Math.floor((specialLimit/denom+2000)/1000)*1000);
    const safe=Math.max(2000,Math.floor(estimatedLimit*.90/1000)*1000);
    return {year,status:'confirmed',source:'withholding',nationalPension,taxableIncome,residentTaxable,residentLevy,rate,estimatedLimit,safe,annualSalary:Number(w.annualSalary)||0,salaryIncomeAfterDeduction:salaryIncome,deductionsTotal:deductions,withholdingSocial:Number(w.social)||0,lifeInsuranceDeduction:lifeIncome,earthquakeInsuranceDeduction:earthquakeIncome,specialDependent:specialIncome,manualSocialTotal:nationalPension};
  }
  function sensitivity(s,deltaSalary=100000,deltaBonus=0){const a=calc(s);const b=FurusatoModel.clone(s);b.forecastSalary=[...(b.forecastSalary||[])];if(b.forecastSalary.length)b.forecastSalary[b.forecastSalary.length-1]=(b.forecastSalary.at(-1)||0)+deltaSalary;else b.forecastSalary=[deltaSalary];b.forecastBonus=(Number(b.forecastBonus)||0)+deltaBonus;const c=calc(b);return {base:a,changed:c,limitDelta:c.estimatedLimit-a.estimatedLimit};}
  return {calc,salaryDeduction,basicDeduction2026,incomeTaxRate,historicalCalc,sensitivity,calcLifeInsurance,earthquakeDeduction,dependentDeductions,spouseDeductions};
})();
if(typeof window!=='undefined') window.FurusatoCalculator=FurusatoCalculator;
if(typeof module!=='undefined') module.exports=FurusatoCalculator;
