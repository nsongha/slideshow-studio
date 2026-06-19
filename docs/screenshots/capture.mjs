// Capture UI screenshots from the running app at http://127.0.0.1:8766.
// Run with: node docs/screenshots/capture.mjs

import { chromium } from "/Users/songha/Documents/Projects/songha.net/node_modules/playwright/index.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = __dirname;
const URL = "http://127.0.0.1:8766/";

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, name), fullPage: false });
  console.log(`  ✓ ${name}`);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();

console.log("→ Loading", URL);
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);

// 1. Hero — default state with assets + controls + output gallery visible
await shot(page, "01-hero.png");

// 2. Click first output video thumbnail → player shows video
const videoThumb = page.locator("img[src*='/thumb'], [data-output], button:has(img)").filter({ hasNot: page.locator("[src*='/api/images/']") }).first();
const altThumb = page.locator("img[src*='output']").first();
let clicked = false;
for (const candidate of [videoThumb, altThumb]) {
  if (await candidate.count()) {
    await candidate.scrollIntoViewIfNeeded().catch(() => {});
    await candidate.click({ force: true }).catch(() => {});
    clicked = true;
    break;
  }
}
if (clicked) {
  await page.waitForTimeout(1500);
  // pause the video so screenshot isn't a black frame mid-load
  await page.evaluate(() => {
    document.querySelectorAll("video").forEach((v) => {
      v.pause();
      v.currentTime = Math.min(1.5, (v.duration || 4) * 0.4);
    });
  }).catch(() => {});
  await page.waitForTimeout(800);
  await shot(page, "02-video-playing.png");
}

// 3. Hover an asset row to reveal replace/delete buttons
await page.mouse.move(0, 0);
await page.waitForTimeout(300);
const firstCard = page.locator("[draggable='true']").first();
if (await firstCard.count()) {
  await firstCard.scrollIntoViewIfNeeded();
  const box = await firstCard.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(500);
    await shot(page, "03-asset-hover.png");
  }
}

// 4. Click an asset to open full-size image preview
await page.mouse.move(0, 0);
await page.waitForTimeout(300);
const assetImg = page.locator("img[src*='/api/images/']").first();
if (await assetImg.count()) {
  await assetImg.click({ force: true }).catch(() => {});
  await page.waitForTimeout(800);
  await shot(page, "04-image-preview.png");
}

await browser.close();
console.log("Done.");
