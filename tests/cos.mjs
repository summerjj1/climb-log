import assert from 'node:assert/strict';
import COS from 'cos-nodejs-sdk-v5';
import {createHandler} from '../server/cos-sign.mjs';
import {createMediaStore} from '../src/cos-store.js';
const user='f8202780-662c-4ba5-afcb-739c3281cc22';
const other='00000000-0000-4000-8000-000000000001';
const path=`${user}/cos/00000000-0000-4000-8000-000000000002.mp4`;
const origin='https://eloquent-cheesecake-e8cac9.netlify.app';
const env={COS_SECRET_ID:'test-id',COS_SECRET_KEY:'test-only-not-real',COS_ALLOWED_USER_IDS:user};
let signCount=0,authenticatedUser=user,authValid=true;
let lastOptions;
const fakeAuth=async()=>new Response(JSON.stringify({id:authenticatedUser}),{status:authValid?200:401});
const sdk=new COS({SecretId:env.COS_SECRET_ID,SecretKey:env.COS_SECRET_KEY});
const handler=createHandler({env,fetchImpl:fakeAuth,sign:async options=>{
  signCount++; lastOptions=options;
  return await new Promise((resolve,reject)=>sdk.getObjectUrl(options,(e,d)=>e?reject(e):resolve(d.Url)));
}});
const event=(data={action:'upload',path,bytes:3,type:'video/mp4'})=>({httpMethod:'POST',headers:{origin,authorization:'Bearer test-token'},body:JSON.stringify(data)});
let response=await handler(event());
assert.equal(response.statusCode,200);
assert.equal(lastOptions.Headers['Content-Length'],'3');
assert.equal(lastOptions.Headers['x-cos-forbid-overwrite'],'true');
let signedUrl=new URL(JSON.parse(response.body).url);
assert.equal(signedUrl.protocol,'https:');
const headerList=signedUrl.searchParams.get('q-header-list');
assert.ok(headerList.includes('content-length')&&headerList.includes('content-type')&&headerList.includes('host')&&headerList.includes('x-cos-forbid-overwrite'));
assert.equal(response.headers['Cache-Control'],'no-store');
const validCount=signCount;
for(const invalid of [
 {action:'upload',path,bytes:20*1024**2+1,type:'video/mp4'},
 {action:'upload',path,bytes:0,type:'video/mp4'},
 {action:'upload',path,bytes:3,type:'text/html'},
 {action:'upload',path,bytes:3,type:'image/jpeg'},
 {action:'download',path:`${user}/cos/../other.mp4`},
 {action:'download',path:path.replace('/cos/','/cos/%2e%2e/')},
 {action:'arbitrary',path},
 null,
]) assert.equal((await handler(event(invalid))).statusCode,400);
assert.equal(signCount,validCount);
assert.equal((await handler({...event(),body:'broken'})).statusCode,400);
assert.equal((await handler({...event(),body:' '.repeat(2049)})).statusCode,400);
assert.equal((await handler({...event(),headers:{origin:'https://evil.example',authorization:'Bearer test-token'}})).statusCode,403);
assert.equal((await handler({...event(),headers:{origin}})).statusCode,401);
assert.equal((await handler({...event(),httpMethod:'GET'})).statusCode,405);
assert.equal((await handler({...event(),httpMethod:'OPTIONS'})).statusCode,204);
authValid=false;assert.equal((await handler(event())).statusCode,401);authValid=true;
authenticatedUser=other;assert.equal((await handler(event())).statusCode,403);
assert.equal((await handler(event({action:'download',path:path.replace(user,other)}))).statusCode,403);
authenticatedUser=user;
assert.equal((await createHandler({env:{},fetchImpl:fakeAuth})(event())).statusCode,503);
assert.equal((await createHandler({env,fetchImpl:async()=>{throw Error('private secret')}})(event())).statusCode,502);
console.log('PASS COS signing: real SDK signatures bind size/type/host; auth, pilot allowlist, path ownership, expiry configuration, CORS, malformed and oversize requests.');

let signedCalls=0,objectCalls=0,sessionUser=user,malicious=false,uploadFail=false;
const objects=new Map();let legacyCalls=0;
const client={auth:{getSession:async()=>({data:{session:{user:{id:sessionUser},access_token:'test-token'}}})},storage:{from:()=>({
  upload:async()=>{legacyCalls++;return {};},download:async()=>{legacyCalls++;return {data:new Blob(['legacy'])};},remove:async()=>{legacyCalls++;return {};},
})}};
const transport=async(url,options)=>{
  if(url==='/sign') {
    signedCalls++;
    const ticket=await handler({httpMethod:'POST',headers:{...options.headers,origin},body:options.body});
    const body=JSON.parse(ticket.body);
    if(malicious && body.url)body.url='https://evil.example/upload';
    return new Response(JSON.stringify(body),{status:ticket.statusCode});
  }
  objectCalls++;
  const key=new URL(url).pathname;
  if(options.method==='PUT') {if(uploadFail)return new Response('',{status:503});objects.set(key,options.body);return new Response('',{status:200});}
  if(options.method==='GET')return new Response(objects.get(key),{status:200});
  objects.delete(key);return new Response(null,{status:204});
};
const media=createMediaStore(client,user,{uploads:true,endpoint:'/sign',fetchImpl:transport});
assert.equal(media.uploadPrefix,`${user}/cos/`);
assert.equal(createMediaStore(client,user).uploadPrefix,`${user}/`);
const movie=new Blob(['mp4'],{type:'video/mp4'});
assert.deepEqual(await media.upload(path,movie),{});
assert.equal(await (await media.download(path)).data.text(),'mp4');
assert.equal((await media.download(path)).data.type,'video/mp4');
await media.remove([path]);assert.equal(objects.size,0);
await media.download(`${user}/old.jpg`);await media.upload(`${user}/old.jpg`,new Blob(['x']));await media.remove([`${user}/old.jpg`]);assert.equal(legacyCalls,3);
const before=signedCalls;
assert.ok((await media.download(path.replace(user,other))).error);
sessionUser=other;assert.ok((await media.upload(path,movie)).error);assert.equal(signedCalls,before);sessionUser=user;
malicious=true;const requests=objectCalls;assert.ok((await media.upload(path,movie)).error);assert.equal(objectCalls,requests);malicious=false;
uploadFail=true;assert.ok((await media.upload(path,movie)).error);
console.log('PASS COS adapter: upload/read/delete, old Supabase files, account switch, malicious destination rejected, remote failures surfaced.');
