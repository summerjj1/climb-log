const COS_HOST='mei-climb-media-1517391545.cos.ap-shanghai.myqcloud.com';
// Keep Supabase objects readable; new COS objects use a distinct, owner-scoped path.
export function createMediaStore(client,userId,{uploads=false,endpoint='/.netlify/functions/cos-sign',fetchImpl=fetch}={}) {
  const original=client.storage.from('climb-photos');
  const isCos=path=>path.startsWith(`${userId}/cos/`);
  const owns=path=>typeof path==='string' && path.startsWith(`${userId}/`);
  async function request(action,path,blob) {
    if(!owns(path)) throw new Error('文件不属于当前账号');
    const {data,error}=await client.auth.getSession();
    if(error || data.session?.user.id!==userId || !data.session?.access_token) throw new Error('登录已变化，请重新登录后重试');
    const signed=await fetchImpl(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${data.session.access_token}`},
      body:JSON.stringify({action,path,...(blob?{bytes:blob.size,type:blob.type.split(';')[0]}:{})})});
    if(!signed.ok) {
      const body=await signed.json().catch(()=>({}));
      throw new Error(body.error || '腾讯云授权失败，请稍后重试');
    }
    const ticket=await signed.json();
    const url=new URL(ticket.url);
    const expectedMethod={upload:'PUT',download:'GET',remove:'DELETE'}[action];
    if(url.protocol!=='https:' || url.host!==COS_HOST || url.username || url.password ||
       decodeURIComponent(url.pathname)!==`/mei-climb/${path}` || ticket.method!==expectedMethod)
      throw new Error('腾讯云返回的文件地址无效');
    // A default COS domain may force attachment downloads. Fetching a Blob preserves
    // the existing private object-URL preview flow without a public bucket/domain.
    const result=await fetchImpl(url.href,{method:expectedMethod,headers:ticket.headers,body:blob,redirect:'error'});
    if(!result.ok && !(action==='remove' && result.status===404)) throw new Error('腾讯云文件操作失败，请检查网络后重试');
    return action==='download' ? await result.blob() : undefined;
  }
  return {
    uploadPrefix:uploads ? `${userId}/cos/` : `${userId}/`,
    async upload(path,blob,options) {
      if(!owns(path)) return {error:new Error('文件不属于当前账号')};
      if(!isCos(path)) return original.upload(path,blob,options);
      try {await request('upload',path,blob);return {};} catch(error){return {error};}
    },
    async download(path) {
      if(!owns(path)) return {error:new Error('文件不属于当前账号')};
      if(!isCos(path)) return original.download(path);
      try {return {data:await request('download',path)};} catch(error){return {error};}
    },
    async remove(paths) {
      if(paths.some(p=>!owns(p))) return {error:new Error('文件不属于当前账号')};
      try {
        for(const path of paths.filter(isCos)) await request('remove',path);
        const legacy=paths.filter(p=>!isCos(p));
        return legacy.length ? await original.remove(legacy) : {};
      } catch(error){return {error};}
    },
  };
}
