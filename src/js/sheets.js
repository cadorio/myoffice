'use strict';

// Módulo "Folhas": folha de cálculo.
(function () {
  const MO = window.MO;
  const F = MO.Formula;
  const { h, toolButton, colorButton, iconButton, bigButton } = MO;

  // Limites práticos do editor. A grelha só cria no DOM as linhas visíveis.
  const ROWS = 100000;
  const COLS = 256;
  const ROW_HEIGHT = 26;
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
  let values = new Map();
  let cellsByRow = new Map();
  let tds = new Map();
  let colHeads = [];
  let rowHeads = new Map();
  let tbodyEl, topSpacer, bottomSpacer, sheetTabs;
  let sheetList = [{ name: 'Folha1', cells: {} }];
  let activeSheet = 0;
  const filteredRows = new Set();
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

  // Propriedades da folha ativa que não são células: células unidas, larguras, painéis fixos, regras.
  const meta = () => sheetList[activeSheet] || (sheetList[activeSheet] = { name: 'Folha1', cells });
  const DEFAULT_WIDTH = 104;
  const widthOf = (c) => (meta().widths && meta().widths[c]) || DEFAULT_WIDTH;

  function snapshotState() {
    const m = meta();
    return JSON.stringify({ cells, pivots: m.pivots || [], merges: m.merges || [], widths: m.widths || {}, freeze: m.freeze || null, rules: m.rules || [] });
  }

  function restoreState(state) {
    cells = state.cells || state;
    const m = meta();
    if (!state.cells) return;
    m.pivots = state.pivots || [];
    m.merges = state.merges || [];
    m.widths = state.widths || {};
    m.freeze = state.freeze || null;
    m.rules = state.rules || [];
    applyColumnWidths();
  }

  function mutate(fn) {
    undoStack.push(snapshotState());
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack = [];
    fn();
    refresh();
    ctx.dirty();
  }

  function timeTravel(from, to) {
    if (!from.length) return;
    to.push(snapshotState());
    restoreState(JSON.parse(from.pop()));
    refresh();
    ctx.dirty();
  }

  function cleanCells(input) {
    const out = {};
    if (!input || typeof input !== 'object') return out;
    for (const [a, cell] of Object.entries(input)) {
      const pos = /^[A-Z]{1,3}\d{1,7}$/.test(a) ? F.parseAddr(a) : null;
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
        if (typeof cell.s.bd === 'string' && /^[tblr]{1,4}$/.test(cell.s.bd)) s.bd = cell.s.bd;
        if (Object.keys(s).length) clean.s = s;
      }
      if (clean.v !== '' || clean.s) out[a] = clean;
    }
    return out;
  }

  // ---------- Desenho ----------

  function paintCell(a) {
    const pos = F.parseAddr(a);
    const row = tds.get(pos.r);
    const td = row && row[pos.c];
    if (!td) return;
    const cell = cells[a];
    const v = cell ? values.get(a) : null;
    const s = (cell && cell.s) || {};
    const text = typeof v === 'number' && Object.hasOwn(NUMBER_FORMATS, s.f) ? NUMBER_FORMATS[s.f].format(v) : F.format(v);
    const kind = typeof v === 'number' ? 'n' : typeof v === 'boolean' ? 'b' : v instanceof F.FError ? 'e' : '';
    const rule = ruleStyle(pos.r, pos.c, v);
    const bg = rule.bg || s.bg || '';
    const color = rule.c || s.c || '';
    const key = `${text}\u0000${kind}\u0000${s.b || ''}${s.i || ''}\u0000${s.a || ''}\u0000${bg}\u0000${color}\u0000${s.bd || ''}`;
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
    td.style.backgroundColor = bg;
    td.style.color = color;
    // As bordas são sombras interiores, para não mudarem o tamanho da célula nem esconderem a seleção.
    const side = { t: 'inset 0 1.5px 0 var(--cell-border)', b: 'inset 0 -1.5px 0 var(--cell-border)', l: 'inset 1.5px 0 0 var(--cell-border)', r: 'inset -1.5px 0 0 var(--cell-border)' };
    if (s.bd) td.style.setProperty('--bd', [...s.bd].map((k) => side[k]).join(', '));
    else td.style.removeProperty('--bd');
  }

  // ---------- Formatação condicional ----------

  const RULE_TYPES = { gt: 'Maior que', lt: 'Menor que', between: 'Entre', eq: 'Igual a', text: 'O texto contém', scale: 'Escala de cores' };
  const RULE_COLORS = {
    green: { name: 'Verde', bg: '#c6efce', c: '#006100' },
    red: { name: 'Vermelho', bg: '#ffc7ce', c: '#9c0006' },
    yellow: { name: 'Amarelo', bg: '#ffeb9c', c: '#9c5700' },
    blue: { name: 'Azul', bg: '#dbe8fb', c: '#1f4e8c' }
  };
  let ruleStats = [];

  const inRange = (rg, r, c) => r >= rg.r0 && r <= rg.r1 && c >= rg.c0 && c <= rg.c1;
  const toNum = (x) => F.parseNumber(String(x ?? ''));

  // Mínimo e máximo de cada escala de cores, calculados uma vez por atualização.
  function computeRuleStats() {
    ruleStats = (meta().rules || []).map((rule) => {
      if (rule.type !== 'scale') return null;
      let min = Infinity;
      let max = -Infinity;
      for (const a of Object.keys(cells)) {
        const pos = F.parseAddr(a);
        const v = values.get(a);
        if (!pos || typeof v !== 'number' || !inRange(rule.range, pos.r, pos.c)) continue;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      return { min, max };
    });
  }

  const mixHex = (x, y, t) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(x.slice(i, i + 2), 16) + (parseInt(y.slice(i, i + 2), 16) - parseInt(x.slice(i, i + 2), 16)) * t).toString(16).padStart(2, '0')).join('');

  // Cores impostas pelas regras para uma célula; a primeira regra que se aplica ganha.
  function ruleStyle(r, c, v) {
    const rules = meta().rules;
    if (!rules || !rules.length) return {};
    for (const [i, rule] of rules.entries()) {
      if (!inRange(rule.range, r, c) || v == null || v === '') continue;
      const n = typeof v === 'number' ? v : null;
      const a = toNum(rule.a);
      const b = toNum(rule.b);
      let hit = false;
      if (rule.type === 'scale') {
        const st = ruleStats[i];
        if (n === null || !st || !(st.max > st.min)) continue;
        const t = (n - st.min) / (st.max - st.min);
        return { bg: t < 0.5 ? mixHex('#f8696b', '#ffeb84', t * 2) : mixHex('#ffeb84', '#63be7b', (t - 0.5) * 2) };
      }
      if (rule.type === 'gt') hit = n !== null && a !== null && n > a;
      else if (rule.type === 'lt') hit = n !== null && a !== null && n < a;
      else if (rule.type === 'between') hit = n !== null && a !== null && b !== null && n >= Math.min(a, b) && n <= Math.max(a, b);
      else if (rule.type === 'eq') hit = n !== null && a !== null ? n === a : F.format(v).toLocaleLowerCase('pt-PT') === String(rule.a).toLocaleLowerCase('pt-PT');
      else if (rule.type === 'text') hit = Boolean(rule.a) && F.format(v).toLocaleLowerCase('pt-PT').includes(String(rule.a).toLocaleLowerCase('pt-PT'));
      if (hit) return { bg: rule.bg, c: rule.c };
    }
    return {};
  }

  function conditionalDialog() {
    const sel = range();
    const type = h('select', { id: 'cf-type' }, Object.entries(RULE_TYPES).map(([value, label]) => h('option', { value }, label)));
    const a = h('input', { id: 'cf-a', type: 'text', placeholder: 'Ex.: 100' });
    const b = h('input', { id: 'cf-b', type: 'text', placeholder: 'Ex.: 500' });
    const color = h('select', { id: 'cf-color' }, Object.entries(RULE_COLORS).map(([value, item]) => h('option', { value }, item.name)));
    const labelB = h('label', null, h('span', null, 'E'), b);
    const labelA = h('label', null, h('span', null, 'Valor'), a);
    const labelColor = h('label', null, h('span', null, 'Cor'), color);
    const sync = () => {
      labelB.hidden = type.value !== 'between';
      labelA.hidden = type.value === 'scale';
      labelColor.hidden = type.value === 'scale';
    };
    type.addEventListener('change', sync);
    const dlg = h('dialog', { class: 'mo-dialog' },
      h('form', { method: 'dialog' },
        h('h2', null, 'Formatação condicional'),
        h('p', null, `Realçar células em ${F.addr(sel.r0, sel.c0)}:${F.addr(sel.r1, sel.c1)} conforme o valor.`),
        h('label', null, h('span', null, 'Regra'), type), labelA, labelB, labelColor,
        h('div', { class: 'dialog-actions' },
          h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Cancelar'),
          h('button', { type: 'submit', class: 'btn primary' }, 'Aplicar'))));
    dlg.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      if (type.value !== 'scale' && !a.value.trim()) return a.focus();
      const preset = RULE_COLORS[color.value];
      const rule = { range: sel, type: type.value, a: a.value.trim(), b: b.value.trim() };
      if (type.value !== 'scale') Object.assign(rule, { bg: preset.bg, c: preset.c });
      mutate(() => (meta().rules = [...(meta().rules || []), rule]));
      dlg.close();
      MO.toast('Regra aplicada.');
    });
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    sync();
    dlg.showModal();
  }

  function clearRules() {
    const sel = range();
    const overlaps = (rg) => !(rg.r1 < sel.r0 || rg.r0 > sel.r1 || rg.c1 < sel.c0 || rg.c0 > sel.c1);
    const before = (meta().rules || []).length;
    mutate(() => (meta().rules = (meta().rules || []).filter((rule) => !overlaps(rule.range))));
    MO.toast(before === (meta().rules || []).length ? 'A seleção não tem regras.' : 'Regras removidas da seleção.');
  }

  // ---------- Bordas ----------

  function applyBorders(kind) {
    const { r0, r1, c0, c1 } = range();
    if ((r1 - r0 + 1) * (c1 - c0 + 1) > 200000) return MO.toast('Selecione uma área mais pequena.');
    mutate(() => eachInRange((r, c, a) => {
      const now = new Set((cells[a] && cells[a].s && cells[a].s.bd) || '');
      if (kind === 'none') now.clear();
      else if (kind === 'all') ['t', 'b', 'l', 'r'].forEach((k) => now.add(k));
      else if (kind === 'bottom') { if (r === r1) now.add('b'); }
      else if (kind === 'outer') {
        if (r === r0) now.add('t');
        if (r === r1) now.add('b');
        if (c === c0) now.add('l');
        if (c === c1) now.add('r');
      }
      const bd = ['t', 'b', 'l', 'r'].filter((k) => now.has(k)).join('');
      if (bd || (cells[a] && cells[a].s && cells[a].s.bd)) setStyle(a, 'bd', bd);
    }));
  }

  // ---------- Unir células ----------

  const mergeAt = (r, c) => (meta().merges || []).find((m) => inRange(m, r, c)) || null;

  function mergeCells(center) {
    const sel = range();
    if (sel.r0 === sel.r1 && sel.c0 === sel.c1) return MO.toast('Selecione duas ou mais células para unir.');
    const lost = [];
    eachInRange((r, c, a) => {
      if ((r !== sel.r0 || c !== sel.c0) && rawOf(a) !== '') lost.push(a);
    });
    mutate(() => {
      // Como no Excel, só fica o valor da célula do canto superior esquerdo.
      for (const a of lost) setRaw(a, '');
      const overlaps = (m) => !(m.r1 < sel.r0 || m.r0 > sel.r1 || m.c1 < sel.c0 || m.c0 > sel.c1);
      meta().merges = [...(meta().merges || []).filter((m) => !overlaps(m)), { ...sel }];
      if (center) setStyle(F.addr(sel.r0, sel.c0), 'a', 'center');
    });
    end = { ...cur };
    if (lost.length) MO.toast('Só foi mantido o valor da primeira célula. Pode anular com Ctrl+Z.');
  }

  function unmergeCells() {
    const sel = range();
    const overlaps = (m) => !(m.r1 < sel.r0 || m.r0 > sel.r1 || m.c1 < sel.c0 || m.c0 > sel.c1);
    if (!(meta().merges || []).some(overlaps)) return MO.toast('A seleção não tem células unidas.');
    mutate(() => (meta().merges = (meta().merges || []).filter((m) => !overlaps(m))));
  }

  // ---------- Fixar painéis ----------

  function setFreeze(rows, cols) {
    mutate(() => (meta().freeze = rows || cols ? { rows: Math.min(50, rows), cols: Math.min(20, cols) } : null));
    MO.toast(rows || cols ? `Fixad${rows && cols ? 'as' : rows ? (rows === 1 ? 'a' : 'as') : (cols === 1 ? 'a' : 'as')} ${[rows ? `${rows} linha${rows > 1 ? 's' : ''}` : '', cols ? `${cols} coluna${cols > 1 ? 's' : ''}` : ''].filter(Boolean).join(' e ')}.` : 'Painéis libertados.');
  }

  // ---------- Largura das colunas ----------

  let colEls = [];
  let tableEl = null;

  function applyColumnWidths() {
    if (!tableEl) return;
    let total = 46;
    for (let c = 0; c < COLS; c++) {
      const w = widthOf(c);
      total += w;
      if (colEls[c]) colEls[c].style.width = w + 'px';
    }
    tableEl.style.width = total + 'px';
  }

  // Ajusta a largura da coluna ao conteúdo mais comprido (duplo clique na margem do cabeçalho).
  function autofitColumn(c) {
    const probe = h('span', { style: { position: 'absolute', visibility: 'hidden', whiteSpace: 'nowrap', font: getComputedStyle(tableEl).font } });
    document.body.append(probe);
    let best = 40;
    for (const a of Object.keys(cells)) {
      const pos = F.parseAddr(a);
      if (!pos || pos.c !== c) continue;
      probe.textContent = F.format(values.get(a));
      best = Math.max(best, probe.offsetWidth + 18);
    }
    probe.remove();
    mutate(() => {
      meta().widths = { ...(meta().widths || {}) };
      meta().widths[c] = Math.min(600, best);
    });
  }

  // ---------- Preenchimento automático (arrastar a pega da seleção) ----------

  const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const DAYS = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];
  const NAME_LISTS = [MONTHS, MONTHS_SHORT, DAYS];
  const fmtNum = (n) => String(Number(n.toFixed(10))).replace('.', ',');

  // Gera os valores seguintes de uma série: números, «Item 1», meses, dias da semana; o resto repete-se.
  function seriesNext(src, k) {
    const raws = src.map((x) => x.raw);
    const plainText = raws.every((v) => v !== '' && v[0] !== '=');
    if (plainText) {
      const nums = raws.map((v) => F.parseNumber(v));
      if (src.length >= 2 && nums.every((n) => n !== null)) {
        const step = (nums[nums.length - 1] - nums[0]) / (nums.length - 1);
        return fmtNum(nums[nums.length - 1] + step * (k + 1));
      }
      const tails = raws.map((v) => /^(.*?)(\d+)$/.exec(v));
      if (tails.every((m) => m && m[1] === tails[0][1] && m[1] !== '')) {
        const ns = tails.map((m) => Number(m[2]));
        const step = ns.length >= 2 ? (ns[ns.length - 1] - ns[0]) / (ns.length - 1) : 1;
        return tails[0][1] + Math.round(ns[ns.length - 1] + step * (k + 1));
      }
      for (const list of NAME_LISTS) {
        const idx = raws.map((v) => list.indexOf(v.toLocaleLowerCase('pt-PT')));
        if (idx.every((i) => i >= 0)) {
          const name = list[(idx[idx.length - 1] + k + 1) % list.length];
          const first = raws[raws.length - 1];
          return first[0] === first[0].toLocaleUpperCase('pt-PT') ? name[0].toLocaleUpperCase('pt-PT') + name.slice(1) : name;
        }
      }
    }
    return null;
  }

  function applyFill(src, target) {
    const down = target.r1 > src.r1;
    const count = down ? target.r1 - src.r1 : target.c1 - src.c1;
    if (count <= 0) return;
    if (count * (down ? src.c1 - src.c0 + 1 : src.r1 - src.r0 + 1) > 200000) return MO.toast('Área demasiado grande para preencher.');
    mutate(() => {
      const lanes = down ? src.c1 - src.c0 + 1 : src.r1 - src.r0 + 1;
      for (let lane = 0; lane < lanes; lane++) {
        const seq = [];
        const len = down ? src.r1 - src.r0 + 1 : src.c1 - src.c0 + 1;
        for (let i = 0; i < len; i++) {
          const r = down ? src.r0 + i : src.r0 + lane;
          const c = down ? src.c0 + lane : src.c0 + i;
          const a = F.addr(r, c);
          seq.push({ r, c, raw: rawOf(a), s: cells[a] && cells[a].s });
        }
        for (let k = 0; k < count; k++) {
          const r = down ? src.r1 + 1 + k : src.r0 + lane;
          const c = down ? src.c0 + lane : src.c1 + 1 + k;
          const base = seq[k % seq.length];
          const next = seriesNext(seq, k);
          const raw = next !== null ? next : base.raw[0] === '=' ? F.shiftFormula(base.raw, r - base.r, c - base.c, ROWS, COLS) : base.raw;
          const a = F.addr(r, c);
          if (raw === '' && !base.s) delete cells[a];
          else cells[a] = base.s ? { v: raw, s: { ...base.s } } : { v: raw };
        }
      }
    });
  }

  function refresh() {
    rebuildPivotTables();
    values = F.compute(cells, ROWS, COLS);
    computeRuleStats();
    applyColumnWidths();
    cellsByRow = new Map();
    for (const a of Object.keys(cells)) {
      const pos = F.parseAddr(a);
      if (!pos || pos.r >= ROWS || pos.c >= COLS) continue;
      if (!cellsByRow.has(pos.r)) cellsByRow.set(pos.r, []);
      cellsByRow.get(pos.r).push(a);
    }
    const start = visibleStart();
    const endRow = Math.min(ROWS, start + visibleCount());
    for (const r of [...tds.keys()]) if (r < start || r >= endRow) tds.delete(r);
    renderWindow();
    painted = new Set(Object.keys(cells));
    paintSelection(false);
  }

  function rebuildPivotTables() {
    const configs = sheetList[activeSheet]?.pivots || [];
    if (!configs.length) return;
    const sourceValues = F.compute(cells, ROWS, COLS);
    for (const pivot of configs) {
      const { r0, r1, c0, c1 } = pivot.range;
      const categories = new Map();
      for (let r = r0 + 1; r <= r1; r++) {
        const value = sourceValues.get(F.addr(r, c0));
        if (value == null || value === '' || value instanceof F.FError) continue;
        const key = `${typeof value}:${String(value)}`;
        if (!categories.has(key)) categories.set(key, value);
      }
      for (let r = 0; r < (pivot.rows || 0); r++) for (let c = 0; c < 4; c++) delete cells[F.addr(pivot.outRow + r, pivot.outCol + c)];
      const headers = ['Categoria', 'Soma', 'Contagem', 'Média'];
      headers.forEach((label, c) => { const a = F.addr(pivot.outRow, pivot.outCol + c); cells[a] = { v: label, s: { b: 1, bg: '#dff3eb' } }; });
      const categoryRange = `$${F.colName(c0)}$${r0 + 2}:$${F.colName(c0)}$${r1 + 1}`;
      const valueRange = `$${F.colName(c1)}$${r0 + 2}:$${F.colName(c1)}$${r1 + 1}`;
      let row = pivot.outRow + 1;
      for (const value of categories.values()) {
        const categoryCell = F.addr(row, pivot.outCol);
        cells[categoryCell] = { v: typeof value === 'string' && /^[=+\-@']/.test(value) ? `'${value}` : String(value) };
        cells[F.addr(row, pivot.outCol + 1)] = { v: `=SOMA.SE(${categoryRange};${categoryCell};${valueRange})` };
        cells[F.addr(row, pivot.outCol + 2)] = { v: `=CONTAR.SE(${categoryRange};${categoryCell})` };
        cells[F.addr(row, pivot.outCol + 3)] = { v: `=MÉDIA.SE(${categoryRange};${categoryCell};${valueRange})` };
        row++;
      }
      pivot.rows = row - pivot.outRow;
    }
  }

  function createPivotTable() {
    if (editing) stopEdit(true);
    const selectedRange = { ...range() };
    if (selectedRange.r1 <= selectedRange.r0 || selectedRange.c1 <= selectedRange.c0) return MO.toast('Selecione cabeçalhos e pelo menos duas colunas: categoria e valores.');
    const used = usedBounds();
    const outCol = Math.max(selectedRange.c1, used.maxC) + 2;
    if (outCol + 3 >= COLS) return MO.toast('Não há espaço à direita da folha para criar o resumo dinâmico.');
    const sheet = sheetList[activeSheet];
    sheet.pivots ||= [];
    if (sheet.pivots.length >= 10) return MO.toast('Este livro já tem o limite de 10 tabelas dinâmicas por folha.');
    const outRow = selectedRange.r0;
    const intersects = sheet.pivots.some((p) => outCol <= p.outCol + 3 && outCol + 3 >= p.outCol && outRow <= p.outRow + p.rows && outRow + 500 >= p.outRow);
    if (intersects) return MO.toast('O espaço de saída coincide com outra tabela dinâmica.');
    undoStack.push(JSON.stringify({ cells, pivots: sheet.pivots }));
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack = [];
    sheet.pivots.push({ range: selectedRange, outCol, outRow, rows: 0 });
    rebuildPivotTables();
    refresh();
    ctx.dirty();
    MO.toast('Resumo dinâmico criado. As fórmulas acompanham os dados; as categorias atualizam-se ao editar a origem.');
  }

  function visibleStart() {
    return Math.max(0, Math.floor(Math.max(0, wrap.scrollTop - 26) / ROW_HEIGHT) - 2);
  }

  function visibleCount() {
    return Math.ceil((wrap.clientHeight || 700) / ROW_HEIGHT) + 5;
  }

  function renderWindow() {
    if (!tbodyEl || !wrap) return;
    const fz = meta().freeze || { rows: 0, cols: 0 };
    const fr = Math.min(fz.rows || 0, ROWS);
    const fc = Math.min(fz.cols || 0, COLS);
    const start = Math.max(visibleStart(), fr);
    const count = visibleCount();
    const endRow = Math.min(ROWS, start + count);
    tds.clear(); rowHeads.clear();
    const children = [];
    const headH = tableEl && tableEl.tHead ? tableEl.tHead.offsetHeight : ROW_HEIGHT;
    // Posição horizontal fixa de cada coluna congelada.
    const lefts = [];
    let x = 46;
    for (let c = 0; c < fc; c++) { lefts.push(x); x += widthOf(c); }
    colHeads.forEach((th, c) => {
      th.classList.toggle('frz-c', c < fc);
      th.style.left = c < fc ? lefts[c] + 'px' : '';
    });
    const makeRow = (r, frozen) => {
      const th = h('th', { class: 'row-head', 'data-r': r }, r + 1);
      rowHeads.set(r, th);
      const tr = h('tr', { 'data-r': r, class: frozen ? 'frz-r' : null }, th);
      if (frozen) tr.style.setProperty('--frz-top', headH + r * ROW_HEIGHT + 'px');
      const rowTds = [];
      for (let c = 0; c < COLS; c++) {
        const td = h('td', { 'data-r': r, 'data-c': c });
        if (c < fc) { td.classList.add('frz-c'); td.style.left = lefts[c] + 'px'; }
        rowTds.push(td); tr.append(td);
      }
      tds.set(r, rowTds);
      return tr;
    };
    for (let r = 0; r < fr; r++) children.push(makeRow(r, true));
    topSpacer.firstChild.style.height = `${(start - fr) * ROW_HEIGHT}px`;
    children.push(topSpacer);
    for (let r = start; r < endRow; r++) children.push(makeRow(r, false));
    bottomSpacer.firstChild.style.height = `${Math.max(0, ROWS - endRow) * ROW_HEIGHT}px`;
    children.push(bottomSpacer);
    tbodyEl.replaceChildren(...children);
    // Pinta apenas células ocupadas dentro da janela atualmente visível.
    for (const r of tds.keys()) for (const a of cellsByRow.get(r) || []) { drawn.delete(a); paintCell(a); }
    for (const r of filteredRows) {
      const row = tds.get(r);
      if (row) row[0].parentElement.hidden = true;
    }
    // Células unidas: a do canto ocupa o espaço das outras dentro das linhas desenhadas.
    for (const m of meta().merges || []) {
      const anchorRow = tds.get(m.r0);
      if (!anchorRow) continue;
      const lastRow = m.r0 < fr ? Math.min(m.r1, fr - 1) : Math.min(m.r1, endRow - 1);
      const anchor = anchorRow[m.c0];
      anchor.colSpan = m.c1 - m.c0 + 1;
      anchor.rowSpan = lastRow - m.r0 + 1;
      anchor.classList.add('merged');
      for (let r = m.r0; r <= lastRow; r++) {
        const row = tds.get(r);
        if (!row) continue;
        for (let c = m.c0; c <= m.c1; c++) if (r !== m.r0 || c !== m.c0) row[c].hidden = true;
      }
    }
    placeFillHandle();
  }

  function paintSelection(scroll) {
    for (const el of selPainted) el.classList.remove('sel', 'cur', 'hot');
    selPainted = [];
    const { r0, r1, c0, c1 } = range();
    const firstVisible = visibleStart();
    const lastVisible = firstVisible + visibleCount();
    for (let r = Math.max(r0, firstVisible); r <= Math.min(r1, lastVisible - 1); r++) {
      for (let c = c0; c <= c1; c++) {
        const td = tds.get(r)?.[c];
        if (td) { td.classList.add('sel'); selPainted.push(td); }
      }
    }
    for (let c = c0; c <= c1; c++) {
      colHeads[c].classList.add('hot');
      selPainted.push(colHeads[c]);
    }
    for (let r = Math.max(r0, firstVisible); r <= Math.min(r1, lastVisible - 1); r++) {
      const head = rowHeads.get(r);
      if (head) { head.classList.add('hot'); selPainted.push(head); }
    }
    const activeTd = tds.get(cur.r)?.[cur.c];
    if (activeTd) activeTd.classList.add('cur');

    const single = r0 === r1 && c0 === c1;
    nameBox.textContent = single ? F.addr(cur.r, cur.c) : `${F.addr(r0, c0)}:${F.addr(r1, c1)}`;
    if (!editing) fxInput.value = rawOf(F.addr(cur.r, cur.c));
    if (scroll) {
      const td = tds.get(end.r)?.[end.c];
      if (td) td.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      else {
        wrap.scrollTop = Math.max(0, end.r * ROW_HEIGHT);
        renderWindow();
        paintSelection(false);
        tds.get(end.r)?.[end.c]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    }
    updateStatus(single);
    placeFillHandle();
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
    const { r0, r1, c0, c1 } = range();
    for (const a of Object.keys(cells)) {
      const pos = F.parseAddr(a);
      if (!pos || pos.r < r0 || pos.r > r1 || pos.c < c0 || pos.c > c1) continue;
      const v = values.get(a);
      if (typeof v === 'number') nums.push(v);
    }
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
    const m = !extend && mergeAt(r, c);
    if (m) { r = m.r0; c = m.c0; }
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
    const td = tds.get(cur.r)?.[cur.c];
    if (!td) { wrap.scrollTop = cur.r * ROW_HEIGHT; renderWindow(); }
    const target = tds.get(cur.r)?.[cur.c];
    Object.assign(editorEl.style, {
      display: 'block',
      left: target.offsetLeft + 'px',
      top: target.offsetTop + 'px',
      minWidth: target.offsetWidth + 1 + 'px',
      height: target.offsetHeight + 1 + 'px'
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
    const { r0, r1, c0, c1 } = range();
    mutate(() => {
      for (const a of Object.keys(cells)) {
        const pos = F.parseAddr(a);
        if (pos && pos.r >= r0 && pos.r <= r1 && pos.c >= c0 && pos.c <= c1) setRaw(a, '');
      }
    });
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
    const { r0, r1, c0, c1 } = range();
    mutate(() => {
      for (const a of Object.keys(cells)) {
        const pos = F.parseAddr(a);
        if (!pos || pos.r < r0 || pos.r > r1 || pos.c < c0 || pos.c > c1 || !cells[a]) continue;
        delete cells[a].s;
        if (cells[a].v === '') delete cells[a];
      }
    });
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
  let editingChart = null;

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
    const savedCharts = sheetList[activeSheet].charts || [];
    const picker = h('select', { class: 'tool-select', 'aria-label': 'Gráficos guardados' },
      h('option', { value: '' }, 'Nova seleção'),
      ...savedCharts.map((chart, index) => h('option', { value: String(index) }, chart.name))
    );
    picker.addEventListener('change', () => {
      editingChart = picker.value === '' ? null : Number(picker.value);
      if (editingChart !== null) {
        const chart = savedCharts[editingChart];
        chartRange = { ...chart.range };
        type.value = chart.type;
      } else chartRange = { ...range() };
      renderChart(type.value);
    });
    type.addEventListener('change', () => renderChart(type.value));
    const preview = h('div', { class: 'mo-chart-preview' });
    const close = () => { chartDialog.close(); chartDialog.remove(); chartDialog = null; chartRange = null; editingChart = null; };
    const saveChart = () => {
      const data = selectedChartData();
      if (!data) return MO.toast('Preencha os dados do intervalo antes de guardar o gráfico.');
      const sheet = sheetList[activeSheet];
      sheet.charts ||= [];
      const chart = { name: editingChart === null ? `Gráfico ${sheet.charts.length + 1}` : sheet.charts[editingChart].name, type: type.value, range: { ...chartRange } };
      if (editingChart === null) {
        sheet.charts.push(chart);
        editingChart = sheet.charts.length - 1;
        picker.append(h('option', { value: String(editingChart) }, chart.name));
      } else sheet.charts[editingChart] = chart;
      picker.value = String(editingChart);
      ctx.dirty();
      MO.toast('Gráfico guardado no livro.');
    };
    const exportSvg = () => {
      const svg = preview.querySelector('svg');
      if (!svg) return MO.toast('Não há gráfico para exportar.');
      const source = new XMLSerializer().serializeToString(svg);
      const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml;charset=utf-8' }));
      const a = h('a', { href: url, download: 'grafico-myoffice.svg' });
      document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    };
    chartDialog.append(
      h('header', { class: 'mo-chart-head' }, h('div', null, h('h2', { id: 'mo-chart-title' }, 'Gráficos do livro'), h('p', null, 'Os gráficos guardados acompanham este livro MyOffice.')), picker, type, h('button', { class: 'mo-chart-close', type: 'button', onclick: close, 'aria-label': 'Fechar' }, '×')),
      preview,
      h('p', { class: 'mo-chart-range' }),
      h('footer', { class: 'mo-chart-actions' }, h('button', { type: 'button', class: 'btn', onclick: exportSvg }, 'Exportar SVG'), h('button', { type: 'button', class: 'btn', onclick: saveChart }, 'Guardar no livro'), h('button', { type: 'button', class: 'btn primary', onclick: close }, 'Concluir'))
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
      const hide = Boolean(needle) && r > r0 && r <= r1 && !F.format(values.get(F.addr(r, col))).toLocaleLowerCase('pt-PT').includes(needle);
      if (hide) filteredRows.add(r); else filteredRows.delete(r);
      const row = tds.get(r)?.[0]?.parentElement;
      if (row) row.hidden = hide;
    }
    MO.toast(needle ? 'Filtro aplicado à seleção.' : 'Filtro removido.');
  }

  function clearFilter() {
    filteredRows.clear();
    for (const row of tbodyEl.querySelectorAll('tr[data-r]')) row.hidden = false;
  }

  function showSheetTabs() {
    if (!sheetTabs) return;
    const tabs = sheetList.map((sheet, index) => h('span', { class: 'sheet-tab-group' },
      h('button', {
        type: 'button', class: `sheet-tab${index === activeSheet ? ' active' : ''}`, title: 'Duplo clique para mudar o nome',
        onclick: () => switchSheet(index), ondblclick: () => editSheetName(index)
      }, sheet.name),
      sheetList.length > 1 ? h('button', { type: 'button', class: 'sheet-tab-remove', title: `Eliminar ${sheet.name}`, 'aria-label': `Eliminar ${sheet.name}`, onclick: () => deleteSheet(index) }, '×') : null
    ));
    const add = h('button', { type: 'button', class: 'sheet-tab-add', title: 'Adicionar folha', 'aria-label': 'Adicionar folha', onclick: addSheet }, '+');
    sheetTabs.replaceChildren(...tabs, add);
  }

  async function editSheetName(index) {
    const sheet = sheetList[index];
    const result = await MO.dialog({ title: 'Mudar nome da folha', message: 'O nome pode ter até 31 caracteres.', fields: [{ name: 'name', label: 'Nome', value: sheet.name }], okLabel: 'Guardar' });
    if (!result || !result.name.trim()) return;
    const name = result.name.replace(/[\\/*?:\[\]]/g, '').trim().slice(0, 31) || sheet.name;
    const duplicate = sheetList.some((other, i) => i !== index && other.name.toLocaleLowerCase('pt-PT') === name.toLocaleLowerCase('pt-PT'));
    if (duplicate) return MO.toast('Já existe uma folha com esse nome.');
    sheet.name = name;
    showSheetTabs(); ctx.dirty();
  }

  async function deleteSheet(index) {
    if (sheetList.length <= 1) return;
    const result = await MO.dialog({ title: 'Eliminar folha?', message: `A folha «${sheetList[index].name}» e os seus dados serão removidos deste livro.`, okLabel: 'Eliminar' });
    if (!result) return;
    sheetList.splice(index, 1);
    if (index < activeSheet) activeSheet--;
    else if (index === activeSheet) activeSheet = Math.min(index, sheetList.length - 1);
    cells = sheetList[activeSheet].cells;
    undoStack = []; redoStack = []; drawn.clear(); filteredRows.clear(); wrap.scrollTop = 0;
    refresh(); showSheetTabs(); ctx.dirty();
  }

  function switchSheet(index) {
    if (index === activeSheet || !sheetList[index]) return;
    if (editing) stopEdit(true);
    sheetList[activeSheet].cells = cells;
    activeSheet = index;
    cells = sheetList[index].cells;
    undoStack = []; redoStack = []; cur = { r: 0, c: 0 }; end = { ...cur };
    drawn.clear(); filteredRows.clear(); wrap.scrollTop = 0;
    refresh(); showSheetTabs();
  }

  function addSheet() {
    if (sheetList.length >= 100) return MO.toast('Um livro pode ter até 100 folhas.');
    if (editing) stopEdit(true);
    sheetList[activeSheet].cells = cells;
    const index = sheetList.length;
    let number = 1;
    while (sheetList.some((sheet) => sheet.name.toLocaleLowerCase('pt-PT') === `folha${number}`)) number++;
    sheetList.push({ name: `Folha${number}`, cells: {} });
    activeSheet = index; cells = sheetList[index].cells;
    cur = { r: 0, c: 0 }; end = { ...cur }; undoStack = []; redoStack = [];
    drawn.clear(); filteredRows.clear(); wrap.scrollTop = 0;
    refresh(); showSheetTabs(); ctx.dirty();
  }

  function normalizedSheets(input) {
    const names = new Set();
    return (Array.isArray(input) ? input : []).slice(0, 100).map((sheet, index) => {
      let name = String(sheet && sheet.name || `Folha${index + 1}`).replace(/[\\/*?:\[\]]/g, '').trim().slice(0, 31) || `Folha${index + 1}`;
      const base = name; let suffix = 2;
      while (names.has(name.toLocaleLowerCase('pt-PT'))) name = `${base.slice(0, 27)} (${suffix++})`;
      names.add(name.toLocaleLowerCase('pt-PT'));
      const charts = (Array.isArray(sheet && sheet.charts) ? sheet.charts : []).slice(0, 50).flatMap((chart) => {
        const r = chart && chart.range;
        if (!r || !['bar', 'line'].includes(chart.type) || ![r.r0, r.r1, r.c0, r.c1].every(Number.isInteger) || r.r0 < 0 || r.c0 < 0 || r.r1 >= ROWS || r.c1 >= COLS || r.r1 <= r.r0 || r.c1 <= r.c0) return [];
        return [{ name: String(chart.name || 'Gráfico').slice(0, 60), type: chart.type, range: { r0: r.r0, r1: r.r1, c0: r.c0, c1: r.c1 } }];
      });
      const pivots = (Array.isArray(sheet && sheet.pivots) ? sheet.pivots : []).slice(0, 10).flatMap((pivot) => {
        const r = pivot && pivot.range;
        if (!r || ![r.r0, r.r1, r.c0, r.c1, pivot.outCol, pivot.outRow, pivot.rows].every(Number.isInteger) || r.r0 < 0 || r.c0 < 0 || r.r1 <= r.r0 || r.c1 <= r.c0 || r.r1 >= ROWS || r.c1 >= COLS || pivot.outCol < 0 || pivot.outCol + 3 >= COLS || pivot.outRow < 0 || pivot.outRow >= ROWS) return [];
        return [{ range: { r0: r.r0, r1: r.r1, c0: r.c0, c1: r.c1 }, outCol: pivot.outCol, outRow: pivot.outRow, rows: Math.max(0, Math.min(ROWS - pivot.outRow, pivot.rows)) }];
      });
      const okRange = (r) => r && [r.r0, r.r1, r.c0, r.c1].every(Number.isInteger) && r.r0 >= 0 && r.c0 >= 0 && r.r1 >= r.r0 && r.c1 >= r.c0 && r.r1 < ROWS && r.c1 < COLS;
      const merges = (Array.isArray(sheet && sheet.merges) ? sheet.merges : []).slice(0, 2000)
        .filter((m) => okRange(m) && (m.r1 > m.r0 || m.c1 > m.c0) && (m.r1 - m.r0 + 1) * (m.c1 - m.c0 + 1) <= 100000)
        .map((m) => ({ r0: m.r0, r1: m.r1, c0: m.c0, c1: m.c1 }));
      const widths = {};
      for (const [c, w] of Object.entries((sheet && sheet.widths) || {})) {
        if (/^\d+$/.test(c) && Number(c) < COLS && Number.isFinite(w)) widths[c] = Math.max(24, Math.min(600, Math.round(w)));
      }
      const fz = sheet && sheet.freeze;
      const freeze = fz && Number.isInteger(fz.rows) && Number.isInteger(fz.cols) && (fz.rows || fz.cols) ? { rows: Math.max(0, Math.min(50, fz.rows)), cols: Math.max(0, Math.min(20, fz.cols)) } : null;
      const rules = (Array.isArray(sheet && sheet.rules) ? sheet.rules : []).slice(0, 50).flatMap((rule) => {
        if (!rule || !okRange(rule.range) || !Object.hasOwn(RULE_TYPES, rule.type)) return [];
        const clean = { range: { r0: rule.range.r0, r1: rule.range.r1, c0: rule.range.c0, c1: rule.range.c1 }, type: rule.type, a: String(rule.a ?? '').slice(0, 100), b: String(rule.b ?? '').slice(0, 100) };
        if (MO.HEX.test(rule.bg)) clean.bg = rule.bg;
        if (MO.HEX.test(rule.c)) clean.c = rule.c;
        return [clean];
      });
      return { name, cells: cleanCells(sheet && sheet.cells), charts, pivots, merges, widths, freeze, rules };
    });
  }

  // ---------- Construção da interface ----------

  function buildGrid() {
    const headRow = h('tr', null, h('th', { class: 'corner', title: 'Selecionar tudo' }));
    for (let c = 0; c < COLS; c++) {
      const th = h('th', { class: 'col-head', 'data-c': c }, F.colName(c));
      colHeads.push(th);
      headRow.append(th);
    }
    tbodyEl = h('tbody');
    topSpacer = h('tr', { class: 'sheet-spacer' }, h('td', { colspan: COLS + 1 }));
    bottomSpacer = h('tr', { class: 'sheet-spacer' }, h('td', { colspan: COLS + 1 }));
    tbodyEl.append(topSpacer, bottomSpacer);
    colEls = Array.from({ length: COLS }, () => h('col'));
    const colgroup = h('colgroup', null, h('col', { style: { width: '46px' } }), colEls);
    tableEl = h('table', { class: 'grid' }, colgroup, h('thead', null, headRow), tbodyEl);
    return tableEl;
  }

  let fillHandle = null;
  let fillDrag = null;
  let resizing = null;

  function placeFillHandle() {
    if (!fillHandle) return;
    const { r1, c1 } = range();
    const m = mergeAt(r1, c1);
    const td = tds.get(m ? m.r0 : r1)?.[m ? m.c0 : c1];
    if (!td || td.hidden || editing) {
      fillHandle.hidden = true;
      return;
    }
    fillHandle.hidden = false;
    fillHandle.style.left = td.offsetLeft + td.offsetWidth - 5 + 'px';
    fillHandle.style.top = td.offsetTop + td.offsetHeight - 5 + 'px';
  }

  function nearColumnEdge(th, e) {
    const box = th.getBoundingClientRect();
    return box.right - e.clientX <= 6;
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
    } else if (cell.classList.contains('col-head') && nearColumnEdge(cell, e)) {
      const c = Number(cell.dataset.c);
      undoStack.push(snapshotState());
      redoStack = [];
      resizing = { c, x0: e.clientX, w0: widthOf(c) };
      document.body.classList.add('col-resizing');
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
                ],
                [
                  iconButton('merge', 'Unir e centrar células', () => mergeCells(true), 'Unir e centrar'),
                  iconButton('unmerge', 'Separar células unidas', unmergeCells, 'Separar')
                ]
              ]
            },
            {
              label: 'Bordas',
              rows: [
                [
                  iconButton('borderAll', 'Todas as bordas', () => applyBorders('all')),
                  iconButton('borderOuter', 'Bordas exteriores', () => applyBorders('outer')),
                  iconButton('borderBottom', 'Borda inferior', () => applyBorders('bottom')),
                  iconButton('borderNone', 'Sem bordas', () => applyBorders('none'))
                ]
              ]
            },
            {
              label: 'Formatação condicional',
              rows: [
                [
                  bigButton('condFormat', 'Realçar células', 'Formatação condicional: realçar células conforme o valor', conditionalDialog),
                  bigButton('eraser', 'Limpar regras', 'Remover as regras de formatação condicional da seleção', clearRules)
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
          groups: [
            {
              label: 'Fixar painéis',
              rows: [
                [
                  bigButton('freeze', 'Fixar linha superior', 'Manter a primeira linha visível ao deslocar', () => setFreeze(1, 0)),
                  bigButton('freeze', 'Fixar primeira coluna', 'Manter a primeira coluna visível ao deslocar', () => setFreeze(0, 1)),
                  bigButton('freeze', 'Fixar até à célula ativa', 'Fixar as linhas acima e as colunas à esquerda da célula ativa', () => setFreeze(cur.r, cur.c)),
                  bigButton('unfreeze', 'Libertar painéis', 'Deixar de fixar linhas e colunas', () => setFreeze(0, 0))
                ]
              ]
            },
            { label: 'Temas', rows: [themeRow] }
          ]
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
                    bigButton('sum', 'Soma.Ses', 'Inserir SOMA.SES(intervalo a somar; intervalo de critério; critério)', () => insertFn('=SOMA.SES(')),
                    bigButton('count', 'Contar.Ses', 'Inserir CONTAR.SES(intervalo de critério; critério)', () => insertFn('=CONTAR.SES(')),
                    bigButton('sum', 'Média.Se', 'Inserir MÉDIA.SE(intervalo; critério; intervalo de média)', () => insertFn('=MÉDIA.SE(')),
                    bigButton('count', 'Contar vazios', 'Inserir CONTAR.VAZIO(intervalo)', () => insertFn('=CONTAR.VAZIO(')),
                    bigButton('sum', 'Soma produto', 'Inserir SOMARPRODUTO(intervalo1; intervalo2)', () => insertFn('=SOMARPRODUTO(')),
                  bigButton('lookup', 'ProcV', 'Inserir PROCV(valor; tabela; coluna; FALSO)', () => insertFn('=PROCV('))
                ]
              ]
            },
            {
              label: 'Estatística',
              rows: [[
                bigButton('average', 'Mediana', 'Inserir MEDIANA(intervalo)', () => insertFn('=MEDIANA(')),
                bigButton('chart', 'Moda', 'Inserir MODA(intervalo)', () => insertFn('=MODA(')),
                bigButton('average', 'Desvio A', 'Inserir DESVPAD.A(intervalo), para amostras', () => insertFn('=DESVPAD.A(')),
                bigButton('average', 'Desvio P', 'Inserir DESVPAD.P(intervalo), para a população completa', () => insertFn('=DESVPAD.P(')),
                bigButton('average', 'Variância A', 'Inserir VAR.S(intervalo), para amostras', () => insertFn('=VAR.S(')),
                bigButton('average', 'Variância P', 'Inserir VAR.P(intervalo), para a população completa', () => insertFn('=VAR.P('))
              ]]
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
                  bigButton('chart', 'Tabela dinâmica', 'Agrupar categorias e resumir valores com fórmulas atualizadas', createPivotTable),
                  bigButton('sparkle', 'Analisar com IA', 'Calcular estatísticas e verificar células vazias com o motor próprio do MyOffice', aiAnalyseSelection)
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
      fillHandle = h('span', { class: 'fill-handle', title: 'Arraste para preencher', hidden: true });
      wrap = h('div', { class: 'sheet-wrap', tabindex: '0', 'aria-label': 'Folha de cálculo' }, h('div', { class: 'sheet-inner' }, table, editorEl, fillHandle));
      fillHandle.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        if (editing) stopEdit(true);
        fillDrag = { src: range() };
      });
      statusEl = h('span', { class: 'status-text' });
      const ribbon = buildRibbon();
      const inner = wrap.firstChild;
      sheetTabs = h('div', { class: 'sheet-tabs', 'aria-label': 'Separadores do livro' });
      const bar = h('div', { class: 'statusbar' }, statusEl, MO.zoomControl((k) => (inner.style.zoom = k)));
      showStates = MO.toolStates(ribbon, { Negrito: 'b', 'Itálico': 'i', 'Alinhar à esquerda': 'left', Centrar: 'center', 'Alinhar à direita': 'right' });
      container.append(ribbon, sheetTabs, h('div', { class: 'fx-bar' }, nameBox, h('span', { class: 'fx-label' }, 'fx'), fxInput), wrap, bar);
      showSheetTabs();

      let scrollFrame = 0;
      wrap.addEventListener('scroll', () => {
        if (scrollFrame) return;
        scrollFrame = requestAnimationFrame(() => { scrollFrame = 0; renderWindow(); paintSelection(false); });
      });

      table.addEventListener('mousedown', onMouseDown);
      table.addEventListener('mouseover', (e) => {
        const td = e.target.closest('td[data-c]');
        if (fillDrag && td) {
          // Pré-visualiza a área a preencher: para baixo ou para a direita, conforme o maior movimento.
          const { src } = fillDrag;
          const dr = Number(td.dataset.r) - src.r1;
          const dc = Number(td.dataset.c) - src.c1;
          cur = { r: src.r0, c: src.c0 };
          end = dr >= dc && dr > 0 ? { r: Number(td.dataset.r), c: src.c1 } : dc > 0 ? { r: src.r1, c: Number(td.dataset.c) } : { r: src.r1, c: src.c1 };
          fillDrag.target = range();
          paintSelection(false);
          return;
        }
        if (!dragging) return;
        if (td) select(Number(td.dataset.r), Number(td.dataset.c), true);
      });
      table.addEventListener('mousemove', (e) => {
        const th = e.target.closest('th.col-head');
        table.classList.toggle('edge-hover', Boolean(th && nearColumnEdge(th, e)));
      });
      window.addEventListener('mousemove', (e) => {
        if (!resizing) return;
        const zoom = Number(inner.style.zoom) || 1;
        const w = Math.max(24, Math.min(600, Math.round(resizing.w0 + (e.clientX - resizing.x0) / zoom)));
        meta().widths = { ...(meta().widths || {}), [resizing.c]: w };
        applyColumnWidths();
      });
      window.addEventListener('mouseup', () => {
        dragging = false;
        if (resizing) {
          resizing = null;
          document.body.classList.remove('col-resizing');
          refresh();
          ctx.dirty();
        }
        if (fillDrag) {
          const { src, target } = fillDrag;
          fillDrag = null;
          if (target) applyFill(src, target);
        }
      });
      table.addEventListener('dblclick', (e) => {
        const th = e.target.closest('th.col-head');
        if (th && nearColumnEdge(th, e)) return autofitColumn(Number(th.dataset.c));
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
      if (wrap) wrap.scrollTop = wrap.scrollLeft = 0; // um documento novo ou aberto começa em A1
      cells = {};
      sheetList = [{ name: 'Folha1', cells }]; activeSheet = 0; showSheetTabs();
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
      sheetList[activeSheet].cells = cells;
      return JSON.stringify({ format: 'myoffice-sheet', version: 3, theme: theme.id, cells, activeSheet, sheets: sheetList });
    },

    load(text, ext) {
      let next = {};
      let nextSheets = null;
      let nextActive = 0;
      let nextTheme = T.LIST[0];
      let clipped = false;
      if (ext === 'xlsx') {
        const book = MO.OOXML.importXlsx(text, ROWS, COLS);
        nextSheets = normalizedSheets(book.sheets);
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
        if (Array.isArray(data.sheets)) { nextSheets = normalizedSheets(data.sheets); nextActive = Math.max(0, Math.min(nextSheets.length - 1, Number(data.activeSheet) || 0)); }
        else next = cleanCells(data.cells);
        nextTheme = T.byId(data.theme);
      }
      this.newDoc();
      setTheme(nextTheme);
      if (clipped) MO.toast(`Algumas células ultrapassam o limite atual de ${ROWS} linhas × ${COLS} colunas e não foram importadas.`);
      if (nextSheets && nextSheets.length) {
        sheetList = nextSheets; activeSheet = nextActive; cells = sheetList[activeSheet].cells; showSheetTabs();
      } else { cells = next; sheetList = [{ name: 'Folha1', cells, charts: [], pivots: [] }]; activeSheet = 0; showSheetTabs(); }
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
          sheetList[activeSheet].cells = cells;
          return MO.OOXML.exportXlsx(sheetList.map((sheet) => ({ name: sheet.name, cells: sheet.cells, charts: sheet.charts, merges: sheet.merges, widths: sheet.widths, freeze: sheet.freeze, values: F.compute(sheet.cells, ROWS, COLS) })));
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
          const a = F.addr(r, c); const cell = cells[a]; const value = values.get(a);
          const td = h('td', null, typeof value === 'number' && cell?.s?.f && Object.hasOwn(NUMBER_FORMATS, cell.s.f) ? NUMBER_FORMATS[cell.s.f].format(value) : F.format(value));
          if (cell?.s) { td.style.fontWeight = cell.s.b ? '700' : ''; td.style.fontStyle = cell.s.i ? 'italic' : ''; td.style.textAlign = cell.s.a || (typeof value === 'number' ? 'right' : ''); td.style.backgroundColor = cell.s.bg || ''; td.style.color = cell.s.c || ''; }
          else if (typeof value === 'number') td.style.textAlign = 'right';
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
