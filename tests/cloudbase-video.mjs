import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { open, readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const temp = await mkdtemp(join(tmpdir(), 'panlemei-video-limits-'));
const browser = await chromium.launch({channel:'chrome',headless:true});
try {
  // A valid short MP4 with a sparse 64-bit free box tests 1 GB input without
  // storing personal media or allocating a multi-GB JavaScript buffer.
  const original = await readFile('test-results/video-original.mp4');
  const path = join(temp, 'one-gb.mp4');
  const file = await open(path, 'w');
  const limit = 1024 ** 3;
  const padding = Buffer.alloc(16);
  padding.writeUInt32BE(1); padding.write('free',4); padding.writeBigUInt64BE(BigInt(limit-original.length),8);
  await file.write(original); await file.write(padding); await file.truncate(limit); await file.close();
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5174/');
  await page.locator('#upload').click();
  assert.equal(await page.locator('#video-quality').inputValue(),'auto');
  await page.locator('#photo-files').setInputFiles(path);
  await page.locator('.pending-row video').waitFor({timeout:120000});
  assert.match(await page.locator('.media-size').innerText(), /1024.00 MB/);
  console.log('PASS: exact 1 GB file is read and compressed through WORKERFS.');
  // >20 MB compatible videos retain exact bytes and survive the larger backup format.
  await page.locator('[data-remove="0"]').click();
  const mediumPath=join(temp,'25mb.mp4');
  const medium=await open(mediumPath,'w');
  const mediumSize=25*1024**2;
  const header=Buffer.alloc(8);header.writeUInt32BE(mediumSize-original.length);header.write('free',4);
  await medium.write(original);await medium.write(header);await medium.truncate(mediumSize);await medium.close();
  await page.locator('#photo-files').setInputFiles(mediumPath);
  await page.locator('.pending-row video').waitFor({timeout:60000});
  assert.match(await page.locator('.media-size').innerText(),/保留原画质与原文件/);
  await page.locator('#upload-gym').fill('大视频本机测试');
  await page.locator('#save-upload').click();
  await page.locator('.video-badge').waitFor();
  const download=page.waitForEvent('download');await page.locator('#export-data').click();
  const backup=await readFile(await (await download).path());
  const saved=JSON.parse(backup).routes[0];
  assert.equal(Buffer.from(saved.photo.split(',')[1],'base64').length,mediumSize);
  const restoreContext=await browser.newContext();const restorePage=await restoreContext.newPage();
  await restorePage.goto('http://127.0.0.1:5174/');await restorePage.locator('#upload').waitFor();
  await restorePage.locator('#backup-file').setInputFiles({name:'large-backup.json',mimeType:'application/json',buffer:backup});
  await restorePage.locator('.video-badge').waitFor({timeout:60000});
  await restoreContext.close();
  console.log('PASS: 25 MB MP4 retained without encoding; backup above the previous base64 limit restores.');
  const result = await page.evaluate(async () => {
    const {compressVideo, inspectSavedVideo} = await import('/src/video.js');
    let oversized = '';
    try {await compressVideo({size:1024**3+1});} catch(e) {oversized=e.message;}
    const {FFmpeg} = await import('/node_modules/@ffmpeg/ffmpeg/dist/esm/index.js');
    const f = new FFmpeg();
    await f.load({classWorkerURL:'/vendor/ffmpeg/worker.js',coreURL:'/vendor/ffmpeg/ffmpeg-core.js',wasmURL:'/vendor/ffmpeg/ffmpeg-core.wasm'});
    const output = {oversized};
    const {CloudStore} = await import('/src/cloud-store.js');
    let uploaded=0;
    const q={insert(){return q},select(){return q},async maybeSingle(){return {data:{version:1}}}};
    const mock={storage:{from(){return {async upload(){uploaded++;return {}},async remove(){return {}}}}},from(){return q}};
    for(const [type,size,ok] of [['video/mp4',1024**3,true],['video/quicktime',1024**3,true],['video/webm',1024**3,true],['video/mp4',1024**3+1,false],['image/jpeg',20*1024**2+1,false]]) {
      const store=new CloudStore(mock,'test-user');
      let passed=false;
      try {await store.save({gyms:[],routes:[{id:'test',photo:{type,size}}]},{routes:[]});passed=true;}catch{}
      if(passed!==ok)throw Error('Storage limit mismatch: '+type+' '+size);
    }
    if(uploaded!==3)throw Error('Oversized file reached upload');
    output.storageBoundary=true;
    try {
      for (const duration of [1201,1200]) {
        const code=await f.exec(['-f','lavfi','-i','testsrc2=size=160x90:rate=2','-t',String(duration),'-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-threads','1','fixture.mp4']);
        if(code!==0) throw Error('fixture failed');
        const source = new File([await f.readFile('fixture.mp4')],'long.mp4',{type:'video/mp4'});
        try {
          let raw;
          try { raw = await compressVideo(source,{quality:'original'}); }
          catch(e) { if(duration===1200)throw e; output.rawLongRejected=/20 分钟/.test(e.message); }
          if(duration===1200 && (raw.photo!==source || !raw.videoMeta.uncompressed))throw Error('Raw duration boundary failed');
          const compressed=await compressVideo(source);
          if (!compressed.videoMeta.keptOriginal) throw Error("Compatible original should bypass encoding");
          output[duration]={duration:compressed.videoMeta.duration,bytes:compressed.photo.size,restored:await inspectSavedVideo(compressed.photo)};
        } catch(e) {output[duration]={error:e.message};}
      }
      const movCode=await f.exec(['-i','fixture.mp4','-c','copy','fixture.mov']);
      if(movCode!==0)throw Error('MOV fixture failed');
      const mov=new File([await f.readFile('fixture.mov')],'long.mov',{type:'video/quicktime'});
      const converted=await compressVideo(mov);
      if(converted.videoMeta.keptOriginal)throw Error('MOV must be converted to MP4');
      output.converted={duration:converted.videoMeta.duration,bytes:converted.photo.size};
    } finally {f.terminate();}
    return output;
  });
  assert.equal(result.rawLongRejected,true);
  assert.equal(result.converted.duration,1200);
  assert.ok(result.converted.bytes<=200*1024**2);
  assert.match(result.oversized,/1 GB/);
  assert.match(result[1201].error,/20 分钟/);
  assert.equal(result[1200].duration,1200);
  assert.ok(result[1200].bytes<=200*1024**2);
  assert.ok(Math.abs(result[1200].restored.duration-1200)<=0.6);
  console.log('PASS: over 1 GB and over 20 minutes rejected; full 20-minute video retains original bytes and restores.', result);
} finally {await browser.close(); await rm(temp,{recursive:true,force:true});}
