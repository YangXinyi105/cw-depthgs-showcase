// User-facing workflow helpers. Draft storage never contains service credentials.
export function installWorkflow({state,canEdit,el,message,run,showPane,chooseAsset,selectNote,renderNotes,setDirty,parseIssue,issueNumber}) {
  const $=id=>document.getElementById(id);
  const panel=$('project-panel');
  const guide=el('div',undefined,'workflow-guide');
  guide.innerHTML='<div><strong id="next-step-title"></strong><p id="next-step-text"></p></div><button id="next-step-action" type="button"></button>';
  panel.prepend(guide);
  const drafts=el('div',undefined,'draft-tools');
  drafts.innerHTML='<p id="draft-notice" role="status"></p><div class="archive-actions"><button id="draft-resume" type="button" hidden>恢复上次草稿</button><button id="draft-discard" type="button" hidden>删除本机草稿</button><button id="draft-import-button" type="button">导入草稿文件</button><input id="draft-import-file" type="file" accept=".json,application/json" hidden></div>';
  guide.after(drafts);
  const board=el('details',undefined,'issue-board');
  board.innerHTML='<summary>全项目问题总览（<span id="board-count">0</span>）</summary><div class="archive-form"><label>搜索问题或负责人<input id="board-query" type="search" placeholder="输入编号、描述、负责人或照片名"></label><label>处理进度<select id="board-status"><option value="all">全部问题</option><option value="open">未闭环</option><option value="unassigned">未分配负责人</option><option value="closed">已闭环</option></select></label></div><p id="board-result" class="minor" role="status"></p><div id="board-list" class="board-list"></div>';
  $('issue-overview').before(board);
  const upload=el('p',undefined,'minor upload-check');upload.id='upload-check';upload.setAttribute('role','status');$('asset-file').closest('label').after(upload);
  let timer=null,pending=null,basisRevision=null,openedKey='';
  const key=()=> 'cw:review-draft:'+state.base+':'+state.id;
  const closed=n=>['已解决','已验收','已复核'].includes(n.status);
  function read(){const raw=localStorage.getItem(key());return raw?JSON.parse(raw):null;}
  function sameNotes(a,b){return JSON.stringify(a)===JSON.stringify(b);}
  function updateNotice(){
    drafts.hidden=!canEdit();if(!canEdit())return;
    try {
      const saved=read(),different=saved&&!sameNotes(saved.annotations,state.detail.annotations);
      $('draft-resume').hidden=!different;$('draft-discard').hidden=!saved;
      $('draft-notice').textContent=saved?(different?'本机有未提交的草稿':'本机草稿与服务器一致')+' · '+new Date(saved.savedAt).toLocaleString('zh-CN')+(saved.revision!==state.detail.project.revision?' · 服务器版本已变化，恢复前请核对':''):'填写时自动保存草稿。点击“保存标注到服务器”后，其他成员可看到修改。';
    } catch {$('draft-notice').textContent='本机草稿无法读取，请使用“下载本次草稿”保留文件。';}
  }
  function persist(manual=false){
    if(manual){if(!canEdit())throw Error('请先打开可编辑的项目。');snapshot();}
    clearTimeout(timer);timer=null;if(!pending)return;
    const task=pending;pending=null;
    try {localStorage.setItem(task.key,JSON.stringify(task.value));if(task.key===key()){
      updateNotice();$('dirty-state').textContent=state.dirty?'已保存到本机 '+new Date(task.value.savedAt).toLocaleTimeString('zh-CN')+' · 尚未提交服务器':'本机草稿与服务器一致';
      if(manual)message('草稿已保存到当前浏览器。');
    }}catch {if(task.key===key()){$('draft-notice').textContent='自动保存失败，请点击“下载本次草稿”保留文件。';if(manual)throw Error('浏览器无法保存草稿，请下载备份。');}}
  }
  function snapshot(){pending={key:key(),value:{schema:'cw-depthgs-review-draft/v1',project:{id:state.id},revision:basisRevision??state.detail.project.revision,annotations:structuredClone(state.draft),savedAt:new Date().toISOString()}};}
  function changed(value){
    if(!value||!canEdit())return;
    snapshot();clearTimeout(timer);timer=setTimeout(()=>persist(),600);
  }
  function validate(saved){
    if(!saved||!Array.isArray(saved.annotations)||saved.annotations.length>1000)throw Error('草稿格式无效或问题数量超过1000。');
    if(saved.project?.id&&saved.project.id!==state.id)throw Error('这份草稿属于另一个项目，请打开对应项目后导入。');
    const ids=new Set(),assets=new Set(state.detail.assets.filter(a=>a.kind==='photo').map(a=>a.id));
    return saved.annotations.map(n=>{
      if(!n||typeof n.id!=='string'||!n.id||n.id.length>128||ids.has(n.id)||!assets.has(n.asset_id)||!Number.isFinite(n.x)||!Number.isFinite(n.y)||n.x<0||n.x>1||n.y<0||n.y>1||typeof n.note!=='string'||n.note.length>10000||!['待复核','处理中','已解决','已验收','已复核'].includes(n.status))throw Error('草稿包含无效问题或关联照片已不存在，未恢复任何内容。');
      if(n.category&&!['模型局部缺陷','建议补拍','建议重新重建','已确认'].includes(n.category))throw Error('草稿包含无法识别的问题类别。');
      ids.add(n.id);return {id:n.id,asset_id:n.asset_id,x:n.x,y:n.y,note:n.note,status:n.status,...(n.category?{category:n.category}:{})};
    });
  }
  async function restore(saved){
    if(!canEdit()||state.mutation||state.projectLoading)throw Error('请先打开可编辑的项目并等待当前操作完成。');
    if(!saved)throw Error('当前浏览器没有这个项目的草稿。');
    const notes=validate(saved),revision=saved.revision??saved.project?.revision;
    if(!confirm((revision!==state.detail.project.revision?'服务器版本与草稿不同，请核对其他成员的修改。\n':'')+'恢复草稿将替换本页复核问题；点击保存后同步到服务器。现在恢复？'))return;
    state.draft=notes;state.selected=null;basisRevision=revision??state.detail.project.revision;
    setDirty(true);renderNotes();persist();showPane('review');message('草稿已恢复，请核对后提交服务器。');
  }
  function accepted(){
    // A scheduled write belongs to the previous context; never re-key it to a new project.
    persist();basisRevision=state.detail.project.revision;
    if(openedKey!==key()){$('board-query').value='';$('board-status').value='all';openedKey=key();}
    updateNotice();renderGuide();renderBoard();
  }
  function submitted(){clearTimeout(timer);pending=null;basisRevision=null;try{localStorage.removeItem(key());}catch{}updateNotice();}
  function renderGuide(){
    if(!state.detail)return;
    const d=state.detail,photos=d.assets.filter(a=>a.kind==='photo').length,open=state.draft.filter(n=>!closed(n)).length;
    let title,text,pane,focus,label;
    if(!canEdit()){title='当前为只读档案';text='可以查看照片、模型、复核问题并导出报告。';pane='review';label='查看复核结果';}
    else if(!photos){title='下一步：上传采集照片';text='在采集管理中上传照片，也可同时上传已有的 .splat 模型。';pane='capture';focus='asset-file';label='去上传资料';}
    else if(!d.capture?.confirmed){title='下一步：确认采集批次';text='已上传 '+photos+' 张照片，请核对拍摄范围和质量提示后确认。';pane='capture';focus='capture-confirmed';label='检查采集资料';}
    else if(!d.versions.length){title='下一步：登记重建版本';text='关联已有模型，记录训练信息，再开始复核。';pane='result';focus='version-label';label='登记版本';}
    else if(state.dirty){title='下一步：提交复核修改';text='本页有尚未提交服务器的复核问题。';pane='review';focus='save-notes';label='检查并提交';}
    else if(open){title='还有 '+open+' 个问题未闭环';text='按负责人或关键词找到问题，再查看原照片处理。';pane='review';focus='board-query';label='查看待处理问题';}
    else if(d.acceptance?.status!=='验收通过'){title='下一步：填写验收结论';text='请结合照片和模型确认结果，选择验收版本并保存结论。';pane='review';focus='acceptance-status';label='填写结论';}
    else {title='可以准备交付';text='导出复核报告，或生成只读链接交给查看人员。';pane='info';focus='print-record';label='导出与分享';}
    $('next-step-title').textContent=title;$('next-step-text').textContent=text;$('next-step-action').textContent=label;
    $('next-step-action').onclick=()=>{showPane(pane);if(focus==='board-query'){board.open=true;$('board-status').value='open';renderBoard();}requestAnimationFrame(()=>{const field=$(focus);field?.scrollIntoView({block:'center',behavior:'smooth'});field?.focus({preventScroll:true});});};
  }
  function renderBoard(){
    if(!state.detail)return;
    const query=$('board-query').value.trim().toLowerCase(),filter=$('board-status').value,assets=new Map(state.detail.assets.map(a=>[a.id,a]));
    const notes=state.draft.filter(n=>{
      const data=parseIssue(n);
      return (filter==='all'||filter==='open'&&!closed(n)||filter==='closed'&&closed(n)||filter==='unassigned'&&!data.owner.trim())&&[issueNumber(n),n.note,assets.get(n.asset_id)?.name].join(' ').toLowerCase().includes(query);
    });
    $('board-count').textContent=state.draft.length;$('board-result').textContent=notes.length?'找到 '+notes.length+' 个问题':'没有符合条件的问题。可更换筛选条件，或在照片上添加问题。';
    $('board-list').replaceChildren();
    for(const n of notes){
      const data=parseIssue(n),row=el('div',undefined,'board-row'),info=el('div');
      info.append(el('strong',issueNumber(n)+' · '+n.status),el('p',data.description||'尚未填写说明'),el('small',(data.owner||'待分配')+' · '+data.severity+' · '+(assets.get(n.asset_id)?.name||'照片不可用')));
      const b=el('button',canEdit()?'定位并编辑':'查看原照片');b.type='button';b.onclick=()=>run(async()=>{const asset=assets.get(n.asset_id);if(!asset)throw Error('原照片已不存在。');await chooseAsset(asset);selectNote(n.id);$('asset-area').scrollIntoView({block:'start',behavior:'smooth'});});
      row.append(info,b);$('board-list').append(row);
    }
    renderGuide();
  }
  $('board-query').addEventListener('input',renderBoard);$('board-status').addEventListener('change',renderBoard);
  $('save-local-draft').onclick=()=>run(()=>persist(true));
  $('restore-local-draft').onclick=$('draft-resume').onclick=()=>run(()=>restore(read()));
  $('draft-discard').onclick=()=>run(()=>{if(!confirm('删除当前项目的本机草稿？保留本页内容和服务器记录。'))return;clearTimeout(timer);pending=null;localStorage.removeItem(key());updateNotice();});
  $('draft-import-button').onclick=()=>$('draft-import-file').click();
  $('draft-import-file').onchange=()=>run(async()=>{
    const file=$('draft-import-file').files[0];$('draft-import-file').value='';if(!file)return;
    const context=key();if(file.size>4*1024*1024)throw Error('草稿文件不能超过4MB。');
    let saved;try{saved=JSON.parse(await file.text());}catch{throw Error('请选择有效的JSON草稿文件。');}
    if(context!==key())throw Error('项目已切换，请重新选择草稿。');
    if(!['cw-depthgs-cloud-export/v2','cw-depthgs-review-draft/v1'].includes(saved.schema)||!saved.project?.id)throw Error('请选择从本站下载的档案或草稿文件。');
    await restore(saved);
  });
  $('asset-file').addEventListener('change',()=>{
    const files=[...$('asset-file').files],total=files.reduce((n,f)=>n+f.size,0),errors=[];
    for(const f of files){const model=/\.splat$/i.test(f.name),photo=/\.(jpe?g|png|webp)$/i.test(f.name);if(!model&&!photo)errors.push(f.name+'：格式不支持，模型请先转换为标准 .splat');else if(!f.size)errors.push(f.name+'：文件为空');else if(f.size>(model?100:20)*1048576)errors.push(f.name+'：超过大小限制');}
    upload.textContent=files.length?'已选 '+files.length+' 个文件，共 '+(total/1048576).toFixed(1)+' MB。'+(errors.length?errors.join('；'):'格式及大小检查通过，点击“上传到项目”开始。'):'';upload.classList.toggle('error',!!errors.length);
  });
  window.addEventListener('pagehide',()=>persist());
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')persist();});
  return {changed,accepted,submitted,renderBoard,persist};
}
