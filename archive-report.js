// Build a printable snapshot from saved project data. Credentials stay in fetch headers.
export async function renderArchiveReport({snapshot,base,id,headers,parseIssue,issueNumber,message}) {
  const win=window.open('','_blank');
  if(!win)throw Error('请允许本站打开报告窗口。');
  const doc=win.document,urls=[],controller=new AbortController();
  win.addEventListener('beforeunload',()=>{controller.abort();urls.forEach(URL.revokeObjectURL);});
  doc.title=snapshot.project.name+' 建筑外观复核报告';doc.documentElement.lang='zh-CN';
  const add=(tag,text,cls)=>{const n=doc.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
  const style=add('style',`
    *{box-sizing:border-box}body{font:14px/1.7 "Microsoft YaHei",sans-serif;color:#272a20;max-width:850px;margin:28px auto;padding:0 20px}
    h1,h2,h3{overflow-wrap:anywhere;font-family:SimSun,serif;line-height:1.4;break-after:avoid}h1{font-size:27px}h2{font-size:20px;margin:20px 0 12px}h3{font-size:16px;margin:0 0 9px}
    p{white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0;orphans:3;widows:3}.muted{color:#64695a;font-size:12px}
    .toolbar{padding:14px;background:#edf0e1;border-radius:9px;margin-bottom:22px}button{font:inherit;padding:8px 18px;border:0;border-radius:20px;background:#596447;color:white;cursor:pointer}
    table{border-collapse:collapse;width:100%;margin:12px 0;font-size:12px;table-layout:fixed}th,td{border:1px solid #cdd2c2;padding:7px;text-align:left;overflow-wrap:anywhere}th{background:#edf0e1}tr{break-inside:avoid}
    .photo-section{margin-top:28px}.photo-stage{position:relative;max-width:100%;margin:12px auto;break-inside:avoid}.photo-stage img{width:100%;height:auto;display:block}
    .mark{position:absolute;transform:translate(-50%,-50%);border-radius:50%;background:#a84022;color:#fff;text-align:center;width:22px;height:22px;font:600 12px/22px sans-serif;border:1px solid #fff}
    .issue{border-top:1px solid #cdd2c2;padding:12px 0;break-inside:avoid}.issue-meta{font-size:12px;color:#596447}
    @page{size:A4;margin:14mm} @media print{body{margin:0;padding:0;max-width:none;font-size:11px;line-height:1.65}.toolbar{display:none}h1{font-size:23px}h2{font-size:18px}h3{font-size:13px}.photo-section{break-before:page;margin-top:0}.muted,table,.issue-meta{font-size:10px}}
  `);doc.head.append(style);
  const toolbar=add('div',undefined,'toolbar'),button=add('button','正在准备图片…');button.disabled=true;toolbar.append(button,add('p','打印窗口中选择“另存为 PDF”。','muted'));doc.body.append(toolbar);
  doc.body.append(add('h1','建筑外观复核报告'),add('h2',snapshot.project.name),add('p','采集日期：'+(snapshot.project.capture_date||'未填写')+'　档案版本：'+snapshot.project.revision),add('p','导出时间：'+new Date().toLocaleString('zh-CN'),'muted'));
  if(snapshot.project.description)doc.body.append(add('p',snapshot.project.description));
  const cap=snapshot.capture||{},acc=snapshot.acceptance||{},photos=snapshot.assets.filter(a=>a.kind==='photo'),models=snapshot.assets.filter(a=>a.kind==='model');
  const versionName=id=>snapshot.versions.find(v=>v.id===id)?.label||(id?'关联版本已移除':'未关联版本');
  const assetName=id=>snapshot.assets.find(a=>a.id===id)?.name||(id?'关联照片已移除':'未关联照片');
  const table=(head,rows)=>{const t=add('table'),thead=add('thead'),tr=add('tr');head.forEach(v=>tr.append(add('th',v)));thead.append(tr);t.append(thead);const body=add('tbody');rows.forEach(row=>{const r=add('tr');row.forEach(v=>r.append(add('td',String(v))));body.append(r);});t.append(body);return t;};
  doc.body.append(add('h2','采集与验收'),table(['项目阶段','采集地点','负责人','采集确认'],[[snapshot.stage.label,cap.location||'未填写',cap.operator||'未填写',cap.confirmed?'已确认':'待确认']]),add('p','目标视角：'+(cap.target_views||'未填写')+'　项目照片：'+photos.length+' 张　模型：'+models.length+' 个'));
  if(cap.notes)doc.body.append(add('p','现场说明：'+cap.notes));
  doc.body.append(add('p','验收状态：'+(acc.status||'待复核')+'　验收版本：'+(acc.version_label||versionName(acc.version_id))),add('p','验收结论：'+(acc.conclusion||'待填写')));
  if(snapshot.versions.length){
    doc.body.append(add('h2','重建版本'),table(['版本 / 方法','关联模型','图像质量指标'],snapshot.versions.map(v=>[v.label+' / '+v.method,snapshot.assets.find(a=>a.id===v.model_asset_id)?.name||v.model_name||'未关联模型',['psnr','ssim','lpips'].filter(k=>v[k]!=null).map(k=>k.toUpperCase()+' '+v[k]).join(' / ')||'未填写'])));
  }
  const total=snapshot.annotations.length,closed=snapshot.annotations.filter(n=>['已解决','已验收','已复核'].includes(n.status)).length;
  doc.body.append(add('h2','复核汇总'),add('p','共 '+total+' 个问题，已闭环 '+closed+' 个，待处理 '+(total-closed)+' 个。'));
  if(snapshot.analysis){doc.body.append(add('h2',snapshot.analysis.engine==='本地规则'?'项目检查结果':'AI 项目分析'));snapshot.analysis.sections.forEach(s=>doc.body.append(add('h3',s.title),add('p',s.text)));}
  let failed=0;
  for(const asset of photos){
    if(win.closed)break;
    const section=add('section',undefined,'photo-section');section.append(add('h2',asset.name));
    const notes=snapshot.annotations.filter(n=>n.asset_id===asset.id);
    if(asset.quality?.warnings?.length)section.append(add('p','照片检查提示：'+asset.quality.warnings.join('；'),'muted'));
    try{
      const timeout=setTimeout(()=>controller.abort(),30000);let res,blob;
      try{res=await fetch(base+'/api/projects/'+encodeURIComponent(id)+'/assets/'+encodeURIComponent(asset.id)+'/file',{headers,signal:controller.signal,referrerPolicy:'no-referrer'});if(!res.ok)throw Error();blob=await res.blob();}finally{clearTimeout(timeout);}
      const url=URL.createObjectURL(blob);urls.push(url);const img=add('img');img.src=url;img.alt=asset.name;await img.decode();
      const stage=add('div',undefined,'photo-stage');stage.style.width=Math.min(182,img.naturalWidth/img.naturalHeight*116)+'mm';stage.append(img);
      notes.forEach((n,i)=>{const mark=add('span',String(i+1),'mark');mark.style.left=n.x*100+'%';mark.style.top=n.y*100+'%';stage.append(mark);});section.append(stage);
    }catch{if(win.closed)break;failed++;section.append(add('p','图片加载失败：'+asset.name));}
    if(!notes.length)section.append(add('p','本照片未登记复核问题。','muted'));
    notes.forEach((n,i)=>{
      const data=parseIssue(n),issue=add('div',undefined,'issue');issue.append(add('h3',(i+1)+'. '+issueNumber(n)+' · '+n.status),add('p',(n.category||'模型局部缺陷')+'　'+data.severity+'　负责人：'+(data.owner||'待分配'),'issue-meta'),add('p','关联版本：'+versionName(data.version)+'　整改照片：'+assetName(data.remedy),'issue-meta'),add('p','问题说明：'+(data.description||'待填写')));
      if(data.action)issue.append(add('p','处理记录：'+data.action));if(data.conclusion)issue.append(add('p','复核结论：'+data.conclusion));section.append(issue);
    });doc.body.append(section);
  }
  if(win.closed){urls.forEach(URL.revokeObjectURL);return;}
  button.disabled=!!failed;button.textContent=failed?'图片加载失败，请关闭后重新导出':'打印 / 保存为 PDF';button.onclick=()=>win.print();
  message(failed?'有 '+failed+' 张照片加载失败，请重新导出报告。':'报告已生成，在打印窗口选择“另存为 PDF”。',!!failed);
  if(!failed)setTimeout(()=>{if(!win.closed)win.print();},180);
}
