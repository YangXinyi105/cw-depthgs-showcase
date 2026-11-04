import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=fileURLToPath(new URL('../',import.meta.url));
const server=http.createServer((req,res)=>{try{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(pathname==='/test.html'){res.setHeader('Content-Type','text/html');return res.end('<div id="viewer" style="width:640px;height:420px"></div>');}const file=path.join(root,pathname);res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':'application/octet-stream');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-unsafe-swiftshader']});
try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/test.html');
  const result=await page.evaluate(async()=>{
    const {mountSplatViewer}=await import('/viewer.js'),{readGaussians,convert}=await import('/cloud-convert.js');
    const container=document.getElementById('viewer'),count=8000,bytes=new Uint8Array(count*32),view=new DataView(bytes.buffer);
    for(let i=0;i<count;i++){const o=i*32;[i%40/20,Math.floor(i/40)%20/20,Math.floor(i/800)/10,.025,.025,.025].forEach((n,k)=>view.setFloat32(o+k*4,n,true));bytes.set([130,90,60,2,255,128,128,128],o+24);}
    const blob=new Blob([bytes]),url=URL.createObjectURL(blob),g=await readGaussians(blob,'low-alpha.splat'),cloud=convert(g);if(cloud.count<1000)throw Error('Low-opacity conversion failed');
    let viewer=await mountSplatViewer(container,{url});const loaded=viewer.count;await viewer.dispose();
    for(let i=0;i<3;i++){
      const controller=new AbortController();let scheduled=false;
      try{viewer=await mountSplatViewer(container,{url,signal:controller.signal,onProgress:p=>{if(p.stage==='preparing'&&!scheduled){scheduled=true;setTimeout(()=>controller.abort(),0);}}});await viewer.dispose();}catch(e){if(e.name!=='AbortError')throw e;}
    }
    viewer=await mountSplatViewer(container,{url});await viewer.dispose();URL.revokeObjectURL(url);
    for(let i=0;i<count;i++)bytes[i*32+27]=0;
    const emptyURL=URL.createObjectURL(new Blob([bytes]));let rejected=false;
    try{await mountSplatViewer(container,{url:emptyURL});}catch(e){rejected=e.message.includes('透明');}URL.revokeObjectURL(emptyURL);
    await new Promise(resolve=>setTimeout(resolve,150));return {loaded,cloud:cloud.count,rejected,canvases:container.querySelectorAll('canvas').length};
  });
  assert.equal(result.loaded,8000);assert(result.rejected);assert.equal(result.canvases,0);assert.deepEqual(errors,[]);console.log('PASS: low-opacity 3DGS/cloud, fully transparent rejection, cancel/reopen, cleanup and no unhandled errors.');
}finally{await browser.close();server.close();}
