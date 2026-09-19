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
  function calc(s){
    const salaryActual=sum((s.salaryRecords||[]).filter(r=>r.status==='actual').map(r=>({gross:r.taxableGross??r.gross}))); 
    const salaryForecast=sum((s.salaryRecords||[]).filter(r=>r.status==='forecast').map(r=>({gross:r.taxableGross??r.gross}))) || sum(s.forecastSalary||[]);
    const explicitForecast=sum(s.forecastSalary||[]);
    const salaryForecastTotal=(s.salaryRecords||[]).some(r=>r.status==='forecast')?salaryForecast:explicitForecast;
    const bonusActual=sum((s.bonusRecords||[]).filter(r=>r.status==='actual').map(r=>({gross:r.taxableGross??r.amount}))); const bonusForecast=Number(s.forecastBonus)||0;
    const adjustmentTotal=taxableAdjustmentsTotal(s);
    const employmentGross=salaryActual+salaryForecastTotal+bonusActual+bonusForecast+adjustmentTotal;
    const tempTaxable=s.adjustments?.temporaryTaxable?Number(s.adjustments.temporary)||0:0;
    const totalIncomeBeforeDed=employmentGross-salaryDeduction(employmentGross)+tempTaxable+Number(s.adjustments?.otherIncome||0);
    const socialSalaryActual=sum(s.socialRecords?.filter(r=>r.status==='actual')); const socialSalaryForecast=sum(s.socialRecords?.filter(r=>r.status==='forecast'))+sum(s.forecastSocial||[]); const bonusSocialActual=sum(s.bonusSocialRecords?.filter(r=>r.status==='actual')); const bonusSocialForecast=sum(s.bonusSocialRecords?.filter(r=>r.status==='forecast')); const socialActual=socialSalaryActual+bonusSocialActual; const socialForecast=socialSalaryForecast+bonusSocialForecast; const social=socialActual+socialForecast;
    const basic=s.deductions?.basicOverride==null?basicDeduction2026(totalIncomeBeforeDed):Number(s.deductions.basicOverride)||0;
    const ideco=Number(s.deductions?.ideco)||0, earthquake=Number(s.deductions?.earthquake)||0, other=Number(s.deductions?.other)||0;
    const taxableIncome=Math.max(0,Math.floor((totalIncomeBeforeDed-social-ideco-earthquake-other-basic)/1000)*1000);
    const residentBasic=430000;
    const residentTaxable=Math.max(0,Math.floor((totalIncomeBeforeDed-social-ideco-earthquake-other-residentBasic)/1000)*1000);
    const residentLevy=residentTaxable*.10;
    const rate=incomeTaxRate(taxableIncome);
    const specialLimit=residentLevy*.20;
    const denom=Math.max(.01,.90-rate*1.021);
    const estimatedLimit=Math.max(2000,Math.floor((specialLimit/denom+2000)/1000)*1000);
    const safe=Math.max(2000,Math.floor(estimatedLimit*.90/1000)*1000);
    const donated=(s.donations||[]).filter(x=>x.status!=='確認待ち'&&x.included!==false).reduce((a,x)=>a+(Number(x.amount)||0),0);
    const pendingDonations=(s.donations||[]).filter(x=>x.status==='確認待ち'&&x.included!==false).reduce((a,x)=>a+(Number(x.amount)||0),0); const unknownInputs=[]; if(!s.deductions?.ideco) unknownInputs.push('iDeCo'); if(!s.deductions?.earthquake) unknownInputs.push('地震保険料控除'); if(!s.deductions?.other) unknownInputs.push('その他所得控除'); return {salaryActual,salaryForecast:salaryForecastTotal,bonusActual,bonusForecast,adjustmentTotal,employmentGross,tempTaxable,totalIncomeBeforeDed,socialSalaryActual,socialSalaryForecast,bonusSocialActual,bonusSocialForecast,socialActual,socialForecast,social,basic,ideco,earthquake,other,taxableIncome,residentTaxable,residentLevy,rate,specialLimit,estimatedLimit,safe,donated,pendingDonations,remaining:Math.max(0,estimatedLimit-donated),unknownInputs};
  }
  function sensitivity(s,deltaSalary=100000,deltaBonus=0){const a=calc(s);const b=FurusatoModel.clone(s);b.forecastSalary=[...(b.forecastSalary||[])];if(b.forecastSalary.length)b.forecastSalary[b.forecastSalary.length-1]=(b.forecastSalary.at(-1)||0)+deltaSalary;else b.forecastSalary=[deltaSalary];b.forecastBonus=(Number(b.forecastBonus)||0)+deltaBonus;const c=calc(b);return {base:a,changed:c,limitDelta:c.estimatedLimit-a.estimatedLimit};}
  return {calc,salaryDeduction,basicDeduction2026,incomeTaxRate,sensitivity};
})();
if(typeof window!=='undefined') window.FurusatoCalculator=FurusatoCalculator;
if(typeof module!=='undefined') module.exports=FurusatoCalculator;
