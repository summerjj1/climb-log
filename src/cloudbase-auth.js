// CloudBase's signUp/signInWithOtp callbacks bind the verification message ID.
// Keep that callback in memory only; never persist registration passwords or codes.
export function cloudBaseAuthError(error, verifying = false, mode = "login") {
  const code = String(error?.code || "");
  const detail = `${code} ${error?.message || ""}`;
  if (/resource_exhausted|rate|too many/i.test(detail)) return "操作太频繁，请稍后再试。";
  if (/login_type_disabled|unimplemented|email.*disabled/i.test(detail)) return "邮箱验证服务尚未开启，请联系站长。已有账号仍可使用密码登录。";
  if (/captcha/i.test(detail)) return "服务要求额外的人机验证，请稍后重试或联系站长。";
  if (verifying && /invalid_argument|invalid.*code|expired|invalid_two_factor/i.test(detail)) return "验证码不正确或已过期，请检查邮件或重新发送。";
  if (/password_not_set/i.test(detail)) return "该账号尚未设置密码，请使用邮箱验证码登录。";
  if (/weak_password|password_too_weak|password.*(format|strength|length)|invalid_password_format/i.test(detail)) return "密码不符合要求，请使用至少 8 位的字母和数字组合。";
  if (/user_pending|email_not_verified|email.*not.*verified/i.test(detail)) return "邮箱尚未完成验证，请先完成注册邮件中的验证步骤。";
  if (/not_found|user.*(does not exist|not exist|not registered)|未注册|用户不存在/i.test(detail) && mode !== "login") return "当前腾讯云版未找到这个邮箱的账号。请检查邮箱和注册网址，或点击「注册账号」完成注册。";
  if (/invalid_username_or_password|wrong_password|invalid_password|invalid.*credential|not_found/i.test(detail)) return "账号或密码不正确。请检查输入，或点击「忘记密码」通过邮箱重新设置。";
  if (/already.*(registered|exist)/i.test(detail)) return "该邮箱已注册，请返回密码登录或使用邮箱验证码登录。";
  // This code also means USER-target verification cannot find an account. It
  // must never be treated as proof of a duplicate registration outside signup.
  if (/failed_precondition/i.test(detail)) {
    if (mode === "reset") return "暂时无法重设密码。请确认邮箱已在腾讯云版完成注册，或尝试「邮箱验证码登录」。（错误码：failed_precondition）";
    if (mode === "otp") return "暂时无法发送登录验证码。请确认邮箱已在腾讯云版完成注册。（错误码：failed_precondition）";
    return "当前操作条件未满足，请检查账号状态后重试。（错误码：failed_precondition）";
  }
  if (/blocked|invalid_status/i.test(detail)) return "账号暂时无法登录，请稍后重试或联系站长。";
  if (/invalid_argument/i.test(detail)) return "请检查邮箱及密码格式后重试。";
  if (/network|failed to fetch|unreachable|deadline_exceeded|timeout/i.test(detail)) return "连接失败，请检查网络后重试。";
  if (/unavailable|internal|server_error/i.test(detail)) return "登录服务暂时不可用，请稍后重试。";
  return "暂时无法完成操作，请稍后重试，或使用邮箱验证码登录。";
}

export function installCloudBaseAuth(auth) {
  const $ = (selector) => document.querySelector(selector);
  const dialog = $("#auth-dialog"), form = $("#auth-form");
  const identity = $("#auth-email"), password = $("#auth-password");
  const confirmation = $("#auth-confirm"), code = $("#auth-code");
  const submit = $("#auth-submit"), toggle = $("#auth-toggle"), alternate = $("#auth-reset");
  const otp = $("#auth-otp");
  const register = document.createElement("button");
  register.type = "button";
  register.id = "auth-register-direct";
  register.className = "text-button";
  register.textContent = "注册账号";
  $("#auth-modes").append(register);
  const resend = $("#auth-resend"), message = $("#auth-message");
  let mode = "login", challenge = null, busy = false, generation = 0;
  let resendAt = 0, timer = null;

  function render() {
    const verifying = !!challenge, signup = mode === "signup", resetting = mode === "reset";
    const passwordVisible = resetting ? verifying : !verifying && mode !== "otp";
    const confirming = passwordVisible && (signup || resetting);
    $("#auth-title").textContent = resetting ? "重设密码" : verifying ? "验证邮箱" : signup ? "注册 PanleMEI账号" : mode === "otp" ? "邮箱验证码登录" : "登录同步";
    $("#auth-description").textContent = verifying
      ? `验证码已发送至 ${challenge.email}，请查看收件箱或垃圾邮件。${resetting ? "请输入验证码并设置新密码。" : ""}`
      : resetting ? "输入账号绑定的邮箱，通过邮件验证码设置新密码。"
      : signup ? "使用邮箱注册并保存攀岩记录。若邮箱已注册，验证后会登录原账号，不会修改原密码；改密码请使用「忘记密码」。"
      : mode === "otp" ? "输入已注册的邮箱，收到验证码后即可登录。"
      : "输入注册邮箱或已有用户名，登录后同步个人记录。";
    $("#auth-identity-label").textContent = mode === "login" ? "邮箱或用户名" : "邮箱";
    identity.type = mode === "login" ? "text" : "email";
    identity.autocomplete = mode === "login" ? "username" : "email";
    identity.disabled = busy || verifying;
    identity.required = !verifying;
    $("#auth-password-label").hidden = !passwordVisible;
    password.disabled = busy || !passwordVisible;
    password.required = passwordVisible;
    password.minLength = signup || resetting ? 8 : 1;
    password.autocomplete = signup || resetting ? "new-password" : "current-password";
    $("#auth-confirm-label").hidden = !confirming;
    confirmation.disabled = busy || !confirming;
    confirmation.required = confirming;
    $("#auth-code-label").hidden = !verifying;
    code.disabled = busy || !verifying;
    code.required = verifying;
    submit.disabled = busy;
    submit.textContent = busy ? "正在处理…" : verifying ? resetting ? "保存新密码并登录" : "验证并登录" : mode === "login" ? "登录" : "发送验证码";
    $("#auth-modes").hidden = false;
    toggle.disabled = busy;
    toggle.textContent = mode === "login" ? "注册账号" : "返回密码登录";
    register.hidden = mode !== "reset" && mode !== "otp";
    register.disabled = busy;
    alternate.hidden = mode !== "login";
    alternate.disabled = busy;
    alternate.textContent = "忘记密码";
    otp.hidden = !["login", "reset", "signup"].includes(mode);
    otp.disabled = busy;
    resend.hidden = !verifying;
    const remaining = Math.max(0, Math.ceil((resendAt - Date.now()) / 1000));
    resend.disabled = busy || remaining > 0;
    resend.textContent = remaining ? `${remaining} 秒后可重新发送` : "重新发送验证码";
    $(".auth-note").textContent = "";
    $(".auth-note").hidden = true;
  }
  function clearChallenge() {
    challenge = null;
    clearInterval(timer);
    timer = null;
    password.value = confirmation.value = code.value = "";
    confirmation.setCustomValidity("");
  }
  function setMode(next) {
    generation++;
    busy = false;
    clearChallenge();
    mode = ["signup", "otp", "reset"].includes(next) ? next : "login";
    message.textContent = "";
    render();
  }
  function startCooldown() {
    resendAt = Date.now() + 60000;
    clearInterval(timer);
    timer = setInterval(render, 1000);
  }
  function complete(result) {
    if (result.error) throw result.error;
    if (!result.data?.session) throw new Error("Missing authenticated session");
    clearChallenge();
    dialog.close();
  }
  confirmation.oninput = () => confirmation.setCustomValidity("");
  password.oninput = () => confirmation.setCustomValidity("");
  register.onclick = () => setMode("signup");
  toggle.onclick = () => setMode(mode === "login" ? "signup" : "login");
  alternate.onclick = () => setMode("reset");
  otp.onclick = () => setMode("otp");
  dialog.addEventListener("close", () => setMode("login"));
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (busy) return;
    if (((mode === "signup" && !challenge) || (mode === "reset" && challenge)) && password.value !== confirmation.value) {
      confirmation.setCustomValidity("两次输入的密码不一致。");
      confirmation.reportValidity();
      return;
    }
    if (!form.reportValidity()) return;
    const epoch = generation;
    const email = identity.value.trim(), secret = password.value, token = code.value.trim();
    const verifying = !!challenge;
    busy = true;
    message.textContent = "";
    render();
    try {
      if (challenge) {
        const result = mode === "reset"
          ? await challenge.updateUser({nonce: token, password: secret})
          : await challenge.verifyOtp({ token, ...(challenge.messageId ? {messageId: challenge.messageId} : {}) });
        if (epoch !== generation) return;
        complete(result);
      } else if (mode === "login") {
        const result = await auth.signInWithPassword({ ...(email.includes("@") ? {email} : {username: email}), password: secret });
        if (epoch !== generation) return;
        complete(result);
      } else {
        const result = mode === "signup"
          ? await auth.signUp({email, password: secret})
          : mode === "reset" ? await auth.resetPasswordForEmail(email)
          : await auth.signInWithOtp({email, options: {shouldCreateUser: false}});
        if (epoch !== generation) return;
        if (result.error) throw result.error;
        const callback = mode === "reset" ? "updateUser" : "verifyOtp";
        if (typeof result.data?.[callback] !== "function") throw new Error("Missing verification callback");
        challenge = {email, [callback]: result.data[callback]};
        password.value = confirmation.value = "";
        startCooldown();
      }
    } catch (error) {
      if (epoch === generation) message.textContent = cloudBaseAuthError(error, verifying, mode);
    } finally {
      if (epoch === generation) {
        busy = false;
        render();
        if (challenge) code.focus();
      }
    }
  };
  resend.onclick = async () => {
    if (busy || !challenge || Date.now() < resendAt) return;
    const epoch = generation;
    busy = true;
    render();
    try {
      const result = mode === "signup"
        ? await auth.resend({email: challenge.email, type: "signup"})
        : mode === "reset" ? await auth.resetPasswordForEmail(challenge.email)
        : await auth.signInWithOtp({email: challenge.email, options: {shouldCreateUser: false}});
      if (epoch !== generation) return;
      if (result.error) throw result.error;
      if (mode === "signup") {
        if (!result.data?.messageId) throw new Error("Missing verification message ID");
        challenge.messageId = result.data.messageId;
      } else {
        const callback = mode === "reset" ? "updateUser" : "verifyOtp";
        if (typeof result.data?.[callback] !== "function") throw new Error("Missing verification callback");
        challenge = {email: challenge.email, [callback]: result.data[callback]};
      }
      code.value = "";
      message.textContent = "验证码已重新发送，请使用最新邮件中的验证码。";
      startCooldown();
    } catch (error) {
      if (epoch === generation) message.textContent = cloudBaseAuthError(error, false, mode);
    } finally {
      if (epoch === generation) { busy = false; render(); }
    }
  };
  setMode("login");
  return {setMode};
}
