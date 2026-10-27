import { chromium, expect as baseExpect } from '@playwright/test';
const expect=baseExpect.configure({timeout:20000});
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage();const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://**/*',r=>r.abort());
 for(const sub of ['/','/tencent/']) {
  await page.goto('http://127.0.0.1:4173'+sub);
  await expect(page.locator('#auth-identity-label')).toHaveText(sub==='/'?'邮箱':'邮箱或用户名');
  await expect(page.locator('#gym-count')).toContainText('82');
  await page.locator('#cloud-account').click();
  await expect(page.locator('#auth-dialog')).toBeVisible();
  const home=await page.locator('.brand').getAttribute('href');
  if(home!==sub)throw new Error('Wrong home URL: '+home);
  console.log('PASS: production build '+sub+' loads correct provider and base URL');
 }
 if(errors.length)throw new Error(errors.join('\n'));
}finally{await browser.close()}
