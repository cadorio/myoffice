'use strict';

// MyOffice Bases de dados: tabelas, formulários, consultas e relatórios num único ficheiro local
// (SQLite, através do sql.js). Importa Excel, CSV e Access; exporta Excel e CSV.
(function () {
  const MO = window.MO;
  const { h } = MO;

  const TYPES = { text: 'Texto', number: 'Número', money: 'Moeda (€)', date: 'Data', bool: 'Sim/Não', choice: 'Lista de opções', link: 'Ligação a outra tabela' };
  const SQL_TYPE = { text: 'TEXT', number: 'REAL', money: 'REAL', date: 'TEXT', bool: 'INTEGER', choice: 'TEXT', link: 'INTEGER' };
  const PAGE = 300;
  const MAX_UNDO_BYTES = 40 * 1024 * 1024;

  let SQL = null;
  let db = null;
  let ctx;
  let ready = null;
  let navBox, contentBox, statusEl, searchInput;
  let current = { kind: 'table', name: null }; // kind: table | query
  let mode = 'sheet'; // sheet | form | design | query
  let sort = null; // { field, dir }
  let limit = PAGE;
  let formIndex = 0;
  let queryText = '';
  let undoStack = [];
  let redoStack = [];

  const q = (name) => '"' + String(name).replace(/"/g, '""') + '"';
  const isActive = () => document.body.dataset.current === 'db';
  const validName = (name) => /^[\p{L}\p{N}_][\p{L}\p{N}_ \-]{0,59}$/u.test(name) && !/^_mo_/i.test(name) && !/^sqlite_/i.test(name);

  // ---------- Motor ----------

  function boot() {
    if (!ready) {
      ready = (window.initSqlJs ? window.initSqlJs() : Promise.reject(new Error('Motor de base de dados indisponível'))).then((lib) => {
        SQL = lib;
      });
    }
    return ready;
  }

  function rows(sql, params = []) {
    const st = db.prepare(sql);
    try {
      st.bind(params);
      const out = [];
      while (st.step()) out.push(st.getAsObject());
      return out;
    } finally {
      st.free();
    }
  }
  const run = (sql, params = []) => db.run(sql, params);

  function ensureMeta() {
    run('CREATE TABLE IF NOT EXISTS _mo_fields (tbl TEXT NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL, opts TEXT, pos INTEGER, PRIMARY KEY (tbl, name))');
    run('CREATE TABLE IF NOT EXISTS _mo_queries (name TEXT PRIMARY KEY, sql TEXT NOT NULL)');
    run('CREATE TABLE IF NOT EXISTS _mo_forms (tbl TEXT PRIMARY KEY, cfg TEXT NOT NULL)');
  }

  function tables() {
    return rows("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '_mo_%' AND name NOT LIKE 'sqlite_%' ORDER BY name COLLATE NOCASE").map((r) => r.name);
  }

  function queries() {
    return rows('SELECT name, sql FROM _mo_queries ORDER BY name COLLATE NOCASE');
  }

  // Campos de uma tabela, com o tipo do MyOffice (ou deduzido do SQLite, para bases importadas).
  function fields(table) {
    const info = rows(`PRAGMA table_info(${q(table)})`);
    const meta = new Map(rows('SELECT name, type, opts, pos FROM _mo_fields WHERE tbl = ?', [table]).map((r) => [r.name, r]));
    return info.map((c, i) => {
      const m = meta.get(c.name);
      let type = m && Object.hasOwn(TYPES, m.type) ? m.type : /INT/i.test(c.type) ? 'number' : /REAL|FLOA|DOUB|NUM|DEC/i.test(c.type) ? 'number' : 'text';
      let opts = {};
      try { opts = m && m.opts ? JSON.parse(m.opts) : {}; } catch { opts = {}; }
      return { name: c.name, type, opts, pos: m && Number.isFinite(m.pos) ? m.pos : i };
    }).sort((a, b) => a.pos - b.pos);
  }

  function setFieldMeta(table, f, pos) {
    run('INSERT OR REPLACE INTO _mo_fields (tbl, name, type, opts, pos) VALUES (?, ?, ?, ?, ?)', [table, f.name, f.type, JSON.stringify(f.opts || {}), pos]);
  }

  function createTable(name, list) {
    run(`CREATE TABLE ${q(name)} (${list.map((f) => `${q(f.name)} ${SQL_TYPE[f.type] || 'TEXT'}`).join(', ')})`);
    list.forEach((f, i) => setFieldMeta(name, f, i));
  }

  // Converte um valor escrito pelo utilizador para o tipo do campo.
  function toStored(f, value) {
    if (value === '' || value == null) return null;
    if (f.type === 'number' || f.type === 'money') {
      const n = typeof value === 'number' ? value : Number(String(value).trim().replace(/\s|€/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
      return Number.isFinite(n) ? n : null;
    }
    if (f.type === 'bool') return value === true || value === 1 || /^(1|sim|s|true|verdadeiro|yes)$/i.test(String(value)) ? 1 : 0;
    if (f.type === 'link') { const n = Number(value); return Number.isInteger(n) && n > 0 ? n : null; }
    if (f.type === 'date') {
      const t = String(value).trim();
      const pt = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
      if (pt) return `${pt[3]}-${pt[2].padStart(2, '0')}-${pt[1].padStart(2, '0')}`;
      return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : t;
    }
    return String(value).slice(0, 10000);
  }

  const money = new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' });
  const number = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 6 });
  function shown(f, value, linkNames) {
    if (value == null || value === '') return '';
    if (f.type === 'money') return money.format(Number(value));
    if (f.type === 'number') return typeof value === 'number' ? number.format(value) : String(value);
    if (f.type === 'bool') return value ? 'Sim' : 'Não';
    if (f.type === 'date') { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value)); return m ? `${m[3]}/${m[2]}/${m[1]}` : String(value); }
    if (f.type === 'link') return (linkNames && linkNames.get(Number(value))) || `#${value}`;
    return String(value);
  }

  // Nome legível dos registos de uma tabela (o primeiro campo de texto), para as ligações.
  function recordNames(table) {
    if (!tables().includes(table)) return new Map();
    const fs = fields(table);
    const label = fs.find((f) => f.type === 'text' && /nome|produto|descri|t[ií]tulo|designa/i.test(f.name)) || fs.find((f) => f.type === 'text') || fs[0];
    if (!label) return new Map();
    return new Map(rows(`SELECT rowid AS _id, ${q(label.name)} AS _label FROM ${q(table)} LIMIT 5000`).map((r) => [r._id, String(r._label ?? `#${r._id}`)]));
  }

  // ---------- Histórico ----------

  function snapshot() {
    const bytes = db.export();
    undoStack.push(bytes);
    let total = undoStack.reduce((t, b) => t + b.length, 0);
    while (undoStack.length > 1 && (undoStack.length > 30 || total > MAX_UNDO_BYTES)) total -= undoStack.shift().length;
    redoStack = [];
  }
  function swap(from, to) {
    if (!from.length) return;
    to.push(db.export());
    db.close();
    db = new SQL.Database(from.pop());
    if (current.name && current.kind === 'table' && !tables().includes(current.name)) current = { kind: 'table', name: tables()[0] || null };
    renderAll();
    ctx.dirty();
  }
  const undo = () => swap(undoStack, redoStack);
  const redo = () => swap(redoStack, undoStack);
  // Aplica uma alteração com possibilidade de anular.
  function change(fn) {
    snapshot();
    try {
      fn();
    } catch (e) {
      const bytes = undoStack.pop();
      if (bytes) { db.close(); db = new SQL.Database(bytes); }
      MO.toast(friendly(e));
      renderAll();
      return false;
    }
    ctx.dirty();
    renderAll();
    return true;
  }
  function friendly(e) {
    const msg = String((e && e.message) || e);
    if (/UNIQUE/i.test(msg)) return 'Já existe um registo com esse valor.';
    if (/no such table/i.test(msg)) return 'A tabela não existe.';
    if (/no such column/i.test(msg)) return 'O campo não existe: ' + msg.split(':').pop().trim();
    if (/syntax error/i.test(msg)) return 'Erro na consulta SQL: ' + msg;
    return msg.slice(0, 200);
  }

  // ---------- Modelos ----------

  function template(name) {
    ensureMeta();
    const F = (n, type, opts) => ({ name: n, type, opts: opts || {} });
    if (name === 'clientes' || name === 'encomendas') {
      createTable('Clientes', [F('Nome', 'text'), F('Email', 'text'), F('Telefone', 'text'), F('Cidade', 'text'), F('Cliente desde', 'date'), F('Ativo', 'bool')]);
      for (const r of [['Ana Sousa', 'ana@exemplo.pt', '912 345 678', 'Lisboa', '2024-03-01', 1], ['Rui Pinto', 'rui@exemplo.pt', '934 567 123', 'Porto', '2025-07-15', 1], ['Inês Lopes', 'ines@exemplo.pt', '966 111 222', 'Braga', '2026-01-09', 0]]) run('INSERT INTO "Clientes" VALUES (?, ?, ?, ?, ?, ?)', r);
    }
    if (name === 'inventario' || name === 'encomendas') {
      createTable('Produtos', [F('Código', 'text'), F('Produto', 'text'), F('Categoria', 'choice', { choices: ['Mobiliário', 'Escritório', 'Eletrónica', 'Outros'] }), F('Preço', 'money'), F('Stock', 'number')]);
      for (const r of [['P01', 'Cadeira ergonómica', 'Mobiliário', 189.9, 12], ['P02', 'Secretária', 'Mobiliário', 249, 4], ['P03', 'Monitor 27"', 'Eletrónica', 229.5, 9], ['P04', 'Resma de papel A4', 'Escritório', 4.75, 120]]) run('INSERT INTO "Produtos" VALUES (?, ?, ?, ?, ?)', r);
    }
    if (name === 'encomendas') {
      createTable('Encomendas', [F('Data', 'date'), F('Cliente', 'link', { table: 'Clientes' }), F('Produto', 'link', { table: 'Produtos' }), F('Quantidade', 'number'), F('Estado', 'choice', { choices: ['Nova', 'Em preparação', 'Enviada', 'Entregue'] })]);
      for (const r of [['2026-11-02', 1, 1, 2, 'Entregue'], ['2026-11-10', 2, 3, 1, 'Enviada'], ['2026-11-15', 1, 4, 10, 'Nova']]) run('INSERT INTO "Encomendas" VALUES (?, ?, ?, ?, ?)', r);
      run('INSERT INTO _mo_queries (name, sql) VALUES (?, ?)', ['Total por cliente', 'SELECT c."Nome" AS "Cliente", COUNT(*) AS "Encomendas", SUM(e."Quantidade" * p."Preço") AS "Valor (€)"\nFROM "Encomendas" e\nJOIN "Clientes" c ON c.rowid = e."Cliente"\nJOIN "Produtos" p ON p.rowid = e."Produto"\nGROUP BY c."Nome"\nORDER BY 3 DESC']);
    }
  }

  // ---------- Navegação ----------

  function renderNav() {
    const ts = tables();
    const qs = queries();
    const item = (kind, name, icon) => h('button', { type: 'button', class: 'db-nav-item' + (current.kind === kind && current.name === name ? ' on' : ''), title: name, onclick: () => open(kind, name) }, MO.icon(icon), h('span', null, name));
    navBox.replaceChildren(
      h('div', { class: 'db-nav-head' }, h('span', null, 'Tabelas'), h('button', { type: 'button', class: 'db-nav-add', title: 'Nova tabela', 'aria-label': 'Nova tabela', onclick: newTable }, '＋')),
      ...(ts.length ? ts.map((t) => item('table', t, 'table')) : [h('p', { class: 'db-nav-empty' }, 'Ainda não há tabelas.')]),
      h('div', { class: 'db-nav-head' }, h('span', null, 'Consultas'), h('button', { type: 'button', class: 'db-nav-add', title: 'Nova consulta', 'aria-label': 'Nova consulta', onclick: () => open('query', null) }, '＋')),
      ...(qs.length ? qs.map((r) => item('query', r.name, 'search')) : [h('p', { class: 'db-nav-empty' }, 'Sem consultas guardadas.')]),
      ...serverNav()
    );
  }

  function open(kind, name) {
    current = { kind, name };
    sort = null;
    limit = PAGE;
    formIndex = 0;
    if (kind === 'query') {
      mode = 'query';
      queryText = name ? (queries().find((r) => r.name === name) || {}).sql || '' : (current.name ? '' : defaultQuery());
    } else if (mode === 'query') mode = 'sheet';
    renderAll();
  }

  function defaultQuery() {
    const t = tables()[0];
    return t ? `SELECT * FROM ${q(t)}\nLIMIT 100` : '';
  }

  function renderAll() {
    if (!navBox || !db) return;
    renderNav();
    if (current.kind === 'table' && (!current.name || !tables().includes(current.name))) current = { kind: 'table', name: tables()[0] || null };
    if ((current.kind === 'remote' || current.kind === 'remote-sql') && !servers.some((sv) => sv.id === current.conn)) current = { kind: 'table', name: tables()[0] || null };
    contentBox.replaceChildren();
    if (current.kind === 'remote') renderRemoteTable();
    else if (current.kind === 'remote-sql') renderRemoteSql();
    else if (mode === 'query') renderQuery();
    else if (mode === 'rel') renderRelations();
    else if (!current.name && mode !== 'rel') renderEmpty();
    else if (mode === 'form') renderForm();
    else if (mode === 'design') renderDesign();
    else renderSheet();
    document.querySelectorAll('#view-db .db-mode').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  }

  function renderEmpty() {
    contentBox.append(h('div', { class: 'db-empty' },
      h('h2', null, 'Base de dados vazia'),
      h('p', null, 'Crie uma tabela, comece por um modelo ou importe dados do Excel, de um CSV ou do Access.'),
      h('div', { class: 'db-empty-actions' },
        h('button', { type: 'button', class: 'btn primary', onclick: newTable }, 'Nova tabela'),
        h('button', { type: 'button', class: 'btn', onclick: () => importFile('xlsx') }, 'Importar Excel'),
        h('button', { type: 'button', class: 'btn', onclick: () => importFile('accdb') }, 'Importar Access'))));
    status('Sem tabelas');
  }

  function status(text) { if (statusEl) statusEl.textContent = text; }

  // ---------- Folha de dados ----------

  function whereSearch(fs) {
    const term = searchInput && searchInput.value.trim();
    if (!term) return { sql: '', params: [] };
    return { sql: ' WHERE ' + fs.map((f) => `CAST(${q(f.name)} AS TEXT) LIKE ?`).join(' OR '), params: fs.map(() => `%${term}%`) };
  }

  function linkMaps(fs) {
    const maps = new Map();
    for (const f of fs) if (f.type === 'link' && f.opts.table) maps.set(f.name, recordNames(f.opts.table));
    return maps;
  }

  function renderSheet() {
    const table = current.name;
    const fs = fields(table);
    const w = whereSearch(fs);
    const order = sort ? ` ORDER BY ${q(sort.field)} ${sort.dir === 'desc' ? 'DESC' : 'ASC'}` : ' ORDER BY rowid';
    const total = rows(`SELECT COUNT(*) AS n FROM ${q(table)}${w.sql}`, w.params)[0].n;
    const data = rows(`SELECT rowid AS _id, * FROM ${q(table)}${w.sql}${order} LIMIT ${limit}`, w.params);
    const links = linkMaps(fs);
    const head = h('tr', null, h('th', { class: 'db-rownum' }, '#'), fs.map((f) => {
      const arrow = sort && sort.field === f.name ? (sort.dir === 'desc' ? ' ▼' : ' ▲') : '';
      return h('th', { title: `${TYPES[f.type]} · clique para ordenar`, onclick: () => { sort = sort && sort.field === f.name && sort.dir === 'asc' ? { field: f.name, dir: 'desc' } : { field: f.name, dir: 'asc' }; renderAll(); } },
        h('span', { class: 'db-type db-type-' + f.type }), f.name + arrow);
    }));
    const body = data.map((r) => h('tr', { 'data-id': r._id },
      h('td', { class: 'db-rownum' }, h('button', { type: 'button', class: 'db-row-del', title: 'Eliminar registo', 'aria-label': 'Eliminar registo', onclick: () => deleteRecord(r._id) }, '×')),
      fs.map((f) => cell(table, f, r, links.get(f.name)))));
    const add = h('tr', { class: 'db-newrow' }, h('td', { colspan: fs.length + 1 }, h('button', { type: 'button', class: 'btn', onclick: () => newRecord() }, '＋ Novo registo')));
    const grid = h('table', { class: 'db-grid' }, h('thead', null, head), h('tbody', null, body, add));
    const more = data.length < total ? h('button', { type: 'button', class: 'btn db-more', onclick: () => { limit += PAGE; renderAll(); } }, `Mostrar mais (${total - data.length} restantes)`) : null;
    contentBox.append(h('div', { class: 'db-grid-wrap' }, grid, more));
    status(`${table} · ${total} registo(s)${searchInput.value.trim() ? ' encontrados' : ''} · ${fs.length} campo(s)`);
  }

  // Célula editável: o valor só é gravado quando muda.
  function cell(table, f, r, names) {
    const value = r[f.name];
    const td = h('td', { class: 'db-cell db-' + f.type });
    const save = (v) => {
      const stored = toStored(f, v);
      if (stored === value || (stored == null && value == null)) return;
      const problem = checkRules(table, f, stored, r._id);
      if (problem) { MO.toast(problem); renderAll(); return; }
      change(() => run(`UPDATE ${q(table)} SET ${q(f.name)} = ? WHERE rowid = ?`, [stored, r._id]));
    };
    if (f.opts.required && (value == null || value === '')) td.classList.add('db-missing');
    if (f.type === 'bool') {
      const box = h('input', { type: 'checkbox', checked: Boolean(value), 'aria-label': f.name });
      box.addEventListener('change', () => save(box.checked));
      td.append(box);
    } else if (f.type === 'choice' || f.type === 'link') {
      const options = f.type === 'choice' ? (f.opts.choices || []).map((c) => [c, c]) : [...(names || new Map()).entries()].map(([id, label]) => [String(id), label]);
      const sel = h('select', { 'aria-label': f.name }, h('option', { value: '' }, ''), options.map(([v, label]) => h('option', { value: v, selected: String(value ?? '') === v }, label)));
      if (value != null && !options.some(([v]) => v === String(value))) sel.append(h('option', { value: String(value), selected: true }, shown(f, value, names)));
      sel.addEventListener('change', () => save(sel.value));
      td.append(sel);
    } else {
      const input = h('input', { type: f.type === 'date' ? 'date' : 'text', value: f.type === 'date' ? String(value ?? '').slice(0, 10) : f.type === 'text' ? String(value ?? '') : value == null ? '' : String(value).replace('.', ','), 'aria-label': f.name, inputmode: f.type === 'number' || f.type === 'money' ? 'decimal' : null });
      if (f.type === 'money' || f.type === 'number') input.placeholder = '';
      if (f.type === 'money' && value != null) input.title = shown(f, value);
      input.addEventListener('change', () => save(input.value));
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
      td.append(input);
    }
    return td;
  }

  function newRecord() {
    if (!current.name) return;
    const fs = fields(current.name);
    if (!fs.length) return MO.toast('Acrescente primeiro um campo à tabela (vista Estrutura).');
    change(() => run(`INSERT INTO ${q(current.name)} DEFAULT VALUES`));
    if (mode === 'form') { formIndex = rows(`SELECT COUNT(*) AS n FROM ${q(current.name)}`)[0].n - 1; renderAll(); }
    else {
      const last = contentBox.querySelector('.db-grid tbody tr:nth-last-child(2) input, .db-grid tbody tr:nth-last-child(2) select');
      if (last) last.focus();
    }
  }

  function deleteRecord(id, table = current.name) {
    const used = usages(table, id);
    if (used.length) return MO.toast(`Não é possível eliminar: este registo está ligado a ${used.map((u) => `${u.n} registo(s) de ${u.table}`).join(' e ')}. Elimine ou altere primeiro esses registos.`);
    if (!window.confirm('Eliminar este registo?')) return;
    change(() => run(`DELETE FROM ${q(table)} WHERE rowid = ?`, [id]));
  }

  // ---------- Formulário ----------

  function renderForm() {
    const table = current.name;
    const all = fields(table);
    const cfg = formConfig(table);
    const fs = orderFields(all, cfg).filter((f) => customizing || !cfg.hidden.includes(f.name));
    const total = rows(`SELECT COUNT(*) AS n FROM ${q(table)}`)[0].n;
    formIndex = Math.max(0, Math.min(formIndex, total - 1));
    const r = total ? rows(`SELECT rowid AS _id, * FROM ${q(table)} ORDER BY rowid LIMIT 1 OFFSET ?`, [formIndex])[0] : null;
    const links = linkMaps(all);
    const nav = h('div', { class: 'db-form-nav' },
      h('button', { type: 'button', class: 'btn', disabled: formIndex <= 0, onclick: () => { formIndex = 0; renderAll(); } }, '⏮'),
      h('button', { type: 'button', class: 'btn', disabled: formIndex <= 0, onclick: () => { formIndex--; renderAll(); } }, '◀ Anterior'),
      h('span', null, total ? `Registo ${formIndex + 1} de ${total}` : 'Sem registos'),
      h('button', { type: 'button', class: 'btn', disabled: formIndex >= total - 1, onclick: () => { formIndex++; renderAll(); } }, 'Seguinte ▶'),
      h('button', { type: 'button', class: 'btn', disabled: formIndex >= total - 1, onclick: () => { formIndex = total - 1; renderAll(); } }, '⏭'),
      h('button', { type: 'button', class: 'btn primary', onclick: newRecord }, '＋ Novo'),
      r ? h('button', { type: 'button', class: 'btn danger', onclick: () => deleteRecord(r._id) }, 'Eliminar') : null,
      h('button', { type: 'button', class: 'btn' + (customizing ? ' on' : ''), title: 'Escolher a ordem dos campos e os que aparecem', onclick: () => { customizing = !customizing; renderAll(); } }, customizing ? '✓ Concluir' : '⚙ Personalizar'));
    const fieldRow = (f, i) => {
      const hidden = cfg.hidden.includes(f.name);
      const tools = customizing ? h('span', { class: 'db-form-tools' },
        h('button', { type: 'button', class: 'btn', title: 'Subir', 'aria-label': `Subir ${f.name}`, disabled: i === 0, onclick: () => moveField(table, f.name, -1) }, '▲'),
        h('button', { type: 'button', class: 'btn', title: 'Descer', 'aria-label': `Descer ${f.name}`, disabled: i === fs.length - 1, onclick: () => moveField(table, f.name, 1) }, '▼'),
        h('button', { type: 'button', class: 'btn', title: hidden ? 'Mostrar no formulário' : 'Esconder no formulário', 'aria-label': `${hidden ? 'Mostrar' : 'Esconder'} ${f.name}`, onclick: () => toggleHidden(table, f.name) }, hidden ? '👁 Mostrar' : 'Esconder')) : null;
      const control = r ? cell(table, f, r, links.get(f.name)) : null;
      return h('div', { class: 'db-form-field' + (hidden ? ' is-hidden' : '') + (control && control.classList.contains('db-missing') ? ' db-missing' : '') },
        h('span', null, f.name + (f.opts.required ? ' *' : ''), h('small', null, TYPES[f.type])), control ? control.firstChild : h('span'), tools);
    };
    const card = h('div', { class: 'db-form-card' }, h('h2', null, table), r || customizing ? fs.map(fieldRow) : h('p', null, 'Esta tabela ainda não tem registos.'));
    contentBox.append(h('div', { class: 'db-form' }, nav, card, r ? subforms(table, r._id) : null));
    status(`${table} · formulário`);
  }

  // Subformulários: registos de outras tabelas ligados a este (ex.: as encomendas do cliente).
  function subforms(table, id) {
    const out = [];
    for (const other of tables()) {
      for (const f of fields(other).filter((x) => x.type === 'link' && x.opts.table === table)) {
        const cols = fields(other).filter((x) => x.name !== f.name).slice(0, 6);
        const links = linkMaps(cols);
        const list = rows(`SELECT rowid AS _id, * FROM ${q(other)} WHERE ${q(f.name)} = ? ORDER BY rowid LIMIT 200`, [id]);
        out.push(h('section', { class: 'db-subform' },
          h('h3', null, `${other}`, h('small', null, ` · ${f.name} = este registo · ${list.length}`)),
          h('table', { class: 'db-grid' },
            h('thead', null, h('tr', null, h('th', { class: 'db-rownum' }), cols.map((c) => h('th', null, h('span', { class: 'db-type db-type-' + c.type }), c.name)))),
            h('tbody', null,
              list.map((r) => h('tr', null, h('td', { class: 'db-rownum' }, h('button', { type: 'button', class: 'db-row-del', title: 'Eliminar registo', 'aria-label': 'Eliminar registo', onclick: () => deleteRecord(r._id, other) }, '×')), cols.map((c) => cell(other, c, r, links.get(c.name))))),
              h('tr', { class: 'db-newrow' }, h('td', { colspan: cols.length + 1 }, h('button', { type: 'button', class: 'btn', onclick: () => change(() => run(`INSERT INTO ${q(other)} (${q(f.name)}) VALUES (?)`, [id])) }, `＋ Acrescentar a ${other}`)))))));
      }
    }
    return out.length ? h('div', { class: 'db-subforms' }, out) : null;
  }

  // Configuração do formulário: ordem dos campos e campos escondidos.
  let customizing = false;
  function formConfig(table) {
    try {
      const row = rows('SELECT cfg FROM _mo_forms WHERE tbl = ?', [table])[0];
      const cfg = row ? JSON.parse(row.cfg) : {};
      return { order: Array.isArray(cfg.order) ? cfg.order.map(String) : [], hidden: Array.isArray(cfg.hidden) ? cfg.hidden.map(String) : [] };
    } catch {
      return { order: [], hidden: [] };
    }
  }
  const orderFields = (fs, cfg) => [...fs].sort((a, b) => { const ia = cfg.order.indexOf(a.name), ib = cfg.order.indexOf(b.name); return (ia < 0 ? 1e6 + a.pos : ia) - (ib < 0 ? 1e6 + b.pos : ib); });
  function saveFormConfig(table, cfg) {
    change(() => { ensureMeta(); run('INSERT OR REPLACE INTO _mo_forms (tbl, cfg) VALUES (?, ?)', [table, JSON.stringify(cfg)]); });
  }
  function moveField(table, name, delta) {
    const cfg = formConfig(table);
    const order = orderFields(fields(table), cfg).map((f) => f.name);
    const i = order.indexOf(name);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    saveFormConfig(table, { ...cfg, order });
  }
  function toggleHidden(table, name) {
    const cfg = formConfig(table);
    const hidden = cfg.hidden.includes(name) ? cfg.hidden.filter((x) => x !== name) : [...cfg.hidden, name];
    saveFormConfig(table, { ...cfg, hidden });
  }

  // ---------- Regras e integridade ----------

  function checkRules(table, f, stored, rowId) {
    const o = f.opts || {};
    if (o.required && (stored == null || stored === '')) return `O campo "${f.name}" é obrigatório.`;
    if (stored == null || stored === '') return null;
    if ((f.type === 'number' || f.type === 'money') && typeof stored === 'number') {
      if (o.min != null && o.min !== '' && stored < Number(o.min)) return `"${f.name}" tem de ser pelo menos ${o.min}.`;
      if (o.max != null && o.max !== '' && stored > Number(o.max)) return `"${f.name}" não pode passar de ${o.max}.`;
    }
    if (o.unique && rows(`SELECT COUNT(*) AS n FROM ${q(table)} WHERE ${q(f.name)} = ? AND rowid <> ?`, [stored, rowId ?? -1])[0].n) return `Já existe um registo com "${f.name}" = ${stored}. Este campo não pode repetir valores.`;
    return null;
  }

  // Registos de outras tabelas que apontam para este (campos de ligação).
  function usages(table, id) {
    const out = [];
    for (const other of tables()) {
      for (const f of fields(other).filter((x) => x.type === 'link' && x.opts.table === table)) {
        const n = rows(`SELECT COUNT(*) AS n FROM ${q(other)} WHERE ${q(f.name)} = ?`, [id])[0].n;
        if (n) out.push({ table: other, field: f.name, n });
      }
    }
    return out;
  }

  // ---------- Diagrama de relações ----------

  function renderRelations() {
    const ts = tables();
    const NS = 'http://www.w3.org/2000/svg';
    const S = (tag, attrs, text) => { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v); if (text != null) el.textContent = text; return el; };
    const W = 230, RH = 22, HEAD = 34, GAPX = 90, GAPY = 60, COLS = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(ts.length))));
    const boxes = new Map();
    const heights = ts.map((t) => HEAD + fields(t).length * RH + 8);
    ts.forEach((t, i) => {
      const col = i % COLS, row = Math.floor(i / COLS);
      const y = 20 + heights.filter((_h, k) => k % COLS === col && Math.floor(k / COLS) < row).reduce((a, b) => a + b + GAPY, 0);
      boxes.set(t, { x: 20 + col * (W + GAPX), y, h: heights[i], fields: fields(t) });
    });
    const width = 40 + COLS * W + (COLS - 1) * GAPX;
    const height = Math.max(200, ...[...boxes.values()].map((b) => b.y + b.h + 20));
    const svg = S('svg', { viewBox: `0 0 ${width} ${height}`, width, height, class: 'db-rel', role: 'img', 'aria-label': 'Diagrama de relações' });
    svg.append(S('defs', {}), S('rect', { x: 0, y: 0, width, height, fill: 'transparent' }));
    svg.firstChild.append((() => { const m = S('marker', { id: 'db-rel-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 8, markerHeight: 8, orient: 'auto-start-reverse' }); m.append(S('path', { d: 'M0,0 L10,5 L0,10 z', fill: '#a4373a' })); return m; })());
    // Ligações primeiro (ficam por baixo das caixas).
    let links = 0;
    for (const [t, b] of boxes) b.fields.forEach((f, i) => {
      const target = f.type === 'link' && boxes.get(f.opts.table);
      if (!target) return;
      links++;
      const y1 = b.y + HEAD + i * RH + RH / 2;
      const toRight = target.x > b.x;
      const x1 = toRight ? b.x + W : b.x;
      const x2 = toRight || target.x === b.x ? target.x : target.x + W;
      const y2 = target.y + HEAD / 2;
      const mid = target.x === b.x ? x1 - 40 : (x1 + x2) / 2;
      svg.append(S('path', { d: `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${target.x === b.x ? target.x : x2},${y2}`, fill: 'none', stroke: '#a4373a', 'stroke-width': 2, 'marker-end': 'url(#db-rel-arrow)' }));
    });
    for (const [t, b] of boxes) {
      const g = S('g', { class: 'db-rel-table', tabindex: 0, role: 'button', 'aria-label': `Abrir a tabela ${t}` });
      g.append(S('rect', { x: b.x, y: b.y, width: W, height: b.h, rx: 10, fill: '#ffffff', stroke: '#cfd8d1' }));
      g.append(S('rect', { x: b.x, y: b.y, width: W, height: HEAD, rx: 10, fill: '#a4373a' }), S('rect', { x: b.x, y: b.y + HEAD - 10, width: W, height: 10, fill: '#a4373a' }));
      g.append(S('text', { x: b.x + 12, y: b.y + 22, fill: '#fff', 'font-weight': 700, 'font-size': 14 }, t));
      b.fields.forEach((f, i) => {
        const y = b.y + HEAD + i * RH + 15;
        g.append(S('text', { x: b.x + 12, y, 'font-size': 12.5, fill: '#1d2622' }, (f.type === 'link' ? '🔗 ' : '') + f.name + (f.opts.required ? ' *' : '')));
        g.append(S('text', { x: b.x + W - 10, y, 'font-size': 11, fill: '#8a968f', 'text-anchor': 'end' }, f.type === 'link' ? '→ ' + (f.opts.table || '?') : TYPES[f.type].split(' ')[0]));
      });
      g.addEventListener('click', () => { current = { kind: 'table', name: t }; mode = 'sheet'; renderAll(); });
      g.addEventListener('keydown', (e) => { if (e.key === 'Enter') g.dispatchEvent(new Event('click')); });
      svg.append(g);
    }
    contentBox.append(h('div', { class: 'db-relations' },
      h('h2', null, 'Relações'),
      h('p', { class: 'db-hint' }, ts.length ? `${ts.length} tabela(s) e ${links} ligação(ões). Clique numa tabela para a abrir. Crie ligações na Estrutura com o tipo "Ligação a outra tabela".` : 'Ainda não há tabelas.'),
      svg));
    status(`Relações · ${ts.length} tabela(s)`);
  }

  // ---------- Perguntas em português → consulta ----------

  const plainPt = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const stem = (w) => plainPt(w).replace(/(oes|aes|ais|eis|res|ns|s)$/, '').replace(/(a|o|e)$/, '');
  const hasWord = (text, w) => new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(text);

  // Devolve { sql, explanation } ou { error }.
  function nlToSql(question) {
    const text = ' ' + plainPt(question).replace(/[?!.,;:]/g, ' ').replace(/\s+/g, ' ') + ' ';
    const ts = tables();
    if (!ts.length) return { error: 'Ainda não há tabelas.' };
    // Tabela: a que é referida pelo nome (singular ou plural); senão, a aberta.
    // Pontuação de cada tabela: o nome dela antes de "por" vale mais; depois somam-se os campos
    // dela que a pergunta refere ("soma da quantidade por produto" → Encomendas).
    const byPos = text.search(/ por /);
    let table = null, bestScore = 0, bestPos = Infinity;
    for (const t of ts) {
      const m = new RegExp(`(^|[^a-z0-9])${stem(plainPt(t).split(/\s+/)[0]).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).exec(text);
      const pos = m ? m.index + m[1].length : Infinity;
      let score = m && (byPos < 0 || pos < byPos) ? 3 : 0;
      for (const f of fields(t)) if (stem(f.name).length >= 4 && hasWord(text, stem(f.name)) && plainPt(f.name) !== plainPt(t)) score += 1;
      if (score > bestScore || (score === bestScore && score > 0 && pos < bestPos)) { bestScore = score; bestPos = pos; table = t; }
    }
    if (!table) table = current.kind === 'table' && current.name ? current.name : ts[0];
    const fs = fields(table);
    const mention = (f) => hasWord(text, stem(f.name)) || plainPt(f.name).split(/\s+/).every((w) => w.length > 2 && hasWord(text, stem(w)));
    const numeric = fs.filter((f) => f.type === 'number' || f.type === 'money');
    const dates = fs.filter((f) => f.type === 'date');
    const where = [];
    const params = [];
    const explain = [];
    const sel = (f) => (f.type === 'link' && f.opts.table && tables().includes(f.opts.table) ? labelExpr(f) : `t.${q(f.name)}`);

    // Valores de texto e listas que aparecem na pergunta ("de Lisboa", "estado Enviada").
    for (const f of fs.filter((x) => x.type === 'text' || x.type === 'choice')) {
      const values = rows(`SELECT DISTINCT ${q(f.name)} AS v FROM ${q(table)} WHERE ${q(f.name)} IS NOT NULL LIMIT 500`).map((r) => String(r.v));
      // Valor exato, ou a mesma palavra no plural/feminino ("Enviada" ↔ "enviadas").
      const hit = values.filter((v) => plainPt(v).length >= 3 && (text.includes(' ' + plainPt(v) + ' ') || (!/\s/.test(v.trim()) && stem(v).length >= 4 && new RegExp(` ${stem(v)}[a-z]{0,3} `).test(text)))).sort((a, b) => b.length - a.length)[0];
      if (hit) { where.push(`t.${q(f.name)} = ?`); params.push(hit); explain.push(`${f.name} = ${hit}`); }
    }
    // Ligações: "encomendas da Ana Sousa".
    for (const f of fs.filter((x) => x.type === 'link' && x.opts.table)) {
      const names = [...recordNames(f.opts.table).entries()].filter(([, label]) => plainPt(label).length >= 3 && text.includes(' ' + plainPt(label)));
      const hit = names.sort((a, b) => b[1].length - a[1].length)[0];
      if (hit) { where.push(`t.${q(f.name)} = ?`); params.push(hit[0]); explain.push(`${f.name} = ${hit[1]}`); }
    }
    // Sim/não: "ativos", "não pagos", "sem stock"…
    for (const f of fs.filter((x) => x.type === 'bool')) {
      const s = stem(f.name);
      const m = new RegExp(`(nao |sem |in)?${s}[a-z]*`).exec(text);
      if (m && s.length >= 3) { const v = m[1] ? 0 : 1; where.push(`t.${q(f.name)} = ${v}`); explain.push(`${f.name}: ${v ? 'sim' : 'não'}`); }
    }
    // Comparações numéricas: "preço acima de 100", "stock menor que 5", "entre 10 e 50".
    const numField = numeric.find(mention) || numeric[0];
    const cmp = /(maior(?:es)? (?:que|do que|de)|acima de|mais de|superior(?:es)? a|menor(?:es)? (?:que|do que|de)|abaixo de|menos de|inferior(?:es)? a) (-?\d+(?:[.,]\d+)?)/.exec(text);
    const btw = /entre (-?\d+(?:[.,]\d+)?) e (-?\d+(?:[.,]\d+)?)/.exec(text);
    if (numField && btw) { where.push(`t.${q(numField.name)} BETWEEN ? AND ?`); params.push(Number(btw[1].replace(',', '.')), Number(btw[2].replace(',', '.'))); explain.push(`${numField.name} entre ${btw[1]} e ${btw[2]}`); }
    else if (numField && cmp) {
      const op = /maior|acima|mais|superior/.test(cmp[1]) ? '>' : '<';
      where.push(`t.${q(numField.name)} ${op} ?`); params.push(Number(cmp[2].replace(',', '.'))); explain.push(`${numField.name} ${op} ${cmp[2]}`);
    }
    // Datas
    const dateField = dates.find(mention) || dates[0];
    if (dateField) {
      const d = `t.${q(dateField.name)}`;
      let m;
      if (/ (este|deste|neste) mes /.test(text)) { where.push(`strftime('%Y-%m', ${d}) = strftime('%Y-%m', 'now')`); explain.push(`${dateField.name}: este mês`); }
      else if (/ (o |do |no )?mes passado /.test(text)) { where.push(`strftime('%Y-%m', ${d}) = strftime('%Y-%m', 'now', 'start of month', '-1 month')`); explain.push(`${dateField.name}: mês passado`); }
      else if (/ (este|deste|neste) ano /.test(text)) { where.push(`strftime('%Y', ${d}) = strftime('%Y', 'now')`); explain.push(`${dateField.name}: este ano`); }
      else if (/ hoje /.test(text)) { where.push(`date(${d}) = date('now')`); explain.push(`${dateField.name}: hoje`); }
      else if ((m = / ultimos (\d+) dias /.exec(text))) { where.push(`date(${d}) >= date('now', ?)`); params.push(`-${m[1]} days`); explain.push(`${dateField.name}: últimos ${m[1]} dias`); }
      else if ((m = / (?:em|de|desde) (19\d\d|20\d\d) /.exec(text))) { where.push(`strftime('%Y', ${d}) ${/desde/.test(m[0]) ? '>=' : '='} ?`); params.push(m[1]); explain.push(`${dateField.name}: ${m[1]}`); }
    }

    // Agrupar: "por cliente", "por cidade".
    const byMatch = / por ([a-z ]+?) (?:com|onde|que|de|em|ordenad|$)/.exec(text + ' ');
    const groupField = byMatch ? fs.find((f) => hasWord(' ' + byMatch[1] + ' ', stem(f.name))) : null;
    // Agregados
    // "total de encomendas" (o nome da tabela) é uma contagem; "total de quantidade" é uma soma.
    const totalOfTable = new RegExp(`(total|numero)( d[eoa]s?)? ${stem(plainPt(table).split(/\s+/)[0])}`).test(text);
    const sumField = numeric.find((f) => new RegExp(`(total|soma|somar|valor total)( d[eoa]s?)? ${stem(f.name)}`).test(text)) || (!totalOfTable && / (total|soma|faturac|vendas totais) /.test(text) ? numField : null);
    const avgField = numeric.find((f) => new RegExp(`media( d[eoa]s?)? ${stem(f.name)}`).test(text)) || (/ media /.test(text) ? numField : null);
    const count = / (quantos|quantas|numero de|contar|conta) /.test(text) || totalOfTable;
    const whereSql = where.length ? '\nWHERE ' + where.join('\n  AND ') : '';
    let sql;
    if (groupField || count || sumField || avgField) {
      const aggs = [];
      if (count || (!sumField && !avgField)) aggs.push('COUNT(*) AS "Quantidade"');
      if (sumField) aggs.push(`SUM(t.${q(sumField.name)}) AS ${q('Total de ' + sumField.name)}`);
      if (avgField) aggs.push(`ROUND(AVG(t.${q(avgField.name)}), 2) AS ${q('Média de ' + avgField.name)}`);
      if (groupField) {
        sql = `SELECT ${sel(groupField)} AS ${q(groupField.name)}, ${aggs.join(', ')}\nFROM ${q(table)} t${whereSql}\nGROUP BY t.${q(groupField.name)}\nORDER BY 2 DESC`;
        explain.push(`agrupado por ${groupField.name}`);
      } else sql = `SELECT ${aggs.join(', ')}\nFROM ${q(table)} t${whereSql}`;
    } else {
      // Os N mais caros / maiores / mais recentes.
      const top = /(?:os|as)? ?(\d+)? ?(mais|menos) (caros?|caras?|baratos?|baratas?|recentes?|antig[oa]s?|altos?|altas?|baix[oa]s?|grandes?|pequen[oa]s?|vendid[oa]s?)/.exec(text);
      let order = '';
      let limit = '';
      if (top) {
        const recent = /recente|antig/.test(top[3]);
        const f = recent ? dateField : numField;
        const desc = (top[2] === 'mais') !== /barat|antig|baix|pequen/.test(top[3]);
        if (f) { order = `\nORDER BY t.${q(f.name)} ${desc ? 'DESC' : 'ASC'}`; explain.push(`ordenado por ${f.name} ${desc ? '(maior primeiro)' : '(menor primeiro)'}`); }
        const n = top[1] || (/ (?:os|as|[ao]s?) (\d+) /.exec(text) || [])[1];
        limit = `\nLIMIT ${Math.min(1000, Number(n) || (/s$/.test(top[3]) ? 10 : 1))}`;
      }
      const ordBy = / ordenad[oa]s? por ([a-z ]+?) $/.exec(text + ' ') || / por ordem de ([a-z ]+?) $/.exec(text + ' ');
      const ordField = ordBy && fs.find((f) => hasWord(' ' + ordBy[1] + ' ', stem(f.name)));
      if (ordField && !order) { order = `\nORDER BY t.${q(ordField.name)}`; explain.push(`ordenado por ${ordField.name}`); }
      sql = `SELECT ${fs.map((f) => `${sel(f)} AS ${q(f.name)}`).join(', ')}\nFROM ${q(table)} t${whereSql}${order}${limit}`;
    }
    // Os parâmetros ficam escritos no SQL (com aspas), para o utilizador ver e poder editar.
    let i = 0;
    sql = sql.replace(/\?/g, () => { const v = params[i++]; return typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`; });
    return { sql, explanation: `Tabela ${table}` + (explain.length ? ': ' + explain.join(', ') : ' (todos os registos)') };
  }
  // Nome legível de um registo ligado, dentro de uma consulta.
  function labelExpr(f) {
    const tfs = fields(f.opts.table);
    const label = tfs.find((x) => x.type === 'text' && /nome|produto|descri|t[ií]tulo|designa/i.test(x.name)) || tfs.find((x) => x.type === 'text') || tfs[0];
    return label ? `(SELECT ${q(label.name)} FROM ${q(f.opts.table)} WHERE rowid = t.${q(f.name)})` : `t.${q(f.name)}`;
  }

  // ---------- Relatório com grupos e totais ----------

  let reportCfg = null; // { group, totals: [] }
  async function report() {
    if (!currentData()) return MO.toast('Abra uma tabela ou execute uma consulta.');
    if (current.kind === 'table' && current.name && mode !== 'query') {
      const fs = fields(current.name);
      const group = h('select', null, h('option', { value: '' }, 'Sem grupos'), fs.map((f) => h('option', { value: f.name }, f.name)));
      const totals = fs.filter((f) => f.type === 'number' || f.type === 'money').map((f) => [f.name, h('input', { type: 'checkbox', checked: f.type === 'money' })]);
      const dlg = h('dialog', { class: 'mo-dialog' }, h('form', { method: 'dialog' },
        h('h2', null, `Relatório de ${current.name}`),
        h('label', { class: 'db-conn-field' }, h('span', null, 'Agrupar por'), group),
        totals.length ? h('div', { class: 'db-conn-field' }, h('span', null, 'Totais de'), ...totals.map(([n, box]) => h('label', { class: 'chart-check' }, box, n))) : null,
        h('div', { class: 'mo-dialog-actions' }, h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Cancelar'), h('button', { type: 'submit', class: 'btn primary', value: 'ok' }, 'Pré-visualizar'))));
      const ok = await new Promise((resolve) => { dlg.addEventListener('close', () => { dlg.remove(); resolve(dlg.returnValue === 'ok'); }); document.body.append(dlg); dlg.showModal(); });
      if (!ok) return;
      reportCfg = { group: group.value, totals: totals.filter(([, b]) => b.checked).map(([n]) => n) };
    } else reportCfg = null;
    document.querySelector('[data-action="printPreview"]')?.click();
  }

  function reportNode() {
    const d = currentData();
    const node = h('div', { class: 'db-report' });
    if (!d) { node.append(h('p', null, 'Sem dados.')); return node; }
    const cfg = current.kind === 'table' && mode !== 'query' ? reportCfg : null;
    const fmtv = (v) => (v == null ? '' : typeof v === 'number' ? number.format(v) : String(v));
    const fs = current.kind === 'table' && current.name ? fields(current.name) : [];
    const isMoney = (c) => (fs.find((f) => f.name === c) || {}).type === 'money';
    const fmtCell = (c, v) => (isMoney(c) && typeof v === 'number' ? money.format(v) : fmtv(v));
    const ti = (cfg ? cfg.totals : []).map((n) => d.columns.indexOf(n)).filter((i) => i >= 0);
    const sum = (list, i) => list.reduce((t, r) => t + (typeof r[i] === 'number' ? r[i] : 0), 0);
    const table = (list, label) => h('table', null,
      h('thead', null, h('tr', null, d.columns.map((c) => h('th', null, c)))),
      h('tbody', null, list.slice(0, 5000).map((r) => h('tr', null, r.map((v, i) => h('td', { class: typeof v === 'number' ? 'num' : null }, fmtCell(d.columns[i], v))))),
        ti.length ? h('tr', { class: 'db-report-total' }, d.columns.map((c, i) => h('td', { class: ti.includes(i) ? 'num' : null }, i === 0 ? label : ti.includes(i) ? fmtCell(c, sum(list, i)) : ''))) : null));
    node.append(h('h1', null, d.title), h('p', { class: 'db-report-meta' }, `${d.values.length} registo(s) · ${new Date().toLocaleDateString('pt-PT')}${cfg && cfg.group ? ` · agrupado por ${cfg.group}` : ''}`));
    const gi = cfg && cfg.group ? d.columns.indexOf(cfg.group) : -1;
    if (gi >= 0) {
      const groups = new Map();
      for (const r of d.values) { const k = fmtv(r[gi]) || '(vazio)'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
      for (const [k, list] of [...groups].sort((a, b) => a[0].localeCompare(b[0], 'pt'))) node.append(h('h2', null, `${cfg.group}: ${k}`, h('small', null, ` · ${list.length} registo(s)`)), table(list, 'Subtotal'));
      if (ti.length) node.append(h('p', { class: 'db-report-grand' }, 'Total geral: ' + ti.map((i) => `${d.columns[i]} ${fmtCell(d.columns[i], sum(d.values, i))}`).join(' · ')));
    } else node.append(table(d.values, 'Total'));
    return node;
  }

  // ---------- Estrutura ----------

  function renderDesign() {
    const table = current.name;
    const fs = fields(table);
    const others = tables().filter((t) => t !== table);
    const rowsEl = fs.map((f, i) => {
      const type = h('select', { 'aria-label': `Tipo de ${f.name}` }, Object.entries(TYPES).map(([k, label]) => h('option', { value: k, selected: k === f.type }, label)));
      type.addEventListener('change', () => setType(table, f, type.value));
      let extra = null;
      if (f.type === 'choice') {
        const choices = h('input', { type: 'text', value: (f.opts.choices || []).join('; '), placeholder: 'Opção 1; Opção 2; …', 'aria-label': `Opções de ${f.name}` });
        choices.addEventListener('change', () => change(() => setFieldMeta(table, { ...f, opts: { ...f.opts, choices: choices.value.split(';').map((c) => c.trim()).filter(Boolean).slice(0, 100) } }, i)));
        extra = choices;
      } else if (f.type === 'link') {
        const target = h('select', { 'aria-label': `Tabela ligada a ${f.name}` }, h('option', { value: '' }, 'Escolha a tabela…'), others.map((t) => h('option', { value: t, selected: f.opts.table === t }, t)));
        target.addEventListener('change', () => change(() => setFieldMeta(table, { ...f, opts: { ...f.opts, table: target.value } }, i)));
        extra = target;
      }
      // Regras: obrigatório, único e (números) mínimo e máximo.
      const setOpt = (key, value) => change(() => setFieldMeta(table, { ...f, opts: { ...f.opts, [key]: value } }, i));
      const req = h('input', { type: 'checkbox', checked: Boolean(f.opts.required), 'aria-label': `${f.name} obrigatório` });
      req.addEventListener('change', () => {
        const empty = rows(`SELECT COUNT(*) AS n FROM ${q(table)} WHERE ${q(f.name)} IS NULL OR ${q(f.name)} = ''`)[0].n;
        if (req.checked && empty) MO.toast(`Atenção: ${empty} registo(s) ainda têm "${f.name}" vazio; ficam assinalados a vermelho.`);
        setOpt('required', req.checked);
      });
      const uni = h('input', { type: 'checkbox', checked: Boolean(f.opts.unique), 'aria-label': `${f.name} único` });
      uni.addEventListener('change', () => {
        const dup = uni.checked ? rows(`SELECT COUNT(*) AS n FROM (SELECT ${q(f.name)} FROM ${q(table)} WHERE ${q(f.name)} IS NOT NULL GROUP BY ${q(f.name)} HAVING COUNT(*) > 1)`)[0].n : 0;
        if (dup) { uni.checked = false; return MO.toast(`Não é possível: "${f.name}" já tem ${dup} valor(es) repetido(s).`); }
        setOpt('unique', uni.checked);
      });
      const rules = h('div', { class: 'db-rules' }, h('label', { class: 'chart-check' }, req, 'Obrigatório'), h('label', { class: 'chart-check' }, uni, 'Único'));
      if (f.type === 'number' || f.type === 'money') {
        for (const [key, label] of [['min', 'Mín.'], ['max', 'Máx.']]) {
          const inp = h('input', { type: 'number', value: f.opts[key] ?? '', placeholder: label, 'aria-label': `${label} de ${f.name}`, class: 'db-rule-num' });
          inp.addEventListener('change', () => setOpt(key, inp.value === '' ? null : Number(inp.value)));
          rules.append(inp);
        }
      }
      return h('tr', null,
        h('td', null, h('button', { type: 'button', class: 'db-link', title: 'Mudar o nome do campo', onclick: () => renameField(table, f) }, f.name)),
        h('td', null, type),
        h('td', null, extra),
        h('td', null, rules),
        h('td', null, h('button', { type: 'button', class: 'db-row-del', title: 'Eliminar campo', 'aria-label': `Eliminar o campo ${f.name}`, onclick: () => dropField(table, f) }, '×')));
    });
    contentBox.append(h('div', { class: 'db-design' },
      h('h2', null, `Estrutura de ${table}`),
      h('table', { class: 'db-design-table' }, h('thead', null, h('tr', null, h('th', null, 'Campo'), h('th', null, 'Tipo'), h('th', null, 'Opções'), h('th', null, 'Regras'), h('th'))), h('tbody', null, rowsEl)),
      h('div', { class: 'db-design-actions' },
        h('button', { type: 'button', class: 'btn primary', onclick: () => addField(table) }, '＋ Adicionar campo'),
        h('button', { type: 'button', class: 'btn', onclick: () => renameTable(table) }, 'Mudar o nome da tabela'),
        h('button', { type: 'button', class: 'btn danger', onclick: () => dropTable(table) }, 'Eliminar tabela'))));
    status(`${table} · estrutura · ${fs.length} campo(s)`);
  }

  async function askName(title, label, value = '') {
    const res = await MO.dialog({ title, fields: [{ name: 'name', label, value }], okLabel: 'OK' });
    if (!res) return null;
    const name = res.name.trim();
    if (!validName(name)) { MO.toast('Use letras, números, espaços, _ ou - (até 60 carateres).'); return null; }
    return name;
  }

  async function newTable() {
    if (!db) return;
    const name = await askName('Nova tabela', 'Nome da tabela', 'Tabela ' + (tables().length + 1));
    if (!name) return;
    if (tables().some((t) => t.toLowerCase() === name.toLowerCase())) return MO.toast('Já existe uma tabela com esse nome.');
    if (change(() => { ensureMeta(); createTable(name, [{ name: 'Nome', type: 'text' }, { name: 'Notas', type: 'text' }]); })) {
      current = { kind: 'table', name };
      mode = 'design';
      renderAll();
    }
  }

  async function addField(table) {
    const name = await askName('Adicionar campo', 'Nome do campo');
    if (!name) return;
    if (fields(table).some((f) => f.name.toLowerCase() === name.toLowerCase())) return MO.toast('Já existe um campo com esse nome.');
    change(() => { run(`ALTER TABLE ${q(table)} ADD COLUMN ${q(name)} TEXT`); setFieldMeta(table, { name, type: 'text', opts: {} }, fields(table).length); });
  }

  async function renameField(table, f) {
    const name = await askName('Mudar o nome do campo', 'Novo nome', f.name);
    if (!name || name === f.name) return;
    change(() => {
      run(`ALTER TABLE ${q(table)} RENAME COLUMN ${q(f.name)} TO ${q(name)}`);
      run('UPDATE _mo_fields SET name = ? WHERE tbl = ? AND name = ?', [name, table, f.name]);
    });
  }

  function dropField(table, f) {
    if (fields(table).length <= 1) return MO.toast('Uma tabela tem de ter pelo menos um campo.');
    if (!window.confirm(`Eliminar o campo "${f.name}" e todos os seus valores?`)) return;
    change(() => {
      run(`ALTER TABLE ${q(table)} DROP COLUMN ${q(f.name)}`);
      run('DELETE FROM _mo_fields WHERE tbl = ? AND name = ?', [table, f.name]);
    });
  }

  // Mudar o tipo converte os valores existentes (o que não for convertível fica vazio).
  function setType(table, f, type) {
    const fs = fields(table);
    const pos = fs.findIndex((x) => x.name === f.name);
    change(() => {
      const data = rows(`SELECT rowid AS _id, ${q(f.name)} AS v FROM ${q(table)}`);
      const nf = { name: f.name, type, opts: type === 'choice' ? { choices: [...new Set(data.map((r) => r.v).filter((v) => v != null && v !== '').map(String))].slice(0, 50) } : type === 'link' ? { table: '' } : {} };
      for (const r of data) run(`UPDATE ${q(table)} SET ${q(f.name)} = ? WHERE rowid = ?`, [toStored(nf, r.v), r._id]);
      setFieldMeta(table, nf, pos);
    });
  }

  async function renameTable(table) {
    const name = await askName('Mudar o nome da tabela', 'Novo nome', table);
    if (!name || name === table) return;
    if (change(() => {
      run(`ALTER TABLE ${q(table)} RENAME TO ${q(name)}`);
      run('UPDATE _mo_fields SET tbl = ? WHERE tbl = ?', [name, table]);
      // Ligações de outras tabelas passam a apontar para o novo nome.
      for (const r of rows('SELECT tbl, name, opts FROM _mo_fields WHERE type = ?', ['link'])) {
        try { const o = JSON.parse(r.opts || '{}'); if (o.table === table) run('UPDATE _mo_fields SET opts = ? WHERE tbl = ? AND name = ?', [JSON.stringify({ table: name }), r.tbl, r.name]); } catch { /* opções inválidas ficam como estão */ }
      }
    })) { current = { kind: 'table', name }; renderAll(); }
  }

  function dropTable(table) {
    const refs = tables().filter((t) => t !== table && fields(t).some((f) => f.type === 'link' && f.opts.table === table));
    if (refs.length && !window.confirm(`A tabela "${table}" está ligada a ${refs.join(', ')}. As ligações deixam de funcionar. Continuar?`)) return;
    if (!window.confirm(`Eliminar a tabela "${table}" com todos os registos? Pode anular com Ctrl+Z.`)) return;
    change(() => { run(`DROP TABLE ${q(table)}`); run('DELETE FROM _mo_fields WHERE tbl = ?', [table]); });
    current = { kind: 'table', name: tables()[0] || null };
    mode = 'sheet';
    renderAll();
  }

  // ---------- Consultas ----------

  function renderQuery() {
    const ts = tables();
    const editor = h('textarea', { class: 'db-sql', spellcheck: 'false', rows: 7, 'aria-label': 'Consulta SQL', placeholder: 'SELECT * FROM "Clientes" WHERE "Cidade" = \'Lisboa\'' });
    editor.value = queryText;
    editor.addEventListener('input', () => { queryText = editor.value; });
    editor.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); execute(); } });
    const results = h('div', { class: 'db-results' });

    // Construtor simples: tabela, condição e ordenação sem escrever SQL.
    const tableSel = h('select', { 'aria-label': 'Tabela' }, ts.map((t) => h('option', { value: t }, t)));
    const fieldSel = h('select', { 'aria-label': 'Campo' });
    const opSel = h('select', { 'aria-label': 'Condição' }, [['', 'todos os registos'], ['=', 'é igual a'], ['<>', 'é diferente de'], ['>', 'é maior que'], ['<', 'é menor que'], ['LIKE', 'contém']].map(([v, l]) => h('option', { value: v }, l)));
    const valueIn = h('input', { type: 'text', placeholder: 'valor', 'aria-label': 'Valor' });
    const sortSel = h('select', { 'aria-label': 'Ordenar por' });
    const fillFields = () => {
      const fs = tableSel.value ? fields(tableSel.value) : [];
      fieldSel.replaceChildren(...fs.map((f) => h('option', { value: f.name }, f.name)));
      sortSel.replaceChildren(h('option', { value: '' }, 'sem ordenação'), ...fs.flatMap((f) => [h('option', { value: f.name + '|ASC' }, `${f.name} ↑`), h('option', { value: f.name + '|DESC' }, `${f.name} ↓`)]));
    };
    tableSel.addEventListener('change', fillFields);
    fillFields();
    const build = () => {
      if (!tableSel.value) return;
      let sql = `SELECT * FROM ${q(tableSel.value)}`;
      if (opSel.value) {
        const raw = valueIn.value.trim();
        const val = opSel.value === 'LIKE' ? `'%${raw.replace(/'/g, "''")}%'` : raw !== '' && Number.isFinite(Number(raw.replace(',', '.'))) ? String(Number(raw.replace(',', '.'))) : `'${raw.replace(/'/g, "''")}'`;
        sql += `\nWHERE ${q(fieldSel.value)} ${opSel.value} ${val}`;
      }
      if (sortSel.value) { const [f, d] = sortSel.value.split('|'); sql += `\nORDER BY ${q(f)} ${d}`; }
      queryText = sql;
      editor.value = sql;
      execute();
    };

    const execute = () => {
      results.replaceChildren();
      const sql = editor.value.trim();
      if (!sql) return;
      const writes = isWrite(sql);
      if (/\b(attach|detach)\b/i.test(sql)) return results.append(h('p', { class: 'db-error' }, 'ATTACH e DETACH não são permitidos.'));
      if (writes) {
        const risky = /^\s*(delete|update)\b(?![\s\S]*\bwhere\b)/im.test(sql) || /^\s*drop\b/im.test(sql);
        if (!window.confirm(risky ? 'Atenção: esta instrução altera ou apaga dados SEM condição (WHERE) ou elimina uma tabela. Continuar? Pode anular com Ctrl+Z.' : 'Esta instrução altera a base de dados. Continuar? Pode anular com Ctrl+Z.')) return;
        let changed = 0;
        const ok = change(() => { run(sql); changed = db.getRowsModified(); });
        if (ok) MO.toast(`Instrução executada. ${changed} registo(s) afetado(s).`);
        return;
      }
      try {
        const res = db.exec(sql);
        if (!res.length) { results.append(h('p', null, 'A consulta não devolveu resultados.')); status('0 resultados'); return; }
        const { columns, values } = res[res.length - 1];
        const shownRows = values.slice(0, 2000);
        results.append(h('table', { class: 'db-grid readonly' },
          h('thead', null, h('tr', null, columns.map((c) => h('th', null, c)))),
          h('tbody', null, shownRows.map((r) => h('tr', null, r.map((v) => h('td', { class: typeof v === 'number' ? 'num' : null }, v == null ? '' : typeof v === 'number' ? number.format(v) : v instanceof Uint8Array ? '(binário)' : String(v))))))));
        if (values.length > shownRows.length) results.append(h('p', null, `A mostrar 2000 de ${values.length} resultados.`));
        lastResult = { columns, values };
        status(`${values.length} resultado(s)`);
      } catch (e) {
        results.append(h('p', { class: 'db-error' }, friendly(e)));
      }
    };

    const saveQuery = async () => {
      const sql = editor.value.trim();
      if (!sql) return;
      const name = await askName('Guardar consulta', 'Nome da consulta', current.name || 'Consulta ' + (queries().length + 1));
      if (!name) return;
      if (change(() => { ensureMeta(); run('INSERT OR REPLACE INTO _mo_queries (name, sql) VALUES (?, ?)', [name, sql]); })) { current = { kind: 'query', name }; queryText = sql; renderAll(); }
    };
    const deleteQuery = () => {
      if (!current.name || !window.confirm(`Eliminar a consulta "${current.name}"?`)) return;
      change(() => run('DELETE FROM _mo_queries WHERE name = ?', [current.name]));
      current = { kind: 'query', name: null };
      renderAll();
    };

    // Perguntar em português: gera o SQL, mostra-o e executa (só consultas de leitura).
    const ask = h('input', { type: 'search', class: 'db-ask-input', placeholder: 'Pergunte em português: "clientes de Lisboa ativos", "total de vendas por cliente", "os 5 produtos mais caros"…', 'aria-label': 'Pergunta em português' });
    const explanation = h('p', { class: 'db-ask-explain', hidden: true });
    const doAsk = () => {
      const res = nlToSql(ask.value);
      if (res.error) { explanation.hidden = false; explanation.textContent = res.error; return; }
      editor.value = res.sql;
      queryText = res.sql;
      explanation.hidden = false;
      explanation.textContent = 'Entendi: ' + res.explanation + '. Confira o SQL abaixo; pode editá-lo.';
      execute();
    };
    ask.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doAsk(); } });
    contentBox.append(h('div', { class: 'db-query' },
      h('h2', null, current.name ? `Consulta: ${current.name}` : 'Nova consulta'),
      h('div', { class: 'db-ask' }, h('span', { class: 'db-ask-icon' }, '✦'), ask, h('button', { type: 'button', class: 'btn primary', onclick: doAsk }, 'Perguntar')),
      explanation,
      h('div', { class: 'db-builder' }, h('span', null, 'Mostrar'), tableSel, h('span', null, 'onde'), fieldSel, opSel, valueIn, h('span', null, 'ordenado por'), sortSel, h('button', { type: 'button', class: 'btn', onclick: build }, 'Criar consulta')),
      editor,
      h('div', { class: 'db-query-actions' },
        h('button', { type: 'button', class: 'btn primary', onclick: execute, title: 'Executar (Ctrl+Enter)' }, '▶ Executar'),
        h('button', { type: 'button', class: 'btn', onclick: saveQuery }, 'Guardar consulta'),
        current.name ? h('button', { type: 'button', class: 'btn danger', onclick: deleteQuery }, 'Eliminar consulta') : null,
        h('span', { class: 'db-hint' }, 'Os nomes com espaços ou acentos vão entre aspas: "Data de nascimento".')),
      results));
    status('Consulta');
    // Só as consultas de leitura voltam a correr sozinhas; instruções que alteram dados nunca.
    if (editor.value.trim() && !isWrite(editor.value)) execute();
  }
  let lastResult = null;
  const isWrite = (sql) => /^\s*(insert|update|delete|drop|alter|create|replace|vacuum|attach|detach|pragma|begin|commit|rollback|savepoint|release)\b/im.test(String(sql).replace(/--.*$/gm, ''));

  // ---------- Importar e exportar ----------

  function inferType(values) {
    const filled = values.filter((v) => v != null && String(v).trim() !== '');
    if (!filled.length) return 'text';
    if (filled.every((v) => typeof v === 'number' || /^-?\d+([.,]\d+)?$/.test(String(v).trim()))) return 'number';
    if (filled.every((v) => /^(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})/.test(String(v)))) return 'date';
    if (filled.every((v) => /^(verdadeiro|falso|true|false|sim|não|nao)$/i.test(String(v)))) return 'bool';
    return 'text';
  }

  function uniqueTable(name) {
    let base = String(name || 'Importação').replace(/[^\p{L}\p{N}_ \-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 50) || 'Importação';
    if (!/^[\p{L}\p{N}_]/u.test(base) || /^_mo_|^sqlite_/i.test(base)) base = 'T ' + base;
    const existing = new Set(tables().map((t) => t.toLowerCase()));
    let n = base; let i = 2;
    while (existing.has(n.toLowerCase())) n = `${base} (${i++})`;
    return n;
  }

  // header: nomes dos campos; data: linhas de valores. Devolve o nome da tabela criada.
  function importRows(name, header, data, types) {
    const seen = new Set();
    const cols = header.map((hd, i) => {
      let n = String(hd ?? '').replace(/[^\p{L}\p{N}_ \-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || `Campo ${i + 1}`;
      if (!/^[\p{L}\p{N}_]/u.test(n)) n = 'C ' + n;
      let u = n; let k = 2;
      while (seen.has(u.toLowerCase())) u = `${n} ${k++}`;
      seen.add(u.toLowerCase());
      return { name: u, type: (types && types[i]) || inferType(data.map((r) => r[i])), opts: {} };
    });
    const table = uniqueTable(name);
    ensureMeta();
    createTable(table, cols);
    const st = db.prepare(`INSERT INTO ${q(table)} VALUES (${cols.map(() => '?').join(', ')})`);
    try {
      for (const r of data.slice(0, 200000)) st.run(cols.map((c, i) => toStored(c, r[i] instanceof Date ? r[i].toISOString().slice(0, 10) : r[i])));
    } finally {
      st.free();
    }
    return table;
  }

  function parseCSV(text) {
    const first = text.split(/\r?\n/, 1)[0] || '';
    const sep = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ';' : ',';
    const out = [];
    let row = [], val = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') { val += '"'; i++; } else if (ch === '"') quoted = false; else val += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === sep) { row.push(val); val = ''; }
      else if (ch === '\n') { row.push(val.replace(/\r$/, '')); out.push(row); row = []; val = ''; }
      else val += ch;
    }
    if (val || row.length) { row.push(val); out.push(row); }
    return out.filter((r) => r.some((v) => v.trim() !== ''));
  }

  async function importFile(kind) {
    await boot();
    if (!db) newEmpty();
    const accept = kind === 'csv' ? '.csv,text/csv' : kind === 'accdb' ? '.accdb,.mdb' : '.xlsx';
    const picked = await MO.pickFile({ accept, binaryExt: ['xlsx', 'accdb', 'mdb'], maxBytes: 200 * 1024 * 1024 });
    if (!picked) return;
    const base = picked.name.replace(/\.[^.]+$/, '');
    let created = [];
    const ok = change(() => {
      if (kind === 'csv') {
        const data = parseCSV(String(picked.content));
        if (data.length < 1) throw new Error('O ficheiro CSV está vazio.');
        created.push(importRows(base, data[0], data.slice(1)));
      } else if (kind === 'xlsx') {
        const book = MO.OOXML.importXlsx(picked.content, 100000, 256);
        for (const sheet of book.sheets) {
          const values = MO.Formula.compute(sheet.cells, 100000, 256);
          const grid = [];
          for (const a of Object.keys(sheet.cells)) {
            const p = MO.Formula.parseAddr(a);
            if (!p) continue;
            (grid[p.r] ||= [])[p.c] = values.get(a);
          }
          const rowsOk = grid.filter(Boolean).map((r) => Array.from(r, (v) => (v == null || typeof v === 'object' ? (v && v.code ? null : v) : v)));
          if (rowsOk.length < 1) continue;
          created.push(importRows(book.sheets.length > 1 ? sheet.name : base, rowsOk[0], rowsOk.slice(1)));
        }
        if (!created.length) throw new Error('O livro não tem dados.');
      } else {
        if (!window.MDBReaderLib) throw new Error('Leitor de Access indisponível.');
        const { MDBReader, Buffer } = window.MDBReaderLib;
        const reader = new MDBReader(Buffer.from(picked.content));
        const MAP = { boolean: 'bool', byte: 'number', integer: 'number', long: 'number', float: 'number', double: 'number', numeric: 'number', bigint: 'number', currency: 'money', datetime: 'date', datetimeextended: 'date', text: 'text', memo: 'text', guid: 'text' };
        for (const name of reader.getTableNames()) {
          const t = reader.getTable(name);
          const cols = t.getColumns().filter((c) => Object.hasOwn(MAP, c.type));
          const data = t.getData().map((r) => cols.map((c) => { const v = r[c.name]; return v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === 'bigint' ? Number(v) : v; }));
          created.push(importRows(name, cols.map((c) => c.name), data, cols.map((c) => MAP[c.type])));
        }
        if (!created.length) throw new Error('O ficheiro Access não tem tabelas.');
      }
    });
    if (ok && created.length) {
      current = { kind: 'table', name: created[0] };
      mode = 'sheet';
      renderAll();
      MO.toast(`Importado: ${created.join(', ')}.`);
    }
  }

  // Dados da vista atual (tabela ou último resultado de uma consulta), para exportar e imprimir.
  function currentData() {
    if (current.kind === 'remote' || current.kind === 'remote-sql') return remoteData;
    if (mode === 'query') {
      if (!lastResult) return null;
      return { title: current.name || 'Consulta', columns: lastResult.columns, values: lastResult.values.map((r) => r.map((v) => (v instanceof Uint8Array ? '' : v))) };
    }
    if (!current.name) return null;
    const fs = fields(current.name);
    const links = linkMaps(fs);
    const data = rows(`SELECT * FROM ${q(current.name)} ORDER BY rowid LIMIT 200000`);
    return { title: current.name, columns: fs.map((f) => f.name), values: data.map((r) => fs.map((f) => (f.type === 'link' || f.type === 'bool' || f.type === 'date' ? shown(f, r[f.name], links.get(f.name)) : r[f.name]))) };
  }

  async function saveCopy(content, name, ext, filterName, mime) {
    if (!window.api) return MO.download(name, content, mime);
    const res = await window.api.save({ path: null, content, defaultName: name, filters: [{ name: filterName, extensions: [ext] }], remember: false });
    if (res && res.error) MO.toast(res.error);
    else if (res) MO.toast(`Exportado para ${res.name}.`);
  }

  function csvText() {
    const d = currentData();
    if (!d) throw new Error('Sem dados');
    const cell = (v) => { const t = v == null ? '' : typeof v === 'number' ? String(v).replace('.', ',') : String(v); return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    return '\ufeff' + [d.columns, ...d.values].map((r) => r.map(cell).join(';')).join('\r\n');
  }

  function xlsxBytes() {
    const d = currentData();
    if (!d) throw new Error('Sem dados');
    const F = MO.Formula;
    const cells = {};
    [d.columns, ...d.values].slice(0, 100000).forEach((r, i) => r.slice(0, 256).forEach((v, c) => {
      if (v == null || v === '') return;
      const text = typeof v === 'number' ? String(v) : String(v);
      cells[F.addr(i, c)] = { v: typeof v === 'string' && (/^[=']/.test(v) || F.parseNumber(v) !== null) ? "'" + v : text, ...(i === 0 ? { s: { b: true } } : {}) };
    }));
    return MO.OOXML.exportXlsx([{ name: d.title.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Dados', cells, values: F.compute(cells, 100001, 256) }]);
  }

  const withData = (fn) => { if (!currentData()) return MO.toast('Abra uma tabela ou execute uma consulta.'); fn(currentData().title); };
  const exportXlsx = () => withData((title) => saveCopy(xlsxBytes(), title + '.xlsx', 'xlsx', 'Livro do Excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'));
  const exportCsv = () => withData((title) => saveCopy(csvText(), title + '.csv', 'csv', 'Valores separados por ;', 'text/csv'));



  // ---------- Servidores (fase 2) ----------
  // As ligações são abertas pelo processo principal (dbserver.js); aqui só se mostram os dados.

  const KIND_LABEL = { mysql: 'MySQL / MariaDB', postgres: 'PostgreSQL', mssql: 'SQL Server' };
  const PORTS = { mysql: 3306, postgres: 5432, mssql: 1433 };
  let servers = []; // { id, kind, label, database, tables: [], open }
  let savedServers = [];
  let remoteData = null;
  let remoteLimit = 200;
  let remoteToken = 0;
  const dbs = () => window.api && window.api.dbs;
  const tableLabel = (t) => (t.schema ? t.schema + '.' : '') + t.name;

  async function call(name, ...args) {
    const res = await dbs()[name](...args);
    if (!res || !res.ok) throw new Error((res && res.error) || 'Erro desconhecido.');
    return res.result;
  }

  async function refreshSaved() {
    if (!dbs()) return;
    try { savedServers = await call('saved'); } catch { savedServers = []; }
    renderNav();
  }

  function serverNav() {
    if (!dbs()) return [];
    const out = [h('div', { class: 'db-nav-head' }, h('span', null, 'Servidores'), h('button', { type: 'button', class: 'db-nav-add', title: 'Ligar a um servidor', 'aria-label': 'Ligar a um servidor', onclick: () => connectDialog() }, '＋'))];
    for (const sv of servers) {
      out.push(h('div', { class: 'db-server' },
        h('button', { type: 'button', class: 'db-nav-item db-server-name', title: sv.version || sv.label, onclick: () => { sv.open = !sv.open; renderNav(); } }, h('span', { class: 'db-dot on' }), h('span', null, sv.label)),
        h('button', { type: 'button', class: 'db-nav-add', title: 'Desligar', 'aria-label': `Desligar ${sv.label}`, onclick: () => disconnect(sv) }, '⏏')));
      if (!sv.open) continue;
      out.push(h('button', { type: 'button', class: 'db-nav-item sub' + (current.kind === 'remote-sql' && current.conn === sv.id ? ' on' : ''), onclick: () => { current = { kind: 'remote-sql', conn: sv.id }; remoteData = null; renderAll(); } }, MO.icon('search'), h('span', null, 'Consulta SQL')));
      for (const t of sv.tables) {
        const on = current.kind === 'remote' && current.conn === sv.id && tableLabel(current.table) === tableLabel(t);
        out.push(h('button', { type: 'button', class: 'db-nav-item sub' + (on ? ' on' : ''), title: tableLabel(t), onclick: () => { current = { kind: 'remote', conn: sv.id, table: t }; sort = null; remoteLimit = 200; renderAll(); } }, MO.icon(t.view ? 'search' : 'table'), h('span', null, tableLabel(t))));
      }
    }
    for (const sv of savedServers) {
      if (servers.some((x) => x.savedId === sv.id)) continue;
      out.push(h('div', { class: 'db-server' },
        h('button', { type: 'button', class: 'db-nav-item db-server-name', title: `${KIND_LABEL[sv.kind]} · ${sv.host}`, onclick: () => connectDialog(sv) }, h('span', { class: 'db-dot' }), h('span', null, sv.name)),
        h('button', { type: 'button', class: 'db-nav-add', title: 'Esquecer esta ligação', 'aria-label': `Esquecer ${sv.name}`, onclick: async () => { if (window.confirm(`Esquecer a ligação "${sv.name}"?`)) { await call('forget', sv.id); refreshSaved(); } } }, '×')));
    }
    if (!servers.length && !savedServers.length) out.push(h('p', { class: 'db-nav-empty' }, 'Ligue a MySQL, PostgreSQL ou SQL Server.'));
    return out;
  }

  function connectDialog(saved) {
    if (!dbs()) return MO.toast('A ligação a servidores só está disponível na aplicação instalada.');
    const kind = h('select', { name: 'kind' }, Object.entries(KIND_LABEL).map(([k, l]) => h('option', { value: k, selected: saved ? saved.kind === k : k === 'mysql' }, l)));
    const host = h('input', { type: 'text', name: 'host', value: saved ? saved.host : 'localhost', required: true, autocomplete: 'off', spellcheck: 'false' });
    const port = h('input', { type: 'number', name: 'port', value: saved ? saved.port : PORTS[kind.value], min: 1, max: 65535 });
    const database = h('input', { type: 'text', name: 'database', value: saved ? saved.database : '', autocomplete: 'off', spellcheck: 'false' });
    const user = h('input', { type: 'text', name: 'user', value: saved ? saved.user : '', autocomplete: 'off', spellcheck: 'false' });
    const password = h('input', { type: 'password', name: 'password', autocomplete: 'new-password', placeholder: saved && saved.hasPassword ? '(guardada)' : '' });
    const ssl = h('input', { type: 'checkbox', checked: saved ? saved.ssl : false });
    const trust = h('input', { type: 'checkbox', checked: saved ? saved.trustCert : false });
    const name = h('input', { type: 'text', value: saved ? saved.name : '', placeholder: 'Ex.: Loja online', autocomplete: 'off' });
    const remember = h('input', { type: 'checkbox', checked: Boolean(saved) });
    const rememberPw = h('input', { type: 'checkbox', checked: Boolean(saved && saved.hasPassword) });
    const err = h('p', { class: 'db-error', hidden: true });
    kind.addEventListener('change', () => { port.value = PORTS[kind.value]; });
    const L = (label, input, hint) => h('label', { class: 'db-conn-field' }, h('span', null, label), input, hint ? h('small', null, hint) : null);
    const submit = h('button', { type: 'submit', class: 'btn primary' }, 'Ligar');
    const dlg = h('dialog', { class: 'mo-dialog db-conn-dialog' },
      h('form', { method: 'dialog' },
        h('h2', null, saved ? `Ligar a ${saved.name}` : 'Ligar a um servidor'),
        h('div', { class: 'db-conn-grid' },
          L('Tipo', kind), L('Nome desta ligação', name),
          L('Servidor', host, 'Endereço ou nome do computador (SQL Server: servidor\\instância)'), L('Porta', port),
          L('Base de dados', database), L('Utilizador', user), L('Palavra-passe', password),
          h('div', { class: 'db-conn-checks' },
            h('label', { class: 'chart-check' }, ssl, 'Ligação encriptada (TLS)'),
            h('label', { class: 'chart-check' }, trust, 'Confiar no certificado do servidor (servidores internos)'),
            h('label', { class: 'chart-check' }, remember, 'Guardar esta ligação'),
            h('label', { class: 'chart-check' }, rememberPw, 'Lembrar a palavra-passe (encriptada pelo sistema)'))),
        h('p', { class: 'db-hint' }, 'A ligação é feita apenas a este servidor. Use um utilizador com as permissões mínimas necessárias.'),
        err,
        h('div', { class: 'mo-dialog-actions' }, h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Cancelar'), submit)));
    dlg.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const cfg = { kind: kind.value, host: host.value.trim(), port: Number(port.value), database: database.value.trim(), user: user.value.trim(), password: password.value, ssl: ssl.checked, trustCert: trust.checked, name: name.value.trim() || database.value.trim() || host.value.trim(), savedId: saved ? saved.id : undefined };
      submit.disabled = true;
      submit.textContent = 'A ligar…';
      err.hidden = true;
      let info = null;
      try {
        info = await call('connect', cfg);
        let savedId = saved ? saved.id : undefined;
        if (remember.checked) {
          try {
            savedId = (await call('save', cfg, rememberPw.checked && Boolean(cfg.password))).id;
          } catch (saveError) {
            // Sem cofre seguro no sistema: guarda a ligação sem a palavra-passe.
            savedId = (await call('save', cfg, false)).id;
            MO.toast(saveError.message + ' A ligação foi guardada sem a palavra-passe.');
          }
        } else if (saved) await call('forget', saved.id);
        const tablesList = await call('tables', info.id);
        servers.push({ ...info, label: cfg.name, savedId, tables: tablesList, open: true });
        dlg.close();
        await refreshSaved();
        current = tablesList.length ? { kind: 'remote', conn: info.id, table: tablesList[0] } : { kind: 'remote-sql', conn: info.id };
        sort = null;
        renderAll();
        MO.toast(`Ligado a ${cfg.name} (${KIND_LABEL[cfg.kind]}).`);
      } catch (ex) {
        if (info && !servers.some((x) => x.id === info.id)) call('disconnect', info.id).catch(() => {});
        err.textContent = ex.message;
        err.hidden = false;
        submit.disabled = false;
        submit.textContent = 'Ligar';
      }
    });
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
    (saved ? password : host).focus();
  }

  async function disconnect(sv) {
    await call('disconnect', sv.id).catch(() => {});
    servers = servers.filter((x) => x !== sv);
    if (current.conn === sv.id) current = { kind: 'table', name: tables()[0] || null };
    renderAll();
  }

  const remoteGrid = (columns, data, cellFn) => h('table', { class: 'db-grid' + (cellFn ? '' : ' readonly') },
    h('thead', null, h('tr', null, columns.map((c) => (typeof c === 'string' ? h('th', null, c) : c)))),
    h('tbody', null, data));

  async function renderRemoteTable() {
    const token = ++remoteToken;
    const sv = servers.find((x) => x.id === current.conn);
    const t = current.table;
    contentBox.append(h('p', { class: 'db-hint' }, 'A carregar…'));
    let cols, res;
    try {
      cols = await call('columns', sv.id, t);
      res = await call('rows', sv.id, t, { limit: remoteLimit, orderBy: sort ? sort.field : '', dir: sort ? sort.dir : 'asc' });
    } catch (e) {
      if (token !== remoteToken) return;
      contentBox.replaceChildren(h('p', { class: 'db-error' }, e.message));
      return;
    }
    if (token !== remoteToken) return;
    const pk = cols.filter((c) => c.pk).map((c) => c.name);
    const editable = pk.length > 0 && !t.view;
    remoteData = { title: tableLabel(t), columns: res.columns, values: res.rows };
    const keyOf = (row) => Object.fromEntries(pk.map((k) => [k, row[res.columns.indexOf(k)]]));
    const head = res.columns.map((c) => {
      const arrow = sort && sort.field === c ? (sort.dir === 'desc' ? ' ▼' : ' ▲') : '';
      const info = cols.find((x) => x.name === c);
      return h('th', { title: `${info ? info.type : ''}${info && info.pk ? ' · chave primária' : ''} · clique para ordenar`, onclick: () => { sort = sort && sort.field === c && sort.dir === 'asc' ? { field: c, dir: 'desc' } : { field: c, dir: 'asc' }; renderAll(); } }, info && info.pk ? '🔑 ' : '', c + arrow);
    });
    const body = res.rows.map((row) => h('tr', null,
      editable ? h('td', { class: 'db-rownum' }, h('button', { type: 'button', class: 'db-row-del', title: 'Eliminar registo', 'aria-label': 'Eliminar registo', onclick: async () => {
        if (!window.confirm('Eliminar este registo no servidor? Esta operação não pode ser anulada.')) return;
        try { await call('remove', sv.id, t, keyOf(row)); renderAll(); } catch (e) { MO.toast(e.message); }
      } }, '×')) : null,
      row.map((v, i) => {
        const col = cols.find((x) => x.name === res.columns[i]);
        if (!editable || !col || col.auto) return h('td', { class: typeof v === 'number' ? 'num' : null, style: 'padding:7px 10px' }, v == null ? '' : String(v));
        const input = h('input', { type: 'text', value: v == null ? '' : String(v), 'aria-label': res.columns[i] });
        input.addEventListener('change', async () => {
          try {
            await call('update', sv.id, t, keyOf(row), res.columns[i], input.value);
            row[i] = input.value;
            MO.toast('Guardado no servidor.');
          } catch (e) {
            MO.toast(e.message);
            input.value = v == null ? '' : String(v);
          }
        });
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
        return h('td', { class: 'db-cell' }, input);
      })));
    const actions = h('div', { class: 'db-query-actions' },
      editable ? h('button', { type: 'button', class: 'btn', onclick: async () => { try { await call('insert', sv.id, t); sort = null; remoteLimit = Math.max(remoteLimit, res.total + 1); renderAll(); } catch (e) { MO.toast(e.message); } } }, '＋ Novo registo') : null,
      h('button', { type: 'button', class: 'btn', onclick: () => renderAll() }, '↻ Atualizar'),
      h('button', { type: 'button', class: 'btn', onclick: () => copyToLocal(sv, t) }, 'Copiar para a base local'),
      h('span', { class: 'db-hint' }, editable ? 'As alterações são gravadas logo no servidor.' : t.view ? 'Vista: só leitura.' : 'Sem chave primária: só leitura.'));
    contentBox.replaceChildren(h('div', { class: 'db-grid-wrap' },
      h('h2', { class: 'db-remote-title' }, `${sv.label} · ${tableLabel(t)}`),
      actions,
      remoteGrid(editable ? [h('th', { class: 'db-rownum' }, ''), ...head] : head, body, editable),
      res.rows.length < res.total ? h('button', { type: 'button', class: 'btn db-more', onclick: () => { remoteLimit += 200; renderAll(); } }, `Mostrar mais (${res.total - res.rows.length} restantes)`) : null));
    status(`${KIND_LABEL[sv.kind]} · ${tableLabel(t)} · ${res.total} registo(s)`);
  }

  function renderRemoteSql() {
    const sv = servers.find((x) => x.id === current.conn);
    const editor = h('textarea', { class: 'db-sql', spellcheck: 'false', rows: 7, 'aria-label': 'Consulta SQL', placeholder: sv.kind === 'mssql' ? 'SELECT TOP 100 * FROM clientes' : 'SELECT * FROM clientes LIMIT 100' });
    editor.value = sv.lastSql || (sv.tables[0] ? (sv.kind === 'mssql' ? `SELECT TOP 100 * FROM ${tableLabel(sv.tables[0])}` : `SELECT * FROM ${tableLabel(sv.tables[0])} LIMIT 100`) : '');
    const results = h('div', { class: 'db-results' });
    const execute = async () => {
      const sql = editor.value.trim();
      sv.lastSql = editor.value;
      results.replaceChildren();
      if (!sql) return;
      if (isWrite(sql) || /^\s*(truncate|grant|revoke|merge|exec|execute|call|use|set)\b/im.test(sql)) {
        const risky = /^\s*(delete|update)\b(?![\s\S]*\bwhere\b)/im.test(sql) || /^\s*(drop|truncate)\b/im.test(sql);
        if (!window.confirm((risky ? 'ATENÇÃO: esta instrução altera ou apaga dados SEM condição (WHERE), ou elimina uma tabela, ' : 'Esta instrução altera dados ') + `no servidor "${sv.label}". Não pode ser anulada aqui. Continuar?`)) return;
      }
      results.append(h('p', { class: 'db-hint' }, 'A executar…'));
      try {
        const res = await call('query', sv.id, sql);
        results.replaceChildren();
        if (!res.columns.length) { results.append(h('p', null, `Instrução executada. ${res.affected} registo(s) afetado(s).`)); remoteData = null; status('Executado'); sv.tables = await call('tables', sv.id).catch(() => sv.tables); renderNav(); return; }
        remoteData = { title: 'Consulta', columns: res.columns, values: res.rows };
        results.append(remoteGrid(res.columns, res.rows.slice(0, 2000).map((r) => h('tr', null, r.map((v) => h('td', { class: typeof v === 'number' ? 'num' : null }, v == null ? '' : String(v)))))));
        if (res.truncated) results.append(h('p', { class: 'db-hint' }, 'Resultado limitado a 5000 linhas.'));
        status(`${res.rows.length} resultado(s)`);
      } catch (e) {
        results.replaceChildren(h('p', { class: 'db-error' }, e.message));
      }
    };
    editor.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); execute(); } });
    contentBox.append(h('div', { class: 'db-query' },
      h('h2', null, `Consulta SQL · ${sv.label}`),
      h('p', { class: 'db-hint' }, `${KIND_LABEL[sv.kind]}${sv.version ? ' · ' + sv.version : ''}. As instruções correm diretamente no servidor.`),
      editor,
      h('div', { class: 'db-query-actions' }, h('button', { type: 'button', class: 'btn primary', onclick: execute, title: 'Executar (Ctrl+Enter)' }, '▶ Executar'), h('span', { class: 'db-hint' }, 'Exporte o resultado em Dados externos › Para Excel ou Para CSV.')),
      results));
    status(`${KIND_LABEL[sv.kind]} · consulta`);
  }

  // Copia uma tabela do servidor (até 100 000 registos) para a base de dados local.
  async function copyToLocal(sv, t) {
    try {
      const cols = await call('columns', sv.id, t);
      const all = [];
      let res;
      do {
        res = await call('query', sv.id, sv.kind === 'mssql'
          ? `SELECT * FROM ${t.schema ? `[${t.schema.replace(/]/g, ']]')}].` : ''}[${t.name.replace(/]/g, ']]')}] ORDER BY (SELECT NULL) OFFSET ${all.length} ROWS FETCH NEXT 5000 ROWS ONLY`
          : `SELECT * FROM ${sv.kind === 'mysql' ? (t.schema ? '`' + t.schema.replace(/`/g, '``') + '`.' : '') + '`' + t.name.replace(/`/g, '``') + '`' : (t.schema ? q(t.schema) + '.' : '') + q(t.name)} LIMIT 5000 OFFSET ${all.length}`);
        all.push(...res.rows);
      } while (res.rows.length === 5000 && all.length < 100000);
      const typeOf = (c) => (/int|serial|float|double|real|numeric|decimal|money/i.test(c.type) ? (/money|decimal|numeric/i.test(c.type) ? 'money' : 'number') : /date|time/i.test(c.type) ? 'date' : /bool|bit|tinyint/i.test(c.type) ? 'bool' : 'text');
      let made = null;
      if (change(() => { made = importRows(t.name, res.columns, all, res.columns.map((n) => { const c = cols.find((x) => x.name === n); return c ? typeOf(c) : 'text'; })); })) {
        current = { kind: 'table', name: made };
        mode = 'sheet';
        renderAll();
        MO.toast(`${all.length} registo(s) copiados para a tabela local "${made}".`);
      }
    } catch (e) {
      MO.toast(e.message);
    }
  }

  // Envia a tabela local aberta para um servidor ligado.
  async function pushTable() {
    if (current.kind !== 'table' || !current.name) return MO.toast('Abra primeiro uma tabela local.');
    if (!servers.length) return MO.toast('Ligue primeiro a um servidor (Dados externos › Ligar a servidor).');
    const select = h('select', null, servers.map((sv) => h('option', { value: sv.id }, sv.label)));
    const name = h('input', { type: 'text', value: current.name });
    const dlg = h('dialog', { class: 'mo-dialog' }, h('form', { method: 'dialog' },
      h('h2', null, 'Enviar tabela para um servidor'),
      h('label', { class: 'db-conn-field' }, h('span', null, 'Servidor'), select),
      h('label', { class: 'db-conn-field' }, h('span', null, 'Nome da nova tabela no servidor'), name),
      h('p', { class: 'db-hint' }, 'É criada uma tabela nova, com um campo "id" como chave primária. Não altera tabelas existentes.'),
      h('div', { class: 'mo-dialog-actions' }, h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Cancelar'), h('button', { type: 'submit', class: 'btn primary', value: 'ok' }, 'Enviar'))));
    dlg.addEventListener('close', async () => {
      dlg.remove();
      if (dlg.returnValue !== 'ok') return;
      const sv = servers.find((x) => x.id === select.value);
      const fs = fields(current.name);
      const data = rows(`SELECT * FROM ${q(current.name)} ORDER BY rowid LIMIT 200000`).map((r) => fs.map((f) => r[f.name]));
      try {
        const res = await call('push', sv.id, name.value.trim(), fs.map((f) => ({ name: f.name, type: f.type })), data);
        sv.tables = await call('tables', sv.id);
        renderNav();
        MO.toast(`${res.rows} registo(s) enviados para ${sv.label}.`);
      } catch (e) {
        MO.toast(e.message);
      }
    });
    document.body.append(dlg);
    dlg.showModal();
  }

  // ---------- Fita ----------

  function buildRibbon() {
    const B = MO.bigButton;
    const I = MO.iconButton;
    const modeBtn = (key, icon, label, title) => {
      const b = B(icon, label, title, () => { if (key === 'rel') { if (current.kind !== 'table') current = { kind: 'table', name: tables()[0] || null }; mode = 'rel'; renderAll(); return; } if (key !== 'query' && !current.name) return MO.toast('Crie ou abra primeiro uma tabela.'); if (key === 'query') { open('query', null); return; } if (current.kind === 'query') current = { kind: 'table', name: tables()[0] || null }; mode = key; formIndex = 0; renderAll(); });
      b.classList.add('db-mode');
      b.dataset.mode = key;
      return b;
    };
    searchInput = h('input', { type: 'search', class: 'db-search', placeholder: 'Procurar na tabela…', 'aria-label': 'Procurar na tabela' });
    searchInput.addEventListener('input', () => { if (mode === 'sheet') { limit = PAGE; renderAll(); } });
    const tpl = (key, label, title) => MO.toolButton(label, title, () => MO.modules.db.newDoc(key), 'wide');
    return MO.ribbon([
      {
        label: 'Base',
        groups: [
          { label: 'Anular', rows: [[I('undo', 'Anular (Ctrl+Z)', undo), I('redo', 'Refazer (Ctrl+Y)', redo)]] },
          { label: 'Vistas', rows: [[modeBtn('sheet', 'table', 'Folha de dados', 'Ver e editar os registos em tabela')], [modeBtn('form', 'textBox', 'Formulário', 'Ver e editar um registo de cada vez, com os registos ligados')], [modeBtn('design', 'pageSetup', 'Estrutura', 'Campos, tipos e regras da tabela')], [modeBtn('rel', 'branch', 'Relações', 'Diagrama das tabelas e das ligações entre elas')]] },
          { label: 'Registos', rows: [[B('rowAdd', 'Novo registo', 'Acrescentar um registo', newRecord)], [searchInput]] },
          { label: 'Tabelas', rows: [[B('slideNew', 'Nova tabela', 'Criar uma tabela', newTable)]] }
        ]
      },
      {
        label: 'Criar',
        groups: [
          { label: 'Consultas e relatórios', rows: [[modeBtn('query', 'search', 'Consulta', 'Filtrar, ordenar e juntar dados (com ou sem SQL)')], [B('presenter', 'Relatório', 'Pré-visualizar e imprimir a tabela ou o resultado da consulta', report)]] },
          { label: 'Modelos', rows: [[tpl('clientes', 'Clientes', 'Base de dados de clientes'), tpl('inventario', 'Inventário', 'Produtos, preços e stock')], [tpl('encomendas', 'Encomendas', 'Clientes, produtos e encomendas ligadas'), tpl('blank', 'Em branco', 'Base de dados vazia')]] }
        ]
      },
      {
        label: 'Dados externos',
        groups: [
          { label: 'Importar', rows: [[B('grid', 'Excel', 'Importar as folhas de um livro do Excel como tabelas', () => importFile('xlsx')), B('export', 'CSV', 'Importar um ficheiro CSV como tabela', () => importFile('csv'))], [B('folder', 'Access', 'Importar as tabelas de um ficheiro do Access (.accdb, .mdb)', () => importFile('accdb'))]] },
          ...(window.api && window.api.dbs ? [{ label: 'Servidores', rows: [[B('branch', 'Ligar a servidor', 'Ligar a MySQL, MariaDB, PostgreSQL ou SQL Server', () => connectDialog())], [B('export', 'Enviar tabela', 'Copiar a tabela local aberta para um servidor ligado', pushTable)]] }] : []),
          { label: 'Exportar', rows: [[B('grid', 'Para Excel', 'Exportar a tabela ou o resultado da consulta para Excel', exportXlsx), B('export', 'Para CSV', 'Exportar a tabela ou o resultado da consulta para CSV', exportCsv)]] }
        ]
      }
    ], () => ctx.file());
  }

  function newEmpty() {
    if (db) db.close();
    db = new SQL.Database();
    ensureMeta();
  }

  MO.modules.db = {
    id: 'db',
    label: 'Bases de dados',
    ext: 'modb',
    binary: true,
    noDrafts: true,
    filterName: 'Base de dados MyOffice',
    defaultName: 'Base de dados',

    init(container, context) {
      ctx = context;
      navBox = h('nav', { class: 'db-nav', 'aria-label': 'Objetos da base de dados' });
      contentBox = h('div', { class: 'db-content' });
      statusEl = h('span', { class: 'status-text' }, 'A preparar…');
      container.append(buildRibbon(), h('div', { class: 'db-shell' }, navBox, contentBox), h('div', { class: 'statusbar' }, statusEl));
      document.addEventListener('keydown', (e) => {
        if (!isActive() || !db || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
        const mod = e.ctrlKey || e.metaKey;
        if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
        else if (mod && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); redo(); }
      });
      boot().then(() => { if (!db) { newEmpty(); renderAll(); } refreshSaved(); }).catch(() => status('O motor de base de dados não está disponível.'));
    },

    async newDoc(templateName) {
      await boot();
      newEmpty();
      undoStack = [];
      redoStack = [];
      if (templateName && templateName !== 'blank') template(templateName);
      current = { kind: 'table', name: tables()[0] || null };
      mode = 'sheet';
      if (searchInput) searchInput.value = '';
      renderAll();
    },

    serialize() {
      if (!db) throw new Error('Sem base de dados');
      return db.export();
    },

    async load(content, ext) {
      await boot();
      const bytes = content instanceof Uint8Array ? content : new Uint8Array(content);
      if (ext === 'accdb' || ext === 'mdb') {
        newEmpty();
        const { MDBReader, Buffer } = window.MDBReaderLib || {};
        if (!MDBReader) throw new Error('Leitor de Access indisponível');
        const reader = new MDBReader(Buffer.from(bytes));
        const MAP = { boolean: 'bool', byte: 'number', integer: 'number', long: 'number', float: 'number', double: 'number', numeric: 'number', bigint: 'number', currency: 'money', datetime: 'date', datetimeextended: 'date', text: 'text', memo: 'text', guid: 'text' };
        for (const name of reader.getTableNames()) {
          const t = reader.getTable(name);
          const cols = t.getColumns().filter((c) => Object.hasOwn(MAP, c.type));
          importRows(name, cols.map((c) => c.name), t.getData().map((r) => cols.map((c) => { const v = r[c.name]; return v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === 'bigint' ? Number(v) : v; })), cols.map((c) => MAP[c.type]));
        }
      } else {
        // Ficheiro SQLite: começa por "SQLite format 3".
        if (String.fromCharCode(...bytes.slice(0, 15)) !== 'SQLite format 3') throw new Error('Formato inválido');
        const next = new SQL.Database(bytes);
        next.exec('SELECT count(*) FROM sqlite_master');
        if (db) db.close();
        db = next;
        ensureMeta();
      }
      undoStack = [];
      redoStack = [];
      current = { kind: 'table', name: tables()[0] || null };
      mode = 'sheet';
      if (searchInput) searchInput.value = '';
      renderAll();
    },

    exports: [
      { label: 'Tabela ou consulta atual para Excel (.xlsx)', ext: 'xlsx', filterName: 'Livro do Excel', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', get: () => xlsxBytes() },
      { label: 'Tabela ou consulta atual para CSV (.csv)', ext: 'csv', filterName: 'Valores separados por ;', mime: 'text/csv', get: () => csvText() }
    ],

    // Relatório: a tabela ou o resultado da consulta, pronto a imprimir.
    print() {
      const d = currentData();
      return { node: reportNode(), page: d && d.columns.length > 6 ? 'A4 landscape' : 'A4', margin: '14mm', pageRule: '@bottom-right { content: counter(page) " / " counter(pages); font: 9pt Arial; color: #667085; }' };
    },

    // Usado pelos testes.
    _debug: { nl: (t) => nlToSql(t), reportHTML: () => reportNode().outerHTML, setReport: (c) => { reportCfg = c; }, servers: () => servers, sql: (s, p) => rows(s, p), tables: () => tables(), fields: (t) => fields(t), state: () => ({ current, mode }) },

    show() { if (db) renderAll(); }
  };
})();
