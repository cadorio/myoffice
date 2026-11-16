'use strict';

// Módulo "Folhas": folha de cálculo.
(function () {
  const MO = window.MO;
  const F = MO.Formula;
  const { h, toolButton, colorButton, iconButton, bigButton } = MO;

  const ROWS = 100;
  const COLS = 26;
  const MAX_UNDO = 100;
  const MAX_CELL_CHARS = 32767;
  const NUMBER_FORMATS = {
    num2: new Intl.NumberFormat('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    eur: new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }),
    pct: new Intl.NumberFormat('pt-PT', { style: 'percent', maximumFractionDigits: 2 })
  };
  // O que está desenhado em cada célula, para só tocar no ecrã quando algo muda.
  let drawn = new Map();

  let ctx, wrap, editorEl, nameBox, fxInput, statusEl;
  let showStates = () => {};
  let cells = {}; // endereço -> { v: texto introduzido, s: { b, i, a, bg, c } }
  let workbookSheets = [];
  let activeSheetId = 'sheet-1';
  let sheetBar;
  let nextSheetNumber = 2;

  function snapshotSheet() {
    const current = workbookSheets.find((s) => s.id === activeSheetId);
    if (current) current.cells = JSON.parse(JSON.stringify(cells));
  }

  function renderSheetTabs() {
    if (!sheetBar) return;
    sheetBar.replaceChildren();
    for (const sheet of workbookSheets) {
      const tab = h('button', {
        type: 'button',
        class: 'sheet-tab' + (sheet.id === activeSheetId ? ' active' : ''),
        'aria-pressed': sheet.id === activeSheetId ? 'true' : 'false',
        title: 'Abrir ' + sheet.name
      }, sheet.name);
      tab.addEventListener('click', () => activateSheet(sheet.id));
      tab.addEventListener('dblclick', () => renameSheet(sheet.id));
      sheetBar.append(tab);
    }
    const add = h('button', { type: 'button', class: 'sheet-tab-add', title: 'Adicionar folha', 'aria-label': 'Adicionar folha' }, '+');
    add.addEventListener('click', addSheet);
    sheetBar.append(add);
  }

  function activateSheet(id) {
    if (editing) stopEdit(true);
    snapshotSheet();
    const target = workbookSheets.find((s) => s.id === id);
    if (!target || target.id === activeSheetId) return;
    activeSheetId = id;
    cells = JSON.parse(JSON.stringify(target.cells || {}));
    undoStack = [];
    redoStack = [];
    cur = { r: 0, c: 0 };
    end = { r: 0, c: 0 };
    drawn.clear();
    painted.clear();
    refresh();
    renderSheetTabs();
    ctx.dirty();
  }

  function addSheet() {
    if (editing) stopEdit(true);
    snapshotSheet();
    const id = 'sheet-' + nextSheetNumber++;
    const name = 'Folha' + nextSheetNumber;
    workbookSheets.push({ id, name, cells: {} });
    activateSheet(id);
    renderSheetTabs();
  }

  function renameSheet(id) {
    const sheet = workbookSheets.find((s) => s.id === id);
    if (!sheet) return;
    const name = window.prompt('Nome da folha (máximo 31 caracteres):', sheet.name);
    if (name == null) return;
    const clean = name.trim().slice(0, 31);
    if (!clean || /[\\/?*:[\\]]/.test(clean)) return MO.toast('Nome inválido. Evite \\ / ? * : [ ].');
    if (workbookSheets.some((s) => s.id !== id && s.name.toLocaleLowerCase('pt-PT') === clean.toLocaleLowerCase('pt-PT'))) return MO.toast('Já existe uma folha com esse nome.');
    sheet.name = clean;
    renderSheetTabs();
    ctx.dirty();
  }

  function resetWorkbook(initialCells = {}) {
    workbookSheets = [{ id: 'sheet-1', name: 'Folha1', cells: initialCells }];
    activeSheetId = 'sheet-1';
    nextSheetNumber = 2;
    cells = JSON.parse(JSON.stringify(initialCells));
    renderSheetTabs();
  }
  let values = new Map();
  let tds = [];
  let colHeads = [];
  let rowHeads = [];
  let cur = { r: 0, c: 0 }; // célula ativa
  let end = { r: 0, c: 0 }; // canto oposto da seleção
  let editing = null; // { a, viaBar }
  let painted = new Set();
  let selPainted = [];
  let undoStack = [];
  let redoStack = [];
  let clip = null;
  let dragging = false;

  const range = () => ({
    r0: Math.min(cur.r, end.r),
    r1: Math.max(cur.r, end.r),
    c0: Math.min(cur.c, end.c),
    c1: Math.max(cur.c, end.c)
  });

  function eachInRange(fn) {
    const { r0, r1, c0, c1 } = range();
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) fn(r, c, F.addr(r, c));
  }

  const rawOf = (a) => (cells[a] && cells[a].v) || '';

  // ---------- Modelo ----------

  function setRaw(a, raw) {
    const cell = cells[a];
    if (raw === '') {
      if (cell && cell.s) cell.v = '';
      else delete cells[a];
    } else if (cell) {
      cell.v = raw;
    } else {
      cells[a] = { v: raw };
    }
  }

  function setStyle(a, key, value) {
    const cell = cells[a] || (cells[a] = { v: '' });
    const s = cell.s || (cell.s = {});
    if (value) s[key] = value;
    else delete s[key];
    if (!Object.keys(s).length) delete cell.s;
    if (!cell.s && cell.v === '') delete cells[a];
  }

  function mutate(fn) {
    undoStack.push(JSON.stringify(cells));
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack = [];
    fn();
    refresh();
    ctx.dirty();
  }

  function timeTravel(from, to) {
    if (!from.length) return;
    to.push(JSON.stringify(cells));
    cells = JSON.parse(from.pop());
    refresh();
    ctx.dirty();
  }

  function cleanCells(input) {
    const out = {};
    if (!input || typeof input !== 'object') return out;
    for (const [a, cell] of Object.entries(input)) {
      const pos = /^[A-Z]{1,2}\d{1,4}$/.test(a) ? F.parseAddr(a) : null;
      if (!pos || pos.r >= ROWS || pos.c >= COLS || !cell || typeof cell !== 'object') continue;
      const clean = { v: cell.v == null ? '' : String(cell.v).slice(0, MAX_CELL_CHARS) };
      if (cell.s && typeof cell.s === 'object') {
        const s = {};
        if (cell.s.b) s.b = 1;
        if (cell.s.i) s.i = 1;
        if (['left', 'center', 'right'].includes(cell.s.a)) s.a = cell.s.a;
        if (MO.HEX.test(cell.s.bg)) s.bg = cell.s.bg;
        if (MO.HEX.test(cell.s.c)) s.c = cell.s.c;
        if (Object.hasOwn(NUMBER_FORMATS, cell.s.f)) s.f = cell.s.f;
        if (Object.keys(s).length) clean.s = s;
      }
      if (clean.v !== '' || clean.s) out[a] = clean;
    }
    return out;
  }

  // ---------- Desenho ----------

  function paintCell(a) {
    const pos = F.parseAddr(a);
    const td = tds[pos.r][pos.c];
    const cell = cells[a];
    const v = cell ? values.get(a) : null;
    const s = (cell && cell.s) || {};
    const text = typeof v === 'number' && Object.hasOwn(NUMBER_FORMATS, s.f) ? NUMBER_FORMATS[s.f].format(v) : F.format(v);
    const kind = typeof v === 'number' ? 'n' : typeof v === 'boolean' ? 'b' : v instanceof F.FError ? 'e' : '';
    const key = `${text}\u0000${kind}\u0000${s.b || ''}${s.i || ''}\u0000${s.a || ''}\u0000${s.bg || ''}\u0000${s.c || ''}`;
    if (drawn.get(a) === key) return;
    if (cell) drawn.set(a, key);
    else drawn.delete(a);
    td.textContent = text;
    td.classList.toggle('num', typeof v === 'number');
    td.classList.toggle('err', v instanceof F.FError);
    td.classList.toggle('bool', typeof v === 'boolean');
    td.style.fontWeight = s.b ? '700' : '';
    td.style.fontStyle = s.i ? 'italic' : '';
    td.style.textAlign = s.a || '';
    td.style.backgroundColor = s.bg || '';
    td.style.color = s.c || '';
  }

  function refresh() {
    values = F.compute(cells, ROWS, COLS);
    const next = new Set(Object.keys(cells));
    for (const a of painted) if (!next.has(a)) paintCell(a);
    for (const a of next) paintCell(a);
    painted = next;
    paintSelection(false);
  }

  function paintSelection(scroll) {
    for (const el of selPainted) el.classList.remove('sel', 'cur', 'hot');
    selPainted = [];
    const { r0, r1, c0, c1 } = range();
    eachInRange((r, c) => {
      tds[r][c].classList.add('sel');
      selPainted.push(tds[r][c]);
    });
    for (let c = c0; c <= c1; c++) {
      colHeads[c].classList.add('hot');
      selPainted.push(colHeads[c]);
    }
    for (let r = r0; r <= r1; r++) {
      rowHeads[r].classList.add('hot');
      selPainted.push(rowHeads[r]);
    }
    tds[cur.r][cur.c].classList.add('cur');

    const single = r0 === r1 && c0 === c1;
    nameBox.textContent = single ? F.addr(cur.r, cur.c) : `${F.addr(r0, c0)}:${F.addr(r1, c1)}`;
    if (!editing) fxInput.value = rawOf(F.addr(cur.r, cur.c));
    if (scroll) tds[end.r][end.c].scrollIntoView({ block: 'nearest', inline: 'nearest' });
    updateStatus(single);
    const active = cells[F.addr(cur.r, cur.c)];
    const st = (active && active.s) || {};
    showStates((key) => (key === 'b' || key === 'i' ? st[key] : st.a === key));
  }

  function updateStatus(single) {
    if (single) {
      statusEl.textContent = 'Pronto';
      return;
    }
    const nums = [];
    eachInRange((_r, _c, a) => {
      const v = values.get(a);
      if (cells[a] && typeof v === 'number') nums.push(v);
    });
    if (!nums.length) {
      statusEl.textContent = 'Pronto';
      return;
    }
    const sum = nums.reduce((s, v) => s + v, 0);
    statusEl.textContent = `Soma: ${F.format(sum)} · Média: ${F.format(sum / nums.length)} · Contagem: ${nums.length}`;
  }

  // ---------- Seleção e navegação ----------

  const clampR = (r) => Math.max(0, Math.min(ROWS - 1, r));
  const clampC = (c) => Math.max(0, Math.min(COLS - 1, c));

  function select(r, c, extend) {
    if (extend) {
      end = { r: clampR(r), c: clampC(c) };
    } else {
      cur = { r: clampR(r), c: clampC(c) };
      end = { ...cur };
    }
    paintSelection(true);
  }

  function moveBy(dr, dc, extend) {
    const from = extend ? end : cur;
    select(from.r + dr, from.c + dc, extend);
  }

  // ---------- Edição ----------

  function startEdit(initial, viaBar) {
    if (editing) return;
    const a = F.addr(cur.r, cur.c);
    end = { ...cur };
    paintSelection(true);
    editing = { a, viaBar: Boolean(viaBar) };
    const text = initial != null ? initial : rawOf(a);
    fxInput.value = text;
    if (viaBar) return;
    const td = tds[cur.r][cur.c];
    Object.assign(editorEl.style, {
      display: 'block',
      left: td.offsetLeft + 'px',
      top: td.offsetTop + 'px',
      minWidth: td.offsetWidth + 1 + 'px',
      height: td.offsetHeight + 1 + 'px'
    });
    editorEl.value = text;
    editorEl.focus();
    editorEl.setSelectionRange(text.length, text.length);
  }

  function stopEdit(commit) {
    if (!editing) return;
    const { a, viaBar } = editing;
    const value = viaBar ? fxInput.value : editorEl.value;
    editing = null;
    editorEl.style.display = 'none';
    if (commit && value !== rawOf(a)) mutate(() => setRaw(a, value));
    else paintSelection(false);
  }

  function finishEdit(commit, dr, dc) {
    stopEdit(commit);
    wrap.focus({ preventScroll: true });
    if (dr || dc) moveBy(dr, dc, false);
  }

  function editKey(e) {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      finishEdit(true, e.shiftKey ? -1 : 1, 0);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      finishEdit(true, 0, e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finishEdit(false, 0, 0);
    }
  }

  // ---------- Ações ----------

  function clearRange() {
    mutate(() => eachInRange((_r, _c, a) => setRaw(a, '')));
  }

  function toggleStyle(key) {
    const active = cells[F.addr(cur.r, cur.c)];
    const on = !(active && active.s && active.s[key]);
    mutate(() => eachInRange((_r, _c, a) => setStyle(a, key, on ? 1 : 0)));
  }

  function applyStyle(key, value) {
    mutate(() => eachInRange((_r, _c, a) => setStyle(a, key, value)));
  }

  function clearFormat() {
    mutate(() =>
      eachInRange((_r, _c, a) => {
        if (!cells[a]) return;
        delete cells[a].s;
        if (cells[a].v === '') delete cells[a];
      })
    );
  }

  // Tema da folha: tipo de letra da grelha, cores dos seletores e estilos de tabela (ver themes.js).
  const T = MO.Themes;
  const PICKER = 'colors-sheets';
  let theme = T.LIST[0];
  let themeRow, tableRow, gridEl;

  function formatAsTable(style) {
    const { r0, r1, c0, c1 } = range();
    if (r0 === r1) return MO.toast('Selecione a tabela inteira, incluindo a linha de títulos.');
    mutate(() => {
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const a = F.addr(r, c);
          const header = r === r0;
          setStyle(a, 'bg', header ? style.head : (r - r0) % 2 === 0 ? style.band : '');
          setStyle(a, 'c', header ? style.headText : '');
          setStyle(a, 'b', header ? 1 : 0);
        }
      }
    });
  }

  function tableChip(style) {
    return toolButton(
      [h('span', { class: 'table-head', style: { background: style.head } }), h('span', { class: 'table-band', style: { background: style.band } }), h('span', { class: 'table-band' })],
      'Formatar a seleção como tabela: ' + style.name,
      () => formatAsTable(style),
      'theme-chip table-chip'
    );
  }

  function setTheme(next) {
    theme = next;
    gridEl.style.fontFamily = T.FONTS[theme.body];
    tableRow.replaceChildren(...T.tableStyles(theme).map(tableChip));
    T.markActive(themeRow, theme.id);
    T.setPickerColors(PICKER, theme);
  }

  // Ordena as linhas da seleção pela coluna da célula ativa.
  function sortRange(descending) {
    const { r0, r1, c0, c1 } = range();
    if (r0 === r1) return MO.toast('Selecione as linhas a ordenar (sem a linha de títulos).');
    const key = cur.c;
    const rank = (v) => (v == null ? 3 : typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : 2);
    const rows = [];
    for (let r = r0; r <= r1; r++) {
      const a = F.addr(r, key);
      const row = [];
      for (let c = c0; c <= c1; c++) row.push(cells[F.addr(r, c)] || null);
      rows.push({ row, v: cells[a] && cells[a].v !== '' ? values.get(a) : null });
    }
    rows.sort((x, y) => {
      const kx = rank(x.v);
      const ky = rank(y.v);
      if (kx !== ky || kx === 3) return kx - ky; // vazios sempre no fim
      const cmp = kx === 0 ? x.v - y.v : String(x.v).localeCompare(String(y.v), 'pt');
      return descending ? -cmp : cmp;
    });
    mutate(() =>
      rows.forEach(({ row }, i) =>
        row.forEach((cell, j) => {
          const a = F.addr(r0 + i, c0 + j);
          if (cell) cells[a] = cell;
          else delete cells[a];
        })
      )
    );
  }

  const isNumberAt = (r, c) => {
    const a = F.addr(r, c);
    return Boolean(cells[a]) && typeof values.get(a) === 'number';
  };

  // Propõe a função aplicada aos números contíguos acima (ou à esquerda) da célula ativa.
  function autoFn(fn) {
    if (editing) return;
    const { r, c } = cur;
    let formula = `=${fn}()`;
    let top = r;
    while (top > 0 && isNumberAt(top - 1, c)) top--;
    if (top < r) {
      formula = `=${fn}(${F.addr(top, c)}:${F.addr(r - 1, c)})`;
    } else {
      let left = c;
      while (left > 0 && isNumberAt(r, left - 1)) left--;
      if (left < c) formula = `=${fn}(${F.addr(r, left)}:${F.addr(r, c - 1)})`;
    }
    startEdit(formula);
    if (formula.endsWith('()')) editorEl.setSelectionRange(formula.length - 1, formula.length - 1);
  }

  function insertFn(text) {
    if (!editing) startEdit(text);
  }

  // ---------- Área de transferência ----------

  function copy(e, cut) {
    if (editing) return;
    e.preventDefault();
    const { r0, r1, c0, c1 } = range();
    const data = [];
    const lines = [];
    for (let r = r0; r <= r1; r++) {
      const row = [];
      const line = [];
      for (let c = c0; c <= c1; c++) {
        const a = F.addr(r, c);
        row.push(cells[a] ? JSON.parse(JSON.stringify(cells[a])) : null);
        line.push(F.format(cells[a] ? values.get(a) : null).replace(/[\t\n\r]+/g, ' '));
      }
      data.push(row);
      lines.push(line.join('\t'));
    }
    const text = lines.join('\n');
    e.clipboardData.setData('text/plain', text);
    clip = { text, r0, c0, data };
    if (cut) clearRange();
  }

  function paste(e) {
    if (editing) return;
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    if (!text && !clip) return;
    const internal = clip && clip.text === text ? clip : null;
    const src = internal
      ? internal.data
      : text
          .replace(/\r?\n$/, '')
          .split(/\r?\n/)
          .map((line) => line.split('\t').map((v) => ({ v })));
    const srcRows = src.length;
    const srcCols = Math.max(...src.map((row) => row.length));
    const sel = range();
    // Um bloco copiado repete-se até preencher a seleção (útil para estender fórmulas).
    const rows = Math.max(srcRows, sel.r1 - sel.r0 + 1);
    const cols = Math.max(srcCols, sel.c1 - sel.c0 + 1);

    mutate(() => {
      for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) {
          const r = sel.r0 + i;
          const c = sel.c0 + j;
          if (r >= ROWS || c >= COLS) continue;
          const from = src[i % srcRows][j % srcCols];
          const a = F.addr(r, c);
          if (!from || (from.v === '' && !from.s)) {
            delete cells[a];
            continue;
          }
          let v = from.v;
          if (internal) v = F.shiftFormula(v, r - (internal.r0 + (i % srcRows)), c - (internal.c0 + (j % srcCols)), ROWS, COLS);
          cells[a] = from.s ? { v, s: { ...from.s } } : { v };
        }
      }
    });
    cur = { r: sel.r0, c: sel.c0 };
    end = { r: clampR(sel.r0 + rows - 1), c: clampC(sel.c0 + cols - 1) };
    paintSelection(true);
  }

  // ---------- CSV ----------

  function parseCSV(text) {
    text = text.replace(/^﻿/, '');
    const firstLine = text.split(/\r?\n/, 1)[0];
    const sep = [';', ',', '\t'].map((s) => [s, firstLine.split(s).length]).sort((x, y) => y[1] - x[1])[0][0];
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') {
          field += '"';
          i++;
        } else if (ch === '"') {
          quoted = false;
        } else {
          field += ch;
        }
      } else if (ch === '"' && field === '') {
        quoted = true;
      } else if (ch === sep) {
        row.push(field);
        field = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else {
        field += ch;
      }
    }
    if (field !== '' || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }

  function usedBounds() {
    let maxR = -1;
    let maxC = -1;
    for (const a of Object.keys(cells)) {
      if (cells[a].v === '') continue;
      const pos = F.parseAddr(a);
      maxR = Math.max(maxR, pos.r);
      maxC = Math.max(maxC, pos.c);
    }
    return { maxR, maxC };
  }

  function toCSV() {
    const { maxR, maxC } = usedBounds();
    const lines = [];
    for (let r = 0; r <= maxR; r++) {
      const line = [];
      for (let c = 0; c <= maxC; c++) {
        const a = F.addr(r, c);
        const value = cells[a] ? values.get(a) : null;
        let text = F.format(value);
        // Texto começado por = + - @ seria executado como fórmula por outras folhas de cálculo ao abrir o CSV.
        if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = "'" + text;
        line.push(/[";\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text);
      }
      lines.push(line.join(';'));
    }
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  async function aiAnalyseSelection() {
    if (editing) stopEdit(true);
    const { r0, r1, c0, c1 } = range();
    const rows = [];
    for (let r = r0; r <= r1; r++) {
      const row = [];
      for (let c = c0; c <= c1; c++) {
        const a = F.addr(r, c);
        row.push(F.format(values.get(a) ?? (cells[a] ? cells[a].v : '')));
      }
      rows.push(row.join(' | '));
    }
    const content = rows.join('\n').slice(0, 6000);
    if (!content.trim()) return MO.toast('Selecione dados antes de pedir uma análise.');
    if (!window.api?.ai?.assist) return MO.toast('O assistente de IA está disponível na aplicação instalada.');
    MO.toast('A analisar os dados localmente…');
    const result = await window.api.ai.assist({ module: 'sheets', task: 'analyse', content });
    if (result.error) return MO.toast(result.error);
    await MO.dialog({ title: 'Assistente MyOffice · Análise de dados', message: result.answer, okLabel: 'Fechar' });
  }

  // ---------- Gráficos e filtros ----------

  let chartDialog = null;
  let chartRange = null;

  function selectedChartData() {
    const { r0, r1, c0, c1 } = chartRange || range();
    if (r1 - r0 < 1 || c1 - c0 < 1) return null;
    const points = [];
    for (let r = r0 + 1; r <= r1; r++) {
      const label = F.format(values.get(F.addr(r, c0)) ?? cells[F.addr(r, c0)]?.v ?? '');
      const value = values.get(F.addr(r, c0 + 1));
      if (typeof value === 'number' && Number.isFinite(value)) points.push({ label: label || `Linha ${r + 1}`, value });
    }
    return points.length ? { points, title: `${F.addr(r0, c0)}:${F.addr(r1, c1)}` } : null;
  }

  function renderChart(type) {
    if (!chartDialog) return;
    const host = chartDialog.querySelector('.mo-chart-preview');
    const data = selectedChartData();
    host.replaceChildren();
    if (!data) {
      host.textContent = 'Selecione pelo menos duas colunas: categorias na primeira e valores numéricos na segunda.';
      return;
    }
    const max = Math.max(1, ...data.points.map((p) => Math.abs(p.value)));
    const width = 720, height = 310, left = 52, bottom = 48, top = 22;
    const plotH = height - top - bottom;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Gráfico de valores da seleção');
    const add = (tag, attrs, text) => {
      const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
      Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, String(v)));
      if (text != null) el.textContent = text;
      svg.append(el);
      return el;
    };
    [0, .25, .5, .75, 1].forEach((step) => {
      const y = top + plotH * step;
      add('line', { x1: left, x2: width - 12, y1: y, y2: y, stroke: 'currentColor', opacity: .13 });
      add('text', { x: left - 10, y: y + 4, 'text-anchor': 'end', fill: 'currentColor', 'font-size': 11 }, F.format(max * (1 - step)));
    });
    const slot = (width - left - 20) / data.points.length;
    const coords = data.points.map((p, i) => ({
      x: left + slot * (i + .5),
      y: top + plotH - (p.value / max) * plotH,
      label: p.label,
      value: p.value
    }));
    if (type === 'line') {
      add('polyline', { points: coords.map((p) => `${p.x},${p.y}`).join(' '), fill: 'none', stroke: '#16865b', 'stroke-width': 3, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
      coords.forEach((p) => add('circle', { cx: p.x, cy: p.y, r: 5, fill: '#16865b' }));
    } else {
      const barW = Math.max(8, Math.min(54, slot * .62));
      coords.forEach((p) => add('rect', { x: p.x - barW / 2, y: p.y, width: barW, height: Math.max(0, top + plotH - p.y), rx: 4, fill: '#16865b' }));
    }
    coords.forEach((p) => {
      add('text', { x: p.x, y: height - 25, 'text-anchor': 'middle', fill: 'currentColor', 'font-size': 11 }, p.label.slice(0, 12));
      add('title', {}, `${p.label}: ${F.format(p.value)}`);
    });
    host.append(svg);
    chartDialog.querySelector('.mo-chart-range').textContent = `Intervalo: ${data.title} · ${data.points.length} valores`;
  }

  function openChart() {
    if (editing) stopEdit(true);
    chartRange = { ...range() };
    if (chartRange.c1 - chartRange.c0 < 1 || chartRange.r1 - chartRange.r0 < 1) {
      return MO.toast('Selecione uma tabela com categorias na primeira coluna e valores na segunda.');
    }
    chartDialog = h('dialog', { class: 'mo-chart-dialog', 'aria-labelledby': 'mo-chart-title' });
    const type = h('select', { class: 'tool-select', 'aria-label': 'Tipo de gráfico' },
      h('option', { value: 'bar' }, 'Colunas'),
      h('option', { value: 'line' }, 'Linhas')
    );
    type.addEventListener('change', () => renderChart(type.value));
    const preview = h('div', { class: 'mo-chart-preview' });
    const close = () => { chartDialog.close(); chartDialog.remove(); chartDialog = null; chartRange = null; };
    const exportSvg = () => {
      const svg = preview.querySelector('svg');
      if (!svg) return MO.toast('Não há gráfico para exportar.');
      const source = new XMLSerializer().serializeToString(svg);
      const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml;charset=utf-8' }));
      const a = h('a', { href: url, download: 'grafico-myoffice.svg' });
      document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    };
    chartDialog.append(
      h('header', { class: 'mo-chart-head' }, h('div', null, h('h2', { id: 'mo-chart-title' }, 'Análise visual'), h('p', null, 'Gráfico baseado nos dados da seleção')), type, h('button', { class: 'mo-chart-close', type: 'button', onclick: close, 'aria-label': 'Fechar' }, '×')),
      preview,
      h('p', { class: 'mo-chart-range' }),
      h('footer', { class: 'mo-chart-actions' }, h('button', { type: 'button', class: 'btn', onclick: exportSvg }, 'Exportar SVG'), h('button', { type: 'button', class: 'btn primary', onclick: close }, 'Concluir'))
    );
    chartDialog.addEventListener('click', (e) => { if (e.target === chartDialog) close(); });
    document.body.append(chartDialog);
    chartDialog.showModal();
    renderChart(type.value);
  }

  function filterSelection() {
    if (editing) stopEdit(true);
    const { r0, r1 } = range();
    const col = cur.c;
    const term = window.prompt('Mostrar apenas as linhas em que esta coluna contém:');
    if (term == null) return;
    const needle = term.trim().toLocaleLowerCase('pt-PT');
    for (let r = 0; r < ROWS; r++) {
      const row = tds[r][0].parentElement;
      row.hidden = Boolean(needle) && r > r0 && r <= r1 && !F.format(values.get(F.addr(r, col))).toLocaleLowerCase('pt-PT').includes(needle);
    }
    MO.toast(needle ? 'Filtro aplicado à seleção.' : 'Filtro removido.');
  }

  function clearFilter() {
    for (let r = 0; r < ROWS; r++) tds[r][0].parentElement.hidden = false;
  }

  // ---------- Construção da interface ----------

  function buildGrid() {
    const headRow = h('tr', null, h('th', { class: 'corner', title: 'Selecionar tudo' }));
    for (let c = 0; c < COLS; c++) {
      const th = h('th', { class: 'col-head', 'data-c': c }, F.colName(c));
      colHeads.push(th);
      headRow.append(th);
    }
    const tbody = h('tbody');
    for (let r = 0; r < ROWS; r++) {
      const th = h('th', { class: 'row-head', 'data-r': r }, r + 1);
      rowHeads.push(th);
      const tr = h('tr', null, th);
      const rowTds = [];
      for (let c = 0; c < COLS; c++) {
        const td = h('td', { 'data-r': r, 'data-c': c });
        rowTds.push(td);
        tr.append(td);
      }
      tds.push(rowTds);
      tbody.append(tr);
    }
    return h('table', { class: 'grid' }, h('thead', null, headRow), tbody);
  }

  function onMouseDown(e) {
    const cell = e.target.closest('td, th');
    if (!cell || e.button !== 0) return;
    if (editing) stopEdit(true);
    e.preventDefault();
    wrap.focus({ preventScroll: true });
    if (cell.classList.contains('corner')) {
      cur = { r: 0, c: 0 };
      end = { r: ROWS - 1, c: COLS - 1 };
      paintSelection(false);
    } else if (cell.classList.contains('col-head')) {
      const c = Number(cell.dataset.c);
      cur = { r: 0, c };
      end = { r: ROWS - 1, c };
      paintSelection(false);
    } else if (cell.classList.contains('row-head')) {
      const r = Number(cell.dataset.r);
      cur = { r, c: 0 };
      end = { r, c: COLS - 1 };
      paintSelection(false);
    } else {
      select(Number(cell.dataset.r), Number(cell.dataset.c), e.shiftKey);
      dragging = true;
    }
  }

  function onKeyDown(e) {
    if (editing || e.target !== wrap) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key;
    const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };

    if (moves[key]) {
      moveBy(moves[key][0], moves[key][1], e.shiftKey);
    } else if (key === 'Enter') {
      moveBy(e.shiftKey ? -1 : 1, 0, false);
    } else if (key === 'Tab') {
      moveBy(0, e.shiftKey ? -1 : 1, false);
    } else if (key === 'Home') {
      select(mod ? 0 : cur.r, 0, false);
    } else if (key === 'PageDown' || key === 'PageUp') {
      moveBy(key === 'PageDown' ? 20 : -20, 0, e.shiftKey);
    } else if (key === 'Delete' || key === 'Backspace') {
      clearRange();
    } else if (key === 'F2') {
      startEdit();
    } else if (mod && !e.altKey) {
      const k = key.toLowerCase();
      if (k === 'z' && !e.shiftKey) timeTravel(undoStack, redoStack);
      else if (k === 'y' || (k === 'z' && e.shiftKey)) timeTravel(redoStack, undoStack);
      else if (k === 'b') toggleStyle('b');
      else if (k === 'i') toggleStyle('i');
      else if (k === 'a') {
        cur = { r: 0, c: 0 };
        end = { r: ROWS - 1, c: COLS - 1 };
        paintSelection(false);
      } else return;
    } else if (key.length === 1 && !e.altKey) {
      // Escrever numa célula começa a edição; a tecla vai parar ao editor que acabou de receber o foco.
      startEdit('');
      return;
    } else {
      return;
    }
    e.preventDefault();
  }

  function buildRibbon() {
    tableRow = h('div', { class: 'theme-gallery' });
    themeRow = h('div', { class: 'theme-gallery' }, T.gallery((t) => {
      setTheme(t);
      ctx.dirty();
    }));
    const formatSelect = h(
      'select',
      { class: 'tool-select', title: 'Formato do número', 'aria-label': 'Formato do número' },
      [['', 'Geral'], ['num2', 'Número (0,00)'], ['eur', 'Moeda (€)'], ['pct', 'Percentagem']].map(([value, label]) => h('option', { value }, label))
    );
    formatSelect.addEventListener('change', () => {
      applyStyle('f', formatSelect.value);
      wrap.focus({ preventScroll: true });
    });
    return MO.ribbon(
      [
        {
          label: 'Base',
          groups: [
            {
              label: 'Anular',
              rows: [
                [iconButton('undo', 'Anular (Ctrl+Z)', () => timeTravel(undoStack, redoStack))],
                [iconButton('redo', 'Refazer (Ctrl+Y)', () => timeTravel(redoStack, undoStack))]
              ]
            },
            {
              label: 'Tipo de letra',
              rows: [
                [toolButton('N', 'Negrito (Ctrl+B)', () => toggleStyle('b'), 'bold'), toolButton('I', 'Itálico (Ctrl+I)', () => toggleStyle('i'), 'italic')],
                [
                  colorButton('A', 'Cor do texto', '#c62828', () => {}, (v) => applyStyle('c', v), PICKER),
                  colorButton('ab', 'Cor de preenchimento', '#fff3a3', () => {}, (v) => applyStyle('bg', v), PICKER)
                ]
              ]
            },
            {
              label: 'Número',
              rows: [[formatSelect]]
            },
            {
              label: 'Alinhamento',
              rows: [
                [
                  iconButton('alignLeft', 'Alinhar à esquerda', () => applyStyle('a', 'left')),
                  iconButton('alignCenter', 'Centrar', () => applyStyle('a', 'center')),
                  iconButton('alignRight', 'Alinhar à direita', () => applyStyle('a', 'right'))
                ]
              ]
            },
            { label: 'Formatar como tabela', rows: [tableRow] },
            {
              label: 'Edição',
              rows: [
                [
                  bigButton('sum', 'Soma', 'Soma automática', () => autoFn('SOMA')),
                  bigButton('eraser', 'Limpar formato', 'Limpar formatação das células selecionadas', clearFormat),
                  bigButton('trash', 'Limpar', 'Apagar o conteúdo das células selecionadas (Delete)', clearRange)
                ]
              ]
            }
          ]
        },
        {
          label: 'Esquema de página',
          groups: [{ label: 'Temas', rows: [themeRow] }]
        },
        {
          label: 'Fórmulas',
          groups: [
            {
              label: 'Biblioteca de funções',
              rows: [
                [
                  bigButton('sum', 'Soma', 'Inserir SOMA', () => autoFn('SOMA')),
                  bigButton('average', 'Média', 'Inserir MÉDIA', () => autoFn('MÉDIA')),
                  bigButton('count', 'Contar', 'Inserir CONTAR', () => autoFn('CONTAR')),
                  bigButton('max', 'Máximo', 'Inserir MÁXIMO', () => autoFn('MÁXIMO')),
                  bigButton('min', 'Mínimo', 'Inserir MÍNIMO', () => autoFn('MÍNIMO')),
                  bigButton('branch', 'Se', 'Inserir SE(condição; valor se verdadeiro; valor se falso)', () => insertFn('=SE(')),
                  bigButton('sum', 'Soma.Se', 'Inserir SOMA.SE(intervalo; critério; intervalo a somar)', () => insertFn('=SOMA.SE(')),
                  bigButton('count', 'Contar.Se', 'Inserir CONTAR.SE(intervalo; critério)', () => insertFn('=CONTAR.SE(')),
                  bigButton('lookup', 'ProcV', 'Inserir PROCV(valor; tabela; coluna; FALSO)', () => insertFn('=PROCV('))
                ]
              ]
            }
          ]
        },
        {
          label: 'Dados',
          groups: [
            {
              label: 'Ordenar',
              rows: [
                [
                  bigButton('sortAsc', 'Ascendente', 'Ordenar a seleção por ordem ascendente', () => sortRange(false)),
                  bigButton('sortDesc', 'Descendente', 'Ordenar a seleção por ordem descendente', () => sortRange(true)),
                  bigButton('filter', 'Filtrar', 'Filtrar as linhas da seleção pela coluna ativa', filterSelection),
                  bigButton('filter', 'Limpar filtro', 'Mostrar novamente todas as linhas', clearFilter),
                  bigButton('chart', 'Gráfico', 'Criar gráfico a partir da seleção', openChart),
                  bigButton('sparkle', 'Analisar com IA', 'Analisar os dados selecionados com IA local', aiAnalyseSelection)
                ]
              ]
            }
          ]
        }
      ],
      () => ctx.file()
    );
  }

  MO.modules.sheets = {
    id: 'sheets',
    label: 'Folhas',
    ext: 'mosheet',
    filterName: 'Folha de cálculo MyOffice',
    defaultName: 'Folha',

    init(container, context) {
      ctx = context;
      nameBox = h('div', { class: 'name-box', title: 'Célula ativa' });
      fxInput = h('input', { class: 'fx-input', type: 'text', spellcheck: 'false', 'aria-label': 'Conteúdo da célula', placeholder: 'Valor ou fórmula, por exemplo =SOMA(A1:A5)' });
      editorEl = h('input', { class: 'cell-editor', type: 'text', spellcheck: 'false', 'aria-label': 'Editar célula' });
      const table = buildGrid();
      gridEl = table;
      wrap = h('div', { class: 'sheet-wrap', tabindex: '0', 'aria-label': 'Folha de cálculo' }, h('div', { class: 'sheet-inner' }, table, editorEl));
      statusEl = h('span', { class: 'status-text' });
      const ribbon = buildRibbon();
      sheetBar = h('div', { class: 'sheet-tabs', role: 'tablist', 'aria-label': 'Folhas do livro' });
      const inner = wrap.firstChild;
      const bar = h('div', { class: 'statusbar' }, statusEl, MO.zoomControl((k) => (inner.style.zoom = k)));
      showStates = MO.toolStates(ribbon, { Negrito: 'b', 'Itálico': 'i', 'Alinhar à esquerda': 'left', Centrar: 'center', 'Alinhar à direita': 'right' });
      container.append(ribbon, h('div', { class: 'fx-bar' }, nameBox, h('span', { class: 'fx-label' }, 'fx'), fxInput), sheetBar, wrap, bar);
      resetWorkbook();

      table.addEventListener('mousedown', onMouseDown);
      table.addEventListener('mouseover', (e) => {
        if (!dragging) return;
        const td = e.target.closest('td');
        if (td) select(Number(td.dataset.r), Number(td.dataset.c), true);
      });
      window.addEventListener('mouseup', () => (dragging = false));
      table.addEventListener('dblclick', (e) => {
        if (e.target.closest('td')) startEdit();
      });

      wrap.addEventListener('keydown', onKeyDown);
      wrap.addEventListener('copy', (e) => copy(e, false));
      wrap.addEventListener('cut', (e) => copy(e, true));
      wrap.addEventListener('paste', paste);

      editorEl.addEventListener('keydown', editKey);
      editorEl.addEventListener('input', () => (fxInput.value = editorEl.value));
      editorEl.addEventListener('blur', () => stopEdit(true));

      fxInput.addEventListener('focus', () => {
        if (!editing) startEdit(null, true);
      });
      fxInput.addEventListener('keydown', editKey);
      fxInput.addEventListener('blur', () => {
        if (editing && editing.viaBar) stopEdit(true);
      });
    },

    newDoc(template) {
      for (const a of drawn.keys()) drawn.set(a, null); // força o redesenho completo
      editing = null;
      editorEl.style.display = 'none';
      cells = {};
      resetWorkbook();
      undoStack = [];
      redoStack = [];
      clip = null;
      cur = { r: 0, c: 0 };
      end = { r: 0, c: 0 };
      setTheme(T.LIST[0]);
      if (template === 'budget') {
        const headers = ['Categoria', 'Orçamento (€)', 'Real (€)', 'Saldo (€)'];
        headers.forEach((v, c) => (cells[F.addr(0, c)] = { v, s: { b: 1, bg: '#e8e5ff' } }));
        const rows = [
          ['Habitação', '850', '820'],
          ['Alimentação', '250', '278'],
          ['Transportes', '100', '84'],
          ['Lazer', '120', '96'],
          ['Saúde', '60', '35'],
          ['Outros', '80', '60']
        ];
        rows.forEach((row, r) => {
          row.forEach((v, col) => (cells[F.addr(r + 1, col)] = { v }));
          cells[F.addr(r + 1, 3)] = { v: `=B${r + 2}-C${r + 2}` };
        });
        cells.A8 = { v: 'TOTAL', s: { b: 1, bg: '#e8e5ff' } };
        cells.B8 = { v: '=SOMA(B2:B7)', s: { b: 1 } };
        cells.C8 = { v: '=SOMA(C2:C7)', s: { b: 1 } };
        cells.D8 = { v: '=B8-C8', s: { b: 1 } };
      } else if (template === 'tasks') {
        const rows = [
          ['Tarefa', 'Responsável', 'Prioridade', 'Estado'],
          ['Definir objetivos', '[Nome]', 'Alta', 'Por iniciar'],
          ['Preparar recursos', '[Nome]', 'Média', 'Em curso'],
          ['Rever resultados', '[Nome]', 'Baixa', 'Por iniciar']
        ];
        rows.forEach((row, r) => row.forEach((v, col) => {
          cells[F.addr(r, col)] = { v, ...(r === 0 ? { s: { b: 1, bg: '#dff3eb' } } : {}) };
        }));
      }
      refresh();
    },

    serialize() {
      if (editing) stopEdit(true);
      snapshotSheet();
      return JSON.stringify({ format: 'myoffice-sheet', version: 2, theme: theme.id, activeSheetId, sheets: workbookSheets });
    },

    load(text, ext) {
      let next = {};
      let nextTheme = T.LIST[0];
      let clipped = false;
      if (ext === 'xlsx') {
        const book = MO.OOXML.importXlsx(text, ROWS, COLS);
        next = cleanCells(book.cells);
        clipped = book.clipped;
      } else if (ext === 'csv') {
        parseCSV(text).forEach((row, r) =>
          row.forEach((value, c) => {
            if (r < ROWS && c < COLS && value !== '') next[F.addr(r, c)] = { v: value.slice(0, MAX_CELL_CHARS) };
          })
        );
      } else {
        const data = JSON.parse(text);
        if (!data || data.format !== 'myoffice-sheet') throw new Error('Formato inválido');
        nextTheme = T.byId(data.theme);
        if (data.version >= 2 && Array.isArray(data.sheets) && data.sheets.length) {
          const used = new Set();
          workbookSheets = data.sheets.slice(0, 100).map((s, i) => {
            let name = String(s.name || `Folha${i + 1}`).trim().slice(0, 31) || `Folha${i + 1}`;
            if (used.has(name.toLocaleLowerCase('pt-PT'))) name = `Folha${i + 1}`;
            used.add(name.toLocaleLowerCase('pt-PT'));
            return { id: String(s.id || `sheet-${i + 1}`), name, cells: cleanCells(s.cells) };
          });
          activeSheetId = workbookSheets.some((s) => s.id === data.activeSheetId) ? data.activeSheetId : workbookSheets[0].id;
          next = workbookSheets.find((s) => s.id === activeSheetId).cells;
          nextSheetNumber = workbookSheets.length + 1;
        } else {
          next = cleanCells(data.cells);
          workbookSheets = [{ id: 'sheet-1', name: 'Folha1', cells: next }];
          activeSheetId = 'sheet-1';
          nextSheetNumber = 2;
        }
      }
      this.newDoc();
      setTheme(nextTheme);
      if (clipped) MO.toast(`O livro tem dados fora de ${ROWS} linhas × ${COLS} colunas; essa parte não foi importada.`);
      if (ext === 'xlsx' || ext === 'csv') resetWorkbook(next);
      else {
        cells = next;
        renderSheetTabs();
      }
      refresh();
    },

    exports: [
      {
        label: 'Livro do Excel (.xlsx)',
        ext: 'xlsx',
        filterName: 'Livro do Excel',
        mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        get: () => {
          if (editing) stopEdit(true);
          return MO.OOXML.exportXlsx(cells, values);
        }
      },
      { label: 'Valores separados por ; (.csv)', ext: 'csv', filterName: 'CSV', mime: 'text/csv', get: toCSV }
    ],

    print() {
      if (editing) stopEdit(true);
      const { maxR, maxC } = usedBounds();
      const table = h('table', { class: 'print-sheet' });
      for (let r = 0; r <= maxR; r++) {
        const tr = h('tr');
        for (let c = 0; c <= maxC; c++) {
          const src = tds[r][c];
          const td = h('td', null, src.textContent);
          td.style.cssText = src.style.cssText;
          if (src.classList.contains('num') && !src.style.textAlign) td.style.textAlign = 'right';
          tr.append(td);
        }
        table.append(tr);
      }
      return { node: table, page: 'A4 landscape', margin: '12mm' };
    },

    show() {
      wrap.focus({ preventScroll: true });
    }
  };
})();
