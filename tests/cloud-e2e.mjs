import { readFile } from "node:fs/promises";
import { chromium, expect as baseExpect } from "@playwright/test";
import { strict as assert } from "node:assert";
const expect = baseExpect.configure({timeout:20000});
const origin = process.env.TEST_ORIGIN || "http://127.0.0.1:5173";
const base = "https://xcndecoavcnohnmwsbhx.supabase.co";
const users = {
  "a@example.invalid": {
    id: "e6449dce-a9e2-4302-a14a-9076c162e05b",
    email: "a@example.invalid",
    aud: "authenticated",
    role: "authenticated",
    created_at: new Date().toISOString(),
  },
  "b@example.invalid": {
    id: "d014e79e-cf99-45a6-a127-717183a59e0e",
    email: "b@example.invalid",
    aud: "authenticated",
    role: "authenticated",
    created_at: new Date().toISOString(),
  },
};
const rows = new Map(),
  photos = new Map(),
  errors = [];
const browser = await chromium.launch({ channel: "chrome", headless: true });
function jwt(user) {
  return [
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
      "base64url",
    ),
    Buffer.from(
      JSON.stringify({
        sub: user.id,
        role: "authenticated",
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString("base64url"),
    "test-signature",
  ].join(".");
}
async function newDevice() {
  const context = await browser.newContext({
    viewport: { width: 1100, height: 850 },
  });
  await context.route(`${base}/**`, async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      method = req.method();
    const reply = (data, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(data),
      });
    if (url.pathname === "/auth/v1/token") {
      const user = users[req.postDataJSON().email];
      return reply({
        access_token: jwt(user),
        refresh_token: `test-${user.id}`,
        token_type: "bearer",
        expires_in: 3600,
        user,
      });
    }
    if (url.pathname === "/auth/v1/logout") return reply({});
    if (url.pathname === "/auth/v1/recover") return reply({});
    if (url.pathname === "/auth/v1/signup")
      return reply(users[req.postDataJSON().email]);
    const token = req.headers().authorization?.replace("Bearer ", "");
    let id;
    try {
      id = JSON.parse(Buffer.from(token.split(".")[1], "base64url")).sub;
    } catch {}
    if (url.pathname === "/auth/v1/user")
      return reply(Object.values(users).find((u) => u.id === id));
    if (url.pathname === "/rest/v1/climb_collections") {
      const current = rows.get(id);
      if (method === "GET") return reply(current ? [current] : []);
      const body = req.postDataJSON();
      if (method === "POST" && current) return reply({ code: "23505" }, 409);
      if (
        method === "PATCH" &&
        url.searchParams.get("version") !== `eq.${current?.version}`
      )
        return reply([]);
      rows.set(id, structuredClone(body));
      return reply(
        req.headers().accept?.includes("vnd.pgrst.object")
          ? { version: body.version }
          : [{ version: body.version }],
      );
    }
    if (url.pathname.startsWith("/storage/v1/object/")) {
      const path = decodeURIComponent(
        url.pathname.split("/climb-photos/")[1] || "",
      );
      if (!path.startsWith(`${id}/`)) return reply({ error: "forbidden" }, 403);
      if (method === "POST") {
        const form = await new Response(req.postDataBuffer(), {
          headers: { "Content-Type": req.headers()["content-type"] },
        }).formData();
        const file = [...form.values()].find(value => typeof value.arrayBuffer === "function");
        if (!file) throw new Error("Upload body missing media file");
        photos.set(path, { type: file.type, bytes: Buffer.from(await file.arrayBuffer()) });
        return reply({ Key: `climb-photos/${path}` });
      }
      if (method === "GET" && photos.has(path))
        return route.fulfill({
          contentType: photos.get(path).type,
          body: photos.get(path).bytes,
        });
    }
    errors.push(`Unexpected request ${method} ${url.pathname}`);
    return reply({ error: "unmocked" }, 500);
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin);
  await expect(page.locator("#upload")).toBeEnabled();
  return { context, page };
}
async function login(page, email) {
  await page.locator("#cloud-account").click();
  await page.locator("#auth-email").fill(email);
  await page.locator("#auth-password").fill("test-only-password");
  await page.locator("#auth-submit").click();
  await expect(page.locator("#cloud-status")).toContainText("已读取云端");
}
try {
  const a = await newDevice();
  await a.page.locator("#upload").click();
  await a.page.locator("#upload-gym").fill("本机原有馆");
  await a.page.locator("#photo-files").setInputFiles({
    name: "云同步测试.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await expect(a.page.locator("#save-upload")).toBeEnabled();
  await a.page.locator("#save-upload").click();
  await expect(a.page.locator(".route-card")).toHaveCount(1);
  await login(a.page, "a@example.invalid");
  await expect(a.page.locator(".route-card")).toHaveCount(0);
  await a.page.locator("#cloud-import").click();
  await expect(a.page.locator(".route-card")).toHaveCount(1);
  assert.equal(photos.size, 1);
  assert.equal(
    rows.get(users["a@example.invalid"].id).payload.routes[0].photo,
    undefined,
  );
  await a.page.locator("#cloud-import").click();
  await expect(a.page.locator("#cloud-import")).toBeEnabled();
  assert.equal(photos.size, 1);
  const second = await newDevice();
  await login(second.page, "a@example.invalid");
  await expect(second.page.locator(".route-card")).toHaveCount(1);
  await second.page.locator(".done-toggle").click();
  await expect(second.page.locator(".done-toggle")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await a.page.locator(".done-toggle").click();
  await expect(a.page.locator("#toast")).toContainText("另一台设备");
  await expect(a.page.locator(".done-toggle")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await a.page.locator("#cloud-refresh").click();
  await expect(a.page.locator(".done-toggle")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await a.page.reload();
  await expect(a.page.locator("#cloud-status")).toContainText("已读取云端");
  await expect(a.page.locator(".done-toggle")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await a.page.locator("#cloud-signout").click();
  await expect(a.page.locator("#cloud-status")).toHaveText("本机模式");
  await expect(a.page.locator(".done-toggle")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await login(a.page, "b@example.invalid");
  await expect(a.page.locator(".route-card")).toHaveCount(0);
  await expect(a.page.locator("#gym-count")).toHaveText("共 82 家岩馆");
  await a.page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await a.page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await a.page.screenshot({
    path: "test-results/mobile-cloud.png",
    fullPage: true,
  });
  if (process.env.VIDEO_E2E === "1") {
    const videoBytes = await readFile("test-results/video-compressed.mp4");
    const backup = {app:"climb-log",version:2,gyms:[{id:"vg",name:"云视频馆"}],routes:[{
      id:"cloud-video",gymId:"vg",name:"云端视频测试",grade:"5.9",done:false,notes:"",createdAt:Date.now(),
      photo:`data:video/mp4;base64,${videoBytes.toString("base64")}`,videoMeta:{duration:4}
    }]};
    await a.page.locator("#backup-file").setInputFiles({name:"video.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(backup))});
    await expect(a.page.locator(".video-badge")).toBeVisible({timeout:20000});
    const videoRoute=rows.get(users["b@example.invalid"].id).payload.routes[0];
    assert.match(videoRoute.photoPath,/\.mp4$/);
    assert.equal(photos.get(videoRoute.photoPath).type,"video/mp4");
    assert.deepEqual(photos.get(videoRoute.photoPath).bytes,videoBytes);
    const remoteVideo=await newDevice();await login(remoteVideo.page,"b@example.invalid");
    await expect(remoteVideo.page.locator(".video-badge")).toBeVisible();
    await remoteVideo.page.locator(".photo-button").click();
    await remoteVideo.page.locator("#detail-dialog video").evaluate(async v=>{await v.play();v.pause();});
    await expect(second.page.locator(".video-badge")).toHaveCount(0);
    const objectCount=photos.size;
    await remoteVideo.page.locator("#detail-dialog .close-dialog").click();
    await remoteVideo.page.locator(".done-toggle").click();
    await expect(remoteVideo.page.locator(".done-toggle")).toHaveAttribute("aria-pressed","true");
    assert.equal(photos.size,objectCount,"video metadata edits must not upload another copy");
    console.log("PASS: real SDK MP4 upload bytes/MIME, second device private video playback, account isolation and metadata-only updates (mocked transport).");
  }
  const recovery = await newDevice();
  await recovery.page.locator("#cloud-account").click();
  await recovery.page.locator("#auth-toggle").click();
  await recovery.page.locator("#auth-email").fill("a@example.invalid");
  await recovery.page.locator("#auth-password").fill("new-test-password");
  await recovery.page.locator("#auth-submit").click();
  await expect(recovery.page.locator("#auth-message")).toContainText(
    "验证邮件",
  );
  await recovery.page.locator("#auth-toggle").click();
  await recovery.page.locator("#auth-reset").click();
  await recovery.page.locator("#auth-submit").click();
  await expect(recovery.page.locator("#auth-message")).toContainText(
    "重置邮件",
  );
  const fragment = new URLSearchParams({
    access_token: jwt(users["a@example.invalid"]),
    refresh_token: "fake-recovery",
    token_type: "bearer",
    expires_in: "3600",
    type: "recovery",
  });
  await recovery.page.goto("about:blank");
  await recovery.page.goto(`${origin}/#${fragment}`);
  await expect(recovery.page.locator("#auth-title")).toHaveText("设置新密码");
  await recovery.page.locator("#auth-password").fill("new-test-password");
  await recovery.page.locator("#auth-submit").click();
  await expect(recovery.page.locator("#auth-dialog")).not.toBeVisible();
  await expect(recovery.page.locator("#toast")).toHaveText("密码已更新");
  assert.deepEqual(errors, []);
  console.log(
    "PASS: cloud login, explicit local import, private photo upload, repeated merge, second device loading, automatic saves, stale-write rejection, refresh, reload, logout local preservation, account switching, mobile layout (mocked transport).",
  );
} finally {
  await browser.close();
}
