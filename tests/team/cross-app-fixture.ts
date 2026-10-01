import { appContract, type AppKind } from './cross-app-scenarios';
// Deliberately handwritten provider fixture, never real model acceptance evidence.
export function crossAppFixture(kind: AppKind, rated = false, filterFirst = false) {
  const c = appContract(kind);
  const filter = '<select id="filter" disabled><option value="all">全部</option><option value="active">未完成</option><option value="complete">已完成</option></select>';
  return `<!doctype html><html><head><title>OFFLINE FIXTURE</title></head><body>
<p data-atoms-status>正在读取</p><input id="name" disabled><button id="add" disabled>添加</button>
${rated && filterFirst ? filter : ''}<ul id="records"></ul>${rated && !filterFirst ? filter : ''}
<script>
const name=document.getElementById('name'),add=document.getElementById('add'),list=document.getElementById('records'),status=document.querySelector('[data-atoms-status]'),filter=document.getElementById('filter');
let state,mode='all';
function render(){list.replaceChildren();for(const r of state.${c.collection}){const complete=r.${c.state}===${JSON.stringify(c.complete)};if(mode==='active'&&complete||mode==='complete'&&!complete)continue;
const li=document.createElement('li');li.dataset.id=r.id;const title=document.createElement('span');title.className='title';title.textContent=r.${c.title};li.append(title);
const toggle=document.createElement('button');toggle.className='toggle';toggle.textContent=complete?'恢复':'完成';toggle.onclick=()=>mutate(s=>{const x=s.${c.collection}.find(x=>x.id===r.id);x.${c.state}=complete?${JSON.stringify(c.initial)}:${JSON.stringify(c.complete)}});li.append(toggle);
${rated ? `const score=document.createElement('select');score.className='score';for(let i=0;i<=5;i++){const o=document.createElement('option');o.value=String(i);o.textContent=String(i);score.append(o)}score.value=String(r.rating??0);score.onchange=()=>mutate(s=>{s.${c.collection}.find(x=>x.id===r.id).rating=Number(score.value)});li.append(score);` : ''}
const remove=document.createElement('button');remove.className='remove';remove.textContent='删除';remove.onclick=()=>mutate(s=>{s.${c.collection}=s.${c.collection}.filter(x=>x.id!==r.id)});li.append(remove);list.append(li)}}
async function mutate(change){const next=structuredClone(state);change(next);status.textContent='正在保存';try{await window.atoms.saveState(next);state=next;render();status.textContent='已保存'}catch{render();status.textContent='保存失败'}}
add.onclick=()=>{if(!name.value.trim())return;mutate(s=>s.${c.collection}.push({id:crypto.randomUUID(),${c.title}:name.value,${c.state}:${JSON.stringify(c.initial)}${rated ? ',rating:0' : ''}}))};
if(filter)filter.onchange=()=>{mode=filter.value;render()};
window.atoms.loadState().then(loaded=>{state=loaded===null?{${c.collection}:[]}:loaded;render();name.disabled=add.disabled=false;if(filter)filter.disabled=false;status.textContent='已读取'}).catch(()=>{status.textContent='读取失败'});
</script></body></html>`;
}
