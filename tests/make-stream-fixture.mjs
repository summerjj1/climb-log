import {chromium} from '@playwright/test';
import {access,writeFile} from 'node:fs/promises';
try {await access('test-results/video-stream.mp4');process.exit(0)} catch{}
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage();await page.goto('http://127.0.0.1:5174/');
 const base64=await page.evaluate(async()=>{
  const {FFmpeg}=await import('/node_modules/@ffmpeg/ffmpeg/dist/esm/index.js');
  const f=new FFmpeg();await f.load({coreURL:location.origin+'/vendor/ffmpeg/ffmpeg-core.js',wasmURL:location.origin+'/vendor/ffmpeg/ffmpeg-core.wasm'});
  try {
   await f.writeFile('in.mp4',new Uint8Array(await (await fetch('/test-results/video-original.mp4')).arrayBuffer()));
   if(await f.exec(['-stream_loop','14','-i','in.mp4','-c','copy','-movflags','+faststart','out.mp4']))throw Error('remux failed');
   const blob=new Blob([await f.readFile('out.mp4')]);return await new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.readAsDataURL(blob)});
  }finally{f.terminate()}
 });
 await writeFile('test-results/video-stream.mp4',Buffer.from(base64,'base64'));console.log('Generated synthetic 60-second stream fixture');
}finally{await browser.close()}
