const $ = id => document.getElementById(id);
Object.defineProperty(window, 'lab', { get: () => $('stage').contentWindow.particleLab });
let catalog, selected='racing3d', filtered=[];
function filter() {
  if(!catalog)return;
  const q=$('search').value.trim().toLocaleLowerCase(),category=$('category').value;
  filtered=catalog.entries.filter(e=>(category==='all'||e.category===category)&&[e.id,e.title,e.usecase,...e.tags].join(' ').toLocaleLowerCase().includes(q));
  const ids=new Set(filtered.map(e=>e.id));
  document.querySelectorAll('[data-preset]').forEach(b=>b.hidden=!ids.has(b.dataset.preset));
  $('result-count').textContent=`${filtered.length} / 100 種效果`;
  $('previous').disabled=$('next').disabled=filtered.length===0;
}
function select(id,play=true) {
  const e=catalog?.entries.find(e=>e.id===id);if(!e||!window.lab)return;
  if(play)lab.setPreset(id);selected=id;
  document.querySelectorAll('[data-preset]').forEach(b=>b.classList.toggle('selected',b.dataset.preset===id));
  $('scene-label').textContent=String(e.number).padStart(3,'0')+' / '+e.title;
  $('effect-category').textContent=catalog.categories.find(c=>c.id===e.category).title+' · '+e.dimension+'D';
  $('effect-title').textContent=e.title;$('effect-usecase').textContent=e.usecase;
  $('message').textContent='0.7 秒啟動，5.6 秒停止發射後自然消散。可拖曳時間軸檢視，並匯出目前設定。';
}
fetch('assets/effects/catalog.json').then(r=>r.json()).then(data=>{
  catalog=data;window.effectCatalog=data;
  for(const c of data.categories){const o=document.createElement('option');o.value=c.id;o.textContent=c.title+' · 10 種';$('category').append(o);}
  for(const e of data.entries){
    const b=document.createElement('button');b.dataset.preset=e.id;
    const n=document.createElement('b');n.textContent=String(e.number).padStart(3,'0');
    const t=document.createElement('span');t.textContent=e.title;
    const sub=document.createElement('small');sub.textContent=e.usecase;t.append(sub);
    const icon=document.createElement('i');icon.textContent=e.dimension===3?'3D':'↗';
    b.append(n,t,icon);b.onclick=()=>select(e.id);$('presets').append(b);
  }
  filter();
}).catch(e=>$('message').textContent='效果目錄載入失敗：'+e.message);
$('category').onchange=filter;$('search').oninput=filter;
for(const [key,step] of [['previous',-1],['next',1]])$(key).onclick=()=>{
  if(!filtered.length)return;
  const i=filtered.findIndex(e=>e.id===selected),entry=filtered[(i+step+filtered.length)%filtered.length];
  select(entry.id);document.querySelector(`[data-preset="${entry.id}"]`).scrollIntoView({block:'nearest'});
};
for (const key of ['density', 'velocity', 'lifetime']) $(key).oninput = () => {
  $(key + '-value').textContent = Number($(key).value).toFixed(1) + '×';
  window.lab?.setParameters({ [key]: Number($(key).value) });
};
for (const key of ['trails', 'ground', 'enabled']) $(key).onchange = () => window.lab?.setParameters({ [key]: $(key).checked });
$('camera').onclick = () => window.lab?.cycleCamera();
$('pause').onclick = () => { if (window.lab) lab.paused = !lab.paused; };
$('reset').onclick = () => window.lab?.reset();
$('timeline').oninput = () => window.lab?.seek(Number($('timeline').value));
$('loop').onchange = () => { if (window.lab) lab.loop = $('loop').checked; };
$('export').onclick = () => {
  if (!window.lab) return;
  const url = URL.createObjectURL(new Blob([lab.exportJSON()], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = lab.preset + '.particles.json'; a.click();
  URL.revokeObjectURL(url); $('message').textContent = '已匯出目前效果，保留場景錨點與發射器動作。';
};
$('import').onchange = async () => {
  const file = $('import').files[0]; if (!file || !window.lab) return;
  try {
    lab.importJSON(await file.text());selected='custom';
    document.querySelectorAll('[data-preset]').forEach(b => b.classList.remove('selected'));
    $('scene-label').textContent = '自訂 / 匯入效果';$('effect-title').textContent='自訂效果';
    $('effect-category').textContent=lab.stats().dimension+'D';$('effect-usecase').textContent='可重播、調整參數並再次匯出。';
    for (const key of ['density', 'velocity', 'lifetime']) {$(key).value = lab.params[key];$(key + '-value').textContent = lab.params[key].toFixed(1) + '×';}
    $('message').textContent = '效果已驗證並載入。';
  } catch (e) { $('message').textContent = '載入失敗：' + e.message; }
  $('import').value = '';
};
let ready=false;
setInterval(() => {
  if (!window.lab) return;
  if(!ready&&catalog){ready=true;const requested=new URLSearchParams(location.search).get('effect');select(catalog.entries.some(e=>e.id===requested)?requested:lab.preset,!!requested);}
  const s = lab.stats();
  $('particles').textContent = s.particles;$('cpu').textContent = s.cpuMs.toFixed(2) + ' ms';
  $('draws').textContent = s.drawCalls;$('frame').textContent = s.frameP95.toFixed(1) + ' ms';
  $('timeline').value = lab.time; $('time').textContent = lab.time.toFixed(2) + ' / 8.00 s';
  $('pause').textContent = lab.paused ? '▶ 播放' : 'Ⅱ 暫停';
  $('phase').textContent = s.phase + (Number.isFinite(s.speedKmh) ? ' / ' + Math.round(s.speedKmh) + ' km/h' : '');
  $('camera').disabled = s.dimension !== 3;
  const names={chase:'追車',side:'側面',front:'迎面',orbit:'斜視'};
  $('camera').textContent = s.dimension === 3 ? '3D 視角：' + names[s.cameraMode] : '3D 視角';
  $('trails').disabled=!s.hasTrails;$('ground').disabled=!s.hasGround;
}, 120);
