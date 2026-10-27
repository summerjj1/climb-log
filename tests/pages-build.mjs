import {readFile, readdir} from 'node:fs/promises';
import {strict as assert} from 'node:assert';
import {chromium, expect} from '@playwright/test';

for (const folder of ['ffmpeg', 'ffmpeg-mt']) {
  const base = `dist-pages/vendor/${folder}/`;
  const manifest = JSON.parse(await readFile(`${base}ffmpeg-core.wasm.json`, 'utf8'));
  const chunks = await Promise.all(manifest.parts.map(p => readFile(base + p.name)));
  assert.ok(chunks.every(chunk => chunk.length <= 25 * 1024 ** 2));
  assert.deepEqual(Buffer.concat(chunks), await readFile(`public/vendor/${folder}/ffmpeg-core.wasm`));
  assert.ok(!(await readdir(base)).includes('ffmpeg-core.wasm'));
}
const browser = await chromium.launch({channel: 'chrome', headless: true});
try {
  for (const [quality, folder] of [['auto', 'ffmpeg'], ['standard', 'ffmpeg-mt']]) {
    const context = await browser.newContext();
    await context.addInitScript(() => Object.defineProperty(navigator, 'hardwareConcurrency', {get: () => 4}));
    const page = await context.newPage();
    const urls = [];
    page.on('request', r => urls.push(r.url()));
    await page.goto(process.env.TEST_ORIGIN || 'http://127.0.0.1:4176/');
    await page.locator('#upload').click();
    await page.locator('#video-quality').selectOption(quality);
    await page.locator('#photo-files').setInputFiles('test-results/video-original.mp4');
    await expect(page.locator('#pending-list video')).toHaveCount(1, {timeout: 180000});
    assert.equal(await page.locator('#upload-error').innerText(), '');
    assert.ok(urls.some(url => url.includes(`/vendor/${folder}/ffmpeg-core.wasm.json`)));
    assert.ok(urls.some(url => url.includes(`/vendor/${folder}/`) && url.endsWith('.bin')));
    assert.ok(!urls.some(url => url.endsWith('.wasm')));
    const duration = await page.locator('#pending-list video').evaluate(async v => {
      if (!v.readyState) await new Promise(resolve => v.addEventListener('loadedmetadata', resolve, {once:true}));
      await v.play(); v.pause(); return v.duration;
    });
    assert.ok(Math.abs(duration - 4) < .3);
    console.log(`Pages ${quality}: split WASM loads and output plays`);
    await context.close();
  }
} finally { await browser.close(); }
