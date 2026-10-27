import {chromium,expect as baseExpect} from '@playwright/test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const expect=baseExpect.configure({timeout:25000});
const fixture=await readFile(process.env.STREAM_FIXTURE || 'test-results/video-stream.mp4'), CHUNK=4194304;
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')console.log('browser:',m.text())});
 const requests=[];let fail=false,delay=100;
 await context.route('https://**/*',r=>r.abort());
 await context.route('**/__stream_part/*',async r=>{
  const index=Number(new URL(r.request().url()).pathname.split('/').at(-1));requests.push(index);
  await new Promise(resolve=>setTimeout(resolve,delay));
  if(fail)return r.fulfill({status:503,body:'retry'});
  return r.fulfill({contentType:'video/mp4',body:fixture.subarray(index*CHUNK,(index+1)*CHUNK)});
 });
 const legacyReads=[];
 await context.route('**/__legacy_stream',async r=>{
  const m=/bytes=(\d+)-(\d*)/.exec(r.request().headers().range||'');
  const start=m?Number(m[1]):0,end=Math.min(fixture.length-1,m?.[2]?Number(m[2]):start+1024*1024-1);
  legacyReads.push({start,end});
  await r.fulfill({status:206,headers:{'Content-Type':'video/mp4','Content-Range':`bytes ${start}-${end}/${fixture.length}`,'Accept-Ranges':'bytes','Content-Length':String(end-start+1)},body:fixture.subarray(start,end+1)});
 });
 await context.route('**/src/cloud.js',r=>r.fulfill({contentType:'application/javascript',body:`
 export const cloudProvider='cloudbase',recoveryLink=false;
 let listener;window.streamTest={logout:()=>listener('SIGNED_OUT',null)};
 const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;const ctx=canvas.getContext('2d');ctx.fillStyle='#efcbdc';ctx.fillRect(0,0,320,180);ctx.fillStyle='#4c2939';ctx.font='20px sans-serif';ctx.fillText('PanleMEI test video',35,95);const poster=canvas.toDataURL('image/jpeg');
 const base={gymId:'g',grade:'5.9',done:false,createdAt:Date.now(),poster,videoMeta:{duration:60,fastCompressed:${!!process.env.STREAM_FIXTURE?.includes('fragmented')}}};
 let row={version:1,payload:{gyms:[{id:'g',name:'测试岩馆'}],routes:[{...base,id:'old',name:'旧视频',photoPath:'u/old.mp4'},{...base,id:'chunks',name:'分段播放测试',photoPath:'u/chunk.mp4',photoParts:{version:1,type:'video/mp4',size:${fixture.length},parts:Array.from({length:${Math.ceil(fixture.length/CHUNK)}},(_,i)=>({path:'u/chunk.mp4.parts/'+String(i).padStart(4,'0'),size:Math.min(4194304,${fixture.length}-i*4194304)}))}}]}};
 const bucket={async createSignedUrl(){return {data:{signedUrl:location.origin+'/__legacy_stream'}}},async download(path){const r=await fetch('/__stream_part/'+Number(path.slice(-4)));if(!r.ok)return {error:{status:r.status}};return {data:await r.blob()}},async remove(){return {}}};
 export const cloud={auth:{onAuthStateChange(fn){listener=fn},async getSession(){return {data:{session:{user:{id:'u',email:'preview@example.invalid'}}}}},async signOut(){listener('SIGNED_OUT',null);return {}}},storage:{from:()=>bucket},from(){let write;const q={select:()=>q,eq:()=>q,insert:v=>(write=v,q),update:v=>(write=v,q),async maybeSingle(){if(write){row=write;return {data:{version:write.version}}}return {data:row}}};return q}};
 `}));
 await page.goto('http://127.0.0.1:5174/');await expect(page.locator('#cloud-status')).toContainText('已读取云端');assert.equal(requests.length,0);assert.equal(legacyReads.length,0);
 await page.locator('[data-detail=chunks]').click();assert.equal(requests.length,0);
 await page.locator('#edit-form [name=notes]').fill('编辑无需读视频');await page.locator('#edit-form button[type=submit]').click();await expect(page.locator('#detail-dialog')).not.toBeVisible();assert.equal(requests.length,0);
 await page.locator('[data-detail=chunks]').click();await page.locator('#play-cloud-video').click();
 await expect.poll(()=>page.locator('#detail-dialog video').evaluate(v=>v.currentTime)).toBeGreaterThan(.1);
 await page.locator('#detail-dialog video').evaluate(v=>v.pause());
 console.log('first playback',requests,'of',Math.ceil(fixture.length/CHUNK));
 assert.ok(new Set(requests).size<Math.ceil(fixture.length/CHUNK)/2,'starts without downloading most of file');
 const src=await page.locator('#detail-dialog video').getAttribute('src');assert.ok(src.includes('__video_stream')||src.startsWith('blob:'));
 await page.locator('#detail-dialog video').evaluate(v=>{v.currentTime=50;v.play()});
 await expect.poll(()=>page.locator('#detail-dialog video').evaluate(v=>v.currentTime)).toBeGreaterThan(50.1);
 await page.locator('#detail-dialog video').evaluate(v=>v.pause());
 assert.ok(requests.some(i=>i>15),'seeking loads a distant chunk');
 assert.ok(!requests.includes(10),'seeking skips middle chunk');
 await page.locator('#detail-dialog video').evaluate(v=>{v.currentTime=1;v.play()});
 await expect.poll(()=>page.locator('#detail-dialog video').evaluate(v=>v.currentTime)).toBeGreaterThan(1.1);
 await page.locator('#detail-dialog video').evaluate(v=>v.pause());
 await page.screenshot({path:'test-results/video-stream-mobile.png',fullPage:true});
 // Verify actual HTTP range headers/bytes and malformed ranges.
 if(src.includes('__video_stream')) {
 const checks=await page.evaluate(async src=>{
  const a=await fetch(src,{headers:{Range:'bytes=4194290-4194320'}});const bytes=Array.from(new Uint8Array(await a.arrayBuffer()));
  const b=await fetch(src,{headers:{Range:'bytes=999999999-'}});
  const c=await fetch(src,{method:'HEAD'});
  return {status:a.status,range:a.headers.get('content-range'),bytes,bad:b.status,head:c.headers.get('content-length'),cache:a.headers.get('cache-control')};
 },src);
 assert.equal(checks.status,206);assert.deepEqual(checks.bytes,Array.from(fixture.subarray(4194290,4194321)));assert.equal(checks.bad,416);assert.equal(Number(checks.head),fixture.length);assert.equal(checks.cache,'no-store');
 const other=await context.newPage();await other.goto('http://127.0.0.1:5174/');assert.equal(await other.evaluate(async src=>(await fetch(src)).status,src),503,'another tab cannot use playback capability');await other.close();
 }
 await page.keyboard.press('Escape');const count=requests.length;await page.waitForTimeout(700);assert.equal(requests.length,count,'closing stops new reads');if(src.includes('__video_stream'))assert.equal(await page.evaluate(async src=>(await fetch(src)).status,src),503);
 // Legacy objects use a private signed URL and native ranges.
 await page.locator('[data-detail=old]').click();assert.equal(legacyReads.length,0);await page.locator('#play-cloud-video').click();await expect.poll(()=>page.locator('#detail-dialog video').evaluate(v=>v.currentTime)).toBeGreaterThan(.1);assert.ok(legacyReads.length);await page.keyboard.press('Escape');
 // Failures keep a retry action; logout retires active capability.
 fail=true;await page.locator('[data-detail=chunks]').click();await page.locator('#play-cloud-video').click();await expect(page.locator('#play-cloud-video')).toBeEnabled();await expect(page.locator('#video-load-status')).toContainText('重试');
 fail=false;await page.locator('#play-cloud-video').click();await expect.poll(()=>page.locator('#detail-dialog video').evaluate(v=>v.currentTime)).toBeGreaterThan(.1);
 const oldSrc=await page.locator('#detail-dialog video').getAttribute('src');await page.evaluate(()=>window.streamTest.logout());await expect(page.locator('#detail-dialog')).not.toBeVisible();const n=requests.length;await page.waitForTimeout(700);assert.equal(requests.length,n);if(oldSrc.includes('__video_stream'))assert.equal(await page.evaluate(async src=>(await fetch(src)).status,oldSrc),503);
 assert.deepEqual(errors,[]);console.log('PASS: zero reads on login/edit; early playback and seek before full download; exact 206/416/HEAD; no cross-tab capability; close/logout stop reads; legacy streaming and retry');
}finally{await browser.close()}
