import { test, expect } from "@playwright/test";

test("poster editor boots in the clean layout", async ({ page }) => {
  await page.route("**/api/status", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, providers: { xai: false, openai: false } }) }));
  await page.goto("/");
  await expect(page.locator(".brand strong")).toHaveText("Poster Markup");
  await expect(page.locator("#stage")).toBeVisible();
  await expect(page.locator(".ai-panel")).toBeVisible();
  await expect(page.locator("#generateBtn")).toBeDisabled();
});

test("format switch and poster lock controls are available", async ({ page }) => {
  await page.route("**/api/status", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, providers: { xai: true, openai: true } }) }));
  await page.goto("/");
  await page.locator('[data-format="horizontal"]').click();
  await expect(page.locator("#stageMeta")).toContainText("1920 × 1080");
  await expect(page.locator("#posterScaleInput")).toBeDisabled();
  await page.locator("#posterLockInput").uncheck();
  await expect(page.locator("#posterScaleInput")).toBeEnabled();
});

test("Photopea opens as a separate in-app workspace", async ({ page }) => {
  await page.route("**/api/status", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, providers: { xai: false, openai: false } }) }));
  await page.goto("/");
  await page.locator('[data-workspace="photopea"]').click();
  await expect(page.locator("#photopeaWorkspace")).toBeVisible();
  await expect(page.locator("#posterWorkspace")).toBeHidden();
  await expect(page.locator("#photopeaFrame")).toHaveAttribute("src", "https://www.photopea.com/");
});
