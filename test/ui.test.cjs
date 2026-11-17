'use strict';

// Testes da interface no browser: Desenho, livros com várias folhas e gráficos.
// Requer o Playwright com o Chromium: npm install --no-save playwright && npx playwright install chromium
// Executar: node test/ui.test.cjs

const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');

const APP = pathToFileURL(path.join(__dirname, '..', 'src', 'index.html')).href;
const results = [];

async function test(name, page, fn) {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (error) {
    results.push(['FALHOU', name, error]);
    await page.screenshot({ path: path.join(__dirname, `falha-${results.length}.png`) }).catch(() => {});
  }
}

const go = (page, view) => page.evaluate((v) => document.querySelector(`[data-view="${v}"]`).click(), view);
const cellText = (page, a) =>
  page.evaluate((a) => {
    // A grelha só desenha as linhas visíveis; as células identificam-se pela linha e coluna.
    const p = MO.Formula.parseAddr(a);
    const td = document.querySelector(`.grid td[data-r="${p.r}"][data-c="${p.c}"]`);
    return td ? td.textContent : null;
  }, a);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1366, height: 820 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(APP);

  // ---------------- Desenho ----------------
  await go(page, 'draw');

  await test('Desenho: modelos de fluxo, mapa mental e organograma', page, async () => {
    for (const [label, nodes, links] of [['Fluxo', 4, 3], ['Mapa mental', 5, 4], ['Organização', 4, 3]]) {
      await page.click(`.draw-template:has-text("${label}")`);
      const data = JSON.parse(await page.evaluate(() => MO.modules.draw.serialize()));
      assert.equal(data.nodes.length, nodes, label + ': elementos');
      assert.equal(data.links.length, links, label + ': ligações');
    }
  });

  await test('Desenho: acrescentar elementos e editar texto e cor', page, async () => {
    await page.click('.draw-template:has-text("Fluxo")');
    await page.click('.draw-action:has-text("Caixa")');
    await page.click('.draw-action:has-text("Decisão")');
    await page.fill('.draw-inspector textarea', 'Aprovado?');
    await page.evaluate(() => {
      const input = document.querySelector('.draw-inspector input[type=color]');
      input.value = '#ff8800';
      input.dispatchEvent(new Event('input'));
    });
    const data = JSON.parse(await page.evaluate(() => MO.modules.draw.serialize()));
    assert.equal(data.nodes.length, 6);
    const last = data.nodes[5];
    assert.equal(last.type, 'diamond');
    assert.equal(last.text, 'Aprovado?');
    assert.equal(last.fill, '#ff8800');
  });

  await test('Desenho: guardar e voltar a abrir mantém o diagrama', page, async () => {
    const before = JSON.parse(await page.evaluate(() => MO.modules.draw.serialize()));
    await page.evaluate(() => MO.modules.draw.newDoc('mind'));
    await page.evaluate((text) => MO.modules.draw.load(text), JSON.stringify(before));
    const after = JSON.parse(await page.evaluate(() => MO.modules.draw.serialize()));
    const strip = (d) => d.nodes.map(({ id, ...rest }) => rest);
    assert.deepEqual(strip(after), strip(before));
    assert.equal(after.links.length, before.links.length);
  });

  await test('Desenho: ficheiros adulterados são limpos ou recusados', page, async () => {
    const hostile = {
      format: 'myoffice-draw',
      version: 1,
      nodes: [
        { type: 'rect', x: 50, y: 50, w: 99999, h: -5, text: '<img src=x onerror=alert(1)>' + 'a'.repeat(500), fill: 'url(javascript:x)' },
        { type: 'script', x: 1, y: 1 },
        { type: 'ellipse', x: 'abc', y: 1 }
      ],
      links: []
    };
    await page.evaluate((text) => MO.modules.draw.load(text), JSON.stringify(hostile));
    const data = JSON.parse(await page.evaluate(() => MO.modules.draw.serialize()));
    assert.equal(data.nodes.length, 1, 'só o elemento válido fica');
    assert.ok(data.nodes[0].w <= 600 && data.nodes[0].h >= 40, 'tamanhos limitados');
    assert.equal(await page.locator('.draw-canvas img').count(), 0, 'texto não é interpretado como HTML');
    await assert.rejects(page.evaluate(() => MO.modules.draw.load('{"format":"outro"}')));
  });

  await test('Desenho: exportação SVG válida', page, async () => {
    await page.evaluate(() => MO.modules.draw.newDoc('org'));
    const svg = await page.evaluate(() => MO.modules.draw.exports[0].get());
    const ok = await page.evaluate((text) => !new DOMParser().parseFromString(text, 'image/svg+xml').querySelector('parsererror'), svg);
    assert.ok(ok, 'SVG bem formado');
    assert.match(svg, /Direção/);
    assert.doesNotMatch(svg, /<script/i);
  });

  // ---------------- Folhas: várias folhas ----------------
  await go(page, 'sheets');
  await page.evaluate(() => MO.modules.sheets.newDoc());

  await test('Folhas: acrescentar folhas e manter as células de cada uma', page, async () => {
    await page.click('.grid td[data-r="0"][data-c="0"]');
    await page.keyboard.type('Primeira');
    await page.keyboard.press('Enter');
    await page.click('.sheet-tab-add');
    assert.equal(await page.locator('.sheet-tab').count(), 2);
    assert.equal(await cellText(page, 'A1'), '', 'a nova folha começa vazia');
    await page.click('.grid td[data-r="0"][data-c="0"]');
    await page.keyboard.type('Segunda');
    await page.keyboard.press('Enter');
    await page.click('.sheet-tab >> nth=0');
    assert.equal(await cellText(page, 'A1'), 'Primeira');
    await page.click('.sheet-tab >> nth=1');
    assert.equal(await cellText(page, 'A1'), 'Segunda');
  });

  await test('Folhas: guardar e abrir preserva folhas e folha ativa', page, async () => {
    const saved = await page.evaluate(() => MO.modules.sheets.serialize());
    const data = JSON.parse(saved);
    assert.equal(data.sheets.length, 2);
    assert.equal(data.activeSheet, 1);
    await page.evaluate(() => MO.modules.sheets.newDoc());
    await page.evaluate((text) => MO.modules.sheets.load(text, 'mosheet'), saved);
    assert.equal(await page.locator('.sheet-tab').count(), 2);
    assert.equal(await cellText(page, 'A1'), 'Segunda');
  });

  await test('Folhas: nomes de folhas são limpos e não se repetem', page, async () => {
    const book = { format: 'myoffice-sheet', version: 3, sheets: [{ name: 'Vendas', cells: {} }, { name: 'vendas', cells: {} }, { name: 'A/B*C?[x]', cells: {} }, { name: 'x'.repeat(80), cells: {} }] };
    await page.evaluate((text) => MO.modules.sheets.load(text, 'mosheet'), JSON.stringify(book));
    const names = JSON.parse(await page.evaluate(() => MO.modules.sheets.serialize())).sheets.map((s) => s.name);
    assert.equal(names[0], 'Vendas');
    assert.notEqual(names[1].toLowerCase(), 'vendas', 'nome repetido recebe sufixo');
    assert.equal(names[2], 'ABCx', 'carateres proibidos no Excel são removidos');
    assert.ok(names[3].length <= 31, 'máximo de 31 carateres, como no Excel');
  });

  await test('Folhas: livro com várias folhas sobrevive a exportar e importar .xlsx', page, async () => {
    const book = {
      format: 'myoffice-sheet',
      version: 3,
      sheets: [
        { name: 'Receitas', cells: { A1: { v: 'Mês' }, B1: { v: 'Valor' }, A2: { v: 'Jan' }, B2: { v: '120' }, B3: { v: '=SOMA(B2:B2)' } } },
        { name: 'Custos', cells: { A1: { v: 'Renda' }, B1: { v: '500' } } }
      ]
    };
    await page.evaluate((text) => MO.modules.sheets.load(text, 'mosheet'), JSON.stringify(book));
    const exp = await page.evaluate(() => MO.modules.sheets.exports.find((e) => e.ext === 'xlsx'));
    assert.ok(exp, 'existe exportação .xlsx');
    const back = await page.evaluate(() => {
      const bytes = MO.modules.sheets.exports.find((e) => e.ext === 'xlsx').get();
      return MO.OOXML.importXlsx(bytes, 100, 26);
    });
    assert.deepEqual(back.sheets.map((s) => s.name), ['Receitas', 'Custos']);
    assert.equal(back.sheets[0].cells.B2.v, '120');
    assert.equal(back.sheets[0].cells.B3.v, '=SUM(B2:B2)');
    assert.equal(back.sheets[1].cells.A1.v, 'Renda');
  });

  // ---------------- Folhas: gráficos ----------------
  await test('Gráficos: criar a partir da seleção e guardar no livro', page, async () => {
    const book = { format: 'myoffice-sheet', version: 3, sheets: [{ name: 'Vendas', cells: { A1: { v: 'Mês' }, B1: { v: 'Vendas' }, A2: { v: 'Jan' }, B2: { v: '10' }, A3: { v: 'Fev' }, B3: { v: '25' }, A4: { v: 'Mar' }, B4: { v: '18' } } }] };
    await page.evaluate((text) => MO.modules.sheets.load(text, 'mosheet'), JSON.stringify(book));
    await page.click('.grid td[data-r="0"][data-c="0"]');
    for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowRight');
    await page.click('#view-sheets .ribbon-tab:has-text("Dados")');
    await page.click('button[title="Criar gráfico a partir da seleção"]');
    await page.waitForSelector('.mo-chart-dialog .mo-chart-preview svg');
    assert.match(await page.textContent('.mo-chart-range'), /3 valores/);
    await page.click('.mo-chart-dialog button:has-text("Guardar no livro")');
    await page.click('.mo-chart-dialog button:has-text("Concluir")');
    const charts = JSON.parse(await page.evaluate(() => MO.modules.sheets.serialize())).sheets[0].charts;
    assert.equal(charts.length, 1);
    assert.deepEqual(charts[0].range, { r0: 0, r1: 3, c0: 0, c1: 1 });
  });

  await test('Gráficos: ficam no ficheiro e intervalos inválidos são descartados', page, async () => {
    const data = JSON.parse(await page.evaluate(() => MO.modules.sheets.serialize()));
    data.sheets[0].charts.push(
      { name: 'Mau tipo', type: 'pie3d', range: { r0: 0, r1: 3, c0: 0, c1: 1 } },
      { name: 'Fora da grelha', type: 'bar', range: { r0: 0, r1: 200000, c0: 0, c1: 1 } },
      { name: 'Invertido', type: 'line', range: { r0: 3, r1: 0, c0: 0, c1: 1 } }
    );
    await page.evaluate((text) => MO.modules.sheets.load(text, 'mosheet'), JSON.stringify(data));
    const charts = JSON.parse(await page.evaluate(() => MO.modules.sheets.serialize())).sheets[0].charts;
    assert.equal(charts.length, 1, 'só o gráfico válido fica');
  });

  // ---------------- Folhas: funções essenciais ----------------
  const loadBook = (book) => page.evaluate((text) => MO.modules.sheets.load(text, 'mosheet'), JSON.stringify(book));
  const sheetData = async () => JSON.parse(await page.evaluate(() => MO.modules.sheets.serialize())).sheets[0];
  const selectRange = async (from, to) => {
    await page.click(`.grid td[data-r="${from[0]}"][data-c="${from[1]}"]`);
    await page.click(`.grid td[data-r="${to[0]}"][data-c="${to[1]}"]`, { modifiers: ['Shift'] });
  };
  const sheetsTab = (name) => page.click(`#view-sheets .ribbon-tab:has-text("${name}")`);

  await test('Folhas: preenchimento automático continua séries', page, async () => {
    await loadBook({ format: 'myoffice-sheet', version: 3, sheets: [{ name: 'S', cells: { A1: { v: '1' }, A2: { v: '2' }, B1: { v: 'Item 1' }, C1: { v: 'janeiro' }, D1: { v: '=A1*10' }, E1: { v: 'texto' } } }] });
    await selectRange([0, 0], [1, 0]);
    let box = await page.locator('.fill-handle').boundingBox();
    let target = await page.locator('.grid td[data-r="4"][data-c="0"]').boundingBox();
    await page.mouse.move(box.x + 4, box.y + 4);
    await page.mouse.down();
    await page.mouse.move(target.x + 10, target.y + 10, { steps: 5 });
    await page.mouse.up();
    assert.deepEqual([await cellText(page, 'A3'), await cellText(page, 'A4'), await cellText(page, 'A5')], ['3', '4', '5']);
    await selectRange([0, 1], [0, 4]);
    box = await page.locator('.fill-handle').boundingBox();
    target = await page.locator('.grid td[data-r="2"][data-c="4"]').boundingBox();
    await page.mouse.move(box.x + 4, box.y + 4);
    await page.mouse.down();
    await page.mouse.move(target.x + 10, target.y + 10, { steps: 5 });
    await page.mouse.up();
    assert.equal(await cellText(page, 'B3'), 'Item 3');
    assert.equal(await cellText(page, 'C2'), 'fevereiro');
    const d = await sheetData();
    assert.equal(d.cells.D2.v, '=A2*10', 'fórmula com referência ajustada');
    assert.equal(d.cells.E3.v, 'texto', 'texto simples repete-se');
  });

  await test('Folhas: bordas, células unidas e anular', page, async () => {
    await loadBook({ format: 'myoffice-sheet', version: 3, sheets: [{ name: 'S', cells: { A1: { v: 'Título' }, B1: { v: 'apagado ao unir' } } }] });
    await selectRange([0, 0], [1, 1]);
    await sheetsTab('Base');
    await page.click('button[title="Todas as bordas"]');
    let d = await sheetData();
    assert.equal(d.cells.A1.s.bd, 'tblr');
    assert.equal(d.cells.B2.s.bd, 'tblr');
    await selectRange([0, 0], [0, 2]);
    await page.click('button[title="Unir e centrar células"]');
    d = await sheetData();
    assert.deepEqual(d.merges, [{ r0: 0, r1: 0, c0: 0, c1: 2 }]);
    assert.equal(d.cells.B1.v, '', 'só fica o valor da primeira célula');
    assert.equal(await page.getAttribute('.grid td[data-r="0"][data-c="0"]', 'colspan'), '3');
    await page.keyboard.press('Control+Z');
    d = await sheetData();
    assert.deepEqual(d.merges, []);
    assert.equal(d.cells.B1.v, 'apagado ao unir');
  });

  await test('Folhas: fixar painéis mantém a linha de títulos à vista', page, async () => {
    const cells = { A1: { v: 'Cabeçalho' } };
    for (let r = 2; r <= 300; r++) cells['A' + r] = { v: String(r) };
    await loadBook({ format: 'myoffice-sheet', version: 3, sheets: [{ name: 'S', cells }] });
    await page.click('.grid td[data-r="0"][data-c="0"]');
    await sheetsTab('Esquema de página');
    await page.click('button[title="Manter a primeira linha visível ao deslocar"]');
    await page.evaluate(() => { document.querySelector('.sheet-wrap').scrollTop = 3000; });
    await page.waitForTimeout(150);
    const header = page.locator('.grid td[data-r="0"][data-c="0"]');
    assert.equal(await header.textContent(), 'Cabeçalho');
    const wrapBox = await page.locator('.sheet-wrap').boundingBox();
    const headBox = await header.boundingBox();
    assert.ok(headBox.y >= wrapBox.y && headBox.y < wrapBox.y + 80, 'linha fixa continua no topo');
    assert.deepEqual((await sheetData()).freeze, { rows: 1, cols: 0 });
    await page.click('button[title="Deixar de fixar linhas e colunas"]');
    assert.equal((await sheetData()).freeze, null);
    await page.evaluate(() => { document.querySelector('.sheet-wrap').scrollTop = 0; });
    await page.waitForTimeout(100);
  });

  await test('Folhas: largura das colunas ajusta-se arrastando o cabeçalho', page, async () => {
    await loadBook({ format: 'myoffice-sheet', version: 3, sheets: [{ name: 'S', cells: {} }] });
    const th = await page.locator('.grid th.col-head[data-c="1"]').boundingBox();
    await page.mouse.move(th.x + th.width - 2, th.y + th.height / 2);
    await page.mouse.down();
    await page.mouse.move(th.x + th.width + 80, th.y + th.height / 2, { steps: 4 });
    await page.mouse.up();
    const w = (await sheetData()).widths['1'];
    assert.ok(w >= 170 && w <= 200, 'largura nova: ' + w);
  });

  await test('Folhas: formatação condicional realça os valores', page, async () => {
    await loadBook({ format: 'myoffice-sheet', version: 3, sheets: [{ name: 'S', cells: { A1: { v: '50' }, A2: { v: '150' }, A3: { v: '300' } } }] });
    await selectRange([0, 0], [2, 0]);
    await sheetsTab('Base');
    await page.click('button[title^="Formatação condicional"]');
    await page.selectOption('#cf-type', 'gt');
    await page.fill('#cf-a', '100');
    await page.click('.mo-dialog button[type=submit]');
    const bg = (a) => page.evaluate((r) => document.querySelector(`.grid td[data-r="${r}"][data-c="0"]`).style.backgroundColor, a);
    assert.equal(await bg(0), '');
    assert.equal(await bg(1), 'rgb(198, 239, 206)');
    await page.click('.grid td[data-r="0"][data-c="0"]');
    await page.keyboard.type('500');
    await page.keyboard.press('Enter');
    assert.equal(await bg(0), 'rgb(198, 239, 206)', 'a regra acompanha os valores');
  });

  await test('Folhas: bordas, unir, larguras e painéis sobrevivem ao .xlsx', page, async () => {
    await loadBook({ format: 'myoffice-sheet', version: 3, sheets: [{ name: 'S', cells: { A1: { v: 'X', s: { bd: 'tb' } } }, merges: [{ r0: 0, r1: 1, c0: 0, c1: 1 }], widths: { 2: 180 }, freeze: { rows: 1, cols: 1 } }] });
    const back = await page.evaluate(() => MO.OOXML.importXlsx(MO.modules.sheets.exports.find((e) => e.ext === 'xlsx').get(), 100000, 256).sheets[0]);
    assert.equal(back.cells.A1.s.bd, 'tb');
    assert.deepEqual(back.merges, [{ r0: 0, r1: 1, c0: 0, c1: 1 }]);
    assert.ok(Math.abs(back.widths['2'] - 180) <= 2, 'largura ' + back.widths['2']);
    assert.deepEqual(back.freeze, { rows: 1, cols: 1 });
  });

  await test('Sem erros na consola da página', page, async () => {
    assert.deepEqual(errors, []);
  });

  await browser.close();
  for (const [status, name, error] of results) console.log(`${status === 'ok' ? '✓' : '✗'} ${name}${error ? '\n    ' + String(error.message).split('\n').join('\n    ') : ''}`);
  const failed = results.filter((r) => r[0] !== 'ok').length;
  console.log(`\n${results.length - failed} de ${results.length} testes da interface passaram.`);
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
