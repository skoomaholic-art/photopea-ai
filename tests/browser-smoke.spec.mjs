import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLQ7wAAAABJRU5ErkJggg==", "base64");
const PNG_DATA = "data:image/png;base64," + PNG.toString("base64");

async function mockStatus(page, extra = {}) {
  await page.route("**/api/status", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      providers: { xai: true, openai: true },
      background: { carve: true, removal: true },
      posters: { tvmaze: true, tmdb: false },
      ...extra
    })
  }));
}

function zipEntries(buffer) {
  const entries = [];
  let offset = 0;
  while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = buffer.subarray(nameStart, nameStart + nameLength).toString("utf8");
    const dataStart = nameStart + nameLength + extraLength;
    entries.push({ name, data: buffer.subarray(dataStart, dataStart + compressedSize) });
    offset = dataStart + compressedSize;
  }
  return entries;
}

test("boots with four workspaces, icon and server-backed controls", async ({ page }) => {
  await mockStatus(page);
  await page.goto("/");
  await expect(page.locator(".brand strong")).toHaveText("Poster Editor");
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", "app-icon.svg");
  await expect(page.locator(".workspace-tab")).toHaveCount(4);
  await expect(page.locator("#posterWorkspace")).toBeVisible();
  await expect(page.locator("#generateBtn")).toBeEnabled();
  await expect(page.locator("#removeBackgroundBtn")).toBeEnabled();
});

test("poster search, background removal and vertical/horizontal states are independent", async ({ page }) => {
  await mockStatus(page);
  await page.route("**/api/posters?*", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      results: [{
        id: "tvmaze-1", title: "Test Show", year: "2026", type: "TV",
        source: "TVmaze", quality: "original", image: PNG_DATA
      }]
    })
  }));
  await page.route("**/api/remove-background", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ image: PNG_DATA, provider: "Carve.Photos" })
  }));
  await page.goto("/");

  await page.locator("#posterSearchInput").fill("Test");
  await page.locator("#posterSearchBtn").click();
  await expect(page.locator(".poster-card")).toHaveCount(1);
  await page.locator(".poster-card").click();
  await expect(page.locator("#posterImage")).toBeVisible();

  await page.locator("#posterFileInput").setInputFiles({ name: "vertical.png", mimeType: "image/png", buffer: PNG });
  await page.locator("#layerScaleInput").fill("135");
  await page.locator("#layerRotationInput").fill("17");
  await page.locator("#removeBackgroundBtn").click();
  await expect(page.locator("#bgRemoveStatus")).toContainText("Положение и трансформация сохранены");

  await page.locator('[data-workspace="horizontal"]').click();
  await page.locator("#posterFileInput").setInputFiles({ name: "horizontal.png", mimeType: "image/png", buffer: PNG });
  await page.locator("#layerScaleInput").fill("165");
  await page.locator("#layerRotationInput").fill("-8");

  await page.locator('[data-workspace="vertical"]').click();
  const states = await page.evaluate(() => window.PosterApp.getState());
  expect(states.vertical.posterName).toBe("vertical.png");
  expect(states.vertical.posterScale).toBe(135);
  expect(states.vertical.posterRotation).toBe(17);
  expect(states.horizontal.posterName).toBe("horizontal.png");
  expect(states.horizontal.posterScale).toBe(165);
  expect(states.horizontal.posterRotation).toBe(-8);

  for (let i = 0; i < 4; i++) {
    await page.locator('[data-workspace="horizontal"]').click();
    await page.locator('[data-workspace="vertical"]').click();
  }
  const afterSwitches = await page.evaluate(() => window.PosterApp.getState());
  expect(afterSwitches).toEqual(states);
});

test("poster exports create PNGs and a two-file ZIP", async ({ page }) => {
  await mockStatus(page);
  await page.goto("/");
  await page.locator("#posterFileInput").setInputFiles({ name: "v.png", mimeType: "image/png", buffer: PNG });
  await page.locator('[data-workspace="horizontal"]').click();
  await page.locator("#posterFileInput").setInputFiles({ name: "h.png", mimeType: "image/png", buffer: PNG });

  const verticalPromise = page.waitForEvent("download");
  await page.locator("#downloadVerticalBtn").click();
  const vertical = await verticalPromise;
  expect(vertical.suggestedFilename()).toBe("poster-vertical.png");

  const zipPromise = page.waitForEvent("download");
  await page.locator("#downloadPostersZipBtn").click();
  const zipDownload = await zipPromise;
  expect(zipDownload.suggestedFilename()).toBe("posters.zip");
  const path = await zipDownload.path();
  const entries = zipEntries(await readFile(path));
  expect(entries.map(x => x.name)).toEqual(["poster-vertical.png", "poster-horizontal.png"]);
  for (const entry of entries) expect(entry.data.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
});

test("train editor constrains sticker and exports exact 4 folders / 24 PNG", async ({ page }) => {
  await mockStatus(page);
  await page.goto("/");
  await page.locator('[data-workspace="train"]').click();
  await page.waitForFunction(() => !!window.TrainEditor);

  await page.locator("#trainAddTextBtn").click();
  await page.locator("#stickerSelect").selectOption({ label: "Премьера" });
  const inspect = await page.evaluate(() => window.TrainEditor.inspect());
  expect(inspect.objectCount).toBeGreaterThanOrEqual(2);
  expect(inspect.sticker.text).toBe("Премьера");
  expect(inspect.sticker.left).toBeGreaterThanOrEqual(0);
  expect(inspect.sticker.top).toBeGreaterThanOrEqual(0);
  expect(inspect.sticker.left + inspect.sticker.width).toBeLessThanOrEqual(492.5);
  expect(inspect.sticker.top + inspect.sticker.height).toBeLessThanOrEqual(366.5);

  await page.locator("#trainDeviceModeBtn").click();
  await expect(page.locator("#trainDeviceView")).toBeVisible();
  await expect(page.locator("#trainDeviceView canvas")).toHaveCount(6);
  await page.locator("#trainCanvasModeBtn").click();
  await expect(page.locator("#segmentGuides")).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#trainDownloadAllBtn").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("Паровозик.zip");
  const path = await download.path();
  const entries = zipEntries(await readFile(path));

  const expected = [];
  const folders = ["1 - 164x122", "2 - 246x183", "3 - 328x244", "4 - 492x366"];
  for (const folder of folders) for (let part = 1; part <= 6; part++) expected.push(`${folder}/part_${part}.png`);
  expect(entries.map(x => x.name)).toEqual(expected);
  expect(entries).toHaveLength(24);
  for (const entry of entries) expect(entry.data.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
});

test("project autosave survives reload for posters and train sticker", async ({ page }) => {
  await mockStatus(page);
  await page.goto("/");
  await page.locator("#posterFileInput").setInputFiles({ name: "remember.png", mimeType: "image/png", buffer: PNG });
  await page.locator('[data-workspace="train"]').click();
  await page.waitForFunction(() => !!window.TrainEditor);
  await page.locator("#stickerSelect").selectOption({ label: "Жаңа маусым" });
  await page.waitForTimeout(1100);

  await page.reload();
  await page.waitForFunction(() => !!window.PosterApp && !!window.TrainEditor);
  await page.waitForTimeout(500);
  const posterState = await page.evaluate(() => window.PosterApp.getState());
  expect(posterState.vertical.posterName).toBe("remember.png");

  await page.locator('[data-workspace="train"]').click();
  const inspect = await page.evaluate(() => window.TrainEditor.inspect());
  expect(inspect.sticker?.text).toBe("Жаңа маусым");
});

test("Photopea remains a separate workspace", async ({ page }) => {
  await mockStatus(page);
  await page.goto("/");
  await page.locator('[data-workspace="photopea"]').click();
  await expect(page.locator("#photopeaWorkspace")).toBeVisible();
  await expect(page.locator("#posterWorkspace")).toBeHidden();
  await expect(page.locator("#photopeaFrame")).toHaveAttribute("src", "https://www.photopea.com/");
});
