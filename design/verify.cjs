const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

// Optional design QA tooling; it is not a production dependency.
const output = path.join(__dirname, "review");
const origin = process.env.PROTOTYPE_ORIGIN || "http://127.0.0.1:4173";
fs.mkdirSync(output, { recursive: true });

(async () => {
  const macChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const executablePath = process.env.CHROME_EXECUTABLE || (fs.existsSync(macChrome) ? macChrome : undefined);
  const browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const errors = [];
  const checks = [];
  const screenshots = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  async function check(name, run) { await run(); checks.push(name); console.log(`PASS ${name}`); }
  async function shot(name) {
    await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector("#view")?.scrollTo(0, 0); document.querySelectorAll("dialog[open]").forEach((el) => el.scrollTo(0, 0)); });
    await page.screenshot({ path: path.join(output, name), fullPage: true }); screenshots.push(name);
  }
  async function nav(name) { await page.locator(`nav [data-page="${name}"], .sidebar-bottom [data-page="${name}"]`).click(); }
  const prototype = `${origin}/design/prototype/`;
  try {
    await page.goto(prototype, { waitUntil: "networkidle" });
    await page.evaluate(async () => { await document.fonts.ready; });
    await check("今日工作台与初始候选", async () => {
      assert.equal(await page.locator(".task-row").count(), 5);
      assert.equal(await page.locator("#nav-inbox-count").textContent(), "3");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await shot("today-desktop.png");
    });
    await check("飞书稍后提醒不改变截止", async () => {
      await page.getByRole("button", { name: "预览飞书提醒" }).click();
      await page.locator("#reminder-dialog").getByRole("button", { name: "稍后提醒", exact: true }).click();
      await page.locator('.task-title[data-id="4"]').click();
      assert.match(await page.locator("#detail-dialog").innerText(), /今天 16:00/);
      assert.match(await page.locator("#detail-dialog").innerText(), /1小时后提醒/);
      await shot("task-detail-desktop.png");
      await page.keyboard.press("Escape");
    });
    await check("文本入口与取消异步整理", async () => {
      await page.keyboard.press("Meta+k");
      await page.getByRole("button", { name: "填入示例纪要" }).click();
      await page.locator("#parse-button").click();
      await page.keyboard.press("Escape");
      await page.waitForTimeout(850);
      assert.equal(await page.locator("#page-label").textContent(), "今日工作台");
      await page.keyboard.press("Meta+k");
      await page.getByRole("button", { name: "填入示例纪要" }).click();
      await page.locator("#parse-button").click();
      await page.waitForTimeout(850);
      assert.equal(await page.locator(".candidate").count(), 3);
      assert.ok(await page.locator("#review-bar").isVisible());
      assert.ok((await page.locator("#review-bar").boundingBox()).y < 1000);
      await shot("inbox-desktop.png");
    });
    await check("候选编辑、预览、选择签收与丢弃", async () => {
      await page.locator('[data-candidate-field="due"]').first().fill("10月31日 09:00");
      await page.locator("#assist-input").fill("把第一条改为明天17点");
      await page.getByRole("button", { name: "预览修改", exact: true }).click();
      assert.equal(await page.locator('[data-candidate-field="due"]').first().inputValue(), "10月30日 17:00");
      await page.locator('[data-candidate-select="2"]').uncheck();
      await page.locator('[data-action="sign"]').click();
      assert.equal(await page.locator(".candidate").count(), 1);
      await page.getByRole("button", { name: "丢弃这条" }).click();
      assert.match(await page.locator("#view").innerText(), /都收好了/);
      await shot("inbox-empty-desktop.png");
      await nav("all");
      assert.equal(await page.getByRole("button", { name: "整理模型网关接入清单", exact: true }).count(), 1);
      assert.equal(await page.getByRole("button", { name: "跟进SDK鉴权问题修复", exact: true }).count(), 0);
    });
    await check("手工录入、编辑、完成与删除", async () => {
      await page.locator('[data-action="intake"]').click();
      await page.getByRole("button", { name: "表单录入", exact: true }).click();
      await page.locator("#manual-title").fill("原型走查：确认会议材料");
      await page.locator("#manual-due").fill("2026-10-30T17:00");
      await page.getByRole("button", { name: "保存事项", exact: false }).click();
      await page.getByRole("button", { name: "原型走查：确认会议材料", exact: true }).click();
      await page.locator("#detail-dialog").getByRole("button", { name: "编辑", exact: true }).click();
      await page.locator("#edit-title").fill("原型走查：跟进会议材料");
      await page.locator("#edit-kind").selectOption("followup");
      await page.locator("#edit-owner").fill("示例同事");
      await page.locator("#edit-due").fill("明天 18:00");
      await page.locator("#edit-followup").fill("今天 17:30");
      await page.getByRole("button", { name: "保存修改", exact: true }).click();
      assert.match(await page.locator("#detail-dialog").innerText(), /示例同事/);
      assert.match(await page.locator("#detail-dialog").innerText(), /明天 18:00/);
      await page.getByRole("button", { name: "完成事项", exact: true }).click();
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "已完成", exact: true }).click();
      await page.getByRole("button", { name: "原型走查：跟进会议材料", exact: true }).click();
      await page.locator("#detail-dialog").getByRole("button", { name: "编辑", exact: true }).click();
      await page.getByRole("button", { name: "删除事项", exact: true }).click();
      await page.getByRole("button", { name: "确认删除", exact: true }).click();
      assert.equal(await page.getByRole("button", { name: "原型走查：跟进会议材料", exact: true }).count(), 0);
    });
    await check("搜索空态与清除", async () => {
      await page.getByRole("button", { name: "未完成", exact: true }).click();
      await page.locator("#task-search").fill("不存在的示例事项");
      assert.match(await page.locator("#view").innerText(), /没有找到相关事项/);
      await page.getByRole("button", { name: "清除搜索", exact: true }).click();
      assert.ok(await page.locator(".task-row").count() > 0);
    });
    await check("三个角色的个性化与模型演示", async () => {
      await nav("settings");
      await page.locator("#agent-prompt").fill("原型偏好：保留所有原文依据。");
      await page.locator("#agent-model").selectOption({ label: "示例快速模型" });
      await page.getByRole("button", { name: "保存偏好", exact: true }).click();
      await page.locator('[data-agent="tracker"]').click();
      await page.locator('[data-agent="organizer"]').click();
      assert.equal(await page.locator("#agent-prompt").inputValue(), "原型偏好：保留所有原文依据。");
      assert.equal(await page.locator("#agent-model").inputValue(), "示例快速模型");
      await page.getByRole("button", { name: "模拟测试连接", exact: false }).click();
      await page.waitForTimeout(850);
      assert.match(await page.locator("#view").innerText(), /演示连接成功/);
      await shot("agents-desktop.png");
    });
    await check("来源加载、失败、恢复与收集周期", async () => {
      await page.getByRole("button", { name: "信息来源", exact: true }).click();
      await page.locator("#source-interval").selectOption({ label: "每 1 小时" });
      await page.getByRole("button", { name: "预览失败状态", exact: true }).click();
      assert.match(await page.locator("#view").innerText(), /示例：飞书连接已失效/);
      await shot("source-error-desktop.png");
      await page.getByRole("button", { name: "模拟重新连接", exact: true }).click();
      await page.getByRole("button", { name: "模拟收集一次", exact: false }).click();
      await page.waitForTimeout(850);
      assert.equal(await page.locator("#source-interval").inputValue(), "每 1 小时");
      await page.getByRole("switch", { name: "工作模式", exact: true }).click();
      assert.equal(await page.getByRole("switch", { name: "工作模式", exact: true }).getAttribute("aria-checked"), "true");
    });
    await check("工作目录、Skills与MCP仅模拟状态", async () => {
      await page.getByRole("button", { name: "工作目录与工具", exact: true }).click();
      await page.getByRole("button", { name: "查看目录结构", exact: false }).click();
      assert.match(await page.locator(".code-view").innerText(), /data\/sidekick.sqlite/);
      await page.getByRole("button", { name: "模拟连接", exact: true }).click();
      assert.match(await page.locator("#view").innerText(), /演示已连接/);
      await page.getByRole("button", { name: "预览错误", exact: true }).click();
      assert.match(await page.locator("#view").innerText(), /服务命令不可用/);
      await shot("tools-desktop.png");
    });
    await check("日报演示标注与模拟生成", async () => {
      await nav("report");
      assert.match(await page.locator("#view").innerText(), /非真实 AI 输出/);
      await page.getByRole("button", { name: "模拟重新生成", exact: false }).click();
      await page.waitForTimeout(850);
      await shot("report-desktop.png");
    });
    await check("窄窗口与品牌板", async () => {
      await page.goto(prototype, { waitUntil: "networkidle" });
      await page.setViewportSize({ width: 640, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await shot("today-narrow.png");
      await nav("inbox");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      const bar = await page.locator("#review-bar").boundingBox();
      assert.ok(bar.y >= 0 && bar.y + bar.height <= 901, "Sign-off bar must remain inside the real viewport");
      assert.ok(await page.getByRole("button", { name: "待确认", exact: true }).isVisible());
      assert.equal(await page.locator("#nav-inbox-count").isVisible(), true);
      await page.screenshot({ path: path.join(output, "inbox-narrow-viewport.png"), fullPage: false }); screenshots.push("inbox-narrow-viewport.png");
      await shot("inbox-narrow.png");
      await page.goto(`${origin}/design/brand/`, { waitUntil: "networkidle" });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await shot("brand-narrow.png");
      await page.setViewportSize({ width: 1440, height: 1000 });
      await shot("brand-desktop.png");
    });
    assert.deepEqual(errors, [], "Browser errors or failed resource requests");
    fs.writeFileSync(path.join(output, "verification.json"), JSON.stringify({ status: "passed", checks, browserErrors: errors, screenshots, scope: "HTML design prototype only; no production integration" }, null, 2));
    console.log(`PASS ${checks.length} interaction groups; ${screenshots.length} captures; zero browser errors.`);
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
