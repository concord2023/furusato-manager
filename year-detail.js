// 年度固定の上限額ページ。年度データベースからのみ計算し、state.yearは変更しない。
(function(){
  document.addEventListener('DOMContentLoaded',()=>{
    const y=Number(window.YEAR_FIXED)||new Date().getFullYear();
    const $=id=>document.getElementById(id);
    const yen=n=>new Intl.NumberFormat('ja-JP').format(Math.round(Number(n)||0))+'円';
    const resultPack=()=>FurusatoGoogleDrive.buildYearCalculationState(state,y);
    function render(){
      const pack=resultPack(), r=pack.record||{}, a=pack.archive||{salaryRecords:[],socialRecords:[],bonusRecords:[],documents:[]}, x=pack.result;
      document.title=`${y}年・ふるさと納税上限額`;$('headTitle').textContent=`${y}年・上限額`;
      $('limit').textContent=x?yen(x.estimatedLimit):'—';
      $('status').innerHTML=pack.mode==='confirmed'?'<span class="ok">● 源泉徴収票ベース・確定</span>':pack.mode==='forecast'?'<span class="note">🟡 実績＋予測</span>':'<span class="note">○ 保存済み実績ベース</span>';
      const sr=(a.salaryRecords||[]).filter(v=>v.status==='actual').slice().sort((p,q)=>Number(p.month)-Number(q.month));
      const br=(a.bonusRecords||[]).filter(v=>v.status==='actual');
      const futureCount=pack.mode==='forecast'?Math.max(0,12-(pack.state.actualThrough||0)):0;
      const forecastSalaryRows=pack.mode==='forecast'?(pack.state.forecastSalary||[]):[];
      const forecastSocialRows=pack.mode==='forecast'?(pack.state.forecastSocial||[]):[];
      const bonusForecastRows=pack.mode==='forecast'?(pack.result?.bonusForecastBreakdown||[]):[];
      $('summary').innerHTML=x?`
        <div class="row"><span>年間給与等</span><strong>${yen(x.employmentGross)}</strong></div>
        <div class="row"><span>社会保険料</span><strong>${yen(x.social)}</strong></div>
        <div class="row"><span>娘の国民年金（手動）</span><strong>${yen(r.manual?.nationalPension)}</strong></div>
        <div class="row"><span>上限額</span><strong>${yen(x.estimatedLimit)}</strong></div>
        <div class="row"><span>安全目安</span><strong>${yen(x.safe)}</strong></div>
        <p class="note">${pack.mode==='confirmed'?'源泉徴収票を正として確定。':pack.mode==='forecast'?`実績${pack.state.actualThrough||0}月＋${futureCount}か月予測。`: 'この年度に保存された実績だけで計算。'}</p>`:'<p>この年度の計算に必要なデータがまだありません。</p>';
      const refCheck=x?Math.max(2000,Math.floor(((Number(x.residentTaxable)||0)*0.1*0.2/Math.max(0.01,0.9-(Number(x.rate)||0)*1.021)+2000)/1000)*1000):0;
      $('calculationBreakdown').innerHTML=x?`
        <div class="row"><span>給与実績合計（${sr.length}か月）</span><strong>${yen(x.salaryActual)}</strong></div>
        ${pack.mode==='forecast'?`<div class="row"><span>給与予測：${futureCount}か月 × ${yen(x.salaryForecastMonthly)}</span><strong>${yen(x.salaryForecast)}</strong></div>`:''}
        <div class="row"><span>賞与実績</span><strong>${yen(x.bonusActual)}</strong></div>
        ${bonusForecastRows.map(v=>`<div class="row"><span>${v.sourceYear}年${v.season==='summer'?'夏':'冬'}賞与を金額参考</span><strong>${yen(v.amount)}</strong></div>`).join('')}
        <div class="row"><span>課税対象の追加調整</span><strong>${yen(x.adjustmentTotal)}</strong></div>
        <div class="row"><span>給与所得控除</span><strong>${yen(FurusatoCalculator.salaryDeduction(x.employmentGross||0))}</strong></div>
        <div class="row"><span>所得金額調整控除</span><strong>${yen(x.incomeAdjustmentDeduction)}</strong></div>
        <div class="row"><span>社会保険料（給与実績）</span><strong>${yen(x.socialSalaryActual)}</strong></div>
        ${pack.mode==='forecast'?`<div class="row"><span>社会保険料（給与予測）</span><strong>${yen(x.socialSalaryForecast)}</strong></div>`:''}
        <div class="row"><span>社会保険料（賞与実績）</span><strong>${yen(x.bonusSocialActual)}</strong></div>
        ${pack.mode==='forecast'?`<div class="row"><span>社会保険料（賞与予測）</span><strong>${yen(x.bonusSocialForecast)}</strong></div>`:''}
        <div class="row"><span>娘の国民年金（手動）</span><strong>${yen(x.nationalPension)}</strong></div>
        <div class="row"><span>社会保険料合計</span><strong>${yen(x.social)}</strong></div>
        <div class="row"><span>基礎控除</span><strong>${yen(x.basic)}</strong></div>
        <div class="row"><span>生命保険料控除</span><strong>${yen(x.lifeInsurance)}</strong></div>
        <div class="row"><span>地震保険料控除</span><strong>${yen(x.earthquake)}</strong></div>
        <div class="row"><span>iDeCo</span><strong>${yen(x.ideco)}</strong></div>
        <div class="row"><span>扶養控除等</span><strong>${yen(x.dependentDeduction)}</strong></div>
        <div class="row"><span>配偶者控除等</span><strong>${yen(x.spouseDeduction)}</strong></div>
        <div class="row"><span>課税所得</span><strong>${yen(x.taxableIncome)}</strong></div>
        <div class="row"><span>所得税率</span><strong>${Math.round((Number(x.rate)||0)*100)}%</strong></div>
        <div class="row"><span>住民税課税所得（計算用）</span><strong>${yen(x.residentTaxable)}</strong></div>
        <div class="row"><span>住民税所得割（計算用）</span><strong>${yen(x.residentLevy)}</strong></div>
        <div class="row"><span>住民税特例控除上限（所得割×20%）</span><strong>${yen(x.specialLimit)}</strong></div>
        <div class="row"><span>上限額の式による再計算</span><strong>${yen(refCheck)}</strong></div>
        <p class="note">上の「再計算」は表示されている住民税所得割・所得税率から独立に再計算し、アプリの上限額と一致するか確認しています。</p>
        ${pack.mode==='forecast'?`<p class="note">予測給与：${Math.min(9,pack.state.actualThrough||0)}月までの対象年4〜${Math.min(9,pack.state.actualThrough||0)}月実績平均。予測賞与：前年同シーズンの金額を参考。給与予測に前年給与は使用していません。</p>`:''}
      `:'<p class="note">計算データなし</p>';
      $('payroll').innerHTML=(sr.length?sr.map(v=>`<div class="row"><span>${v.month}月給与（実績）</span><strong>${yen(v.taxableGross??v.gross)}</strong></div>`).join(''):'<p class="note">この年度の給与明細は保存されていません。</p>')+
        (pack.mode==='forecast'&&futureCount?(pack.state.forecastSalary||[]).map((v,i)=>`<div class="row"><span>${Number(pack.state.actualThrough||0)+i+1}月給与（予測）</span><strong>${yen(v)}</strong></div>`).join(''):'')+
        (br.length?br.map(v=>`<div class="row"><span>${v.season==='summer'?'夏賞与':v.season==='winter'?'冬賞与':'賞与'} ${v.date||''}（実績）</span><strong>${yen(v.amount)}</strong></div>`).join(''):'')+
        (pack.mode==='forecast'&&bonusForecastRows.length?bonusForecastRows.map(v=>`<div class="row"><span>${v.sourceYear}年${v.season==='summer'?'夏':'冬'}賞与を参考（予測）</span><strong>${yen(v.amount)}</strong></div>`).join(''):'')+
        (pack.mode==='forecast'&&futureCount?`<p class="note">未取得月：${futureCount}か月。対象年4〜${Math.min(9,pack.state.actualThrough||0)}月の実績平均から予測。前年給与は予測に使用しません。賞与は未支給シーズンのみ前年同シーズンを金額参考にします。</p>`:'');
      const manual=Number(r.manual?.nationalPension)||0;$('pension').value=manual;
      if(r.withholding){const ref=r.withholding.monthlyReference;$('withholding').innerHTML=`<p><b>源泉徴収票：正（確定）</b></p><p>給与収入 ${yen(r.withholding.annualSalary)}／給与所得控除後 ${yen(r.withholding.salaryIncomeAfterDeduction)}／社会保険料 ${yen(r.withholding.social)}</p>${ref?`<p>月別＋賞与の参考集計：${yen(ref.referenceGross)}（差額 ${yen(ref.difference)}）</p><p>社会保険料参考集計：${yen(ref.referenceSocial)}（差額 ${yen(ref.socialDifference)}）</p>`:''}<p class="note">月別集計との不一致はエラーにせず、この年度は源泉徴収票を確定値として使用します。</p>`}else $('withholding').innerHTML='<p class="note">この年度は源泉徴収票が未登録です。年度データベースに保存された明細だけを使用します。</p>';
      const docs=a.documents||[];$('database').innerHTML=`<p>この年度のデータベース：<b>${docs.length}件</b>の読み取り記録、給与${sr.length}件、賞与${br.length}件。</p><a class="buttonlike" href="data-database.html#year-${y}">読み取りデータベースで${y}年を確認 →</a>`;
    }
    $('save').onclick=()=>{const n=Math.max(0,Number($('pension').value)||0);state.yearRecords=state.yearRecords&&typeof state.yearRecords==='object'?state.yearRecords:{};const prev=state.yearRecords[String(y)]||{year:y,manual:{}};state.yearRecords[String(y)]={...prev,year:y,manual:{...(prev.manual||{}),nationalPension:n},updatedAt:new Date().toISOString()};save();render()};
    const tabs=[2024,2025,2026].map(v=>`<a class="year-tab ${v===y?'active':''}" href="limit-${v}.html">${v}年上限</a>`).join('');$('yearTabs').innerHTML=tabs;render();
  });
})();
