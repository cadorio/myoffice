'use strict';

// MyOffice PDF: ver, anotar, assinar e organizar ficheiros PDF, tudo no computador.
// O pdf.js (Mozilla) desenha as páginas; o pdf-lib grava o resultado. As anotações ficam numa
// camada própria e só são escritas no PDF ao guardar, por isso o original nunca é alterado
// enquanto se trabalha.
(function () {
  const MO = window.MO;
  const { h } = MO;

  const PT_PX = 96 / 72; // 1 ponto PDF em píxeis a 100%
  const MAX_UNDO = 60;
  const COLORS = { yellow: '#ffe066', green: '#9be59b', blue: '#9cc8ff', pink: '#ffb3d1' };

  let ctx, pagesBox, thumbsBox, scrollBox, emptyBox, statusEl, resultsBox, sizeSelect, colorInput, toolButtons;
  let sources = []; // { bytes, doc } — um por ficheiro PDF aberto ou juntado
  let pages = []; // { s, i, w, h, ox, oy, baseRot, rot, annots: [] }  (s = null: página em branco)
  let zoom = 1;
  let tool = 'select';
  let current = 0; // página selecionada
  let selected = null; // { page, id } da anotação selecionada
  let pending = null; // imagem ou assinatura à espera de ser colocada
  let undoStack = [];
  let redoStack = [];
  let textCache = new Map();
  let renderToken = 0;
  let observer = null;
  let seq = 0;
  const uid = () => 'a' + Date.now().toString(36) + (seq++).toString(36);

  const isActive = () => document.body.dataset.current === 'pdf';
  const totalRot = (p) => (((p.baseRot + p.rot) % 360) + 360) % 360;
  // Tamanho da página tal como é mostrada (já rodada), em pontos.
  const shown = (p) => (totalRot(p) % 180 ? { w: p.h, h: p.w } : { w: p.w, h: p.h });

  // ---------- Histórico ----------

  const snapshot = () => JSON.stringify(pages);
  function remember() {
    undoStack.push(snapshot());
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack = [];
  }
  function restore(state) {
    pages = JSON.parse(state);
    selected = null;
    current = Math.min(current, Math.max(0, pages.length - 1));
    renderAll();
    ctx.dirty();
  }
  function undo() {
    if (!undoStack.length) return;
    redoStack.push(snapshot());
    restore(undoStack.pop());
  }
  function redo() {
    if (!redoStack.length) return;
    undoStack.push(snapshot());
    restore(redoStack.pop());
  }
  function changed() {
    ctx.dirty();
  }

  // ---------- Abrir ----------

  async function openBytes(bytes) {
    if (!window.pdfjsLib) throw new Error('Leitor de PDF indisponível');
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    // isEvalSupported: false — o PDF nunca pode levar o leitor a executar código.
    const doc = await pdfjsLib.getDocument({ data: data.slice(), isEvalSupported: false, enableXfa: false, disableFontFace: false, useSystemFonts: true, stopAtErrors: false }).promise;
    const index = sources.push({ bytes: data, doc }) - 1;
    const list = [];
    for (let i = 0; i < doc.numPages; i++) {
      const page = await doc.getPage(i + 1);
      const [x0, y0, x1, y1] = page.view;
      list.push({ s: index, i, w: x1 - x0, h: y1 - y0, ox: x0, oy: y0, baseRot: page.rotate || 0, rot: 0, annots: [] });
    }
    return list;
  }

  async function load(content) {
    sources = [];
    textCache = new Map();
    undoStack = [];
    redoStack = [];
    selected = null;
    pending = null;
    current = 0;
    pages = await openBytes(content);
    renderAll();
  }

  // Junta as páginas de outro PDF depois da página atual.
  async function insertPdf() {
    const picked = await MO.pickFile({ accept: '.pdf,application/pdf', binaryExt: ['pdf'] });
    if (!picked) return;
    let list;
    try {
      list = await openBytes(picked.content);
    } catch {
      return MO.toast('Não foi possível abrir esse PDF.');
    }
    remember();
    const at = pages.length ? current + 1 : 0;
    pages.splice(at, 0, ...list);
    current = at;
    renderAll();
    changed();
    MO.toast(`${list.length} página(s) de "${picked.name}" acrescentada(s).`);
  }

  // ---------- Desenhar as páginas ----------

  function renderAll() {
    if (!pagesBox) return;
    renderToken++;
    if (observer) observer.disconnect();
    emptyBox.hidden = pages.length > 0;
    pagesBox.hidden = thumbsBox.hidden = pages.length === 0;
    pagesBox.replaceChildren(...pages.map((p, n) => pageView(p, n)));
    thumbsBox.replaceChildren(...pages.map((p, n) => thumbView(p, n)));
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.isIntersecting) paint(entry.target);
    }, { root: scrollBox, rootMargin: '600px 0px' });
    pagesBox.querySelectorAll('.pdf-page').forEach((el) => observer.observe(el));
    for (const el of thumbsBox.querySelectorAll('.pdf-thumb')) paintThumb(el);
    updateStatus();
  }

  function pageView(p, n) {
    const size = shown(p);
    const el = h('div', { class: 'pdf-page' + (n === current ? ' current' : ''), 'data-n': n, style: `width:${Math.round(size.w * PT_PX * zoom)}px;height:${Math.round(size.h * PT_PX * zoom)}px` },
      h('canvas', { class: 'pdf-canvas' }),
      overlay(p, n)
    );
    return el;
  }

  async function renderPage(p, canvas, scale) {
    const size = shown(p);
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.w * scale * ratio);
    canvas.height = Math.round(size.h * scale * ratio);
    const g = canvas.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, canvas.width, canvas.height);
    if (p.s == null) return;
    const page = await sources[p.s].doc.getPage(p.i + 1);
    const viewport = page.getViewport({ scale: scale * ratio, rotation: totalRot(p) });
    await page.render({ canvas, canvasContext: g, viewport, annotationMode: pdfjsLib.AnnotationMode.ENABLE }).promise;
  }

  async function paint(el) {
    if (el.dataset.painted === String(renderToken)) return;
    el.dataset.painted = String(renderToken);
    const p = pages[Number(el.dataset.n)];
    if (!p) return;
    try {
      await renderPage(p, el.querySelector('canvas'), PT_PX * zoom);
    } catch {
      /* uma página danificada não impede as outras */
    }
  }

  function thumbView(p, n) {
    const el = h('button', { type: 'button', class: 'pdf-thumb' + (n === current ? ' current' : ''), 'data-n': n, draggable: 'true', title: `Página ${n + 1}`, 'aria-label': `Página ${n + 1}` },
      h('canvas'), h('span', null, String(n + 1)));
    el.addEventListener('click', () => goTo(n));
    el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-pdf-page', String(n)); e.dataTransfer.effectAllowed = 'move'; });
    el.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/x-pdf-page')) { e.preventDefault(); el.classList.add('drop'); } });
    el.addEventListener('dragleave', () => el.classList.remove('drop'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('drop');
      const from = Number(e.dataTransfer.getData('text/x-pdf-page'));
      if (Number.isInteger(from) && from !== n) movePage(from, n);
    });
    return el;
  }

  async function paintThumb(el) {
    const p = pages[Number(el.dataset.n)];
    const size = shown(p);
    try {
      await renderPage(p, el.querySelector('canvas'), 110 / size.w);
    } catch {
      /* miniatura em branco */
    }
  }

  // ---------- Anotações ----------

  function overlay(p, n) {
    const layer = h('div', { class: 'pdf-overlay', 'data-n': n });
    for (const a of p.annots) layer.append(annotView(a, n));
    layer.addEventListener('pointerdown', (e) => onPointerDown(e, layer, n));
    return layer;
  }

  function annotView(a, n) {
    const p = pages[n];
    const size = shown(p);
    const px = PT_PX * zoom;
    const isSel = selected && selected.page === n && selected.id === a.id;
    const base = { class: `pdf-annot pdf-${a.type}${isSel ? ' selected' : ''}`, 'data-id': a.id };
    let el;
    if (a.type === 'text') {
      el = h('div', { ...base, style: `left:${a.fx * 100}%;top:${a.fy * 100}%;font-size:${a.size * px}px;color:${a.color}` }, a.text);
    } else if (a.type === 'ink') {
      const w = size.w * px;
      const hh = size.h * px;
      const d = a.points.map(([x, y], i) => `${i ? 'L' : 'M'}${(x * w).toFixed(1)} ${(y * hh).toFixed(1)}`).join(' ');
      el = h('div', { ...base, style: 'left:0;top:0;width:100%;height:100%' });
      el.innerHTML = `<svg width="100%" height="100%" viewBox="0 0 ${w} ${hh}"><path d="${d}" fill="none" stroke="${a.color}" stroke-width="${a.width * px}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    } else if (a.type === 'image') {
      el = h('div', { ...base, style: `left:${a.fx * 100}%;top:${a.fy * 100}%;width:${a.fw * 100}%;height:${a.fh * 100}%` }, h('img', { src: a.src, alt: '', draggable: 'false' }));
    } else {
      el = h('div', { ...base, style: `left:${a.fx * 100}%;top:${a.fy * 100}%;width:${a.fw * 100}%;height:${a.fh * 100}%;background:${a.color}` });
    }
    return el;
  }

  function redrawOverlay(n) {
    const old = pagesBox.querySelector(`.pdf-overlay[data-n="${n}"]`);
    if (old && old.parentNode && pages[n]) old.replaceWith(overlay(pages[n], n));
  }

  const findAnnot = (n, id) => pages[n] && pages[n].annots.find((a) => a.id === id);

  function point(e, layer) {
    const r = layer.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) };
  }

  function select(n, id) {
    const before = selected;
    selected = id ? { page: n, id } : null;
    if (before && before.page !== n) redrawOverlay(before.page);
    if (current !== n) setCurrent(n);
    redrawOverlay(n);
  }

  function onPointerDown(e, layer, n) {
    if (e.button !== 0) return;
    setCurrent(n);
    const start = point(e, layer);
    const hit = e.target.closest('.pdf-annot');

    if (pending) {
      e.preventDefault();
      placePending(n, start);
      return;
    }
    if (tool === 'text' && !hit) {
      e.preventDefault();
      remember();
      const a = { id: uid(), type: 'text', fx: start.x, fy: start.y, text: '', size: Number(sizeSelect.value) || 14, color: colorInput.value };
      pages[n].annots.push(a);
      select(n, a.id);
      editText(n, a.id, true);
      return;
    }
    if (tool === 'ink') {
      e.preventDefault();
      const a = { id: uid(), type: 'ink', points: [[start.x, start.y]], color: colorInput.value, width: 2 };
      const size = shown(pages[n]);
      const svg = h('div', { class: 'pdf-annot pdf-ink', style: 'left:0;top:0;width:100%;height:100%' });
      layer.append(svg);
      const draw = () => {
        const w = layer.clientWidth;
        const hh = layer.clientHeight;
        const d = a.points.map(([x, y], i) => `${i ? 'L' : 'M'}${(x * w).toFixed(1)} ${(y * hh).toFixed(1)}`).join(' ');
        svg.innerHTML = `<svg width="100%" height="100%" viewBox="0 0 ${w} ${hh}"><path d="${d}" fill="none" stroke="${a.color}" stroke-width="${a.width * w / size.w}" stroke-linecap="round"/></svg>`;
      };
      const move = (ev) => { const q = point(ev, layer); a.points.push([q.x, q.y]); draw(); };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        if (a.points.length > 1) {
          remember();
          a.points = a.points.slice(0, 4000).map(([x, y]) => [Number(x.toFixed(4)), Number(y.toFixed(4))]);
          pages[n].annots.push(a);
          changed();
        }
        redrawOverlay(n);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      return;
    }
    if ((tool === 'highlight' || tool === 'whiteout' || tool === 'box') && !hit) {
      e.preventDefault();
      const color = tool === 'whiteout' ? '#ffffff' : tool === 'box' ? colorInput.value : (colorInput.dataset.highlight || COLORS.yellow);
      const box = h('div', { class: `pdf-annot pdf-${tool === 'box' ? 'rect' : tool}`, style: `background:${color}` });
      layer.append(box);
      let rect = null;
      const move = (ev) => {
        const q = point(ev, layer);
        rect = { fx: Math.min(start.x, q.x), fy: Math.min(start.y, q.y), fw: Math.abs(q.x - start.x), fh: Math.abs(q.y - start.y) };
        Object.assign(box.style, { left: rect.fx * 100 + '%', top: rect.fy * 100 + '%', width: rect.fw * 100 + '%', height: rect.fh * 100 + '%' });
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        if (rect && rect.fw > 0.004 && rect.fh > 0.003) {
          remember();
          const type = tool === 'whiteout' ? 'whiteout' : tool === 'box' ? 'rect' : 'highlight';
          pages[n].annots.push({ id: uid(), type, ...rect, color });
          changed();
        }
        redrawOverlay(n);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      return;
    }
    // Selecionar e mover
    if (!hit) {
      if (selected) select(n, null);
      return;
    }
    const a = findAnnot(n, hit.dataset.id);
    if (!a) return;
    select(n, a.id);
    if (a.type === 'ink') return;
    e.preventDefault();
    const origin = { fx: a.fx, fy: a.fy };
    let moved = false;
    const move = (ev) => {
      const q = point(ev, layer);
      if (!moved) { remember(); moved = true; }
      a.fx = Math.max(0, Math.min(1 - (a.fw || 0.02), origin.fx + q.x - start.x));
      a.fy = Math.max(0, Math.min(1 - (a.fh || 0.02), origin.fy + q.y - start.y));
      const el = layer.querySelector(`[data-id="${a.id}"]`);
      if (el) { el.style.left = a.fx * 100 + '%'; el.style.top = a.fy * 100 + '%'; }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) changed();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // Edita uma caixa de texto diretamente sobre a página.
  function editText(n, id, isNew) {
    const a = findAnnot(n, id);
    const el = pagesBox.querySelector(`.pdf-overlay[data-n="${n}"] [data-id="${id}"]`);
    if (!a || !el) return;
    if (!isNew) remember();
    el.contentEditable = 'plaintext-only';
    el.classList.add('editing');
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); el.blur(); }
    });
    el.addEventListener('blur', () => {
      a.text = el.innerText.replace(/\r/g, '').replace(/\n+$/, '').slice(0, 2000);
      if (!a.text.trim()) pages[n].annots = pages[n].annots.filter((x) => x.id !== id);
      changed();
      // O blur pode acontecer a meio de outra atualização da camada; redesenha a seguir.
      setTimeout(() => redrawOverlay(n), 0);
    }, { once: true });
  }

  function deleteSelected() {
    if (!selected) return false;
    remember();
    const { page, id } = selected;
    pages[page].annots = pages[page].annots.filter((a) => a.id !== id);
    selected = null;
    redrawOverlay(page);
    changed();
    return true;
  }

  function setTool(name) {
    tool = name;
    pending = null;
    document.body.classList.remove('pdf-placing');
    for (const [key, btn] of Object.entries(toolButtons)) btn.classList.toggle('on', key === name);
    if (pagesBox) pagesBox.dataset.tool = name;
  }

  // ---------- Imagens e assinaturas ----------

  async function pickImage() {
    const picked = await MO.pickFile({ accept: 'image/png,image/jpeg', as: 'dataURL', maxBytes: 8 * 1024 * 1024 });
    if (!picked) return;
    if (!/^data:image\/(png|jpeg);base64,/.test(picked.content)) return MO.toast('Use uma imagem PNG ou JPEG.');
    const img = await loadImage(picked.content);
    startPlacing({ src: picked.content, ratio: img.naturalHeight / img.naturalWidth, width: 0.35 });
  }

  const loadImage = (src) => new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = src; });

  function startPlacing(item) {
    setTool('select');
    pending = item;
    document.body.classList.add('pdf-placing');
    MO.toast('Clique na página onde quer colocar.');
  }

  function placePending(n, at) {
    const size = shown(pages[n]);
    const fw = Math.min(0.9, pending.width);
    const fh = Math.min(0.9, fw * pending.ratio * size.w / size.h);
    remember();
    pages[n].annots.push({ id: uid(), type: 'image', src: pending.src, fx: Math.max(0, Math.min(1 - fw, at.x - fw / 2)), fy: Math.max(0, Math.min(1 - fh, at.y - fh / 2)), fw, fh });
    pending = null;
    document.body.classList.remove('pdf-placing');
    redrawOverlay(n);
    changed();
  }

  // Desenhar a assinatura com o rato, a caneta ou o dedo.
  function signatureDialog() {
    if (!pages.length) return MO.toast('Abra primeiro um PDF.');
    const pad = h('canvas', { class: 'sign-pad', width: 560, height: 200 });
    const g = pad.getContext('2d');
    g.lineWidth = 2.6;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = '#14213d';
    let drawing = false;
    let empty = true;
    const pos = (e) => { const r = pad.getBoundingClientRect(); return [(e.clientX - r.left) * pad.width / r.width, (e.clientY - r.top) * pad.height / r.height]; };
    pad.addEventListener('pointerdown', (e) => { drawing = true; empty = false; pad.setPointerCapture(e.pointerId); g.beginPath(); g.moveTo(...pos(e)); });
    pad.addEventListener('pointermove', (e) => { if (!drawing) return; g.lineTo(...pos(e)); g.stroke(); });
    pad.addEventListener('pointerup', () => (drawing = false));
    const dlg = h('dialog', { class: 'mo-dialog sign-dialog' },
      h('form', { method: 'dialog' },
        h('h2', null, 'Assinatura'),
        h('p', null, 'Desenhe a sua assinatura e depois clique na página onde a quer colocar.'),
        pad,
        h('div', { class: 'mo-dialog-actions' },
          h('button', { type: 'button', class: 'btn', onclick: () => { g.clearRect(0, 0, pad.width, pad.height); empty = true; } }, 'Limpar'),
          h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Cancelar'),
          h('button', { type: 'submit', class: 'btn primary', value: 'ok' }, 'Usar assinatura')
        )
      )
    );
    dlg.addEventListener('close', () => {
      dlg.remove();
      if (dlg.returnValue !== 'ok' || empty) return;
      const src = trimCanvas(pad);
      startPlacing({ src: src.url, ratio: src.ratio, width: 0.28 });
    });
    document.body.append(dlg);
    dlg.showModal();
  }

  // Corta o espaço vazio à volta do desenho.
  function trimCanvas(canvas) {
    const g = canvas.getContext('2d');
    const { data, width, height } = g.getImageData(0, 0, canvas.width, canvas.height);
    let x0 = width, y0 = height, x1 = 0, y1 = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 10) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    }
    const pad = 6;
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(width, x1 + pad); y1 = Math.min(height, y1 + pad);
    const out = h('canvas', { width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) });
    out.getContext('2d').drawImage(canvas, x0, y0, x1 - x0, y1 - y0, 0, 0, x1 - x0, y1 - y0);
    return { url: out.toDataURL('image/png'), ratio: (y1 - y0) / Math.max(1, x1 - x0) };
  }

  // ---------- Páginas ----------

  function setCurrent(n) {
    if (n === current || !pages[n]) return;
    current = n;
    pagesBox.querySelectorAll('.pdf-page.current').forEach((el) => el.classList.remove('current'));
    thumbsBox.querySelectorAll('.pdf-thumb.current').forEach((el) => el.classList.remove('current'));
    pagesBox.querySelector(`.pdf-page[data-n="${n}"]`)?.classList.add('current');
    thumbsBox.querySelector(`.pdf-thumb[data-n="${n}"]`)?.classList.add('current');
    updateStatus();
  }

  function goTo(n) {
    if (!pages[n]) return;
    setCurrent(n);
    pagesBox.querySelector(`.pdf-page[data-n="${n}"]`)?.scrollIntoView({ block: 'start' });
  }

  function rotate(delta) {
    if (!pages.length) return;
    remember();
    const p = pages[current];
    p.rot = (((p.rot + delta) % 360) + 360) % 360;
    renderAll();
    goTo(current);
    changed();
  }

  function deletePage() {
    if (!pages.length) return;
    if (pages.length === 1) return MO.toast('O PDF tem de ficar com pelo menos uma página.');
    remember();
    pages.splice(current, 1);
    current = Math.min(current, pages.length - 1);
    selected = null;
    renderAll();
    changed();
  }

  function movePage(from, to) {
    remember();
    const [p] = pages.splice(from, 1);
    pages.splice(to, 0, p);
    current = to;
    selected = null;
    renderAll();
    goTo(to);
    changed();
  }

  function blankPage() {
    remember();
    const ref = pages[current];
    const size = ref ? shown(ref) : { w: 595.28, h: 841.89 };
    const at = pages.length ? current + 1 : 0;
    pages.splice(at, 0, { s: null, i: 0, w: size.w, h: size.h, ox: 0, oy: 0, baseRot: 0, rot: 0, annots: [] });
    current = at;
    renderAll();
    goTo(at);
    changed();
  }

  // "1-3, 5" -> [0, 1, 2, 4]
  function parseRange(text, count) {
    const out = [];
    for (const part of String(text).split(/[,;\s]+/).filter(Boolean)) {
      const m = /^(\d+)(?:-(\d+))?$/.exec(part);
      if (!m) return null;
      const a = Number(m[1]);
      const b = m[2] ? Number(m[2]) : a;
      if (a < 1 || b > count || a > b) return null;
      for (let i = a; i <= b; i++) out.push(i - 1);
    }
    return out.length ? out : null;
  }

  async function extractPages() {
    if (!pages.length) return;
    const res = await MO.dialog({ title: 'Extrair páginas para um novo PDF', fields: [{ name: 'range', label: `Páginas (1 a ${pages.length}), por exemplo 1-3, 5`, value: String(current + 1) }], okLabel: 'Extrair' });
    if (!res) return;
    const list = parseRange(res.range, pages.length);
    if (!list) return MO.toast('Indique páginas válidas, por exemplo 1-3, 5.');
    try {
      const bytes = await build(list.map((n) => pages[n]));
      await saveCopy(bytes, `${MO.modules.pdf.defaultName} (páginas ${res.range.replace(/\s+/g, '')}).pdf`);
    } catch {
      MO.toast('Não foi possível extrair as páginas.');
    }
  }

  async function saveCopy(bytes, name) {
    if (!window.api) return MO.download(name, bytes, 'application/pdf');
    const res = await window.api.save({ path: null, content: bytes, defaultName: name, filters: [{ name: 'PDF', extensions: ['pdf'] }], remember: false });
    if (res && res.error) MO.toast(res.error);
    else if (res) MO.toast(`Guardado em ${res.name}.`);
  }

  // ---------- Procurar ----------

  async function pageText(n) {
    const p = pages[n];
    if (!p || p.s == null) return '';
    const key = p.s + ':' + p.i;
    if (!textCache.has(key)) {
      const page = await sources[p.s].doc.getPage(p.i + 1);
      const content = await page.getTextContent();
      textCache.set(key, content.items.map((it) => it.str + (it.hasEOL ? '\n' : '')).join(''));
    }
    return textCache.get(key);
  }

  async function search(query) {
    resultsBox.replaceChildren();
    const q = String(query || '').trim().toLocaleLowerCase('pt-PT');
    if (!q || !pages.length) return;
    const found = [];
    for (let n = 0; n < pages.length && found.length < 50; n++) {
      const text = (await pageText(n)).replace(/\s+/g, ' ');
      const at = text.toLocaleLowerCase('pt-PT').indexOf(q);
      if (at >= 0) found.push({ n, snippet: '…' + text.slice(Math.max(0, at - 30), at + q.length + 40) + '…' });
    }
    if (!found.length) {
      resultsBox.append(h('p', { class: 'pdf-noresult' }, 'Sem resultados.'));
      return;
    }
    resultsBox.append(...found.map((r) => h('button', { type: 'button', class: 'pdf-result', onclick: () => goTo(r.n) }, h('b', null, `Pág. ${r.n + 1}`), ' ', r.snippet)));
    goTo(found[0].n);
  }

  // ---------- Gravar com o pdf-lib ----------

  // Ponto mostrado (pt, origem no canto superior esquerdo) -> espaço da página por rodar.
  function toPdf(p, dx, dy) {
    const R = totalRot(p);
    let x, y;
    if (R === 90) { x = dy; y = dx; }
    else if (R === 180) { x = p.w - dx; y = dy; }
    else if (R === 270) { x = p.w - dy; y = p.h - dx; }
    else { x = dx; y = p.h - dy; }
    return { x: x + p.ox, y: y + p.oy };
  }

  function rgb(hex) {
    const n = parseInt(String(hex).replace('#', ''), 16) || 0;
    return PDFLib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  }

  // A letra Helvetica só tem os carateres do Windows-1252; o resto passa a "?".
  function encodable(font, text) {
    let out = '';
    for (const ch of text) {
      try {
        font.encodeText(ch);
        out += ch;
      } catch {
        out += '?';
      }
    }
    return out;
  }

  async function drawAnnots(out, page, p, font) {
    const size = shown(p);
    const R = totalRot(p);
    const deg = PDFLib.degrees(R);
    for (const a of p.annots) {
      if (a.type === 'text') {
        const lines = encodable(font, a.text).split('\n');
        lines.forEach((line, i) => {
          const at = toPdf(p, a.fx * size.w, a.fy * size.h + a.size * (1 + i * 1.25) - a.size * 0.18);
          page.drawText(line, { x: at.x, y: at.y, size: a.size, font, color: rgb(a.color), rotate: deg });
        });
      } else if (a.type === 'ink') {
        const pts = a.points.map(([fx, fy]) => toPdf(p, fx * size.w, fy * size.h));
        for (let i = 1; i < pts.length; i++) page.drawLine({ start: pts[i - 1], end: pts[i], thickness: a.width, color: rgb(a.color), lineCap: PDFLib.LineCapStyle.Round });
      } else if (a.type === 'image') {
        const bytes = Uint8Array.from(atob(a.src.split(',')[1]), (c) => c.charCodeAt(0));
        const img = /^data:image\/png/.test(a.src) ? await out.embedPng(bytes) : await out.embedJpg(bytes);
        const at = toPdf(p, a.fx * size.w, (a.fy + a.fh) * size.h);
        page.drawImage(img, { x: at.x, y: at.y, width: a.fw * size.w, height: a.fh * size.h, rotate: deg });
      } else {
        const c1 = toPdf(p, a.fx * size.w, a.fy * size.h);
        const c2 = toPdf(p, (a.fx + a.fw) * size.w, (a.fy + a.fh) * size.h);
        const opts = { x: Math.min(c1.x, c2.x), y: Math.min(c1.y, c2.y), width: Math.abs(c2.x - c1.x), height: Math.abs(c2.y - c1.y), color: rgb(a.color) };
        if (a.type === 'highlight') Object.assign(opts, { opacity: 0.4, blendMode: PDFLib.BlendMode.Multiply });
        if (a.type === 'rect') Object.assign(opts, { color: undefined, borderColor: rgb(a.color), borderWidth: 1.5 });
        page.drawRectangle(opts);
      }
    }
  }

  async function build(list) {
    const { PDFDocument, StandardFonts, degrees } = PDFLib;
    const out = await PDFDocument.create();
    out.setProducer('MyOffice');
    out.setCreator('MyOffice PDF');
    const loaded = new Map();
    const font = await out.embedFont(StandardFonts.Helvetica);
    for (const p of list) {
      let page;
      if (p.s == null) {
        page = out.addPage([p.w, p.h]);
      } else {
        if (!loaded.has(p.s)) loaded.set(p.s, await PDFDocument.load(sources[p.s].bytes, { ignoreEncryption: true, updateMetadata: false }));
        [page] = await out.copyPages(loaded.get(p.s), [p.i]);
        out.addPage(page);
      }
      page.setRotation(degrees(totalRot(p)));
      await drawAnnots(out, page, p, font);
    }
    return out.save();
  }

  async function allText() {
    const parts = [];
    for (let n = 0; n < pages.length; n++) parts.push(await pageText(n));
    return parts.join('\n\n');
  }

  // ---------- Interface ----------

  function updateStatus() {
    if (!statusEl) return;
    statusEl.textContent = pages.length ? `Página ${current + 1} de ${pages.length}` : 'Nenhum PDF aberto';
  }

  function onScroll() {
    // A página atual é a que ocupa o centro da área visível.
    const mid = scrollBox.getBoundingClientRect().top + scrollBox.clientHeight / 3;
    for (const el of pagesBox.children) {
      const r = el.getBoundingClientRect();
      if (r.top <= mid && r.bottom >= mid) {
        setCurrent(Number(el.dataset.n));
        break;
      }
    }
  }

  function buildRibbon() {
    const B = MO.bigButton;
    const I = MO.iconButton;
    toolButtons = {
      select: B('cursor', 'Selecionar', 'Selecionar, mover e apagar anotações', () => setTool('select')),
      text: B('textBox', 'Texto', 'Clicar na página para escrever', () => setTool('text')),
      highlight: B('highlight', 'Realçar', 'Arrastar sobre o texto para o realçar', () => setTool('highlight')),
      ink: B('pen', 'Desenhar', 'Desenhar à mão livre', () => setTool('ink')),
      box: B('rect', 'Retângulo', 'Desenhar um retângulo', () => setTool('box')),
      whiteout: B('whiteout', 'Tapar', 'Cobrir uma zona com branco (para corrigir ou ocultar)', () => setTool('whiteout'))
    };
    sizeSelect = h('select', { 'aria-label': 'Tamanho do texto', title: 'Tamanho do texto' }, [10, 12, 14, 16, 20, 24, 32, 48].map((n) => h('option', { value: n, selected: n === 14 }, n + ' pt')));
    colorInput = h('input', { type: 'color', value: '#1a1a1a', 'aria-label': 'Cor', title: 'Cor do texto, do desenho e do retângulo' });
    sizeSelect.addEventListener('change', () => {
      const a = selected && findAnnot(selected.page, selected.id);
      if (a && a.type === 'text') { remember(); a.size = Number(sizeSelect.value); redrawOverlay(selected.page); changed(); }
    });
    colorInput.addEventListener('change', () => {
      const a = selected && findAnnot(selected.page, selected.id);
      if (a && ['text', 'ink', 'rect'].includes(a.type)) { remember(); a.color = colorInput.value; redrawOverlay(selected.page); changed(); }
    });
    const marks = h('div', { class: 'pdf-marks' }, Object.entries(COLORS).map(([name, c]) => {
      const b = h('button', { type: 'button', class: 'pdf-mark', title: 'Cor do realce', style: `background:${c}`, 'aria-label': 'Cor do realce ' + name });
      b.addEventListener('click', () => { colorInput.dataset.highlight = c; marks.querySelectorAll('.pdf-mark').forEach((x) => x.classList.toggle('on', x === b)); setTool('highlight'); });
      return b;
    }));
    marks.firstChild.classList.add('on');
    const searchInput = h('input', { type: 'search', class: 'pdf-search', placeholder: 'Procurar no PDF…', 'aria-label': 'Procurar no PDF' });
    searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); search(searchInput.value); } });
    resultsBox = h('div', { class: 'pdf-results', 'aria-live': 'polite' });

    return MO.ribbon(
      [
        {
          label: 'Anotar',
          groups: [
            { label: 'Anular', rows: [[I('undo', 'Anular (Ctrl+Z)', undo), I('redo', 'Refazer (Ctrl+Y)', redo)]] },
            { label: 'Ferramentas', rows: [[toolButtons.select, toolButtons.text], [toolButtons.highlight, toolButtons.ink], [toolButtons.box, toolButtons.whiteout]] },
            { label: 'Texto e cor', rows: [[sizeSelect, colorInput]] },
            { label: 'Cor do realce', rows: [[marks]] },
            { label: 'Assinar', rows: [[B('sign', 'Assinatura', 'Desenhar a sua assinatura e colocá-la no documento', signatureDialog)], [B('image', 'Imagem', 'Colocar uma imagem PNG ou JPEG (por exemplo, uma assinatura digitalizada)', pickImage)]] },
            { label: 'Edição', rows: [[B('trash', 'Apagar anotação', 'Apagar a anotação selecionada (Delete)', () => deleteSelected() || MO.toast('Selecione primeiro uma anotação.'))]] }
          ]
        },
        {
          label: 'Páginas',
          groups: [
            { label: 'Rodar', rows: [[B('rotateLeft', 'Rodar à esquerda', 'Rodar a página atual 90° para a esquerda', () => rotate(-90)), B('rotateRight', 'Rodar à direita', 'Rodar a página atual 90° para a direita', () => rotate(90))]] },
            { label: 'Organizar', rows: [[B('up', 'Subir página', 'Mover a página atual para cima', () => current > 0 && movePage(current, current - 1)), B('down', 'Descer página', 'Mover a página atual para baixo', () => current < pages.length - 1 && movePage(current, current + 1))], [B('pageAdd', 'Página em branco', 'Inserir uma página em branco depois da atual', blankPage), B('trash', 'Eliminar página', 'Eliminar a página atual', deletePage)]] },
            { label: 'Combinar', rows: [[B('merge', 'Juntar PDF', 'Acrescentar as páginas de outro PDF depois da página atual', insertPdf)], [B('export', 'Extrair páginas', 'Guardar algumas páginas num PDF novo', extractPages)]] }
          ]
        },
        {
          label: 'Procurar',
          groups: [{ label: 'Procurar texto', rows: [[searchInput], [resultsBox]] }]
        }
      ],
      () => ctx.file()
    );
  }

  MO.modules.pdf = {
    id: 'pdf',
    label: 'PDF',
    ext: 'pdf',
    binary: true,
    noDrafts: true,
    filterName: 'Documento PDF',
    defaultName: 'Documento',

    init(container, context) {
      ctx = context;
      const ribbon = buildRibbon();
      pagesBox = h('div', { class: 'pdf-pages', 'data-tool': 'select' });
      thumbsBox = h('aside', { class: 'pdf-thumbs', 'aria-label': 'Páginas' });
      emptyBox = h('div', { class: 'pdf-empty' },
        h('div', { class: 'pdf-empty-card' },
          h('span', { class: 'app-tile pdf' }, h('img', { src: 'assets/icon-pdf.svg', alt: '' })),
          h('h2', null, 'Abra um PDF para começar'),
          h('p', null, 'Leia, procure, realce, escreva, assine e organize as páginas. Tudo fica no seu computador.'),
          h('button', { type: 'button', class: 'btn primary', 'data-action': 'open' }, 'Abrir PDF…'),
          h('small', null, 'Também pode arrastar um ficheiro PDF para aqui.')
        )
      );
      scrollBox = h('div', { class: 'pdf-scroll' }, emptyBox, pagesBox);
      statusEl = h('span', { class: 'status-text' });
      const bar = h('div', { class: 'statusbar' }, statusEl, MO.zoomControl((k) => { zoom = k; renderAll(); goTo(current); }));
      container.append(ribbon, h('div', { class: 'pdf-shell' }, thumbsBox, scrollBox), bar);
      scrollBox.addEventListener('scroll', () => requestAnimationFrame(onScroll), { passive: true });
      pagesBox.addEventListener('dblclick', (e) => {
        const el = e.target.closest('.pdf-text');
        const layer = e.target.closest('.pdf-overlay');
        if (el && layer) editText(Number(layer.dataset.n), el.dataset.id, false);
      });
      // Arrastar um PDF para a janela.
      scrollBox.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
      scrollBox.addEventListener('drop', async (e) => {
        const file = e.dataTransfer.files && e.dataTransfer.files[0];
        if (!file) return;
        e.preventDefault();
        if (!/\.pdf$/i.test(file.name)) return MO.toast('Arraste um ficheiro PDF.');
        MO.openFileObject({ path: null, name: file.name, content: new Uint8Array(await file.arrayBuffer()) });
      });
      document.addEventListener('keydown', (e) => {
        if (!isActive() || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable) return;
        const mod = e.ctrlKey || e.metaKey;
        if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
        else if (mod && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); redo(); }
        else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) { e.preventDefault(); deleteSelected(); }
        else if (e.key === 'Escape') { pending = null; document.body.classList.remove('pdf-placing'); if (selected) select(selected.page, null); }
        else if (e.key === 'PageDown') { e.preventDefault(); goTo(Math.min(pages.length - 1, current + 1)); }
        else if (e.key === 'PageUp') { e.preventDefault(); goTo(Math.max(0, current - 1)); }
      });
      window.addEventListener('resize', () => { if (isActive() && pages.length) renderAll(); });
      setTool('select');
      renderAll();
    },

    newDoc() {
      sources = [];
      pages = [];
      textCache = new Map();
      undoStack = [];
      redoStack = [];
      selected = null;
      pending = null;
      current = 0;
      renderAll();
    },

    // Devolve os bytes do PDF com as alterações (assíncrono).
    serialize() {
      if (!pages.length) throw new Error('Sem páginas');
      return build(pages);
    },

    load(content) {
      return load(content);
    },

    exports: [
      { label: 'Texto do PDF (.txt)', ext: 'txt', filterName: 'Texto simples', mime: 'text/plain', get: () => allText() }
    ],

    // Para imprimir, o PDF com as anotações é desenhado em imagens, página a página.
    async print() {
      const node = h('div', { class: 'print-pdf' });
      if (!pages.length) return { node, page: 'A4', margin: '0' };
      const bytes = await build(pages);
      const doc = await pdfjsLib.getDocument({ data: bytes, isEvalSupported: false }).promise;
      let first = null;
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const vp = page.getViewport({ scale: 2 });
        if (!first) first = page.getViewport({ scale: 1 });
        const canvas = h('canvas', { width: Math.round(vp.width), height: Math.round(vp.height) });
        await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
        node.append(h('img', { src: canvas.toDataURL('image/jpeg', 0.92), alt: '' }));
      }
      return { node, page: `${Math.round(first.width)}pt ${Math.round(first.height)}pt`, margin: '0' };
    },

    // Usado pelo Assistente.
    assist: { text: () => allText() },

    pageCount: () => pages.length,

    // Só para testes automáticos.
    _debug: { pages: () => pages, setPages: (list) => { pages = list; renderAll(); } },

    show() {
      if (pages.length && !pagesBox.querySelector('.pdf-page[data-painted]')) renderAll();
      updateStatus();
    }
  };
})();
