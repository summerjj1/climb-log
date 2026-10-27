import {chromium,expect as baseExpect} from '@playwright/test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const expect=baseExpect.configure({timeout:20000});
const fixture=await readFile('test-results/video-original.mp4');
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://**/*',r=>r.abort());await page.route('**/__fixture.mp4',r=>r.fulfill({contentType:'video/mp4',body:fixture}));
 await page.route('**/src/cloud.js',r=>r.fulfill({contentType:'application/javascript',body:`
 export const cloudProvider='cloudbase',recoveryLink=false;
 let authListener;window.lazyTest={reads:[],fail:false,delay:0,uploads:0,logout:()=>authListener('SIGNED_OUT',null)};
 const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;const ctx=canvas.getContext('2d');ctx.fillStyle='#efcbdc';ctx.fillRect(0,0,320,180);ctx.fillStyle='#4c2939';ctx.font='22px sans-serif';ctx.fillText('PanleMEI test video',35,95);const poster=canvas.toDataURL('image/jpeg');
 const base={gymId:'g',grade:'5.9',done:false,createdAt:Date.now(),poster,videoMeta:{duration:4}};
 let row={version:1,payload:{gyms:[{id:'g',name:'测试岩馆'}],routes:[{...base,id:'old',name:'旧视频',photoPath:'u/old.mp4'},{...base,id:'chunks',name:'分块视频',photoPath:'u/chunk.mp4',photoParts:{version:1,type:'video/mp4',size:${fixture.length},parts:[{path:'u/chunk.mp4.parts/0000',size:4194304},{path:'u/chunk.mp4.parts/0001',size:${fixture.length-4194304}}]}}]}};
 let blob;const bucket={async upload(){window.lazyTest.uploads++;return {}},async download(path){window.lazyTest.reads.push(path);await new Promise(r=>setTimeout(r,window.lazyTest.delay));if(window.lazyTest.fail)return {error:{status:503}};blob??=await (await fetch('/__fixture.mp4')).blob();return {data:path.includes('.parts/')?blob.slice(Number(path.slice(-4))*4194304,(Number(path.slice(-4))+1)*4194304,'video/mp4'):blob}},async remove(){return {}}};
 export const cloud={auth:{onAuthStateChange(fn){authListener=fn},async getSession(){return {data:{session:{user:{id:'u',email:'preview@example.invalid'}}}}},async signOut(){authListener('SIGNED_OUT',null);return {}}},storage:{from:()=>bucket},from(){let write;const q={select:()=>q,eq:()=>q,insert:v=>(write=v,q),update:v=>(write=v,q),async maybeSingle(){if(write){row=write;return {data:{version:write.version}}}return {data:row}}};return q}};
 `}));
 const reads=()=>page.evaluate(()=>window.lazyTest.reads);
 await page.goto('http://127.0.0.1:5174/');await expect(page.locator('#cloud-status')).toContainText('已读取云端');await expect(page.locator('.route-card')).toHaveCount(2);assert.equal((await reads()).length,0);
 await page.locator('[data-detail=old]').click();await expect(page.locator('#play-cloud-video')).toBeVisible();assert.equal((await reads()).length,0);await page.screenshot({path:'test-results/lazy-video-mobile.png',fullPage:true});await page.setViewportSize({width:1280,height:900});await page.screenshot({path:'test-results/lazy-video-desktop.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.setViewportSize({width:390,height:844});
 await page.locator('#edit-form [name=notes]').fill('修改备注不下载视频');await page.locator('#edit-form button[type=submit]').click();await expect(page.locator('#detail-dialog')).not.toBeVisible();assert.equal((await reads()).length,0);assert.equal(await page.evaluate(()=>window.lazyTest.uploads),0);
 await page.locator('[data-detail=old]').click();await page.evaluate(()=>window.lazyTest.fail=true);await page.locator('#download-video').click();await expect(page.locator('#video-load-status')).toContainText('503');await expect(page.locator('#play-cloud-video')).toBeEnabled();
 await page.evaluate(()=>window.lazyTest.fail=false);const loadedDownload=page.waitForEvent('download');await page.locator('#download-video').click();await loadedDownload;
 const directDownload=page.waitForEvent('download');await page.locator('#download-video').click();const direct=await directDownload;assert.deepEqual(await readFile(await direct.path()),fixture);await page.keyboard.press('Escape');await page.locator('#cloud-refresh').click();await expect(page.locator('#cloud-status')).toContainText('已读取最新');assert.equal((await reads()).length,2,'one failed and one successful read; refresh does not load more');
 await page.locator('[data-detail=chunks]').click();await page.evaluate(()=>window.lazyTest.delay=400);await page.locator('#download-video').click();await expect.poll(async()=>(await reads()).length).toBe(3);await page.keyboard.press('Escape');await page.waitForTimeout(600);assert.equal((await reads()).length,3,'close stops after in-flight chunk');
 await page.locator('[data-detail=chunks]').click();const chunkDownload=page.waitForEvent('download');await page.locator('#download-video').click();await chunkDownload;await page.keyboard.press('Escape');
 const before=(await reads()).length;const dl=page.waitForEvent('download');await page.locator('#export-data').click();const result=await dl;const backup=JSON.parse(await readFile(await result.path(),'utf8'));assert.equal(backup.routes.length,2);assert.ok(backup.routes.every(r=>r.photo.startsWith('data:video/mp4;base64,')));assert.equal((await reads()).length,before);
 // A fresh session exports unloaded videos only when explicitly requested.
 await page.reload();await expect(page.locator('#cloud-status')).toContainText('已读取云端');assert.equal((await reads()).length,0);const dl2=page.waitForEvent('download');await page.locator('#export-data').click();await dl2;assert.equal((await reads()).length,3);
 // Logout while loading must not attach the old user's media or download more chunks.
 await page.reload();await expect(page.locator('#cloud-status')).toContainText('已读取云端');await page.locator('[data-detail=chunks]').click();await page.evaluate(()=>window.lazyTest.delay=400);await page.locator('#download-video').click();await expect.poll(async()=>(await reads()).length).toBe(1);await page.evaluate(()=>window.lazyTest.logout());await expect(page.locator('#cloud-account')).toHaveText('登录同步');await page.waitForTimeout(600);assert.equal((await reads()).length,1);await expect(page.locator('#detail-dialog')).not.toBeVisible();assert.equal(await page.locator('#detail-dialog video').count(),0);
 assert.deepEqual(errors,[]);console.log('PASS: zero video requests on login/edit/refresh; explicit download/retry; closed-dialog and logout cancellation; legacy/chunk downloads; complete lazy backups');
}finally{await browser.close()}
