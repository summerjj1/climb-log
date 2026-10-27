import { chromium } from "@playwright/test";
import { strict as assert } from "node:assert";
import { mkdir, readFile } from "node:fs/promises";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage(),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await mkdir("test-results", { recursive: true });
try {
  await page.goto("http://127.0.0.1:5173");
  await page.waitForFunction(() => !document.querySelector("#upload").disabled);
  await page.screenshot({
    path: "test-results/desktop-empty.png",
    fullPage: true,
  });
  assert.equal(await page.locator(".route-card").count(), 0);
  assert.equal(await page.locator("#gym-count").textContent(), "共 82 家岩馆");
  const png = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 600;
    c.height = 800;
    const x = c.getContext("2d");
    x.fillStyle = "#dcded1";
    x.fillRect(0, 0, 600, 800);
    for (let i = 0; i < 10; i++) {
      x.fillStyle = i % 2 ? "#567455" : "#ad7055";
      x.beginPath();
      x.ellipse(100 + ((i * 83) % 400), 60 + i * 70, 25, 13, i, 0, Math.PI * 2);
      x.fill();
    }
    x.fillStyle = "#243c33";
    x.font = "26px sans-serif";
    x.fillText("TEST FIXTURE", 30, 760);
    return c.toDataURL().split(",")[1];
  });
  const buffer = Buffer.from(png, "base64");
  await page.locator("#upload").click();
  const ydsGrades = [
    "5.8",
    "5.9",
    ...[10, 11, 12, 13, 14, 15].flatMap((n) =>
      ["a", "b", "c", "d"].map((letter) => `5.${n}${letter}`),
    ),
  ];
  assert.deepEqual(
    await page.locator("#default-grade option").allTextContents(),
    ydsGrades,
  );
  assert.equal(await page.locator("#default-grade").inputValue(), "5.8");
  await page.locator("#upload-gym").fill("测试岩馆 A");
  await page.locator("#photo-files").setInputFiles(
    ["5.9", "5.10b", "5.10a"].map((name) => ({
      name: `线路 ${name}.png`,
      mimeType: "image/png",
      buffer,
    })),
  );
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".pending-row").length === 3 &&
      !document.querySelector("#save-upload").disabled,
  );
  await page.locator("#default-grade").selectOption("5.15d");
  assert.deepEqual(
    await page
      .locator("[data-field=grade]")
      .evaluateAll((elements) => elements.map((e) => e.value)),
    ["5.15d", "5.15d", "5.15d"],
  );
  for (const [i, value] of ["5.9", "5.10b", "5.10a"].entries())
    await page.locator("[data-field=grade]").nth(i).selectOption(value);
  await page.locator("[data-field=done]").nth(1).check();
  await page.screenshot({
    path: "test-results/desktop-upload.png",
    fullPage: true,
  });
  await page.locator("#save-upload").click();
  await page.waitForFunction(
    () => document.querySelectorAll(".route-card").length === 3,
  );
  await page.locator("#sort").selectOption("easy");
  assert.deepEqual(await page.locator(".grade-pill").allTextContents(), [
    "5.9",
    "5.10a",
    "5.10b",
  ]);
  await page.locator(".done-toggle").first().click();
  await page.waitForFunction(
    () => document.querySelectorAll(".done-toggle.done").length === 2,
  );
  await page.reload();
  await page.waitForFunction(
    () => document.querySelectorAll(".route-card").length === 3,
  );
  assert.equal(await page.locator(".done-toggle.done").count(), 2);
  assert.equal(
    await page
      .locator(".photo-button img")
      .evaluateAll((imgs) =>
        imgs.every((i) => i.complete && i.naturalWidth > 0),
      ),
    true,
  );
  await page.locator("[data-status=done]").click();
  assert.equal(await page.locator(".route-card").count(), 2);
  await page.locator("#grade-filter").selectOption("5.9");
  assert.equal(await page.locator(".route-card").count(), 1);
  await page.locator("#search").fill("不存在");
  assert.equal(await page.locator(".route-card").count(), 0);
  await page.locator("#empty-reset").click();
  assert.equal(await page.locator(".route-card").count(), 3);
  await page.locator(".photo-button").first().click();
  await page.locator("[name=name]").fill("技术线 <安全显示>");
  await page.locator("[name=notes]").fill("下次注意右脚的位置");
  await page.locator("[name=gym]").fill("测试岩馆 B");
  await page.locator("[name=grade]").selectOption("5.11a");
  await page.locator("#edit-form button[type=submit]").click();
  await page.waitForFunction(
    () => !document.querySelector("#detail-dialog").open,
  );
  assert.equal(await page.locator(".route-card").count(), 3);
  await page.locator(".gym-nav").filter({ hasText: "测试岩馆 B" }).click();
  assert.equal(await page.locator(".route-card").count(), 1);
  const routeBeforeRename = await page
    .locator(".photo-button")
    .getAttribute("data-detail");
  const doneBeforeRename = await page
    .locator(".done-toggle")
    .getAttribute("aria-pressed");
  await page.locator("#rename-gym").click();
  await page.locator("#rename-gym-name").fill("测试岩馆 A");
  await page.locator("#rename-gym-form button[type=submit]").click();
  await page.waitForFunction(() =>
    document.querySelector("#rename-gym-error").textContent.includes("同名"),
  );
  assert.equal(await page.locator("#page-title").textContent(), "测试岩馆 B");
  await page.locator("#rename-gym-name").fill("   ");
  await page.locator("#rename-gym-form button[type=submit]").click();
  assert.match(await page.locator("#rename-gym-error").textContent(), /空格/);
  await page.locator("#cancel-rename-gym").click();
  assert.equal(await page.locator("#page-title").textContent(), "测试岩馆 B");
  await page.locator("#rename-gym").click();
  await page.locator("#rename-gym-name").fill("  测试岩馆 B 新名称  ");
  await page.locator("#rename-gym-form button[type=submit]").click();
  await page.waitForFunction(
    () => document.querySelector("#rename-gym-form").hidden,
  );
  assert.equal(
    await page.locator("#page-title").textContent(),
    "测试岩馆 B 新名称",
  );
  await page.reload();
  await page
    .locator(".gym-nav")
    .filter({ hasText: "测试岩馆 B 新名称" })
    .click();
  assert.equal(await page.locator(".route-card").count(), 1);
  assert.equal(
    await page.locator(".photo-button").getAttribute("data-detail"),
    routeBeforeRename,
  );
  assert.equal(
    await page.locator(".done-toggle").getAttribute("aria-pressed"),
    doneBeforeRename,
  );
  assert.match(
    await page.locator(".card-info p").textContent(),
    /测试岩馆 B 新名称/,
  );
  await page.screenshot({
    path: "test-results/desktop-rename.png",
    fullPage: true,
  });
  await page.locator("#search").fill("右脚");
  assert.equal(await page.locator(".route-card").count(), 1);
  await page.locator("[data-gym=all]").click();
  await page.screenshot({
    path: "test-results/desktop-gallery.png",
    fullPage: true,
  });
  await page.waitForFunction(
    () => document.querySelectorAll(".gym-nav").length === 85,
  );
  assert.equal(await page.locator(".route-card").count(), 3);
  await page.locator("#gym-search").fill("香蕉");
  assert.equal(await page.locator(".gym-nav").count(), 5);
  await page.locator("#gym-search").fill("徐汇区");
  assert.ok((await page.locator(".gym-nav").count()) > 1);
  await page.locator("#gym-search").fill("没有这家岩馆");
  assert.equal(await page.locator(".gym-nav").count(), 1);
  await page.locator("#gym-search").fill("香蕉");
  await page.locator(".gym-nav").filter({ hasText: "延安西路" }).click();
  const catalogGymId = await page
    .locator(".gym-nav.active")
    .getAttribute("data-gym");
  await page.locator("#rename-gym").click();
  await page.locator("#rename-gym-name").fill("我的常去香蕉馆");
  await page.locator("#rename-gym-form button[type=submit]").click();
  await page.waitForFunction(
    () => document.querySelector("#rename-gym-form").hidden,
  );
  await page.locator("#gym-search").fill("");
  assert.equal(await page.locator(".gym-nav").count(), 85);
  assert.equal(
    await page.locator("#page-title").textContent(),
    "我的常去香蕉馆",
  );
  await page.reload();
  await page.locator(`[data-gym="${catalogGymId}"]`).click();
  assert.equal(
    await page.locator("#page-title").textContent(),
    "我的常去香蕉馆",
  );
  await page.locator("[data-gym=all]").click();
  await page.screenshot({
    path: "test-results/desktop-catalog.png",
    fullPage: true,
  });
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#export-data").click();
  const download = await downloadPromise;
  await download.saveAs("test-results/backup.json");
  const backup = JSON.parse(await readFile("test-results/backup.json", "utf8"));
  assert.equal(backup.routes.length, 3);
  assert.equal(backup.gyms.length, 84);
  assert.equal(backup.gyms.filter((g) => g.catalogId).length, 82);
  assert.match(backup.routes[0].photo, /^data:image\/jpeg/);
  await page.locator("#backup-file").setInputFiles("test-results/backup.json");
  await page.waitForFunction(() =>
    document.querySelector("#toast").textContent.includes("新增 0"),
  );
  assert.equal(await page.locator(".route-card").count(), 3);
  await page.locator(".photo-button").first().click();
  await page.locator("#delete-route").click();
  await page.locator("#delete-route").click();
  await page.waitForFunction(
    () => document.querySelectorAll(".route-card").length === 2,
  );
  await page.locator("#backup-file").setInputFiles("test-results/backup.json");
  await page.waitForFunction(
    () => document.querySelectorAll(".route-card").length === 3,
  );
  await page.locator("#backup-file").setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"app":"bad"}'),
  });
  await page.waitForFunction(() =>
    document.querySelector("#toast").textContent.includes("有效"),
  );
  assert.equal(await page.locator(".route-card").count(), 3);
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .locator(".gym-nav")
    .filter({ hasText: "测试岩馆 B 新名称" })
    .click();
  await page.locator("#rename-gym").click();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  await page.screenshot({
    path: "test-results/mobile-rename.png",
    fullPage: true,
  });
  await page.locator("#cancel-rename-gym").click();
  await page.locator("[data-gym=all]").click();
  await page.screenshot({
    path: "test-results/mobile-gallery.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  await page.locator("#upload").click();
  await page
    .locator("#photo-files")
    .setInputFiles({ name: "手机测试.png", mimeType: "image/png", buffer });
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".pending-row").length === 1 &&
      !document.querySelector("#save-upload").disabled,
  );
  await page.screenshot({
    path: "test-results/mobile-upload.png",
    fullPage: true,
  });
  assert.equal(
    await page
      .locator("#upload-dialog")
      .evaluate((e) => e.scrollWidth <= e.clientWidth),
    true,
  );
  await page.keyboard.press("Escape");
  const clean = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    cleanPage = await clean.newPage();
  await cleanPage.goto("http://127.0.0.1:5173");
  await cleanPage.waitForFunction(
    () => !document.querySelector("#upload").disabled,
  );
  await cleanPage.screenshot({
    path: "test-results/mobile-empty.png",
    fullPage: true,
  });
  await cleanPage
    .locator("#backup-file")
    .setInputFiles("test-results/backup.json");
  await cleanPage.waitForFunction(
    () => document.querySelectorAll(".route-card").length === 3,
  );
  await cleanPage.reload();
  await cleanPage.waitForFunction(
    () => document.querySelectorAll(".route-card").length === 3,
  );
  assert.equal(await cleanPage.locator(".done-toggle.done").count(), 2);

  assert.equal(await cleanPage.locator(".gym-nav").count(), 85);
  await cleanPage.locator("#gym-search").fill("延安西路");
  assert.match(
    await cleanPage.locator("#gyms").textContent(),
    /我的常去香蕉馆/,
  );
  await cleanPage.screenshot({
    path: "test-results/mobile-catalog.png",
    fullPage: true,
  });
  await clean.close();
  assert.deepEqual(errors, []);
  console.log(
    "PASS: batch upload, grades, completion persistence, filters, edit/move, backups, Shanghai defaults/search/rename/restore, delete/restore, invalid backup, mobile layouts.",
  );
} finally {
  await browser.close();
}
