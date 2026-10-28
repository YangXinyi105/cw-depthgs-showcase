/* Standard .splat and vetted KSplat renderer. The caller owns input object URLs. */
const MAX_BYTES = 100 * 1024 * 1024;
const mounted = new WeakMap();

function checkedURL(value) {
  const url = new URL(value, document.baseURI);
  if (url.protocol === 'blob:' && url.origin === location.origin) return url.href;
  if (['http:', 'https:'].includes(url.protocol) && url.origin === location.origin) return url.href;
  throw new Error('模型地址必须是本站文件或当前页面创建的本地文件地址。');
}

async function readModel(url, signal, onProgress, format = 'splat') {
  const response = await fetch(url, {signal});
  if (!response.ok) throw new Error('模型读取失败（' + response.status + '）。');
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_BYTES) throw new Error('模型文件超过100 MB，请先导出较小的展示版本。');
  if (!response.body) throw new Error('浏览器无法读取模型数据。');
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  try {
    while (true) {
      const {value, done} = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error('模型文件超过100 MB。');
      chunks.push(value);
      onProgress?.({stage:'reading', percent:declared ? Math.min(100, Math.round(size / declared * 100)) : null, bytes:size});
    }
  } catch (error) { await reader.cancel().catch(()=>{}); throw error; }
  if (!size || (format === 'splat' && size % 32)) throw new Error('文件不是完整的标准 .splat 模型。');
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

function inspectModel(bytes) {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = bytes.byteLength / 32; const stride = Math.max(1, Math.floor(count / 40000));
  const axes = [[], [], []]; let visible = 0;
  for (let i = 0; i < count; i++) {
    const p = i * 32;
    for (let k = 0; k < 6; k++) {
      const value = data.getFloat32(p + k * 4, true);
      if (!Number.isFinite(value) || Math.abs(value) > 1e9 || (k >= 3 && value <= 0)) throw new Error('模型包含无效位置或尺度数据。');
    }
    if ([28,29,30,31].every(k=>bytes[p+k]===128)) throw new Error('模型包含无效的旋转四元数。');
    if (bytes[p + 27] > 4) {
      visible++;
      if (i % stride === 0) for (let k = 0; k < 3; k++) axes[k].push(data.getFloat32(p + k * 4, true));
    }
  }
  if (!visible) throw new Error('模型中的高斯点均为透明，无法显示。');
  if (!axes[0].length) for (let i = 0; i < count; i++) if (bytes[i * 32 + 27] > 4) { for (let k = 0; k < 3; k++) axes[k].push(data.getFloat32(i * 32 + k * 4, true)); break; }
  // Percentile framing keeps isolated distant floaters from hiding the main scene.
  const lower=[],upper=[];
  for (const axis of axes) { axis.sort((a,b)=>a-b); lower.push(axis[Math.floor((axis.length-1)*.02)]); upper.push(axis[Math.ceil((axis.length-1)*.98)]); }
  const center = lower.map((x,i)=>(x+upper[i])/2);
  const radius = Math.max(.1, Math.hypot(...lower.map((x,i)=>upper[i]-x)) / 2);
  return {count, center, radius};
}

function inspectKSplat(bytes, GS) {
  if(bytes.byteLength < 5120) throw new Error('KSplat文件不完整。');
  const data=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const sections=data.getUint32(4,true), count=data.getUint32(12,true), compression=data.getUint16(20,true);
  if(data.getUint8(0)!==0||data.getUint8(1)!==1||sections<1||sections>1024||data.getUint32(8,true)!==sections||count<1||count>4500000||data.getUint32(16,true)!==count||compression>2||4096+sections*1024>bytes.byteLength)throw new Error('不支持的KSplat头信息。');
  let total=0,offset=4096+sections*1024;
  for(let s=0;s<sections;s++){
    const p=4096+s*1024,n=data.getUint32(p+4,true),degree=data.getUint16(p+40,true);
    if(degree>2||n>count||data.getUint32(p,true)!==n)throw new Error('KSplat分段信息错误。');
    const per=GS.SplatBuffer.CompressionLevels[compression].SphericalHarmonicsDegrees[degree].BytesPerSplat;
    const buckets=data.getUint32(p+12,true),full=data.getUint32(p+32,true),partial=data.getUint32(p+36,true),bucketSize=data.getUint32(p+8,true);
    const bucketBytes=compression?12*buckets+4*partial:0;
    if(offset+bucketBytes+n*per>bytes.byteLength)throw new Error('KSplat数据长度错误。');
    if(compression){
      const block=data.getFloat32(p+16,true);
      if(buckets!==full+partial||!bucketSize||!Number.isFinite(block)||block<=0||data.getUint16(p+20,true)!==12)throw new Error('KSplat空间分块信息错误。');
      let bucketPoints=full*bucketSize;
      for(let i=0;i<partial;i++){const size=data.getUint32(offset+i*4,true);if(size<1||size>bucketSize)throw new Error('KSplat分块长度错误。');bucketPoints+=size;}
      if(bucketPoints!==n)throw new Error('KSplat点数不一致。');
    }
    total+=n;offset+=bucketBytes+n*per;
  }
  if(total!==count||offset!==bytes.byteLength)throw new Error('KSplat数据不完整或带有多余内容。');
  // Inspect section records directly: constructing a second SplatBuffer here
  // would allocate millions of index-map entries before the renderer loads it.
  const layout=GS.SplatBuffer.parseSectionHeaders(GS.SplatBuffer.parseHeader(bytes.buffer),bytes.buffer,4096,true);
  const half=value=>{const sign=value&32768?-1:1,exponent=(value>>10)&31,fraction=value&1023;return exponent===31?(fraction?NaN:sign*Infinity):exponent===0?sign*fraction*2**-24:sign*(1+fraction/1024)*2**(exponent-15);};
  const axes=[[],[],[]],stride=Math.max(1,Math.floor(count/40000));
  for(const section of layout){
    const ends=[];let running=section.fullBucketCount*section.bucketSize;
    for(let p=0;p<section.partiallyFilledBucketCount;p++){running+=data.getUint32(section.base+p*4,true);ends.push(running);}
    for(let i=0;i<section.maxSplatCount;i+=stride){
      const p=section.dataBase+i*section.bytesPerSplat;let bucket=0;
      if(compression){if(i<section.fullBucketCount*section.bucketSize)bucket=Math.floor(i/section.bucketSize);else{let lo=0,hi=ends.length;while(lo<hi){const mid=(lo+hi)>>1;if(ends[mid]<=i)lo=mid+1;else hi=mid;}bucket=section.fullBucketCount+lo;}}
      const pos=[0,1,2].map(k=>compression?(data.getUint16(p+k*2,true)-section.compressionScaleRange)*section.compressionScaleFactor+data.getFloat32(section.bucketsBase+bucket*12+k*4,true):data.getFloat32(p+k*4,true));
      const scale=[0,1,2].map(k=>compression?half(data.getUint16(p+6+k*2,true)):data.getFloat32(p+12+k*4,true));
      const rotation=[0,1,2,3].map(k=>compression?half(data.getUint16(p+12+k*2,true)):data.getFloat32(p+24+k*4,true));
      if(![...pos,...scale,...rotation].every(Number.isFinite)||Math.min(...scale)<0||Math.max(...scale)===0||rotation.reduce((sum,v)=>sum+v*v,0)<1e-8)throw new Error('KSplat包含无效几何数据。');
      if(data.getUint8(p+(compression?23:43))>4)pos.forEach((v,k)=>axes[k].push(v));
    }
  }
  if(!axes[0].length)throw new Error('KSplat中未找到可显示的高斯点。');
  const lower=[],upper=[];
  for(const axis of axes){axis.sort((a,b)=>a-b);lower.push(axis[Math.floor((axis.length-1)*.02)]);upper.push(axis[Math.ceil((axis.length-1)*.98)]);}
  return {count,center:lower.map((x,i)=>(x+upper[i])/2),radius:Math.max(.1,Math.hypot(...lower.map((x,i)=>upper[i]-x))/2),sh:Math.min(...layout.map(s=>s.sphericalHarmonicsDegree))};
}

/** Mount one viewer. Load CSS viewer.css and await dispose() before reusing a container.
 * options.url must be same-origin or a caller-created blob URL; options.signal cancels loading.
 * Returned reset/orbit/zoom/flipUp are keyboard-accessible alternatives to pointer controls.
 */
export async function mountSplatViewer(container, {url, name = '三维模型', onProgress, signal, initialView, format = 'splat'} = {}) {
  if (!(container instanceof HTMLElement)) throw new Error('模型容器不存在。');
  if (mounted.has(container)) throw new Error('请先关闭容器中的上一模型。');
  const task = {}; mounted.set(container, task);
  let renderer, viewer, stage, resize, modelURL, disposed=false, abortListener, disposePromise, rejectLoading;
  const release = () => {
    if (disposePromise) return disposePromise; disposed=true;
    disposePromise=(async()=>{
      signal?.removeEventListener('abort', abortListener);
      resize?.disconnect();
      if (viewer) await viewer.dispose().catch(()=>{});
      renderer?.dispose(); renderer?.forceContextLoss(); stage?.remove();
      if (modelURL) URL.revokeObjectURL(modelURL);
      if (mounted.get(container) === task) mounted.delete(container);
    })();
    return disposePromise;
  };
  try {
    signal?.throwIfAborted();
    if(!['splat','ksplat'].includes(format))throw new Error('不支持的模型格式。');
    const bytes = await readModel(checkedURL(url), signal, onProgress, format);
    const [THREE, GS] = await Promise.all([import('./vendor/three-0.170.0.module.min.js'),import('./vendor/gaussian-splats-3d-0.4.7.module.js')]);
    const info = format==='ksplat'?inspectKSplat(bytes,GS):inspectModel(bytes);
    signal?.throwIfAborted();
    stage = document.createElement('div'); stage.className='splat-surface'; container.append(stage);
    try { renderer = new THREE.WebGLRenderer({antialias:false,alpha:false}); }
    catch(error) { throw new Error('当前浏览器无法启用WebGL 2，请在支持硬件加速的浏览器中打开。'); }
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5)); renderer.setClearColor(0xf8f5ea,1);
    stage.append(renderer.domElement);renderer.domElement.tabIndex=0;renderer.domElement.setAttribute('aria-label',name+'，拖动旋转，滚轮缩放');
    if(initialView && (!['position','target','up'].every(k=>Array.isArray(initialView[k])&&initialView[k].length===3&&initialView[k].every(Number.isFinite))||!Number.isFinite(initialView.fov)||initialView.fov<10||initialView.fov>120))throw new Error('初始相机信息格式错误。');
    const target = new THREE.Vector3(...(initialView?.target||info.center));
    const initial = initialView ? new THREE.Vector3(...initialView.position) : target.clone().add(new THREE.Vector3(1.2,.8,1.8).normalize().multiplyScalar(info.radius*3));
    const initialUp = new THREE.Vector3(...(initialView?.up||[0,1,0])).normalize();
    if(initialUp.lengthSq()<.5||initial.distanceToSquared(target)<1e-8)throw new Error('初始相机方向无效。');
    const camera = new THREE.PerspectiveCamera(initialView?.fov||50,1,Math.max(.001,info.radius/1000),Math.max(100,info.radius*100));
    camera.up.copy(initialUp);camera.position.copy(initial);camera.lookAt(target);
    renderer.setSize(Math.max(1,stage.clientWidth),Math.max(1,stage.clientHeight));
    viewer = new GS.Viewer({rootElement:stage,renderer,camera,initialCameraLookAt:target.toArray(),
      selfDrivenMode:true,useBuiltInControls:true,sharedMemoryForWorkers:false,gpuAcceleratedSort:false,
      integerBasedSort:false,enableSIMDInSort:false,halfPrecisionCovariancesOnGPU:false,
      renderMode:GS.RenderMode.OnChange,sceneRevealMode:GS.SceneRevealMode.Instant,
      sphericalHarmonicsDegree:info.sh||0,logLevel:GS.LogLevel.None});
    // Library keyboard handlers normally attach to window; constrain them to this canvas.
    for (const control of [viewer.perspectiveControls,viewer.orthographicControls]) if(control){control.stopListenToKeyEvents();control.listenToKeyEvents(renderer.domElement);control.minDistance=info.radius*.005;control.maxDistance=info.radius*30;}
    if(viewer.keyDownListener) window.removeEventListener('keydown',viewer.keyDownListener);
    resize = new ResizeObserver(()=>{const w=Math.max(1,stage.clientWidth),h=Math.max(1,stage.clientHeight);renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();viewer.forceRenderNextFrame();}); resize.observe(stage);
    const cancelled=new Promise((_,reject)=>{rejectLoading=reject;});
    abortListener=()=>{rejectLoading?.(new DOMException('模型加载已取消','AbortError'));void release();};signal?.addEventListener('abort',abortListener,{once:true});
    modelURL=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'}));
    onProgress?.({stage:'preparing',percent:null,bytes:bytes.byteLength});
    // The vendor can leave its load promise pending if disposed during worker setup.
    await Promise.race([viewer.addSplatScene(modelURL,{format:format==='ksplat'?GS.SceneFormat.KSplat:GS.SceneFormat.Splat,showLoadingUI:false,progressiveLoad:false,splatAlphaRemovalThreshold:1,
      onProgress:percent=>{if(!disposed&&!signal?.aborted)onProgress?.({stage:'preparing',percent:Number.isFinite(percent)?Math.round(percent):null,bytes:bytes.byteLength});}}),cancelled]);
    rejectLoading=undefined;
    signal?.throwIfAborted(); if(disposed)throw new DOMException('模型加载已取消','AbortError');
    viewer.controls.target.copy(target);viewer.controls.update();viewer.start();
    const update = () => {viewer.controls.update();viewer.forceRenderNextFrame();};
    onProgress?.({stage:'ready',percent:100,count:info.count,bytes:bytes.byteLength});
    return {
      camera, count:info.count,
      reset(){if(disposed)return;camera.up.copy(initialUp);camera.position.copy(initial);viewer.controls.target.copy(target);update();},
      orbit(angle){if(disposed)return;const delta=camera.position.clone().sub(viewer.controls.target);delta.applyAxisAngle(camera.up,angle);camera.position.copy(viewer.controls.target).add(delta);update();},
      zoom(factor){if(disposed||!Number.isFinite(factor)||factor<=0)return;const delta=camera.position.clone().sub(viewer.controls.target).multiplyScalar(factor);delta.clampLength(info.radius*.005,info.radius*30);camera.position.copy(viewer.controls.target).add(delta);update();},
      flipUp(){if(disposed)return;camera.up.multiplyScalar(-1);update();},
      dispose:release
    };
  } catch (error) {await release();throw error;}
}

export function initStandaloneViewer() {
  const input=document.getElementById('model-file'),host=document.getElementById('model-view'),status=document.getElementById('model-status');
  if(!input||!host||!status)return;
  const demo=document.getElementById('model-demo'),light=document.getElementById('model-light');
  // The rail and spin buttons act on a loaded model; the close button also cancels a load in progress.
  const controls=['model-reset','model-near','model-far','model-flip','model-left','model-right'].map(id=>document.getElementById(id)).filter(Boolean);
  const closeButton=document.getElementById('model-close');let current, fileURL, abort;
  const empty=()=>{const message=document.createElement('div');message.className='model-empty';message.textContent='模型加载后，可在这里旋转和缩放。';host.replaceChildren(message);};
  const close=async()=>{abort?.abort();if(current)await current.dispose();current=null;if(fileURL)URL.revokeObjectURL(fileURL);fileURL=null;controls.forEach(b=>b.disabled=true);if(closeButton)closeButton.disabled=true;empty();};
  const load=async(source,name,initialView,format='splat')=>{
    input.disabled=true;if(demo)demo.disabled=true;if(light)light.disabled=true;
    try{await close();host.replaceChildren();abort=new AbortController();
      const url=source instanceof File?(fileURL=URL.createObjectURL(source)):source;
      if(closeButton)closeButton.disabled=false;
      current=await mountSplatViewer(host,{url,name,initialView,format,signal:abort.signal,onProgress:p=>{status.textContent=p.stage==='ready'?name+' · '+p.count.toLocaleString('zh-CN')+'个高斯点，可开始浏览。':p.stage==='reading'?'正在读取模型'+(p.percent===null?'…':' '+p.percent+'%'):'正在准备三维渲染，请稍候…';}});
      controls.forEach(b=>b.disabled=false);
    }catch(error){await close();status.textContent=error.name==='AbortError'?'已取消模型加载。':'模型打开失败：'+error.message;}
    finally{input.disabled=false;if(demo)demo.disabled=false;if(light)light.disabled=false;}
  };
  input.addEventListener('change',async()=>{
    const file=input.files[0];input.value='';if(!file)return;
    if(!file.name.toLowerCase().endsWith('.splat')||!file.size||file.size%32||file.size>MAX_BYTES){status.textContent='请选择完整的 .splat 模型，文件不超过100 MB。';return;}
    await load(file,file.name);
  });
  const openDemo=async(kind)=>{input.disabled=true;if(demo)demo.disabled=true;if(light)light.disabled=true;status.textContent='正在读取建筑模型资料…';try{const full=kind==='full',stem=full?'building-4906981-full-sh0':'building-4906981-display';const response=await fetch('assets/models/'+stem+'.json');if(!response.ok)throw new Error('无法读取模型资料');const metadata=await response.json();await load('assets/models/'+stem+(full?'.ksplat':'.splat'),'建筑4906981 · '+(full?'完整点数版':'低内存精简版'),metadata.initialView,full?'ksplat':'splat');}catch(error){status.textContent='展示模型打开失败：'+error.message;}finally{input.disabled=false;if(demo)demo.disabled=false;if(light)light.disabled=false;}};
  demo?.addEventListener('click',()=>openDemo('full'));
  light?.addEventListener('click',()=>openDemo('light'));
  const actions={'model-reset':()=>current?.reset(),'model-left':()=>current?.orbit(Math.PI/8),'model-right':()=>current?.orbit(-Math.PI/8),'model-near':()=>current?.zoom(.8),'model-far':()=>current?.zoom(1.25),'model-flip':()=>current?.flipUp(),'model-close':async()=>{await close();status.textContent='已关闭模型，可选择其他文件。';}};
  Object.entries(actions).forEach(([id,fn])=>document.getElementById(id).addEventListener('click',fn));
  window.addEventListener('pagehide',()=>{void close();},{once:true});
}
