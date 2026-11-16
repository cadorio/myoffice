const { chromium } = require('playwright');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 1
  });
  page.on('pageerror', (error) => console.error('PAGE ERROR:', error.message));
  await page.goto(pathToFileURL(path.resolve('src/index.html')).href, { waitUntil: 'networkidle' });
  await page.waitForSelector('#view-home:not([hidden])');
  await page.waitForTimeout(700);
  const out = path.resolve('docs/screenshots');
  const fs = require('node:fs');
  fs.mkdirSync(out, { recursive: true });

  await page.screenshot({ path: path.join(out, 'inicio.png'), fullPage: true });
  await page.locator('[data-view="writer"]').first().click();
  await page.waitForSelector('#view-writer:not([hidden])');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, 'texto.png'), fullPage: true });

  await page.locator('[data-view="sheets"]').first().click();
  await page.waitForSelector('#view-sheets:not([hidden])');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, 'folhas.png'), fullPage: true });

  await page.locator('[data-view="slides"]').first().click();
  await page.waitForSelector('#view-slides:not([hidden])');
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(out, 'diapositivos.png'), fullPage: true });

  await page.locator('[data-view="home"]').first().click();
  await page.waitForSelector('#view-home:not([hidden])');
  await page.locator('#mode-toggle').click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(out, 'modo-escuro.png'), fullPage: true });

  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
