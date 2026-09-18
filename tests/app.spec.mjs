import { test, expect } from "@playwright/test";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl9sAAAAASUVORK5CYII=",
  "base64"
);

async function ready(page) {
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.Studio?.canvas && window.APP));
  await expect(page.locator("#skoomaHost")).toHaveClass(/active/);
}

test("unified shell and core editor workflow", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await ready(page);

  await page.locator("#newDocBtn").click();
  await page.locator("#newDocWidth").fill("640");
  await page.locator("#newDocHeight").fill("360");
  await page.locator("#createDocBtn").click();
  await expect(page.locator("#docStatus")).toContainText("640 × 360");

  const upper = page.locator(".upper-canvas");

  await page.locator('[data-tool="rect"]').click();
  const box = await upper.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box.x + 120, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 280, box.y + 210, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => Studio.canvas.getObjects().filter(o => !o.helper).length)).toBe(1);

  await page.locator("#duplicateBtn").click();
  await expect.poll(() => page.evaluate(() => Studio.canvas.getObjects().filter(o => !o.helper).length)).toBe(2);

  await page.locator("#undoBtn").click();
  await expect.poll(() => page.evaluate(() => Studio.canvas.getObjects().filter(o => !o.helper).length)).toBe(1);
  await page.locator("#redoBtn").click();
  await expect.poll(() => page.evaluate(() => Studio.canvas.getObjects().filter(o => !o.helper).length)).toBe(2);

  await page.locator("#fileInput").setInputFiles({
    name: "pixel.png",
    mimeType: "image/png",
    buffer: tinyPng
  });
  await expect.poll(() => page.evaluate(() => Studio.canvas.getObjects().filter(o => !o.helper).length)).toBeGreaterThan(2);

  const download = page.waitForEvent("download");
  await page.locator("#exportBtn").click();
  expect((await download).suggestedFilename()).toMatch(/skooma-export\.(png|jpg|webp)$/);
});

test("drawers, provider fallback, project save and editor fallback", async ({ page }) => {
  await ready(page);

  await page.locator('[data-panel="ai"]').click();
  await expect(page.locator("#aiDrawer")).toBeVisible();
  await page.locator('[data-panel="media"]').click();
  await expect(page.locator("#mediaDrawer")).toBeVisible();
  await expect(page.locator("#mediaStatus")).toContainText("TVmaze");

  page.once("dialog", dialog => dialog.accept("Playwright project"));
  await page.locator("#saveProjectBtn").click();
  await expect.poll(() => page.evaluate(async () => {
    const projects = await SkoomaStore.listProjects();
    return projects.some(project => project.title === "Playwright project");
  })).toBe(true);
  await page.locator("#recentProjectsBtn").click();
  await expect(page.locator("#recentProjectsModal")).toBeVisible();
  await expect(page.locator("#recentProjectsList")).toContainText("Playwright project");

  await page.locator("#editorSelect").selectOption("jampea");
  await expect(page.locator("#externalFallback")).toBeVisible();
  await expect(page.locator("#externalFallbackTitle")).toContainText("Jampea");

  await page.locator("#editorSelect").selectOption("skooma");
  await expect(page.locator("#skoomaHost")).toHaveClass(/active/);
});

test("responsive shell survives desktop and mobile widths", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await ready(page);
  await expect(page.locator(".tool-rail")).toBeVisible();
  await expect(page.locator(".inspector")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".tool-rail")).toBeVisible();
  await expect(page.locator(".center-workspace")).toBeVisible();
  await page.locator('[data-panel="assets"]').click();
  await expect(page.locator("#assetsDrawer")).toBeVisible();
});
