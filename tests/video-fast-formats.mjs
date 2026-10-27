import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage();await page.goto('http://127.0.0.1:5174/');
 const result=await page.evaluate(async()=>{
  const {FFmpeg}=await import('/node_modules/@ffmpeg/ffmpeg/dist/esm/index.js');
  const f=new FFmpeg();await f.load({classWorkerURL:'/vendor/ffmpeg/worker.js',coreURL:'/vendor/ffmpeg/ffmpeg-core.js',wasmURL:'/vendor/ffmpeg/ffmpeg-core.wasm'});
  let file;
  try{
   if(await f.exec(['-f','lavfi','-i','testsrc2=size=2560x1440:rate=10','-t','1','-c:v','libx264','-preset','ultrafast','-threads','2','base.mp4']))throw Error('fixture encode failed');
   if(await f.exec(['-i','base.mp4','-c','copy','-metadata:s:v:0','rotate=90','rotated.mov']))throw Error('rotation fixture failed');
   file=new File([await f.readFile('rotated.mov')],'portrait.mov',{type:'video/quicktime'});
  }finally{f.terminate()}
  const {compressVideo}=await import('/src/video.js');
  const start=performance.now();const out=await compressVideo(file,{quality:'fast'});
  const {Input,BlobSource,ALL_FORMATS}=await import('/node_modules/mediabunny/dist/modules/src/index.js');
  const input=new Input({source:new BlobSource(out.photo),formats:ALL_FORMATS});
  try{const v=await input.getPrimaryVideoTrack();return {seconds:(performance.now()-start)/1000,width:await v.getDisplayWidth(),height:await v.getDisplayHeight(),duration:await input.computeDuration(),hasAudio:!!await input.getPrimaryAudioTrack(),size:out.photo.size}}finally{input.dispose()}
 });
 assert.equal(result.width,1080);assert.equal(result.height,1920);assert.equal(result.hasAudio,false);assert.ok(Math.abs(result.duration-1)<.1);
 console.log('PASS: MOV rotation, 1440p to portrait 1080p, no-audio input and complete duration',result);
}finally{await browser.close()}
