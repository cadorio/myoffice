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

  // Tipos de letra dos temas (só estas chaves são aceites nos ficheiros).
  const FONTS = {
    sans: '"Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif',
    serif: 'Georgia, "Times New Roman", serif',
    redonda: '"Trebuchet MS", Verdana, Tahoma, sans-serif'
  };

  // Temas predefinidos: fundo, cor do título, cor do texto, cor de destaque e tipo de letra.
  const THEMES = [
    { id: 'claro', name: 'Claro', bg: '#ffffff', title: '#1c2130', text: '#3b4252', accent: '#1f5fbf', font: 'sans' },
    { id: 'executivo', name: 'Executivo', bg: '#ffffff', title: '#14213d', text: '#3a3f4b', accent: '#b8860b', font: 'serif' },
    { id: 'oceano', name: 'Oceano', bg: '#0f2f4f', title: '#ffffff', text: '#d6e6f5', accent: '#4fc3f7', font: 'sans' },
    { id: 'floresta', name: 'Floresta', bg: '#f1f7f2', title: '#14532d', text: '#2f4a3a', accent: '#2e8b57', font: 'redonda' },
    { id: 'por-do-sol', name: 'Pôr do sol', bg: '#fff4ec', title: '#b3401a', text: '#5a3b2e', accent: '#f08a3c', font: 'redonda' },
    { id: 'coral', name: 'Coral', bg: '#fff7f5', title: '#a8322d', text: '#4a3432', accent: '#e8685f', font: 'sans' },
    { id: 'menta', name: 'Menta', bg: '#effaf6', title: '#0b6b57', text: '#27433d', accent: '#1fb08f', font: 'sans' },
    { id: 'lavanda', name: 'Lavanda', bg: '#f3f0fb', title: '#4c2f91', text: '#40385c', accent: '#8a63d2', font: 'redonda' },
    { id: 'areia', name: 'Areia', bg: '#faf5ea', title: '#5b4636', text: '#5e5346', accent: '#c08a3e', font: 'serif' },
    { id: 'grafite', name: 'Grafite', bg: '#22252b', title: '#f5f5f5', text: '#c9ccd3', accent: '#f2a33a', font: 'sans' },
    { id: 'noite', name: 'Noite', bg: '#101426', title: '#ffffff', text: '#b9c2e8', accent: '#7c8cff', font: 'sans' },
    { id: 'contraste', name: 'Alto contraste', bg: '#000000', title: '#ffffff', text: '#ffffff', accent: '#ffd400', font: 'sans' }
  ];
  const LAYOUTS = [
    ['title', 'Diapositivo de título'],
    ['content', 'Título e conteúdo'],
    ['two', 'Duas colunas'],
    ['titleOnly', 'Só título'],
    ['blank', 'Em branco']
  ];
  let theme = THEMES[0];

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
    return { bg: theme.bg, accent: theme.accent, font: theme.font, deco: layout === 'title' ? 'title' : 'bar', notes: c.notes || '', els };
  }

  // ---------- Histórico ----------

  function snapshot() {
    undoStack.push(JSON.stringify({ slides, idx }));
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack = [];
  }

  function timeTravel(from, to) {
    if (!from.length) return;
    to.push(JSON.stringify({ slides, idx }));
    const state = JSON.parse(from.pop());
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
        if (!el || !['text', 'image', 'rect', 'ellipse'].includes(el.type)) continue;
        const clean = {
          id: uid(),
          type: el.type,
          x: clampNum(el.x, -W, 2 * W, 0),
          y: clampNum(el.y, -H, 2 * H, 0),
          w: clampNum(el.w, MIN, 2 * W, 200),
          h: clampNum(el.h, MIN, 2 * H, 100)
        };
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
        } else {
          clean.fill = MO.HEX.test(el.fill) ? el.fill : '#4f5bd5';
        }
        els.push(clean);
      }
      const look = {};
      if (s && MO.HEX.test(s.accent)) look.accent = s.accent;
      if (s && Object.hasOwn(FONTS, s.font)) look.font = s.font;
      if (s && (s.deco === 'title' || s.deco === 'bar')) look.deco = s.deco;
      return { bg: MO.HEX.test(s && s.bg) ? s.bg : '#ffffff', ...look, notes: typeof (s && s.notes) === 'string' ? s.notes.slice(0, 5000) : '', els };
    });
  }

  // ---------- Desenho ----------

  function renderSlide(s, interactive) {
    const node = h('div', { class: 'slide', style: { background: s.bg } });
    if (s.font) node.style.fontFamily = FONTS[s.font];
    // Elemento decorativo do tema: barra lateral, ou faixas no diapositivo de título.
    if (s.accent && s.deco) node.append(h('div', { class: 'deco deco-' + s.deco, style: { background: s.accent } }));
    for (const el of s.els) {
      const box = h('div', {
        class: 'el el-' + el.type,
        style: { left: el.x + 'px', top: el.y + 'px', width: el.w + 'px', height: el.h + 'px' }
      });
      if (el.type === 'text') {
        const content = h('div', {
          class: 'el-content',
          style: {
            fontSize: el.fs + 'px',
            color: el.color,
            textAlign: el.align,
            fontWeight: el.bold ? '700' : '400',
            fontStyle: el.italic ? 'italic' : 'normal'
          }
        });
        content.innerHTML = el.html;
        box.append(content);
      } else if (el.type === 'image') {
        box.append(h('img', { src: el.src, alt: '', draggable: 'false' }));
      } else {
        box.style.background = el.fill;
      }
      if (interactive) {
        box.dataset.id = el.id;
        box.append(h('span', { class: 'handle' }));
        if (el.id === selId) box.classList.add('selected');
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

  function renderThumbs() {
    thumbs.replaceChildren(
      ...slides.map((s, i) => {
        const btn = h(
          'button',
          { type: 'button', class: 'thumb' + (i === idx ? ' active' : ''), title: 'Diapositivo ' + (i + 1), 'aria-label': 'Diapositivo ' + (i + 1) },
          h('span', { class: 'thumb-num' }, i + 1),
          h('span', { class: 'thumb-frame' }, renderSlide(s, false))
        );
        btn.addEventListener('click', () => goTo(i));
        return btn;
      })
    );
    counterEl.textContent = `Diapositivo ${idx + 1} de ${slides.length}`;
    const active = thumbs.children[idx];
    if (active) active.scrollIntoView({ block: 'nearest' });
  }

  function renderAll() {
    renderStage();
    renderThumbs();
  }

  function goTo(i) {
    commitTextEdit();
    idx = Math.max(0, Math.min(slides.length - 1, i));
    selId = null;
    renderAll();
  }

  function selectEl(id) {
    selId = id;
    stage.querySelectorAll('.el').forEach((box) => box.classList.toggle('selected', box.dataset.id === id));
    syncToolbar();
  }

  function syncToolbar() {
    const el = selected();
    sizeSelect.value = el && el.type === 'text' && SIZES.includes(el.fs) ? String(el.fs) : '';
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
    selectEl(id);
    root.focus({ preventScroll: true });
    const el = selected();
    drag = {
      el,
      box,
      resize: e.target.classList.contains('handle'),
      sx: e.clientX,
      sy: e.clientY,
      orig: { x: el.x, y: el.y, w: el.w, h: el.h },
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

  async function addImage() {
    const src = await MO.pickImage();
    if (!src) return;
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
      slide().els = slide().els.filter((el) => el.id !== selId);
      selId = null;
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
      for (const s of slides) {
        s.bg = next.bg;
        s.accent = next.accent;
        s.font = next.font;
        if (!s.deco) s.deco = s === slides[0] ? 'title' : 'bar';
        for (const el of s.els) if (el.type === 'text') el.color = el.role === 'title' ? next.title : next.text;
      }
    });
  }

  // ---------- Assistente (motor próprio, ver assistant.js) ----------

  function showAI(...content) {
    aiBody.replaceChildren(...content.flat().filter(Boolean));
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
      message:
        'Indique o tema. O assistente escolhe a estrutura adequada (plano, relatório, formação, produto…) e cria os diapositivos com os tópicos a preencher. ' +
        'Substitui a apresentação atual; pode anular com Ctrl+Z.',
      fields: [
        { name: 'topic', label: 'Tema', placeholder: 'Ex.: Plano de marketing para 2027' },
        { name: 'audience', label: 'Público (opcional)', placeholder: 'Ex.: direção da empresa' },
        { name: 'count', label: 'Número de diapositivos', type: 'number', value: 6, min: 3, max: 10 }
      ],
      okLabel: 'Criar'
    });
    if (!res) return;
    const out = MO.Assistant.generateDeck(res);
    if (out.error) return MO.toast(out.error);
    change(() => {
      slides = [makeSlide('title', out), ...out.slides.map((s) => makeSlide('content', s))];
      idx = 0;
      selId = null;
    });
    MO.toast(`Apresentação criada com a estrutura «${out.type}»: ${slides.length} diapositivos.`);
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

  function aiSuggest() {
    commitTextEdit();
    const target = slide();
    const parts = slideParts(target);
    const out = MO.Assistant.suggest({
      title: parts.title ? linesOf(parts.title.html).join(' ') : '',
      bullets: parts.bodies.flatMap((el) => linesOf(el.html)),
      notes: target.notes || ''
    });
    if (out.error) return MO.toast(out.error);
    const n = slides.indexOf(target) + 1;
    showAI(
      h('p', { class: 'ai-hint' }, `Diapositivo ${n}. As sugestões seguem regras de escrita para apresentações; reveja antes de aplicar.`),
      out.tips.length ? h('article', { class: 'ai-card ai-tips' }, h('div', { class: 'ai-label' }, 'Dicas'), h('ul', null, out.tips.map((t) => h('li', null, t)))) : null,
      out.suggestions.length
        ? out.suggestions.map((sug) =>
            h(
              'article',
              { class: 'ai-card' },
              h('div', { class: 'ai-label' }, sug.label),
              sug.title ? h('h3', null, sug.title) : null,
              h('ul', null, sug.bullets.map((b) => h('li', null, b))),
              h('p', { class: 'ai-reason' }, sug.reason),
              h('button', { type: 'button', class: 'btn primary', onclick: () => applySuggestion(target, sug) }, 'Aplicar')
            )
          )
        : h('p', { class: 'ai-ok' }, 'Este diapositivo já está conciso: não há alterações a propor.')
    );
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

  function present(from) {
    commitTextEdit();
    let i = Math.max(0, Math.min(slides.length - 1, from));
    let wasFullscreen = false;
    const overlay = h('div', { class: 'present', tabindex: '0', 'aria-label': 'Apresentação' });

    function draw() {
      const node = renderSlide(slides[i], false);
      const k = Math.min(window.innerWidth / W, window.innerHeight / H);
      node.style.transform = `translate(-50%, -50%) scale(${k})`;
      overlay.replaceChildren(node, h('div', { class: 'present-count' }, `${i + 1} / ${slides.length}`));
    }

    function close() {
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

    const themeChip = (t) => {
      const chip = toolButton(
        [
          h('span', { class: 'theme-bar', style: { background: t.accent } }),
          h('span', { class: 'theme-title', style: { color: t.title, fontFamily: FONTS[t.font] } }, 'Aa'),
          h('span', { class: 'theme-name', style: { color: t.text } }, t.name)
        ],
        'Aplicar o tema ' + t.name,
        () => applyTheme(t),
        'theme-chip'
      );
      chip.style.background = t.bg;
      return chip;
    };

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
                    colorDone
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
                [iconButton('front', 'Trazer para a frente', () => reorder(true), 'Frente'), iconButton('close', 'Eliminar elemento (Delete)', deleteSelected)],
                [iconButton('back', 'Enviar para trás', () => reorder(false), 'Trás')]
              ]
            }
          ]
        },
        {
          label: 'Inserir',
          groups: [
            { label: 'Texto', rows: [[bigButton('textBox', 'Caixa de texto', 'Inserir caixa de texto', insertText)]] },
            { label: 'Ilustrações', rows: [[bigButton('image', 'Imagem', 'Inserir imagem', addImage)]] },
            {
              label: 'Formas',
              rows: [[bigButton('rect', 'Retângulo', 'Inserir retângulo', insertRect), bigButton('ellipse', 'Elipse', 'Inserir elipse', insertEllipse)]]
            }
          ]
        },
        {
          label: 'Estrutura',
          groups: [
            { label: 'Temas', rows: [THEMES.map(themeChip)] },
            {
              label: 'Personalizar',
              rows: [[colorButton('Cor de fundo', 'Cor de fundo do diapositivo', '#ffffff', liveColor((v) => (slide().bg = v)), colorDone)]]
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
            }
          ]
        },
        {
          label: 'Apresentação',
          groups: [
            {
              label: 'Iniciar apresentação',
              rows: [
                [
                  bigButton('play', 'Do início', 'Iniciar apresentação do início (F5)', () => present(0)),
                  bigButton('playCurrent', 'Do diapositivo atual', 'Iniciar apresentação no diapositivo atual', () => present(idx))
                ]
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
      container.append(buildRibbon(), root, counterEl);

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

    newDoc() {
      theme = THEMES[0];
      slides = [makeSlide('title')];
      idx = 0;
      selId = null;
      editingId = null;
      undoStack = [];
      redoStack = [];
      renderAll();
    },

    serialize() {
      commitTextEdit();
      return JSON.stringify({ format: 'myoffice-slides', version: 1, theme: theme.id, slides });
    },

    load(text) {
      const data = JSON.parse(text);
      if (!data || data.format !== 'myoffice-slides') throw new Error('Formato inválido');
      const next = cleanSlides(data.slides);
      this.newDoc();
      theme = THEMES.find((t) => t.id === data.theme) || THEMES[0];
      slides = next;
      renderAll();
    },

    exports: [],

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
