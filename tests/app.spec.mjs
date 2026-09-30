import { test, expect } from "@playwright/test";

test("poster editor exposes the free-only image workflow", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#aiProvider")).toHaveValue("local");
  await expect(page.locator("#generateBtn")).toBeDisabled();
  await expect(page.locator("#aiLanguage")).toHaveValue("kk");
  await expect(page.locator("#copyAiPromptBtn")).toBeVisible();
  await expect(page.locator("#manualAiResult")).toHaveCount(1);
  await expect(page.locator("#libraryBtn")).toBeVisible();
  await expect(page.locator("#removeBackgroundBtn")).toBeEnabled();
});
