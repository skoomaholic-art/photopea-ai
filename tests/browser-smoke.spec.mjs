import { test, expect } from "@playwright/test";

async function waitForStudio(page) {
  await page.goto("/");
  await page.waitForFunction(() => !!window.Studio?.canvas, null, { timeout: 30_000 });
  await expect(page.locator("#skoomaHost")).toHaveClass(/active/);
}

test("unified shell and Fabric editor boot", async ({ page }) => {
  await waitForStudio(page);
  await expect(page.locator(".tool-rail")).toBeVisible();
  await expect(page.locator(".inspector")).toBeVisible();
  await expect(page.locator("#studioCanvas")).toBeAttached();
  for (const tool of ["move","marquee","lasso","wand","crop","brush","eraser","text","node","zoom"]) {
    await expect(page.locator('[data-tool="' + tool + '"]')).toBeVisible();
  }
});

test("shape draw, autosave, undo and redo", async ({ page }) => {
  await waitForStudio(page);
  const count = () => page.evaluate(() => Studio.canvas.getObjects().filter(o => !o.excludeFromExport && !o.helper).length);
  const before = await count();

  await page.locator('[data-tool="rect"]').click();
  const upper = page.locator(".upper-canvas");
  const box = await upper.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box.x + 220, box.y + 180);
  await page.mouse.down();
  await page.mouse.move(box.x + 420, box.y + 310, { steps: 8 });
  await page.mouse.up();

  await expect.poll(count).toBeGreaterThan(before);
  const afterDraw = await count();

  await page.evaluate(() => Studio.saveNow());
  await expect.poll(() => page.evaluate(async () => !!(await SkoomaStore.getProject("autosave"))?.canvas)).toBe(true);

  await page.locator("#undoBtn").click();
  await expect.poll(count).toBeLessThan(afterDraw);
  await page.locator("#redoBtn").click();
  await expect.poll(count).toBe(afterDraw);
});

test("AI Media Assets are drawers in the same application shell", async ({ page }) => {
  await waitForStudio(page);
  await page.locator('[data-panel="ai"]').click();
  await expect(page.locator("#aiDrawer")).toBeVisible();
  await expect(page.locator("#aiModel option")).toHaveCount(2);

  await page.locator('[data-panel="media"]').click();
  await expect(page.locator("#mediaDrawer")).toBeVisible();
  await expect(page.locator("#wikidataProviderChip")).toBeVisible();

  await page.locator('[data-panel="assets"]').click();
  await expect(page.locator("#assetsDrawer")).toBeVisible();
  await expect(page.locator("#assetFilters")).toBeVisible();
  await expect(page.locator("#assetSearch")).toBeVisible();
});

test("Jampea and Perchance never render known broken iframes", async ({ page }) => {
  await waitForStudio(page);

  await page.locator("#editorSelect").selectOption("jampea");
  await expect(page.locator("#externalFallback")).toBeVisible();
  await expect(page.locator("#externalOpenBtn")).toBeVisible();

  await page.locator("#editorSelect").selectOption("skooma");
  await page.locator('[data-panel="ai"]').click();
  await page.locator("#aiProvider").selectOption("perchance");
  await expect(page.locator("#perchanceFields")).toBeVisible();
  await expect(page.locator("#openPerchanceBtn")).toBeVisible();
});

test("compact layout keeps core tools and canvas reachable", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 900 });
  await waitForStudio(page);
  await expect(page.locator(".tool-rail")).toBeVisible();
  await expect(page.locator("#canvasViewport")).toBeVisible();
  await expect(page.locator('[data-panel="media"]')).toBeVisible();
});
