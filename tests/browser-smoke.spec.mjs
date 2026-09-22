import { test, expect } from "@playwright/test";

test("poster editor boots in the clean layout", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".brand strong")).toHaveText("Poster Markup");
  await expect(page.locator("#stage")).toBeVisible();
  await expect(page.locator("#openPhotopeaBtn")).toBeVisible();
  await expect(page.locator(".ai-panel")).toBeVisible();
});

test("format switch and poster controls are available", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-format="horizontal"]').click();
  await expect(page.locator("#stageMeta")).toContainText("1920 × 1080");
  await expect(page.locator("#downloadBtn")).toBeVisible();
  await expect(page.locator("#positionSelect")).toBeVisible();
});
