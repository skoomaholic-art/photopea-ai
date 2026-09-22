import { test, expect } from "@playwright/test";

test("poster editor exposes AI adaptation controls", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#aiProvider")).toHaveValue("grok");
  await expect(page.locator("#aiLanguage")).toHaveValue("kk");
  await expect(page.locator("#generateBtn")).toHaveText("Адаптировать логотип");
  await expect(page.locator("#moveResultBtn")).toBeDisabled();
});
