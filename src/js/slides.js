'use strict';

// Módulo "Diapositivos": apresentações.
(function () {
  const MO = window.MO;
  const { h, toolButton, colorButton, sep } = MO;

  const W = 960;
  const H = 540;
  const MIN = 20;
  const MAX_UNDO = 60;
  const SIZES = [14, 18, 24, 28, 32, 40, 54, 72, 96];

  let ctx, root, stageBox, stage, thumbs, sizeSelect, counterEl;
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

  const uid = () => 'e' + Date.now().toString(36) + (seq++).toString(36);
  const slide = () => slides[idx];
  const selected = () => slide().els.find((el) => el.id === selId) || null;

  function textEl(x, y, w, h_, html, extra) {
    return Object.assign({ id: uid(), type: 'text', x, y, w, h: h_, html, fs: 24, color: '#1c2130', align: 'left' }, extra);
  }

  function titleSlide() {
    return {
      bg: '#ffffff',
      els: [
        textEl(80, 170, 800, 110, 'Título da apresentação', { fs: 54, bold: true, align: 'center' }),
        textEl(80, 300, 800, 60, 'Subtítulo', { fs: 28, color: '#5b6475', align: 'center' })
      ]
    };
  }

  function contentSlide() {
    return {
      bg: '#ffffff',
      els: [
        textEl(60, 40, 840, 80, 'Título do diapositivo', { fs: 40, bold: true }),
        textEl(60, 140, 840, 340, '<ul><li>Primeiro ponto</li><li>Segundo ponto</li></ul>', { fs: 28 })
      ]
    };
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
      return { bg: MO.HEX.test(s && s.bg) ? s.bg : '#ffffff', els };
    });
  }

  // ---------- Desenho ----------

  function renderSlide(s, interactive) {
    const node = h('div', { class: 'slide', style: { background: s.bg } });
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

  function addSlide() {
    commitTextEdit();
    change(() => {
      slides.splice(idx + 1, 0, contentSlide());
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
    else if (e.key === 'F5') present();
    else return;
    e.preventDefault();
  }

  // ---------- Modo de apresentação ----------

  function present() {
    commitTextEdit();
    let i = idx;
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

  function buildToolbar() {
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

    return h(
      'div',
      { class: 'toolbar' },
      toolButton('↶', 'Anular (Ctrl+Z)', () => timeTravel(undoStack, redoStack)),
      toolButton('↷', 'Refazer (Ctrl+Y)', () => timeTravel(redoStack, undoStack)),
      sep(),
      toolButton('+ Diapositivo', 'Novo diapositivo', addSlide, 'wide'),
      toolButton('Duplicar', 'Duplicar diapositivo', duplicateSlide, 'wide'),
      toolButton('↑', 'Mover diapositivo para cima', () => moveSlide(-1)),
      toolButton('↓', 'Mover diapositivo para baixo', () => moveSlide(1)),
      toolButton('Eliminar', 'Eliminar diapositivo', deleteSlide, 'wide'),
      colorButton('Fundo', 'Cor de fundo do diapositivo', '#ffffff', liveColor((v) => (slide().bg = v)), colorDone),
      sep(),
      toolButton('Texto', 'Inserir caixa de texto', () => addElement(textEl(280, 220, 400, 100, 'Texto')), 'wide'),
      toolButton('Imagem', 'Inserir imagem', addImage, 'wide'),
      toolButton('▭', 'Inserir retângulo', () => addElement({ id: uid(), type: 'rect', x: 360, y: 190, w: 240, h: 160, fill: '#4f5bd5' })),
      toolButton('◯', 'Inserir elipse', () => addElement({ id: uid(), type: 'ellipse', x: 380, y: 170, w: 200, h: 200, fill: '#e2702b' })),
      sep(),
      sizeSelect,
      toolButton('N', 'Negrito', () => toggleInline('bold', 'bold'), 'bold'),
      toolButton('I', 'Itálico', () => toggleInline('italic', 'italic'), 'italic'),
      toolButton('⇤', 'Alinhar à esquerda', () => withSelected((el) => (el.align = 'left'), 'text')),
      toolButton('↔', 'Centrar', () => withSelected((el) => (el.align = 'center'), 'text')),
      toolButton('⇥', 'Alinhar à direita', () => withSelected((el) => (el.align = 'right'), 'text')),
      colorButton(
        'Cor',
        'Cor do elemento selecionado',
        '#1c2130',
        liveColor((v, el) => {
          if (!el) return;
          if (el.type === 'text') el.color = v;
          else if (el.type !== 'image') el.fill = v;
        }),
        colorDone
      ),
      sep(),
      toolButton('Frente', 'Trazer para a frente', () => reorder(true), 'wide'),
      toolButton('Trás', 'Enviar para trás', () => reorder(false), 'wide'),
      toolButton('✕', 'Eliminar elemento (Delete)', deleteSelected),
      h('span', { class: 'tool-spacer' }),
      toolButton('▶ Apresentar', 'Iniciar apresentação (F5)', present, 'wide accent')
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
      counterEl = h('div', { class: 'statusbar' });
      root = h('div', { class: 'slides-main', tabindex: '0', 'aria-label': 'Editor de diapositivos' }, thumbs, stageBox);
      container.append(buildToolbar(), root, counterEl);

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
      new ResizeObserver(fitStage).observe(stageBox);
    },

    newDoc() {
      slides = [titleSlide()];
      idx = 0;
      selId = null;
      editingId = null;
      undoStack = [];
      redoStack = [];
      renderAll();
    },

    serialize() {
      commitTextEdit();
      return JSON.stringify({ format: 'myoffice-slides', version: 1, slides });
    },

    load(text) {
      const data = JSON.parse(text);
      if (!data || data.format !== 'myoffice-slides') throw new Error('Formato inválido');
      const next = cleanSlides(data.slides);
      this.newDoc();
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
