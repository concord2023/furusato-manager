// Shared renderer for the static per-year pages: year-2024.html, year-2025.html, year-2026.html.
(function(){
  const $=id=>document.getElementById(id);
  const yen=n=>new Intl.NumberFormat('ja-JP').format(Math.round(Number(n)||0))+'円';
  const y=Number(document.body.dataset.year)||new Date().getFullYear();
  function saveYear(){
    const input=$('nationalPension');
    const n=Number(String(input?.value||0).replaceAll(',',''));
    if(!Number.isFinite(n)||n<0){alert('金額を正しく入力してください。');return;}
    state.yearRecords=state.yearRecords&&typeof state.yearRecords==='object'&&!Array.isArray(state.yearRecords)?state.yearRecords:{};
    const r=state.yearRecords[String(y)]||{year:y,status:'manual',manual:{}};
    r.year=y;r.manual={...(r.manual||{}),nationalPension:n};r.updatedAt=new Date().toISOString();
    state.yearRecords[String(y)]=r;save();render();
  }
  function render(){
    const records=state.yearRecords||{}; const r=records[String(y)]||{}; const w=r.withholding||null;
    const manual=Number(r.manual?.nationalPension)||0;
    $('yearTitle').textContent=`${y}年`;
    $('status').innerHTML=w?'<span class="ok">● 源泉徴収票あり・確定データ</span>':'<span class="note">○ 源泉徴収票未登録・手動入力を保存中</span>';
    $('nationalPension').value=manual;
    $('source').innerHTML=w?`<div class="row"><span>保存済み源泉徴収票</span><strong>${w.document||'保存済み'}</strong></div><div class="row"><span>給与収入</span><strong>${yen(w.annualSalary)}</strong></div><div class="row"><span>給与所得控除後</span><strong>${yen(w.salaryIncomeAfterDeduction)}</strong></div><div class="row"><span>源泉徴収票の社会保険料</span><strong>${yen(w.social)}</strong></div><p class="note">この年間値を正（確定）として使用します。源泉徴収票は再検索・再解析しません。</p>`:'<p>この年度の源泉徴収票はまだ保存されていません。Drive検索で読み取った後は、この年度ページに固定保存されます。</p>';
    let result=null;
    if(w) result=FurusatoCalculator.historicalCalc(r,r.manual||{});
    else if(y===Number(state.year)) result=FurusatoCalculator.calc(state);
    $('result').innerHTML=result?`<div class="row"><span>${w?'年間ふるさと納税上限額（源泉徴収票ベース）':'現在の年間ふるさと納税上限額（推定）'}</span><strong>${yen(result.estimatedLimit)}</strong></div><div class="row"><span>安全目安</span><strong>${yen(result.safe)}</strong></div><div class="row"><span>この年度の手動国民年金</span><strong>${yen(manual)}</strong></div>`:'<p class="note">源泉徴収票がない年度は、年間確定結果はまだ計算できません。</p>';
    const ref=w.monthlyReference;
    $('reference').innerHTML=ref?`<h3>月別集計との参考照合</h3><p>給与明細${ref.months?.length||0}か月＋賞与 ${yen(ref.bonusGross||0)} → ${yen(ref.referenceGross||0)}。源泉徴収票との差：<b>${yen(ref.difference||0)}</b>。</p><p>月別・賞与社会保険料 ${yen(ref.referenceSocial||0)}。源泉徴収票との差：<b>${yen(ref.socialDifference||0)}</b>。</p><p class="note">これは参考照合です。不一致でもエラーにせず、源泉徴収票を正として確定します。</p>`:'<p class="note">この年度の源泉徴収票を読み取ると、月別集計との参考照合がここに保存されます。</p>';
    const docs=(state.sourceDocuments||[]).filter(d=>Number(d.year)===y);
    const history=(state.importHistory||[]).filter(h=>Number(h.year)===y);
    $('searchResults').innerHTML=`<h3>この年度の検索・読み取り結果</h3>${docs.length?docs.map(d=>`<div class="row"><span>${d.type==='withholding'?'源泉徴収票':d.type==='salary'?'給与':'賞与'}</span><strong>${d.file||d.name||'保存済み'}</strong></div>`).join(''):'<p class="note">保存済みの検索資料はありません。</p>'}${history.length?`<p class="note">取込履歴 ${history.length}件。最新：${history.slice(-1)[0]?.at?new Date(history.slice(-1)[0].at).toLocaleString('ja-JP'):''}</p>`:''}`;
    $('saveBtn').onclick=saveYear;
  }
  document.addEventListener('DOMContentLoaded',render);
})();
