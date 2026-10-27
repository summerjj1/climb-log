import {prepareOriginalVideo} from './video-original.js';
const abortError = () => new DOMException('已取消处理','AbortError');

export async function compressFastVideo(file,{signal,onProgress=()=>{},onControl=()=>{},onState=()=>{}}={}) {
  if (signal?.aborted) throw abortError();
  if (typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined' || typeof Worker === 'undefined')
    throw new Error('当前浏览器不支持快速压缩，请选择「智能清晰」或「不压缩」。');
  const worker = new Worker(new URL('./video-fast-worker.js',import.meta.url),{type:'module'});
  let state='running',closed=false,timer,startedAt,remaining=45*60*1000,abort;
  const arm = reject => {startedAt=performance.now();timer=setTimeout(()=>reject(new Error('快速压缩超时，请换短一些的视频。')),remaining);};
  const stopTimer = () => {clearTimeout(timer);remaining=Math.max(1,remaining-(performance.now()-startedAt));};
  const control = {
    supported:true,
    pause(){if(!closed&&state==='running'){state='pausing';stopTimer();onState(state);worker.postMessage({type:'pause'});}},
    resume(){if(!closed&&state==='paused'){worker.postMessage({type:'resume'});}},
  };
  let result;
  try {
    result=await new Promise((resolve,reject)=>{
      abort=()=>reject(abortError());
      signal?.addEventListener('abort',abort,{once:true});
      worker.onerror=()=>reject(new Error('快速压缩未能启动，请刷新重试或选择「智能清晰」。'));
      worker.onmessage=({data})=>{
        if(closed || signal?.aborted)return;
        if(data.type==='error')reject(new Error(data.message));
        if(data.type==='progress')onProgress(data);
        if(data.type==='result')resolve(data);
        if(data.type==='state'){
          if(data.state==='running'&&state!=='running')arm(reject);
          state=data.state;onState(state);
        }
      };
      arm(reject);
      worker.postMessage({type:'start',file});
      onControl(control);
    });
  } finally {
    closed=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
    worker.terminate();onControl(null);
  }
  if(signal?.aborted)throw abortError();
  onProgress({label:'正在生成视频预览…',percent:99});
  const preview=await prepareOriginalVideo(result.photo,{signal,onProgress:()=>{}});
  if(Math.abs(preview.videoMeta.duration-result.duration)>.6)throw new Error('快速压缩时长校验失败，请选择「智能清晰」。');
  return {...preview,videoMeta:{duration:result.duration,originalBytes:file.size,fastCompressed:true,width:result.width,height:result.height}};
}
