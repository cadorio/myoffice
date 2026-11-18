// Gera build/icons/<programa>.ico (16–256 px) a partir dos SVG em src/assets.
// Uso: node tools/make-icons.cjs  (precisa do Playwright)
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const APPS = {
  writer: ['icon-text.svg', '#4d68be'],
  sheets: ['icon-sheets.svg', '#17806a'],
  slides: ['icon-slides.svg', '#c86d4d'],
  draw: ['icon-draw.svg', '#567c5e'],
  notes: ['icon-notes.svg', '#a8659b'],
  projects: ['icon-projects.svg', '#2f8fa8'],
  pdf: ['icon-pdf.svg', '#b8443b'],
  db: ['icon-db.svg', '#6a4fa8'],
  assistant: ['icon-assistant.svg', '#183b34']
};
const SIZES = [16, 24, 32, 48, 64, 128, 256];

function ico(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(pngs.length, 4);
  let offset = head.length;
  pngs.forEach(([size, data], i) => {
    const o = 6 + 16 * i;
    head[o] = size >= 256 ? 0 : size;
    head[o + 1] = size >= 256 ? 0 : size;
    head.writeUInt16LE(1, o + 4);
    head.writeUInt16LE(32, o + 6);
    head.writeUInt32LE(data.length, o + 8);
    head.writeUInt32LE(offset, o + 12);
    offset += data.length;
  });
  return Buffer.concat([head, ...pngs.map((p) => p[1])]);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  fs.mkdirSync(path.join(ROOT, 'build', 'icons'), { recursive: true });
  for (const [id, [file, color]] of Object.entries(APPS)) {
    const svg = fs.readFileSync(path.join(ROOT, 'src', 'assets', file), 'utf8');
    const pngs = [];
    for (const size of SIZES) {
      await page.setViewportSize({ width: size, height: size });
      await page.setContent(`<html><body style="margin:0;background:transparent">
        <div style="width:${size}px;height:${size}px;border-radius:${size * 0.22}px;background:${color};display:grid;place-items:center;color:#fff">
        <div style="width:${size * 0.78}px;height:${size * 0.78}px">${svg.replace('<svg', '<svg width="100%" height="100%"')}</div></div></body></html>`);
      pngs.push([size, await page.screenshot({ omitBackground: true })]);
    }
    fs.writeFileSync(path.join(ROOT, 'build', 'icons', id + '.ico'), ico(pngs));
  }
  // Ícone principal (build/icon.ico) a partir de build/icon.png: o MSI e o executável usam-no.
  const png = fs.readFileSync(path.join(ROOT, 'build', 'icon.png')).toString('base64');
  const main = [];
  for (const size of SIZES) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;background:transparent"><img src="data:image/png;base64,${png}" style="width:${size}px;height:${size}px;display:block"></body></html>`);
    main.push([size, await page.screenshot({ omitBackground: true })]);
  }
  fs.writeFileSync(path.join(ROOT, 'build', 'icon.ico'), ico(main));
  await browser.close();
})();
