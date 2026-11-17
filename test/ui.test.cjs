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
    assert.deepEqual(saved.page, { size: 'A4', orient: 'landscape', margin: 'narrow' });
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
    assert.deepEqual(doc.page, { size: 'A4', orient: 'landscape', margin: 'narrow' });
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
