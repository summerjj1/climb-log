import {spawnSync} from 'node:child_process';
import {readFile, writeFile, unlink, readdir, stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve, join} from 'node:path';

const root = resolve(import.meta.dirname, '..');
const result = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--mode', 'cloudbase', '--outDir', 'dist-pages'], {
  cwd: root, stdio: 'inherit', env: {...process.env, VITE_SPLIT_VIDEO_CORE: '1'},
});
if (result.status !== 0) process.exit(result.status || 1);
for (const folder of ['ffmpeg', 'ffmpeg-mt']) {
  const dir = join(root, 'dist-pages/vendor', folder);
  const file = join(dir, 'ffmpeg-core.wasm');
  const bytes = await readFile(file);
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0,12);
  const parts = [];
  for (let offset = 0, index = 0; offset < bytes.length; offset += 16 * 1024 ** 2, index++) {
    const part = bytes.subarray(offset, offset + 16 * 1024 ** 2);
    const name = `ffmpeg-core.${hash}.${index}.bin`;
    await writeFile(join(dir, name), part);
    parts.push({name, size: part.length});
  }
  await writeFile(`${file}.json`, JSON.stringify({size: bytes.length, parts}));
  await unlink(file);
}
// Existing /tencent/ bookmarks and share links reach the same CloudBase app.
await writeFile(join(root, 'dist-pages/_redirects'), '/tencent / 302\n/tencent/ / 302\n/tencent/* /:splat 302\n');
async function check(dir) {
  for (const name of await readdir(dir)) {
    const file = join(dir, name), info = await stat(file);
    if (info.isDirectory()) await check(file);
    else if (info.size > 25 * 1024 ** 2) throw new Error(`Cloudflare asset too large: ${file}`);
  }
}
await check(join(root, 'dist-pages'));
console.log('Cloudflare Pages build ready: dist-pages');
