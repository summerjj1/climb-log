import { chromium, expect as baseExpect } from '@playwright/test';
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
const expect = baseExpect.configure({timeout:120000});
const browser = await chromium.launch({channel:'chrome',headless:true});
const origin = process.env.TEST_ORIGIN || 'http://127.0.0.1:5174';
const fixture = await readFile('test-results/video-original.mp4');
try {
 const context = await browser.newContext({viewport:{width:1280,height:950}});
 const page = await context.newPage();
 page.on('pageerror',error=>console.log('PAGEERROR',error.message));
 await page.goto(origin);console.log('page loaded');
 await expect(page.locator('#upload')).toBeEnabled();
 assert.equal(await page.evaluate(()=>crossOriginIsolated),true);
 // Synthetic moving clip and tone; no personal media or cloud writes.
 const assets=await page.evaluate(async encoded=>{
   const {FFmpeg}=await import('/node_modules/@ffmpeg/ffmpeg/dist/esm/index.js');
   const f=new FFmpeg();console.log('fixture loading');
   await f.load({classWorkerURL:`${location.origin}/vendor/ffmpeg/worker.js`,coreURL:`${location.origin}/vendor/ffmpeg/ffmpeg-core.js`,wasmURL:`${location.origin}/vendor/ffmpeg/ffmpeg-core.wasm`});
   try {
    console.log('fixture loaded');
    await f.writeFile('input.mp4',Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)));
    console.log('fixture written');
    if(await f.exec(['-i','input.mp4','-c','copy','long.mp4']))throw Error('copy failed');
    console.log('copied');
    if(await f.exec(['-i','input.mp4','-c','copy','source.mov']))throw Error('MOV fixture failed');console.log('remux done');
    if(await f.exec(['-i','input.mp4','-c:v','copy','-c:a','pcm_s16le','source-pcm.mov']))throw Error('PCM fixture failed');
    const base64=bytes=>{let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(s)};
    return {long:base64(await f.readFile('long.mp4')),mov:base64(await f.readFile('source.mov')),pcm:base64(await f.readFile('source-pcm.mov'))};
   } finally {f.terminate();}
 },fixture.toString('base64'));
 console.log('generated 4 sec fixture',assets.long.length);
 await page.locator('#upload').click();
 await page.locator('#video-quality').selectOption('standard');
 const longFile={name:'暂停测试.mp4',mimeType:'video/mp4',buffer:Buffer.from(assets.long,'base64')};
 await page.locator('#photo-files').setInputFiles(longFile);
 await expect(page.locator('#processing-label')).toContainText(/核压缩/);
 await expect.poll(()=>page.locator('#processing-progress').evaluate(p=>p.value)).toBeGreaterThan(0);
 for(let attempt=0;attempt<2;attempt++) {
  await page.locator('#pause-processing').click();
  await expect(page.locator('#pause-processing')).toHaveText('继续处理');
  const progress=await page.locator('#processing-progress').evaluate(p=>p.value);
  await page.waitForTimeout(1200);
  assert.equal(await page.locator('#processing-progress').evaluate(p=>p.value),progress);
  assert.ok(progress>0&&progress<100);
  if(!attempt){await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-results/video-paused-mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.setViewportSize({width:1280,height:950});await page.screenshot({path:'test-results/video-paused-desktop.png',fullPage:true});}
  console.log('paused with stable progress',progress);
  await page.locator('#pause-processing').click();
  await expect(page.locator('#pause-processing')).toHaveText('暂停处理');
  await expect.poll(()=>page.locator('#processing-progress').evaluate(p=>p.value)).toBeGreaterThan(progress);
 }
 await expect(page.locator('#processing-status')).toBeHidden({timeout:180000});
 assert.equal(await page.locator('#upload-error').innerText(),'');
 await expect(page.locator('#pending-list video')).toHaveCount(1);
 const duration=await page.locator('#pending-list video').evaluate(async v=>{if(v.readyState<1)await new Promise(r=>v.onloadedmetadata=r);await v.play();v.pause();return v.duration});
 assert.ok(Math.abs(duration-4)<.2);
 console.log('resumed output plays at full duration',duration);
 // Cancel while paused, then process another file in the same page.
 await page.locator('[data-remove]').click();
 await page.locator('#photo-files').setInputFiles(longFile);
 await expect(page.locator('#processing-label')).toContainText(/核压缩/);
 await page.locator('#pause-processing').click();
 await expect(page.locator('#pause-processing')).toHaveText('继续处理');
 await page.locator('#cancel-processing').click();
 await expect(page.locator('#processing-status')).toBeHidden({timeout:15000});
 await expect(page.locator('#pending-list video')).toHaveCount(0);
 await page.locator('#video-quality').selectOption('auto');
 await page.locator('#photo-files').setInputFiles({name:'无损测试.mov',mimeType:'video/quicktime',buffer:Buffer.from(assets.mov,'base64')});
 await expect(page.locator('#processing-status')).toBeHidden({timeout:120000});
 assert.equal(await page.locator('#upload-error').innerText(),'');
 await expect(page.locator('#pending-list video')).toHaveCount(1);
 await expect(page.locator('.media-size').last()).toContainText('无损转为 MP4');
 console.log('cancel while paused and lossless MOV remux passed');
 await page.locator('[data-remove]').click();
 // A small MOV with PCM audio needs encoding: transition from light probe to multicore.
 await page.locator('#photo-files').setInputFiles({name:'音频兼容测试.mov',mimeType:'video/quicktime',buffer:Buffer.from(assets.pcm,'base64')});
 await expect(page.locator('#processing-label')).toContainText(/核压缩/);
 await expect(page.locator('#processing-status')).toBeHidden({timeout:180000});
 assert.equal(await page.locator('#upload-error').innerText(),'');
 await expect(page.locator('#pending-list video')).toHaveCount(1);
 await expect(page.locator('.media-size')).not.toContainText('无损转为 MP4');
 await page.locator('[data-remove]').click();
 console.log('light probe upgrades to multi-thread encoding for incompatible audio');
 // Loading failure falls back to single-thread mode; an isolated browser still supports pause.
 await page.route('**/vendor/ffmpeg-mt/**',route=>route.abort());
 await page.locator('#video-quality').selectOption('standard');
 await page.locator('#photo-files').setInputFiles({name:'兼容测试.mp4',mimeType:'video/mp4',buffer:fixture});
 await expect(page.locator('#processing-status')).toBeHidden({timeout:120000});
 assert.equal(await page.locator('#upload-error').innerText(),'');
 await expect(page.locator('#pending-list video')).toHaveCount(1);
 console.log('multithread-load failure falls back successfully');
 // Browsers without isolation remain able to encode; never show an unusable pause button.
 const fallback=await browser.newContext();
 await fallback.route(origin+'/',async route=>{
  const response=await route.fetch();const headers=response.headers();delete headers['cross-origin-opener-policy'];delete headers['cross-origin-embedder-policy'];
  await route.fulfill({response,headers});
 });
 const fp=await fallback.newPage();await fp.goto(origin);
 assert.equal(await fp.evaluate(()=>crossOriginIsolated),false);
 await expect(fp.locator('#upload')).toBeEnabled();await fp.locator('#upload').click();
 await fp.locator('#video-quality').selectOption('standard');
 await fp.locator('#photo-files').setInputFiles({name:'单线程.mp4',mimeType:'video/mp4',buffer:fixture});
 await expect(fp.locator('#processing-label')).toContainText('正在压缩');
 await expect(fp.locator('#pause-processing')).toBeHidden();
 await expect(fp.locator('#processing-status')).toBeHidden({timeout:120000});
 assert.equal(await fp.locator('#upload-error').innerText(),'');
 await expect(fp.locator('#pending-list video')).toHaveCount(1);
 console.log('PASS: real multi-thread encoding, repeated pause/resume, frozen progress, complete playback, cancel while paused, retry, lossless MOV, failed-core fallback, non-isolated fallback, mobile layout');
} finally {await browser.close();}
