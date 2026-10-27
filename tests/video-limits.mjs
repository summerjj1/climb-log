import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { open, readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const temp = await mkdtemp(join(tmpdir(), 'mei-video-limits-'));
const browser = await chromium.launch({channel:'chrome',headless:true});
try {
  // A valid short MP4 with a sparse trailing free box tests 1 GB reading without
  // storing personal media or allocating a 1 GB JavaScript buffer.
  const original = await readFile('test-results/video-original.mp4');
  const path = join(temp, 'one-gb.mp4');
  const file = await open(path, 'w');
  const limit = 1024 ** 3;
  const padding = Buffer.alloc(8);
  padding.writeUInt32BE(limit - original.length); padding.write('free',4);
  await file.write(original); await file.write(padding); await file.truncate(limit); await file.close();
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5173/');
  await page.locator('#upload').click();
  await page.locator('#photo-files').setInputFiles(path);
  await page.locator('.pending-row video').waitFor({timeout:120000});
  assert.match(await page.locator('.media-size').innerText(), /1024.00 MB/);
  console.log('PASS: exact 1 GB file is read and compressed through WORKERFS.');
  const result = await page.evaluate(async () => {
    const {compressVideo, inspectSavedVideo} = await import('/src/video.js');
    let oversized = '';
    try {await compressVideo({size:1024**3+1});} catch(e) {oversized=e.message;}
    const {FFmpeg} = await import('/node_modules/@ffmpeg/ffmpeg/dist/esm/index.js');
    const f = new FFmpeg();
    await f.load({classWorkerURL:'/vendor/ffmpeg/worker.js',coreURL:'/vendor/ffmpeg/ffmpeg-core.js',wasmURL:'/vendor/ffmpeg/ffmpeg-core.wasm'});
    const output = {oversized};
    try {
      for (const duration of [601,600]) {
        const code=await f.exec(['-f','lavfi','-i','testsrc2=size=160x90:rate=2','-t',String(duration),'-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-threads','1','fixture.mp4']);
        if(code!==0) throw Error('fixture failed');
        const source = new File([await f.readFile('fixture.mp4')],'long.mp4',{type:'video/mp4'});
        try {
          const compressed=await compressVideo(source);
          output[duration]={duration:compressed.videoMeta.duration,bytes:compressed.photo.size,restored:await inspectSavedVideo(compressed.photo)};
        } catch(e) {output[duration]={error:e.message};}
      }
    } finally {f.terminate();}
    return output;
  });
  assert.match(result.oversized,/1 GB/);
  assert.match(result[601].error,/10 分钟/);
  assert.equal(result[600].duration,600);
  assert.ok(result[600].bytes<=20*1024**2);
  assert.ok(Math.abs(result[600].restored.duration-600)<=0.6);
  console.log('PASS: over 1 GB and over 10 minutes rejected; full 10-minute video compresses and restores.', result);
} finally {await browser.close(); await rm(temp,{recursive:true,force:true});}
