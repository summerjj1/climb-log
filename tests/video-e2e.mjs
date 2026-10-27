import { chromium, expect as baseExpect } from '@playwright/test';
import { strict as assert } from 'node:assert';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
const expect = baseExpect.configure({timeout:45000});
const origin = process.env.TEST_ORIGIN || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 950 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.log('PAGEERROR',e.message); });
page.on('console', m=>{if(m.type()==='error')console.log('CONSOLE',m.text());});
page.on('requestfailed',r=>console.log('FAILED',r.url(),r.failure()));
await mkdir('test-results', { recursive: true });
try {
  await page.goto(origin);
  await expect(page.locator('#upload')).toBeEnabled();
  let fixture;
  try { fixture = await readFile('test-results/video-original.mp4'); } catch {
    // Generate synthetic moving imagery + tone; never read personal media.
    const bytes = await page.evaluate(async () => {
      const { FFmpeg } = await import('/node_modules/@ffmpeg/ffmpeg/dist/esm/index.js');
      const f = new FFmpeg();
      console.log('loading fixture engine');
      await Promise.race([f.load({coreURL: `${location.origin}/vendor/ffmpeg/ffmpeg-core.js`, wasmURL: `${location.origin}/vendor/ffmpeg/ffmpeg-core.wasm`}),new Promise((_,reject)=>setTimeout(()=>reject(new Error('fixture engine timeout')),30000))]);
      try {
        const code = await f.exec(['-f','lavfi','-i','testsrc2=size=1280x720:rate=30','-f','lavfi','-i','sine=frequency=440:sample_rate=44100','-t','4','-c:v','libx264','-crf','12','-preset','ultrafast','-threads','1','-pix_fmt','yuv420p','-c:a','aac','fixture.mp4']);
        if(code)throw Error('fixture generation failed');
        return Array.from(await f.readFile('fixture.mp4'));
      } finally {f.terminate();}
    });
    fixture = Buffer.from(bytes);
    await writeFile('test-results/video-original.mp4', fixture);
  }
  console.log('fixture bytes', fixture.length);
  await page.getByRole('button', { name: '樱粉', exact: true }).click();
  await page.locator('#upload').click();
  await page.locator('#upload-gym').fill('视频测试馆');
  assert.equal(await page.locator('#video-quality').inputValue(), /5174|\/tencent/.test(origin) ? 'auto' : 'small');
  await page.locator('#video-quality').selectOption('standard');
  await page.locator('#photo-files').setInputFiles({name:'测试视频.mp4', mimeType:'video/mp4', buffer:fixture});
  await expect(page.locator('#processing-status')).toBeHidden({timeout:120000});
  console.log('upload error:',await page.locator('#upload-error').innerText());
  await expect(page.locator('#save-upload')).toBeEnabled();
  const error = await page.locator('#upload-error').innerText();
  assert.equal(error, '');
  console.log('compression', await page.locator('.media-size').innerText());
  await expect(page.locator('.pending-row video')).toHaveCount(1);
  await page.locator('.pending-row video').evaluate(async video => { await video.play(); video.pause(); });
  await page.screenshot({path:'test-results/video-upload-desktop.png', fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'test-results/video-upload-mobile.png', fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth), true);
  await page.setViewportSize({width:1280,height:950});
  await page.locator('#save-upload').click();
  await expect(page.locator('.route-card')).toHaveCount(1);
  await expect(page.locator('.video-badge')).toContainText('0:04');
  await page.reload();
  await expect(page.locator('.video-badge')).toBeVisible();
  await page.locator('.photo-button').click();
  await expect(page.locator('#detail-dialog video')).toBeVisible();
  const meta = await page.locator('#detail-dialog video').evaluate(async video => {
    if(video.readyState<1)await new Promise(resolve=>video.addEventListener('loadedmetadata',resolve,{once:true}));
    await video.play();
    return { duration:video.duration,width:video.videoWidth,height:video.videoHeight,rate:video.playbackRate };
  });
  assert.ok(Math.abs(meta.duration-4)<0.15);
  assert.equal(meta.rate,1);
  assert.ok(meta.width<=1280&&meta.height<=1280);
  await page.locator('#detail-dialog .close-dialog').click();
  assert.equal(await page.locator('#detail-dialog video').evaluate(v=>v.paused),true);
  const download = page.waitForEvent('download');
  await page.locator('#export-data').click();
  const backup = JSON.parse(await readFile(await (await download).path(),'utf8'));
  assert.equal(backup.version,2);
  const route = backup.routes[0];
  assert.ok(route.photo.startsWith('data:video/mp4;base64,'));
  const compressed = Buffer.from(route.photo.split(',')[1],'base64');
  assert.ok(compressed.length<fixture.length);
  await writeFile('test-results/video-compressed.mp4',compressed);
  console.log('verified original',fixture.length,'compressed',compressed.length,'duration',meta.duration);
  // Restore in an empty, isolated browser, retaining the exact saved video bytes.
  const restored = await browser.newContext();
  const rp=await restored.newPage();await rp.goto(origin);await expect(rp.locator('#upload')).toBeEnabled();
  await rp.locator('#backup-file').setInputFiles({name:'video-backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
  await expect(rp.locator('.video-badge')).toBeVisible();
  await rp.locator('.photo-button').click();await expect(rp.locator('#detail-dialog video')).toBeVisible();
  await restored.close();
  // Cancel, reject invalid data, then retry. Existing records remain intact.
  await page.locator('#upload').click();
  await page.locator('#photo-files').setInputFiles({name:'取消.mp4',mimeType:'video/mp4',buffer:fixture});
  await expect(page.locator('#cancel-processing')).toBeVisible();
  await page.locator('#cancel-processing').click();
  await expect(page.locator('#processing-status')).toBeHidden({timeout:10000});
  await expect(page.locator('#pending-list video')).toHaveCount(0);
  await expect(page.locator('#save-upload')).toBeDisabled();
  await page.locator('#photo-files').setInputFiles({name:'坏文件.mp4',mimeType:'video/mp4',buffer:Buffer.from('not a movie')});
  await expect(page.locator('#upload-error')).not.toBeEmpty({timeout:30000});
  await expect(page.locator('#save-upload')).toBeDisabled();
  await page.locator('#video-quality').selectOption('small');
  await page.locator('#photo-files').setInputFiles({name:'再次上传.mp4',mimeType:'video/mp4',buffer:fixture});
  await expect(page.locator('#processing-status')).toBeHidden({timeout:120000});
  console.log('upload error:',await page.locator('#upload-error').innerText());
  await expect(page.locator('#save-upload')).toBeEnabled();
  const smaller = await page.locator('.pending-row video').evaluate(async video=>{if(video.readyState<1)await new Promise(r=>video.onloadedmetadata=r);return {duration:video.duration,width:video.videoWidth};});
  assert.ok(smaller.width<=854);assert.ok(Math.abs(smaller.duration-4)<.15);
  assert.deepEqual(errors,[]);
  console.log('PASS video: real WASM compression, duration, playback, both quality profiles, reload, backup restore, cancel/retry, invalid input, desktop/mobile.');
} finally { await browser.close(); }
