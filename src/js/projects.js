'use strict';

// MyOffice Projetos: planeamento de projetos com tarefas, dependências e gráfico de Gantt.
// As datas guardam-se como 'AAAA-MM-DD'; internamente usam-se números de dias (UTC).
(function () {
  const MO = window.MO;
  const { h } = MO;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const ROW = 32;
  const HEAD = 48;
  const MAX_TASKS = 1000;
  const MAX_UNDO = 60;
  const SCALES = { days: { label: 'Dias', px: 30 }, weeks: { label: 'Semanas', px: 12 }, months: { label: 'Meses', px: 4 } };
  const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

  let ctx, tableBody, tableWrap, ganttWrap, svg, statusEl, scaleSel;
  let project = null;
  let selected = -1;
  let undoStack = [];
  let redoStack = [];
  let seq = 0;
  const uid = () => 't' + Date.now().toString(36) + (seq++).toString(36);

  // ---------- Datas ----------

  const DAY = 86400000;
  const toDay = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY) : null; };
  const toIso = (d) => new Date(d * DAY).toISOString().slice(0, 10);
  const dow = (d) => new Date(d * DAY).getUTCDay();
  const weekend = (d) => { const w = dow(d); return w === 0 || w === 6; };
  const today = () => { const t = new Date(); return Math.round(Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()) / DAY); };
  const fmtDate = (d) => new Date(d * DAY).toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'UTC' });

  // Avança para o próximo dia de trabalho (se os fins de semana não contam).
  function nextWork(d) { if (!project.workdays) return d; while (weekend(d)) d++; return d; }
  // Último dia de uma tarefa com N dias de duração a começar em d.
  function addWork(d, n) {
    if (n <= 1) return d;
    if (!project.workdays) return d + n - 1;
    let left = n - 1;
    while (left > 0) { d++; if (!weekend(d)) left--; }
    return d;
  }
  function workBetween(a, b) {
    if (!project.workdays) return b - a;
    let n = 0;
    for (let d = a + 1; d <= b; d++) if (!weekend(d)) n++;
    return n;
  }

  // ---------- Modelo ----------

  function task(name, duration, extra = {}) {
    return { id: uid(), name, start: null, duration, progress: 0, who: '', deps: [], level: 0, milestone: false, notes: '', ...extra };
  }

  function templates(name) {
    const base = toIso(nextWorkStatic(today()));
    const make = (rows) => {
      // Duração 0 é um marco, exceto nas fases que têm subtarefas por baixo.
      const tasks = rows.map(([n, d, lvl, deps, extra], i) => task(n, d || 1, { level: lvl, milestone: d === 0 && !(rows[i + 1] && rows[i + 1][2] > lvl), ...(extra || {}) }));
      rows.forEach(([, , , deps], i) => { tasks[i].deps = (deps || []).map((k) => tasks[k].id); });
      tasks[0].start = base;
      return { name: '', start: base, workdays: true, tasks };
    };
    if (name === 'launch') {
      return make([
        ['Preparação', 0, 0, []], ['Estudo de mercado', 5, 1, []], ['Definir preço e público', 3, 1, [1]],
        ['Produto', 0, 0, []], ['Desenvolvimento', 15, 1, [2]], ['Testes com clientes', 5, 1, [4]],
        ['Comunicação', 0, 0, []], ['Campanha e site', 10, 1, [2]], ['Formação da equipa de vendas', 3, 1, [5]],
        ['Lançamento', 0, 0, [5, 7, 8]]
      ]);
    }
    if (name === 'event') {
      return make([
        ['Definir data, local e orçamento', 3, 0, []], ['Reservar espaço', 2, 0, [0]], ['Convidar oradores', 5, 0, [0]],
        ['Programa final', 2, 0, [2]], ['Inscrições abertas', 0, 0, [3]], ['Logística (catering, som, material)', 8, 0, [1]],
        ['Ensaio geral', 1, 0, [5]], ['Dia do evento', 0, 0, [6, 4]], ['Balanço e agradecimentos', 2, 0, [7]]
      ]);
    }
    if (name === 'blank') return { name: '', start: base, workdays: true, tasks: [task('Nova tarefa', 3, { start: base })] };
    return make([
      ['Arranque', 2, 0, []], ['Planeamento', 5, 0, [0]], ['Execução', 0, 0, []],
      ['Fase 1', 10, 1, [1]], ['Fase 2', 8, 1, [3]], ['Revisão', 3, 0, [4]], ['Entrega', 0, 0, [5]]
    ]);
  }
  function nextWorkStatic(d) { while (weekend(d)) d++; return d; }

  const isSummary = (i) => project.tasks[i + 1] && project.tasks[i + 1].level > project.tasks[i].level;
  function children(i) {
    const out = [];
    for (let k = i + 1; k < project.tasks.length && project.tasks[k].level > project.tasks[i].level; k++) out.push(k);
    return out;
  }

  // ---------- Calendarização ----------
  // Cada tarefa começa na sua data (ou na do projeto) e nunca antes do fim das que a precedem.
  function schedule() {
    const tasks = project.tasks;
    const byId = new Map(tasks.map((t, i) => [t.id, i]));
    const projStart = toDay(project.start) ?? today();
    const s = new Array(tasks.length);
    const e = new Array(tasks.length);
    const state = new Array(tasks.length).fill(0); // 0 por fazer, 1 a calcular, 2 feito
    const leafOf = (i) => !isSummary(i);
    function calc(i) {
      if (state[i] === 2) return;
      if (state[i] === 1) { tasks[i].deps = []; } // ciclo: quebra a dependência
      state[i] = 1;
      const t = tasks[i];
      if (!leafOf(i)) {
        const kids = children(i).filter(leafOf);
        kids.forEach(calc);
        s[i] = kids.length ? Math.min(...kids.map((k) => s[k])) : projStart;
        e[i] = kids.length ? Math.max(...kids.map((k) => e[k])) : projStart;
        state[i] = 2;
        return;
      }
      let start = toDay(t.start) ?? projStart;
      for (const id of t.deps) {
        const j = byId.get(id);
        if (j == null || j === i) continue;
        calc(j);
        const after = tasks[j].milestone ? e[j] : e[j] + 1;
        if (after > start) start = after;
      }
      start = nextWork(start);
      s[i] = start;
      e[i] = t.milestone ? start : addWork(start, Math.max(1, t.duration));
      state[i] = 2;
    }
    tasks.forEach((_t, i) => calc(i));
    // Caminho crítico: folga = último fim possível − fim calculado.
    const end = tasks.length ? Math.max(...e) : projStart;
    const late = new Array(tasks.length).fill(end);
    const succ = tasks.map(() => []);
    tasks.forEach((t, i) => t.deps.forEach((id) => { const j = byId.get(id); if (j != null) succ[j].push(i); }));
    const order = tasks.map((_t, i) => i).filter(leafOf).sort((a, b) => e[b] - e[a]);
    for (const i of order) {
      for (const k of succ[i]) if (leafOf(k)) late[i] = Math.min(late[i], s[k] - (tasks[i].milestone ? 0 : 1));
    }
    const critical = tasks.map((_t, i) => leafOf(i) && workBetween(e[i], late[i]) <= 0);
    return { s, e, critical, start: tasks.length ? Math.min(...s) : projStart, end };
  }

  // ---------- Histórico ----------

  const snapshot = () => JSON.stringify(project);
  function remember() { undoStack.push(snapshot()); if (undoStack.length > MAX_UNDO) undoStack.shift(); redoStack = []; }
  function undo() { if (!undoStack.length) return; redoStack.push(snapshot()); project = JSON.parse(undoStack.pop()); render(); ctx.dirty(); }
  function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); project = JSON.parse(redoStack.pop()); render(); ctx.dirty(); }
  function changed() { ctx.dirty(); render(); }

  // ---------- Ações ----------

  function addTask(milestone) {
    if (project.tasks.length >= MAX_TASKS) return MO.toast('O projeto chegou ao limite de tarefas.');
    remember();
    const at = selected >= 0 ? selected + 1 : project.tasks.length;
    const prev = project.tasks[at - 1];
    const t = task(milestone ? 'Novo marco' : 'Nova tarefa', milestone ? 0 : 3, { milestone, level: prev ? (isSummary(at - 1) ? prev.level + 1 : prev.level) : 0, deps: prev && !isSummary(at - 1) ? [prev.id] : [] });
    project.tasks.splice(at, 0, t);
    selected = at;
    changed();
    focusCell(at, 'name');
  }

  function deleteTask() {
    if (selected < 0) return MO.toast('Selecione uma tarefa.');
    remember();
    const [gone] = project.tasks.splice(selected, 1);
    project.tasks.forEach((t) => { t.deps = t.deps.filter((d) => d !== gone.id); });
    selected = Math.min(selected, project.tasks.length - 1);
    changed();
  }

  function indent(delta) {
    if (selected < 0) return MO.toast('Selecione uma tarefa.');
    const t = project.tasks[selected];
    const prev = project.tasks[selected - 1];
    const next = Math.max(0, Math.min(prev ? prev.level + 1 : 0, t.level + delta));
    if (next === t.level) return;
    remember();
    const kids = children(selected);
    t.level = next;
    kids.forEach((k) => { project.tasks[k].level = Math.max(0, project.tasks[k].level + delta); });
    changed();
  }

  function move(delta) {
    const i = selected;
    const j = i + delta;
    if (i < 0 || j < 0 || j >= project.tasks.length) return;
    remember();
    [project.tasks[i], project.tasks[j]] = [project.tasks[j], project.tasks[i]];
    selected = j;
    changed();
  }

  function linkWithPrevious() {
    if (selected < 1) return MO.toast('Selecione uma tarefa abaixo de outra.');
    const t = project.tasks[selected];
    let p = selected - 1;
    while (p >= 0 && isSummary(p)) p--;
    if (p < 0) return;
    remember();
    const id = project.tasks[p].id;
    t.deps = t.deps.includes(id) ? t.deps.filter((d) => d !== id) : [...t.deps, id];
    changed();
  }

  async function projectInfo() {
    const res = await MO.dialog({
      title: 'Informações do projeto',
      fields: [
        { name: 'name', label: 'Nome do projeto', value: project.name, placeholder: 'Ex.: Lançamento da loja online' },
        { name: 'start', label: 'Data de início', type: 'date', value: project.start }
      ],
      okLabel: 'Aplicar'
    });
    if (!res) return;
    remember();
    project.name = res.name.trim().slice(0, 120);
    if (toDay(res.start) != null) {
      // As tarefas sem dependências acompanham a nova data de início.
      const shift = toDay(res.start) - (toDay(project.start) ?? toDay(res.start));
      project.start = res.start;
      if (shift) project.tasks.forEach((t) => { if (t.start) t.start = toIso(toDay(t.start) + shift); });
    }
    changed();
  }

  // ---------- Tabela ----------

  const COLS = [
    ['wbs', '#', 40], ['name', 'Tarefa', 210], ['duration', 'Dias', 54], ['start', 'Início', 122],
    ['end', 'Fim', 74], ['progress', '%', 58], ['who', 'Responsável', 104], ['deps', 'Depende de', 78]
  ];

  function wbsNumbers() {
    const counters = [];
    return project.tasks.map((t) => {
      counters.length = t.level + 1;
      counters[t.level] = (counters[t.level] || 0) + 1;
      return counters.map((n) => n || 1).join('.');
    });
  }

  function renderTable(sch) {
    const wbs = wbsNumbers();
    const rowOf = new Map(project.tasks.map((t, i) => [t.id, i + 1]));
    tableBody.replaceChildren(...project.tasks.map((t, i) => {
      const summary = isSummary(i);
      const tr = h('tr', { class: (i === selected ? 'is-selected ' : '') + (summary ? 'is-summary ' : '') + (sch.critical[i] && project.showCritical ? 'is-critical' : ''), 'data-row': i });
      tr.addEventListener('pointerdown', () => { if (selected !== i) { selected = i; highlight(); } });
      const cell = (key, content) => h('td', { class: 'col-' + key }, content);
      const input = (key, value, opts = {}) => {
        const el = h('input', { type: opts.type || 'text', value: value ?? '', 'data-key': key, 'aria-label': key, readonly: opts.readonly || undefined, min: opts.min, max: opts.max });
        el.addEventListener('change', () => edit(i, key, el.value));
        el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } });
        return el;
      };
      const keep = new Set(visibleCols().map(([k]) => k));
      const all = [
        cell('wbs', h('span', null, wbs[i])),
        cell('name', h('div', { class: 'proj-name', style: `padding-left:${t.level * 16}px` }, t.milestone && !summary ? h('span', { class: 'proj-diamond', title: 'Marco' }, '◆') : null, input('name', t.name))),
        cell('duration', summary ? h('span', { class: 'proj-ro' }, `${workBetween(sch.s[i], sch.e[i]) + 1} d`) : input('duration', t.milestone ? '0' : String(t.duration), { type: 'number', min: 0, max: 3650 })),
        cell('start', summary ? h('span', { class: 'proj-ro' }, fmtDate(sch.s[i])) : input('start', toIso(sch.s[i]), { type: 'date' })),
        cell('end', h('span', { class: 'proj-ro' }, fmtDate(sch.e[i]))),
        cell('progress', summary ? h('span', { class: 'proj-ro' }, summaryProgress(i, sch) + '%') : input('progress', String(t.progress), { type: 'number', min: 0, max: 100 })),
        cell('who', input('who', t.who)),
        cell('deps', summary ? '' : input('deps', t.deps.map((d) => rowOf.get(d)).filter(Boolean).join(';')))
      ];
      tr.append(...all.filter((td) => keep.has(td.className.replace('col-', ''))));
      return tr;
    }));
  }

  function summaryProgress(i, sch) {
    let work = 0;
    let done = 0;
    for (const k of children(i)) {
      if (isSummary(k)) continue;
      const w = project.tasks[k].milestone ? 0 : workBetween(sch.s[k], sch.e[k]) + 1;
      work += w;
      done += w * project.tasks[k].progress / 100;
    }
    return work ? Math.round(done / work * 100) : 0;
  }

  function edit(i, key, raw) {
    const t = project.tasks[i];
    remember();
    if (key === 'name') t.name = raw.slice(0, 200) || 'Tarefa';
    else if (key === 'who') t.who = raw.slice(0, 80);
    else if (key === 'progress') t.progress = Math.max(0, Math.min(100, Math.round(Number(raw) || 0)));
    else if (key === 'duration') {
      const n = Math.max(0, Math.min(3650, Math.round(Number(raw) || 0)));
      t.milestone = n === 0;
      t.duration = n || t.duration || 1;
    } else if (key === 'start') { if (toDay(raw) != null) t.start = raw; }
    else if (key === 'deps') {
      // Números das linhas separados por ; ou ,
      const ids = [];
      for (const part of raw.split(/[;,\s]+/)) {
        const n = Number(part);
        const target = project.tasks[n - 1];
        if (Number.isInteger(n) && target && n - 1 !== i && !isSummary(n - 1)) ids.push(target.id);
      }
      t.deps = [...new Set(ids)];
    }
    changed();
  }

  function focusCell(i, key) {
    requestAnimationFrame(() => {
      const el = tableBody.querySelector(`tr[data-row="${i}"] input[data-key="${key}"]`);
      if (el) { el.focus(); el.select(); }
    });
  }

  function highlight() {
    tableBody.querySelectorAll('tr').forEach((tr) => tr.classList.toggle('is-selected', Number(tr.dataset.row) === selected));
    svg.querySelectorAll('.proj-row-bg').forEach((r) => r.classList.toggle('is-selected', Number(r.dataset.row) === selected));
  }

  // Largura da tabela = soma das colunas visíveis (no modo compacto, sem Fim, Responsável e Depende de).
  const HIDDEN = ['end', 'who', 'deps'];
  const visibleCols = () => (tableWrap && tableWrap.classList.contains('is-compact') ? COLS.filter(([k]) => !HIDDEN.includes(k)) : COLS);
  function fitTable() {
    const cols = visibleCols();
    const table = tableWrap.querySelector('table');
    table.style.width = cols.reduce((n, [, , px]) => n + px, 0) + 'px';
    table.querySelector('colgroup').replaceChildren(...cols.map(([k, , w]) => h('col', { class: 'col-' + k, style: `width:${w}px` })));
    table.querySelector('thead').replaceChildren(h('tr', null, cols.map(([k, label]) => h('th', { class: 'col-' + k }, label))));
    if (project) render();
  }

  // ---------- Gantt ----------

  const sv = (tag, attrs, ...kids) => {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, v);
    for (const c of kids.flat()) if (c != null) el.append(c.nodeType ? c : document.createTextNode(String(c)));
    return el;
  };

  function renderGantt(sch) {
    const px = SCALES[project.scale]?.px || SCALES.days.px;
    const from = Math.min(sch.start, today()) - 3;
    const to = Math.max(sch.end, today()) + 14;
    const width = (to - from + 1) * px;
    const height = HEAD + project.tasks.length * ROW + 8;
    const x = (d) => (d - from) * px;
    svg.replaceChildren();
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.append(sv('defs', null, sv('marker', { id: 'proj-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto' }, sv('path', { d: 'M0,0 L10,5 L0,10 z', fill: '#6b7686' }))));
    // Fundo: linhas das tarefas e fins de semana.
    project.tasks.forEach((_t, i) => svg.append(sv('rect', { class: 'proj-row-bg' + (i === selected ? ' is-selected' : ''), 'data-row': i, x: 0, y: HEAD + i * ROW, width, height: ROW })));
    if (project.scale !== 'months') for (let d = from; d <= to; d++) if (weekend(d)) svg.append(sv('rect', { x: x(d), y: HEAD, width: px, height: height - HEAD, class: 'proj-weekend' }));
    // Cabeçalho: meses e dias/semanas.
    const head = sv('g', { class: 'proj-head' });
    head.append(sv('rect', { x: 0, y: 0, width, height: HEAD, class: 'proj-head-bg' }));
    for (let d = from; d <= to; d++) {
      const date = new Date(d * DAY);
      if (date.getUTCDate() === 1 || d === from) {
        head.append(sv('line', { x1: x(d), y1: 0, x2: x(d), y2: HEAD, class: 'proj-tick' }));
        head.append(sv('text', { x: x(d) + 6, y: 17, class: 'proj-month' }, `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`));
      }
      if (project.scale === 'days') head.append(sv('text', { x: x(d) + px / 2, y: 38, class: 'proj-day' + (weekend(d) ? ' is-weekend' : '') }, date.getUTCDate()));
      else if (project.scale === 'weeks' && dow(d) === 1) {
        head.append(sv('line', { x1: x(d), y1: 24, x2: x(d), y2: HEAD, class: 'proj-tick' }));
        head.append(sv('text', { x: x(d) + 3, y: 38, class: 'proj-day', 'text-anchor': 'start' }, date.getUTCDate()));
      }
    }
    // Hoje.
    const t0 = today();
    svg.append(sv('line', { x1: x(t0) + px / 2, y1: HEAD, x2: x(t0) + px / 2, y2: height, class: 'proj-today' }));
    // Dependências.
    const byId = new Map(project.tasks.map((t, i) => [t.id, i]));
    project.tasks.forEach((t, i) => t.deps.forEach((id) => {
      const j = byId.get(id);
      if (j == null) return;
      const x1 = x(sch.e[j] + 1) - (project.tasks[j].milestone ? px / 2 : 0);
      const y1 = HEAD + j * ROW + ROW / 2;
      const x2 = x(sch.s[i]) + (t.milestone ? px / 2 - 7 : 0);
      const y2 = HEAD + i * ROW + ROW / 2;
      const mid = Math.max(x1 + 8, Math.min(x2 - 8, x1 + 8));
      svg.append(sv('path', { d: `M${x1},${y1} H${mid} V${y2} H${x2}`, class: 'proj-link' + (project.showCritical && sch.critical[i] && sch.critical[j] ? ' is-critical' : ''), 'marker-end': 'url(#proj-arrow)' }));
    }));
    // Barras.
    project.tasks.forEach((t, i) => {
      const y = HEAD + i * ROW;
      const sx = x(sch.s[i]);
      const w = (sch.e[i] - sch.s[i] + 1) * px;
      const g = sv('g', { class: 'proj-bar-g', 'data-row': i });
      if (isSummary(i)) {
        g.append(sv('path', { class: 'proj-summary', d: `M${sx},${y + 10} H${sx + w} V${y + 20} L${sx + w - 6},${y + 15} H${sx + 6} L${sx},${y + 20} Z` }));
      } else if (t.milestone) {
        const cx = sx + px / 2;
        g.append(sv('path', { class: 'proj-milestone' + (project.showCritical && sch.critical[i] ? ' is-critical' : ''), d: `M${cx},${y + 7} L${cx + 9},${y + 16} L${cx},${y + 25} L${cx - 9},${y + 16} Z` }));
        g.append(sv('text', { x: cx + 14, y: y + 20, class: 'proj-label' }, t.name));
      } else {
        g.append(sv('rect', { class: 'proj-bar' + (project.showCritical && sch.critical[i] ? ' is-critical' : ''), x: sx + 1, y: y + 7, width: Math.max(4, w - 2), height: 18, rx: 4 }));
        if (t.progress) g.append(sv('rect', { class: 'proj-progress', x: sx + 1, y: y + 7, width: Math.max(0, (w - 2) * t.progress / 100), height: 18, rx: 4 }));
        g.append(sv('rect', { class: 'proj-handle', x: sx + w - 7, y: y + 7, width: 7, height: 18 }));
        g.append(sv('text', { x: sx + w + 6, y: y + 20, class: 'proj-label' }, t.who ? `${t.name} · ${t.who}` : t.name));
        g.addEventListener('pointerdown', (e) => dragBar(e, i, px, e.target.classList.contains('proj-handle')));
      }
      svg.append(g);
    });
    svg.append(head);
  }

  function dragBar(e, i, px, resize) {
    if (e.button !== 0) return;
    e.preventDefault();
    selected = i;
    highlight();
    const t = project.tasks[i];
    const sch = schedule();
    const startX = e.clientX;
    const origStart = sch.s[i];
    const origDur = t.duration;
    let moved = false;
    const move = (ev) => {
      const days = Math.round((ev.clientX - startX) / px);
      if (!days && !moved) return;
      if (!moved) { remember(); moved = true; }
      if (resize) {
        const endDay = sch.e[i] + days;
        let n = 1;
        for (let d = origStart; d < endDay; d++) if (!project.workdays || !weekend(d + 1)) n++;
        t.duration = Math.max(1, Math.min(3650, endDay < origStart ? 1 : n));
      } else {
        t.start = toIso(origStart + days);
        t.duration = origDur;
      }
      render();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) ctx.dirty();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // ---------- Desenhar tudo ----------

  function render() {
    if (!project) return;
    const sch = schedule();
    renderTable(sch);
    renderGantt(sch);
    const leaves = project.tasks.filter((_t, i) => !isSummary(i));
    const work = leaves.reduce((n, t) => n + (t.milestone ? 0 : t.duration), 0);
    const done = leaves.reduce((n, t) => n + (t.milestone ? 0 : t.duration * t.progress / 100), 0);
    statusEl.textContent = `${project.name ? project.name + ' · ' : ''}${project.tasks.length} tarefas · ${fmtDate(sch.start)} a ${fmtDate(sch.end)} · ${workBetween(sch.start, sch.end) + 1} dias${project.workdays ? ' úteis' : ''} · ${work ? Math.round(done / work * 100) : 0}% concluído`;
    if (scaleSel) scaleSel.value = project.scale;
  }

  function goToday() {
    const sch = schedule();
    const px = SCALES[project.scale].px;
    const from = Math.min(sch.start, today()) - 3;
    ganttWrap.scrollLeft = Math.max(0, (today() - from) * px - ganttWrap.clientWidth / 3);
  }

  // ---------- Exportar ----------

  function toCSV() {
    const sch = schedule();
    const q = (v) => { const s = String(v ?? ''); return /[";\n]/.test(s) || /^[=+\-@]/.test(s) ? '"' + s.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""') + '"' : s; };
    const wbs = wbsNumbers();
    const rowOf = new Map(project.tasks.map((t, i) => [t.id, i + 1]));
    const lines = [['#', 'Tarefa', 'Duração (dias)', 'Início', 'Fim', '% concluído', 'Responsável', 'Depende de', 'Crítica'].join(';')];
    project.tasks.forEach((t, i) => lines.push([wbs[i], '  '.repeat(t.level) + t.name, t.milestone ? 0 : isSummary(i) ? workBetween(sch.s[i], sch.e[i]) + 1 : t.duration, toIso(sch.s[i]), toIso(sch.e[i]), isSummary(i) ? summaryProgress(i, sch) : t.progress, t.who, t.deps.map((d) => rowOf.get(d)).filter(Boolean).join(','), sch.critical[i] ? 'sim' : ''].map(q).join(';')));
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  function clean(data) {
    if (!data || data.format !== 'myoffice-project' || !Array.isArray(data.tasks)) throw new Error('Formato inválido');
    const tasks = data.tasks.slice(0, MAX_TASKS).map((t) => ({
      id: typeof t.id === 'string' && /^[a-z0-9]{1,24}$/i.test(t.id) ? t.id : uid(),
      name: String(t.name || 'Tarefa').slice(0, 200),
      start: toDay(t.start) != null ? t.start : null,
      duration: Number.isFinite(t.duration) ? Math.max(1, Math.min(3650, Math.round(t.duration))) : 1,
      progress: Number.isFinite(t.progress) ? Math.max(0, Math.min(100, Math.round(t.progress))) : 0,
      who: String(t.who || '').slice(0, 80),
      deps: Array.isArray(t.deps) ? t.deps.filter((d) => typeof d === 'string').slice(0, 50) : [],
      level: Number.isInteger(t.level) ? Math.max(0, Math.min(8, t.level)) : 0,
      milestone: Boolean(t.milestone),
      notes: String(t.notes || '').slice(0, 2000)
    }));
    const ids = new Set(tasks.map((t) => t.id));
    tasks.forEach((t) => { t.deps = t.deps.filter((d) => ids.has(d) && d !== t.id); });
    for (let i = 1; i < tasks.length; i++) tasks[i].level = Math.min(tasks[i].level, tasks[i - 1].level + 1);
    if (tasks.length) tasks[0].level = 0;
    return {
      name: String(data.name || '').slice(0, 120),
      start: toDay(data.start) != null ? data.start : toIso(today()),
      workdays: data.workdays !== false,
      scale: Object.hasOwn(SCALES, data.scale) ? data.scale : 'days',
      showCritical: Boolean(data.showCritical),
      tasks
    };
  }

  // ---------- Friso ----------

  function buildRibbon() {
    const B = MO.bigButton;
    const I = MO.iconButton;
    scaleSel = h('select', { class: 'tool-select', 'aria-label': 'Escala do gráfico', title: 'Escala do gráfico' }, Object.entries(SCALES).map(([k, v]) => h('option', { value: k }, v.label)));
    scaleSel.addEventListener('change', () => { project.scale = scaleSel.value; changed(); });
    const work = h('input', { type: 'checkbox', checked: true, 'aria-label': 'Só dias úteis' });
    work.addEventListener('change', () => { remember(); project.workdays = work.checked; changed(); });
    const crit = h('input', { type: 'checkbox', 'aria-label': 'Mostrar o caminho crítico' });
    crit.addEventListener('change', () => { project.showCritical = crit.checked; changed(); });
    const allCols = h('input', { type: 'checkbox', 'aria-label': 'Mostrar todas as colunas' });
    allCols.addEventListener('change', () => { tableWrap.classList.toggle('is-compact', !allCols.checked); fitTable(); });
    buildRibbon.sync = () => { work.checked = project.workdays; crit.checked = project.showCritical; };
    return MO.ribbon([
      {
        label: 'Tarefa',
        groups: [
          { label: 'Anular', rows: [[I('undo', 'Anular (Ctrl+Z)', undo), I('redo', 'Refazer (Ctrl+Y)', redo)]] },
          { label: 'Inserir', rows: [[B('rowAdd', 'Tarefa', 'Nova tarefa abaixo da selecionada (Insert)', () => addTask(false)), B('branch', 'Marco', 'Novo marco (data importante, sem duração)', () => addTask(true))]] },
          { label: 'Estrutura', rows: [[I('indent', 'Tornar subtarefa (Alt+→)', () => indent(1), 'Subtarefa'), I('outdent', 'Subir de nível (Alt+←)', () => indent(-1), 'Subir nível')], [I('up', 'Mover para cima', () => move(-1), 'Cima'), I('down', 'Mover para baixo', () => move(1), 'Baixo')]] },
          { label: 'Ligar', rows: [[B('line', 'Ligar à anterior', 'Esta tarefa começa quando a de cima acabar (liga/desliga)', linkWithPrevious)]] },
          { label: 'Eliminar', rows: [[B('trash', 'Eliminar', 'Eliminar a tarefa selecionada', deleteTask)]] }
        ]
      },
      {
        label: 'Projeto',
        groups: [
          { label: 'Projeto', rows: [[B('pageSetup', 'Informações', 'Nome e data de início do projeto', projectInfo)]] },
          { label: 'Calendário', rows: [[h('label', { class: 'draw-check' }, work, 'Só dias úteis (seg. a sex.)')]] },
          { label: 'Análise', rows: [[h('label', { class: 'draw-check' }, crit, 'Mostrar o caminho crítico')]] }
        ]
      },
      {
        label: 'Ver',
        groups: [
          { label: 'Escala', rows: [[scaleSel], [MO.toolButton('Hoje', 'Ir para hoje no gráfico', goToday, 'wide')]] },
          { label: 'Colunas', rows: [[h('label', { class: 'draw-check' }, allCols, 'Mostrar Fim, Responsável e Depende de')]] }
        ]
      }
    ], () => ctx.file());
  }

  // ---------- Módulo ----------

  MO.modules.projects = {
    id: 'projects', label: 'Projetos', ext: 'moproj', filterName: 'Projeto MyOffice', defaultName: 'Projeto',

    init(container, context) {
      ctx = context;
      tableBody = h('tbody');
      const table = h('table', { class: 'proj-table' },
        h('colgroup'),
        h('thead'),
        tableBody);
      svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('class', 'proj-gantt');
      ganttWrap = h('div', { class: 'proj-gantt-wrap' }, svg);
      const grid = h('div', { class: 'proj-table-wrap is-compact' }, table);
      tableWrap = grid;
      fitTable();
      const body = h('div', { class: 'proj-body' }, grid, ganttWrap);
      statusEl = h('span', { class: 'status-text' });
      container.append(buildRibbon(), body, h('div', { class: 'statusbar' }, statusEl));
      svg.addEventListener('pointerdown', (e) => {
        const bg = e.target.closest('.proj-row-bg, .proj-bar-g');
        if (bg) { selected = Number(bg.dataset.row); highlight(); }
      });
      document.addEventListener('keydown', (e) => {
        if (document.body.dataset.current !== 'projects' || document.querySelector('dialog[open]')) return;
        const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);
        const mod = e.ctrlKey || e.metaKey;
        if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); indent(1); }
        else if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); indent(-1); }
        else if (e.key === 'Insert') { e.preventDefault(); addTask(false); }
        else if (!typing && mod && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
        else if (!typing && mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
        else if (!typing && e.key === 'Delete') { e.preventDefault(); deleteTask(); }
      });
    },

    newDoc(template) {
      project = { scale: 'days', showCritical: false, ...templates(template) };
      selected = -1;
      undoStack = [];
      redoStack = [];
      buildRibbon.sync && buildRibbon.sync();
      render();
    },

    serialize() {
      return JSON.stringify({ format: 'myoffice-project', version: 1, ...project });
    },

    load(text) {
      project = clean(JSON.parse(text));
      selected = -1;
      undoStack = [];
      redoStack = [];
      buildRibbon.sync && buildRibbon.sync();
      render();
    },

    exports: [
      { label: 'Tabela para o Excel (.csv)', ext: 'csv', filterName: 'CSV', mime: 'text/csv', get: () => toCSV() },
      { label: 'Gráfico de Gantt (.svg)', ext: 'svg', filterName: 'Imagem SVG', mime: 'image/svg+xml', get: () => {
        const clone = svg.cloneNode(true);
        clone.setAttribute('xmlns', SVG_NS);
        clone.prepend(sv('style', null, GANTT_CSS));
        return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
      } }
    ],

    print() {
      const sch = schedule();
      const node = h('div', { class: 'proj-print' }, h('h1', null, project.name || 'Projeto'), h('p', null, statusEl.textContent));
      const table = h('table', { class: 'proj-print-table' }, h('tr', null, ['#', 'Tarefa', 'Duração', 'Início', 'Fim', '%', 'Responsável'].map((t) => h('th', null, t))));
      const wbs = wbsNumbers();
      project.tasks.forEach((t, i) => table.append(h('tr', { class: isSummary(i) ? 'is-summary' : '' }, [wbs[i], ' '.repeat(t.level * 3) + (t.milestone ? '◆ ' : '') + t.name, t.milestone ? '0 d' : `${workBetween(sch.s[i], sch.e[i]) + 1} d`, fmtDate(sch.s[i]), fmtDate(sch.e[i]), (isSummary(i) ? summaryProgress(i, sch) : t.progress) + '%', t.who].map((v) => h('td', null, v)))));
      const chart = svg.cloneNode(true);
      chart.prepend(sv('style', null, GANTT_CSS));
      chart.setAttribute('class', 'proj-print-gantt');
      node.append(table, chart);
      return { node, page: 'A4 landscape', margin: '10mm' };
    },

    _debug: { project: () => project, schedule: () => { const s = schedule(); return { s: s.s.map(toIso), e: s.e.map(toIso), critical: s.critical }; }, select: (i) => { selected = i; highlight(); } },

    show() { requestAnimationFrame(goToday); }
  };

  // Estilos embutidos no SVG exportado e na impressão (o ficheiro fica com bom aspeto sozinho).
  const GANTT_CSS = `
    text { font-family: Arial, sans-serif; }
    .proj-head-bg { fill: #f6f7f9; } .proj-month { font-size: 12px; font-weight: 700; fill: #3b4554; }
    .proj-day { font-size: 10px; fill: #6b7686; text-anchor: middle; } .proj-tick { stroke: #d6dbe3; }
    .proj-row-bg { fill: transparent; } .proj-weekend { fill: #f1f3f6; }
    .proj-today { stroke: #e0563b; stroke-width: 1.5; stroke-dasharray: 4 3; }
    .proj-bar { fill: #8fb0e8; } .proj-progress { fill: #3f6fcf; } .proj-handle { fill: transparent; }
    .proj-bar.is-critical { fill: #f0a39a; } .proj-milestone { fill: #3b4554; } .proj-milestone.is-critical { fill: #c62828; }
    .proj-summary { fill: #3b4554; } .proj-label { font-size: 11px; fill: #3b4554; }
    .proj-link { fill: none; stroke: #6b7686; stroke-width: 1.2; } .proj-link.is-critical { stroke: #c62828; }`;
})();
