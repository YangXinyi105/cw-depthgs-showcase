// Opt-in integration test: uses the real API and a dedicated test project.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
if(process.env.ALLOW_LIVE_TESTS!=='1')throw Error('Set ALLOW_LIVE_TESTS=1 to create or update the dedicated test project.');
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=fileURLToPath(new URL('../',import.meta.url)),site='https://yangxinyi105.github.io/cw-depthgs-showcase/';
const output=process.env.QA_OUTPUT||'E:/CW-DepthGS/submission/项目档案功能测试交接包/03_测试产物/全流程验证_20261104';
fs.mkdirSync(output,{recursive:true});
const stateFile=path.join(output,'test-state.json');
const checkpoint=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile,'utf8')):{};
if(!process.env.CW_KEY_FILE)throw Error('Set CW_KEY_FILE to your local administrator-key file.');
const key=fs.readFileSync(process.env.CW_KEY_FILE,'utf8').trim();
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1440,height:1100},acceptDownloads:true});
const page=await context.newPage(),steps=[],errors=[],responses=[];let failure=null;
page.setDefaultTimeout(30000);page.on('dialog',d=>d.accept());
page.on('pageerror',e=>errors.push(e.message));
page.on('response',async r=>{if(r.url().startsWith('https://82.157.170.238/api/')&&r.status()>=400)responses.push({path:new URL(r.url()).pathname,status:r.status(),body:(await r.text()).slice(0,1500)});});
if(process.env.QA_LOCAL!=='0')await context.route(site+'**',async route=>{
  const name=decodeURIComponent(new URL(route.request().url()).pathname.replace('/cw-depthgs-showcase/',''))||'index.html';
  const file=path.resolve(root,name);if(!file.startsWith(root)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.continue();
  const ext=path.extname(file),types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.woff2':'font/woff2','.svg':'image/svg+xml'};
  await route.fulfill({contentType:types[ext]||'application/octet-stream',body:fs.readFileSync(file)});
});
// Capture the print invocation, then produce the same printable document with Chromium.
await context.addInitScript(()=>{window.print=()=>{window.__printCalled=true;};});
const log=(name,extra={})=>{steps.push({name,status:'PASS',...extra});console.log('PASS '+name);};
const api=async(suffix='',method='GET',body)=>{
  const result=await page.evaluate(async({id,suffix,method,body})=>{
    const base=window.CW_SERVICE_API,key=sessionStorage.getItem('cw:admin:'+base);
    const r=await fetch(base+'/api/projects/'+id+suffix,{method,headers:{'X-Admin-Key':key,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
    return {status:r.status,data:await r.json()};
  },{id:checkpoint.id,suffix,method,body});
  assert.equal(result.status,200,'API '+suffix+' '+JSON.stringify(result.data));return result.data;
};
async function tab(name){await page.getByRole('tab',{name,exact:true}).click();}
async function submit(form,suffix){
  const response=page.waitForResponse(r=>r.url().includes('/api/projects/')&&r.url().endsWith(suffix)&&['PUT','POST','PATCH'].includes(r.request().method()));
  await page.locator(form+' button[type=submit]').click();const r=await response;
  assert(r.ok(),await r.text());await page.waitForFunction(()=>!document.getElementById('main').inert);
}
async function download(button,name){const event=page.waitForEvent('download');await page.locator(button).click();const d=await event;await d.saveAs(path.join(output,name));assert.equal(await d.failure(),null);return path.join(output,name);}
try{
  await page.goto(site+'archive.html?qa=full-flow',{waitUntil:'domcontentloaded'});
  await page.locator('#api-base').fill('https://82.157.170.238');await page.locator('#admin-key').fill(key);
  await page.locator('#toggle-admin-key').click();assert.equal(await page.locator('#admin-key').getAttribute('type'),'text');await page.locator('#toggle-admin-key').click();
  await page.locator('#connect-form button[type=submit]').click();await page.locator('#project-list-panel').waitFor({state:'visible'});log('真实服务连接与密钥显隐');
  if(!checkpoint.id){
    await page.getByText('新建建筑档案',{exact:true}).click();await page.locator('#new-name').fill('全流程验证-4906981-20261104');await page.locator('#new-date').fill('2026-11-04');
    await page.locator('#new-description').fill('项目档案全流程测试，使用建筑4906981公开演示资料。');
    const created=page.waitForResponse(r=>r.url()==='https://82.157.170.238/api/projects'&&r.request().method()==='POST');
    await page.locator('#create-form button').click();const r=await created;assert.equal(r.status(),201,await r.text());
    checkpoint.id=(await r.json()).project.id;fs.writeFileSync(stateFile,JSON.stringify(checkpoint,null,2));
  }else await page.locator('#project-list .project-row').filter({hasText:'全流程验证-4906981-20261104'}).getByRole('button',{name:'打开',exact:true}).click();
  await page.locator('#project-panel').waitFor({state:'visible'});await page.waitForFunction(()=>!document.getElementById('main').inert);log('新建并打开测试项目',{project:checkpoint.id});
  await tab('项目资料');await page.locator('#actor').fill('全流程测试员');await page.locator('#project-description').fill('建筑4906981档案功能测试：照片、模型、版本、问题复核及报告导出。');await submit('#metadata-form',checkpoint.id);log('保存项目资料');
  await tab('采集管理');await page.locator('#capture-target').fill('3');await page.locator('#capture-location').fill('建筑4906981演示场景');await page.locator('#capture-operator').fill('全流程测试员');await submit('#capture-form','/capture');
  const files=['00000-reference.png','00007-reference.png','00012-reference.png'].map(n=>path.join(root,'assets/cases/4906981',n));
  files.push('E:/CW-DepthGS/img/演示Splat模型/02_4906981_高质量2M_透明度优化.splat');
  let detail=await api();const missing=files.filter(f=>!detail.assets.some(a=>a.name===path.basename(f)));
  if(missing.length){await page.locator('#asset-file').setInputFiles(missing);await page.locator('#upload-form button[type=submit]').click();await page.waitForFunction(()=>!document.getElementById('main').inert&&document.getElementById('cloud-message').textContent.includes('已上传'),{},{timeout:180000});}
  detail=await api();assert(files.every(f=>detail.assets.some(a=>a.name===path.basename(f))));log('上传3张照片和真实Splat模型');
  await page.locator('#capture-confirmed').selectOption('true');await submit('#capture-form','/capture');assert.equal((await api()).capture.confirmed,true);log('采集确认');
  await download('#export-task','重建任务包.zip');await page.waitForFunction(()=>!document.getElementById('main').inert);log('导出重建任务包');
  detail=await api();const model=detail.assets.find(a=>a.name===path.basename(files.at(-1))),photo=detail.assets.find(a=>a.name==='00000-reference.png'),remedy=detail.assets.find(a=>a.name==='00007-reference.png');
  await tab('重建成果');if(!detail.versions.some(v=>v.label==='v2-e2e')){
    await page.locator('#version-label').fill('v2-e2e');await page.locator('#version-model').selectOption(model.id);await page.locator('#version-config').fill('功能验证-已有模型');await submit('#version-form','/versions');
  }
  detail=await api();const version=detail.versions.find(v=>v.label==='v2-e2e');assert(version);log('登记并关联重建版本');
  await tab('复核交付');if(process.env.QA_FAST!=='1'){
  await page.locator('#review-asset').selectOption(model.id);await page.waitForFunction(()=>document.getElementById('asset-loading').textContent.includes('模型已加载'),{},{timeout:180000});
  assert(await page.locator('#cloud-model canvas').count());await page.locator('#reset-model').click();await page.locator('#cloud-model').screenshot({path:path.join(output,'01_3DGS模型.png')});log('3DGS模型加载与重置');
  const canvas=page.locator('#cloud-model canvas').first(),box=await canvas.boundingBox();await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5);await page.mouse.down();await page.mouse.move(box.x+box.width*.65,box.y+box.height*.55,{steps:12});await page.mouse.up();await page.mouse.wheel(0,-100);log('模型旋转与缩放');
  await page.locator('#snapshot-model').click();await page.waitForFunction(()=>!document.getElementById('main').inert&&document.getElementById('cloud-message').textContent.includes('已保存当前视角截图'),{},{timeout:60000});log('模型截图保存为项目照片');
  await page.locator('#review-asset').selectOption(model.id);await page.locator('#model-mode button[data-mode=cloud]').click();await page.waitForFunction(()=>document.getElementById('asset-loading').textContent.includes('模型已加载'),{},{timeout:120000});assert(await page.locator('#cloud-model .cloud-canvas').count());log('点云模式切换');
  }
  await page.locator('#review-asset').selectOption(photo.id);await page.locator('#add-note').waitFor({state:'visible'});
  detail=await api();const existing=detail.annotations.find(n=>n.note.includes('檐口遮挡复核'));
  if(existing)await page.locator('#cloud-notes li').filter({hasText:'檐口遮挡复核'}).getByRole('button',{name:'编辑',exact:true}).click();else await page.locator('#add-note').click();
  await page.locator('#note-text').fill('檐口遮挡复核\n核对原照片与重建视角，记录可见范围。');await page.locator('#note-owner').fill('全流程测试员');await page.locator('#note-category').selectOption('建议补拍');await page.locator('#note-severity').selectOption('重要');await page.locator('#note-status').selectOption('处理中');await page.locator('#note-version').selectOption(version.id);
  await page.waitForFunction(()=>document.getElementById('dirty-state').textContent.includes('已保存到本机'));await download('#download-draft','复核草稿.json');log('添加问题、多行说明、自动草稿与下载');
  await page.reload({waitUntil:'domcontentloaded'});await page.locator('#project-list-panel').waitFor({state:'visible'});await page.locator('#project-list .project-row').filter({hasText:'全流程验证-4906981-20261104'}).getByRole('button',{name:'打开',exact:true}).click();await page.locator('#draft-resume').waitFor({state:'visible'});await page.locator('#draft-resume').click();
  await page.locator('.issue-board summary').click();await page.locator('#board-query').fill('檐口遮挡复核');await page.locator('#board-list button').click();await page.locator('#note-form').waitFor({state:'visible'});assert((await page.locator('#note-text').inputValue()).includes('\n'));log('刷新恢复与问题定位');
  await page.locator('#note-remedy-photo').selectOption(remedy.id);await page.locator('#note-action').fill('已检查相邻视角照片\n标记处可通过对照照片补充核对。');await page.locator('#note-conclusion').fill('照片与模型对应位置已复核，完成本次流程验证。');await page.locator('#note-status').selectOption('已验收');
  const saved=page.waitForResponse(r=>r.url().endsWith('/annotations')&&r.request().method()==='PUT');await page.locator('#save-notes').click();const savedResponse=await saved;assert(savedResponse.ok(),await savedResponse.text());await page.waitForFunction(()=>!document.getElementById('main').inert);log('问题闭环保存到真实服务器');
  await page.locator('#acceptance-version').selectOption(version.id);await page.locator('#acceptance-status').selectOption('验收通过');await page.locator('#acceptance-conclusion').fill('本次档案功能验证通过：照片、模型、复核问题和处理记录齐全。');await submit('#acceptance-form','/acceptance');log('保存验收结论');
  await page.locator('#reload-project').click();await page.waitForFunction(()=>document.getElementById('cloud-message').textContent.includes('最新记录'));detail=await api();assert.equal(detail.acceptance.status,'验收通过');assert(detail.annotations.some(n=>n.status==='已验收'&&n.note.includes(remedy.id)));log('刷新后核对持久化结果');
  await tab('项目资料');await download('#download-record','项目档案.json');
  const popup=context.waitForEvent('page');await page.locator('#print-record').click();const report=await popup;await report.waitForFunction(()=>window.__printCalled===true,{},{timeout:90000});
  assert.equal(await report.locator('img').count(),detail.assets.filter(a=>a.kind==='photo').length);assert((await report.locator('body').innerText()).includes('本次档案功能验证通过'));
  await report.pdf({path:path.join(output,'建筑外观复核报告.pdf'),format:'A4',printBackground:true,preferCSSPageSize:true});await report.screenshot({path:path.join(output,'02_报告页面.png'),fullPage:true});log('导出档案JSON及PDF报告');
  await page.locator('#share-project').click();await page.locator('#share-url').waitFor({state:'visible'});const share=await page.locator('#share-url').inputValue();
  const reader=await context.newPage();await reader.goto(share);await reader.locator('#project-panel').waitFor({state:'visible'});await reader.getByRole('tab',{name:'复核交付',exact:true}).click();assert.equal(await reader.locator('#save-notes').isVisible(),false);assert.equal(await reader.locator('#add-note').isVisible(),false);
  const readResult=await reader.evaluate(async()=>{const p=new URLSearchParams(location.hash.slice(1)),url=p.get('api')+'/api/projects/'+p.get('project'),headers={Authorization:'Bearer '+p.get('share'),'Content-Type':'application/json'};const saved=await (await fetch(url,{headers})).json();const r=await fetch(url+'/annotations',{method:'PUT',headers,body:JSON.stringify({revision:saved.project.revision,actor:'只读权限测试',annotations:saved.annotations})});return {status:r.status,body:await r.text()};});assert.equal(readResult.status,403,readResult.body);log('只读分享访问及服务端禁止写入');
  await page.getByRole('tab',{name:'修改记录',exact:true}).click();await page.locator('.pane[data-pane=history] summary').click();assert(await page.locator('#project-history li').count()>5);log('修改记录追溯');
  await page.screenshot({path:path.join(output,'03_完成后的项目档案.png')});assert.deepEqual(errors,[]);log('页面脚本无异常');
}catch(error){
  failure=String(error.message).replaceAll(key,'[REDACTED]');
  await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});
  console.error(String(error.message).replaceAll(key,'[REDACTED]'));process.exitCode=1;
}finally{
  fs.writeFileSync(path.join(output,'checks.json'),JSON.stringify({projectId:checkpoint.id,mode:process.env.QA_LOCAL==='0'?'public':'local-frontend-real-api',modelCheck:process.env.QA_FAST==='1'?'skipped':'included',steps,errors,responses,failure},null,2));
  await browser.close();
}
