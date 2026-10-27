import {Input, BlobSource, ALL_FORMATS, Output, Mp4OutputFormat, AppendOnlyStreamTarget, Conversion, canEncodeVideo} from 'mediabunny';
import {VIDEO_INPUT_LIMIT, VIDEO_DURATION_LIMIT, MEDIA_STORAGE_LIMIT} from './media-limits.js';

let conversion, input, pauseSignal, resumeWake;
let paused = false;
const progress = (label, percent = null) => postMessage({type:'progress', label, percent});
const unsupported = '此设备或视频编码不支持快速压缩，请选择「智能清晰」或「不压缩」。';
self.onmessage = ({data}) => {
  if (data.type === 'start') run(data.file).catch(error => postMessage({type:'error',message:/[\u4e00-\u9fff]/.test(error.message || '') ? error.message : unsupported}));
  if (data.type === 'pause') { paused = true; pauseSignal?.abort(); postMessage({type:'state',state:'pausing'}); }
  if (data.type === 'resume') { paused = false; resumeWake?.(); resumeWake = null; postMessage({type:'state',state:'running'}); }
};
async function checkpoint() {
  if (paused) {
    postMessage({type:'state',state:'paused'});
    await new Promise(resolve => {resumeWake = resolve;});
  }
}
async function run(file) {
  if (!file.size || file.size > VIDEO_INPUT_LIMIT) throw new Error('视频原文件不能超过 1 GB。');
  if (typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined') throw new Error(unsupported);
  const parts = [];
  let bytes = 0;
  try {
    progress('正在检查快速压缩兼容性…');
    input = new Input({source:new BlobSource(file),formats:ALL_FORMATS});
    const video = await input.getPrimaryVideoTrack();
    const audio = await input.getPrimaryAudioTrack();
    if (!video) throw new Error('视频没有可读取的画面。');
    const duration = await input.computeDuration();
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('无法读取视频时长，请选择「智能清晰」。');
    if (duration > VIDEO_DURATION_LIMIT) throw new Error('视频最长支持 20 分钟，请先裁剪后再上传。');
    if (await video.hasHighDynamicRange()) throw new Error('此视频为 HDR，请选择「不压缩」保留原色彩。');
    const w = await video.getDisplayWidth(), h = await video.getDisplayHeight();
    if (!w || !h || w*h > 3840*2160) throw new Error('快速压缩支持最高 4K 输入，请先降低分辨率。');
    const scale = Math.min(1,1920/Math.max(w,h),1080/Math.min(w,h));
    const width = Math.max(2,Math.floor(w*scale/2)*2), height = Math.max(2,Math.floor(h*scale/2)*2);
    progress('正在检查视频帧率…');
    const stats = await video.computePacketStats(100);
    const frameRate = Math.min(30,stats.averagePacketRate || 30);
    const bitrate = Math.min(5_000_000,Math.floor(MEDIA_STORAGE_LIMIT*.85*8/duration)-192_000);
    progress('正在检测硬件编码器…');
    if (!await canEncodeVideo('avc',{width,height,bitrate,frameRate,hardwareAcceleration:'prefer-hardware'})) throw new Error(unsupported);
    await checkpoint();
    const target = new AppendOnlyStreamTarget(new WritableStream({write(chunk) {
      bytes += chunk.byteLength;
      if (bytes > MEDIA_STORAGE_LIMIT) throw new Error('快速压缩结果超过 1 GB，请选择「清晰」或「更省空间」。');
      parts.push(new Blob([chunk]));
    }}));
    const output = new Output({format:new Mp4OutputFormat({fastStart:'fragmented',minimumFragmentDuration:2}),target});
    progress('正在准备快速压缩…');
    conversion = await Conversion.init({input,output,
      video:track => track.id === video.id ? {codec:'avc',width,height,fit:'contain',frameRate,bitrate,hardwareAcceleration:'prefer-hardware',forceTranscode:true,allowTransformationMetadata:false} : {discard:true},
      audio:track => track.id === audio?.id ? {codec:'aac',bitrate:128_000,numberOfChannels:2,sampleRate:48000} : {discard:true},
      tags:{},showWarnings:false,
    });
    if (!conversion.isValid || !conversion.utilizedTracks.includes(video) || (audio && !conversion.utilizedTracks.includes(audio))) throw new Error(unsupported);
    let lastPercent = -1;
    conversion.onProgress = value => {
      const percent = Math.min(99,Math.floor(value*100));
      if(percent !== lastPercent) {lastPercent=percent;progress('正在快速压缩 · 优先硬件加速，保留原速和声音…',percent);}
    };
    while (conversion.state !== 'done') {
      await checkpoint();
      pauseSignal = new AbortController();
      await conversion.execute({pauseSignal:pauseSignal.signal});
      pauseSignal = null;
    }
    const photo = new Blob(parts,{type:'video/mp4'});
    if (!photo.size) throw new Error('快速压缩结果为空，请换一种模式。');
    // Validate the complete output before handing it back to the UI.
    const check = new Input({source:new BlobSource(photo),formats:ALL_FORMATS});
    try {
      const resultDuration = await check.computeDuration();
      if(Math.abs(resultDuration-duration) > .6 || !await check.getPrimaryVideoTrack() || (audio && !await check.getPrimaryAudioTrack()))
        throw new Error('快速压缩后的画面、声音或时长不完整，请选择「智能清晰」。');
    } finally {check.dispose();}
    await checkpoint();
    postMessage({type:'result',photo,duration,width,height});
  } catch(error) {
    await conversion?.cancel().catch(()=>{});
    throw error;
  } finally {input?.dispose();parts.length=0;}
}
