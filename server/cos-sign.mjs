import COS from 'cos-nodejs-sdk-v5';

const MAX_BYTES = 20 * 1024 * 1024;
const TYPES = {'image/jpeg':'jpg','image/png':'png','image/webp':'webp','video/mp4':'mp4'};
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const PATH = new RegExp(`^(${UUID})/cos/(${UUID})\\.(jpg|png|webp|mp4)$`);
const ORIGINS = new Set(['https://eloquent-cheesecake-e8cac9.netlify.app','http://127.0.0.1:5173','http://127.0.0.1:4173']);
const SUPABASE_URL = 'https://xcndecoavcnohnmwsbhx.supabase.co';
const PUBLIC_KEY = 'sb_publishable_EOgnrjY7k2WaIHXGKTvz5Q_gHlh5GXk';
export function createHandler({env=process.env, fetchImpl=fetch, sign}={}) {
  return async (event) => {
    const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([k,v])=>[k.toLowerCase(),v]));
    const origin = headers.origin;
    const response = (statusCode, body) => ({statusCode, headers:{
      'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin',
      ...(ORIGINS.has(origin) ? {'Access-Control-Allow-Origin':origin} : {}),
    },body:JSON.stringify(body)});
    if (!ORIGINS.has(origin)) return response(403,{error:'来源不允许'});
    if (event.httpMethod==='OPTIONS') return {...response(204,{}),headers:{...response(204,{}).headers,
      'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'authorization,content-type'},body:''};
    if (event.httpMethod!=='POST') return response(405,{error:'请求方式不支持'});
    if (!/^Bearer [A-Za-z0-9._-]+$/.test(headers.authorization || '')) return response(401,{error:'请先登录'});
    if (typeof event.body!=='string' || event.body.length>2048 || event.isBase64Encoded) return response(400,{error:'请求格式无效'});
    let input;
    try {input=JSON.parse(event.body);} catch {return response(400,{error:'请求格式无效'});}
    if (!input || typeof input!=='object' || Array.isArray(input)) return response(400,{error:'请求格式无效'});
    const match = typeof input.path==='string' && input.path.match(PATH);
    if (!match || !['upload','download','remove'].includes(input.action)) return response(400,{error:'文件路径或操作无效'});
    const allowedUsers = new Set((env.COS_ALLOWED_USER_IDS || '').split(',').map(s=>s.trim()).filter(Boolean));
    if (!env.COS_SECRET_ID || !env.COS_SECRET_KEY || !allowedUsers.size) return response(503,{error:'腾讯云试用尚未配置完成'});
    try {
      // Validate the bearer token with Auth; never trust a user ID supplied by the browser.
      const auth = await fetchImpl(`${SUPABASE_URL}/auth/v1/user`,{
        headers:{apikey:PUBLIC_KEY,Authorization:headers.authorization},signal:AbortSignal.timeout(10000),
      });
      if (!auth.ok) return response(401,{error:'登录已失效，请重新登录'});
      const user=await auth.json();
      if (user.id!==match[1] || !allowedUsers.has(user.id)) return response(403,{error:'没有此文件的访问权限或未开通试用'});
      const method={upload:'PUT',download:'GET',remove:'DELETE'}[input.action];
      const signedHeaders={};
      if (input.action==='upload') {
        if (!Number.isSafeInteger(input.bytes) || input.bytes<1 || input.bytes>MAX_BYTES || TYPES[input.type]!==match[3])
          return response(400,{error:'保存文件需为照片或 MP4，且不超过 20 MB'});
        // Signed Content-Length is sent automatically by the browser for a Blob body.
        // Changing the declared size or type invalidates the signature at COS.
        Object.assign(signedHeaders,{'Content-Length':String(input.bytes),'Content-Type':input.type,'x-cos-forbid-overwrite':'true'});
      }
      const options={Bucket:'mei-climb-media-1517391545',Region:'ap-shanghai',Key:`mei-climb/${input.path}`,
        Method:method,Protocol:'https:',Sign:true,Expires:300,Headers:signedHeaders};
      const url = sign ? await sign(options) : await new Promise((resolve,reject)=>{
        const cos=new COS({SecretId:env.COS_SECRET_ID,SecretKey:env.COS_SECRET_KEY});
        cos.getObjectUrl(options,(error,data)=>error?reject(error):resolve(data.Url));
      });
      return response(200,{url,method,expiresIn:300,headers:input.action==='upload'
        ? {'Content-Type':input.type,'x-cos-forbid-overwrite':'true'} : {}});
    } catch {
      // Never send SDK errors, tokens, credentials or signed URLs to logs/clients.
      return response(502,{error:'腾讯云授权暂不可用，请稍后重试'});
    }
  };
}
