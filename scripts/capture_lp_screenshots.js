#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");

// Run with:
//   npx -y -p playwright-core node scripts/capture_lp_screenshots.js
//
// Optional:
//   LP_URL="http://localhost:5173" npx -y -p playwright-core node scripts/capture_lp_screenshots.js

async function main() {
  const { createRequire } = require("module");
  const lpPackageJson = path.resolve(__dirname, "..", "lp", "package.json");
  const localRequire = createRequire(lpPackageJson);
  const { chromium } = localRequire("playwright-core");

  const outDir = path.resolve(__dirname, "..", "output", "playwright");
  fs.mkdirSync(outDir, { recursive: true });

  const defaultUrl = `file://${path.resolve(__dirname, "..", "lp", "index.html")}`;
  const url = process.env.LP_URL || defaultUrl;

  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
  });

  const targets = [
    {
      name: "desktop",
      contextOptions: {
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
      },
    },
    {
      name: "mobile",
      contextOptions: {
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
  ];

  for (const target of targets) {
    const context = await browser.newContext(target.contextOptions);
    const page = await context.newPage();

    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
    } catch {
      // "networkidle" can be flaky depending on environment/font loading. Fallback.
      await page.goto(url, { waitUntil: "load", timeout: 60_000 });
    }

    // Small settle time for animations/font rendering.
    await page.waitForTimeout(800);

    // Full-page screenshots can miss "reveal on scroll" content. Force visibility.
    await page.evaluate(() => {
      document.querySelectorAll("[data-reveal]").forEach((el) => el.classList.add("is-visible"));
    });
    await page.waitForTimeout(200);

    const outPath = path.join(outDir, `lp_${target.name}.png`);
    await page.screenshot({ path: outPath, fullPage: true });
    await context.close();
  }

  await browser.close();
  console.log(`Saved screenshots to: ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
