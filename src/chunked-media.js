import {VIDEO_MIME_TYPES,mediaStorageLimit} from './media-limits.js';
import {retryableUploadError} from './upload-errors.js';
export const CHUNK_SIZE=4*1024**2;
export const CHUNK_THRESHOLD=8*1024**2;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

// Application-level private objects; no S3/COS credentials or public permissions.
export function mediaPaths(route,userId) {
  const base=route.photoPath;
  if(typeof base!=='string'||!base.startsWith(`${userId}/`)||base.split('/').some(s=>s==='..'||s==='.')||base.includes('\\'))throw new Error('云端文件路径无效');
  const manifest=route.photoParts;
  if(!manifest)return [base];
  if(manifest.version!==1||!VIDEO_MIME_TYPES.includes(manifest.type)||!Number.isSafeInteger(manifest.size)||manifest.size<=0||manifest.size>mediaStorageLimit(manifest.type)||!Array.isArray(manifest.parts)||manifest.parts.length!==Math.ceil(manifest.size/CHUNK_SIZE))throw new Error('云端视频分块信息无效');
  return manifest.parts.map((part,index)=>{
    if(part.path!==`${base}.parts/${String(index).padStart(4,'0')}`||part.size!==Math.min(CHUNK_SIZE,manifest.size-index*CHUNK_SIZE))throw new Error('云端视频分块路径或大小无效');
    return part.path;
  });
}
export async function uploadChunks(bucket,base,blob,{onProgress=()=>{},wait=sleep}={}) {
  const parts=Array.from({length:Math.ceil(blob.size/CHUNK_SIZE)},(_,index)=>({path:`${base}.parts/${String(index).padStart(4,'0')}`,size:Math.min(CHUNK_SIZE,blob.size-index*CHUNK_SIZE)}));
  const completed=[];let next=0,loaded=0,failure;
  const uploadOne=async index=>{
    const part=parts[index],body=blob.slice(index*CHUNK_SIZE,index*CHUNK_SIZE+part.size,blob.type);
    for(let attempt=0;attempt<3;attempt++){
      try{
        const result=await bucket.upload(part.path,body,{contentType:blob.type,upsert:false});
        if(result.error)throw result.error;
        return;
      }catch(error){
        // A lost response may have committed this exact random path. Verify it
        // before treating a retry's duplicate response as success.
        if(Number(error?.status||error?.statusCode)===409 && attempt>0 && bucket.info){
          const info=await bucket.info(part.path);
          if(!info.error && Number(info.data?.size ?? info.data?.metadata?.size)===part.size)return;
        }
        if(attempt===2||!retryableUploadError(error))throw error;
        onProgress({loaded,total:blob.size,retrying:true,part:index+1,parts:parts.length});
        await wait(1000*(attempt+1));
      }
    }
  };
  onProgress({loaded:0,total:blob.size,parts:parts.length});
  await Promise.all(Array.from({length:Math.min(2,parts.length)},async()=>{
    while(!failure && next<parts.length){
      const index=next++;
      try{await uploadOne(index);completed.push(parts[index].path);loaded+=parts[index].size;onProgress({loaded,total:blob.size,parts:parts.length});}
      catch(error){failure=error;}
    }
  }));
  if(failure){await bucket.remove(completed).catch(()=>{});throw failure;}
  return {version:1,type:blob.type,size:blob.size,parts};
}
export async function downloadChunks(bucket,route,userId,{signal,onProgress=()=>{}}={}) {
  const paths=mediaPaths(route,userId),parts=[];
  let loaded=0;
  for(let index=0;index<paths.length;index++){
    signal?.throwIfAborted();
    const result=await bucket.download(paths[index]);
    signal?.throwIfAborted();
    if(result.error)throw result.error;
    if(!(result.data instanceof Blob)||result.data.size!==route.photoParts.parts[index].size)throw new Error('视频分块下载不完整，请刷新云端重试');
    parts.push(result.data);
    loaded+=result.data.size;
    onProgress({loaded,total:route.photoParts.size});
  }
  return new Blob(parts,{type:route.photoParts.type});
}
