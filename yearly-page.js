// 年度別ページ。上限計算は必ず年度データベースを経由する。
(function(){
  const $=id=>document.getElementById(id);
  const yen=n=>new Intl.NumberFormat('ja-JP').format(Math.round(Number(n)||0))+'円';
  const y=Number(document.body.dataset.year)||new Date().getFullYear();
  function saveYear(){const n=Math.max(0,Number(String($('nationalPension')?.value||0).replaceAll(',',''))||0);state.yearRecords=state.yearRecords&&typeof state.yearRecords==='object'&&!Array.isArray(state.yearRecords)?state.yearRecords:{};const old=state.yearRecords[String(y)]||{};state.yearRecords[String(y)]={...old,year:y,manual:{...(old.manual||{}),nationalPension:n},updatedAt:new Date().toISOString()};save();render()}
  function render(){
    const pack=FurusatoGoogleDrive.buildYearCalculationState(state,y), r=pack.record||{}, w=r.withholding||null, a=pack.archive||{salaryRecords:[],socialRecords:[],bonusRecords:[],documents:[]};
    $('yearTitle').textContent=`${y}年`;$('status').innerHTML=pack.mode==='confirmed'?'<span class="ok">● 源泉徴収票あり・確定データ</span>':pack.mode==='forecast'?'<span class="note">🟡 実績＋予測</span>':'<span class="note">○ 保存済み実績</span>';$('nationalPension').value=Number(r.manual?.nationalPension)||0;
    $('source').innerHTML=w?`<div class="row"><span>保存済み源泉徴収票</span><strong>${w.document||'保存済み'}</strong></div><div class="row"><span>給与収入</span><strong>${yen(w.annualSalary)}</strong></div><div class="row"><span>給与所得控除後</span><strong>${yen(w.salaryIncomeAfterDeduction)}</strong></div><div class="row"><span>源泉徴収票の社会保険料</span><strong>${yen(w.social)}</strong></div><p class="note">この年間値を正（確定）として使用します。源泉徴収票は再検索・再解析しません。</p>`:`<div class="row"><span>保存済み給与明細</span><strong>${a.salaryRecords?.filter(x=>x.status==='actual').length||0}件</strong></div><div class="row"><span>保存済み賞与</span><strong>${a.bonusRecords?.filter(x=>x.status==='actual').length||0}件</strong></div><p class="note">この年度のデータベースだけを使用します。他年度の給与明細は混ぜません。</p>`;
    const result=pack.result;$('result').innerHTML=result?`<div class="row"><span>${w?'年間ふるさと納税上限額（源泉徴収票ベース）':'年間ふるさと納税上限額'}</span><strong>${yen(result.estimatedLimit)}</strong></div><div class="row"><span>安全目安</span><strong>${yen(result.safe)}</strong></div><div class="row"><span>この年度の手動国民年金</span><strong>${yen(r.manual?.nationalPension)}</strong></div>${pack.mode==='forecast'?`<p class="note">実績${pack.state.actualThrough||0}月＋未取得月予測。前年給与は予測に使用しません。未支給賞与は前年同シーズンを金額参考にします。</p>`:''}`:'<p class="note">この年度の計算に必要なデータがまだありません。</p>';
    const ref=w?.monthlyReference;$('reference').innerHTML=ref?`<h3>月別集計との参考照合</h3><p>給与明細＋賞与 → ${yen(ref.referenceGross)}。源泉徴収票との差：<b>${yen(ref.difference)}</b>。</p><p>社会保険料の参考集計 ${yen(ref.referenceSocial)}。源泉徴収票との差：<b>${yen(ref.socialDifference)}</b>。</p><p class="note">これは参考照合です。不一致でもエラーにせず、源泉徴収票を正として確定します。</p>`:`<h3>この年度の読み取りデータ</h3><p class="note">読み取りデータベースに保存された情報から計算しています。</p>`;
    const docs=a.documents||[], payroll=(a.salaryRecords||[]).filter(x=>x.status==='actual').sort((p,q)=>Number(p.month)-Number(q.month));
    $('searchResults').innerHTML=`<h3>保存済み検索・読み取り結果</h3><div class="row"><span>読み取り記録</span><strong>${docs.length}件</strong></div>${payroll.map(d=>`<div class="row"><span>${d.month}月給与</span><strong>${yen(d.taxableGross??d.gross)}</strong></div>`).join('')}<p class="note"><a href="data-database.html#year-${y}">この年度の全抽出項目・不足項目をデータベースで確認 →</a></p>`;
    $('saveBtn').onclick=saveYear;
  }
  document.addEventListener('DOMContentLoaded',render);
})();
