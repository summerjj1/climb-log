import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  await page.route('https://**/*', route => route.abort());
  // Reproduce CloudBase's completed initialization: no INITIAL_SESSION replay.
  await page.route('**/src/cloud.js', route => route.fulfill({ contentType: 'application/javascript', body: `
    export const cloudProvider = 'cloudbase';
    export const recoveryLink = false;
    export const cloud = {
      auth: {
        onAuthStateChange() {},
        async getSession() { return {data:{session:{user:{id:'2114693494396231682',email:'session-test@example.invalid'}}}}; }
      },
      storage: {from(){return {}}},
      from() {
        let writing = false;
        const q = {select(){return q},eq(){return q},insert(){writing=true;return q},update(){writing=true;return q},
          async maybeSingle(){return {data:writing?{version:1}:null}}};
        return q;
      }
    };
  ` }));
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:5174/');
  await expect(page.locator('#cloud-account')).toHaveText('session-test@example.invalid');
  await expect(page.locator('#cloud-status')).toContainText('已读取云端');
  await page.reload();
  await expect(page.locator('#cloud-account')).toHaveText('session-test@example.invalid');
  await expect(page.locator('#cloud-refresh')).toBeVisible();
  if(errors.length) throw new Error(errors.join('\n'));
  console.log('PASS: CloudBase saved session restores on first load and reload without INITIAL_SESSION replay (mocked transport).');
} finally { await browser.close(); }
