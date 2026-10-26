/* Browser-only review of pre-rendered views. No upload or training endpoint. */
(function () {
  'use strict';
  const SCHEMA = 'cw-depthgs-review/v1';
  const MAX_NOTES = 100;
  const TEXT_LIMIT = 2000;
  const memory = new Map();
  const metadata = new Map();
  const localAssets = new Set();
  let root, manifest, building, view, notes = [], selected = null, ui, storageFailed = false, viewToken = 0;

  function el(tag, text, attrs) {
    const n = document.createElement(tag);
    if (text !== undefined && text !== null) n.textContent = text;
    Object.entries(attrs || {}).forEach(([k, v]) => { if (k === 'class') n.className = v; else n.setAttribute(k, v); });
    return n;
  }
  function button(text, action, cls) { const n = el('button', text, {type: 'button', class: cls || ''}); n.addEventListener('click', action); return n; }
  function field(label, control) { const w = el('label', null, {class: 'ws-field'}); control.setAttribute('aria-label',label); w.append(el('span', label), control); return w; }
  function notify(text, error) { ui.message.textContent = text; ui.message.classList.toggle('ws-error', !!error); }
  function warnStorage(text) { ui.storage.textContent = text; ui.storage.hidden = false; }
  function key(b, v) { return 'cw-depthgs:review:v1:' + encodeURIComponent(b) + ':' + encodeURIComponent(v); }
  function recordMeta(id) {
    if(!metadata.has(id)) {
      let m={name:'',date:''};
      try { const saved=JSON.parse(localStorage.getItem('cw-depthgs:meta:'+id)||'null');if(saved&&typeof saved.name==='string'&&saved.name.length<=120&&typeof saved.date==='string'&&/^$|^\d{4}-\d{2}-\d{2}$/.test(saved.date))m=saved; }catch(e){}
      metadata.set(id,m);
    }
    return metadata.get(id);
  }
  function saveMeta(id,m) { metadata.set(id,m);try{localStorage.setItem('cw-depthgs:meta:'+id,JSON.stringify(m));}catch(e){warnStorage('资料信息暂存于当前页面，请导出JSON备份。');} }
  function recordName(){return recordMeta(building.id).name||building.name;}
  function validNote(n) {
    return n && typeof n.id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(n.id) &&
      typeof n.x === 'number' && Number.isFinite(n.x) && n.x >= 0 && n.x <= 1 &&
      typeof n.y === 'number' && Number.isFinite(n.y) && n.y >= 0 && n.y <= 1 &&
      typeof n.note === 'string' && n.note.length <= TEXT_LIMIT &&
      ['待复核', '已复核'].includes(n.status);
  }
  function cleanNotes(data) {
    if (!Array.isArray(data) || data.length > MAX_NOTES || !data.every(validNote) || new Set(data.map(n => n.id)).size !== data.length) throw Error('标注内容不符合格式要求');
    return data.map(n => ({id:n.id, x:n.x, y:n.y, note:n.note, status:n.status}));
  }
  function loadNotes(b, v) {
    const k = key(b, v);
    if (memory.has(k)) return memory.get(k);
    let result = [];
    try { const raw = localStorage.getItem(k); if (raw) result = cleanNotes(JSON.parse(raw)); }
    catch (e) { warnStorage('本机存储不可用或已有记录损坏。本次标注仍可使用，请下载JSON档案保存。'); storageFailed = true; }
    memory.set(k, result); return result;
  }
  function persist(b, v, data) {
    memory.set(key(b, v), data);
    try { localStorage.setItem(key(b, v), JSON.stringify(data)); }
    catch (e) { storageFailed = true; warnStorage('浏览器未能保存标注。离开页面前请下载JSON档案，本次修改暂存于当前页面。'); }
  }
  function safeAsset(path) {
    if (typeof path !== 'string' || !path.trim()) throw Error('缺少图像路径');
    const u = new URL(path, document.baseURI);
    if (u.protocol === 'blob:' && localAssets.has(u.href)) return u.href;
    if (!['http:', 'https:', 'file:'].includes(u.protocol) || (location.protocol !== 'file:' && u.origin !== location.origin)) throw Error('图像必须来自本站');
    return u.href;
  }
  function validateManifest(data) {
    if (!data || !Array.isArray(data.buildings) || !data.buildings.length) throw Error('没有可用建筑案例');
    const ids = new Set();
    data.buildings.forEach(b => {
      if (!b || typeof b.id !== 'string' || !b.id || ids.has(b.id) || typeof b.name !== 'string' || !Array.isArray(b.views) || !b.views.length) throw Error('建筑清单格式不正确');
      ids.add(b.id); const views = new Set();
      b.views.forEach(v => { if (!v || typeof v.id !== 'string' || !v.id || views.has(v.id) || typeof v.label !== 'string') throw Error('视角清单格式不正确'); views.add(v.id); safeAsset(v.reference); safeAsset(v.render); });
    });
    return data;
  }
  function makeImagePanel(title, interactive) {
    const figure = el('figure', null, {class:'ws-figure'}); figure.append(el('figcaption', title));
    const stage = el('div', null, {class:'ws-image-stage'});
    const image = el('img', null, {alt:title}); image.crossOrigin = 'anonymous';
    const pending = el('p', '正在加载图像…', {class:'ws-image-state', role:'status'});
    stage.append(image); figure.append(stage, pending);
    if (interactive) {
      stage.tabIndex = 0; stage.setAttribute('role','group'); stage.setAttribute('aria-label','渲染图标注区域，按Enter在中心添加标注，可在下方修改坐标');
      stage.addEventListener('click', e => {
        if (e.target.closest('button') || !image.complete || !image.naturalWidth) return;
        const r = image.getBoundingClientRect(); addNote((e.clientX-r.left)/r.width,(e.clientY-r.top)/r.height);
      });
      stage.addEventListener('keydown', e => { if (e.target === stage && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); addNote(.5,.5); } });
    }
    return {figure,stage,image,pending};
  }
  function loadImage(panel, src, alt, token) {
    panel.pending.hidden = false; panel.pending.textContent = '正在加载图像…'; panel.image.hidden = true;
    panel.image.onload = () => { if (token !== viewToken) return; panel.pending.hidden = true; panel.image.hidden = false; if (panel === ui.render) drawMarkers(); };
    panel.image.onerror = () => { if (token !== viewToken) return; panel.pending.hidden = false; panel.pending.textContent = '图像加载失败，请重新加载此视角。'; panel.image.hidden = true; };
    panel.image.alt = alt; panel.image.src = safeAsset(src);
  }
  function selectBuilding(id) {
    building = manifest.buildings.find(b => b.id === id); ui.building.value = building.id;
    ui.recordName.value=recordMeta(id).name;ui.captureDate.value=recordMeta(id).date;
    ui.view.replaceChildren(); building.views.forEach(v => ui.view.append(el('option',v.label,{value:v.id})));
    ui.source.textContent = building.source ? '图像来源：' + building.source : '';
    ui.reference.figure.hidden = !!building.local;
    ui.comparison.classList.toggle('ws-local-photo',!!building.local);
    ui.render.figure.querySelector('figcaption').textContent = building.local ? '现场照片 · 点击添加人工标注' : '重建渲染 · 点击添加人工标注';
    selectView(building.views[0].id);
  }
  function selectView(id) {
    view = building.views.find(v => v.id === id); ui.view.value = view.id; notes = loadNotes(building.id,view.id); selected = null;
    const token = ++viewToken;
    ui.render.stage.querySelectorAll('.ws-marker').forEach(n=>n.remove());
    if (!building.local) loadImage(ui.reference,view.reference,building.name+' '+view.label+' 参考照片',token);
    loadImage(ui.render,view.render,building.name+' '+view.label+(building.local?' 现场照片':' 重建渲染'),token);
    updateList(); notify('已打开 '+building.name+' · '+view.label+'。');
  }
  function addNote(x,y) {
    if (!ui.render.image.naturalWidth || ui.render.image.hidden) { notify('图像加载完成后才能添加标注。',true); return; }
    if (notes.length >= MAX_NOTES) { notify('每个视角最多保留100个标注。请先整理已有记录。',true); return; }
    const n={id:'n'+Date.now().toString(36)+Math.random().toString(36).slice(2,8),x:Math.max(0,Math.min(1,x)),y:Math.max(0,Math.min(1,y)),note:'',status:'待复核'};
    notes.push(n); persist(building.id,view.id,notes); selected=n.id; updateList(); ui.note.focus(); notify('已添加标注，请填写人工复核说明。');
  }
  function drawMarkers() {
    ui.render.stage.querySelectorAll('.ws-marker').forEach(n=>n.remove());
    if (ui.render.image.hidden) return;
    notes.forEach((n,i)=>{ const b=button(String(i+1),e=>{e.stopPropagation();selected=n.id;updateList();ui.note.focus();},'ws-marker'+(n.id===selected?' is-selected':'')); b.style.left=n.x*100+'%';b.style.top=n.y*100+'%'; b.setAttribute('aria-label','编辑标注'+(i+1)+'，'+n.status);ui.render.stage.append(b); });
  }
  function updateList() {
    ui.list.replaceChildren(); ui.count.textContent='当前视角 '+notes.length+' 条人工标注';
    if (!notes.length) ui.list.append(el('p','尚无标注。点击渲染图，或使用“在中心添加标注”按钮。',{class:'ws-empty'}));
    notes.forEach((n,i)=>{
      const row=el('li',null,{class:'ws-note-row'});
      row.append(button('标注 '+(i+1),()=>{selected=n.id;updateList();ui.note.focus();},'ws-note-select'));
      row.append(el('p',n.note || '尚未填写说明',{class:'ws-note-text'}));
      const status=el('select',null,{'aria-label':'标注'+(i+1)+'复核状态'}); ['待复核','已复核'].forEach(s=>status.append(el('option',s,{value:s})));status.value=n.status;
      status.addEventListener('change',()=>{n.status=status.value;persist(building.id,view.id,notes); if(selected===n.id)ui.status.value=n.status;notify('复核状态已更新。');});
      row.append(status,button('删除',()=>{notes.splice(notes.indexOf(n),1);if(selected===n.id)selected=null;persist(building.id,view.id,notes);updateList();notify('标注已删除。');},'ws-delete'));
      ui.list.append(row);
    });
    const active=notes.find(n=>n.id===selected);ui.editor.hidden=!active;
    if(active){ui.editorTitle.textContent='编辑标注 '+(notes.indexOf(active)+1);ui.note.value=active.note;ui.status.value=active.status;ui.x.value=(active.x*100).toFixed(2);ui.y.value=(active.y*100).toFixed(2);}
    drawMarkers();
  }
  function saveEditor(e) {
    e.preventDefault();const n=notes.find(n=>n.id===selected);if(!n)return;
    const x=Number(ui.x.value),y=Number(ui.y.value);
    if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||x>100||y<0||y>100){notify('坐标需要在0至100%之间。',true);return;}
    n.note=ui.note.value.slice(0,TEXT_LIMIT);n.status=ui.status.value;n.x=x/100;n.y=y/100;
    persist(building.id,view.id,notes);updateList();notify(storageFailed?'修改已暂存，请下载JSON档案保存。':'标注已保存在当前浏览器。');
  }
  function download(blob,name) { const u=URL.createObjectURL(blob),a=el('a',null,{href:u,download:name});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),30000); }
  function archive() { return {schema:SCHEMA,buildingId:building.id,buildingName:building.name,record:recordMeta(building.id),exportedAt:new Date().toISOString(),coordinateSystem:'image-normalized-2d',views:building.views.map(v=>({viewId:v.id,label:v.label,annotations:loadNotes(building.id,v.id)}))}; }
  function exportJSON(){ download(new Blob([JSON.stringify(archive(),null,2)],{type:'application/json'}),building.id+'-人工复核.json');notify('已导出当前建筑全部视角的标注。'); }
  async function importJSON(e) {
    const file=e.target.files[0];e.target.value='';if(!file)return;
    try{
      if(file.size>16*1024*1024)throw Error('JSON文件不得超过16MB');
      const data=JSON.parse(await file.text());
      if(data.schema!==SCHEMA||typeof data.buildingId!=='string'||!Array.isArray(data.views))throw Error('不是支持的复核档案');
      if(data.record&&(typeof data.record.name!=='string'||data.record.name.length>120||typeof data.record.date!=='string'||!/^$|^\d{4}-\d{2}-\d{2}$/.test(data.record.date)))throw Error('资料名称或采集日期格式错误');
      const b=manifest.buildings.find(x=>x.id===data.buildingId);if(!b)throw Error(data.buildingId.startsWith('local-')?'请先重新选择档案对应的全部现场照片，再导入JSON':'档案对应的建筑不在当前案例中');
      if(data.views.length>b.views.length)throw Error('视角数量不正确');
      const seen=new Set(), clean=[];
      for(const v of data.views){if(!v||typeof v.viewId!=='string'||seen.has(v.viewId)||!b.views.some(x=>x.id===v.viewId))throw Error(b.local?'照片与档案不匹配，请重新选择导出档案时使用的全部原始照片':'档案包含未知或重复视角');seen.add(v.viewId);clean.push({viewId:v.viewId,annotations:cleanNotes(v.annotations)});}
      if(!clean.length)throw Error('档案没有视角记录');
      if(!window.confirm('导入将替换“'+b.name+'”中档案所含视角的本机标注，是否继续？'))return;
      clean.forEach(v=>persist(b.id,v.viewId,v.annotations));if(data.record)saveMeta(b.id,{name:data.record.name,date:data.record.date});selectBuilding(b.id);notify('档案已恢复，共'+clean.reduce((sum,v)=>sum+v.annotations.length,0)+'条标注。');
    }catch(err){notify('导入失败：'+err.message+'。现有记录未被替换。',true);}
  }
  async function importPhotos(e) {
    const files=Array.from(e.target.files||[]);e.target.value='';if(!files.length)return;
    if(files.length>20){notify('一次最多选择20张现场照片。',true);return;}
    if(files.some(f=>!['image/jpeg','image/png','image/webp'].includes(f.type)||f.size>20*1024*1024)){notify('请选择JPG、PNG或WebP图片，每张不超过20MB。',true);return;}
    if(new Set(files.map(f=>f.name)).size!==files.length){notify('照片文件名不能重复，请重命名后再导入。',true);return;}
    const pending=[];
    try {
      for(const file of files){
        const url=URL.createObjectURL(file);pending.push(url);
        const im=new Image();im.src=url;await im.decode();if(!im.naturalWidth)throw Error('照片无法读取');
      }
      const views=await Promise.all(files.map(async(f,i)=>{
        const digest=await crypto.subtle.digest('SHA-256',await f.arrayBuffer());
        const hash=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
        return {id:'photo-'+hash,label:f.name,reference:pending[i],render:pending[i]};
      }));
      if(new Set(views.map(v=>v.id)).size!==views.length)throw Error('照片内容重复，请只选择一份');
      const collectionDigest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(views.map(v=>v.id).sort().join('|')));
      const collectionId='local-'+Array.from(new Uint8Array(collectionDigest),n=>n.toString(16).padStart(2,'0')).join('');
      localAssets.forEach(url=>URL.revokeObjectURL(url));localAssets.clear();pending.forEach(url=>localAssets.add(url));
      const b={id:collectionId,name:'本地现场照片',local:true,source:'用户在本机选择的照片，仅作人工查看与记录。关闭页面后需重新选择同一组原始照片，标注可通过JSON档案恢复。',views};
      manifest.buildings=manifest.buildings.filter(x=>!x.local);manifest.buildings.push(b);
      ui.building.replaceChildren();manifest.buildings.forEach(x=>ui.building.append(el('option',x.name,{value:x.id})));selectBuilding(b.id);
      notify('已载入'+files.length+'张现场照片，仅在本机查看。请导出JSON备份标注，重新打开页面后需重选相同的原始照片。');
    }catch(err){pending.forEach(url=>URL.revokeObjectURL(url));notify('现场照片读取失败：'+err.message+'。',true);}
  }
  function wrap(ctx,text,maxWidth){const out=[];let line='';for(const ch of text){if(ch==='\n'){out.push(line);line='';continue;}if(ctx.measureText(line+ch).width>maxWidth&&line){out.push(line);line=ch;}else line+=ch;}out.push(line);return out;}
  async function exportPNG(){
    try{
      const filename=building.id+'-'+view.id+'-标注.png';
      const img=ui.render.image;if(img.hidden||!img.complete||!img.naturalWidth)throw Error('请等待渲染图加载完成');
      const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');if(!ctx)throw Error('当前浏览器不支持截图');
      const width=Math.min(1600,Math.max(800,img.naturalWidth)),height=Math.round(width*img.naturalHeight/img.naturalWidth);canvas.width=width;
      ctx.font='20px "Times New Roman", SimSun, serif';
      const lines=notes.flatMap((n,i)=>wrap(ctx,(i+1)+'. ['+n.status+'] '+(n.note||'尚未填写说明'),width-64));
      const exportHeight=height+120+Math.max(1,lines.length)*30;
      if(exportHeight>20000)throw Error('备注过长，请使用JSON档案或打印报告导出');
      canvas.height=exportHeight;
      ctx.fillStyle='#fff';ctx.fillRect(0,0,width,canvas.height);ctx.fillStyle='#172025';ctx.font='25px "Times New Roman", SimSun, serif';ctx.fillText(building.name+' · '+view.label,24,36,width-48);ctx.font='18px "Times New Roman", SimSun, serif';ctx.fillText((building.local?'现场照片':'重建渲染')+' / 人工二维标注记录',24,66);ctx.drawImage(img,0,88,width,height);
      notes.forEach((n,i)=>{const x=Math.max(16,Math.min(width-16,n.x*width)),y=88+Math.max(16,Math.min(height-16,n.y*height));ctx.beginPath();ctx.arc(x,y,15,0,Math.PI*2);ctx.fillStyle='#b84a24';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();ctx.fillStyle='#fff';ctx.font='bold 18px serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(i+1),x,y);});
      ctx.textAlign='left';ctx.textBaseline='alphabetic';ctx.fillStyle='#172025';ctx.font='20px "Times New Roman", SimSun, serif';(lines.length?lines:['当前视角无人工标注。']).forEach((line,i)=>ctx.fillText(line,24,height+120+i*30));
      canvas.toBlob(blob=>{if(!blob){notify('截图生成失败。',true);return;}download(blob,filename);notify('已导出带人工标注的PNG截图。');},'image/png');
    }catch(err){notify('截图失败：'+err.message+'。',true);}
  }
  async function printReport(){
    const win=window.open('','_blank');if(!win){notify('浏览器阻止了报告窗口，请允许本站弹出窗口后重试。',true);return;}
    const doc=win.document;doc.title=recordName()+' 人工复核记录';doc.documentElement.lang='zh-CN';
    const style=doc.createElement('style');style.textContent='body{font:15px/1.6 "Times New Roman",SimSun,serif;color:#172025;margin:30px}h1{font-size:25px}h2{font-size:20px}section{break-inside:avoid;margin:28px 0}.pics{display:flex;gap:16px}.pics figure{width:48%;margin:0}.stage{position:relative}.stage img{display:block;width:100%}.mark{position:absolute;transform:translate(-50%,-50%);background:#b84a24;color:#fff;border:1px solid white;border-radius:50%;width:22px;height:22px;text-align:center;line-height:22px;font-size:12px}li{white-space:pre-wrap;overflow-wrap:anywhere}button{padding:8px 18px}@media print{button{display:none}body{margin:0}@page{margin:16mm}}';doc.head.append(style);
    const make=(tag,text)=>{const n=doc.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
    doc.body.append(make('h1',recordName()+' 人工复核记录'),make('p',building.local?'本机现场照片的人工记录，未执行重建或自动诊断。':'多视角渲染浏览。标注为人工记录，不代表自动诊断或工程测量结论。'),make('p','图像来源：'+(building.source||'未提供')),make('p','采集日期：'+(recordMeta(building.id).date||'未填写')),make('p','导出时间：'+new Date().toLocaleString('zh-CN')));
    const print=make('button','正在准备图片…');print.disabled=true;print.onclick=()=>win.print();const reportState=make('p','正在加载报告图片，请稍候。');reportState.setAttribute('role','status');doc.body.append(print,reportState);
    const imgs=[];
    building.views.forEach(v=>{const section=make('section');section.append(make('h2',v.label));const pics=make('div');pics.className='pics';const ns=loadNotes(building.id,v.id);
      (building.local?[['现场照片',v.render,true]]:[['参考照片',v.reference,false],['重建渲染',v.render,true]]).forEach(([title,src,marked])=>{const f=make('figure');f.append(make('figcaption',title));const st=make('div');st.className='stage';const im=make('img');im.alt=title;im.src=safeAsset(src);imgs.push(im);st.append(im);if(marked)ns.forEach((n,i)=>{const point=make('span',String(i+1));point.className='mark';point.style.left=n.x*100+'%';point.style.top=n.y*100+'%';st.append(point);});f.append(st);pics.append(f);});section.append(pics);
      if(ns.length){const list=make('ol');ns.forEach(n=>list.append(make('li','['+n.status+'] '+(n.note||'尚未填写说明'))));section.append(list);}else section.append(make('p','该视角暂无人工标注。'));doc.body.append(section);
    });
    const ready=await Promise.all(imgs.map(im=>im.complete?Promise.resolve(im.naturalWidth>0):new Promise(resolve=>{const done=ok=>{clearTimeout(timer);resolve(ok);};const timer=setTimeout(()=>done(false),15000);im.onload=()=>done(im.naturalWidth>0);im.onerror=()=>done(false);})));if(win.closed)return;
    const missing=ready.filter(ok=>!ok).length;
    if(missing){reportState.textContent=missing+'张图片未能加载，报告尚未完整。请关闭此窗口，检查网络后重新生成。';print.textContent='图片未完整加载';notify('报告有图片未加载，请重新生成。',true);}
    else{reportState.textContent='图片已加载，可以打印或保存为PDF。';print.disabled=false;print.textContent='打印 / 保存为PDF';notify('报告已打开，包含当前建筑所有视角及人工备注。请在报告窗口打印或保存PDF。');}win.focus();
  }
  function buildUI(){
    root.replaceChildren();root.classList.add('cw-workspace');ui={};
    const intro=el('div',null,{class:'ws-intro'});intro.append(el('p','可直接试用下方公开案例，也可以选择自己的现场照片，添加人工备注并导出记录。'));
    ui.photos=el('input',null,{type:'file',accept:'image/jpeg,image/png,image/webp',multiple:'',hidden:''});ui.photos.onchange=importPhotos;intro.append(button('选择本地现场照片',()=>ui.photos.click()),ui.photos);
    ui.storage=el('p','标注保存在当前浏览器，请下载JSON档案备份或转移到其他设备。',{class:'ws-storage',role:'status'});intro.append(ui.storage);root.append(intro);
    const controls=el('div',null,{class:'ws-controls'});ui.building=el('select');ui.view=el('select');manifest.buildings.forEach(b=>ui.building.append(el('option',b.name,{value:b.id})));ui.building.onchange=()=>selectBuilding(ui.building.value);ui.view.onchange=()=>selectView(ui.view.value);
    controls.append(field('建筑',ui.building),field('视角',ui.view),button('重新加载图像',()=>selectView(view.id)));root.append(controls);
    const info=el('div',null,{class:'ws-controls'});ui.recordName=el('input',null,{type:'text',maxlength:'120',placeholder:'例如：东侧办公楼外观记录'});ui.captureDate=el('input',null,{type:'date'});
    const updateMeta=()=>saveMeta(building.id,{name:ui.recordName.value.trim(),date:ui.captureDate.value});ui.recordName.oninput=updateMeta;ui.captureDate.onchange=updateMeta;
    info.append(field('资料名称（选填）',ui.recordName),field('采集日期（选填）',ui.captureDate));root.append(info);
    ui.source=el('p',null,{class:'ws-source'});root.append(ui.source);
    const comparison=el('div',null,{class:'ws-comparison'});ui.comparison=comparison;ui.reference=makeImagePanel('参考照片',false);ui.render=makeImagePanel('重建渲染 · 点击添加人工标注',true);comparison.append(ui.reference.figure,ui.render.figure);root.append(comparison);
    const actions=el('div',null,{class:'ws-actions'});ui.import=el('input',null,{type:'file',accept:'.json,application/json',hidden:''});ui.import.onchange=importJSON;actions.append(button('在中心添加标注',()=>addNote(.5,.5)),button('下载JSON档案',exportJSON),button('导入JSON档案',()=>ui.import.click()),button('下载标注PNG',exportPNG),button('生成打印报告',printReport),ui.import);root.append(actions);
    ui.message=el('p','',{role:'status','aria-live':'polite',class:'ws-message'});root.append(ui.message);
    const area=el('div',null,{class:'ws-review-area'}),listwrap=el('div');ui.count=el('h3');ui.list=el('ol',null,{class:'ws-note-list'});listwrap.append(ui.count,ui.list);
    ui.editor=el('form',null,{class:'ws-editor',hidden:''});ui.editorTitle=el('h3','编辑标注');ui.note=el('textarea',null,{rows:'5',maxlength:String(TEXT_LIMIT),placeholder:'描述需要复核的外观区域或人工观察，不自动判定病害。'});ui.status=el('select');['待复核','已复核'].forEach(s=>ui.status.append(el('option',s,{value:s})));
    ui.x=el('input',null,{type:'number',min:'0',max:'100',step:'.01',required:''});ui.y=el('input',null,{type:'number',min:'0',max:'100',step:'.01',required:''});const coordinates=el('div',null,{class:'ws-coordinates'});coordinates.append(field('水平位置 %',ui.x),field('垂直位置 %',ui.y));
    ui.editor.append(ui.editorTitle,field('人工备注',ui.note),field('复核状态',ui.status),coordinates,el('button','保存标注',{type:'submit'}));ui.editor.onsubmit=saveEditor;area.append(listwrap,ui.editor);root.append(area);selectBuilding(manifest.buildings[0].id);
  }
  async function initWorkspace(){
    root=document.getElementById('workspace-root');if(!root||root.dataset.wsReady)return;root.dataset.wsReady='loading';root.replaceChildren(el('p','正在加载建筑案例…',{role:'status'}));
    try{const response=await fetch('assets/cases/manifest.json',{cache:'no-cache'});if(!response.ok)throw Error('案例清单暂不可用（'+response.status+'）');manifest=validateManifest(await response.json());root.dataset.wsReady='ready';buildUI();}
    catch(err){root.dataset.wsReady='';root.replaceChildren(el('p','无法加载工作台：'+err.message+'。',{role:'alert'}),button('重新加载',initWorkspace));}
  }
  window.initWorkspace=initWorkspace;
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initWorkspace);else initWorkspace();
})();
