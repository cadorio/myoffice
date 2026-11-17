'use strict';

// Módulo "Diapositivos": apresentações.
(function () {
  const MO = window.MO;
  const { h, toolButton, colorButton, iconButton, bigButton } = MO;

  const W = 960;
  const H = 540;
  const MIN = 20;
  const MAX_UNDO = 60;
  const SIZES = [14, 18, 24, 28, 32, 40, 54, 72, 96];

  let ctx, root, stageBox, stage, thumbs, sizeSelect, counterEl, notesEl, aiPanel, aiBody;
  let slides = [];
  let idx = 0;
  let selId = null;
  let editingId = null;
  let scale = 1;
  let undoStack = [];
  let redoStack = [];
  let seq = 0;
  let drag = null;
  let colorSnapshotTaken = false;
  let notesSnapshotTaken = false;

  const uid = () => 'e' + Date.now().toString(36) + (seq++).toString(36);
  const slide = () => slides[idx];
  const selected = () => slide().els.find((el) => el.id === selId) || null;
  // Seleção múltipla (Shift+clique ou grupo): o elemento principal é selId e os outros ficam aqui.
  const extraSel = new Set();
  const MAX_TABLE_ROWS = 20;
  const MAX_TABLE_COLS = 10;
  const isSelected = (id) => id === selId || extraSel.has(id);
  const selectedEls = () => slide().els.filter((el) => isSelected(el.id));

  const T = MO.Themes;
  const FONTS = T.FONTS;
  const PICKER = 'colors-slides';
  const LAYOUTS = [
    ['title', 'Diapositivo de título'],
    ['content', 'Título e conteúdo'],
    ['two', 'Duas colunas'],
    ['titleOnly', 'Só título'],
    ['blank', 'Em branco']
  ];
  // Aspeto em uso: cores e tipos de letra do tema e da variante escolhidos (ver themes.js).
  let theme = T.slideLook(T.LIST[0], 'claro');
  let themeRow, variantRow;
  let transitionSelect;
  let animationSelect;
  let showStates = () => {};

  function textEl(x, y, w, h_, html, extra) {
    return Object.assign({ id: uid(), type: 'text', x, y, w, h: h_, html, fs: 24, color: theme.text, align: 'left' }, extra);
  }

  const bulletsHTML = (items) => '<ul>' + items.map((t) => `<li>${MO.escapeHTML(t)}</li>`).join('') + '</ul>';

  // Cria um diapositivo com um dos esquemas; c pode trazer { title, subtitle, bullets, notes }.
  function makeSlide(layout, c = {}) {
    const els = [];
    const body = (x, w, items) => textEl(x, 140, w, 340, bulletsHTML(items), { fs: items.length > 5 ? 22 : 28, role: 'body' });
    if (layout === 'title') {
      els.push(
        textEl(80, 170, 800, 110, MO.escapeHTML(c.title || 'Título da apresentação'), { fs: (c.title || '').length > 28 ? 40 : 54, bold: true, align: 'center', role: 'title', color: theme.title }),
        textEl(80, 300, 800, 60, MO.escapeHTML(c.subtitle || 'Subtítulo'), { fs: 28, align: 'center', role: 'body' })
      );
    } else if (layout !== 'blank') {
      els.push(textEl(60, 40, 840, 80, MO.escapeHTML(c.title || 'Título do diapositivo'), { fs: 40, bold: true, role: 'title', color: theme.title }));
      if (layout === 'content') els.push(body(60, 840, c.bullets && c.bullets.length ? c.bullets : ['Primeiro ponto', 'Segundo ponto']));
      if (layout === 'two') els.push(body(60, 405, ['Coluna da esquerda']), body(495, 405, ['Coluna da direita']));
    }
    const s = { bg: theme.bg, accent: theme.accent, font: theme.font, headFont: theme.headFont, deco: theme.deco, notes: c.notes || '', els };
    if (layout === 'title') s.lead = true;
    return s;
  }

  // ---------- Histórico ----------

  // Cópia dos diapositivos para o histórico. Copia a estrutura mas partilha os textos longos
  // (as imagens vêm como texto em base64), para cada passo do histórico não duplicar as fotografias.
  const copySlides = (list) => list.map((s) => ({ ...s, els: s.els.map((el) => ({ ...el })) }));

  function snapshot() {
    undoStack.push({ slides: copySlides(slides), idx });
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack = [];
  }

  function timeTravel(from, to) {
    if (!from.length) return;
    to.push({ slides: copySlides(slides), idx });
    const state = from.pop();
    slides = state.slides;
    idx = Math.min(state.idx, slides.length - 1);
    selId = null;
    editingId = null;
    renderAll();
    ctx.dirty();
  }

  function change(fn) {
    snapshot();
    fn();
    renderAll();
    ctx.dirty();
  }

  // ---------- Validação de ficheiros ----------

  const clampNum = (v, lo, hi, fallback) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Number(v))) : fallback);

  function cleanSlides(input) {
    if (!Array.isArray(input) || !input.length) throw new Error('Formato inválido');
    return input.slice(0, 500).map((s) => {
      const els = [];
      for (const el of Array.isArray(s && s.els) ? s.els.slice(0, 200) : []) {
        if (!el || !['text', 'image', 'rect', 'ellipse', 'table'].includes(el.type)) continue;
        const clean = {
          id: uid(),
          type: el.type,
          x: clampNum(el.x, -W, 2 * W, 0),
          y: clampNum(el.y, -H, 2 * H, 0),
          w: clampNum(el.w, MIN, 2 * W, 200),
          h: clampNum(el.h, MIN, 2 * H, 100)
        };
        if (['fade', 'zoom', 'appear'].includes(el.animation)) clean.animation = el.animation;
        if (typeof el.group === 'string' && /^[a-z0-9]{1,20}$/i.test(el.group)) clean.group = el.group;
        if (el.type === 'text') {
          clean.html = MO.sanitizeHTML(typeof el.html === 'string' ? el.html : '');
          clean.fs = clampNum(el.fs, 8, 200, 24);
          clean.color = MO.HEX.test(el.color) ? el.color : '#1c2130';
          clean.align = ['left', 'center', 'right'].includes(el.align) ? el.align : 'left';
          if (el.role === 'title' || el.role === 'body') clean.role = el.role;
          if (el.bold) clean.bold = true;
          if (el.italic) clean.italic = true;
        } else if (el.type === 'image') {
          if (typeof el.src !== 'string' || !MO.IMAGE_DATA_URL.test(el.src)) continue;
          clean.src = el.src;
        } else if (el.type === 'table') {
          const rows = (Array.isArray(el.rows) ? el.rows : []).slice(0, MAX_TABLE_ROWS).map((row) => (Array.isArray(row) ? row : []).slice(0, MAX_TABLE_COLS).map((v) => String(v ?? '').slice(0, 500)));
          const cols = Math.max(1, ...rows.map((r) => r.length));
          if (!rows.length) continue;
          clean.rows = rows.map((r) => [...r, ...Array(cols - r.length).fill('')]);
          clean.fs = clampNum(el.fs, 8, 72, 20);
          clean.accent = MO.HEX.test(el.accent) ? el.accent : '#1f5fbf';
        } else {
          clean.fill = MO.HEX.test(el.fill) ? el.fill : '#4f5bd5';
        }
        els.push(clean);
      }
      const look = {};
      if (s && MO.HEX.test(s.accent)) look.accent = s.accent;
      if (s && Object.hasOwn(FONTS, s.font)) look.font = s.font;
      if (s && Object.hasOwn(FONTS, s.headFont)) look.headFont = s.headFont;
      if (s && T.DECOS.includes(s.deco)) look.deco = s.deco;
      if (s && s.lead === true) look.lead = true;
      // Ficheiros de versões anteriores.
      if (s && s.deco === 'bar') look.deco = 'barra';
      if (s && s.deco === 'title') Object.assign(look, { deco: 'barra', lead: true });
      const transition = ['fade', 'push', 'wipe'].includes(s && s.transition) ? s.transition : '';
      return { bg: MO.HEX.test(s && s.bg) ? s.bg : '#ffffff', ...look, transition, notes: typeof (s && s.notes) === 'string' ? s.notes.slice(0, 5000) : '', els };
    });
  }

  // ---------- Desenho ----------

  // As imagens ficam guardadas como texto (data:), mas desenhá-las assim obriga o browser a
  // descodificar o texto inteiro em cada elemento criado. Cada imagem é convertida uma vez num
  // endereço blob:, que o browser reutiliza no palco e nas miniaturas.
  const blobURLs = new Map();
  function imageURL(dataURL) {
    let url = blobURLs.get(dataURL);
    if (!url) {
      try {
        const comma = dataURL.indexOf(',');
        const bin = atob(dataURL.slice(comma + 1).replace(/\s+/g, ''));
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        url = URL.createObjectURL(new Blob([bytes], { type: dataURL.slice(5, dataURL.indexOf(';')) }));
      } catch {
        url = dataURL;
      }
      blobURLs.set(dataURL, url);
    }
    return url;
  }

  function releaseImages() {
    for (const url of blobURLs.values()) if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    blobURLs.clear();
    thumbCache = [];
  }

  function renderSlide(s, interactive) {
    const node = h('div', { class: 'slide' + (s.lead ? ' lead' : ''), style: { background: s.bg } });
    if (s.font) node.style.fontFamily = FONTS[s.font];
    // Elemento gráfico do tema, desenhado em CSS com a cor de destaque (currentColor).
    if (s.accent && s.deco) node.append(h('div', { class: 'deco deco-' + s.deco, style: { color: s.accent } }));
    for (const el of s.els) {
      const box = h('div', {
        class: 'el el-' + el.type,
        style: { left: el.x + 'px', top: el.y + 'px', width: el.w + 'px', height: el.h + 'px' }
      });
      if (el.animation) box.dataset.animation = el.animation;
      if (el.type === 'text') {
        const content = h('div', {
          class: 'el-content',
          style: {
            fontSize: el.fs + 'px',
            color: el.color,
            textAlign: el.align,
            fontWeight: el.bold ? '700' : '400',
            fontStyle: el.italic ? 'italic' : 'normal',
            fontFamily: el.role === 'title' && s.headFont ? FONTS[s.headFont] : ''
          }
        });
        content.innerHTML = el.html;
        box.append(content);
      } else if (el.type === 'image') {
        box.append(h('img', { src: imageURL(el.src), alt: '', draggable: 'false' }));
      } else if (el.type === 'table') {
        const table = h('table', { class: 'el-table', style: { fontSize: el.fs + 'px' } },
          h('tbody', null, el.rows.map((row, r) => h('tr', null, row.map((v, c) => h(r === 0 ? 'th' : 'td', { 'data-r': r, 'data-c': c }, v))))));
        table.style.setProperty('--tbl-accent', el.accent);
        box.append(table);
      } else {
        box.style.background = el.fill;
      }
      if (interactive) {
        box.dataset.id = el.id;
        box.append(h('span', { class: 'handle' }));
        if (isSelected(el.id)) box.classList.add('selected');
      }
      node.append(box);
    }
    return node;
  }

  function fitStage() {
    const availW = stageBox.clientWidth - 48;
    const availH = stageBox.clientHeight - 48;
    if (availW <= 0 || availH <= 0) return;
    scale = Math.min(availW / W, availH / H);
    stage.style.width = W * scale + 'px';
    stage.style.height = H * scale + 'px';
    if (stage.firstChild) stage.firstChild.style.transform = `scale(${scale})`;
  }

  function renderStage() {
    stage.replaceChildren(renderSlide(slide(), true));
    fitStage();
    if (document.activeElement !== notesEl) notesEl.value = slide().notes || '';
    syncToolbar();
  }

  // Assinatura do aspeto de um diapositivo (as imagens contam pelo tamanho e pelo fim do texto).
  const signature = (s) => JSON.stringify(s, (key, value) => (key === 'src' ? value.length + value.slice(-32) : key === 'notes' || key === 'id' ? undefined : value));

  // Só redesenha as miniaturas dos diapositivos que mudaram.
  let thumbCache = [];
  function renderThumbs() {
    thumbCache.length = Math.min(thumbCache.length, slides.length);
    slides.forEach((s, i) => {
      const sig = signature(s);
      let entry = thumbCache[i];
      if (!entry) {
        const frame = h('span', { class: 'thumb-frame' });
        const btn = h('button', { type: 'button', class: 'thumb', title: 'Diapositivo ' + (i + 1), 'aria-label': 'Diapositivo ' + (i + 1) }, h('span', { class: 'thumb-num' }, i + 1), frame);
        btn.addEventListener('click', () => goTo(i));
        entry = thumbCache[i] = { btn, frame, sig: null };
      }
      if (entry.sig !== sig) {
        entry.frame.replaceChildren(renderSlide(s, false));
        entry.sig = sig;
      }
      entry.btn.classList.toggle('active', i === idx);
      if (thumbs.children[i] !== entry.btn) thumbs.insertBefore(entry.btn, thumbs.children[i] || null);
    });
    while (thumbs.children.length > slides.length) thumbs.lastChild.remove();
    counterEl.textContent = `Diapositivo ${idx + 1} de ${slides.length}`;
    const active = thumbs.children[idx];
    if (active) active.scrollIntoView({ block: 'nearest' });
  }

  function renderAll() {
    if (transitionSelect) transitionSelect.value = slide().transition || '';
    if (animationSelect) animationSelect.value = selected()?.animation || '';
    renderStage();
    renderThumbs();
  }

  function goTo(i) {
    commitTextEdit();
    idx = Math.max(0, Math.min(slides.length - 1, i));
    selId = null;
    if (transitionSelect) transitionSelect.value = slide().transition || '';
    renderAll();
  }

  function selectEl(id, add) {
    if (!add) extraSel.clear();
    if (add && selId && selId !== id) extraSel.add(selId);
    selId = id;
    // Selecionar um elemento de um grupo seleciona o grupo inteiro.
    const el = id && slide().els.find((x) => x.id === id);
    if (el && el.group) slide().els.forEach((x) => { if (x.group === el.group && x.id !== id) extraSel.add(x.id); });
    stage.querySelectorAll('.el').forEach((box) => box.classList.toggle('selected', isSelected(box.dataset.id)));
    if (animationSelect) animationSelect.value = selected()?.animation || '';
    syncToolbar();
  }

  function syncToolbar() {
    const el = selected();
    sizeSelect.value = el && el.type === 'text' && SIZES.includes(el.fs) ? String(el.fs) : '';
    const text = el && el.type === 'text' ? el : null;
    showStates((key) => text && (key === 'bold' || key === 'italic' ? text[key] : text.align === key));
  }

  // ---------- Edição de texto ----------

  function startTextEdit(id) {
    const el = slide().els.find((x) => x.id === id);
    const box = stage.querySelector(`.el[data-id="${id}"]`);
    if (!el || el.type !== 'text' || !box) return;
    editingId = id;
    selectEl(id);
    box.classList.add('editing');
    const content = box.querySelector('.el-content');
    content.contentEditable = 'true';
    content.focus();
    document.getSelection().selectAllChildren(content);
    content.addEventListener('blur', commitTextEdit, { once: true });
  }

  function commitTextEdit() {
    if (!editingId) return;
    const id = editingId;
    editingId = null;
    const el = slide().els.find((x) => x.id === id);
    const box = stage.querySelector(`.el[data-id="${id}"]`);
    if (!el || !box) return;
    const content = box.querySelector('.el-content');
    content.contentEditable = 'false';
    box.classList.remove('editing');
    const html = MO.sanitizeHTML(content.innerHTML);
    if (html !== el.html) {
      snapshot();
      el.html = html;
      ctx.dirty();
      renderThumbs();
    }
  }

  // ---------- Arrastar e redimensionar ----------

  function onPointerDown(e) {
    if (e.button !== 0) return;
    const box = e.target.closest('.el');
    if (!box) {
      commitTextEdit();
      selectEl(null);
      return;
    }
    const id = box.dataset.id;
    if (editingId === id) return;
    commitTextEdit();
    if (e.shiftKey && selId) {
      // Shift+clique junta ou retira o elemento da seleção.
      if (isSelected(id) && id !== selId) {
        extraSel.delete(id);
        stage.querySelectorAll('.el').forEach((b) => b.classList.toggle('selected', isSelected(b.dataset.id)));
      } else selectEl(id, true);
      e.preventDefault();
      return;
    }
    if (!isSelected(id)) selectEl(id);
    else selId = id;
    root.focus({ preventScroll: true });
    const el = selected();
    const resize = e.target.classList.contains('handle');
    drag = {
      el,
      box,
      resize,
      sx: e.clientX,
      sy: e.clientY,
      orig: { x: el.x, y: el.y, w: el.w, h: el.h },
      // Ao mover, os restantes elementos selecionados acompanham.
      others: resize ? [] : selectedEls().filter((x) => x !== el).map((x) => ({ el: x, box: stage.querySelector(`.el[data-id="${x.id}"]`), x: x.x, y: x.y })),
      moved: false
    };
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!drag) return;
    const dx = (e.clientX - drag.sx) / scale;
    const dy = (e.clientY - drag.sy) / scale;
    if (!drag.moved) {
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
      drag.moved = true;
      snapshot();
    }
    const { el, box, orig } = drag;
    if (drag.resize) {
      el.w = Math.round(Math.max(MIN, orig.w + dx));
      el.h = Math.round(Math.max(MIN, orig.h + dy));
    } else {
      el.x = Math.round(Math.max(-el.w + MIN, Math.min(W - MIN, orig.x + dx)));
      el.y = Math.round(Math.max(-el.h + MIN, Math.min(H - MIN, orig.y + dy)));
      const mx = el.x - orig.x;
      const my = el.y - orig.y;
      for (const o of drag.others) {
        o.el.x = Math.round(o.x + mx);
        o.el.y = Math.round(o.y + my);
        if (o.box) Object.assign(o.box.style, { left: o.el.x + 'px', top: o.el.y + 'px' });
      }
    }
    Object.assign(box.style, { left: el.x + 'px', top: el.y + 'px', width: el.w + 'px', height: el.h + 'px' });
  }

  function onPointerUp() {
    if (!drag) return;
    if (drag.moved) {
      ctx.dirty();
      renderThumbs();
    }
    drag = null;
  }

  // ---------- Ações ----------

  function addSlide(layout) {
    commitTextEdit();
    change(() => {
      slides.splice(idx + 1, 0, makeSlide(layout));
      idx++;
      selId = null;
    });
  }

  function duplicateSlide() {
    commitTextEdit();
    change(() => {
      const copy = JSON.parse(JSON.stringify(slide()));
      copy.els.forEach((el) => (el.id = uid()));
      slides.splice(idx + 1, 0, copy);
      idx++;
      selId = null;
    });
  }

  function duplicateElement() {
    const el = selected();
    if (!el) return MO.toast('Selecione primeiro um elemento do diapositivo.');
    commitTextEdit();
    const copy = JSON.parse(JSON.stringify(el));
    copy.id = uid();
    copy.x = Math.max(0, Math.min(W - Math.min(W, el.w), el.x + 24));
    copy.y = Math.max(0, Math.min(H - Math.min(H, el.h), el.y + 24));
    change(() => {
      slide().els.push(copy);
      selId = copy.id;
    });
  }

  function deleteSlide() {
    commitTextEdit();
    if (slides.length === 1) return MO.toast('A apresentação precisa de pelo menos um diapositivo.');
    change(() => {
      slides.splice(idx, 1);
      idx = Math.min(idx, slides.length - 1);
      selId = null;
    });
  }

  function moveSlide(delta) {
    commitTextEdit();
    const to = idx + delta;
    if (to < 0 || to >= slides.length) return;
    change(() => {
      const [s] = slides.splice(idx, 1);
      slides.splice(to, 0, s);
      idx = to;
    });
  }

  function addElement(el) {
    commitTextEdit();
    change(() => {
      slide().els.push(el);
      selId = el.id;
    });
  }

  // Gráfico: escolher o tipo e escrever ou colar os dados; entra no diapositivo como imagem.
  async function addChart() {
    const spec = await MO.Charts.dialog({ title: 'Inserir gráfico', okLabel: 'Inserir', editableData: true, spec: { ...{ type: 'column', title: 'Vendas por trimestre', categories: ['T1', 'T2', 'T3', 'T4'], series: [{ name: '2025', values: [120, 150, 170, 160] }, { name: '2026', values: [140, 165, 190, 210] }] }, palette: 'myoffice' } });
    if (!spec) return;
    try {
      const src = await MO.Charts.toPng(MO.Charts.render(spec, { width: 720, height: 420 }));
      addElement({ id: uid(), type: 'image', src, x: Math.round((W - 720) / 2), y: Math.round((H - 420) / 2) + 20, w: 720, h: 420 });
    } catch {
      MO.toast('Não foi possível criar o gráfico.');
    }
  }

  async function addImage() {
    const picked = await MO.pickImage();
    if (!picked) return;
    let src;
    try {
      src = await MO.officeImageDataURL(picked);
    } catch {
      return MO.toast('Não foi possível preparar a imagem para o PowerPoint.');
    }
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 600 / img.naturalWidth, 380 / img.naturalHeight);
      const w = Math.max(MIN, Math.round(img.naturalWidth * k));
      const hh = Math.max(MIN, Math.round(img.naturalHeight * k));
      addElement({ id: uid(), type: 'image', src, x: Math.round((W - w) / 2), y: Math.round((H - hh) / 2), w, h: hh });
    };
    img.onerror = () => MO.toast('Não foi possível ler a imagem.');
    img.src = src;
  }

  function withSelected(fn, onlyType) {
    const el = selected();
    if (!el) return MO.toast('Selecione primeiro um elemento do diapositivo.');
    if (onlyType && el.type !== onlyType) return;
    commitTextEdit();
    change(() => fn(el));
  }

  function deleteSelected() {
    if (!selected()) return;
    change(() => {
      slide().els = slide().els.filter((el) => !isSelected(el.id));
      selId = null;
      extraSel.clear();
    });
  }

  // ---------- Alinhar, distribuir e agrupar ----------

  function alignSelected(kind) {
    const els = selectedEls();
    if (!els.length) return MO.toast('Selecione um ou mais elementos (Shift+clique para vários).');
    // Um elemento alinha-se ao diapositivo; vários alinham-se entre si.
    const box = els.length === 1 ? { x0: 0, y0: 0, x1: W, y1: H } : {
      x0: Math.min(...els.map((e) => e.x)), y0: Math.min(...els.map((e) => e.y)),
      x1: Math.max(...els.map((e) => e.x + e.w)), y1: Math.max(...els.map((e) => e.y + e.h))
    };
    change(() => {
      for (const el of els) {
        if (kind === 'left') el.x = box.x0;
        else if (kind === 'hcenter') el.x = Math.round((box.x0 + box.x1 - el.w) / 2);
        else if (kind === 'right') el.x = box.x1 - el.w;
        else if (kind === 'top') el.y = box.y0;
        else if (kind === 'vmiddle') el.y = Math.round((box.y0 + box.y1 - el.h) / 2);
        else if (kind === 'bottom') el.y = box.y1 - el.h;
      }
    });
  }

  function distributeSelected(axis) {
    const els = selectedEls();
    if (els.length < 3) return MO.toast('Selecione três ou mais elementos para distribuir.');
    const pos = axis === 'h' ? 'x' : 'y';
    const size = axis === 'h' ? 'w' : 'h';
    const sorted = [...els].sort((a, b) => a[pos] - b[pos]);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const total = sorted.reduce((sum, el) => sum + el[size], 0);
    const gap = (last[pos] + last[size] - first[pos] - total) / (sorted.length - 1);
    change(() => {
      let at = first[pos];
      for (const el of sorted) {
        el[pos] = Math.round(at);
        at += el[size] + gap;
      }
    });
  }

  function groupSelected(on) {
    const els = selectedEls();
    if (on && els.length < 2) return MO.toast('Selecione dois ou mais elementos (Shift+clique) para agrupar.');
    if (!on && !els.some((el) => el.group)) return MO.toast('A seleção não tem grupos.');
    const gid = uid();
    change(() => els.forEach((el) => (on ? (el.group = gid) : delete el.group)));
    MO.toast(on ? 'Elementos agrupados: movem-se juntos.' : 'Grupo desfeito.');
  }

  // ---------- Tabelas ----------

  async function insertTable() {
    const res = await MO.dialog({
      title: 'Inserir tabela',
      fields: [
        { name: 'rows', label: 'Linhas (incluindo o cabeçalho)', type: 'number', value: 4, min: 2, max: MAX_TABLE_ROWS },
        { name: 'cols', label: 'Colunas', type: 'number', value: 3, min: 1, max: MAX_TABLE_COLS }
      ],
      okLabel: 'Inserir'
    });
    if (!res) return;
    const rows = Math.max(2, Math.min(MAX_TABLE_ROWS, parseInt(res.rows, 10) || 4));
    const cols = Math.max(1, Math.min(MAX_TABLE_COLS, parseInt(res.cols, 10) || 3));
    const data = Array.from({ length: rows }, (_r, r) => Array.from({ length: cols }, (_c, c) => (r === 0 ? `Coluna ${c + 1}` : '')));
    addElement({ id: uid(), type: 'table', x: 80, y: 140, w: 800, h: Math.min(360, rows * 44), rows: data, fs: 20, accent: theme.accent || '#1f5fbf' });
  }

  function editTable(fn) {
    const el = selected();
    if (!el || el.type !== 'table') return MO.toast('Selecione primeiro uma tabela.');
    commitTextEdit();
    change(() => fn(el));
  }

  const addRow = () => editTable((el) => { if (el.rows.length < MAX_TABLE_ROWS) { el.rows.push(Array(el.rows[0].length).fill('')); el.h += 40; } });
  const addCol = () => editTable((el) => { if (el.rows[0].length < MAX_TABLE_COLS) el.rows.forEach((r, i) => r.push(i === 0 ? `Coluna ${r.length + 1}` : '')); });
  const removeRow = () => editTable((el) => { if (el.rows.length > 2) { el.rows.pop(); el.h = Math.max(MIN, el.h - 40); } });
  const removeCol = () => editTable((el) => { if (el.rows[0].length > 1) el.rows.forEach((r) => r.pop()); });

  // Duplo clique numa célula: edita o texto dessa célula.
  function startCellEdit(box, cell) {
    const el = slide().els.find((x) => x.id === box.dataset.id);
    if (!el || el.type !== 'table') return;
    const r = Number(cell.dataset.r);
    const c = Number(cell.dataset.c);
    selectEl(el.id);
    cell.contentEditable = 'true';
    cell.focus();
    document.getSelection().selectAllChildren(cell);
    const finish = () => {
      cell.contentEditable = 'false';
      const text = cell.textContent.replace(/\s+/g, ' ').trim().slice(0, 500);
      if (text !== el.rows[r][c]) {
        snapshot();
        el.rows[r][c] = text;
        ctx.dirty();
        renderThumbs();
      }
    };
    cell.addEventListener('blur', finish, { once: true });
    cell.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); cell.blur(); }
      else if (e.key === 'Tab') {
        e.preventDefault();
        const cells = [...box.querySelectorAll('th, td')];
        const next = cells[cells.indexOf(cell) + (e.shiftKey ? -1 : 1)];
        cell.blur();
        if (next) startCellEdit(box, next);
      }
      e.stopPropagation();
    });
  }

  // ---------- Organizar diapositivos (vista em grelha) ----------

  let sorter = null;
  function toggleSorter() {
    if (sorter) { sorter.remove(); sorter = null; return; }
    commitTextEdit();
    sorter = h('div', { class: 'slide-sorter', role: 'list', 'aria-label': 'Organizar diapositivos' });
    let dragFrom = null;
    const draw = () => {
      sorter.replaceChildren(
        h('div', { class: 'sorter-head' }, h('strong', null, 'Organizar diapositivos'), h('span', null, 'Arraste para mudar a ordem · clique para abrir'), h('button', { type: 'button', class: 'btn', onclick: toggleSorter }, 'Fechar')),
        h('div', { class: 'sorter-grid' }, slides.map((s, i) => {
          const card = h('div', { class: 'sorter-card' + (i === idx ? ' active' : ''), draggable: 'true', role: 'listitem', 'data-index': i, title: 'Diapositivo ' + (i + 1) },
            h('span', { class: 'sorter-frame' }, renderSlide(s, false)), h('span', { class: 'sorter-num' }, i + 1));
          card.addEventListener('click', () => { goTo(i); toggleSorter(); });
          card.addEventListener('dragstart', (e) => { dragFrom = i; e.dataTransfer.effectAllowed = 'move'; card.classList.add('dragging'); });
          card.addEventListener('dragend', () => card.classList.remove('dragging'));
          card.addEventListener('dragover', (e) => { e.preventDefault(); card.classList.add('drop'); });
          card.addEventListener('dragleave', () => card.classList.remove('drop'));
          card.addEventListener('drop', (e) => {
            e.preventDefault();
            if (dragFrom === null || dragFrom === i) return;
            moveSlideTo(dragFrom, i);
            dragFrom = null;
            draw();
          });
          return card;
        }))
      );
    };
    draw();
    root.append(sorter);
  }

  function moveSlideTo(from, to) {
    change(() => {
      const [moved] = slides.splice(from, 1);
      slides.splice(to, 0, moved);
      idx = to;
    });
  }

  function reorder(toFront) {
    withSelected((el) => {
      const els = slide().els.filter((x) => x !== el);
      if (toFront) els.push(el);
      else els.unshift(el);
      slide().els = els;
    });
  }

  function toggleInline(prop, command) {
    // Durante a edição formata só o texto selecionado; fora dela, a caixa inteira.
    if (editingId) document.execCommand(command, false);
    else withSelected((el) => (el[prop] = !el[prop]), 'text');
  }

  // As cores mudam em contínuo enquanto se arrasta no seletor: guarda um único passo de histórico.
  function liveColor(apply) {
    return (value) => {
      const el = selected();
      if (!colorSnapshotTaken) {
        snapshot();
        colorSnapshotTaken = true;
      }
      apply(value, el);
      renderAll();
      ctx.dirty();
    };
  }
  const colorDone = () => (colorSnapshotTaken = false);

  function applyTheme(next) {
    commitTextEdit();
    change(() => {
      theme = next;
      slides.forEach((s, i) => {
        const first = i === 0 && !s.deco;
        Object.assign(s, { bg: next.bg, accent: next.accent, font: next.font, headFont: next.headFont, deco: next.deco });
        if (first) s.lead = true;
        for (const el of s.els) if (el.type === 'text') el.color = el.role === 'title' ? next.title : next.text;
      });
    });
    syncThemeUI();
  }

  function variantChip(variant) {
    const look = T.slideLook(T.byId(theme.id), variant.id);
    const chip = toolButton(
      [h('span', { class: 'theme-bar', style: { background: look.accent } }), h('span', { class: 'theme-title', style: { color: look.title, fontFamily: FONTS[look.headFont] } }, 'Aa'), h('span', { class: 'theme-name', style: { color: look.text } }, variant.name)],
      'Variante ' + variant.name,
      () => applyTheme(look),
      'theme-chip variant-chip' + (variant.id === theme.variant ? ' active' : '')
    );
    chip.style.background = look.bg;
    return chip;
  }

  // Atualiza as galerias e as cores dos seletores para o tema em uso.
  function syncThemeUI() {
    T.markActive(themeRow, theme.id);
    variantRow.replaceChildren(...T.VARIANTS.map(variantChip));
    T.setPickerColors(PICKER, T.byId(theme.id));
  }

  // ---------- Assistente (motor próprio, ver assistant.js) ----------

  function showAI(...content) {
    aiBody.replaceChildren(...content.flat(Infinity).filter(Boolean));
    aiPanel.hidden = false;
    fitStage();
  }

  function hideAI() {
    aiPanel.hidden = true;
    fitStage();
  }

  async function aiGenerate() {
    commitTextEdit();
    const res = await MO.dialog({
      title: 'Criar apresentação',
      message: 'Indique o tema. O motor próprio do MyOffice escolhe uma estrutura e cria tópicos e notas orientadoras sem modelos descarregados nem serviços externos. Substitui a apresentação atual; pode anular com Ctrl+Z.',
      fields: [
        { name: 'topic', label: 'Tema', placeholder: 'Ex.: Plano de marketing para 2027' },
        { name: 'audience', label: 'Público (opcional)', placeholder: 'Ex.: direção da empresa' },
        { name: 'count', label: 'Número de diapositivos', type: 'number', value: 6, min: 3, max: 10 }
      ],
      okLabel: 'Criar'
    });
    if (!res) return;
    const out = window.api?.ai?.generate
      ? await window.api.ai.generate(res)
      : MO.Assistant.generateDeck(res);
    if (out.error) return MO.toast(out.error);
    change(() => {
      slides = [makeSlide('title', out), ...out.slides.map((s) => makeSlide('content', s))];
      idx = 0;
      selId = null;
    });
    root.focus({ preventScroll: true });
    MO.toast(`Estrutura «${out.type}» criada: ${slides.length} diapositivos. Complete os tópicos com os seus dados.`);
  }

  // Texto de um elemento, uma linha por parágrafo ou item de lista.
  const linesOf = (html) => {
    const div = h('div');
    div.innerHTML = html.replace(/<\/(li|p|div)>|<br\s*\/?>/gi, '\n');
    return div.textContent
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  };

  function slideParts(s) {
    const texts = s.els.filter((el) => el.type === 'text');
    const title = texts.find((el) => el.role === 'title') || texts[0] || null;
    const bodies = texts.filter((el) => el !== title);
    return { title, body: bodies.find((el) => el.role === 'body') || bodies[0] || null, bodies };
  }

  function applySuggestion(target, sug) {
    if (!slides.includes(target)) return MO.toast('Esse diapositivo já não existe.');
    commitTextEdit();
    change(() => {
      idx = slides.indexOf(target);
      selId = null;
      const parts = slideParts(target);
      let body = parts.body;
      if (parts.title && sug.title) parts.title.html = MO.escapeHTML(sug.title);
      if (sug.bullets.length) {
        if (!body) {
          body = textEl(60, 140, 840, 340, '', { fs: 28, role: 'body' });
          target.els.push(body);
        }
        // Caixas baixas (como o subtítulo) recebem uma linha; as restantes, a lista.
        body.html = body.h < 150 ? MO.escapeHTML(sug.bullets.join(' · ')) : bulletsHTML(sug.bullets);
      }
      if (sug.notes) target.notes = sug.notes;
    });
    // Devolve o foco ao editor, para Ctrl+Z anular de imediato.
    root.focus({ preventScroll: true });
    MO.toast('Sugestão aplicada.');
  }

  const suggestionCard = (target, sug) =>
    h(
      'article',
      { class: 'ai-card' },
      h('div', { class: 'ai-label' }, sug.label),
      sug.title ? h('h3', null, sug.title) : null,
      h('ul', null, sug.bullets.map((b) => h('li', null, b))),
      h('p', { class: 'ai-reason' }, sug.reason),
      h('button', { type: 'button', class: 'btn primary', onclick: () => applySuggestion(target, sug) }, 'Aplicar')
    );

  function designSlide(target, kind, input) {
    const original = slideParts(target);
    const originalTitleId = original.title && original.title.id;
    const title = input.title || 'Título do diapositivo';
    const bullets = input.bullets || [];
    const hasArtwork = target.els.some((el) => el.type !== 'text');
    const out = { ...target, els: [] };
    const titleColor = original.title && original.title.color || theme.title;
    const bodyColor = original.body && original.body.color || theme.text;
    const addText = (x, y, w, hh, text, extra = {}) => out.els.push(textEl(x, y, w, hh, MO.escapeHTML(text), { color: bodyColor, ...extra }));
    const addHTML = (x, y, w, hh, html, extra = {}) => out.els.push(textEl(x, y, w, hh, html, { color: bodyColor, ...extra }));
    const addShape = (x, y, w, hh, fill) => out.els.push({ id: uid(), type: 'rect', x, y, w, h: hh, fill });

    if (hasArtwork || kind === 'balanced') {
      // Complex slides keep every illustration and shape. Adjust only type scale and title contrast.
      out.els = target.els.map((el) => ({ ...el }));
      for (const el of out.els) if (el.type === 'text') {
        if (el.id === originalTitleId || el.role === 'title') { el.fs = Math.min(46, Math.max(34, el.fs)); el.bold = true; el.color = titleColor; }
        else el.fs = Math.min(28, Math.max(20, el.fs));
      }
      out.accent = target.accent || theme.accent;
      return out;
    }

    if (kind === 'split') {
      addText(60, 40, 840, 80, title, { fs: 40, bold: true, role: 'title', color: titleColor });
      const middle = Math.ceil(bullets.length / 2);
      const left = bullets.slice(0, middle); const right = bullets.slice(middle);
      addHTML(60, 150, 400, 340, left.length ? bulletsHTML(left) : '', { fs: bullets.length > 5 ? 22 : 26, role: 'body' });
      addHTML(500, 150, 400, 340, right.length ? bulletsHTML(right) : '', { fs: bullets.length > 5 ? 22 : 26, role: 'body' });
      out.deco = 'barra';
    } else if (kind === 'cards') {
      addText(60, 40, 840, 80, title, { fs: 40, bold: true, role: 'title', color: titleColor });
      const items = bullets;
      items.slice(0, 8).forEach((text, i) => {
        const x = i % 2 ? 500 : 60; const y = 150 + Math.floor(i / 2) * 86;
        addShape(x, y, 400, 72, i % 2 ? '#edf2eb' : '#f4f0e6');
        addText(x + 18, y + 10, 364, 52, text, { fs: 22, bold: true });
      });
      out.deco = 'linha';
    } else {
      addShape(58, 56, 12, 430, target.accent || theme.accent);
      addText(100, 64, 790, 98, title, { fs: 44, bold: true, role: 'title', color: titleColor });
      addHTML(100, 190, 790, 290, bullets.length ? bulletsHTML(bullets) : '', { fs: 28, role: 'body' });
      out.deco = 'barra';
    }
    out.accent = target.accent || theme.accent;
    out.bg = target.bg || theme.bg;
    out.font = target.font || theme.font;
    out.headFont = target.headFont || theme.headFont;
    return out;
  }

  function applyDesign(target, proposed) {
    if (!slides.includes(target)) return MO.toast('Esse diapositivo já não existe.');
    commitTextEdit();
    change(() => {
      idx = slides.indexOf(target);
      const notes = target.notes;
      target.els = copySlides([{ ...proposed, notes, els: proposed.els }])[0].els;
      target.bg = proposed.bg; target.accent = proposed.accent; target.font = proposed.font;
      target.headFont = proposed.headFont; target.deco = proposed.deco;
      selId = null;
    });
    root.focus({ preventScroll: true });
    MO.toast('Ideia de design aplicada. Pode anular com Ctrl+Z.');
  }

  function designCard(target, proposal) {
    const preview = h('div', { class: 'ai-layout-preview', 'aria-label': `Pré-visualização: ${proposal.label}` }, renderSlide(proposal.slide, false));
    return h('article', { class: 'ai-card ai-layout-card' },
      h('div', { class: 'ai-label' }, proposal.label), preview,
      h('p', { class: 'ai-reason' }, proposal.reason),
      h('button', { type: 'button', class: 'btn primary', onclick: () => applyDesign(target, proposal.slide) }, 'Aplicar este design')
    );
  }

  function designIdeas(target, input) {
    if (!input.title && !input.bullets.length) return { error: 'Adicione texto ao diapositivo para receber ideias de design.' };
    const complex = target.els.some((el) => el.type !== 'text');
    const specs = complex
      ? [['balanced', 'Melhorar a hierarquia', 'Ajusta o tamanho e o destaque do texto e mantém as imagens e formas.']]
      : [
          ['editorial', 'Título em destaque', 'Organiza o título e os tópicos numa composição clara com destaque lateral.'],
          ...(input.bullets.length >= 2 && input.bullets.length <= 8 ? [
            ['split', 'Duas colunas', 'Distribui os tópicos em duas colunas para facilitar a leitura.'],
            ['cards', 'Cartões organizados', 'Apresenta cada tópico num cartão, usando apenas o conteúdo do diapositivo.']
          ] : [])
        ];
    return { proposals: specs.map(([kind, label, reason]) => ({ label, reason, slide: designSlide(target, kind, input) })) };
  }

  function makeVisualPNG(kind) {
    const canvas = h('canvas');
    canvas.width = 960;
    canvas.height = 540;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Não foi possível criar a ilustração.');
    const accent = MO.HEX.test(theme.accent) ? theme.accent : '#6658d3';
    const ink = '#27344d';
    const pale = '#e7ebf4';
    const soft = '#f5f7fb';
    const box = (x, y, w, h_, r, color) => {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h_, r);
      ctx.fillStyle = color;
      ctx.fill();
    };
    const circle = (x, y, radius, color) => {
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    };
    ctx.fillStyle = soft;
    ctx.fillRect(0, 0, 960, 540);
    circle(860, 72, 145, '#edf0f8');
    circle(94, 468, 105, '#eef1f8');
    box(48, 42, 864, 456, 28, '#ffffff');
    box(78, 74, 10, 46, 5, accent);
    ctx.fillStyle = ink;
    ctx.font = '600 22px Segoe UI, Arial, sans-serif';
    ctx.fillText('VISUAL PARA A APRESENTAÇÃO', 108, 104);
    ctx.strokeStyle = pale;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(88, 146);
    ctx.lineTo(872, 146);
    ctx.stroke();

    if (kind === 'chart') {
      ctx.strokeStyle = '#cbd3e2';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(180, 390); ctx.lineTo(780, 390);
      ctx.moveTo(180, 195); ctx.lineTo(180, 390);
      ctx.stroke();
      [285, 335, 250, 198, 158].forEach((y, i) => box(235 + i * 105, y, 58, 390 - y, 12, i === 4 ? accent : '#cbd4ea'));
      ctx.strokeStyle = accent;
      ctx.lineWidth = 8;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      [[264, 278], [368, 270], [473, 235], [578, 218], [683, 168], [765, 176]].forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
      ctx.stroke();
      [[264, 278], [368, 270], [473, 235], [578, 218], [683, 168], [765, 176]].forEach(([x, y]) => circle(x, y, 9, '#ffffff'));
      [[264, 278], [368, 270], [473, 235], [578, 218], [683, 168], [765, 176]].forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fillStyle = accent; ctx.fill(); });
    } else if (kind === 'process') {
      const xs = [238, 480, 722];
      ctx.strokeStyle = '#d4dbea'; ctx.lineWidth = 8;
      ctx.beginPath(); ctx.moveTo(xs[0], 298); ctx.lineTo(xs[2], 298); ctx.stroke();
      xs.forEach((x, i) => {
        circle(x, 298, 74, i === 1 ? '#eef0fb' : '#f2f4f9');
        circle(x, 298, 53, i === 1 ? accent : '#cbd4ea');
        ctx.fillStyle = '#ffffff'; ctx.font = '700 36px Segoe UI, Arial, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(String(i + 1), x, 311);
      });
      ctx.textAlign = 'left';
      [[183, 'DEFINIR'], [421, 'EXECUTAR'], [662, 'AVALIAR']].forEach(([x, text]) => { ctx.fillStyle = ink; ctx.font = '600 17px Segoe UI, Arial, sans-serif'; ctx.fillText(text, x, 405); });
    } else if (kind === 'team') {
      const people = [[285, '#cbd4ea'], [480, accent], [675, '#d7e8df']];
      people.forEach(([x, color], i) => {
        circle(x, 260 + (i === 1 ? -18 : 0), 48, i === 1 ? '#f5d9c8' : '#f2dcca');
        box(x - 78, 318 + (i === 1 ? -18 : 0), 156, 110, 60, color);
        box(x - 34, 230 + (i === 1 ? -18 : 0), 68, 18, 9, ink);
      });
      box(205, 420, 550, 10, 5, pale);
    } else if (kind === 'target') {
      [138, 106, 74, 42].forEach((radius, i) => circle(480, 305, radius, [pale, '#d5dcef', '#aab9dc', accent][i]));
      ctx.strokeStyle = ink; ctx.lineWidth = 9; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(480, 305); ctx.lineTo(686, 178); ctx.stroke();
      ctx.fillStyle = ink; ctx.beginPath(); ctx.moveTo(686, 178); ctx.lineTo(650, 183); ctx.lineTo(680, 211); ctx.closePath(); ctx.fill();
      circle(480, 305, 14, '#ffffff');
    } else if (kind === 'leaf') {
      ctx.strokeStyle = '#6c9b7d'; ctx.lineWidth = 12; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(477, 410); ctx.bezierCurveTo(470, 340, 494, 262, 528, 188); ctx.stroke();
      [[420, 332, -0.6], [548, 286, 0.7], [430, 244, -0.7], [552, 210, 0.7]].forEach(([x, y, turn], i) => {
        ctx.save(); ctx.translate(x, y); ctx.rotate(turn); ctx.fillStyle = i % 2 ? accent : '#85b697';
        ctx.beginPath(); ctx.ellipse(0, 0, 62, 28, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      });
      box(390, 414, 180, 18, 9, '#b5c5ad');
    } else {
      circle(480, 295, 132, '#f2f0fb');
      ctx.strokeStyle = accent; ctx.lineWidth = 16; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(423, 292); ctx.bezierCurveTo(423, 193, 538, 193, 538, 292); ctx.bezierCurveTo(538, 332, 504, 342, 502, 380); ctx.lineTo(458, 380); ctx.bezierCurveTo(456, 342, 423, 332, 423, 292); ctx.stroke();
      box(454, 390, 52, 14, 7, ink); box(461, 414, 38, 12, 6, '#8390aa');
      [[480, 184, 480, 160], [388, 220, 368, 204], [572, 220, 592, 204], [367, 300, 338, 300], [593, 300, 622, 300]].forEach(([x1, y1, x2, y2]) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); });
    }
    return canvas.toDataURL('image/png');
  }

  function insertSuggestedVisual(target, visual, src) {
    if (!slides.includes(target)) return MO.toast('Esse diapositivo já não existe.');
    commitTextEdit();
    const parts = slideParts(target);
    const image = { id: uid(), type: 'image', src, x: 550, y: 170, w: 350, h: 197 };
    change(() => {
      idx = slides.indexOf(target);
      for (const body of parts.bodies) {
        if (body.w > 500) {
          body.x = 60;
          body.w = 450;
          body.fs = Math.min(body.fs, 24);
        }
      }
      slide().els.push(image);
      selId = image.id;
    });
    root.focus({ preventScroll: true });
    MO.toast(`Ilustração «${visual.label}» inserida. Será exportada para PowerPoint (.pptx).`);
  }

  function visualSuggestionCard(target, visual) {
    let src;
    try {
      src = makeVisualPNG(visual.kind);
    } catch {
      return h('p', { class: 'ai-error' }, 'Não foi possível criar a pré-visualização da ilustração.');
    }
    return h('article', { class: 'ai-card ai-visual-card' },
      h('div', { class: 'ai-label' }, 'Ilustração local · PowerPoint'),
      h('h3', null, visual.label),
      h('img', { class: 'ai-visual-preview', src, alt: `Pré-visualização: ${visual.label}` }),
      h('p', { class: 'ai-reason' }, visual.reason),
      h('button', { type: 'button', class: 'btn primary', onclick: () => insertSuggestedVisual(target, visual, src) }, 'Inserir no diapositivo')
    );
  }

  async function aiSuggest() {
    commitTextEdit();
    const target = slide();
    const parts = slideParts(target);
    const input = {
      title: parts.title ? linesOf(parts.title.html).join(' ') : '',
      bullets: parts.bodies.flatMap((el) => linesOf(el.html)),
      notes: target.notes || ''
    };
    const out = MO.Assistant.suggest(input);
    if (out.error) return MO.toast(out.error);
    const designs = designIdeas(target, input);
    const n = slides.indexOf(target) + 1;
    const cards = [
      h('p', { class: 'ai-hint' }, `Diapositivo ${n}. O motor próprio usa regras de escrita; reveja as sugestões antes de aplicar.`),
      out.tips.length ? h('article', { class: 'ai-card ai-tips' }, h('div', { class: 'ai-label' }, 'Dicas'), h('ul', null, out.tips.map((t) => h('li', null, t)))) : null,
      out.suggestions.length ? out.suggestions.map((sug) => suggestionCard(target, sug)) : h('p', { class: 'ai-ok' }, 'As regras de escrita não têm alterações a propor para este diapositivo.'),
      h('h3', { class: 'ai-visual-heading' }, 'Ideias de design'),
      designs.error ? h('p', { class: 'ai-hint' }, designs.error) : designs.proposals.map((proposal) => designCard(target, proposal)),
      h('details', { class: 'ai-more-visuals' }, h('summary', null, 'Ilustrações para inserir'), MO.Assistant.suggestVisuals(input).visuals.map((visual) => visualSuggestionCard(target, visual)))
    ];
    showAI(cards);
  }

  function onKeyDown(e) {
    if (editingId) {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    if (e.target !== root) return;
    const mod = e.ctrlKey || e.metaKey;
    const el = selected();
    const nudge = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.key];
    const k = e.key.toLowerCase();

    if (mod && k === 'z' && !e.shiftKey) timeTravel(undoStack, redoStack);
    else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) timeTravel(redoStack, undoStack);
    else if (mod && k === 'd' && el) duplicateElement();
    else if ((e.key === 'Delete' || e.key === 'Backspace') && el) deleteSelected();
    else if (e.key === 'Enter' && el && el.type === 'text') startTextEdit(el.id);
    else if (e.key === 'Escape' && el) selectEl(null);
    else if (nudge && el) {
      const step = e.shiftKey ? 10 : 1;
      change(() => {
        el.x += nudge[0] * step;
        el.y += nudge[1] * step;
      });
    } else if ((e.key === 'ArrowUp' || e.key === 'PageUp') && !el) goTo(idx - 1);
    else if ((e.key === 'ArrowDown' || e.key === 'PageDown') && !el) goTo(idx + 1);
    else if (e.key === 'F5') present(0);
    else return;
    e.preventDefault();
  }

  // ---------- Modo de apresentação ----------

  function present(from, presenterView) {
    commitTextEdit();
    let presenter = Boolean(presenterView);
    const started = Date.now();
    let clock = null;
    let i = Math.max(0, Math.min(slides.length - 1, from));
    let wasFullscreen = false;
    const overlay = h('div', { class: 'present', tabindex: '0', 'aria-label': 'Apresentação' });

    let moveDirection = 0;
    function draw() {
      const node = renderSlide(slides[i], false);
      const k = Math.min(window.innerWidth / W, window.innerHeight / H);
      node.style.transform = `translate(-50%, -50%) scale(${k})`;
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches && slides[i].transition) {
        const frames = {
          fade: [{ opacity: 0 }, { opacity: 1 }],
          push: [{ opacity: 0, transform: `translate(-50%, -50%) scale(${k}) translateX(${moveDirection < 0 ? '-8%' : '8%'})` }, { opacity: 1, transform: node.style.transform }],
          wipe: [{ clipPath: moveDirection < 0 ? 'inset(0 0 0 100%)' : 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }]
        };
        node.animate(frames[slides[i].transition], { duration: 420, easing: 'ease-out' });
      }
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        node.querySelectorAll('.el[data-animation]').forEach((element, order) => {
          const effect = element.dataset.animation;
          const frames = effect === 'zoom'
            ? [{ opacity: 0, transform: 'scale(.72)' }, { opacity: 1, transform: 'scale(1)' }]
            : effect === 'fade' ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'translateY(0)' }];
          element.animate(frames, { duration: 360, delay: order * 100, easing: 'ease-out' });
        });
      }
      overlay.classList.toggle('presenter', presenter);
      if (presenter) {
        // Vista do apresentador: diapositivo atual, o seguinte, notas e tempo decorrido.
        const fit = (s, maxW, maxH) => {
          const n = renderSlide(s, false);
          const kk = Math.min(maxW / W, maxH / H);
          n.style.transform = `scale(${kk})`;
          return h('div', { class: 'pv-frame', style: { width: W * kk + 'px', height: H * kk + 'px' } }, n);
        };
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        clockEl = h('span', { class: 'pv-clock' });
        overlay.replaceChildren(h('div', { class: 'pv' },
          h('div', { class: 'pv-main' }, fit(slides[i], vw * 0.6, vh * 0.72), h('div', { class: 'pv-bar' }, clockEl, h('span', null, `Diapositivo ${i + 1} de ${slides.length}`), h('span', { class: 'pv-hint' }, 'P: sair da vista · Esc: terminar'))),
          h('div', { class: 'pv-side' },
            h('h3', null, 'A seguir'),
            slides[i + 1] ? fit(slides[i + 1], vw * 0.3, vh * 0.25) : h('p', { class: 'pv-end' }, 'Fim da apresentação'),
            h('h3', null, 'Notas'),
            h('div', { class: 'pv-notes' }, slides[i].notes || 'Sem notas para este diapositivo.'))));
        tick();
      } else {
        overlay.replaceChildren(node, h('div', { class: 'present-count' }, `${i + 1} / ${slides.length}`));
      }
      moveDirection = 0;
    }

    let clockEl = null;
    function tick() {
      if (!clockEl) return;
      const sec = Math.floor((Date.now() - started) / 1000);
      clockEl.textContent = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
    }
    clock = setInterval(tick, 1000);

    function close() {
      clearInterval(clock);
      window.removeEventListener('resize', draw);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      overlay.remove();
      goTo(i);
      root.focus({ preventScroll: true });
    }

    function step(delta) {
      const next = i + delta;
      if (next >= slides.length) return close();
      moveDirection = delta;
      i = Math.max(0, next);
      draw();
    }

    function onFullscreenChange() {
      if (document.fullscreenElement) wasFullscreen = true;
      else if (wasFullscreen) close();
    }

    overlay.addEventListener('keydown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') close();
      else if (e.key === 'p' || e.key === 'P') { presenter = !presenter; draw(); }
      else if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) step(1);
      else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) step(-1);
      else if (e.key === 'Home') step(-i);
    });
    overlay.addEventListener('click', () => step(1));
    window.addEventListener('resize', draw);
    document.addEventListener('fullscreenchange', onFullscreenChange);

    document.body.append(overlay);
    draw();
    overlay.focus();
    if (overlay.requestFullscreen) overlay.requestFullscreen().catch(() => {});
  }

  // ---------- Construção da interface ----------

  function buildRibbon() {
    animationSelect = h('select', { class: 'tool-select', title: 'Animação do elemento selecionado', 'aria-label': 'Animação do elemento' },
      h('option', { value: '' }, 'Sem animação'),
      h('option', { value: 'appear' }, 'Aparecer'),
      h('option', { value: 'fade' }, 'Desvanecer'),
      h('option', { value: 'zoom' }, 'Ampliar')
    );
    animationSelect.addEventListener('change', () => withSelected((el) => { if (animationSelect.value) el.animation = animationSelect.value; else delete el.animation; }));
    transitionSelect = h('select', { class: 'tool-select', title: 'Transição ao apresentar', 'aria-label': 'Transição do diapositivo' },
      h('option', { value: '' }, 'Sem transição'),
      h('option', { value: 'fade' }, 'Desvanecer'),
      h('option', { value: 'push' }, 'Deslizar'),
      h('option', { value: 'wipe' }, 'Revelar')
    );
    transitionSelect.addEventListener('change', () => change(() => { slide().transition = transitionSelect.value; }));
    sizeSelect = h(
      'select',
      { class: 'tool-select', title: 'Tamanho da letra', 'aria-label': 'Tamanho da letra' },
      h('option', { value: '' }, 'Tamanho'),
      SIZES.map((s) => h('option', { value: s }, s))
    );
    sizeSelect.addEventListener('change', () => {
      const fs = Number(sizeSelect.value);
      if (fs) withSelected((el) => (el.fs = fs), 'text');
    });

    const layoutSelect = h(
      'select',
      { class: 'tool-select', title: 'Novo diapositivo com esquema', 'aria-label': 'Novo diapositivo com esquema' },
      h('option', { value: '' }, 'Esquema…'),
      LAYOUTS.map(([value, label]) => h('option', { value }, label))
    );
    layoutSelect.addEventListener('change', () => {
      if (layoutSelect.value) addSlide(layoutSelect.value);
      layoutSelect.selectedIndex = 0;
    });

    themeRow = h('div', { class: 'theme-gallery' }, T.gallery((t) => applyTheme(T.slideLook(t, theme.variant))));
    variantRow = h('div', { class: 'theme-gallery' });

    const insertText = () => addElement(textEl(280, 220, 400, 100, 'Texto'));
    const insertRect = () => addElement({ id: uid(), type: 'rect', x: 360, y: 190, w: 240, h: 160, fill: '#1f5fbf' });
    const insertEllipse = () => addElement({ id: uid(), type: 'ellipse', x: 380, y: 170, w: 200, h: 200, fill: '#c8491f' });

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
              label: 'Diapositivos',
              rows: [
                [
                  bigButton('slideNew', 'Novo', 'Novo diapositivo', () => addSlide('content')),
                  h(
                    'div',
                    { class: 'ribbon-stack' },
                    layoutSelect,
                    h(
                      'div',
                      { class: 'ribbon-row' },
                      iconButton('duplicate', 'Duplicar diapositivo', duplicateSlide, 'Duplicar'),
                      iconButton('trash', 'Eliminar diapositivo', deleteSlide)
                    )
                  ),
                  h(
                    'div',
                    { class: 'ribbon-stack' },
                    iconButton('up', 'Mover diapositivo para cima', () => moveSlide(-1)),
                    iconButton('down', 'Mover diapositivo para baixo', () => moveSlide(1))
                  )
                ]
              ]
            },
            {
              label: 'Tipo de letra',
              rows: [
                [sizeSelect],
                [
                  toolButton('N', 'Negrito', () => toggleInline('bold', 'bold'), 'bold'),
                  toolButton('I', 'Itálico', () => toggleInline('italic', 'italic'), 'italic'),
                  colorButton(
                    'A',
                    'Cor do elemento selecionado',
                    '#c62828',
                    liveColor((v, el) => {
                      if (!el) return;
                      if (el.type === 'text') el.color = v;
                      else if (el.type !== 'image') el.fill = v;
                    }),
                    colorDone,
                    PICKER
                  )
                ]
              ]
            },
            {
              label: 'Parágrafo',
              rows: [
                [
                  iconButton('alignLeft', 'Alinhar à esquerda', () => withSelected((el) => (el.align = 'left'), 'text')),
                  iconButton('alignCenter', 'Centrar', () => withSelected((el) => (el.align = 'center'), 'text')),
                  iconButton('alignRight', 'Alinhar à direita', () => withSelected((el) => (el.align = 'right'), 'text'))
                ]
              ]
            },
            {
              label: 'Dispor',
              rows: [
                [iconButton('duplicate', 'Duplicar elemento (Ctrl+D)', duplicateElement, 'Duplicar'), iconButton('front', 'Trazer para a frente', () => reorder(true), 'Frente'), iconButton('close', 'Eliminar elemento (Delete)', deleteSelected)],
                [iconButton('back', 'Enviar para trás', () => reorder(false), 'Trás')]
              ]
            },
            {
              label: 'Alinhar (Shift+clique para vários)',
              rows: [
                [
                  iconButton('alignObjLeft', 'Alinhar à esquerda (elementos)', () => alignSelected('left')),
                  iconButton('alignObjCenter', 'Centrar na horizontal (elementos)', () => alignSelected('hcenter')),
                  iconButton('alignObjRight', 'Alinhar à direita (elementos)', () => alignSelected('right')),
                  iconButton('alignObjTop', 'Alinhar acima (elementos)', () => alignSelected('top')),
                  iconButton('alignObjMiddle', 'Centrar na vertical (elementos)', () => alignSelected('vmiddle')),
                  iconButton('alignObjBottom', 'Alinhar abaixo (elementos)', () => alignSelected('bottom'))
                ],
                [
                  iconButton('distH', 'Distribuir na horizontal', () => distributeSelected('h'), 'Distribuir ↔'),
                  iconButton('distV', 'Distribuir na vertical', () => distributeSelected('v'), 'Distribuir ↕')
                ],
                [
                  iconButton('group', 'Agrupar elementos', () => groupSelected(true), 'Agrupar'),
                  iconButton('ungroup', 'Desagrupar elementos', () => groupSelected(false), 'Desagrupar')
                ]
              ]
            }
          ]
        },
        {
          label: 'Inserir',
          groups: [
            { label: 'Texto', rows: [[bigButton('textBox', 'Caixa de texto', 'Inserir caixa de texto', insertText)]] },
            { label: 'Ilustrações', rows: [[bigButton('image', 'Imagem', 'Inserir imagem', addImage)], [bigButton('chart', 'Gráfico', 'Inserir um gráfico (colunas, barras, linhas, circular…)', addChart)]] },
            {
              label: 'Tabela',
              rows: [
                [bigButton('table', 'Tabela', 'Inserir tabela no diapositivo', insertTable)],
                [
                  iconButton('rowAdd', 'Acrescentar linha à tabela', addRow, 'Linha +'),
                  iconButton('colAdd', 'Acrescentar coluna à tabela', addCol, 'Coluna +')
                ],
                [
                  iconButton('rowDel', 'Remover a última linha', removeRow, 'Linha −'),
                  iconButton('colDel', 'Remover a última coluna', removeCol, 'Coluna −')
                ]
              ]
            },
            {
              label: 'Formas',
              rows: [[bigButton('rect', 'Retângulo', 'Inserir retângulo', insertRect), bigButton('ellipse', 'Elipse', 'Inserir elipse', insertEllipse)]]
            }
          ]
        },
        {
          label: 'Estrutura',
          groups: [
            { label: 'Temas', rows: [themeRow] },
            { label: 'Variantes', rows: [variantRow] },
            {
              label: 'Personalizar',
              rows: [[colorButton('Cor de fundo', 'Cor de fundo do diapositivo', '#ffffff', liveColor((v) => (slide().bg = v)), colorDone, PICKER)]]
            }
          ]
        },
        {
          label: 'Assistente',
          groups: [
            {
              label: 'Criar',
              rows: [[bigButton('sparkle', 'Criar apresentação', 'Criar a estrutura de uma apresentação a partir de um tema', aiGenerate)]]
            },
            {
              label: 'Melhorar',
              rows: [[bigButton('sparkle', 'Sugestões', 'Sugestões para o diapositivo atual', aiSuggest)]]
            },
          ]
        },
        {
          label: 'Apresentação',
          groups: [
            { label: 'Transição', rows: [[transitionSelect]] },
            { label: 'Animação do elemento', rows: [[animationSelect]] },
            {
              label: 'Iniciar apresentação',
              rows: [
                [
                  bigButton('play', 'Do início', 'Iniciar apresentação do início (F5)', () => present(0)),
                  bigButton('playCurrent', 'Do diapositivo atual', 'Iniciar apresentação no diapositivo atual', () => present(idx)),
                  bigButton('presenter', 'Vista do apresentador', 'Apresentar com notas, diapositivo seguinte e cronómetro (tecla P alterna)', () => present(idx, true))
                ]
              ]
            },
            {
              label: 'Organizar',
              rows: [
                [bigButton('sorter', 'Organizar diapositivos', 'Ver todos os diapositivos em grelha e arrastar para reordenar', toggleSorter)]
              ]
            }
          ]
        }
      ],
      () => ctx.file()
    );
  }

  MO.modules.slides = {
    id: 'slides',
    label: 'Diapositivos',
    ext: 'moslides',
    filterName: 'Apresentação MyOffice',
    defaultName: 'Apresentação',

    init(container, context) {
      ctx = context;
      thumbs = h('div', { class: 'thumbs' });
      stage = h('div', { class: 'stage' });
      stageBox = h('div', { class: 'stage-box' }, stage);
      notesEl = h('textarea', { class: 'notes', rows: '3', placeholder: 'Clique para adicionar notas do orador', 'aria-label': 'Notas do orador' });
      aiBody = h('div', { class: 'ai-body' });
      aiPanel = h(
        'aside',
        { class: 'ai-panel', hidden: true, 'aria-label': 'Assistente' },
        h('header', null, h('strong', null, 'Assistente'), MO.iconButton('close', 'Fechar o painel', hideAI)),
        aiBody
      );
      counterEl = h('div', { class: 'statusbar' });
      root = h('div', { class: 'slides-main', tabindex: '0', 'aria-label': 'Editor de diapositivos' }, thumbs, h('div', { class: 'stage-col' }, stageBox, notesEl), aiPanel);
      const ribbon = buildRibbon();
      container.append(ribbon, root, counterEl);
      showStates = MO.toolStates(ribbon, { Negrito: 'bold', 'Itálico': 'italic', 'Alinhar à esquerda': 'left', Centrar: 'center', 'Alinhar à direita': 'right' });

      stage.addEventListener('pointerdown', onPointerDown);
      // Em window (e não com captura do ponteiro) para o duplo clique continuar a chegar ao elemento.
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);
      stage.addEventListener('paste', (e) => {
        if (!editingId) return;
        e.preventDefault();
        document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
      });
      stage.addEventListener('dblclick', (e) => {
        const cellEl = e.target.closest('.el-table th, .el-table td');
        if (cellEl) return startCellEdit(cellEl.closest('.el'), cellEl);
        const box = e.target.closest('.el-text');
        if (box && editingId !== box.dataset.id) startTextEdit(box.dataset.id);
      });
      stageBox.addEventListener('pointerdown', (e) => {
        if (e.target === stageBox) {
          commitTextEdit();
          selectEl(null);
        }
      });
      root.addEventListener('keydown', onKeyDown);
      notesEl.addEventListener('input', () => {
        if (!notesSnapshotTaken) {
          snapshot();
          notesSnapshotTaken = true;
        }
        slide().notes = notesEl.value;
        ctx.dirty();
      });
      notesEl.addEventListener('blur', () => (notesSnapshotTaken = false));
      new ResizeObserver(fitStage).observe(stageBox);
    },

    newDoc(template) {
      releaseImages();
      theme = T.slideLook(T.LIST[0], 'claro');
      syncThemeUI();
      if (template === 'pitch') {
        slides = [
          makeSlide('title', { title: 'A nossa proposta', subtitle: 'Apresentação do projeto · [Data]' }),
          makeSlide('content', { title: 'O desafio', bullets: ['Que problema queremos resolver?', 'Quem é afetado?', 'Porque é importante agir agora?'] }),
          makeSlide('content', { title: 'A solução', bullets: ['A nossa abordagem', 'O que nos distingue', 'Benefícios para o público'] }),
          makeSlide('content', { title: 'Plano de execução', bullets: ['Fase 1 · Preparação', 'Fase 2 · Implementação', 'Fase 3 · Avaliação'] }),
          makeSlide('content', { title: 'Próximos passos', bullets: ['Decisão necessária', 'Responsáveis', 'Calendário'] })
        ];
      } else if (template === 'lesson') {
        slides = [
          makeSlide('title', { title: 'Tema da apresentação', subtitle: 'Aula · [Disciplina] · [Data]' }),
          makeSlide('content', { title: 'Objetivos de aprendizagem', bullets: ['Compreender o conceito principal', 'Identificar os elementos essenciais', 'Aplicar o conhecimento num exemplo'] }),
          makeSlide('content', { title: 'Conceitos-chave', bullets: ['Conceito 1 · Definição', 'Conceito 2 · Características', 'Conceito 3 · Exemplo'] }),
          makeSlide('content', { title: 'Exemplo prático', bullets: ['Contexto', 'Resolução passo a passo', 'Resultado'] }),
          makeSlide('content', { title: 'Síntese', bullets: ['O que aprendemos?', 'Questões para discussão', 'Leitura ou tarefa seguinte'] })
        ];
      } else {
        slides = [makeSlide('title')];
      }
      idx = 0;
      selId = null;
      editingId = null;
      undoStack = [];
      redoStack = [];
      renderAll();
    },

    serialize() {
      commitTextEdit();
      return JSON.stringify({ format: 'myoffice-slides', version: 1, theme: theme.id, variant: theme.variant, slides });
    },

    load(text, ext) {
      const data = ext === 'pptx' ? { slides: MO.OOXML.importPptx(text) } : JSON.parse(text);
      if (ext !== 'pptx' && (!data || data.format !== 'myoffice-slides')) throw new Error('Formato inválido');
      const next = cleanSlides(data.slides);
      this.newDoc();
      theme = T.slideLook(T.byId(data.theme), data.variant);
      syncThemeUI();
      slides = next;
      renderAll();
    },

    exports: [
      {
        label: 'Apresentação do PowerPoint (.pptx)',
        ext: 'pptx',
        filterName: 'Apresentação do PowerPoint',
        mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        get: () => {
          commitTextEdit();
          return MO.OOXML.exportPptx(slides, FONTS);
        }
      }
    ],

    print() {
      commitTextEdit();
      const node = h(
        'div',
        { class: 'print-slides' },
        slides.map((s) => h('div', { class: 'print-slide' }, renderSlide(s, false)))
      );
      // Página com as dimensões exatas do diapositivo (960 × 540 px a 96 ppp).
      return { node, page: '254mm 142.875mm', margin: '0' };
    },

    show() {
      fitStage();
      root.focus({ preventScroll: true });
    }
  };
})();
