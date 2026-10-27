import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,open,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
const temp=await mkdtemp(join(tmpdir(),'panlemei-upload-'));
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const source=await readFile('test-results/video-original.mp4');const path=join(temp,'large.mp4');const size=25*1024**2;
 const f=await open(path,'w');const pad=Buffer.alloc(8);pad.writeUInt32BE(size-source.length);pad.write('free',4);await f.write(source);await f.write(pad);await f.truncate(size);await f.close();
 const page=await browser.newPage({viewport:{width:390,height:844}});await page.route('https://**/*',r=>r.abort());
 await page.route('**/src/cloud.js',r=>r.fulfill({contentType:'application/javascript',body:`
 export const cloudProvider='cloudbase',recoveryLink=false;
 let row=null,failed=false;const objects=new Map();window.uploadTest={fail:false,sizes:[],calls:0};
 const bucket={async upload(path,blob){window.uploadTest.calls++;await new Promise(r=>setTimeout(r,400));if(window.uploadTest.fail)return {error:{status:413,message:'request entity too large'}};if(path.endsWith('0001')&&!failed){failed=true;return {error:{status:503,message:'temporary'}}}objects.set(path,blob);window.uploadTest.sizes.push(blob.size);return {}},async download(path){return {data:objects.get(path)}},async remove(paths){paths.forEach(p=>objects.delete(p));return {}}};
 export const cloud={auth:{onAuthStateChange(){},async getSession(){return {data:{session:{user:{id:'chunk-test',email:'chunks@example.invalid'}}}}}},storage:{from:()=>bucket},from(){let value;const q={select:()=>q,eq:()=>q,insert:v=>(value=v,q),update:v=>(value=v,q),async maybeSingle(){if(value){row=value;return {data:{version:value.version}}}return {data:row}}};return q}};
 `}));
 await page.goto('http://127.0.0.1:5174/');await expect(page.locator('#cloud-account')).toHaveText('chunks@example.invalid');await expect(page.locator('#cloud-status')).toContainText('已读取云端');
 await page.locator('#upload').click();await page.locator('#upload-gym').fill('分块测试');await page.locator('#video-quality').selectOption('original');await page.locator('#photo-files').setInputFiles(path);await page.locator('.pending-row video').waitFor();await page.locator('#save-upload').click();
 await expect(page.locator('#save-status')).toBeVisible();await expect(page.locator('#save-progress-label')).toContainText(/分 7 块|重试/);await page.screenshot({path:'test-results/chunk-upload-mobile.png',fullPage:true});
 await expect(page.locator('#upload-dialog')).not.toBeVisible({timeout:30000});assert.ok((await page.evaluate(()=>window.uploadTest.sizes)).every(n=>n<=4*1024**2));
 const loaded=await page.evaluate(async()=>{const {cloud}=await import('/src/cloud.js');const {CloudStore}=await import('/src/cloud-store.js');const store=new CloudStore(cloud,'chunk-test',null,{chunkedUploads:true});const s=await store.load();return {size:s.routes[0].photo.size,type:s.routes[0].photo.type,parts:s.routes[0].photoParts.parts.length}});assert.deepEqual(loaded,{size,type:'video/mp4',parts:7});
 await page.locator('#upload').click();await page.locator('#upload-gym').fill('分块测试');await page.locator('#photo-files').setInputFiles(path);await page.locator('.pending-row video').waitFor();await page.evaluate(()=>window.uploadTest.fail=true);await page.locator('#save-upload').click();await expect(page.locator('#upload-error')).toContainText('HTTP 413');await expect(page.locator('.pending-row video')).toBeVisible();await expect(page.locator('#save-upload')).toBeEnabled();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.evaluate(()=>window.uploadTest.fail=false);await page.locator('#save-upload').click();await expect(page.locator('#upload-dialog')).not.toBeVisible({timeout:30000});
 console.log('PASS: 25 MB original, seven private chunks, transient retry, progress on mobile, reload, HTTP 413 retained preview and manual retry');
}finally{await browser.close();await rm(temp,{recursive:true,force:true})}
