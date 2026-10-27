import { cloudBaseAuthError } from '../src/cloudbase-auth.js';
import { chromium, expect as baseExpect } from '@playwright/test';
const expect = baseExpect.configure({timeout: 15000});
for (const code of ['invalid_username_or_password', 'wrong_password', 'invalid_credentials']) {
  expect(cloudBaseAuthError({code})).toContain('账号或密码不正确');
}
expect(cloudBaseAuthError({code:'password_too_weak'}, true)).toContain('密码不符合要求');
expect(cloudBaseAuthError({code:'invalid_verification_code'}, true)).toContain('验证码不正确');
expect(cloudBaseAuthError({code:'unknown'})).not.toContain('网络');
// failed_precondition is a general prerequisite failure, not evidence of an existing account.
for (const mode of ['reset','otp','signup','login']) {
  const text=cloudBaseAuthError({code:'failed_precondition'},false,mode);
  expect(text).not.toContain('已经注册');
  expect(text).toContain('failed_precondition');
}
expect(cloudBaseAuthError({code:'not_found'},false,'reset')).toContain('未找到');
expect(cloudBaseAuthError({code:'user_pending'},false,'login')).toContain('尚未完成验证');
const browser = await chromium.launch({channel: 'chrome', headless: true});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://**/*', route => route.abort());
  await page.route('**/src/cloud.js', route => route.fulfill({contentType: 'application/javascript', body: `
    export const cloudProvider='cloudbase', recoveryLink=false;
    const calls=window.authCalls=[];
    let listener=()=>{};
    const user={id:'auth-test-user',email:'climber@example.invalid'};
    const signedIn=()=>{const session={user}; sessionStorage.setItem('mock-session','1');listener('SIGNED_IN',session);return {data:{session,user},error:null};};
    const verifyOtp=async params=>{
      calls.push(['verify',params]);
      if(params.token!=='123456')return {error:{code:'invalid_argument',message:'invalid verification code'}};
      return signedIn();
    };
    export const cloud={auth:{
      onAuthStateChange(fn){listener=fn},
      async getSession(){return {data:{session:sessionStorage.getItem('mock-session')?{user}:null}}},
      async signUp(params){calls.push(['signup',params]);if(params.email==='disabled@example.invalid')return {error:{code:'login_type_disabled'}};return {data:{verifyOtp},error:null}},
      async signInWithOtp(params){calls.push(['otp',params]);return {data:{verifyOtp},error:null}},
      async signInWithPassword(params){calls.push(['password',params]);if(params.password==='WrongPassword123!')return {error:{code:'invalid_username_or_password'}};return signedIn()},
      async resetPasswordForEmail(email){
        calls.push(['reset',email]);
        if(email==='missing@example.invalid')return {error:{code:'failed_precondition',message:'precondition failed'}};
        const request=calls.filter(c=>c[0]==='reset').length;
        return {data:{updateUser:async params=>{
          calls.push(['reset-verify',{...params,request}]);
          if(params.nonce!=='123456')return {error:{code:'invalid_verification_code'}};
          return signedIn();
        }},error:null};
      },
      async resend(params){calls.push(['resend',params]);return {data:{messageId:'new-message-id'},error:null}},
      async signOut(){sessionStorage.removeItem('mock-session');listener('SIGNED_OUT',null);return {error:null}}
    },storage:{from(){return {}}},from(){let writing=false;const q={select(){return q},eq(){return q},insert(){writing=true;return q},update(){writing=true;return q},async maybeSingle(){return {data:writing?{version:1}:null}}};return q}};
  `}));
  await page.goto('http://127.0.0.1:5174/');
  await expect(page.locator('#gym-count')).toContainText('82');
  await page.locator('#cloud-account').click();
  await expect(page.locator('#auth-identity-label')).toHaveText('邮箱或用户名');
  await page.locator('#auth-toggle').click();
  await page.locator('#auth-email').fill('climber@example.invalid');
  await page.locator('#auth-password').fill('SyntheticPassword123!');
  await page.locator('#auth-confirm').fill('Mismatch123!');
  await page.locator('#auth-submit').click();
  expect(await page.evaluate(()=>window.authCalls.length)).toBe(0);
  await page.locator('#auth-confirm').fill('SyntheticPassword123!');
  await page.locator('#auth-submit').click();
  await expect(page.locator('#auth-title')).toHaveText('验证邮箱');
  await expect(page.locator('#auth-email')).toBeDisabled();
  await expect(page.locator('#auth-password')).toHaveValue('');
  await expect(page.locator('#auth-confirm')).toHaveValue('');
  await expect(page.locator('#auth-resend')).toBeDisabled();
  await page.locator('#auth-code').fill('000000');
  await page.locator('#auth-submit').click();
  await expect(page.locator('#auth-message')).toContainText('验证码不正确');
  await expect(page.locator('#auth-dialog')).toBeVisible();
  await page.clock.install();
  await page.clock.fastForward(61000);
  await page.locator('#auth-resend').click();
  await expect(page.locator('#auth-message')).toContainText('重新发送');
  await page.locator('#auth-code').fill('123456');
  await page.locator('#auth-submit').click();
  await expect(page.locator('#auth-dialog')).not.toBeVisible();
  await expect(page.locator('#cloud-account')).toHaveText('climber@example.invalid');
  await expect(page.locator('#cloud-status')).toContainText('已读取云端');
  const calls=await page.evaluate(()=>window.authCalls);
  expect(calls[0]).toEqual(['signup',{email:'climber@example.invalid',password:'SyntheticPassword123!'}]);
  expect(calls.at(-1)).toEqual(['verify',{token:'123456',messageId:'new-message-id'}]);
  expect(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))).not.toContain('SyntheticPassword');
  await page.reload();
  await expect(page.locator('#cloud-account')).toHaveText('climber@example.invalid');
  await page.locator('#cloud-signout').click();
  await expect(page.locator('#cloud-account')).toHaveText('登录同步');
  await page.locator('#cloud-account').click();
  await page.locator('#auth-email').fill('mei-trial');
  await page.locator('#auth-password').fill('SyntheticPassword123!');
  await page.locator('#auth-submit').click();
  await expect(page.locator('#auth-dialog')).not.toBeVisible();
  expect((await page.evaluate(()=>window.authCalls)).at(-1)[1]).toEqual({username:'mei-trial',password:'SyntheticPassword123!'});
  await expect(page.locator('#cloud-signout')).toBeEnabled();
  await page.locator('#cloud-signout').click();
  await expect(page.locator('#cloud-account')).toHaveText('登录同步');
  await page.locator('#cloud-account').click();
  await page.locator('#auth-otp').click();
  await page.locator('#auth-email').fill('climber@example.invalid');
  await page.locator('#auth-submit').click();
  await expect(page.locator('#auth-title')).toHaveText('验证邮箱');
  expect((await page.evaluate(()=>window.authCalls)).at(-1)).toEqual(['otp',{email:'climber@example.invalid',options:{shouldCreateUser:false}}]);
  await page.locator('#auth-toggle').click();
  await expect(page.locator('#auth-code')).toBeHidden();
  await page.locator('#auth-email').fill('climber@example.invalid');
  await page.locator('#auth-password').fill('SyntheticPassword123!');
  await page.locator('#auth-submit').click();
  await expect(page.locator('#auth-dialog')).not.toBeVisible();
  expect((await page.evaluate(()=>window.authCalls)).at(-1)[1]).toEqual({email:'climber@example.invalid',password:'SyntheticPassword123!'});
  await expect(page.locator('#cloud-signout')).toBeEnabled();
  await page.locator('#cloud-signout').click();
  await expect(page.locator('#cloud-account')).toHaveText('登录同步');
  await page.locator('#cloud-account').click();
  await page.locator('#auth-toggle').click();
  await page.locator('#auth-email').fill('disabled@example.invalid');
  await page.locator('#auth-password').fill('SyntheticPassword123!');
  await page.locator('#auth-confirm').fill('SyntheticPassword123!');
  await page.locator('#auth-submit').click();
  await expect(page.locator('#auth-message')).toContainText('邮箱验证服务尚未开启');
  await expect(page.locator('#auth-code')).toBeHidden();

  // A real SDK credential error must not become a misleading network failure.
  await page.locator('#auth-toggle').click();
  await page.locator('#auth-email').fill('climber@example.invalid');
  await page.locator('#auth-password').fill('WrongPassword123!');
  await page.locator('#auth-submit').click();
  await expect(page.locator('#auth-message')).toContainText('账号或密码不正确');
  await expect(page.locator('#cloud-account')).toHaveText('登录同步');
  await page.locator('#auth-reset').click();
  await expect(page.locator('#auth-password')).toBeHidden();
  await page.locator('#auth-submit').click();
  await expect(page.locator('#auth-title')).toHaveText('重设密码');
  await expect(page.locator('#auth-code')).toBeVisible();
  await expect(page.locator('#auth-email')).toBeDisabled();
  await expect(page.locator('#auth-password')).toHaveAttribute('autocomplete','new-password');
  await page.locator('#auth-password').fill('SyntheticNewPassword123!');
  await page.locator('#auth-confirm').fill('Mismatch123!');
  await page.locator('#auth-code').fill('123456');
  await page.locator('#auth-submit').click();
  expect((await page.evaluate(()=>window.authCalls)).filter(c=>c[0]==='reset-verify')).toHaveLength(0);
  await page.locator('#auth-confirm').fill('SyntheticNewPassword123!');
  await page.locator('#auth-code').fill('000000');
  await page.locator('#auth-submit').click();
  await expect(page.locator('#auth-message')).toContainText('验证码不正确');
  await expect(page.locator('#auth-dialog')).toBeVisible();
  await expect(page.locator('#cloud-account')).toHaveText('登录同步');
  await page.clock.fastForward(61000);
  await page.locator('#auth-resend').click();
  await expect(page.locator('#auth-message')).toContainText('重新发送');
  await page.locator('#auth-code').fill('123456');
  await page.locator('#auth-submit').click();
  await expect(page.locator('#auth-dialog')).not.toBeVisible();
  await expect(page.locator('#cloud-account')).toHaveText('climber@example.invalid');
  expect((await page.evaluate(()=>window.authCalls)).at(-1)).toEqual(['reset-verify',{nonce:'123456',password:'SyntheticNewPassword123!',request:2}]);
  await expect(page.locator('#auth-password')).toHaveValue('');
  expect(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))).not.toContain('SyntheticNewPassword');
  await page.locator('#cloud-signout').click();
  await expect(page.locator('#cloud-account')).toHaveText('登录同步');
  await page.locator('#cloud-account').click();
  await page.locator('#auth-reset').click();
  await page.locator('#auth-submit').click();
  await expect(page.locator('#auth-code')).toBeVisible();
  await page.locator('#auth-password').fill('SyntheticNewPassword123!');
  await page.locator('#auth-toggle').click();
  await expect(page.locator('#auth-code')).toBeHidden();
  await expect(page.locator('#auth-password')).toHaveValue('');
  await page.locator('#auth-reset').click();
  await page.locator('#auth-email').fill('missing@example.invalid');
  await page.locator('#auth-submit').click();
  await expect(page.locator('#auth-message')).toContainText('failed_precondition');
  await expect(page.locator('#auth-message')).not.toContainText('已经注册');
  await expect(page.locator('#auth-code')).toBeHidden();
  await page.locator('#auth-otp').click();
  await expect(page.locator('#auth-title')).toHaveText('邮箱验证码登录');
  await expect(page.locator('#auth-email')).toHaveValue('missing@example.invalid');
  await page.locator('#auth-register-direct').click();
  await expect(page.locator('#auth-title')).toHaveText('注册 PanleMEI账号');
  await expect(page.locator('#auth-email')).toHaveValue('missing@example.invalid');
  await expect(page.locator('#auth-password')).toHaveValue('');
  if(errors.length)throw new Error(errors.join('\n'));
  console.log('PASS (mocked transport): password confirmation, email signup, wrong OTP, resend message ID, cloud account initialization, reload, legacy username/email login, OTP login, challenge reset, disabled-provider errors, no stored password, actual SDK credential errors, password recovery, invalid recovery code, recovery resend callback, recovery cancellation.');
} finally {await browser.close()}
