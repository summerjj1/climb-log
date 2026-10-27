import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage();
 const wasm=[];page.on('request',r=>{if(r.url().includes('/vendor/ffmpeg'))wasm.push(r.url())});
 page.on('console',m=>{if(m.type()==='error')console.log('browser:',m.text())});
 await page.goto('http://127.0.0.1:5174/');
 const result=await page.evaluate(async()=>{
  const {compressVideo}=await import('/src/video.js');
  const source=await (await fetch('/test-results/video-original.mp4')).blob();
  const file=new File([source],'fixture.mp4',{type:'video/mp4'});
  const start=performance.now();let states=[],control,paused=false,progress=[];
  const out=await compressVideo(file,{quality:'fast',onControl:c=>control=c,onProgress:p=>{
   progress.push(p);
   if(p.percent>=1 && control && !paused){paused=true;control.pause();}
  },onState:s=>{states.push(s);if(s==='paused')setTimeout(()=>control.resume(),250)}});
  const {Input,BlobSource,ALL_FORMATS}=await import('/node_modules/mediabunny/dist/modules/src/index.js');
  const input=new Input({source:new BlobSource(out.photo),formats:ALL_FORMATS});
  const video=await input.getPrimaryVideoTrack(),audio=await input.getPrimaryAudioTrack();
  const data={seconds:(performance.now()-start)/1000,bytes:out.photo.size,sourceBytes:file.size,duration:await input.computeDuration(),width:await video.getDisplayWidth(),height:await video.getDisplayHeight(),video:await video.getCodec(),audio:await audio?.getCodec(),states,meta:out.videoMeta};
  input.dispose();
  const controller=new AbortController();let cancelControl;let canceled=false;
  try{await compressVideo(file,{quality:'fast',signal:controller.signal,onControl:c=>cancelControl=c,onProgress:p=>{if(p.percent>=1)cancelControl?.pause()},onState:s=>{if(s==='paused')controller.abort()}})}catch(e){canceled=e.name==='AbortError'}
  data.canceled=canceled;
  return data;
 });
 assert.equal(result.video,'avc');assert.equal(result.audio,'aac');assert.ok(Math.abs(result.duration-4)<.1);
 assert.ok(result.bytes<result.sourceBytes);assert.ok(result.states.includes('paused')&&result.states.includes('running'));
 assert.ok(result.canceled);assert.equal(wasm.length,0);
 console.log('PASS: hardware-preferred conversion, audio, duration, pause/resume/cancel, no FFmpeg',result);
 await page.locator('#upload').click();await page.locator('#video-quality').selectOption('fast');
 await page.locator('#photo-files').setInputFiles('test-results/video-original.mp4');
 await page.locator('.pending-row video').waitFor({timeout:30000});
 assert.match(await page.locator('.media-size').innerText(),/原速/);
 console.log('PASS: fast option creates a playable preview');
 const unsupported=await browser.newContext();await unsupported.addInitScript(()=>{Object.defineProperty(globalThis,'VideoEncoder',{value:undefined})});
 const p=await unsupported.newPage();await p.goto('http://127.0.0.1:5174/');
 const message=await p.evaluate(async()=>{const {compressVideo}=await import('/src/video.js');try{await compressVideo(new File(['x'],'x.mp4'),{quality:'fast'})}catch(e){return e.message}});
 assert.match(message,/不支持快速压缩/);await unsupported.close();
 console.log('PASS: unsupported browser shows an actionable fallback');
}finally{await browser.close()}
