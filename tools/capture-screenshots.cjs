const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(10000);
  page.on('console', (message) => console.log('BROWSER:', message.text()));
  const pageErrors = [];
  page.on('pageerror', (error) => { pageErrors.push(error.message); console.error('PAGE ERROR:', error.message); });

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

  // Testa os três fluxos de criação a partir de modelos editáveis.
  console.log('A validar modelos de arranque...');
  await page.locator('[data-template-module="writer"][data-template="report"]').click();
  await page.locator('#view-writer').waitFor({ state: 'visible' });
  if (!(await page.locator('#view-writer .page').innerText()).includes('Relatório de projeto')) {
    throw new Error('O modelo de relatório não foi aplicado.');
  }
  await page.evaluate(() => document.querySelector('.rail-btn[data-view="home"]').click());
  await page.locator('[data-template-module="sheets"][data-template="budget"]').click();
  await page.locator('#view-sheets').waitFor({ state: 'visible' });
  if (!(await page.locator('#view-sheets').innerText()).includes('Habitação')) {
    throw new Error('O modelo de orçamento não foi aplicado.');
  }
  await page.evaluate(() => document.querySelector('.rail-btn[data-view="home"]').click());
  await page.locator('[data-template-module="slides"][data-template="pitch"]').click();
  await page.locator('#view-slides').waitFor({ state: 'visible' });
  if (!(await page.locator('#view-slides').innerText()).includes('A nossa proposta')) {
    throw new Error('O modelo de apresentação não foi aplicado.');
  }

  await capture('writer', 'texto.png');
  await capture('sheets', 'folhas.png');

  // Testa a criação de um gráfico com dados reais introduzidos na grelha.
  const enterCell = async (row, col, value) => {
    await page.locator('#view-sheets td[data-r="' + row + '"][data-c="' + col + '"]').click();
    await page.keyboard.type(value);
    await page.keyboard.press('Enter');
  };
  await enterCell(0, 0, 'Mês');
  await enterCell(0, 1, 'Vendas');
  await enterCell(1, 0, 'Janeiro');
  await enterCell(1, 1, '120');
  await enterCell(2, 0, 'Fevereiro');
  await enterCell(2, 1, '150');
  await page.locator('#view-sheets td[data-r="0"][data-c="0"]').click();
  await page.locator('#view-sheets td[data-r="2"][data-c="1"]').click({ modifiers: ['Shift'] });
  await page.locator('#view-sheets .ribbon-tabs .ribbon-tab').filter({ hasText: 'Dados' }).click();
  await page.locator('#view-sheets button[aria-label*="Criar gráfico"]').click();
  await page.locator('.mo-chart-dialog').waitFor({ state: 'visible' });
  await page.locator('.mo-chart-preview svg').waitFor({ state: 'visible' });
  await page.locator('.mo-chart-close').click();
  if (!(await page.locator('#view-sheets button[aria-label*="Analisar os dados"]').count())) {
    throw new Error('O assistente IA de Folhas não está disponível na faixa.');
  }
  await capture('slides', 'diapositivos.png');
  if (pageErrors.length) throw new Error('Erros na interface: ' + pageErrors.join(' | '));

  // Captura o painel Assistente aberto a partir do separador da faixa de ferramentas.
  console.log('A abrir o painel Assistente...');
  await page.locator('.ribbon-tabs .ribbon-tab').filter({ hasText: 'Assistente' }).click();
  await page.locator('button.tool').filter({ hasText: 'Sugestões' }).click();
  await page.locator('.ai-panel:not([hidden])').waitFor({ state: 'visible' });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, 'assistente.png'), fullPage: false });
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
