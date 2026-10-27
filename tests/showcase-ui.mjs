import {readFile} from 'node:fs/promises';
import {chromium,expect as baseExpect} from '@playwright/test';
const expect=baseExpect.configure({timeout:15000});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://**/*',r=>r.abort());
 const fixture=await readFile('test-results/video-compressed.mp4');
 await page.route('**/__showcase-test.mp4',async r=>{
  const match=/bytes=(\d+)-(\d*)/.exec(r.request().headers().range||'');
  const start=match?Number(match[1]):0,end=Math.min(fixture.length-1,match?.[2]?Number(match[2]):fixture.length-1);
  await r.fulfill({status:match?206:200,headers:{'Content-Type':'video/mp4','Accept-Ranges':'bytes',...(match?{'Content-Range':`bytes ${start}-${end}/${fixture.length}`}:{})},body:fixture.subarray(start,end+1)});
 });
 await page.route('**/src/cloud.js',r=>r.fulfill({contentType:'application/javascript',body:`
 export const cloudProvider='cloudbase',recoveryLink=false;
 let listener, user={id:'alice',email:'private@example.invalid'};
 const route={id:'r1',name:'Test route',grade:'5.10a',gymId:'g1',photoPath:'alice/clip.mp4',mediaType:'video/mp4',mediaSize:100,videoMeta:{duration:4},createdAt:1,done:false,notes:'PRIVATE NOTE'};
 const posts=[],profiles={};window.mediaCalls=[];window.posts=posts;
 window.setTestUser=next=>{user=next;listener('SIGNED_IN',next?{user:next}:null);};
 export const cloud={auth:{onAuthStateChange(fn){listener=fn},async getSession(){return {data:{session:{user}}}},async signOut(){user=null;listener('SIGNED_OUT',null);return {}}},storage:{from(){return {async download(){window.mediaCalls.push('download');throw Error('network')},async createSignedUrl(){window.mediaCalls.push('sign');return window.mediaCalls.length===1?{error:{message:'offline'}}:{data:{signedUrl:location.origin+'/__showcase-test.mp4'}}}}}},from(table){
 let op='read',payload,filters=[],start=0,end=11,single=false;
 const q={select(){return q},eq(k,v){filters.push([k,v]);return q},in(k,v){filters.push([k,v]);return q},order(){return q},range(a,b){start=a;end=b;return q},insert(v){op='insert';payload=v;return q},upsert(v){op='upsert';payload=v;return q},update(v){op='update';payload=v;return q},delete(){op='delete';return q},single(){single=true;return q},maybeSingle(){single=true;return q},then(resolve,reject){return Promise.resolve().then(()=>{
 let data;
 if(table==='climb_collections'){data=user?.id==='alice'?{version:1,payload:{gyms:[{id:'g1',name:'Test gym'},{id:'g2',name:'另一家岩馆'}],routes:[route]}}:null;if(op!=='read'){if(payload?.payload?.routes?.length){Object.assign(route,payload.payload.routes.find(r=>r.id==='r1')||{});for(const p of posts){p.title=route.name;p.grade=route.grade;p.gym_name=payload.payload.gyms.find(g=>g.id===route.gymId)?.name;}}data={version:2};}}
 if(table==='climb_profiles'){
 if(op==='upsert')profiles[payload.user_id]=payload.nickname;
 data=Object.entries(profiles).map(([user_id,nickname])=>({user_id,nickname}));
 }
 if(table==='climb_showcase'){
 if(op==='insert'){if(payload.owner_id!==user.id)throw Error('denied');posts.push({...payload,id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',title:route.name,gym_name:'Test gym',grade:route.grade,poster:'',video:{...route,notes:undefined},created_at:'2026-10-27T00:00:00Z'});}
 if(op==='delete'){const index=posts.findIndex(p=>filters.every(([k,v])=>p[k]===v));if(index>=0)posts.splice(index,1);}
 data=posts.slice();
 }
 if(Array.isArray(data)){data=data.filter(p=>filters.every(([k,v])=>Array.isArray(v)?v.includes(p[k]):p[k]===v)).slice(start,end+1);if(single)data=data[0]||null;}
 return {data,error:null};
 }).then(resolve,reject)}};return q;}};
 `}));
 await page.goto(process.env.TEST_ORIGIN || 'http://127.0.0.1:5174/');
 await expect(page.locator('#cloud-status')).toContainText('已读取云端');
 if(process.env.MOBILE_AUDIT) {
 for (const width of [390, 320, 1280]) {
  await page.setViewportSize({width,height:900});
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`test-results/mobile-refresh-home-${width}.png`});
  if(width<=760){
    await page.locator('#toggle-gyms').click();await expect(page.locator('#gym-search')).toBeVisible();
    await page.locator('#gym-search').fill('另一家');await expect(page.locator('#gyms')).toContainText('另一家岩馆');
    await page.locator('#gym-search').fill('');await page.locator('#toggle-gyms').click();await expect(page.locator('#gym-search')).not.toBeVisible();
  }
  await page.locator('#upload').click();
  await expect(page.locator('#video-quality')).toHaveValue('fast');
  await expect(page.locator('#video-settings-note')).not.toBeVisible();
  await page.locator('.video-help summary').click();
  await expect(page.locator('#video-settings-note')).toBeVisible();
  await page.locator('.video-help summary').click();
  await page.screenshot({path:`test-results/mobile-refresh-upload-${width}.png`});
  await page.locator('#upload-dialog .close-dialog').click();
  await page.locator('#gallery .route-card').first().click();
  await expect(page.locator('#edit-form [name="gymId"]')).toBeVisible();
  const overflow=await page.locator('#detail-dialog').evaluate(el=>el.scrollWidth>el.clientWidth);
  expect(overflow).toBe(false);
  await page.locator('#share-video').scrollIntoViewIfNeeded();
  await page.screenshot({path:`test-results/mobile-refresh-detail-${width}.png`});
  await page.locator('#detail-dialog .close-dialog').click();
 }
 await page.setViewportSize({width:390,height:844});
 }
 await page.locator('#edit-nickname').click();await page.locator('#nickname-input').fill('岩上的花 <script>');await page.getByRole('button',{name:'保存昵称',exact:true}).click();
 await expect(page.locator('#edit-nickname')).toContainText('岩上的花 <script>');
 await page.locator('#gallery .route-card').first().click();
 await page.locator('#share-video').click();await expect(page.locator('#share-status')).toContainText('岩上的花');
 await page.locator('#share-publish').click();await expect(page.locator('#share-status')).toContainText('已分享');
 expect(await page.evaluate(()=>window.mediaCalls)).toEqual([]);
 await page.getByRole('button',{name:'关闭分享窗口',exact:true}).click();await page.locator('#detail-dialog .close-dialog').click();
 await page.locator('#open-showcase').click();await expect(page.locator('.showcase-card')).toHaveCount(1);await expect(page.locator('.showcase-author')).toHaveText('岩上的花 <script>');
 await expect(page.locator('#showcase-grid')).not.toContainText('private@example.invalid');await expect(page.locator('#showcase-grid')).not.toContainText('PRIVATE NOTE');expect(await page.evaluate(()=>window.mediaCalls)).toEqual([]);
 await page.locator('.showcase-author').evaluate(el=>el.textContent='岩上的花');
 await page.locator('.showcase-card h3').evaluate(el=>el.textContent='第一次完成 5.10a');
 await page.screenshot({path:'test-results/showcase-mobile.png'});
 await page.locator('[data-edit-share]').click();await expect(page.locator('#detail-dialog')).toBeVisible();
 await expect(page.locator('#edit-form [name="gymId"] option[value="g2"]')).toHaveText('另一家岩馆');
 await page.locator('#edit-form [name="gymId"]').selectOption('g2');
 await page.locator('#edit-form button[type="submit"]').click();await expect(page.locator('#detail-dialog')).not.toBeVisible();
 await page.locator('#gallery .route-card').first().click();
 await expect(page.locator('#edit-form [name="gymId"]')).toHaveValue('g2');
 await page.screenshot({path:'test-results/gym-selector-mobile.png'});
 await page.locator('#edit-form [name="gymId"]').selectOption('__new__');
 await expect(page.locator('#edit-form [name="newGym"]')).toBeVisible();
 await page.locator('#edit-form [name="newGym"]').fill('更换后的岩馆');await page.locator('#edit-form [name="grade"]').selectOption('5.11a');
 await page.locator('#edit-form button[type="submit"]').click();await expect(page.locator('#detail-dialog')).not.toBeVisible();
 await page.locator('#open-showcase').click();await expect(page.locator('#showcase-grid')).toContainText('更换后的岩馆');await expect(page.locator('#showcase-grid')).toContainText('5.11a');
 await page.evaluate(()=>window.setTestUser({id:'bob',email:'bob@example.invalid'}));await expect(page.locator('#cloud-account')).toHaveText('bob@example.invalid');
 await page.locator('#open-showcase').click();await expect(page.locator('.showcase-card')).toHaveCount(1);await expect(page.locator('[data-unshare]')).toHaveCount(0);
 await page.locator('[data-watch]').click();await expect(page.locator('#showcase-play-status')).toContainText('暂时无法播放');expect(await page.evaluate(()=>window.mediaCalls)).toEqual(['sign']);
 await page.locator('#showcase-retry').click();await expect.poll(()=>page.locator('#showcase-player video').evaluate(v=>v.currentTime)).toBeGreaterThan(.1);
 await page.locator('#showcase-player video').evaluate(v=>{v.currentTime=1;});await expect.poll(()=>page.locator('#showcase-player video').evaluate(v=>v.currentTime)).toBeGreaterThan(1);
 await page.screenshot({path:'test-results/showcase-playing.png'});
 await page.evaluate(()=>window.setTestUser(null));await expect(page.locator('#showcase-player')).not.toBeVisible();await expect(page.locator('#showcase-grid')).toBeEmpty();
 await page.locator('#open-showcase').click();await expect(page.locator('#showcase-login')).toBeVisible();await expect(page.locator('#showcase-grid')).toBeEmpty();
 await page.evaluate(()=>window.setTestUser({id:'alice',email:'private@example.invalid'}));await expect(page.locator('#cloud-status')).toContainText('已读取云端');await page.locator('#open-showcase').click();await page.locator('[data-unshare]').click();await expect(page.locator('.showcase-card')).toHaveCount(0);
 await expect(page.locator('#edit-nickname')).toContainText('岩上的花 <script>');
 await page.goto((process.env.TEST_ORIGIN || 'http://127.0.0.1:5174/')+'?showcase=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
 await expect(page.locator('#showcase-dialog')).toBeVisible();await expect(page.locator('#showcase-status')).toContainText('分享已取消');
 expect(errors).toEqual([]);
 console.log('PASS: nickname persistence and escaping, explicit share, no media on feed, member view, no cross-account controls, lazy play failure/retry, logout cleanup, revoke, mobile layout.');
}finally{await browser.close();}
