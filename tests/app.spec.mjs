import { test, expect } from "@playwright/test";

test("poster editor exposes AI adaptation controls", async ({ page }) => {
  await page.route("**/api/status", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, providers: { xai: true, openai: true } })
  }));
  await page.goto("/");
  await expect(page.locator("#aiProvider")).toHaveValue("xai");
  await expect(page.locator("#aiLanguage")).toHaveValue("kk");
  await expect(page.locator("#generateBtn")).toHaveText("Адаптировать логотип");
  await expect(page.locator("#generateBtn")).toBeEnabled();
  await expect(page.locator("#moveResultBtn")).toBeDisabled();
});
