const model=window.FurusatoModel; const calcEngine=window.FurusatoCalculator;
let state=model.load();
const yen=n=>new Intl.NumberFormat('ja-JP').format(Math.round(Number(n)||0))+'円';
function calc(s=state){return calcEngine.calc(s)}
function save(){model.save(state)}
function numPrompt(label,current){const v=prompt(label+'（円）',String(current??0));if(v===null)return null;const n=Number(String(v).replaceAll(',',''));if(!Number.isFinite(n)||n<0){alert('金額を正しく入力してください。');return null}return n}
function editItem(name,key){const cur=key?state.deductions[key]:state.adjustments.temporary;const n=numPrompt(name,cur);if(n===null)return;if(key)state.deductions[key]=n;else state.adjustments.temporary=n;save();location.reload()}
function renderHome(){const c=calc();for(const [id,v] of [['limit',yen(c.estimatedLimit)],['donated',yen(c.donated)],['remaining',yen(c.remaining)],['gross',yen(c.employmentGross)],['social',yen(c.social)]]){const e=document.getElementById(id);if(e)e.textContent=v}const p=(state.donations||[]).filter(x=>x.status==='確認待ち').length;const e=document.getElementById('pendingCount');if(e)e.textContent=p+'件'}
function downloadJSON(){const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='furusato-data.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500)}
function importJSON(file){const r=new FileReader();r.onload=()=>{try{state=model.normalize(JSON.parse(r.result));save();location.reload()}catch{alert('JSONデータを読み込めませんでした。')}};r.readAsText(file)}
function resetSample(){localStorage.removeItem('furusatoState');location.href='index.html'}
function init(){renderHome();document.querySelectorAll('[data-edit]').forEach(b=>b.addEventListener('click',()=>editItem(b.dataset.edit,b.dataset.key)));document.querySelectorAll('[data-reset]').forEach(b=>b.addEventListener('click',resetSample));const ex=document.getElementById('exportData');if(ex)ex.onclick=downloadJSON;const imp=document.getElementById('importFile');if(imp)imp.onchange=e=>e.target.files[0]&&importJSON(e.target.files[0])}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
