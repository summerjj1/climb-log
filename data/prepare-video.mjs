import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
const target = new URL('../public/vendor/ffmpeg/', import.meta.url);
await mkdir(target, { recursive: true });
for (const file of ['ffmpeg-core.js', 'ffmpeg-core.wasm'])
  await copyFile(new URL(`../node_modules/@ffmpeg/core/dist/esm/${file}`, import.meta.url), new URL(file, target));
for (const file of ['worker.js', 'const.js', 'errors.js'])
  await copyFile(new URL(`../node_modules/@ffmpeg/ffmpeg/dist/esm/${file}`, import.meta.url), new URL(file, target));

// Keep the upstream worker intact for existing integrations. This version adds a
// cooperative shared-memory pause at progress/log callbacks and before commands.
let worker = await readFile(new URL('worker.js', target), 'utf8');
function replaceOnce(from, to) {
  if (!worker.includes(from)) throw new Error('FFmpeg worker changed; review pause integration');
  worker = worker.replace(from, to);
}
replaceOnce('let ffmpeg;', `let ffmpeg;
let pauseWords;
const waitForResume = () => {
  if (!pauseWords || !Atomics.load(pauseWords, 0)) return;
  Atomics.store(pauseWords, 1, 1);
  while (Atomics.load(pauseWords, 0)) Atomics.wait(pauseWords, 0, 1);
  Atomics.store(pauseWords, 1, 0);
};`);
replaceOnce('workerURL: _workerURL, })', 'workerURL: _workerURL, pauseBuffer, })');
replaceOnce('    const first = !ffmpeg;', '    pauseWords = pauseBuffer ? new Int32Array(pauseBuffer) : null;\n    const first = !ffmpeg;');
replaceOnce('ffmpeg.setLogger((data) => self.postMessage({ type: FFMessageType.LOG, data }));', 'ffmpeg.setLogger((data) => { waitForResume(); self.postMessage({ type: FFMessageType.LOG, data }); });');
replaceOnce('ffmpeg.setProgress((data) => self.postMessage({\n        type: FFMessageType.PROGRESS,\n        data,\n    }));', 'ffmpeg.setProgress((data) => { waitForResume(); self.postMessage({ type: FFMessageType.PROGRESS, data }); });');
replaceOnce('    ffmpeg.exec(...args);', '    waitForResume();\n    ffmpeg.exec(...args);');
replaceOnce('    ffmpeg.ffprobe(...args);', '    waitForResume();\n    ffmpeg.ffprobe(...args);');
await writeFile(new URL('worker-pause-v1.js', target), worker);
const mtTarget = new URL('../public/vendor/ffmpeg-mt/', import.meta.url);
await mkdir(mtTarget, {recursive:true});
for (const file of ['ffmpeg-core.js', 'ffmpeg-core.wasm', 'ffmpeg-core.worker.js'])
  await copyFile(new URL(`../node_modules/@ffmpeg/core-mt/dist/esm/${file}`, import.meta.url), new URL(file, mtTarget));
