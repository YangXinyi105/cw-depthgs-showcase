import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=fileURLToPath(new URL('../',import.meta.url));
const server=http.createServer((req,res)=>{try{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);const f=path.join(root,pathname);res.setHeader('Content-Type',f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':f.endsWith('.png')?'image/png':'text/html');res.end(fs.readFileSync(f));}catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
  const id='a'.repeat(32),now=new Date().toISOString();
  let detail={role:'edit',project:{id,name:'体验回归测试',capture_date:'2026-11-04',revision:1,updated_at:now},stage:{label:'待复核',index:4,steps:['待采集','已采集','重建中','待复核','已交付']},assets:[{id:'p1',name:'正面.png',kind:'photo',size:500},{id:'p2',name:'背面.png',kind:'photo',size:500}],capture:{confirmed:true,target_views:2},versions:[{id:'v1',label:'v1',method:'CW-DepthGS',status:'待复核',psnr:null,ssim:null,lpips:null,train_seconds:null}],acceptance:{status:'待复核'},annotations:[{id:'11111111-1111',asset_id:'p2',x:.5,y:.5,note:'旧版普通备注\n第二行',status:'待复核'}],history:[],analysis:null};
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',d=>d.accept());let conflict=false,uploadRequests=0,writeRequests=0;
  const image=fs.readFileSync(path.join(root,'assets/cases/4906981/00000-reference.png'));
  await page.route('https://test.invalid/**',async route=>{
    const req=route.request();if(req.url().endsWith('/file'))return route.fulfill({contentType:'image/png',body:image});
    if(req.method()==='PUT'){
      writeRequests++;
      if(conflict)return route.fulfill({status:409,json:{detail:'conflict'}});
      detail.annotations=req.postDataJSON().annotations;detail.project.revision++;
    }
    if(req.method()==='POST')uploadRequests++;
    await route.fulfill({json:{...detail,role:req.headers().authorization==='Bearer reader'?'read':'edit'}});
  });
  const url=base+'/archive.html#api=https://test.invalid&project='+id+'&edit=test-token';
  await page.goto(url);await page.locator('#project-panel').waitFor({state:'visible'});
  await page.getByRole('tab',{name:'复核交付',exact:true}).click();
  await page.locator('#add-note').click();
  await page.locator('#note-text').fill('檐口需要补拍\n第二行说明\n负责人：这里是描述文字');
  await page.locator('#note-owner').fill('测试小王');
  await page.waitForFunction(()=>document.getElementById('dirty-state').textContent.includes('已保存到本机'));
  const stored=await page.evaluate(()=>Object.entries(localStorage).filter(([key])=>key.startsWith('cw:review-draft:')));
  assert.equal(stored.length,1);assert(!stored[0][1].includes('test-token'));
  await page.reload();await page.locator('#draft-resume').waitFor({state:'visible'});await page.locator('#draft-resume').click();
  await page.locator('.issue-board summary').click();await page.locator('#board-query').fill('测试小王');
  assert.equal(await page.locator('#board-list .board-row').count(),1);
  const number=(await page.locator('#board-list strong').innerText()).split(' · ')[0];
  await page.locator('#board-list button').click();
  await page.locator('#note-form').waitFor({state:'visible'});
  assert.equal(await page.locator('#note-text').inputValue(),'檐口需要补拍\n第二行说明\n负责人：这里是描述文字');
  // The real service limits the whole serialized record to 2000 characters.
  await page.locator('#note-text').fill('测'.repeat(1200));await page.locator('#note-action').fill('记'.repeat(800));
  const writesBefore=writeRequests;await page.locator('#save-notes').click();assert.equal(writeRequests,writesBefore);
  assert.equal(await page.locator('#note-text').evaluate(n=>n.checkValidity()),false);
  await page.locator('#note-text').fill('檐口需要补拍\n第二行说明\n负责人：这里是描述文字');await page.locator('#note-action').fill('');
  assert.equal(await page.locator('#note-text').evaluate(n=>n.checkValidity()),true);
  // Direct server save also commits the active editor after normal form validation.
  await page.locator('#save-notes').click();
  await page.getByText('标注已保存到服务器，其他成员刷新即可查看。',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('cw:review-draft:')).length),0);
  await page.locator('#board-query').fill('旧版');await page.locator('#board-list button').click();
  await page.locator('#note-form').waitFor({state:'visible'});
  await page.locator('#cloud-notes').getByRole('button',{name:'删除',exact:true}).click();
  await page.locator('#board-query').fill('测试小王');assert.equal((await page.locator('#board-list strong').innerText()).split(' · ')[0],number);
  // A rejected import cannot change current notes or remove the saved draft.
  await page.locator('#draft-import-file').setInputFiles({name:'foreign.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({schema:'cw-depthgs-cloud-export/v2',project:{id:'b'.repeat(32)},annotations:[]}))});
  await page.getByText('这份草稿属于另一个项目，请打开对应项目后导入。',{exact:true}).waitFor();
  assert.equal(await page.locator('#board-count').innerText(),'1');
  conflict=true;await page.locator('#save-notes').click();await page.waitForFunction(()=>document.getElementById('cloud-message').textContent.includes('其他成员'));
  assert.equal(await page.locator('#board-count').innerText(),'1');
  conflict=false;
  // Valid portable draft import, including project matching and existing photo validation.
  await page.locator('#draft-import-file').setInputFiles({name:'draft.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({schema:'cw-depthgs-cloud-export/v2',project:{id,revision:detail.project.revision},annotations:detail.annotations}))});
  await page.getByText('草稿已恢复，请核对后提交服务器。',{exact:true}).waitFor();
  assert.equal(await page.locator('#board-count').innerText(),'2');
  await page.locator('.issue-board').scrollIntoViewIfNeeded();
  await page.screenshot({path:process.env.TEMP+'/archive-usability-edit.png'});
  await page.getByRole('tab',{name:'采集管理',exact:true}).click();
  await page.locator('#asset-file').setInputFiles({name:'model.ply',mimeType:'application/octet-stream',buffer:Buffer.from('ply\n')});
  assert.match(await page.locator('#upload-check').innerText(),/格式不支持/);assert.equal(uploadRequests,0);
  // Read-only projects never offer local draft editing or an editable issue form.
  await page.goto(base+'/archive.html#api=https://test.invalid&project='+id+'&share=reader');
  await page.waitForFunction(()=>!document.getElementById('main').inert&&document.getElementById('access-mode').textContent.includes('只读'));
  await page.locator('#project-panel').waitFor({state:'visible'});assert.equal(await page.locator('.draft-tools').isVisible(),false);
  await page.getByRole('tab',{name:'复核交付',exact:true}).click();assert.equal(await page.locator('#note-form').isVisible(),false);
  await page.setViewportSize({width:390,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'mobile horizontal overflow');
  await page.screenshot({path:process.env.TEMP+'/archive-usability-mobile.png',fullPage:true});
  await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:process.env.TEMP+'/archive-usability-desktop.png',fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('PASS: auto-save/reload, multiline restore, issue search/location, stable IDs, server save/conflict, portable import/project validation, upload preflight, read-only and mobile layout.');
}finally{await browser.close();server.close();}
