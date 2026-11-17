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

  await test('Desenho: modelos de fluxo, mapa mental, organograma, linha temporal e SWOT', page, async () => {
    for (const [label, nodes, links] of [['Fluxo', 6, 6], ['Mapa mental', 5, 4], ['Organização', 4, 3], ['Linha temporal', 10, 4], ['SWOT', 4, 0]]) {
      await page.click(`#view-draw .draw-template:has-text("${label}")`);
      const data = JSON.parse(await page.evaluate(() => MO.modules.draw.serialize()));
      assert.equal(data.nodes.length, nodes, label + ': elementos');
      assert.equal(data.links.length, links, label + ': ligações');
    }
  });

  await test('Desenho: acrescentar formas, mudar aspeto, anular e ligar arrastando', page, async () => {
    await page.click('#view-draw .draw-template:has-text("Em branco")');
    await page.click('#view-draw .tool[title="Acrescentar: Caixa"]');
    await page.click('#view-draw .tool[title="Acrescentar: Decisão"]');
    await page.click('#view-draw .tool[title="Acrescentar: Base de dados"]');
    let data = JSON.parse(await page.evaluate(() => MO.modules.draw.serialize()));
    assert.deepEqual(data.nodes.map((n) => n.type), ['rect', 'diamond', 'cylinder']);
    // Formatar o último (selecionado): cor de fundo e tamanho do texto
    await page.click('#view-draw .ribbon-tab:has-text("Formatar")');
    await page.click('#view-draw .draw-swatch[title="Cor de fundo #c5ef75"]');
    await page.selectOption('#view-draw select[data-prop="fontSize"]', '24');
    data = JSON.parse(await page.evaluate(() => MO.modules.draw.serialize()));
    assert.equal(data.nodes[2].fill, '#c5ef75');
    assert.equal(data.nodes[2].fontSize, 24);
    await page.keyboard.press('Control+z');
    data = JSON.parse(await page.evaluate(() => MO.modules.draw.serialize()));
    assert.equal(data.nodes[2].fontSize, 18, 'anular desfaz o tamanho');
    // Afastar as formas (as novas aparecem quase no mesmo sítio)
    await page.evaluate(() => {
      MO.modules.draw._debug.nodes().forEach((n, i) => { n.x = 100 + i * 320; n.y = 200; });
      MO.modules.draw._debug.select([]);
    });
    // Escrever na forma com duplo clique
    const first = await page.evaluate(() => {
      const [a] = MO.modules.draw._debug.nodes();
      const svg = document.querySelector('#view-draw svg').getBoundingClientRect();
      const k = svg.width / 1400;
      return { x: svg.left + (a.x + a.w / 2) * k, y: svg.top + (a.y + a.h / 2) * k };
    });
    await page.mouse.dblclick(first.x, first.y);
    await page.fill('.draw-text-editor', 'Pedido recebido');
    await page.click('#view-draw .draw-canvas', { position: { x: 5, y: 5 } });
    // Ligar arrastando a partir de um ponto
    const ports = await page.evaluate(() => {
      const [a, b] = MO.modules.draw._debug.nodes();
      const svg = document.querySelector('#view-draw svg').getBoundingClientRect();
      const k = svg.width / 1400;
      return { from: { x: svg.left + (a.x + a.w) * k, y: svg.top + (a.y + a.h / 2) * k }, to: { x: svg.left + (b.x + b.w / 2) * k, y: svg.top + (b.y + b.h / 2) * k } };
    });
    await page.mouse.move(ports.from.x - 30, ports.from.y);
    await page.mouse.move(ports.from.x, ports.from.y);
    await page.mouse.down();
    await page.mouse.move(ports.to.x, ports.to.y, { steps: 6 });
    await page.mouse.up();
    data = JSON.parse(await page.evaluate(() => MO.modules.draw.serialize()));
    assert.equal(data.nodes[0].text, 'Pedido recebido');
    assert.equal(data.links.length, 1);
    assert.deepEqual([data.links[0].from, data.links[0].to], [0, 1]);
  });

  await test('Desenho: alinhar, duplicar e eliminar várias formas', page, async () => {
    await page.evaluate(() => MO.modules.draw._debug.select(MO.modules.draw._debug.nodes().map((n) => n.id)));
    await page.click('#view-draw .ribbon-tab:has-text("Organizar")');
    await page.click('#view-draw .tool[title="Alinhar em cima"]');
    let data = JSON.parse(await page.evaluate(() => MO.modules.draw.serialize()));
    assert.equal(new Set(data.nodes.map((n) => n.y)).size, 1, 'todos à mesma altura');
    await page.keyboard.press('Control+d');
    data = JSON.parse(await page.evaluate(() => MO.modules.draw.serialize()));
    assert.equal(data.nodes.length, 6);
    assert.equal(data.links.length, 2, 'a ligação também é duplicada');
    await page.keyboard.press('Delete');
    data = JSON.parse(await page.evaluate(() => MO.modules.draw.serialize()));
    assert.equal(data.nodes.length, 3);
    assert.equal(data.links.length, 1);
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
      links: [{ from: 0, to: 2 }, { from: 0, to: 0 }]
    };
    await page.evaluate((text) => MO.modules.draw.load(text), JSON.stringify(hostile));
    const data = JSON.parse(await page.evaluate(() => MO.modules.draw.serialize()));
    assert.equal(data.nodes.length, 1, 'só o elemento válido fica');
    assert.ok(data.nodes[0].w <= 900 && data.nodes[0].h >= 30, 'tamanhos limitados');
    assert.equal(data.nodes[0].fill, '#e8efe5', 'cor inválida substituída');
    assert.equal(data.links.length, 0, 'ligações para elementos inválidos descartadas');
    assert.equal(await page.locator('.draw-canvas img').count(), 0, 'texto não é interpretado como HTML');
    await assert.rejects(page.evaluate(() => MO.modules.draw.load('{"format":"outro"}')));
  });

  await test('Desenho: exportação SVG válida', page, async () => {
    await page.evaluate(() => MO.modules.draw.newDoc('org'));
    const svg = await page.evaluate(() => MO.modules.draw.exports[0].get());
    const png = await page.evaluate(async () => Array.from((await MO.modules.draw.exports[1].get()).slice(0, 4)));
    assert.deepEqual(png, [137, 80, 78, 71], 'PNG válido');
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
  await test('Gráficos: inserir na folha com várias séries, editar, mover e anular', page, async () => {
    const book = { format: 'myoffice-sheet', version: 3, sheets: [{ name: 'Vendas', cells: { A1: { v: 'Mês' }, B1: { v: 'Lisboa' }, C1: { v: 'Porto' }, A2: { v: 'Jan' }, B2: { v: '10' }, C2: { v: '7' }, A3: { v: 'Fev' }, B3: { v: '25' }, C3: { v: '12' }, A4: { v: 'Mar' }, B4: { v: '18' }, C4: { v: '20' } } }] };
    await page.evaluate((text) => MO.modules.sheets.load(text, 'mosheet'), JSON.stringify(book));
    await page.click('.grid td[data-r="0"][data-c="0"]');
    await page.click('.grid td[data-r="3"][data-c="2"]', { modifiers: ['Shift'] });
    await page.click('#view-sheets .ribbon-tab:has-text("Dados")');
    await page.click('button[title="Criar gráfico a partir da seleção"]');
    await page.waitForSelector('.chart-dialog .chart-preview svg');
    assert.equal(await page.locator('.chart-dialog .chart-type').count(), 8, '8 tipos de gráfico');
    await page.click('.chart-dialog .chart-type[data-type="line"]');
    await page.fill('.chart-dialog input[type=text]', 'Vendas por loja');
    await page.click('.chart-dialog button[type=submit]');
    await page.waitForSelector('.sheet-chart svg');
    assert.match(await page.textContent('.sheet-chart svg'), /Vendas por loja[\s\S]*Lisboa[\s\S]*Porto/);
    let charts = JSON.parse(await page.evaluate(() => MO.modules.sheets.serialize())).sheets[0].charts;
    assert.equal(charts.length, 1);
    assert.equal(charts[0].type, 'line');
    assert.deepEqual(charts[0].range, { r0: 0, r1: 3, c0: 0, c1: 2 });
    // Mover arrastando
    const before = charts[0];
    const box = await page.locator('.sheet-chart').boundingBox();
    await page.mouse.move(box.x + 100, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(box.x + 160, box.y + 150, { steps: 4 });
    await page.mouse.up();
    charts = JSON.parse(await page.evaluate(() => MO.modules.sheets.serialize())).sheets[0].charts;
    assert.equal(charts[0].x, before.x + 60, 'moveu 60 px para a direita');
    assert.equal(charts[0].y, before.y + 50, 'moveu 50 px para baixo');
    // Os dados mudam e o gráfico acompanha
    await page.click('.grid td[data-r="1"][data-c="1"]');
    await page.keyboard.type('99');
    await page.keyboard.press('Enter');
    assert.match(await page.locator('.sheet-chart svg').innerHTML(), /99/);
    // Editar: mudar para circular
    await page.click('.sheet-chart button[title="Editar o gráfico"]');
    await page.click('.chart-dialog .chart-type[data-type="pie"]');
    await page.click('.chart-dialog button[type=submit]');
    charts = JSON.parse(await page.evaluate(() => MO.modules.sheets.serialize())).sheets[0].charts;
    assert.equal(charts[0].type, 'pie');
    // Eliminar e anular
    await page.click('.sheet-chart button[title="Eliminar o gráfico"]');
    assert.equal(await page.locator('.sheet-chart').count(), 0);
    await page.keyboard.press('Control+z');
    assert.equal(await page.locator('.sheet-chart').count(), 1, 'anular repõe o gráfico');
  });

  await test('Gráficos: os 8 tipos vão para o Excel e voltam', page, async () => {
    const types = await page.evaluate(() => {
      const F = MO.Formula;
      const cells = { A1: { v: 'Mês' }, B1: { v: 'Lisboa' }, C1: { v: 'Porto' }, A2: { v: 'Jan' }, B2: { v: '120' }, C2: { v: '90' }, A3: { v: 'Fev' }, B3: { v: '150' }, C3: { v: '110' } };
      const charts = ['column', 'stacked', 'bar', 'line', 'area', 'pie', 'doughnut', 'scatter'].map((type, i) => ({ name: 'G' + i, type, title: 'T' + i, range: { r0: 0, r1: 2, c0: 0, c1: 2 }, x: 400, y: 26 + i * 340, w: 520, h: 320 }));
      const bytes = MO.OOXML.exportXlsx([{ name: 'Folha1', cells, charts, values: F.compute(cells, 100, 26) }]);
      return MO.OOXML.importXlsx(bytes, 1000, 26).sheets[0].charts.map((c) => c.type + ':' + c.title);
    });
    assert.deepEqual(types, ['column:T0', 'stacked:T1', 'bar:T2', 'line:T3', 'area:T4', 'pie:T5', 'doughnut:T6', 'scatter:T7']);
  });

  await test('Gráficos: ficam no ficheiro e intervalos inválidos são descartados', page, async () => {
    const data = JSON.parse(await page.evaluate(() => MO.modules.sheets.serialize()));
    data.sheets[0].charts.push(
      { name: 'Mau tipo', type: 'pie3d', range: { r0: 0, r1: 3, c0: 0, c1: 1 } },
      { name: 'Posição absurda', type: 'column', range: { r0: 0, r1: 3, c0: 0, c1: 1 }, x: -500, y: 1e12, w: 99999, h: 1, title: 'x'.repeat(500) },
      { name: 'Fora da grelha', type: 'bar', range: { r0: 0, r1: 200000, c0: 0, c1: 1 } },
      { name: 'Invertido', type: 'line', range: { r0: 3, r1: 0, c0: 0, c1: 1 } }
    );
    await page.evaluate((text) => MO.modules.sheets.load(text, 'mosheet'), JSON.stringify(data));
    const charts = JSON.parse(await page.evaluate(() => MO.modules.sheets.serialize())).sheets[0].charts;
    assert.equal(charts.length, 2, 'só os gráficos válidos ficam');
    assert.ok(charts[1].x >= 46 && charts[1].w <= 1600 && charts[1].h >= 180 && charts[1].title.length <= 120, 'posição e tamanho limitados');
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

  // ---------------- Texto ----------------
  const writerTab = (name) => page.click(`#view-writer .ribbon-tab:has-text("${name}")`);
  const loadDoc = (html, extra = {}) => page.evaluate((d) => MO.modules.writer.load(JSON.stringify({ format: 'myoffice-doc', version: 3, ...d }), 'modoc'), { html, ...extra });
  const selectText = (selector, text) => page.evaluate(({ selector, text }) => {
    const el = document.querySelector(selector);
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = n.nodeValue.indexOf(text);
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(n, i); r.setEnd(n, i + text.length);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
      return true;
    }
    return false;
  }, { selector, text });

  await go(page, 'writer');

  await test('Texto: comentários ficam no documento e podem ser resolvidos', page, async () => {
    await loadDoc('<p>O orçamento aumentou bastante este ano.</p>');
    await page.click('.page');
    await selectText('.page', 'aumentou bastante');
    await writerTab('Rever');
    await page.click('button[title="Comentar o texto selecionado"]');
    await page.fill('.mo-dialog input', 'Confirmar o valor exato');
    await page.click('.mo-dialog button[type=submit]');
    assert.equal(await page.textContent('.page mark.mo-comment'), 'aumentou bastante');
    assert.match(await page.textContent('.comments-box'), /Confirmar o valor exato/);
    const saved = JSON.parse(await page.evaluate(() => MO.modules.writer.serialize()));
    assert.equal(Object.values(saved.comments)[0].text, 'Confirmar o valor exato');
    await page.click('.comment-card button:has-text("Resolver")');
    assert.equal(await page.locator('.page mark.mo-comment').count(), 0);
    assert.equal(await page.textContent('.page'), 'O orçamento aumentou bastante este ano.');
  });

  await test('Texto: controlar alterações marca inserções e eliminações', page, async () => {
    await loadDoc('<p>Reunião na segunda-feira.</p>');
    await writerTab('Rever');
    await page.click('button[title="Ligar ou desligar o controlo de alterações"]');
    await page.click('.page');
    await selectText('.page', 'segunda');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('terça');
    assert.equal(await page.textContent('.page del.mo-del'), 'segunda');
    assert.equal(await page.textContent('.page ins.mo-ins'), 'terça');
    await page.click('button[title="Aceitar todas as alterações controladas"]');
    assert.equal(await page.textContent('.page'), 'Reunião na terça-feira.');
    await page.click('button[title="Ligar ou desligar o controlo de alterações"]');
    assert.equal(await page.evaluate(() => MO.modules.writer.review.tracking), false);
  });

  await test('Texto: rejeitar alterações repõe o original', page, async () => {
    await loadDoc('<p>Prazo: março.</p>');
    await page.click('button[title="Ligar ou desligar o controlo de alterações"]');
    await page.click('.page');
    await selectText('.page', 'março');
    await page.keyboard.type('abril');
    await page.click('button[title="Rejeitar todas as alterações controladas"]');
    assert.equal(await page.textContent('.page'), 'Prazo: março.');
    await page.click('button[title="Ligar ou desligar o controlo de alterações"]');
  });

  await test('Texto: notas de rodapé numeradas e índice a partir dos títulos', page, async () => {
    await loadDoc('<h1>Relatório</h1><p>Dados oficiais.</p><h2>Vendas</h2><p>Subiram.</p><h2>Custos</h2>');
    await page.click('.page');
    await selectText('.page', 'oficiais');
    await page.keyboard.press('ArrowRight');
    await writerTab('Inserir');
    await page.click('button[title="Inserir nota de rodapé no cursor"]');
    await page.fill('.mo-dialog input', 'Fonte: INE, 2025.');
    await page.click('.mo-dialog button[type=submit]');
    assert.equal(await page.textContent('.page sup.mo-fn'), '1');
    assert.match(await page.textContent('.page-notes'), /Fonte: INE, 2025\./);
    await page.evaluate(() => { const p = document.querySelector('.page h1'); const r = document.createRange(); r.setStartBefore(p); r.collapse(true); getSelection().removeAllRanges(); getSelection().addRange(r); });
    await page.click('button[title="Inserir ou atualizar o índice a partir dos títulos"]');
    const toc = await page.locator('.page .mo-toc p').allTextContents();
    assert.deepEqual(toc, ['Índice', 'Relatório', 'Vendas', 'Custos']);
  });

  await test('Texto: configurar página muda o tamanho no ecrã e fica guardado', page, async () => {
    await writerTab('Estrutura');
    await page.click('button[title="Tamanho do papel, orientação e margens"]');
    await page.selectOption('#page-orient', 'landscape');
    await page.selectOption('#page-margin', 'narrow');
    await page.click('.mo-dialog button[type=submit]');
    const w = await page.evaluate(() => document.querySelector('.page').style.width);
    assert.equal(w, '297mm');
    const saved = JSON.parse(await page.evaluate(() => MO.modules.writer.serialize()));
    assert.deepEqual(saved.page, { size: 'A4', orient: 'landscape', margin: 'narrow', columns: 1 });
  });

  await test('Texto: Word exportado inclui comentários, alterações, notas e página', page, async () => {
    await loadDoc('<p>A <mark class="mo-comment" data-id="c1">meta</mark> é <del class="mo-del">10%</del><ins class="mo-ins">12%</ins><sup class="mo-fn" data-id="n1">1</sup>.</p>', { comments: { c1: { text: 'Rever meta', date: '2026-11-17T10:00:00Z' } }, notes: { n1: 'Plano 2027' }, page: { size: 'A4', orient: 'landscape', margin: 'normal' } });
    const parts = await page.evaluate(() => {
      const bytes = MO.modules.writer.exports.find((e) => e.ext === 'docx').get();
      const files = fflate.unzipSync(bytes);
      const text = (name) => (files[name] ? new TextDecoder().decode(files[name]) : '');
      const ok = (name) => !new DOMParser().parseFromString(text(name), 'application/xml').querySelector('parsererror');
      return { doc: text('word/document.xml'), comments: text('word/comments.xml'), notes: text('word/footnotes.xml'), valid: ['word/document.xml', 'word/comments.xml', 'word/footnotes.xml', '[Content_Types].xml', 'word/_rels/document.xml.rels'].every(ok) };
    });
    assert.ok(parts.valid, 'XML bem formado');
    assert.match(parts.doc, /<w:commentRangeStart w:id="0"\/>/);
    assert.match(parts.doc, /<w:del [^>]*>.*<w:delText[^>]*>10%<\/w:delText>/);
    assert.match(parts.doc, /<w:ins [^>]*>.*12%/);
    assert.match(parts.doc, /<w:footnoteReference w:id="1"\/>/);
    assert.match(parts.doc, /w:orient="landscape"/);
    assert.match(parts.comments, /Rever meta/);
    assert.match(parts.notes, /Plano 2027/);
  });

  // ---------------- Diapositivos ----------------
  const slidesTab = (name) => page.click(`#view-slides .ribbon-tab:has-text("${name}")`);
  const deck = async () => JSON.parse(await page.evaluate(() => MO.modules.slides.serialize())).slides;
  const loadDeck = (slides) => page.evaluate((d) => MO.modules.slides.load(JSON.stringify({ format: 'myoffice-slides', version: 1, slides: d }), 'moslides'), slides);
  const box = (x, y, w, hh, extra = {}) => ({ type: 'rect', x, y, w, h: hh, fill: '#4f5bd5', ...extra });

  await go(page, 'slides');

  await test('Diapositivos: tabela com edição de células e linhas/colunas', page, async () => {
    await loadDeck([{ bg: '#ffffff', els: [] }]);
    await slidesTab('Inserir');
    await page.click('button[title="Inserir tabela no diapositivo"]');
    await page.fill('.mo-dialog input >> nth=0', '3');
    await page.fill('.mo-dialog input >> nth=1', '2');
    await page.click('.mo-dialog button[type=submit]');
    await page.waitForSelector('.stage table.el-table', { timeout: 3000 });
    assert.equal(await page.locator('.stage table.el-table tr').count(), 3);
    await page.dblclick('.stage .el-table td[data-r="1"][data-c="0"]');
    await page.keyboard.type('Lisboa');
    await page.keyboard.press('Enter');
    await page.click('button[title="Acrescentar coluna à tabela"]');
    await page.click('button[title="Acrescentar linha à tabela"]');
    const t = (await deck())[0].els[0];
    assert.equal(t.type, 'table');
    assert.equal(t.rows[1][0], 'Lisboa');
    assert.equal(t.rows.length, 4);
    assert.equal(t.rows[0].length, 3);
  });

  await test('Diapositivos: alinhar, distribuir e agrupar vários elementos', page, async () => {
    await loadDeck([{ bg: '#ffffff', els: [box(100, 50, 100, 50), box(300, 200, 100, 50), box(700, 120, 100, 50)] }]);
    const els = page.locator('.stage .el');
    await els.nth(0).click();
    await els.nth(1).click({ modifiers: ['Shift'] });
    await els.nth(2).click({ modifiers: ['Shift'] });
    await slidesTab('Base');
    await page.click('button[title="Alinhar acima (elementos)"]');
    let d = (await deck())[0].els;
    assert.deepEqual(d.map((e) => e.y), [50, 50, 50]);
    await page.click('button[title="Distribuir na horizontal"]');
    d = (await deck())[0].els;
    assert.deepEqual(d.map((e) => e.x), [100, 400, 700]);
    await page.click('button[title="Agrupar elementos"]');
    d = (await deck())[0].els;
    assert.ok(d[0].group && d.every((e) => e.group === d[0].group), 'todos no mesmo grupo');
    // Clicar num elemento do grupo e arrastar move o grupo inteiro.
    await page.click('.stage-box', { position: { x: 5, y: 5 } });
    const b = await els.nth(1).boundingBox();
    await page.mouse.move(b.x + 20, b.y + 20);
    await page.mouse.down();
    await page.mouse.move(b.x + 20, b.y + 80, { steps: 5 });
    await page.mouse.up();
    d = (await deck())[0].els;
    assert.ok(d.every((e) => e.y > 80), 'o grupo moveu-se junto: ' + d.map((e) => e.y));
  });

  await test('Diapositivos: organizar reordena arrastando', page, async () => {
    await loadDeck(['A', 'B', 'C'].map((t) => ({ bg: '#ffffff', els: [{ type: 'text', x: 60, y: 40, w: 840, h: 80, html: t, fs: 40, color: '#1c2130', align: 'left' }] })));
    await slidesTab('Apresentação');
    await page.click('button[title^="Ver todos os diapositivos em grelha"]');
    assert.equal(await page.locator('.sorter-card').count(), 3);
    await page.dragAndDrop('.sorter-card[data-index="2"]', '.sorter-card[data-index="0"]');
    const order = (await deck()).map((sl) => sl.els[0].html);
    assert.deepEqual(order, ['C', 'A', 'B']);
    await page.click('.sorter-head button');
    assert.equal(await page.locator('.slide-sorter').count(), 0);
  });

  await test('Diapositivos: vista do apresentador mostra notas, seguinte e tempo', page, async () => {
    await loadDeck([{ bg: '#ffffff', notes: 'Cumprimentar a direção', els: [] }, { bg: '#eeeeee', els: [] }]);
    await slidesTab('Apresentação');
    await page.click('button[title^="Apresentar com notas"]');
    await page.waitForSelector('.present.presenter .pv');
    assert.match(await page.textContent('.pv-notes'), /Cumprimentar a direção/);
    assert.equal(await page.locator('.pv-side .pv-frame').count(), 1, 'mostra o diapositivo seguinte');
    assert.match(await page.textContent('.pv-clock'), /^\d\d:\d\d$/);
    await page.keyboard.press('ArrowRight');
    assert.match(await page.textContent('.pv-end'), /Fim/);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.present').count(), 0);
  });

  await test('Diapositivos: tabela exportada como tabela nativa do PowerPoint', page, async () => {
    await loadDeck([{ bg: '#ffffff', els: [{ type: 'table', x: 80, y: 140, w: 800, h: 160, rows: [['Região', 'Vendas'], ['Norte', '82']], fs: 20, accent: '#1f5fbf' }] }]);
    const xml = await page.evaluate(() => {
      const files = fflate.unzipSync(MO.modules.slides.exports.find((e) => e.ext === 'pptx').get());
      return new TextDecoder().decode(files['ppt/slides/slide1.xml']);
    });
    assert.match(xml, /<a:tbl>/);
    assert.match(xml, /Norte/);
  });

  await test('Word: comentários, notas, revisões, células unidas e página voltam ao abrir', page, async () => {
    const doc = await page.evaluate(() => {
      const ed = document.createElement('div');
      ed.innerHTML = '<p>Olá <mark class="mo-comment" data-id="a1">mundo</mark> <ins class="mo-ins">novo</ins><del class="mo-del">velho</del><sup class="mo-fn" data-id="n1">1</sup></p><table><tbody><tr><td colspan="2">A</td><td rowspan="2">C</td></tr><tr><td>D</td><td>E</td></tr></tbody></table>';
      const bytes = MO.OOXML.exportDocx(ed, {}, { comments: { a1: { text: 'Rever', date: '2026-01-01T00:00:00Z' } }, notes: { n1: 'Fonte' }, page: { size: 'A4', orient: 'landscape', margin: 'narrow' } });
      return MO.OOXML.importDocx(bytes);
    });
    assert.match(doc.html, /<mark class="mo-comment" data-id="c\d+">mundo<\/mark>/);
    assert.match(doc.html, /<ins class="mo-ins">novo<\/ins><del class="mo-del">velho<\/del>/);
    assert.match(doc.html, /<sup class="mo-fn" data-id="f1">/);
    assert.match(doc.html, /<td colspan="2">A<\/td><td rowspan="2">C<\/td>/);
    assert.ok(Object.values(doc.comments).some((c) => c.text.endsWith('Rever')));
    assert.equal(doc.notes.f1, 'Fonte');
    assert.deepEqual(doc.page, { size: 'A4', orient: 'landscape', margin: 'narrow', columns: 1 });
    assert.equal(doc.footer, '');
  });

  await test('Excel: fórmulas entre folhas e formatação condicional', page, async () => {
    const out = await page.evaluate(() => {
      const F = MO.Formula;
      const s1 = { A1: { v: '=Dados!A1*2' }, A2: { v: "=SOMA('Vendas 2026'!B1:B2)" }, A3: { v: '=Nada!A1' } };
      const book = { folha1: s1, dados: { A1: { v: '21' } }, 'vendas 2026': { B1: { v: '1' }, B2: { v: '2' } } };
      const values = F.compute(s1, 100, 26, book);
      const rules = [{ range: { r0: 0, r1: 2, c0: 0, c1: 0 }, type: 'gt', a: '10', b: '', bg: '#c6efce', c: '#006100' }, { range: { r0: 0, r1: 2, c0: 0, c1: 0 }, type: 'scale', a: '', b: '' }];
      const bytes = MO.OOXML.exportXlsx([{ name: 'Folha1', cells: s1, rules, values }, { name: 'Dados', cells: book.dados, values: new Map() }]);
      return { a1: F.format(values.get('A1')), a2: F.format(values.get('A2')), a3: F.format(values.get('A3')), rules: MO.OOXML.importXlsx(bytes, 1000, 26).sheets[0].rules };
    });
    assert.deepEqual([out.a1, out.a2, out.a3], ['42', '3', '#REF!']);
    assert.deepEqual(out.rules.map((r) => r.type), ['gt', 'scale']);
    assert.equal(out.rules[0].bg, '#c6efce');
  });

  await test('PowerPoint: tabelas e cores do tema são importadas', page, async () => {
    const slides = await page.evaluate(() => {
      const bytes = MO.OOXML.exportPptx([{ bg: '#ffffff', els: [{ type: 'table', x: 80, y: 140, w: 800, h: 160, rows: [['Região', 'Vendas'], ['Norte', '82']], fs: 20, accent: '#1f5fbf' }] }], { sans: 'Arial' });
      return MO.OOXML.importPptx(bytes);
    });
    const table = slides[0].els.find((e) => e.type === 'table');
    assert.deepEqual(table.rows, [['Região', 'Vendas'], ['Norte', '82']]);
  });

  await test('Assistente: insere a fórmula na célula ativa e o rascunho no Texto', page, async () => {
    await page.click('#rail [data-view="assistant"]');
    await page.fill('.mo-assistant-compose textarea', 'soma de A1 a A3');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.mo-assistant-action');
    await page.click('.mo-assistant-message.ai:last-child .mo-assistant-action');
    assert.equal(await page.evaluate(() => document.body.dataset.current), 'sheets');
    assert.equal(await page.inputValue('.fx-input'), '=SOMA(A1:A3)');
    await page.click('#rail [data-view="assistant"]');
    await page.fill('.mo-assistant-compose textarea', 'escreve um convite para o jantar de Natal');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('.mo-assistant-action').length === 2);
    await page.click('.mo-assistant-message.ai:last-child .mo-assistant-action');
    assert.equal(await page.evaluate(() => document.body.dataset.current), 'writer');
    assert.match(await page.textContent('#view-writer .page'), /jantar de Natal/);
  });

  await test('PDF: abrir, escrever, realçar, rodar, organizar e guardar', page, async () => {
    await page.click('#rail [data-view="pdf"]');
    assert.equal(await page.isVisible('.pdf-empty'), true);
    await page.evaluate(async () => {
      const { PDFDocument, StandardFonts } = PDFLib;
      const d = await PDFDocument.create();
      const f = await d.embedFont(StandardFonts.Helvetica);
      for (let i = 1; i <= 3; i++) d.addPage([595, 842]).drawText('Página original ' + i, { x: 50, y: 780, size: 18, font: f });
      await MO.openFileObject({ path: null, name: 'contrato.pdf', content: await d.save() });
    });
    await page.waitForSelector('.pdf-page');
    assert.equal(await page.locator('.pdf-page').count(), 3);
    assert.equal(await page.locator('.pdf-thumb').count(), 3);
    assert.match(await page.textContent('#view-pdf .status-text'), /Página 1 de 3/);
    // Texto
    await page.click('#view-pdf .tool[title="Clicar na página para escrever"]');
    const box = await page.locator('.pdf-page').first().boundingBox();
    await page.mouse.click(box.x + 100, box.y + 300);
    await page.keyboard.type('Aprovado');
    await page.mouse.click(box.x + 300, box.y + 700);
    await page.waitForSelector('.pdf-text');
    // Realce
    await page.click('#view-pdf .tool[title="Arrastar sobre o texto para o realçar"]');
    await page.mouse.move(box.x + 60, box.y + 60); await page.mouse.down(); await page.mouse.move(box.x + 300, box.y + 90, { steps: 4 }); await page.mouse.up();
    assert.equal(await page.locator('.pdf-highlight').count(), 1);
    // Anular e refazer
    await page.click('#view-pdf .tool[title="Selecionar, mover e apagar anotações"]');
    await page.keyboard.press('Control+z');
    assert.equal(await page.locator('.pdf-highlight').count(), 0);
    await page.keyboard.press('Control+y');
    assert.equal(await page.locator('.pdf-highlight').count(), 1);
    // Páginas: rodar a 1.ª, apagar a 3.ª, acrescentar uma em branco no fim
    await page.evaluate(() => MO.modules.pdf._debug.pages());
    await page.click('#view-pdf .ribbon-tab:has-text("Páginas")');
    await page.click('#view-pdf .tool[title="Rodar a página atual 90° para a direita"]');
    await page.click('.pdf-thumb[data-n="2"]');
    await page.click('#view-pdf .tool[title="Eliminar a página atual"]');
    await page.click('#view-pdf .tool[title="Inserir uma página em branco depois da atual"]');
    assert.equal(await page.locator('.pdf-page').count(), 3);
    const result = await page.evaluate(async () => {
      const bytes = await MO.modules.pdf.serialize();
      const doc = await PDFLib.PDFDocument.load(bytes);
      const read = await pdfjsLib.getDocument({ data: bytes, isEvalSupported: false }).promise;
      const text = async (n) => (await (await read.getPage(n)).getTextContent()).items.map((i) => i.str).join(' ');
      return { count: doc.getPageCount(), rot: doc.getPage(0).getRotation().angle, p1: await text(1), p2: await text(2), p3: await text(3), title: document.title };
    });
    assert.equal(result.count, 3);
    assert.equal(result.rot, 90);
    assert.match(result.p1, /Página original 1/);
    assert.match(result.p1, /Aprovado/);
    assert.match(result.p2, /Página original 2/);
    assert.equal(result.p3.trim(), '');
    assert.match(result.title, /contrato •/);
  });

  await test('PDF: procurar texto e o Assistente explica como assinar', page, async () => {
    await page.click('#view-pdf .ribbon-tab:has-text("Procurar")');
    await page.fill('.pdf-search', 'original 2');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.pdf-result');
    assert.match(await page.textContent('.pdf-result'), /Pág\. 2/);
    const A = await page.evaluate(() => MO.Assistant.assist({ module: 'assistant', task: 'chat', content: 'Utilizador: como assino um pdf' }).answer);
    assert.match(A, /^Assinar um PDF/);
  });

  await test('Gráficos no Texto e nos Diapositivos', page, async () => {
    await page.click('#rail [data-view="writer"]');
    await page.evaluate(() => MO.modules.writer.newDoc());
    await page.click('#view-writer .page');
    await page.click('#view-writer .ribbon-tab:has-text("Inserir")');
    await page.click('#view-writer button[title^="Inserir um gráfico"]');
    await page.waitForSelector('.chart-dialog textarea.chart-data');
    await page.click('.chart-dialog .chart-type[data-type="bar"]');
    await page.fill('.chart-dialog textarea.chart-data', '\tVendas\nNorte\t10\nSul\t20');
    await page.click('.chart-dialog button[type=submit]');
    await page.waitForSelector('#view-writer .page img[src^="data:image/png"]');
    await page.click('#rail [data-view="slides"]');
    const before = await page.evaluate(() => JSON.parse(MO.modules.slides.serialize()).slides[0].els.length);
    await page.click('#view-slides .ribbon-tab:has-text("Inserir")');
    await page.click('#view-slides button[title^="Inserir um gráfico"]');
    await page.click('.chart-dialog .chart-type[data-type="doughnut"]');
    await page.click('.chart-dialog button[type=submit]');
    await page.waitForFunction((n) => JSON.parse(MO.modules.slides.serialize()).slides[0].els.length === n + 1, before);
    const el = await page.evaluate(() => JSON.parse(MO.modules.slides.serialize()).slides[0].els.at(-1));
    assert.equal(el.type, 'image');
    assert.match(el.src, /^data:image\/png/);
  });

  await test('Bases de dados: modelo, editar registos, estrutura e formulário', page, async () => {
    await page.click('#rail [data-view="db"]');
    await page.evaluate(() => MO.modules.db.newDoc('encomendas'));
    await page.click('.db-nav-item:has-text("Clientes")');
    assert.equal(await page.locator('.db-grid tbody tr[data-id]').count(), 3);
    // Editar uma célula
    const cidade = page.locator('.db-grid tbody tr[data-id="1"] td.db-text input').nth(3);
    await cidade.fill('Coimbra');
    await cidade.press('Enter');
    const sql = (s) => page.evaluate((q) => MO.modules.db._debug.sql(q), s);
    assert.equal((await sql('SELECT "Cidade" FROM "Clientes" WHERE rowid = 1'))[0].Cidade, 'Coimbra');
    // Novo registo
    await page.click('.db-newrow button');
    assert.equal((await sql('SELECT COUNT(*) AS n FROM "Clientes"'))[0].n, 4);
    // Anular repõe
    await page.keyboard.press('Escape');
    await page.click('#view-db .db-content', { position: { x: 5, y: 400 } });
    await page.keyboard.press('Control+z');
    assert.equal((await sql('SELECT COUNT(*) AS n FROM "Clientes"'))[0].n, 3);
    // Estrutura: mudar o tipo de um campo
    await page.click('#view-db .db-mode[data-mode="design"]');
    await page.selectOption('.db-design-table select[aria-label="Tipo de Cidade"]', 'choice');
    const f = await page.evaluate(() => MO.modules.db._debug.fields('Clientes').find((x) => x.name === 'Cidade'));
    assert.equal(f.type, 'choice');
    assert.ok(f.opts.choices.includes('Coimbra'), 'as opções vêm dos valores existentes');
    // Formulário
    await page.click('#view-db .db-mode[data-mode="form"]');
    assert.match(await page.textContent('.db-form-nav'), /Registo 1 de 3/);
    await page.click('.db-form-nav button:has-text("Seguinte")');
    assert.match(await page.textContent('.db-form-nav'), /Registo 2 de 3/);
  });

  await test('Bases de dados: consultas, segurança do SQL, guardar e voltar a abrir', page, async () => {
    page.on('dialog', (d) => d.accept());
    await page.click('#view-db .ribbon-tab:has-text("Criar")');
    await page.click('#view-db .db-mode[data-mode="query"]');
    await page.selectOption('.db-builder select[aria-label="Tabela"]', 'Produtos');
    await page.selectOption('.db-builder select[aria-label="Campo"]', 'Preço');
    await page.selectOption('.db-builder select[aria-label="Condição"]', '>');
    await page.fill('.db-builder input[aria-label="Valor"]', '200');
    await page.click('.db-builder button:has-text("Criar consulta")');
    assert.equal(await page.locator('.db-results tbody tr').count(), 2);
    // Instrução que altera dados: pede confirmação e diz quantos registos mudaram
    await page.fill('.db-sql', 'UPDATE "Produtos" SET "Stock" = 0 WHERE "Código" = \'P01\'');
    await page.click('.db-query-actions button:has-text("Executar")');
    const sql = (s) => page.evaluate((q) => MO.modules.db._debug.sql(q), s);
    assert.equal((await sql('SELECT "Stock" FROM "Produtos" WHERE "Código" = \'P01\''))[0].Stock, 0);
    await page.fill('.db-sql', 'ATTACH DATABASE \'x.db\' AS x');
    await page.click('.db-query-actions button:has-text("Executar")');
    assert.match(await page.textContent('.db-results'), /não são permitidos/);
    // Guardar e voltar a abrir (ficheiro SQLite)
    const bytes = await page.evaluate(() => Array.from(MO.modules.db.serialize()));
    assert.equal(String.fromCharCode(...bytes.slice(0, 15)), 'SQLite format 3');
    await page.evaluate(() => MO.modules.db.newDoc('blank'));
    assert.deepEqual(await page.evaluate(() => MO.modules.db._debug.tables()), []);
    await page.evaluate((arr) => MO.modules.db.load(new Uint8Array(arr), 'modb'), bytes);
    assert.deepEqual(await page.evaluate(() => MO.modules.db._debug.tables()), ['Clientes', 'Encomendas', 'Produtos']);
    assert.equal((await sql('SELECT COUNT(*) AS n FROM _mo_queries'))[0].n, 1);
    await assert.rejects(page.evaluate(() => MO.modules.db.load(new Uint8Array([1, 2, 3]), 'modb')));
  });

  await test('Bases de dados: importar CSV e Excel, exportar para Excel', page, async () => {
    await page.evaluate(() => MO.modules.db.newDoc('blank'));
    await page.click('#view-db .ribbon-tab:has-text("Dados externos")');
    let chooser = page.waitForEvent('filechooser');
    await page.click('#view-db button[title="Importar um ficheiro CSV como tabela"]');
    await (await chooser).setFiles({ name: 'vendas.csv', mimeType: 'text/csv', buffer: Buffer.from('Mês;Valor;Pago\nJaneiro;1200,50;sim\nFevereiro;980;não\n') });
    await page.waitForFunction(() => MO.modules.db._debug.tables().includes('vendas'));
    const f = await page.evaluate(() => MO.modules.db._debug.fields('vendas').map((x) => x.type));
    assert.deepEqual(f, ['text', 'number', 'bool']);
    const v = await page.evaluate(() => MO.modules.db._debug.sql('SELECT * FROM "vendas"'));
    assert.equal(v[0].Valor, 1200.5);
    assert.equal(v[1].Pago, 0);
    // Excel: exportar a tabela e voltar a importá-la
    const xlsx = await page.evaluate(() => Array.from(MO.modules.db.exports[0].get()));
    chooser = page.waitForEvent('filechooser');
    await page.click('#view-db button[title^="Importar as folhas de um livro do Excel"]');
    await (await chooser).setFiles({ name: 'livro.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from(xlsx) });
    await page.waitForFunction(() => MO.modules.db._debug.tables().length === 2);
    const t = await page.evaluate(() => MO.modules.db._debug.tables());
    assert.deepEqual(t, ['livro', 'vendas']);
    assert.equal((await page.evaluate(() => MO.modules.db._debug.sql('SELECT SUM("Valor") AS s FROM "livro"')))[0].s, 2180.5);
  });

  await test('Texto: espaçamentos, expoente, maiúsculas e colunas vão para o Word', page, async () => {
    await page.click('#rail [data-view="writer"]');
    await page.evaluate(() => MO.modules.writer.load('<h1>Relatório</h1><p>A fórmula da água é H2O e a área é 10 m2.</p><p>segundo parágrafo em minúsculas</p>', 'html'));
    const selectIn = async (selector, from, to) => page.evaluate(([sel, a, b]) => {
      const el = document.querySelector('#view-writer .page ' + sel);
      const text = el.firstChild;
      const r = document.createRange();
      r.setStart(text, a); r.setEnd(text, b);
      const s = document.getSelection(); s.removeAllRanges(); s.addRange(r);
      el.closest('.page').focus();
    }, [selector, from, to]);
    // Espaçamento 1,5 e 12 pt depois no 1.º parágrafo
    await selectIn('p', 2, 4);
    await page.click('#view-writer .ribbon-tab:has-text("Base")');
    await page.selectOption('#view-writer select[title="Espaçamento entre linhas"]', '1.5');
    await selectIn('p', 2, 4);
    await page.selectOption('#view-writer select[title="Espaço depois do parágrafo"]', '12pt');
    // Expoente no "2" de m2
    const text = await page.textContent('#view-writer .page p');
    await selectIn('p', text.indexOf('m2') + 1, text.indexOf('m2') + 2);
    await page.click('#view-writer button[title^="Expoente"]');
    // Maiúsculas no 2.º parágrafo
    await page.evaluate(() => {
      const el = document.querySelectorAll('#view-writer .page p')[1];
      const r = document.createRange(); r.selectNodeContents(el);
      const s = document.getSelection(); s.removeAllRanges(); s.addRange(r);
    });
    await page.selectOption('#view-writer select[title="Maiúsculas e minúsculas"]', 'title');
    assert.equal(await page.evaluate(() => document.querySelectorAll('#view-writer .page p')[1].textContent), 'Segundo Parágrafo Em Minúsculas');
    // Duas colunas
    await page.click('#view-writer .ribbon-tab:has-text("Estrutura")');
    await page.selectOption('#view-writer select[title="Colunas de texto"]', '2');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#view-writer .page')).columnCount), '2');
    const xml = await page.evaluate(() => {
      const files = fflate.unzipSync(MO.modules.writer.exports.find((e) => e.ext === 'docx').get());
      return new TextDecoder().decode(files['word/document.xml']);
    });
    assert.match(xml, /<w:spacing w:after="240" w:line="360" w:lineRule="auto"\/>/);
    assert.match(xml, /<w:vertAlign w:val="superscript"\/><\/w:rPr><w:t xml:space="preserve">2<\/w:t>/);
    assert.match(xml, /<w:cols w:num="2" w:space="567"\/>/);
    const back = await page.evaluate(() => MO.OOXML.importDocx(MO.modules.writer.exports.find((e) => e.ext === 'docx').get()));
    assert.match(back.html, /line-height: 1.5; margin-bottom: 12pt/);
    assert.match(back.html, /<sup>2<\/sup>/);
    assert.equal(back.page.columns, 2);
  });

  await test('Texto: tabelas (linhas, colunas, unir, cabeçalho, cor) e símbolos', page, async () => {
    await page.evaluate(() => MO.modules.writer.load('<p>Antes</p><table><tbody><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></tbody></table>', 'html'));
    const caretIn = (text) => page.evaluate((t) => {
      const td = [...document.querySelectorAll('#view-writer .page td, #view-writer .page th')].find((c) => c.textContent.trim() === t);
      const r = document.createRange(); r.setStart(td.firstChild, 0); r.collapse(true);
      const s = document.getSelection(); s.removeAllRanges(); s.addRange(r);
      td.closest('.page').focus();
    }, text);
    await page.click('#view-writer .ribbon-tab:has-text("Inserir")');
    await caretIn('A');
    await page.click('#view-writer button[title="Inserir linha abaixo"]');
    await caretIn('A');
    await page.click('#view-writer button[title="Inserir coluna à direita"]');
    const shape = () => page.evaluate(() => [...document.querySelectorAll('#view-writer .page table tr')].map((tr) => tr.cells.length));
    assert.deepEqual(await shape(), [3, 3, 3]);
    await caretIn('C');
    await page.click('#view-writer button[title="Unir com a célula à direita"]');
    assert.equal(await page.evaluate(() => document.querySelector('#view-writer .page table tr:nth-child(3) td').colSpan), 2);
    await caretIn('A');
    await page.click('#view-writer button[title^="Primeira linha como cabeçalho"]');
    assert.equal(await page.locator('#view-writer .page table th').count(), 3);
    await caretIn('A');
    await page.evaluate(() => { const i = document.querySelector('#view-writer input[title="Cor de fundo das células"]'); i.value = '#ffe9a8'; i.dispatchEvent(new Event('input')); });
    // Símbolo
    await page.evaluate(() => { const p = document.querySelector('#view-writer .page p'); const r = document.createRange(); r.selectNodeContents(p); r.collapse(false); const s = document.getSelection(); s.removeAllRanges(); s.addRange(r); p.closest('.page').focus(); });
    await page.click('#view-writer button[title^="Inserir símbolo"]');
    await page.click('.symbol-dialog .symbol:has-text("€")');
    assert.match(await page.textContent('#view-writer .page p'), /Antes€/);
    const xml = await page.evaluate(() => new TextDecoder().decode(fflate.unzipSync(MO.modules.writer.exports.find((e) => e.ext === 'docx').get())['word/document.xml']));
    assert.match(xml, /<w:tblHeader\/>/);
    assert.match(xml, /<w:shd w:val="clear" w:color="auto" w:fill="FFE9A8"\/>/);
    assert.match(xml, /<w:gridSpan w:val="2"\/>/);
  });

  await test('Texto: mala direta cria uma cópia por registo', page, async () => {
    await page.evaluate(() => MO.modules.writer.load('<p>Caro(a) «Nome»,</p><p>A sua encomenda de «Valor» € foi enviada para «Cidade».</p>', 'html'));
    await page.click('#view-writer .ribbon-tab:has-text("Correspondência")');
    const chooser = page.waitForEvent('filechooser');
    await page.click('#view-writer button[title^="Escolher a lista de destinatários"]');
    await (await chooser).setFiles({ name: 'clientes.csv', mimeType: 'text/csv', buffer: Buffer.from('Nome;Cidade;Valor\nAna;Lisboa;120\nRui;Porto;80\nInês <b>;Braga;15\n') });
    await page.waitForFunction(() => document.querySelectorAll('#view-writer select[aria-label="Inserir campo da lista"] option').length === 4);
    await page.click('#view-writer button[title^="Criar um documento com uma cópia"]');
    await page.click('dialog[open]:has-text("Concluir a mala direta") button[type=submit]');
    await page.waitForFunction(() => document.querySelector('#view-writer .page').innerHTML.includes('page-break'), null, { timeout: 5000 });
    const html = await page.evaluate(() => document.querySelector('#view-writer .page').innerHTML);
    assert.equal((html.match(/page-break/g) || []).length, 2, html.slice(0, 200) + ' | toast: ' + (await page.textContent('#toast')) + ' | dialogs: ' + (await page.locator('dialog').count()));
    assert.match(html, /Caro\(a\) Ana,[\s\S]*120 € foi enviada para Lisboa[\s\S]*Caro\(a\) Rui[\s\S]*Inês &lt;b&gt;/);
    assert.doesNotMatch(html, /«/);
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
