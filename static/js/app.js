let projects=[], project=null, current=null, img=new Image();
const canvas=document.getElementById('canvas'), ctx=canvas.getContext('2d');
let mode='box', drawing=false, start={x:0,y:0}, selected=-1, drag=null, poly=[];
const $=id=>document.getElementById(id);
async function api(url,opt={}){let r=await fetch(url,{headers:{'Content-Type':'application/json'},...opt});if(!r.ok)throw Error(await r.text());return r.json()}
function saveLocal(){localStorage.setItem('yl_projects',JSON.stringify(projects))}
async function loadProjects(){try{let r=await api('/api/projects');projects=r.projects||[]}catch(e){let saved=localStorage.getItem('yl_projects');if(saved)projects=JSON.parse(saved)}renderProjects()}
function renderProjects(){$('projects').innerHTML=projects.map(p=>`<div class="project ${project&&p.name===project.name?'active':''}" onclick="openProject('${p.name}')">${p.name}</div>`).join('')}
async function newProject(){let name=prompt('نام پروژه:');if(!name)return;let classes=prompt('کلاس‌ها را با کاما وارد کن:','bird');let p=await api('/api/projects',{method:'POST',body:JSON.stringify({name,classes:classes.split(',').map(x=>x.trim()).filter(Boolean)})});projects.push(p);saveLocal();await openProject(p.name)}
async function openProject(name){project=await api('/api/projects/'+encodeURIComponent(name));if(!projects.find(x=>x.name===name))projects.push(project);saveLocal();$('title').textContent=project.name;renderProjects();renderClasses();renderItems()}
function renderClasses(){$('classes').innerHTML=(project?.classes||[]).map((x,i)=>`<span class="tag">${i}: ${x}</span>`).join('')}
async function addClass(){if(!project)return alert('اول پروژه بساز');let n=prompt('نام کلاس جدید:');if(!n)return;project=await api('/api/projects/'+encodeURIComponent(project.name)+'/classes',{method:'POST',body:JSON.stringify({name:n})});renderClasses();saveLocal()}
function renderItems(){let entries=Object.entries(project?.items||{});$('items').innerHTML=entries.map(([k,v])=>{let isVideo=v.type==='video'; let src=isVideo?'':`src="/media/${encodeURIComponent(project.name)}/${k}"`; let icon=isVideo?'🎞️':'🖼️'; return `<div class="thumb ${current===k?'active':''}" onclick="selectItem('${encodeURIComponent(k)}')"><div class="thumbMedia">${isVideo?`<div class="videoThumb">${icon}</div>`:`<img ${src} onerror="this.style.display='none'">`}</div><span>${k.split('/').pop()} · ${v.labels?.length||0}</span></div>`}).join('');$('stats').textContent=`${entries.length} فایل · ${entries.reduce((a,[k,v])=>a+(v.labels?.length||0),0)} لیبل`}
async function selectItem(enc){current=decodeURIComponent(enc);selected=-1;poly=[];let it=project.items[current];renderItems();$('empty').style.display='none';if(it.type==='video'){$('video').hidden=false;canvas.style.display='none';$('video').src='/media/'+encodeURIComponent(project.name)+'/'+current;return}$('video').hidden=true;canvas.style.display='block';img.onload=()=>{canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;draw()};img.src='/media/'+encodeURIComponent(project.name)+'/'+current}
function fit(v,a,b){return Math.max(a,Math.min(b,v))}
function pos(e){let r=canvas.getBoundingClientRect();return{x:(e.clientX-r.left)*canvas.width/r.width,y:(e.clientY-r.top)*canvas.height/r.height}}
function dist(a,b){return Math.hypot(a.x-b.x,a.y-b.y)}
function draw(){if(!img.naturalWidth)return;ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0);let ls=project.items[current].labels||[];ls.forEach((b,i)=>{let active=i===selected;ctx.lineWidth=active?Math.max(3,canvas.width/350):Math.max(2,canvas.width/500);ctx.strokeStyle=active?'#ffcc00':'#00e5ff';ctx.fillStyle=active?'rgba(255,204,0,.15)':'rgba(0,229,255,.08)';if(b.type==='polygon'&&b.points?.length>=3){ctx.beginPath();b.points.forEach((p,j)=>j?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.fill();ctx.stroke();if(active)b.points.forEach(p=>{ctx.beginPath();ctx.fillStyle='#fff';ctx.arc(p.x,p.y,6,0,Math.PI*2);ctx.fill();ctx.stroke()})}else{ctx.fillRect(b.x1,b.y1,b.x2-b.x1,b.y2-b.y1);ctx.strokeRect(b.x1,b.y1,b.x2-b.x1,b.y2-b.y1);if(active){let hs=handles(b);hs.forEach(p=>{ctx.beginPath();ctx.fillStyle='#fff';ctx.arc(p.x,p.y,6,0,Math.PI*2);ctx.fill();ctx.stroke()})}}ctx.font='14px Arial';ctx.fillStyle=active?'#ffcc00':'#00e5ff';ctx.fillText(`${i+1}: ${project.classes[b.class_id]||'?'}`,b.x1,b.y1-7)})
if(poly.length){ctx.beginPath();poly.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.strokeStyle='#ff4d8d';ctx.lineWidth=3;ctx.stroke();poly.forEach(p=>{ctx.beginPath();ctx.fillStyle='#ff4d8d';ctx.arc(p.x,p.y,5,0,Math.PI*2);ctx.fill()})}}
function handles(b){let mx=(b.x1+b.x2)/2,my=(b.y1+b.y2)/2;return[{x:b.x1,y:b.y1,n:'nw'},{x:mx,y:b.y1,n:'n'},{x:b.x2,y:b.y1,n:'ne'},{x:b.x2,y:my,n:'e'},{x:b.x2,y:b.y2,n:'se'},{x:mx,y:b.y2,n:'s'},{x:b.x1,y:b.y2,n:'sw'},{x:b.x1,y:my,n:'w'}]}
function hitLabel(p){let ls=project.items[current].labels||[];for(let i=ls.length-1;i>=0;i--){let b=ls[i];if(b.type==='polygon'&&b.points?.length>=3){for(let j=0;j<b.points.length;j++)if(dist(p,b.points[j])<12)return {i,kind:'vertex',j};if(pointInPoly(p,b.points))return {i,kind:'move'}}else{let hs=handles(b);for(let h of hs)if(dist(p,h)<12)return {i,kind:'resize',handle:h.n};if(p.x>=b.x1&&p.x<=b.x2&&p.y>=b.y1&&p.y<=b.y2)return {i,kind:'move'}}}return null}
function pointInPoly(p,pts){let inside=false;for(let i=0,j=pts.length-1;i<pts.length;j=i++){let a=pts[i],b=pts[j];if(((a.y>p.y)!=(b.y>p.y))&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside}return inside}
async function chooseClass(){if(!project.classes.length){alert('اول کلاس بساز');return null}let s=prompt('شماره کلاس را وارد کن:\n'+project.classes.map((x,i)=>`${i}: ${x}`).join('\n'),'0');if(s===null)return null;let n=Number(s);return Number.isInteger(n)&&n>=0&&n<project.classes.length?n:null}
canvas.addEventListener('mousedown',async e=>{if(!current||project.items[current].type!=='image')return;let p=pos(e);if(mode==='seg'){if(e.button!==0)return;if(poly.length===0){poly=[p];draw()}else if(dist(p,poly[0])<14&&poly.length>=3){await finishPoly()}else{poly.push(p);draw()}return}let hit=hitLabel(p);if(hit){selected=hit.i;let b=project.items[current].labels[selected];drag={...hit,last:p,orig:JSON.parse(JSON.stringify(b))};draw();return}selected=-1;start=p;drawing=true;draw()});
canvas.addEventListener('mousemove',e=>{if(!current)return;let p=pos(e);if(mode==='seg'&&poly.length){draw();ctx.beginPath();ctx.moveTo(poly[poly.length-1].x,poly[poly.length-1].y);ctx.lineTo(p.x,p.y);ctx.strokeStyle='#ff4d8d';ctx.stroke();return}if(!drawing&&!drag)return;if(drawing){draw();ctx.strokeStyle='#00ff88';ctx.lineWidth=3;ctx.strokeRect(Math.min(start.x,p.x),Math.min(start.y,p.y),Math.abs(p.x-start.x),Math.abs(p.y-start.y));return}let b=project.items[current].labels[drag.i],dx=p.x-drag.last.x,dy=p.y-drag.last.y;if(drag.kind==='move'){if(b.type==='polygon')b.points.forEach(q=>{q.x+=dx;q.y+=dy});else{b.x1+=dx;b.x2+=dx;b.y1+=dy;b.y2+=dy}}else if(drag.kind==='vertex'){b.points[drag.j]={x:fit(p.x,0,canvas.width),y:fit(p.y,0,canvas.height)}}else{resizeBox(b,drag.handle,p)}drag.last=p;draw()});
canvas.addEventListener('mouseup',async e=>{if(!current)return;if(mode==='seg')return;let p=pos(e);if(drawing){drawing=false;if(Math.abs(p.x-start.x)>=5&&Math.abs(p.y-start.y)>=5){let cid=await chooseClass();if(cid!==null){project.items[current].labels.push({type:'box',class_id:cid,x1:Math.min(start.x,p.x),y1:Math.min(start.y,p.y),x2:Math.max(start.x,p.x),y2:Math.max(start.y,p.y)});selected=project.items[current].labels.length-1;await saveLabels();renderItems()}}draw()}else if(drag){drag=null;await saveLabels();renderItems();draw()}});
function resizeBox(b,h,p){let min=2,x=fit(p.x,0,canvas.width),y=fit(p.y,0,canvas.height);if(h.includes('w'))b.x1=Math.min(x,b.x2-min);if(h.includes('e'))b.x2=Math.max(x,b.x1+min);if(h.includes('n'))b.y1=Math.min(y,b.y2-min);if(h.includes('s'))b.y2=Math.max(y,b.y1+min)}
async function finishPoly(){let cid=await chooseClass();if(cid===null){poly=[];draw();return}project.items[current].labels.push({type:'polygon',class_id:cid,points:poly.map(p=>({x:p.x,y:p.y}))});selected=project.items[current].labels.length-1;poly=[];await saveLabels();renderItems();draw()}
canvas.addEventListener('dblclick',async()=>{if(mode==='seg'&&poly.length>=3)await finishPoly()});
async function deleteSelected(){if(!current||selected<0)return;project.items[current].labels.splice(selected,1);selected=-1;await saveLabels();renderItems();draw()}
async function saveLabels(){await api('/api/projects/'+encodeURIComponent(project.name)+'/labels',{method:'POST',body:JSON.stringify({item:current,labels:project.items[current].labels})});let p=projects.find(x=>x.name===project.name);if(p)p.items=project.items;saveLocal()}
function setMode(m){mode=m;poly=[];selected=-1;$('boxMode').classList.toggle('active',m==='box');$('segMode').classList.toggle('active',m==='seg');$('modeHint').textContent=m==='box'?'کشیدن = Box | کلیک روی Box = انتخاب | دستگیره‌ها = تغییر اندازه | داخل Box = جابه‌جایی':'کلیک روی نقاط شیء | دوبارکلیک یا کلیک روی نقطه اول = پایان Polygon';draw()}
document.addEventListener('keydown',async e=>{if(e.key==='Escape'){poly=[];drawing=false;drag=null;draw()}if((e.key==='Delete'||e.key==='Backspace')&&selected>=0){e.preventDefault();await deleteSelected()}if(e.key==='Enter'&&mode==='seg'&&poly.length>=3)await finishPoly()});
$('files').addEventListener('change',async e=>{if(!project)return alert('اول پروژه بساز');let fd=new FormData();[...e.target.files].forEach(f=>fd.append('files',f));let r=await fetch('/api/projects/'+encodeURIComponent(project.name)+'/upload',{method:'POST',body:fd});project=(await r.json()).meta;renderItems();e.target.value=''});
async function exportData(){if(!project)return;let format=$('exportFormat').value;let r=await fetch('/api/projects/'+encodeURIComponent(project.name)+'/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({val:.2,format})});if(!r.ok){alert(await r.text());return}let blob=await r.blob();let a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=project.name+'_dataset.zip';a.click()}
loadProjects();

// ---- Video frame extraction / project persistence helpers ----
async function openFrameTool(){
  if(!project) return alert('اول پروژه را انتخاب کنید');
  const videos=Object.entries(project.items||{}).filter(([k,v])=>v.type==='video');
  if(!videos.length) return alert('در این پروژه هنوز ویدئویی وجود ندارد.');
  $('frameVideo').innerHTML=videos.map(([k,v])=>`<option value="${encodeURIComponent(k)}">${k.split('/').pop()}</option>`).join('');
  $('frameModal').hidden=false;
  await updateVideoInfo();
}
function closeFrameTool(){$('frameModal').hidden=true}
function toggleFrameRange(){$('rangeFields').hidden=$('frameMode').value!=='range';}
async function updateVideoInfo(){
  const key=decodeURIComponent($('frameVideo').value); const it=project.items[key];
  if(!it)return;
  const info=await api('/api/projects/'+encodeURIComponent(project.name)+'/video-info?video='+encodeURIComponent(key));
  $('videoInfo').textContent=`FPS: ${Number(info.fps).toFixed(2)} | تعداد فریم: ${info.frame_count} | مدت: ${Number(info.duration).toFixed(2)} ثانیه`;
  $('frameEnd').value=Math.max(0,info.frame_count-1); $('frameStart').max=Math.max(0,info.frame_count-1); $('frameEnd').max=Math.max(0,info.frame_count-1);
}
$('frameVideo')?.addEventListener('change',updateVideoInfo);
async function extractFrames(){
  const video=decodeURIComponent($('frameVideo').value), mode=$('frameMode').value;
  let body={video,mode};
  if(mode==='range'){
    body.start=Number($('frameStart').value); body.end=Number($('frameEnd').value); body.step=Number($('frameStep').value);
    if(body.start<0||body.end<body.start||body.step<1)return alert('بازه فریم نامعتبر است.');
  }
  const btn=document.querySelector('#frameModal .modalActions button:last-child'); btn.disabled=true; btn.textContent='در حال استخراج...';
  try{const r=await api('/api/projects/'+encodeURIComponent(project.name)+'/frames',{method:'POST',body:JSON.stringify(body)}); project=await api('/api/projects/'+encodeURIComponent(project.name)); renderItems(); closeFrameTool(); alert(`${r.count} فریم استخراج شد.\nفریم‌های موجود قبلی دوباره‌نویسی نشدند.`)}catch(e){alert(e.message)}finally{btn.disabled=false;btn.textContent='استخراج'}
}

$('importZip')?.addEventListener('change',async e=>{
  if(!project||!e.target.files[0]) return;
  const fd=new FormData(); fd.append('dataset',e.target.files[0]);
  try{const r=await fetch('/api/projects/'+encodeURIComponent(project.name)+'/import-yolo',{method:'POST',body:fd}); const j=await r.json(); if(!r.ok) throw Error(j.error||'Import failed'); project=j.meta; renderClasses(); renderItems(); alert(`${j.imported} تصویر از دیتاست YOLO وارد شد.`)}catch(err){alert(err.message)}finally{e.target.value=''}
});
async function deleteProject(){if(!project)return; if(!confirm(`پروژه «${project.name}» و تمام داده‌هایش حذف شود؟`))return; await api('/api/projects/'+encodeURIComponent(project.name)+'/delete',{method:'POST'}); project=null; current=null; $('title').textContent='پروژه‌ای انتخاب نشده'; $('stats').textContent=''; $('items').innerHTML=''; $('classes').innerHTML=''; loadProjects()}
