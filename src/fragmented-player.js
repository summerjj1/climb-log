// Fast-compressed files contain an init segment and a trailing random-access
// index. Feed only the selected fragments to MSE, avoiding the native player's
// full-file scan of MP4 fragments with initially unknown duration.
function boxes(buffer,start=0,end=buffer.byteLength) {
  const view=new DataView(buffer), result=[];
  while(start+8<=end) {
    let size=view.getUint32(start),header=8;
    const type=String.fromCharCode(...new Uint8Array(buffer,start+4,4));
    if(size===1){if(start+16>end)break;size=Number(view.getBigUint64(start+8));header=16;}
    if(!size)size=end-start;
    if(!Number.isSafeInteger(size)||size<header||start+size>end)break;
    result.push({type,offset:start,start:start+header,end:start+size});start+=size;
  }
  return result;
}
const child=(buffer,box,type)=>boxes(buffer,box.start,box.end).find(b=>b.type===type);
export function fragmentIndex(head,tail,total) {
  const view=new DataView(head), moov=boxes(head).find(b=>b.type==='moov');
  if(!moov || !child(head,moov,'mvex'))return null;
  let track,scale,codec,hasAudio=false;
  for(const trak of boxes(head,moov.start,moov.end).filter(b=>b.type==='trak')) {
    const mdia=child(head,trak,'mdia'), tkhd=child(head,trak,'tkhd');
    if(!mdia||!tkhd)continue;
    const handler=child(head,mdia,'hdlr'),mdhd=child(head,mdia,'mdhd');
    if(!handler || handler.start+12>handler.end || !mdhd)continue;
    const kind=String.fromCharCode(...new Uint8Array(head,handler.start+8,4));
    if(kind==='soun')hasAudio=true;
    if(kind!=='vide')continue;
    track=view.getUint32(tkhd.start+(view.getUint8(tkhd.start)===1?20:12));
    scale=view.getUint32(mdhd.start+(view.getUint8(mdhd.start)===1?20:12));
    const minf=child(head,mdia,'minf'),stbl=minf&&child(head,minf,'stbl'),stsd=stbl&&child(head,stbl,'stsd');
    const avc=stsd&&boxes(head,stsd.start+8,stsd.end).find(b=>b.type==='avc1');
    const config=avc&&boxes(head,avc.start+78,avc.end).find(b=>b.type==='avcC');
    if(config && config.start+4<=config.end)codec='avc1.'+Array.from(new Uint8Array(head,config.start+1,3),n=>n.toString(16).padStart(2,'0')).join('');
  }
  if(!track||!scale||!codec || tail.byteLength<16)return null;
  const tv=new DataView(tail),length=tv.getUint32(tail.byteLength-4),local=tail.byteLength-length;
  if(length<16||local<0)return null;
  const mfra=boxes(tail,local).find(b=>b.type==='mfra');
  if(!mfra)return null;
  const tfra=boxes(tail,mfra.start,mfra.end).find(b=>b.type==='tfra'&&b.end-b.start>=16&&tv.getUint32(b.start+4)===track);
  if(!tfra)return null;
  const version=tv.getUint8(tfra.start),sizes=tv.getUint32(tfra.start+8),count=tv.getUint32(tfra.start+12);
  const width=version===1?8:4,skip=((sizes>>4)&3)+1+((sizes>>2)&3)+1+(sizes&3)+1;
  if(version>1||count<1||count>10000||tfra.start+16+count*(2*width+skip)>tfra.end)return null;
  const entries=[];let p=tfra.start+16;
  for(let i=0;i<count;i++) {
    const time=(width===8?Number(tv.getBigUint64(p)):tv.getUint32(p))/scale;p+=width;
    const offset=width===8?Number(tv.getBigUint64(p)):tv.getUint32(p);p+=width+skip;
    if(!Number.isFinite(time)||!Number.isSafeInteger(offset)||offset<moov.end||offset>=total-length)return null;
    if(entries.length && (time<=entries.at(-1).time||offset<=entries.at(-1).offset))return null;
    entries.push({time,offset});
  }
  return {init:head.slice(0,moov.end),entries,end:total-length,mime:`video/mp4; codecs="${codec}${hasAudio?', mp4a.40.2':''}"`};
}

export async function fragmentedPlayback(source,route,{signal,onError}) {
  if(!route.videoMeta?.fastCompressed || !source.read || !globalThis.MediaSource) return null;
  const head=await source.read(0,Math.min(source.size,4194304)-1);
  const tail=await source.read(Math.max(0,source.size-131072),source.size-1);
  signal.throwIfAborted();
  const index=fragmentIndex(head,tail,source.size);
  if(!index || !MediaSource.isTypeSupported(index.mime))return null;
  const media=new MediaSource(),url=URL.createObjectURL(media);
  signal.addEventListener('abort',()=>URL.revokeObjectURL(url),{once:true});
  return {url,attach(video) {
    let buffer,busy=false,generation=0,next=0,initialized=false;
    const duration=route.videoMeta.duration;
    const append=bytes=>new Promise((resolve,reject)=>{
      const done=()=>{cleanup();resolve();},fail=()=>{cleanup();reject(new Error('视频解码失败'));};
      const abort=()=>{cleanup();reject(new DOMException('已停止','AbortError'));};
      const cleanup=()=>{buffer.removeEventListener('updateend',done);buffer.removeEventListener('error',fail);signal.removeEventListener('abort',abort);};
      buffer.addEventListener('updateend',done,{once:true});buffer.addEventListener('error',fail,{once:true});signal.addEventListener('abort',abort,{once:true});
      try {signal.throwIfAborted();buffer.appendBuffer(bytes);}catch(error){cleanup();reject(error);}
    });
    const buffered=()=>{
      for(let i=0;i<video.buffered.length;i++)if(video.currentTime>=video.buffered.start(i)&&video.currentTime<video.buffered.end(i))return video.buffered.end(i)-video.currentTime;
      return 0;
    };
    const pump=async()=>{
      if(busy||!initialized||signal.aborted||next>=index.entries.length)return;
      busy=true;
      try {
        while(!signal.aborted && next<index.entries.length && buffered()<8 && (!video.paused||video.seeking||video.readyState<2)) {
          const epoch=generation,position=next,start=index.entries[position].offset,end=(index.entries[position+1]?.offset??index.end)-1;
          // A fragment is appended atomically, so a seek cannot mix two fragments.
          if(end-start>64*1024**2)throw new Error('视频片段过大，请下载后播放');
          const pieces=[];
          for(let p=start;p<=end;p+=4194304) {
            pieces.push(await source.read(p,Math.min(end,p+4194304-1)));
            if(signal.aborted||epoch!==generation)break;
          }
          signal.throwIfAborted();if(epoch!==generation)continue;
          const bytes=await new Blob(pieces).arrayBuffer();
          signal.throwIfAborted();if(epoch!==generation)continue;
          await append(bytes);if(epoch===generation)next=position+1;
          // Bound decoded-media buffering on long videos. Backward seeks reload.
          if(video.currentTime>45 && buffer.buffered.length && buffer.buffered.start(0)<video.currentTime-40) {
            await new Promise((resolve,reject)=>{
              const abort=()=>{buffer.removeEventListener('updateend',done);reject(new DOMException('已停止','AbortError'));};
              const done=()=>{signal.removeEventListener('abort',abort);resolve();};
              signal.addEventListener('abort',abort,{once:true});buffer.addEventListener('updateend',done,{once:true});buffer.remove(0,video.currentTime-30);
            });
          }
        }
        if(next>=index.entries.length && media.readyState==='open' && !buffer.updating)media.endOfStream();
      } catch(error) {if(!signal.aborted)onError(error);}
      finally {busy=false;}
    };
    const seek=()=>{
      if(!initialized||signal.aborted)return;
      if(buffered()<1) {
        generation++;
        next=Math.max(0,index.entries.findLastIndex(e=>e.time<=video.currentTime));
      }
      void pump();
    };
    const tick=()=>void pump();
    video.addEventListener('seeking',seek);video.addEventListener('timeupdate',tick);video.addEventListener('play',tick);
    signal.addEventListener('abort',()=>{
      video.removeEventListener('seeking',seek);video.removeEventListener('timeupdate',tick);video.removeEventListener('play',tick);
    },{once:true});
    media.addEventListener('sourceopen',async()=>{
      if(initialized||signal.aborted)return;
      try {
        buffer=media.addSourceBuffer(index.mime);media.duration=duration;
        await append(index.init);signal.throwIfAborted();initialized=true;void pump();
      }catch(error){if(!signal.aborted)onError(error);}
    },{once:true});
  }};
}
