import { VIDEO_INPUT_LIMIT, VIDEO_DURATION_LIMIT, VIDEO_MIME_TYPES } from './media-limits.js';

const abortError = () => new DOMException('已取消处理', 'AbortError');

// Read metadata and a thumbnail through the browser. Never load WASM, transcode,
// or read the entire original into an ArrayBuffer (it may be 1 GB).
export async function prepareOriginalVideo(file, {signal, onProgress = () => {}} = {}) {
  if (signal?.aborted) throw abortError();
  if (!file.size || file.size > VIDEO_INPUT_LIMIT) throw new Error('视频原文件不能超过 1 GB。');
  const extension = file.name?.split('.').pop()?.toLowerCase();
  const type = VIDEO_MIME_TYPES.includes(file.type?.split(';')[0]) ? file.type.split(';')[0]
    : ({mp4:'video/mp4',m4v:'video/mp4',mov:'video/quicktime',webm:'video/webm'})[extension];
  if (!VIDEO_MIME_TYPES.includes(type)) throw new Error('原片上传支持 MP4、MOV、WebM，请选择视频文件。');
  const photo = file.type === type ? file : new Blob([file], {type});
  const url = URL.createObjectURL(photo);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  let timer, abort;
  onProgress({label:'正在读取原片时长和封面，不压缩…',percent:null});
  try {
    await new Promise((resolve,reject) => {
      abort = () => reject(abortError());
      signal?.addEventListener('abort',abort,{once:true});
      timer = setTimeout(() => reject(new Error('浏览器无法读取原片，请尝试「智能清晰」或换一个浏览器。')),30000);
      video.onerror = () => reject(new Error('当前浏览器无法读取此视频编码，请选择「智能清晰」转换后上传。'));
      video.onloadedmetadata = () => {
        if (!Number.isFinite(video.duration) || video.duration <= 0)
          reject(new Error('视频时长无效，请尝试「智能清晰」转换。'));
        else if (video.duration > VIDEO_DURATION_LIMIT)
          reject(new Error(`视频最长支持 ${VIDEO_DURATION_LIMIT / 60} 分钟，请先裁剪后再上传。`));
      };
      video.onloadeddata = () => {
        if (video.videoWidth > 0 && video.videoHeight > 0) resolve();
        else reject(new Error('视频没有可读取的画面，请尝试「智能清晰」。'));
      };
      video.src = url;
    });
    if (signal?.aborted) throw abortError();
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 360 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
    return {photo, poster:canvas.toDataURL('image/jpeg',0.7), videoMeta:{
      duration:video.duration, originalBytes:file.size, keptOriginal:true, uncompressed:true,
    }};
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort',abort);
    video.onloadeddata = video.onloadedmetadata = video.onerror = null;
    video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url);
  }
}
