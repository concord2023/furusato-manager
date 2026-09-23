// Annual result history. Every year's manual inputs live under yearRecords[year].manual.
(function(){
  const $=id=>document.getElementById(id);
  const yen=n=>new Intl.NumberFormat('ja-JP').format(Math.round(Number(n)||0))+'円';
  const currentYear=Math.max(2026,Number(state.year)||new Date().getFullYear());
  const years=[]; for(let y=2024;y<=currentYear;y++)years.push(y);
  const num=v=>Math.max(0,Number(String(v??0).replaceAll(',',''))||0);
  function manualFor(y){return state.yearRecords?.[String(y)]?.manual||{};}
  function render(){
    const box=$('yearHistory'), records=state.yearRecords||{};
    box.innerHTML=years.slice().reverse().map(y=>{
      const r=records[String(y)]||{},w=r.withholding,m=manualFor(y),life=m.lifeInsurance||{},eq=m.earthquakeDetail||{};
      const result=w?FurusatoCalculator.historicalCalc(r,m):null;
      return `<article class="subcard"><h3>${y}年 ${w?'<span class="ok">● 源泉徴収票あり</span>':'<span class="note">○ 源泉徴収票未登録</span>'}</h3>
      ${w?`<div class="row"><span>給与収入</span><strong>${yen(w.annualSalary)}</strong></div><div class="row"><span>給与所得控除後</span><strong>${yen(w.salaryIncomeAfterDeduction)}</strong></div>`:'<p class="note">この年の読み取りDBに保存された給与・賞与から計算します。</p>'}
      <div class="miniForm"><label>特別支給・補助（課税） <input data-f="temporary" data-y="${y}" type=number min=0 step=1 value="${num(m.temporary)}"></label>
      <label>iDeCo（年間拠出額） <input data-f="ideco" data-y="${y}" type=number min=0 step=1 value="${num(m.ideco)}"></label>
      <label>生命保険・新一般 <input data-f="lifeNew" data-y="${y}" type=number min=0 step=1 value="${num(life.newGeneral)}"></label>
      <label>生命保険・旧一般 <input data-f="lifeOld" data-y="${y}" type=number min=0 step=1 value="${num(life.oldGeneral)}"></label>
      <label>介護医療 <input data-f="lifeMedical" data-y="${y}" type=number min=0 step=1 value="${num(life.nursingMedical)}"></label>
      <label>新個人年金 <input data-f="lifePensionNew" data-y="${y}" type=number min=0 step=1 value="${num(life.newPension)}"></label>
      <label>旧個人年金 <input data-f="lifePensionOld" data-y="${y}" type=number min=0 step=1 value="${num(life.oldPension)}"></label>
      <label>地震保険料（支払額） <input data-f="eqPaid" data-y="${y}" type=number min=0 step=1 value="${num(eq.paid)}"></label>
      <label>旧長期損害保険料 <input data-f="eqOld" data-y="${y}" type=number min=0 step=1 value="${num(eq.oldLongTerm)}"></label>
      <label>娘の国民年金（控除対象額） <input data-f="pension" data-y="${y}" type=number min=0 step=1 value="${num(m.nationalPension)}"></label>
      <button data-save-year="${y}">${y}年の入力を保存して即再計算</button></div>
      ${result?`<div class="row"><span>年間ふるさと納税上限額</span><strong>${yen(result.estimatedLimit)}</strong></div><div class="row"><span>安全目安</span><strong>${yen(result.safe)}</strong></div>`:'<div class="mini">源泉徴収票未登録の年は、読み取りDBの給与・賞与を確認してください。</div>'}
      <p class="note">入力値は${y}年だけに保存されます。保存直後にこの年の上限額を再計算します。</p></article>`;
    }).join('');
    box.querySelectorAll('[data-save-year]').forEach(btn=>btn.onclick=()=>{
      const y=Number(btn.dataset.saveYear), get=f=>num(box.querySelector(`[data-f="${f}"][data-y="${y}"]`)?.value);
      state.yearRecords=state.yearRecords||{}; const r=state.yearRecords[String(y)]||{year:y,status:'manual'}; const prev=r.manual||{};
      r.manual={...prev,nationalPension:get('pension'),temporary:get('temporary'),temporaryTaxable:true,ideco:get('ideco'),lifeInsurance:{newGeneral:get('lifeNew'),oldGeneral:get('lifeOld'),nursingMedical:get('lifeMedical'),newPension:get('lifePensionNew'),oldPension:get('lifePensionOld')},earthquakeDetail:{paid:get('eqPaid'),oldLongTerm:get('eqOld')},lifeInsuranceOverride:['lifeNew','lifeOld','lifeMedical','lifePensionNew','lifePensionOld'].some(k=>get(k)>0),earthquakeOverride:['eqPaid','eqOld'].some(k=>get(k)>0),updatedAt:new Date().toISOString()};
      state.yearRecords[String(y)]=r; save(); render();
    });
  }
  document.addEventListener('DOMContentLoaded',render);
})();
