// Year-isolated renderer. Each page reads only its own year archive and manual inputs.
(function(){
  const $=id=>document.getElementById(id);
  const yen=n=>new Intl.NumberFormat('ja-JP').format(Math.round(Number(n)||0))+'円';
  const y=Number(document.body.dataset.year)||new Date().getFullYear();
  const currentYear=Number(state.year)||new Date().getFullYear();
  const archive=()=>((state.yearPayrollRecords||{})[String(y)]||{salaryRecords:[],socialRecords:[],bonusRecords:[]});
  function saveYear(){
    const n=Number(String($('nationalPension')?.value||0).replaceAll(',',''));
    if(!Number.isFinite(n)||n<0){alert('金額を正しく入力してください。');return;}
    state.yearRecords=state.yearRecords&&typeof state.yearRecords==='object'&&!Array.isArray(state.yearRecords)?state.yearRecords:{};
    const old=state.yearRecords[String(y)]||{};
    state.yearRecords[String(y)]={...old,year:y,manual:{...(old.manual||{}),nationalPension:n},updatedAt:new Date().toISOString()};
    save(); render();
  }
  function yearCalc(r,w,a){
    if(w)return FurusatoCalculator.historicalCalc(r,r.manual||{});
    if(y===currentYear)return FurusatoCalculator.calc(state);
    const temp=FurusatoModel.clone(state);
    temp.year=y;
    temp.salaryRecords=(a.salaryRecords||[]).filter(x=>x.status==='actual').map(x=>({...x,status:'actual'}));
    temp.socialRecords=(a.socialRecords||[]).filter(x=>x.status==='actual').map(x=>({...x,status:'actual'}));
    temp.bonusRecords=(a.bonusRecords||[]).filter(x=>x.status==='actual').map(x=>({...x,status:'actual'}));
    temp.bonusSocialRecords=temp.bonusRecords.filter(x=>x.social!=null).map(x=>({date:x.date,month:x.month,amount:x.social,components:x.socialComponents||{},status:'actual',source:x.source||'archive'}));
    temp.forecastSalary=[]; temp.forecastSocial=[]; temp.forecastBonus=0;
    temp.yearRecords=temp.yearRecords||{}; temp.yearRecords[String(y)]={...(temp.yearRecords[String(y)]||{}),year:y,manual:r.manual||{}};
    return FurusatoCalculator.calc(temp);
  }
  function render(){
    const records=state.yearRecords||{}; const r=records[String(y)]||{year:y,manual:{}}; const w=r.withholding||null; const a=archive();
    const manual=Number(r.manual?.nationalPension)||0;
    $('yearTitle').textContent=`${y}年`;
    $('status').innerHTML=w?'<span class="ok">● 源泉徴収票あり・確定データ</span>':'<span class="note">○ 源泉徴収票未登録・月別集計から計算</span>';
    $('nationalPension').value=manual;
    $('source').innerHTML=w?`<div class="row"><span>保存済み源泉徴収票</span><strong>${w.document||'保存済み'}</strong></div><div class="row"><span>給与収入</span><strong>${yen(w.annualSalary)}</strong></div><div class="row"><span>給与所得控除後</span><strong>${yen(w.salaryIncomeAfterDeduction)}</strong></div><div class="row"><span>源泉徴収票の社会保険料</span><strong>${yen(w.social)}</strong></div><p class="note">この年間値を正（確定）として使用します。源泉徴収票は再検索・再解析しません。</p>`:`<div class="row"><span>保存済み給与明細</span><strong>${a.salaryRecords?.length||0}件</strong></div><div class="row"><span>保存済み賞与</span><strong>${a.bonusRecords?.length||0}件</strong></div><p class="note">この年度の保存済み明細だけを使用します。他年度の給与明細は混ぜません。</p>`;
    const result=yearCalc(r,w,a);
    $('result').innerHTML=result?`<div class="row"><span>${w?'年間ふるさと納税上限額（源泉徴収票ベース）':'年間ふるさと納税上限額（月別集計ベース）'}</span><strong>${yen(result.estimatedLimit)}</strong></div><div class="row"><span>安全目安</span><strong>${yen(result.safe)}</strong></div><div class="row"><span>この年度の手動国民年金</span><strong>${yen(manual)}</strong></div>`:'<p class="note">この年度の計算に必要なデータがまだありません。</p>';
    const ref=w?.monthlyReference;
    $('reference').innerHTML=ref?`<h3>月別集計との参考照合</h3><p>給与明細${ref.months?.length||0}か月＋賞与 ${yen(ref.bonusGross||0)} → ${yen(ref.referenceGross||0)}。源泉徴収票との差：<b>${yen(ref.difference||0)}</b>。</p><p>月別・賞与社会保険料 ${yen(ref.referenceSocial||0)}。源泉徴収票との差：<b>${yen(ref.socialDifference||0)}</b>。</p><p class="note">これは参考照合です。不一致でもエラーにせず、源泉徴収票を正として確定します。</p>`:'<h3>この年度の明細</h3><p class="note">給与 ${a.salaryRecords?.length||0}件、賞与 ${a.bonusRecords?.length||0}件をこの年度専用の保存領域から参照しています。</p>';
    const docs=(state.sourceDocuments||[]).filter(d=>Number(d.year)===y);
    const history=(state.importHistory||[]).filter(h=>Number(h.year)===y);
    const payroll=a.salaryRecords||[];
    $('searchResults').innerHTML=`<h3>この年度の検索・読み取り結果</h3>${docs.length?docs.map(d=>`<div class="row"><span>${d.type==='withholding'?'源泉徴収票':d.type==='salary'?'給与':'賞与'}</span><strong>${d.file||d.name||'保存済み'}</strong></div>`).join(''):''}<div class="row"><span>保存済み給与明細</span><strong>${payroll.length}件</strong></div>${payroll.slice().sort((a,b)=>Number(a.month)-Number(b.month)).map(d=>`<div class="row"><span>${d.month}月給与</span><strong>${yen(d.taxableGross??d.gross)}</strong></div>`).join('')}${history.length?`<p class="note">取込履歴 ${history.length}件。最新：${history.slice(-1)[0]?.at?new Date(history.slice(-1)[0].at).toLocaleString('ja-JP'):''}</p>`:''}${!docs.length&&!payroll.length&&!history.length?'<p class="note">保存済みの検索資料はありません。</p>':''}`;
    $('saveBtn').onclick=saveYear;
  }
  document.addEventListener('DOMContentLoaded',render);
})();
