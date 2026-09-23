// 年度固定の上限額ページ。URLの共通 state.year は変更しない。
(function(){
  document.addEventListener('DOMContentLoaded',()=>{
    const y=Number(window.YEAR_FIXED)||new Date().getFullYear();
    const $=id=>document.getElementById(id);
    const yen=n=>new Intl.NumberFormat('ja-JP').format(Math.round(Number(n)||0))+'円';
    const yearRecord=()=>((state.yearRecords||{})[String(y)]||{year:y,manual:{}});
    const archive=()=>((state.yearPayrollRecords||{})[String(y)]||{year:y,salaryRecords:[],socialRecords:[],bonusRecords:[]});
    function calc(){
      const r=yearRecord(), a=archive();
      if(r.withholding) return FurusatoCalculator.historicalCalc(r,r.manual||{});
      const t=FurusatoModel.clone(state);
      // 年度ページでは対象年度の保存済み資料だけを計算対象にする。
      t.year=y;
      t.salaryRecords=(a.salaryRecords||[]).filter(x=>Number(x.year)===y&&x.status==='actual');
      t.socialRecords=(a.socialRecords||[]).filter(x=>Number(x.year)===y&&x.status==='actual');
      t.bonusRecords=(a.bonusRecords||[]).filter(x=>Number(x.year||String(x.date||'').slice(0,4))===y&&x.status==='actual');
      t.bonusSocialRecords=t.bonusRecords.filter(x=>x.social!=null).map(x=>({date:x.date,month:x.month,amount:x.social,components:x.socialComponents||{},status:'actual'}));
      t.forecastSalary=[]; t.forecastSocial=[]; t.forecastBonus=0;
      // 未確定年度でも手動国民年金だけはこの年度の record から反映。
      t.yearRecords={[String(y)]:{...r,manual:r.manual||{}}};
      return FurusatoCalculator.calc(t);
    }
    function render(){
      const r=yearRecord(),a=archive(),x=calc();
      document.title=`${y}年・ふるさと納税上限額`;
      $('headTitle').textContent=`${y}年・上限額`;
      $('limit').textContent=x?yen(x.estimatedLimit):'—';
      $('status').innerHTML=r.withholding?'<span class="ok">● 源泉徴収票ベース・確定</span>':'<span class="note">○ 年度保存済み給与・賞与ベース</span>';
      const sr=(a.salaryRecords||[]).filter(v=>Number(v.year)===y).slice().sort((p,q)=>Number(p.month)-Number(q.month));
      const br=(a.bonusRecords||[]).filter(v=>Number(v.year||String(v.date||'').slice(0,4))===y);
      $('summary').innerHTML=x?`
        <div class="row"><span>年間給与等</span><strong>${yen(x.employmentGross||x.annualSalary)}</strong></div>
        <div class="row"><span>社会保険料</span><strong>${yen(x.social||x.withholdingSocial)}</strong></div>
        <div class="row"><span>娘の国民年金（手動）</span><strong>${yen(r.manual?.nationalPension)}</strong></div>
        <div class="row"><span>上限額</span><strong>${yen(x.estimatedLimit)}</strong></div>
        <div class="row"><span>安全目安</span><strong>${yen(x.safe)}</strong></div>`:'<p>計算に必要なデータがまだありません。</p>';
      $('payroll').innerHTML=(sr.length?sr.map(v=>`<div class="row"><span>${v.month}月給与</span><strong>${yen(v.taxableGross??v.gross)}</strong></div>`).join(''):'<p class="note">この年度の給与明細は保存されていません。</p>')+
        (br.length?br.map(v=>`<div class="row"><span>${v.season==='summer'?'夏賞与':v.season==='winter'?'冬賞与':'賞与'} ${v.date||''}</span><strong>${yen(v.amount)}</strong></div>`).join(''):'');
      if(r.withholding){
        const ref=r.withholding.monthlyReference;
        $('withholding').innerHTML=`<p><b>源泉徴収票：正（確定）</b></p><p>給与収入 ${yen(r.withholding.annualSalary)}／給与所得控除後 ${yen(r.withholding.salaryIncomeAfterDeduction)}／社会保険料 ${yen(r.withholding.social)}</p>${ref?`<p>月別＋賞与の参考集計：${yen(ref.referenceGross)}（差額 ${yen(ref.difference)}）</p><p>社会保険料参考集計：${yen(ref.referenceSocial)}（差額 ${yen(ref.socialDifference)}）</p>`:''}<p class="note">月別集計との不一致はエラーにせず、この年度は源泉徴収票を確定値として使用します。</p>`;
      }else $('withholding').innerHTML='<p class="note">この年度は源泉徴収票が未登録です。保存済みの給与・賞与を参考に計算します。</p>';
      $('pension').value=Number(r.manual?.nationalPension)||0;
    }
    $('save').onclick=()=>{
      const n=Math.max(0,Number($('pension').value)||0);
      state.yearRecords=state.yearRecords&&typeof state.yearRecords==='object'?state.yearRecords:{};
      const prev=state.yearRecords[String(y)]||{year:y,manual:{}};
      state.yearRecords[String(y)]={...prev,year:y,manual:{...(prev.manual||{}),nationalPension:n},updatedAt:new Date().toISOString()};
      save(); render();
    };
    const tabs=[2024,2025,2026].map(v=>`<a class="year-tab ${v===y?'active':''}" href="limit-${v}.html">${v}年上限</a>`).join('');
    $('yearTabs').innerHTML=tabs;
    render();
  });
})();
