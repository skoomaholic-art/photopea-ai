import { test, expect } from "@playwright/test";

test("local background removal loads real browser model and returns PNG", async ({ page }) => {
  test.setTimeout(180_000);

  await page.route("**/api/health", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      apiVersion: "2026-09-23-runtime-v4",
      providers: { cloudflare: false, xai: false, openai: false },
      providerDetails: {},
      background: { local: true, carve: false, removal: false },
      images: {}
    })
  }));

  await page.goto("/");
  await page.waitForFunction(() => !!window.LocalBackgroundRemoval?.isAvailable?.());
  expect(await page.evaluate(() => window.LocalBackgroundRemoval.isAvailable())).toBe(true);

  const result = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = "#111111";
    ctx.beginPath();
    ctx.arc(64, 58, 32, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(48, 82, 32, 38);

    const input = canvas.toDataURL("image/png");
    const progress = [];
    const blob = await window.LocalBackgroundRemoval.remove(input, (message, ratio) => {
      progress.push({ message, ratio });
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return {
      type: blob.type,
      size: blob.size,
      signature: Array.from(bytes.slice(0, 8)),
      progressCount: progress.length,
      finished: progress.some(item => item.ratio === 1)
    };
  });

  expect(result.type).toBe("image/png");
  expect(result.size).toBeGreaterThan(100);
  expect(result.signature).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(result.progressCount).toBeGreaterThan(0);
  expect(result.finished).toBe(true);
});
