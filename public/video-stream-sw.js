// Only virtual media URLs are intercepted. No app, API or private file caching.
const prefix = new URL('./__video_stream/', self.registration.scope).pathname;
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

async function ask(client, token, request) {
  const channel = new MessageChannel();
  return new Promise((resolve, reject) => {
    const finish = (error, value) => {
      clearTimeout(timer); channel.port1.close();
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('timeout')), 60000);
    channel.port1.onmessage = ({data}) => data?.error ? finish(new Error('unavailable')) : finish(null, data);
    client.postMessage({kind:'panlemei-video-read',token,...request}, [channel.port2]);
  });
}

function rangeOf(value, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value || '');
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0,size-Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size-1,Number(match[2])) : size-1;
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start>=0 && start<=end && start<size ? {start,end} : null;
}

async function serve(event, token) {
  const client = await self.clients.get(event.clientId);
  const headers = {'Cache-Control':'no-store','Cross-Origin-Resource-Policy':'same-origin','Accept-Ranges':'bytes'};
  if (!client) return new Response(null,{status:403,headers});
  try {
    const info = await ask(client,token,{operation:'info'});
    if (!Number.isSafeInteger(info.size) || info.size<=0) throw new Error('invalid size');
    headers['Content-Type'] = info.type;
    if (event.request.method === 'HEAD') return new Response(null,{headers:{...headers,'Content-Length':String(info.size)}});
    const rangeHeader = event.request.headers.get('Range');
    const range = rangeHeader ? rangeOf(rangeHeader,info.size) : {start:0,end:info.size-1};
    if (!range) return new Response(null,{status:416,headers:{...headers,'Content-Range':`bytes */${info.size}`}});
    // A bounded 206 lets the media engine request subsequent / seek ranges.
    // No-Range clients get a backpressured stream, never a fully assembled Blob.
    const end = rangeHeader ? Math.min(range.end,range.start+1024*1024-1) : range.end;
    headers['Content-Length'] = String(end-range.start+1);
    if (rangeHeader) headers['Content-Range'] = `bytes ${range.start}-${end}/${info.size}`;
    let cursor=range.start, cancelled=false;
    const body=new ReadableStream({
      async pull(controller) {
        if (cancelled) return;
        try {
          const last=Math.min(end,cursor+1024*1024-1);
          const {buffer}=await ask(client,token,{operation:'read',start:cursor,end:last});
          if (cancelled) return;
          if (!(buffer instanceof ArrayBuffer) || buffer.byteLength!==last-cursor+1) throw new Error('incomplete');
          controller.enqueue(new Uint8Array(buffer)); cursor=last+1;
          if(cursor>end) controller.close();
        } catch(error) { if(!cancelled) controller.error(error); }
      },
      cancel() {cancelled=true;},
    }, {highWaterMark:0});
    return new Response(body,{status:rangeHeader?206:200,headers});
  } catch { return new Response(null,{status:503,headers}); }
}
self.addEventListener('fetch', event => {
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin || !url.pathname.startsWith(prefix)) return;
  const token=url.pathname.slice(prefix.length);
  if(!/^[a-f0-9-]{36}$/.test(token) || !['GET','HEAD'].includes(event.request.method)) {
    event.respondWith(new Response(null,{status:404})); return;
  }
  event.respondWith(serve(event,token));
});
