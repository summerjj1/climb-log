import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {readFile, open, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const temp=await mkdtemp(join(tmpdir(),'panlemei-original-'));
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  const page=await browser.newPage();
  const wasm=[];page.on('request',r=>{if(/ffmpeg.*\.(wasm|js)/.test(r.url()) && r.url().includes('/vendor/'))wasm.push(r.url());});
  await page.goto('http://127.0.0.1:5174/');
  await page.locator('#upload').click();
  await page.locator('#video-quality').selectOption('original');
  const input=await readFile('test-results/video-original.mp4');
  const path=join(temp,'one-gb.mp4');const f=await open(path,'w');
  const limit=1024**3;const pad=Buffer.alloc(8);pad.writeUInt32BE(limit-input.length);pad.write('free',4);
  await f.write(input);await f.write(pad);await f.truncate(limit);await f.close();
  const started=Date.now();
  await page.locator('#photo-files').setInputFiles(path);
  await page.locator('.pending-row video').waitFor({timeout:35000});
  assert.match(await page.locator('.media-size').innerText(),/1024.00 MB → 1024.00 MB/);
  assert.equal(wasm.length,0);
  console.log('PASS: exact 1 GiB original preview without WASM, ms=',Date.now()-started);
  await page.locator('[data-remove="0"]').click();
  const larger=await open(path,'r+');await larger.truncate(limit+1);await larger.close();
  await page.locator('#photo-files').setInputFiles(path);
  await page.waitForFunction(()=>document.querySelector('#upload-error').textContent.includes('1 GB'));
  const result=await page.evaluate(async base64=>{
    const {compressVideo}=await import('/src/video.js');
    const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
    const file=new File([bytes],'small.mp4',{type:'video/mp4'});
    const output=await compressVideo(file,{quality:'original'});
    const a=new Uint8Array(await output.photo.arrayBuffer());
    if(a.length!==bytes.length||!a.every((b,i)=>b===bytes[i]))throw Error('Bytes changed');
    if(output.photo!==file||!output.videoMeta.uncompressed)throw Error('Original not retained');
    const controller=new AbortController();controller.abort();let canceled=false;
    try {await compressVideo(file,{quality:'original',signal:controller.signal})}catch(e){canceled=e.name==='AbortError'}
    const active=new AbortController();const p=compressVideo(file,{quality:'original',signal:active.signal});active.abort();let activeCanceled=false;
    try{await p}catch(e){activeCanceled=e.name==='AbortError'}
    let invalid=false;try{await compressVideo(new File(['garbage'],'bad.txt',{type:'text/plain'}),{quality:'original'})}catch{invalid=true}
    return {canceled,activeCanceled,invalid,size:a.length,duration:output.videoMeta.duration};
  },input.toString('base64'));
  assert.ok(result.canceled&&result.activeCanceled&&result.invalid);
  assert.equal(wasm.length,0);
  console.log('PASS: exact bytes, no WASM, >1 GiB rejection, cancellation and unsupported format',result);
}finally{await browser.close();await rm(temp,{recursive:true,force:true})}
