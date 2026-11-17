const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
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
    await page.waitForTimeout(1500);
    await page.evaluate(() => { const t = document.getElementById('toast'); if (t) t.style.visibility = 'hidden'; });
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
  // Folhas com um gráfico do orçamento, criado como um utilizador o faria.
  await capture('sheets', 'folhas.png');
  await page.locator('#view-sheets td[data-r="0"][data-c="0"]').click();
  await page.locator('#view-sheets td[data-r="6"][data-c="2"]').click({ modifiers: ['Shift'] });
  await page.locator('#view-sheets .ribbon-tabs .ribbon-tab').filter({ hasText: 'Dados' }).click();
  await page.locator('#view-sheets button[aria-label*="Criar gráfico"]').click();
  await page.locator('.chart-dialog .chart-preview svg').waitFor({ state: 'visible' });
  await page.locator('.chart-dialog input[type=text]').fill('Orçamento e gasto real');
  await page.locator('.chart-dialog button[type=submit]').click();
  await page.locator('#view-sheets .sheet-chart svg').waitFor({ state: 'visible' });
  await page.waitForTimeout(600);
  await page.evaluate(() => { const t = document.getElementById('toast'); if (t) t.style.visibility = 'hidden'; });
  await page.screenshot({ path: path.join(out, 'folhas.png'), fullPage: false });
  await page.evaluate(() => { const t = document.getElementById('toast'); if (t) t.style.visibility = ''; });
  if (!(await page.locator('#view-sheets button').filter({ hasText: 'Analisar com IA' }).count())) {
    throw new Error('O assistente IA de Folhas não está disponível na faixa.');
  }
  await capture('slides', 'diapositivos.png');
  await capture('draw', 'desenho.png');
  // PDF de exemplo, com uma anotação e um realce.
  await page.evaluate(async () => {
    const { PDFDocument, StandardFonts, rgb } = PDFLib;
    const d = await PDFDocument.create();
    const bold = await d.embedFont(StandardFonts.HelveticaBold);
    const f = await d.embedFont(StandardFonts.Helvetica);
    for (let i = 1; i <= 3; i++) {
      const pg = d.addPage([595, 842]);
      pg.drawText('Proposta de prestação de serviços', { x: 60, y: 760, size: 22, font: bold, color: rgb(0.1, 0.16, 0.14) });
      pg.drawText(`Página ${i} de 3 · Referência 2026/041`, { x: 60, y: 735, size: 11, font: f, color: rgb(0.4, 0.45, 0.42) });
      ['1. Âmbito: apoio à transformação digital da equipa comercial.', '2. Prazo: 12 semanas a contar da data de adjudicação.', '3. Valor total: 18 400 € (IVA não incluído).', '4. Pagamento: 30% na adjudicação e 70% na entrega.'].forEach((t, k) => pg.drawText(t, { x: 60, y: 680 - k * 26, size: 12, font: f }));
      pg.drawText('Assinatura do cliente', { x: 60, y: 200, size: 11, font: f, color: rgb(0.4, 0.45, 0.42) });
      pg.drawLine({ start: { x: 60, y: 215 }, end: { x: 300, y: 215 }, thickness: 0.8 });
    }
    await MO.openFileObject({ path: null, name: 'Proposta.pdf', content: await d.save() });
    const st = MO.modules.pdf._debug.pages();
    st[0].annots = [
      { id: 'h1', type: 'highlight', fx: 0.09, fy: 0.231, fw: 0.47, fh: 0.024, color: '#ffe066' },
      { id: 't1', type: 'text', fx: 0.62, fy: 0.22, text: 'Confirmar valor', size: 12, color: '#c8463d' }
    ];
    MO.modules.pdf._debug.setPages(st);
  });
  await capture('pdf', 'pdf.png');
  // Bases de dados: o modelo de encomendas, com tabelas ligadas.
  await page.evaluate(() => MO.modules.db.newDoc('encomendas'));
  await capture('db', 'bases-de-dados.png');
  await capture('assistant', 'assistente-ia.png');
  if (!(await page.locator('#view-assistant textarea[aria-label="Mensagem para o Assistente"]').count())) {
    throw new Error('A aplicação Assistente IA não foi inicializada.');
  }
  if (!(await page.locator('#view-assistant .mo-assistant-shortcuts button').count())) {
    throw new Error('Os atalhos do Assistente IA não foram apresentados.');
  }
  if (pageErrors.length) throw new Error('Erros na interface: ' + pageErrors.join(' | '));

  await capture('sheets', 'comandos.png');
  await page.click('#palette-btn');
  await page.fill('.palette-input', 'borda');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, 'comandos.png'), fullPage: false });
  await page.keyboard.press('Escape');

  await capture('home', 'modo-escuro.png');
  await page.evaluate(() => {
    const button = document.querySelector('#mode-toggle');
    if (document.documentElement.dataset.mode !== 'dark') button.click();
  });
  await page.waitForTimeout(1500);
  await page.evaluate(() => { const t = document.getElementById('toast'); if (t) t.style.visibility = 'hidden'; });
  await page.screenshot({ path: path.join(out, 'modo-escuro.png'), fullPage: false });

  await browser.close();
  console.log('Capturas concluídas.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
