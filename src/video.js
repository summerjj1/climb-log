import { createVideoControl } from './video-control.js';
import { videoCoreUrl } from './video-core-url.js';
import { prepareOriginalVideo } from './video-original.js';
import { VIDEO_COMPRESSION_LIMIT, VIDEO_ORIGINAL_ENABLED, VIDEO_MIME_TYPES, VIDEO_INPUT_LIMIT, MEDIA_STORAGE_LIMIT, VIDEO_DURATION_LIMIT, VIDEO_DEFAULT_QUALITY } from './media-limits.js';
export { VIDEO_INPUT_LIMIT, MEDIA_STORAGE_LIMIT, VIDEO_DURATION_LIMIT } from './media-limits.js';
export {isVideo} from './route-media.js';
export const formatBytes = (bytes) => bytes < 1024 * 1024
  ? `${(bytes / 1024).toFixed(1)} KB`
  : `${(bytes / 1024 / 1024).toFixed(2)} MB`;
export const formatDuration = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
export const safePoster = (value) => typeof value === 'string' && value.length < 200000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(value) ? value : '';
const abortError = () => new DOMException('已取消处理', 'AbortError');

// One isolated worker per video: cancellation also releases its WASM memory.
export async function compressVideo(file, { quality = VIDEO_DEFAULT_QUALITY, signal, onProgress = () => {}, onControl = () => {}, onState = () => {} } = {}) {
  if (!file.size || file.size > VIDEO_INPUT_LIMIT) throw new Error(`视频原文件不能超过 ${VIDEO_INPUT_LIMIT / 1024 ** 3} GB。`);
  if (signal?.aborted) throw abortError();
  if (quality === 'fast') {
    if (!VIDEO_ORIGINAL_ENABLED) throw new Error('当前版本不支持快速压缩。');
    const {compressFastVideo} = await import('./video-fast.js');
    return compressFastVideo(file,{signal,onProgress,onControl,onState});
  }
  if (quality === 'original') {
    if (!VIDEO_ORIGINAL_ENABLED) throw new Error('当前版本不支持原片上传。');
    return prepareOriginalVideo(file, {signal, onProgress});
  }
  let engine, timedOut = false, timer, startedAt;
  let remainingMs = 45 * 60 * 1000;
  const stop = () => engine?.terminate();
  const armTimer = () => {
    startedAt = performance.now();
    timer = setTimeout(() => { timedOut = true; control.dispose(); stop(); }, remainingMs);
  };
  const control = createVideoControl({ signal, onState: state => {
    if (state === 'pausing') {
      clearTimeout(timer);
      remainingMs = Math.max(1, remainingMs - (performance.now() - startedAt));
    } else if (state === 'running' && !signal?.aborted) armTimer();
    onState(state);
  }});
  armTimer();
  onControl(control);
  signal?.addEventListener('abort', stop, { once: true });
  const availableThreads = control.supported ? Math.min(navigator.deviceMemory && navigator.deviceMemory <= 4 ? 2 : 4, navigator.hardwareConcurrency || 2) : 1;
  // Cheap original/remux candidates do not need a pool of encoding workers.
  const deferMultithread = quality === 'auto' && file.size <= VIDEO_COMPRESSION_LIMIT;
  let threads = deferMultithread ? 1 : availableThreads;
  try {
    onProgress({ label: '正在加载视频工具（首次需要下载，后续使用缓存）…', percent: null });
    const { FFmpeg } = await import('@ffmpeg/ffmpeg');
    await control.checkpoint();
    const load = async multithread => {
      engine = new FFmpeg();
      const base = multithread ? '/vendor/ffmpeg-mt/' : '/vendor/ffmpeg/';
      const core = await videoCoreUrl(base, signal);
      try { await engine.load({
        classWorkerURL: new URL('/vendor/ffmpeg/worker-pause-v1.js', location.origin).href,
        coreURL: new URL(`${base}ffmpeg-core.js`, location.origin).href,
        wasmURL: core.url,
        ...(multithread ? {workerURL: new URL(`${base}ffmpeg-core.worker.js`, location.origin).href} : {}),
        pauseBuffer: control.buffer,
      }); } finally { core.release(); }
    };
    const loadWithFallback = async () => {
      try { await load(threads > 1); }
      catch (error) {
        stop();
        if (signal?.aborted || timedOut || threads === 1) throw error;
        threads = 1;
        onProgress({ label: '正在切换兼容模式…', percent: null });
        await load(false);
      }
      await control.checkpoint();
    };
    const mountSource = async () => {
      // Read slices instead of copying a multi-GB file into WASM memory.
      await engine.createDir('/source');
      const mounted = await engine.mount('WORKERFS', { blobs: [{ name: 'input', data: file }] }, '/source');
      if (!mounted) throw new Error('当前压缩工具不支持大文件读取，请刷新页面后重试。');
    };
    await loadWithFallback();
    onProgress({ label: '正在检查视频…', percent: null });
    await mountSource();
    const probe = async (path, output) => {
      const code = await engine.ffprobe(['-v', 'error', '-show_format', '-show_streams', '-of', 'json', path, '-o', output]);
      // core 0.12.10 may leave its return sentinel at -1 after a successful probe.
      // Require a parseable output file and valid media fields below.
      if (code > 0) throw new Error('无法读取视频，请使用 MP4、MOV 或 WebM 文件。');
      const info = JSON.parse(await engine.readFile(output, 'utf8'));
      const video = info.streams?.find(s => s.codec_type === 'video' && !s.disposition?.attached_pic);
      const duration = Number(info.format?.duration || video?.duration);
      if (!video || !Number.isFinite(duration) || duration <= 0) throw new Error('视频没有有效画面或时长。');
      return { ...info, video, duration };
    };
    const source = await probe('/source/input', 'source.json');
    await control.checkpoint();
    if (source.duration > VIDEO_DURATION_LIMIT) throw new Error(`视频最长支持 ${VIDEO_DURATION_LIMIT / 60} 分钟，请先裁剪后再上传。`);
    if (source.video.width * source.video.height > 3840 * 2160) throw new Error('视频分辨率超过 4K，请先降低分辨率。');
    const audio = source.streams.filter(s => s.codec_type === 'audio');
    // ffprobe uses the same demuxer name for MOV and MP4; require an MP4 brand too.
    const mp4Brand = /^(isom|iso[2-9]|mp4[12]|avc1|M4V|MSNV|dash)$/.test(String(source.format.tags?.major_brand || '').trim());
    const compatibleCodecs = source.video.codec_name === 'h264' &&
      source.video.pix_fmt === 'yuv420p' && audio.every(s => s.codec_name === 'aac');
    const compatible = mp4Brand && compatibleCodecs;
    let remuxed = false;
    let keptOriginal = quality === 'auto' && file.size <= VIDEO_COMPRESSION_LIMIT && compatible;
    let photo;
    let previewPath = '/source/input';
    if (keptOriginal) {
      // Do not encode compatible files just to discover they were already small enough.
      photo = new Blob([file], { type: 'video/mp4' });
    } else {
      // MOV with H.264/AAC can be repackaged without re-encoding its frames.
      if (quality === 'auto' && file.size <= VIDEO_COMPRESSION_LIMIT && compatibleCodecs) {
        onProgress({label: '正在无损转为 MP4，不重新压缩画面…', percent: null});
        const remuxCode = await engine.exec(['-i', '/source/input', '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy', '-sn', '-map_metadata', '-1', '-movflags', '+faststart', 'remux.mp4']);
        await control.checkpoint();
        if (remuxCode === 0) {
          const output = await probe('remux.mp4', 'remux.json');
          const candidate = new Blob([await engine.readFile('remux.mp4')], {type:'video/mp4'});
          if (candidate.size <= VIDEO_COMPRESSION_LIMIT && Math.abs(output.duration - source.duration) <= 0.6) {
            photo = candidate; remuxed = true; previewPath = 'remux.mp4';
          }
        }
        if (!remuxed) await engine.deleteFile('remux.mp4').catch(() => {});
      }
      if (!photo) {
        if (deferMultithread && availableThreads > 1) {
          stop();
          threads = availableThreads;
          onProgress({label: '正在准备多核压缩…', percent: null});
          await loadWithFallback();
          await mountSource();
        }
        const edge = quality === 'small' ? 854 : 1280;
        const audioKbps = quality === 'small' ? 64 : 128;
        // Reserve 10% for container overhead and encoder rate variation.
        const budgetKbps = Math.floor(VIDEO_COMPRESSION_LIMIT * 0.9 * 8 / source.duration / 1000);
        const videoKbps = Math.min(quality === 'small' ? 600 : 2500, budgetKbps - audioKbps);
        const scale = `scale=w='trunc(iw*min(1,min(${edge}/iw,${edge}/ih))/2)*2':h='trunc(ih*min(1,min(${edge}/iw,${edge}/ih))/2)*2',setsar=1`;
        let lastPercent = 0;
        engine.on('progress', ({ progress }) => {
          if (signal?.aborted) return;
          lastPercent = Math.max(lastPercent, Math.min(99, Math.floor((progress || 0) * 100)));
          onProgress({ label: threads > 1 ? `正在使用 ${threads} 核压缩，保留原速和声音…` : '正在压缩，保留原速和声音…', percent: lastPercent });
        });
        onProgress({ label: threads > 1 ? `正在使用 ${threads} 核压缩，保留原速和声音…` : '正在压缩，保留原速和声音…', percent: 0 });
        const code = await engine.exec([
          '-filter_threads', '1', '-threads', String(threads), '-i', '/source/input', '-map', '0:v:0', '-map', '0:a:0?',
          '-vf', scale, '-fpsmax', quality === 'small' ? '24' : '30', '-c:v', 'libx264', '-preset', 'veryfast',
          '-crf', quality === 'small' ? '32' : '23', '-pix_fmt', 'yuv420p', '-threads', String(threads),
          '-maxrate', `${videoKbps}k`, '-bufsize', `${videoKbps * 2}k`,
          '-c:a', 'aac', '-b:a', `${audioKbps}k`, '-ac', '2', '-sn', '-map_metadata', '-1',
          '-movflags', '+faststart', 'output.mp4',
        ]);
        await control.checkpoint();
        if (code !== 0) throw new Error('压缩未完成，请尝试更短的视频或「更省空间」。');
        const output = await probe('output.mp4', 'output.json');
        if (Math.abs(output.duration - source.duration) > 0.6) throw new Error('处理后时长不完整，请换一个视频重试。');
        photo = new Blob([await engine.readFile('output.mp4')], { type: 'video/mp4' });
        if (photo.size >= file.size && file.size <= VIDEO_COMPRESSION_LIMIT && compatible) {
          photo = new Blob([file], { type: 'video/mp4' });
          keptOriginal = true;
        } else {
          previewPath = 'output.mp4';
        }
      }
    }
    if (photo.size > VIDEO_COMPRESSION_LIMIT) throw new Error(`处理后仍超过 ${VIDEO_COMPRESSION_LIMIT / 1024 ** 2} MB，请选择「更省空间」或先裁短视频。`);
    if (!photo.size) throw new Error('压缩结果为空，请重试。');
    await control.checkpoint();
    onProgress({ label: '正在生成预览…', percent: 99 });
    const thumbCode = await engine.exec(['-filter_threads', '1', '-threads', '1', '-i', previewPath, '-threads', '1', '-frames:v', '1', '-vf', "scale=w='trunc(iw*min(1,min(360/iw,360/ih))/2)*2':h='trunc(ih*min(1,min(360/iw,360/ih))/2)*2'", '-q:v', '5', 'poster.jpg']);
    if (thumbCode !== 0) throw new Error('无法生成视频封面，请重试。');
    const posterBytes = await engine.readFile('poster.jpg');
    let binary = '';
    for (const byte of posterBytes) binary += String.fromCharCode(byte);
    const poster = `data:image/jpeg;base64,${btoa(binary)}`;
    await control.checkpoint();
    return { photo, poster, videoMeta: { duration: source.duration, originalBytes: file.size, keptOriginal, remuxed, processingThreads: threads } };
  } catch (error) {
    if (signal?.aborted) throw abortError();
    if (timedOut) throw new Error('处理超时，请换更短的视频，或在电脑上重试。');
    if (error instanceof Error && !/memory|wasm|fetch|worker|aborted/i.test(error.message)) throw error;
    throw new Error('压缩工具未能完成处理，请检查网络，或换较短的视频并在电脑上重试。');
  } finally {
    control.dispose();
    onControl(null);
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
    stop();
  }
}

// Restoring a backup must not recompress or change the duration of saved media.
export async function inspectSavedVideo(blob) {
  if (blob.size > MEDIA_STORAGE_LIMIT || !blob.size) throw new Error(`备份视频超过 ${MEDIA_STORAGE_LIMIT / 1024 ** 2} MB 或内容为空。`);
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.preload = 'metadata';
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('无法读取备份视频。')), 15000);
      video.onloadedmetadata = () => { clearTimeout(timer); resolve(); };
      video.onerror = () => { clearTimeout(timer); reject(new Error('备份视频格式无法播放。')); };
      video.src = url;
    });
    if (!Number.isFinite(video.duration) || video.duration <= 0 || video.duration > VIDEO_DURATION_LIMIT + 0.6)
      throw new Error(`备份视频时长无效或超过 ${VIDEO_DURATION_LIMIT / 60} 分钟。`);
    return { duration: video.duration };
  } finally {
    video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url);
  }
}
