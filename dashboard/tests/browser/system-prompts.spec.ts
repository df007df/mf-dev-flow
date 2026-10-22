import { test, expect } from "@playwright/test";

test("系统卡片统一回答两类问题，右侧按钮预览复制，轮询和关闭返回保留文档", async ({ page, request }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    let value = "原剪贴板";
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      readText: async () => value,
      writeText: async (text: string) => { value = text; },
    } });
  });
  const state = await (await request.get("/api/state")).json();
  const card = state.system.cards.find((item: any) => item.openQuestions?.length &&
    item.technicalIssues?.some((issue: any) => issue.status !== "resolved"));
  expect(card).toBeTruthy();
  await page.goto("/");
  const systems = page.locator(".section-card").filter({
    has: page.getByRole("heading", { name: "系统卡片", exact: true }),
  });
  await systems.getByRole("button").filter({ has: page.getByRole("heading", { name: card.title, exact: true }) }).click();
  const document = page.locator(".dialog-content:not(.prompt-dialog)");
  const questionHeading = document.locator(".markdown h2").filter({ hasText: /^待确认问题$/ });
  const button = questionHeading.getByRole("button", { name: `统一回答系统问题 · ${card.title}`, exact: true });
  await expect(document.locator(".document-prompt-action")).toHaveCount(1);
  await expect(button.locator("svg.lucide-sparkles")).toHaveCount(1);
  await button.scrollIntoViewIfNeeded();
  const headingBox = (await questionHeading.boundingBox())!;
  const buttonBox = (await button.boundingBox())!;
  expect(buttonBox.x).toBeGreaterThan(headingBox.x + headingBox.width / 2);
  expect(Math.abs(buttonBox.y + buttonBox.height / 2 - headingBox.y - headingBox.height / 2)).toBeLessThan(5);
  await button.click();
  const preview = page.locator(".prompt-dialog");
  await expect(preview.locator(".prompt-preview")).toHaveText(card.questionPrompt.answer);
  for (const question of card.openQuestions)
    await expect(preview).toContainText(question);
  for (const issue of card.technicalIssues.filter((item: any) => item.status !== "resolved"))
    await expect(preview).toContainText(`问题 ID：${issue.id}`);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("原剪贴板");
  await preview.getByRole("button", { name: "复制提示词", exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(card.questionPrompt.answer);
  const refreshed = page.waitForResponse((response) => /^\/api\/state\/?$/.test(new URL(response.url()).pathname) && response.ok());
  // 页面轮询间隔是 30 秒（见 app/page.tsx）；快进必须跨过真实间隔而不是“蹭”首屏在途响应
  await page.clock.fastForward(31000);
  await refreshed;
  await expect(preview).toBeVisible();
  await expect(document.locator(".document-prompt-action")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(document).toBeVisible();
  await expect(button).toBeFocused();
  await page.screenshot({ path: "/tmp/mf-dev-flow-system-question-button.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await button.click();
  const mobile = (await preview.boundingBox())!;
  expect(mobile.x).toBeGreaterThanOrEqual(0);
  expect(mobile.x + mobile.width).toBeLessThanOrEqual(390);
  await expect.poll(() => page.evaluate(() => window.document.documentElement.scrollWidth <= window.document.documentElement.clientWidth)).toBe(true);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await systems.getByRole("button", { name: "查看完整文档", exact: true }).click();
  await expect(page.getByRole("dialog").locator(".document-prompt-action")).toHaveCount(0);
});
