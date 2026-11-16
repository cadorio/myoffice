const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(10000);
  page.on('console', (message) => console.log('BROWSER:', message.text()));
  page.on('pageerror', (error) => console.error('PAGE ERROR:', error.message));

  console.log('A abrir o MyOffice...');
  await page.goto(pathToFileURL(path.resolve('src/index.html')).href, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(1200);
  const out = path.resolve('docs/screenshots');
  fs.mkdirSync(out, { recursive: true });

  async function capture(view, filename) {
    console.log('A capturar:', view);
    await page.evaluate((id) => {
      const button = document.querySelector('.rail-btn[data-view="' + id + '"]');
      if (!button) throw new Error('Navegação não encontrada: ' + id);
      button.click();
    }, view);
    await page.waitForTimeout(800);
    const visible = await page.locator('#view-' + view).evaluate((el) => !el.hidden);
    if (!visible) throw new Error('A vista não ficou visível: ' + view);
    await page.screenshot({ path: path.join(out, filename), fullPage: false });
  }

  await capture('home', 'inicio.png');
  await capture('writer', 'texto.png');
  await capture('sheets', 'folhas.png');
  await capture('slides', 'diapositivos.png');
  await capture('home', 'modo-escuro.png');
  await page.evaluate(() => {
    const button = document.querySelector('#mode-toggle');
    if (document.documentElement.dataset.mode !== 'dark') button.click();
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, 'modo-escuro.png'), fullPage: false });

  await browser.close();
  console.log('Capturas concluídas.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
