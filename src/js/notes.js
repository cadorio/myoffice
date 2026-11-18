'use strict';

// MyOffice Notas: cadernos com secções e páginas livres. Escreve-se em qualquer sítio da página,
// os blocos arrastam-se como no Desenho e pode-se desenhar à mão (motor MO.Ink, partilhado).
(function () {
  const MO = window.MO;
  const { h } = MO;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const PAGE_W = 860;
  const MIN_H = 1400;
  const MAX_SECTIONS = 60;
  const MAX_PAGES = 400;
  const MAX_BLOCKS = 300;
  const MAX_HTML = 200000;
  const MAX_IMAGE = 4 * 1024 * 1024;
  const SECTION_COLORS = ['#4d68be', '#17806a', '#c86d4d', '#8e44ad', '#e0a100', '#c62828', '#2f8fa8', '#567c5e'];
  const TAGS = { imp: 'Importante', todo: 'A fazer', q: 'Pergunta', idea: 'Ideia' };

  let ctx, root, navSections, navPages, searchInput, titleInput, dateEl, surface, inkSvg, scroller, pageEl, statusEl;
  let book = null;
  let sec = 0;
  let pg = 0;
  let tool = null; // null (escrever) | 'pen' | 'marker' | 'eraser'
  let penColor = '#1d2622';
  let markerColor = '#ffe14d';
  let toolButtons = {};
  let inkUndo = [];
  let saveTimer = 0;
  let zoomEl = null;
  let userZoom = false;
  let seq = 0;
  const uid = () => 'n' + Date.now().toString(36) + (seq++).toString(36);
  const now = () => new Date().toISOString();
  const curSection = () => book.sections[sec];
  const curPage = () => curSection() && curSection().pages[pg];

  // ---------- Modelos ----------

  function page(title, blocks = []) {
    return { id: uid(), title, date: now(), blocks: blocks.map(([x, y, html, w]) => ({ id: uid(), x, y, w: w || 380, html })), strokes: [] };
  }

  function templates(name) {
    if (name === 'meeting') {
      return { sections: [{ id: uid(), name: 'Reuniões', color: SECTION_COLORS[0], pages: [page('Reunião de equipa', [
        [40, 20, '<p><b>Data:</b> ' + new Date().toLocaleDateString('pt-PT') + '</p><p><b>Participantes:</b> </p>'],
        [40, 130, '<h3>Agenda</h3><ul><li>Ponto 1</li><li>Ponto 2</li></ul>'],
        [440, 130, '<h3>Ações</h3><ul class="mo-check"><li>Tarefa · Responsável · Prazo</li></ul>'],
        [40, 330, '<h3>Notas</h3><p><br></p>', 780]
      ])] }] };
    }
    if (name === 'study') {
      return { sections: ['Matemática', 'Português', 'História'].map((n, i) => ({ id: uid(), name: n, color: SECTION_COLORS[i + 1], pages: [page('Aula 1', [[40, 20, '<h3>Resumo</h3><p><br></p>'], [440, 20, '<h3>Dúvidas</h3><p class="mo-tag-q">Escreva aqui as perguntas para o professor.</p>']])] })) };
    }
    if (name === 'project') {
      return { sections: [{ id: uid(), name: 'Projeto', color: SECTION_COLORS[2], pages: [
        page('Visão geral', [[40, 20, '<h3>Objetivo</h3><p><br></p>'], [440, 20, '<h3>Prazos</h3><ul><li><br></li></ul>']]),
        page('Tarefas', [[40, 20, '<h3>A fazer</h3><ul class="mo-check"><li>Primeira tarefa</li><li>Segunda tarefa</li></ul>']]),
        page('Ideias', [[40, 20, '<p class="mo-tag-idea">Escreva ou desenhe ideias soltas.</p>']])
      ] }] };
    }
    return { sections: [{ id: uid(), name: 'Geral', color: SECTION_COLORS[0], pages: [page('Primeira página', name === 'blank' ? [] : [
      [40, 20, '<h3>Bem-vindo às Notas</h3><p>Clique em qualquer sítio da página para escrever.</p><p>Arraste a barra no topo de cada bloco para o mudar de lugar.</p>'],
      [440, 20, '<ul class="mo-check"><li>Experimentar a lista de tarefas</li><li>Desenhar com a caneta (separador Desenhar)</li></ul>']
    ])] }] };
  }

  // ---------- Navegação ----------

  function renderNav() {
    const q = searchInput.value.trim().toLocaleLowerCase('pt-PT');
    navSections.replaceChildren(...book.sections.map((s, i) => h('button', {
      type: 'button', class: 'notes-section' + (i === sec ? ' is-active' : ''), style: `--sec:${s.color}`, title: 'Duplo clique para mudar o nome',
      onclick: () => openPage(i, 0), ondblclick: () => renameSection(i)
    }, h('span', { class: 'notes-dot' }), s.name)), h('button', { type: 'button', class: 'notes-add', onclick: addSection }, '+ Secção'));

    if (q) {
      const hits = [];
      book.sections.forEach((s, si) => s.pages.forEach((p, pi) => {
        const text = (p.title + ' ' + p.blocks.map((b) => b.html.replace(/<[^>]+>/g, ' ')).join(' ')).toLocaleLowerCase('pt-PT');
        if (text.includes(q)) hits.push([si, pi, s, p]);
      }));
      navPages.replaceChildren(h('div', { class: 'notes-hint' }, hits.length ? `${hits.length} ${hits.length === 1 ? 'página encontrada' : 'páginas encontradas'}` : 'Nada encontrado.'),
        ...hits.map(([si, pi, s, p]) => h('button', { type: 'button', class: 'notes-page' + (si === sec && pi === pg ? ' is-active' : ''), onclick: () => openPage(si, pi) }, h('span', { class: 'notes-page-title' }, p.title || 'Sem título'), h('span', { class: 'notes-page-sub' }, s.name))));
      return;
    }
    const s = curSection();
    navPages.replaceChildren(...s.pages.map((p, i) => h('button', { type: 'button', class: 'notes-page' + (i === pg ? ' is-active' : ''), onclick: () => openPage(sec, i) },
      h('span', { class: 'notes-page-title' }, p.title || 'Sem título'), h('span', { class: 'notes-page-sub' }, new Date(p.date).toLocaleDateString('pt-PT')))),
    h('button', { type: 'button', class: 'notes-add', onclick: addPage }, '+ Página'));
  }

  function openPage(si, pi) {
    flush();
    sec = Math.max(0, Math.min(book.sections.length - 1, si));
    pg = Math.max(0, Math.min(curSection().pages.length - 1, pi));
    inkUndo = [];
    renderPage();
    renderNav();
  }

  function addSection() {
    if (book.sections.length >= MAX_SECTIONS) return MO.toast('O caderno chegou ao limite de secções.');
    flush();
    book.sections.push({ id: uid(), name: 'Nova secção', color: SECTION_COLORS[book.sections.length % SECTION_COLORS.length], pages: [page('Sem título')] });
    openPage(book.sections.length - 1, 0);
    changed();
    renameSection(sec);
  }

  async function renameSection(i) {
    const s = book.sections[i];
    const res = await MO.dialog({ title: 'Nome da secção', fields: [{ name: 'name', label: 'Nome', value: s.name }], okLabel: 'Guardar' });
    if (!res || !res.name.trim()) return;
    s.name = res.name.trim().slice(0, 40);
    renderNav();
    changed();
  }

  function addPage() {
    const s = curSection();
    if (s.pages.length >= MAX_PAGES) return MO.toast('A secção chegou ao limite de páginas.');
    flush();
    s.pages.push(page(''));
    openPage(sec, s.pages.length - 1);
    changed();
    titleInput.focus();
  }

  async function deletePage() {
    const s = curSection();
    const p = curPage();
    const res = await MO.dialog({ title: 'Eliminar página?', message: `A página «${p.title || 'Sem título'}» será removida do caderno.`, okLabel: 'Eliminar' });
    if (!res) return;
    s.pages.splice(pg, 1);
    if (!s.pages.length) s.pages.push(page('Sem título'));
    openPage(sec, Math.min(pg, s.pages.length - 1));
    changed();
  }

  async function deleteSection() {
    if (book.sections.length < 2) return MO.toast('O caderno precisa de pelo menos uma secção.');
    const s = curSection();
    const res = await MO.dialog({ title: 'Eliminar secção?', message: `A secção «${s.name}» e as suas ${s.pages.length} páginas serão removidas.`, okLabel: 'Eliminar' });
    if (!res) return;
    book.sections.splice(sec, 1);
    openPage(Math.min(sec, book.sections.length - 1), 0);
    changed();
  }

  // ---------- Página ----------

  function pageHeight(p) {
    let bottom = 0;
    for (const b of p.blocks) bottom = Math.max(bottom, b.y + 400);
    for (const st of p.strokes) for (const pt of st.pts) bottom = Math.max(bottom, pt[1] + 300);
    return Math.max(MIN_H, Math.ceil(bottom));
  }

  function renderPage() {
    const p = curPage();
    titleInput.value = p.title;
    dateEl.textContent = new Date(p.date).toLocaleString('pt-PT', { dateStyle: 'long', timeStyle: 'short' });
    surface.querySelectorAll('.notes-block').forEach((el) => el.remove());
    for (const b of p.blocks) surface.append(blockEl(b));
    renderInk();
    updateStatus();
  }

  function renderInk() {
    const p = curPage();
    const height = pageHeight(p);
    surface.style.height = height + 'px';
    inkSvg.setAttribute('viewBox', `0 0 ${PAGE_W} ${height}`);
    inkSvg.style.height = height + 'px';
    inkSvg.replaceChildren(...p.strokes.map((st) => MO.Ink.strokeEl(st)));
    inkSvg.classList.toggle('is-inking', Boolean(tool));
    surface.classList.toggle('is-inking', Boolean(tool));
  }

  function blockEl(b) {
    const body = h('div', { class: 'notes-block-body', contenteditable: 'true', spellcheck: 'true' });
    body.lang = 'pt-PT';
    body.innerHTML = b.html;
    const grip = h('div', { class: 'notes-grip', title: 'Arrastar para mover', 'aria-hidden': 'true' });
    const el = h('div', { class: 'notes-block', 'data-id': b.id, style: `left:${b.x}px;top:${b.y}px;width:${b.w}px` }, grip, body);
    body.addEventListener('input', () => { b.html = body.innerHTML.slice(0, MAX_HTML); changed(false); });
    body.addEventListener('blur', () => {
      // Blocos vazios desaparecem quando se sai deles.
      if (!body.textContent.trim() && !body.querySelector('img')) { removeBlock(b.id); }
    });
    body.addEventListener('click', (e) => {
      const li = e.target.closest('ul.mo-check > li');
      if (li && e.offsetX < 24) { li.classList.toggle('mo-done'); b.html = body.innerHTML; changed(); }
    });
    body.addEventListener('paste', (e) => onPaste(e, body, b));
    grip.addEventListener('pointerdown', (e) => dragBlock(e, el, b));
    // A largura muda com a pega no canto (CSS resize); guarda-se ao largar.
    el.addEventListener('pointerup', () => { const w = Math.round(el.offsetWidth); if (Math.abs(w - b.w) > 2) { b.w = w; changed(); } });
    return el;
  }

  function removeBlock(id) {
    const p = curPage();
    const i = p.blocks.findIndex((x) => x.id === id);
    if (i < 0) return;
    p.blocks.splice(i, 1);
    surface.querySelector(`.notes-block[data-id="${id}"]`)?.remove();
    changed();
  }

  function dragBlock(e, el, b) {
    if (e.button !== 0) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY, bx: b.x, by: b.y };
    const k = surface.getBoundingClientRect().width / PAGE_W || 1;
    el.classList.add('is-dragging');
    const move = (ev) => {
      b.x = Math.max(0, Math.min(PAGE_W - 60, Math.round(start.bx + (ev.clientX - start.x) / k)));
      b.y = Math.max(0, Math.round(start.by + (ev.clientY - start.y) / k));
      el.style.left = b.x + 'px';
      el.style.top = b.y + 'px';
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      el.classList.remove('is-dragging');
      renderInk();
      changed();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function surfacePoint(e) {
    const r = surface.getBoundingClientRect();
    const k = r.width / PAGE_W || 1;
    return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k };
  }

  function newBlock(x, y, html = '<p><br></p>', w = 380) {
    const p = curPage();
    if (p.blocks.length >= MAX_BLOCKS) { MO.toast('A página chegou ao limite de blocos.'); return null; }
    const b = { id: uid(), x: Math.max(0, Math.min(PAGE_W - 120, Math.round(x))), y: Math.max(0, Math.round(y)), w: Math.min(w, PAGE_W - Math.round(x)), html };
    p.blocks.push(b);
    const el = blockEl(b);
    surface.append(el);
    renderInk();
    const body = el.querySelector('.notes-block-body');
    body.focus();
    const r = document.createRange();
    r.selectNodeContents(body);
    r.collapse(false);
    const sel = document.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    changed();
    return { b, body };
  }

  function onSurfaceDown(e) {
    if (tool || e.button !== 0 || e.target !== surface) return;
    e.preventDefault();
    const pt = surfacePoint(e);
    newBlock(pt.x, pt.y - 12);
  }

  // Bloco onde está o cursor, ou um novo no meio da vista.
  function focusedBlock() {
    const sel = document.getSelection();
    const node = sel.rangeCount ? sel.anchorNode : null;
    const body = node && (node.nodeType === 1 ? node : node.parentElement).closest('.notes-block-body');
    if (body && surface.contains(body)) {
      const id = body.parentElement.dataset.id;
      return { b: curPage().blocks.find((x) => x.id === id), body };
    }
    const k = surface.getBoundingClientRect().width / PAGE_W || 1;
    return newBlock(60, Math.max(20, (scroller.scrollTop + 80) / k));
  }

  function insertIntoBlock(html) {
    const target = focusedBlock();
    if (!target) return;
    target.body.focus();
    document.execCommand('insertHTML', false, html);
    target.b.html = target.body.innerHTML;
    changed();
  }

  function insertChecklist() { insertIntoBlock('<ul class="mo-check"><li>Nova tarefa</li></ul>'); }

  function insertDate() { insertIntoBlock(MO.escapeHTML(new Date().toLocaleString('pt-PT', { dateStyle: 'full', timeStyle: 'short' }))); }

  function tagBlock(kind) {
    const target = focusedBlock();
    if (!target) return;
    const sel = document.getSelection();
    const node = sel.rangeCount ? sel.anchorNode : null;
    let el = node && (node.nodeType === 1 ? node : node.parentElement).closest('p, li, h1, h2, h3');
    if (!el || !target.body.contains(el)) el = target.body.querySelector('p, li, h1, h2, h3');
    if (!el) { target.body.innerHTML = '<p><br></p>'; el = target.body.firstChild; }
    const cls = 'mo-tag-' + kind;
    const on = !el.classList.contains(cls);
    Object.keys(TAGS).forEach((k) => el.classList.remove('mo-tag-' + k));
    if (on) el.classList.add(cls);
    target.b.html = target.body.innerHTML;
    changed();
  }

  async function insertImage() {
    const file = await MO.pickFile({ accept: 'image/png,image/jpeg,image/gif,image/webp', as: 'dataURL', maxBytes: MAX_IMAGE });
    if (!file) return;
    if (!MO.IMAGE_DATA_URL.test(file.content)) return MO.toast('Formato de imagem não suportado.');
    insertIntoBlock(`<img src="${file.content}" alt="">`);
  }

  function onPaste(e, body, b) {
    const data = e.clipboardData;
    if (!data) return;
    const image = [...data.items].find((it) => it.kind === 'file' && /^image\/(png|jpeg|gif|webp)$/.test(it.type));
    e.preventDefault();
    if (image) {
      const f = image.getAsFile();
      if (!f || f.size > MAX_IMAGE) return MO.toast('A imagem é demasiado grande (máximo 4 MB).');
      const reader = new FileReader();
      reader.onload = () => { if (MO.IMAGE_DATA_URL.test(reader.result)) { document.execCommand('insertHTML', false, `<img src="${reader.result}" alt="">`); b.html = body.innerHTML; changed(); } };
      reader.readAsDataURL(f);
      return;
    }
    const html = data.getData('text/html');
    if (html) document.execCommand('insertHTML', false, MO.sanitizeHTML(html));
    else document.execCommand('insertText', false, data.getData('text/plain'));
  }

  // ---------- Desenhar ----------

  function setTool(next) {
    tool = tool === next ? null : next;
    for (const [k, btn] of Object.entries(toolButtons)) btn.classList.toggle('on', k === (tool || 'type'));
    if (tool) document.activeElement?.blur?.();
    renderInk();
  }

  function inkStyle(kind) {
    return kind === 'marker' ? { color: markerColor, width: 18, alpha: 0.35 } : { color: penColor, width: 3, alpha: 1 };
  }

  function undoInk() {
    if (!inkUndo.length) return false;
    curPage().strokes = inkUndo.pop();
    renderInk();
    changed();
    return true;
  }

  // ---------- Partilhar ----------

  function pageHTML(p) {
    const blocks = [...p.blocks].sort((a, b) => a.y - b.y || a.x - b.x);
    return `<h1>${MO.escapeHTML(p.title || 'Sem título')}</h1>` + blocks.map((b) => MO.sanitizeHTML(b.html)).join('');
  }

  function sendToWriter() {
    flush();
    const html = pageHTML(curPage());
    if (window.api && window.api.deliver) {
      window.api.deliver('writer', { kind: 'draft', html });
      MO.toast('Página enviada para o MyOffice Texto.');
    } else MO.toast('Abra o MyOffice Texto para receber a página.');
  }

  // ---------- Estado ----------

  function changed(nav = true) {
    curPage().date = curPage().date || now();
    ctx.dirty();
    if (nav) renderNav();
    updateStatus();
    // Guardado automático: se o caderno já tem ficheiro, grava pouco depois de cada mudança.
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => ctx.autosave && ctx.autosave(), 1500);
  }

  function flush() {
    const p = curPage();
    if (!p || !surface) return;
    surface.querySelectorAll('.notes-block').forEach((el) => {
      const b = p.blocks.find((x) => x.id === el.dataset.id);
      if (b) b.html = el.querySelector('.notes-block-body').innerHTML.slice(0, MAX_HTML);
    });
  }

  function updateStatus() {
    if (!statusEl || !book) return;
    const pages = book.sections.reduce((n, s) => n + s.pages.length, 0);
    statusEl.textContent = `${book.sections.length} ${book.sections.length === 1 ? 'secção' : 'secções'} · ${pages} ${pages === 1 ? 'página' : 'páginas'}`;
  }

  function cleanBook(data) {
    const sections = (Array.isArray(data.sections) ? data.sections : []).slice(0, MAX_SECTIONS).map((s, i) => ({
      id: uid(),
      name: String(s && s.name || 'Secção').slice(0, 40),
      color: MO.HEX.test(s && s.color) ? s.color : SECTION_COLORS[i % SECTION_COLORS.length],
      pages: (Array.isArray(s && s.pages) ? s.pages : []).slice(0, MAX_PAGES).map((p) => ({
        id: uid(),
        title: String(p && p.title || '').slice(0, 120),
        date: p && typeof p.date === 'string' && !Number.isNaN(Date.parse(p.date)) ? p.date : now(),
        blocks: (Array.isArray(p && p.blocks) ? p.blocks : []).slice(0, MAX_BLOCKS)
          .filter((b) => b && Number.isFinite(b.x) && Number.isFinite(b.y) && typeof b.html === 'string')
          .map((b) => ({ id: uid(), x: Math.max(0, Math.min(PAGE_W - 60, b.x)), y: Math.max(0, Math.min(100000, b.y)), w: Number.isFinite(b.w) ? Math.max(120, Math.min(PAGE_W, b.w)) : 380, html: MO.sanitizeHTML(b.html.slice(0, MAX_HTML)) })),
        strokes: MO.Ink.clean(p && p.strokes, PAGE_W, 100000)
      }))
    })).filter((s) => s.pages.length);
    if (!sections.length) throw new Error('Formato inválido');
    return { sections };
  }

  // ---------- Friso ----------

  function buildRibbon() {
    const B = MO.bigButton;
    const T = (key, icon, label, title) => (toolButtons[key] = B(icon, label, title, () => (key === 'type' ? tool && setTool(tool) : setTool(key))));
    const swatch = (c, marker) => h('button', { type: 'button', class: 'draw-swatch', style: `background:${c}`, title: 'Cor ' + c, 'aria-label': 'Cor ' + c, onclick: () => { if (marker) { markerColor = c; if (tool !== 'marker') setTool('marker'); } else { penColor = c; if (tool !== 'pen') setTool('pen'); } } });
    const tagBtn = (k) => MO.toolButton(TAGS[k], 'Etiqueta: ' + TAGS[k], () => tagBlock(k), 'wide notes-tag-btn notes-tag-' + k);
    return MO.ribbon([
      {
        label: 'Base',
        groups: [
          { label: 'Caderno', rows: [[B('fileNew', 'Nova página', 'Acrescentar uma página a esta secção', addPage), B('folder', 'Nova secção', 'Acrescentar uma secção ao caderno', addSection)]] },
          { label: 'Etiquetas', rows: [[tagBtn('imp'), tagBtn('todo')], [tagBtn('q'), tagBtn('idea')]] },
          { label: 'Partilhar', rows: [[B('export', 'Enviar para o Texto', 'Abrir esta página no MyOffice Texto, como documento', sendToWriter)]] }
        ]
      },
      {
        label: 'Inserir',
        groups: [
          { label: 'Inserir', rows: [[B('numbers', 'Lista de tarefas', 'Lista com caixas para marcar', insertChecklist), B('image', 'Imagem', 'Inserir uma imagem (também pode colar com Ctrl+V)', insertImage), B('pageSetup', 'Data e hora', 'Inserir a data e a hora de agora', insertDate)]] }
        ]
      },
      {
        label: 'Desenhar',
        groups: [
          { label: 'Ferramentas', rows: [[T('type', 'cursor', 'Escrever', 'Escrever e mover blocos (Esc)'), T('pen', 'pen', 'Caneta', 'Desenhar à mão livre'), T('marker', 'highlight', 'Marcador', 'Realçar com cor transparente'), T('eraser', 'eraser', 'Borracha', 'Apagar traços (passe por cima)')]] },
          { label: 'Caneta', rows: [[h('div', { class: 'draw-swatches' }, MO.Ink.COLORS.map((c) => swatch(c, false)))]] },
          { label: 'Marcador', rows: [[h('div', { class: 'draw-swatches' }, MO.Ink.MARKER_COLORS.map((c) => swatch(c, true)))]] }
        ]
      },
      {
        label: 'Página',
        groups: [
          { label: 'Eliminar', rows: [[B('trash', 'Eliminar página', 'Eliminar a página aberta', deletePage), B('trash', 'Eliminar secção', 'Eliminar a secção aberta e as suas páginas', deleteSection)]] }
        ]
      }
    ], () => ctx.file());
  }

  // ---------- Módulo ----------

  MO.modules.notes = {
    id: 'notes', label: 'Notas', ext: 'monotes', filterName: 'Caderno MyOffice', defaultName: 'Caderno',

    init(container, context) {
      ctx = context;
      searchInput = h('input', { type: 'search', class: 'notes-search', placeholder: 'Procurar no caderno', 'aria-label': 'Procurar no caderno' });
      searchInput.addEventListener('input', () => renderNav());
      navSections = h('div', { class: 'notes-sections', 'aria-label': 'Secções' });
      navPages = h('div', { class: 'notes-pages', 'aria-label': 'Páginas' });
      const nav = h('aside', { class: 'notes-nav' }, searchInput, h('div', { class: 'notes-nav-cols' }, navSections, navPages));
      titleInput = h('input', { type: 'text', class: 'notes-title', placeholder: 'Título da página', 'aria-label': 'Título da página', maxlength: 120 });
      titleInput.addEventListener('input', () => { curPage().title = titleInput.value; changed(); });
      titleInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const k = surface.getBoundingClientRect().width / PAGE_W || 1; newBlock(40, Math.max(20, scroller.scrollTop / k + 20)); } });
      dateEl = h('div', { class: 'notes-date' });
      inkSvg = document.createElementNS(SVG_NS, 'svg');
      inkSvg.setAttribute('class', 'notes-ink-layer');
      surface = h('div', { class: 'notes-surface', style: `width:${PAGE_W}px` }, inkSvg);
      surface.addEventListener('pointerdown', onSurfaceDown);
      pageEl = h('div', { class: 'notes-paper' }, h('header', { class: 'notes-head' }, titleInput, dateEl), surface);
      scroller = h('div', { class: 'notes-scroll' }, pageEl);
      root = h('div', { class: 'notes-body' }, nav, scroller);
      statusEl = h('span', { class: 'status-text' });
      zoomEl = MO.zoomControl((k) => { pageEl.style.zoom = k; userZoom = true; });
      const bar = h('div', { class: 'statusbar' }, statusEl, zoomEl);
      container.append(buildRibbon(), root, bar);
      toolButtons.type.classList.add('on');
      MO.Ink.attach(inkSvg, surfacePoint, {
        active: () => tool,
        style: (kind) => inkStyle(kind),
        strokes: () => curPage().strokes,
        onAdd: (st) => { inkUndo.push(curPage().strokes.slice()); curPage().strokes.push(st); renderInk(); changed(false); },
        onErase: (idx) => { inkUndo.push(curPage().strokes.slice()); curPage().strokes = curPage().strokes.filter((_s, i) => !idx.includes(i)); renderInk(); changed(false); }
      });
      document.addEventListener('keydown', (e) => {
        if (document.body.dataset.current !== 'notes' || document.querySelector('dialog[open]')) return;
        if (e.key === 'Escape' && tool) { setTool(tool); e.preventDefault(); return; }
        const editing = e.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);
        if (!editing && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && undoInk()) e.preventDefault();
      });
    },

    newDoc(template) {
      book = templates(template);
      sec = 0;
      pg = 0;
      inkUndo = [];
      searchInput.value = '';
      renderPage();
      renderNav();
    },

    serialize() {
      flush();
      return JSON.stringify({ format: 'myoffice-notes', version: 1, sections: book.sections.map((s) => ({ name: s.name, color: s.color, pages: s.pages.map(({ id, blocks, ...p }) => ({ ...p, blocks: blocks.map(({ id: _i, ...b }) => b) })) })) });
    },

    load(text) {
      const data = JSON.parse(text);
      if (!data || data.format !== 'myoffice-notes') throw new Error('Formato inválido');
      book = cleanBook(data);
      sec = 0;
      pg = 0;
      inkUndo = [];
      searchInput.value = '';
      renderPage();
      renderNav();
    },

    exports: [
      { label: 'Página web com o caderno inteiro (.html)', ext: 'html', filterName: 'Página web', mime: 'text/html', get: (title) => {
        flush();
        const body = book.sections.map((s) => `<h1 style="color:${s.color}">${MO.escapeHTML(s.name)}</h1>` + s.pages.map((p) => `<section>${pageHTML(p).replace('<h1>', '<h2>').replace('</h1>', '</h2>')}</section>`).join('')).join('');
        return `<!DOCTYPE html>\n<html lang="pt">\n<head>\n<meta charset="utf-8">\n<title>${MO.escapeHTML(title)}</title>\n<style>body{font-family:Arial,sans-serif;max-width:820px;margin:24px auto;line-height:1.5;color:#1c2130}img{max-width:100%}section{border-top:1px solid #ddd;padding-top:8px}ul.mo-check{list-style:none;padding-left:4px}ul.mo-check li::before{content:"☐ "}ul.mo-check li.mo-done::before{content:"☑ "}</style>\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
      } },
      { label: 'Texto simples (.txt)', ext: 'txt', filterName: 'Texto simples', mime: 'text/plain', get: () => {
        flush();
        const div = document.createElement('div');
        return book.sections.map((s) => `# ${s.name}\n\n` + s.pages.map((p) => { div.innerHTML = pageHTML(p); return div.innerText; }).join('\n\n')).join('\n\n');
      } }
    ],

    print() {
      flush();
      const p = curPage();
      const node = h('div', { class: 'notes-print' }, h('h1', null, p.title || 'Sem título'), h('p', { class: 'notes-print-date' }, new Date(p.date).toLocaleString('pt-PT')));
      const area = h('div', { class: 'notes-print-surface', style: `height:${pageHeight(p)}px` });
      for (const b of p.blocks) { const d = h('div', { class: 'notes-print-block', style: `left:${b.x}px;top:${b.y}px;width:${b.w}px` }); d.innerHTML = MO.sanitizeHTML(b.html); area.append(d); }
      const ink = document.createElementNS(SVG_NS, 'svg');
      ink.setAttribute('viewBox', `0 0 ${PAGE_W} ${pageHeight(p)}`);
      ink.setAttribute('class', 'notes-print-ink');
      p.strokes.forEach((st) => ink.append(MO.Ink.strokeEl(st)));
      area.append(ink);
      node.append(area);
      return { node, page: 'A4 portrait', margin: '12mm' };
    },

    // Usado pelos testes.
    _debug: { book: () => book, open: openPage, tool: () => tool, newBlock: (x, y) => newBlock(x, y) },

    show() {
      // Na primeira vez, a página cabe na largura da janela.
      if (!userZoom && scroller.clientWidth) {
        const k = Math.min(1, (scroller.clientWidth - 48) / (PAGE_W + 2));
        if (k < 0.99) { zoomEl.setZoom(Math.max(50, Math.floor(k * 10) * 10)); }
        userZoom = true;
      }
      if (!tool && !surface.querySelector('.notes-block')) titleInput.focus();
    }
  };
})();
