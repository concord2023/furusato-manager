// Annual result history. Parsed withholding certificates are fixed sources;
// only manual annual inputs are editable after import.
(function(){
  const $=id=>document.getElementById(id);
  const yen=n=>new Intl.NumberFormat('ja-JP').format(Math.round(Number(n)||0))+'円';
  const currentYear=Number(state.year)||new Date().getFullYear();
  const years=[]; for(let y=2024;y<=Math.max(currentYear,2026);y++)years.push(y);
  function render(){
    const box=$('yearHistory');
    const records=state.yearRecords||{};
    box.innerHTML=years.slice().reverse().map(y=>{
      const r=records[String(y)]||{}; const w=r.withholding; const manual=r.manual||{};
      if(!w){
        return `<article class="subcard"><h3>${y}年 <span class="note">未確定・源泉徴収票未登録</span></h3><p class="note">源泉徴収票を一度読み取ると、この年は年間実績として保存され、以後はこの画面の手動入力だけで更新できます。</p><label>娘の国民年金（その年にあなたが支払った控除対象額） <input data-pension="${y}" type="number" min="0" step="1" value="${Number(manual.nationalPension)||0}"> 円</label><button data-save-year="${y}">手動入力を保存</button><div class="mini">計算結果：源泉徴収票がないため未計算</div></article>`;
      }
      const result=FurusatoCalculator.historicalCalc(r,manual);
      const manualPension=Number(manual.nationalPension)||0;
      const ref=w.monthlyReference;
      const refText=ref?`月別集計は参考照合：${ref.months?.length||0}か月＋賞与${yen(ref.bonusGross||0)}円 → ${yen(ref.referenceGross||0)}円（源泉徴収票との差 ${yen(ref.difference||0)}円）。社会保険料の月別・賞与集計は${yen(ref.referenceSocial||0)}円（源泉徴収票との差 ${yen(ref.socialDifference||0)}円）。差異があっても、この年は源泉徴収票を正として確定します。`:'';
      return `<article class="subcard"><h3>${y}年 <span class="ok">● 源泉徴収票あり・確定データ</span></h3><div class="row"><span>源泉徴収票</span><strong>${w.document||'保存済み'}</strong></div><div class="row"><span>給与収入</span><strong>${yen(w.annualSalary)}</strong></div><div class="row"><span>給与所得控除後</span><strong>${yen(w.salaryIncomeAfterDeduction)}</strong></div><div class="row"><span>源泉徴収票の社会保険料</span><strong>${yen(w.social)}</strong></div><div class="miniForm"><label>娘の国民年金（控除対象額） <input data-pension="${y}" type="number" min="0" step="1" value="${manualPension}"> 円</label><button data-save-year="${y}">手動入力を保存して再計算</button></div><div class="row"><span>年間ふるさと納税上限額（源泉徴収票ベース）</span><strong>${yen(result.estimatedLimit)}</strong></div><div class="row"><span>安全目安</span><strong>${yen(result.safe)}</strong></div><p class="note">${refText}</p><p class="note">社会保険料に手動の国民年金 ${yen(manualPension)}円を加算して再計算。源泉徴収票そのものは再検索・再解析しません。</p></article>`;
    }).join('');
    box.querySelectorAll('[data-save-year]').forEach(btn=>btn.onclick=()=>{
      const y=Number(btn.dataset.saveYear); const input=box.querySelector(`[data-pension="${y}"]`); const n=Number(String(input?.value||0).replaceAll(',',''));
      if(!Number.isFinite(n)||n<0){alert('金額を正しく入力してください。');return}
      state.yearRecords=state.yearRecords||{}; const r=state.yearRecords[String(y)]||{year:y,status:'manual',manual:{}}; r.manual={...(r.manual||{}),nationalPension:n}; r.updatedAt=new Date().toISOString(); state.yearRecords[String(y)]=r; save(); render();
    });
  }
  document.addEventListener('DOMContentLoaded',render);
})();
