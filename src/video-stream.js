const sessions=new Map();
let registration;
if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', async event => {
  if (event.data?.kind !== 'panlemei-video-read' || !event.ports[0]) return;
  const port=event.ports[0], session=sessions.get(event.data.token);
  try {
    if (!session || session.signal.aborted) throw new Error('closed');
    const {source,signal}=session;
    if (event.data.operation==='info') port.postMessage({size:source.size,type:source.type});
    else if (event.data.operation==='read') {
      const buffer=await source.read(event.data.start,event.data.end);
      signal.throwIfAborted();
      port.postMessage({buffer},[buffer]);
    } else throw new Error('invalid request');
  } catch(error) {
    port.postMessage({error:true});
    if (session && !session.signal.aborted) session.onError(error);
  } finally { port.close(); }
});

async function controlled() {
  if (!('serviceWorker' in navigator) || !isSecureContext) throw new Error('当前浏览器不支持分段播放，请使用新版浏览器，或点击下载视频');
  registration ??= navigator.serviceWorker.register(`${import.meta.env.BASE_URL}video-stream-sw.js`,{scope:import.meta.env.BASE_URL,updateViaCache:'none'}).catch(error => {registration=null;throw error;});
  const reg=await registration;
  if (navigator.serviceWorker.controller?.scriptURL === new URL(`${import.meta.env.BASE_URL}video-stream-sw.js`,location.href).href) return;
  await new Promise((resolve,reject) => {
    const check=()=>{if(navigator.serviceWorker.controller && navigator.serviceWorker.controller.scriptURL===reg.active?.scriptURL){cleanup();resolve();}};
    const cleanup=()=>{clearTimeout(timer);navigator.serviceWorker.removeEventListener('controllerchange',check);};
    const timer=setTimeout(()=>{cleanup();reject(new Error('播放器准备超时，请重试'));},15000);
    navigator.serviceWorker.addEventListener('controllerchange',check);check();
  });
}

export async function streamingURL(source,{signal,onError=()=>{}}) {
  signal.throwIfAborted();
  if(source.url) return source.url;
  await controlled();
  signal.throwIfAborted();
  const token=crypto.randomUUID();
  sessions.set(token,{source,signal,onError});
  signal.addEventListener('abort',()=>sessions.delete(token),{once:true});
  return `${import.meta.env.BASE_URL}__video_stream/${token}`;
}
