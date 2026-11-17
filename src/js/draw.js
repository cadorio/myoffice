'use strict';

// MyOffice Desenho: fluxogramas, mapas mentais, organogramas e esquemas vetoriais, locais e editáveis.
(function () {
  const MO = window.MO;
  const { h } = MO;
  const W = 1400;
  const H = 900;
  const GRID = 20;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const MAX_NODES = 300;
  const MAX_LINKS = 400;
  const MAX_UNDO = 80;
  const TYPES = ['rect', 'rounded', 'ellipse', 'diamond', 'parallelogram', 'cylinder', 'note', 'text'];
  const TYPE_LABEL = { rect: 'Caixa', rounded: 'Arredondada', ellipse: 'Círculo', diamond: 'Decisão', parallelogram: 'Dados', cylinder: 'Base de dados', note: 'Nota', text: 'Texto' };
  const FILLS = ['#ffffff', '#e8efe5', '#e6ebf7', '#e4f1eb', '#f8f0dc', '#fae9e1', '#eee8f6', '#c5ef75', '#ffe9a8', '#1d2622'];
  const DEFAULT = { fill: '#e8efe5', stroke: '#9fb3a4', color: '#202a27', fontSize: 18 };

  let svg, board, scroller, ctx, statusEl, propBox, zoomEl;
  let fitted = false;
  let nodes = [];
  let links = []; // { id, from, to (índices), label, dashed, arrow: 'end'|'none'|'both', elbow }
  let selection = new Set(); // ids de elementos
  let selectedLink = null;
  let linkMode = false;
  let linkStart = null;
  let snap = true;
  let showGrid = true;
  let zoom = 1;
  let clipboard = null;
  let undoStack = [];
  let redoStack = [];
  let seq = 0;
  const uid = () => 'd' + Date.now().toString(36) + (seq++).toString(36);
  const s = (tag, attrs, ...kids) => {
    const el = document.createElementNS(SVG_NS, tag);
    if (attrs) for (const [key, value] of Object.entries(attrs)) if (value != null) el.setAttribute(key, value);
    for (const child of kids.flat()) if (child != null) el.append(child.nodeType ? child : document.createTextNode(String(child)));
    return el;
  };
  const isActive = () => document.body.dataset.current === 'draw';
  const byId = (id) => nodes.find((n) => n.id === id);
  const selectedNodes = () => nodes.filter((n) => selection.has(n.id));
  const snapTo = (v) => (snap ? Math.round(v / GRID) * GRID : Math.round(v));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function node(type, x, y, text, fill = DEFAULT.fill, extra = {}) {
    const size = type === 'ellipse' ? [180, 100] : type === 'diamond' ? [200, 120] : type === 'text' ? [220, 50] : type === 'note' ? [180, 140] : [200, 90];
    return { id: uid(), type, x, y, w: size[0], h: size[1], text, fill: type === 'text' ? '#ffffff' : fill, stroke: type === 'text' ? 'none' : DEFAULT.stroke, color: DEFAULT.color, fontSize: DEFAULT.fontSize, bold: type !== 'text', ...extra };
  }
  const link = (from, to, extra = {}) => ({ id: uid(), from, to, label: '', dashed: false, arrow: 'end', elbow: false, ...extra });

  // ---------- Modelos ----------

  function templates(name) {
    if (name === 'blank') return { nodes: [], links: [] };
    if (name === 'mind') {
      const c = node('ellipse', 600, 400, 'Ideia central', '#c5ef75', { w: 220, h: 110 });
      const kids = [['Pesquisa', 180, 160, '#e6ebf7'], ['Planeamento', 1020, 160, '#e4f1eb'], ['Execução', 180, 640, '#fae9e1'], ['Resultados', 1020, 640, '#eee8f6']].map(([t, x, y, f]) => node('rounded', x, y, t, f));
      return { nodes: [c, ...kids], links: kids.map((_k, i) => link(0, i + 1, { arrow: 'none' })) };
    }
    if (name === 'org') {
      const top = node('rounded', 600, 100, 'Direção', '#c5ef75');
      const mid = [['Equipa de produto', 200], ['Equipa comercial', 600], ['Operações', 1000]].map(([t, x]) => node('rounded', x, 340, t, '#e6ebf7'));
      return { nodes: [top, ...mid], links: [1, 2, 3].map((to) => link(0, to, { elbow: true, arrow: 'none' })) };
    }
    if (name === 'timeline') {
      const steps = ['Ideia', 'Planeamento', 'Desenvolvimento', 'Testes', 'Lançamento'].map((t, i) => node('rounded', 80 + i * 260, 400, t, ['#e6ebf7', '#e4f1eb', '#f8f0dc', '#fae9e1', '#c5ef75'][i], { w: 200 }));
      const dates = ['Jan', 'Mar', 'Mai', 'Jul', 'Set'].map((t, i) => node('text', 80 + i * 260, 320, t, '#ffffff', { w: 200, color: '#5c6a62' }));
      return { nodes: [...steps, ...dates], links: [0, 1, 2, 3].map((i) => link(i, i + 1)) };
    }
    if (name === 'swot') {
      const quad = [['Forças', 200, 120, '#e4f1eb'], ['Fraquezas', 720, 120, '#fae9e1'], ['Oportunidades', 200, 480, '#e6ebf7'], ['Ameaças', 720, 480, '#f8f0dc']].map(([t, x, y, f]) => node('rect', x, y, `${t}\n• …\n• …`, f, { w: 480, h: 320, fontSize: 20 }));
      return { nodes: quad, links: [] };
    }
    const flow = [
      node('ellipse', 120, 400, 'Início', '#e4f1eb'),
      node('rect', 400, 395, 'Recolher pedido', '#e6ebf7'),
      node('diamond', 680, 380, 'Aprovado?', '#f8f0dc'),
      node('rect', 980, 395, 'Executar', '#e6ebf7'),
      node('ellipse', 1200, 400, 'Fim', '#fae9e1', { w: 140 }),
      node('rect', 400, 640, 'Rever pedido', '#fae9e1')
    ];
    return { nodes: flow, links: [link(0, 1), link(1, 2), link(2, 3, { label: 'Sim' }), link(3, 4), link(2, 5, { label: 'Não' }), link(5, 1, { elbow: true, dashed: true })] };
  }

  // ---------- Histórico ----------

  const snapshot = () => JSON.stringify({ nodes, links });
  function remember() {
    undoStack.push(snapshot());
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack = [];
  }
  function restore(state) {
    const data = JSON.parse(state);
    nodes = data.nodes;
    links = data.links;
    selection = new Set([...selection].filter((id) => byId(id)));
    selectedLink = links.some((l) => l.id === selectedLink) ? selectedLink : null;
    render();
    ctx.dirty();
  }
  function undo() { if (undoStack.length) { redoStack.push(snapshot()); restore(undoStack.pop()); } }
  function redo() { if (redoStack.length) { undoStack.push(snapshot()); restore(redoStack.pop()); } }
  function changed() { ctx.dirty(); render(); }

  // ---------- Desenho ----------

  function shapeOf(n) {
    const { x, y, w, h: hh } = n;
    const common = { fill: n.fill, stroke: n.stroke === 'none' ? 'none' : n.stroke, 'stroke-width': 2 };
    if (n.type === 'ellipse') return s('ellipse', { cx: x + w / 2, cy: y + hh / 2, rx: w / 2, ry: hh / 2, ...common });
    if (n.type === 'diamond') return s('polygon', { points: `${x + w / 2},${y} ${x + w},${y + hh / 2} ${x + w / 2},${y + hh} ${x},${y + hh / 2}`, ...common });
    if (n.type === 'parallelogram') { const k = Math.min(30, w / 5); return s('polygon', { points: `${x + k},${y} ${x + w},${y} ${x + w - k},${y + hh} ${x},${y + hh}`, ...common }); }
    if (n.type === 'cylinder') {
      const r = Math.min(18, hh / 5);
      return s('g', null,
        s('path', { d: `M${x},${y + r} A${w / 2},${r} 0 0 0 ${x + w},${y + r} V${y + hh - r} A${w / 2},${r} 0 0 1 ${x},${y + hh - r} Z`, ...common }),
        s('ellipse', { cx: x + w / 2, cy: y + r, rx: w / 2, ry: r, ...common }));
    }
    if (n.type === 'note') { const f = 22; return s('path', { d: `M${x},${y} H${x + w - f} L${x + w},${y + f} V${y + hh} H${x} Z M${x + w - f},${y} V${y + f} H${x + w}`, ...common, 'stroke-linejoin': 'round' }); }
    if (n.type === 'text') return s('rect', { x, y, width: w, height: hh, fill: 'transparent', stroke: 'none' });
    return s('rect', { x, y, width: w, height: hh, rx: n.type === 'rounded' ? Math.min(22, hh / 2) : 4, ...common });
  }

  // Parte o texto em linhas que cabem na largura da forma.
  function wrap(n) {
    const inner = Math.max(30, (n.type === 'diamond' || n.type === 'ellipse' ? 0.72 : 0.9) * n.w);
    const max = Math.max(4, Math.floor(inner / (n.fontSize * 0.56)));
    const out = [];
    for (const para of String(n.text || '').split('\n')) {
      let line = '';
      for (const word of para.split(/\s+/)) {
        if (!word) continue;
        const next = line ? line + ' ' + word : word;
        if (next.length > max && line) { out.push(line); line = word; } else line = next;
      }
      out.push(line);
    }
    return out.slice(0, 12);
  }

  function textOf(n) {
    const lines = wrap(n);
    const lh = n.fontSize * 1.25;
    const top = n.y + n.h / 2 - ((lines.length - 1) * lh) / 2;
    return lines.map((line, i) => s('text', { x: n.x + n.w / 2, y: top + i * lh, 'text-anchor': 'middle', 'dominant-baseline': 'middle', fill: n.color, 'font-family': 'Arial, sans-serif', 'font-size': n.fontSize, 'font-weight': n.bold ? 700 : 400 }, line));
  }

  // Ponto da fronteira da forma na direção de (tx, ty).
  function edgePoint(n, tx, ty) {
    const cx = n.x + n.w / 2;
    const cy = n.y + n.h / 2;
    const dx = tx - cx;
    const dy = ty - cy;
    if (!dx && !dy) return { x: cx, y: cy };
    if (n.type === 'ellipse') { const t = 1 / Math.sqrt((dx * dx) / ((n.w / 2) ** 2) + (dy * dy) / ((n.h / 2) ** 2)); return { x: cx + dx * t, y: cy + dy * t }; }
    if (n.type === 'diamond') { const t = 1 / (Math.abs(dx) / (n.w / 2) + Math.abs(dy) / (n.h / 2)); return { x: cx + dx * t, y: cy + dy * t }; }
    const t = Math.min((n.w / 2) / Math.abs(dx || 1e-9), (n.h / 2) / Math.abs(dy || 1e-9));
    return { x: cx + dx * t, y: cy + dy * t };
  }

  function linkPath(l) {
    const a = nodes[l.from];
    const b = nodes[l.to];
    const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
    const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    if (l.elbow) {
      // Cotovelo: sai na vertical ou na horizontal conforme a posição relativa.
      // Formas a alturas diferentes ligam por cima/baixo; lado a lado, pelos lados.
      const vertical = Math.abs(bc.y - ac.y) > (a.h + b.h) / 2 + 10;
      const p1 = vertical ? { x: ac.x, y: ac.y + Math.sign(bc.y - ac.y) * a.h / 2 } : { x: ac.x + Math.sign(bc.x - ac.x) * a.w / 2, y: ac.y };
      const p4 = vertical ? { x: bc.x, y: bc.y - Math.sign(bc.y - ac.y) * b.h / 2 } : { x: bc.x - Math.sign(bc.x - ac.x) * b.w / 2, y: bc.y };
      const mid = vertical ? (p1.y + p4.y) / 2 : (p1.x + p4.x) / 2;
      const pts = vertical ? [p1, { x: p1.x, y: mid }, { x: p4.x, y: mid }, p4] : [p1, { x: mid, y: p1.y }, { x: mid, y: p4.y }, p4];
      return { d: 'M' + pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L'), mid: { x: (pts[1].x + pts[2].x) / 2, y: (pts[1].y + pts[2].y) / 2 } };
    }
    const p1 = edgePoint(a, bc.x, bc.y);
    const p2 = edgePoint(b, ac.x, ac.y);
    return { d: `M${p1.x.toFixed(1)},${p1.y.toFixed(1)} L${p2.x.toFixed(1)},${p2.y.toFixed(1)}`, mid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 } };
  }

  function render() {
    if (!svg) return;
    svg.replaceChildren();
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.style.width = Math.round(W * zoom) + 'px';
    svg.style.height = Math.round(H * zoom) + 'px';
    const defs = s('defs', null,
      s('marker', { id: 'draw-arrow', viewBox: '0 0 10 10', markerWidth: '9', markerHeight: '9', refX: '9', refY: '5', orient: 'auto-start-reverse', markerUnits: 'userSpaceOnUse' }, s('path', { d: 'M0,0 L10,5 L0,10 z', fill: '#5f6f66' })),
      s('pattern', { id: 'draw-grid', width: GRID, height: GRID, patternUnits: 'userSpaceOnUse' }, s('circle', { cx: 1, cy: 1, r: 1, fill: '#cfd8d1' }))
    );
    svg.append(defs, s('rect', { class: 'draw-bg', x: 0, y: 0, width: W, height: H, fill: '#ffffff' }));
    if (showGrid) svg.append(s('rect', { class: 'draw-grid', x: 0, y: 0, width: W, height: H, fill: 'url(#draw-grid)', 'pointer-events': 'none' }));

    links.forEach((l) => {
      if (!nodes[l.from] || !nodes[l.to]) return;
      const { d, mid } = linkPath(l);
      const sel = selectedLink === l.id;
      const g = s('g', { class: 'draw-link' + (sel ? ' is-selected' : ''), 'data-link': l.id });
      g.append(s('path', { d, fill: 'none', stroke: 'transparent', 'stroke-width': 14, class: 'draw-link-hit' }));
      g.append(s('path', { d, fill: 'none', stroke: sel ? '#2f6fdd' : '#5f6f66', 'stroke-width': sel ? 3 : 2.4, 'stroke-dasharray': l.dashed ? '8 6' : null, 'marker-end': l.arrow !== 'none' ? 'url(#draw-arrow)' : null, 'marker-start': l.arrow === 'both' ? 'url(#draw-arrow)' : null }));
      if (l.label) {
        const width = l.label.length * 8 + 14;
        g.append(s('rect', { x: mid.x - width / 2, y: mid.y - 12, width, height: 24, rx: 6, fill: '#ffffff', stroke: '#d4ded5' }));
        g.append(s('text', { x: mid.x, y: mid.y, 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-family': 'Arial, sans-serif', 'font-size': 14, fill: '#3b4a42' }, l.label));
      }
      g.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        if (isDouble(l.id)) return editLinkLabel(l);
        selectedLink = l.id;
        selection.clear();
        render();
      });
      svg.append(g);
    });

    nodes.forEach((n) => {
      const sel = selection.has(n.id);
      const g = s('g', { 'data-id': n.id, class: 'draw-node' + (sel ? ' is-selected' : '') + (linkStart === n.id ? ' is-link-start' : '') }, shapeOf(n), textOf(n));
      if (sel) {
        g.append(s('rect', { class: 'draw-sel', x: n.x - 5, y: n.y - 5, width: n.w + 10, height: n.h + 10, rx: 8, fill: 'none', stroke: '#2f6fdd', 'stroke-dasharray': '6 4', 'stroke-width': 1.6, 'pointer-events': 'none' }));
        if (selection.size === 1) g.append(s('rect', { class: 'draw-resize', x: n.x + n.w - 6, y: n.y + n.h - 6, width: 12, height: 12, rx: 2, fill: '#2f6fdd' }));
      }
      // Pontos de ligação: arrastar a partir de um deles para outro elemento.
      for (const [px, py] of [[n.x + n.w / 2, n.y], [n.x + n.w, n.y + n.h / 2], [n.x + n.w / 2, n.y + n.h], [n.x, n.y + n.h / 2]]) {
        g.append(s('circle', { class: 'draw-port', cx: px, cy: py, r: 6 }));
      }
      g.addEventListener('pointerdown', (e) => onNodeDown(e, n));
      svg.append(g);
    });
    updateProps();
    updateStatus();
  }

  // ---------- Interação ----------

  function svgPoint(e) {
    const r = svg.getBoundingClientRect();
    return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height };
  }

  function nodeAt(p) {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (p.x >= n.x && p.x <= n.x + n.w && p.y >= n.y && p.y <= n.y + n.h) return n;
    }
    return null;
  }

  function addLink(fromNode, toNode) {
    const from = nodes.indexOf(fromNode);
    const to = nodes.indexOf(toNode);
    if (from < 0 || to < 0 || from === to || links.length >= MAX_LINKS) return;
    if (links.some((l) => l.from === from && l.to === to)) return;
    remember();
    const l = link(from, to);
    links.push(l);
    selectedLink = l.id;
    selection.clear();
    changed();
  }

  // O desenho é refeito a cada clique, por isso o duplo clique é detetado aqui.
  let lastDown = { id: null, t: 0 };
  function isDouble(id) {
    const now = Date.now();
    const double = lastDown.id === id && now - lastDown.t < 450;
    lastDown = { id: double ? null : id, t: now };
    return double;
  }

  function onNodeDown(e, n) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const start = svgPoint(e);
    if (!linkMode && !e.target.classList.contains('draw-port') && !e.target.classList.contains('draw-resize') && isDouble(n.id)) {
      e.preventDefault(); // não deixar o clique tirar o foco ao editor
      selection = new Set([n.id]);
      render();
      editNodeText(n);
      return;
    }

    if (linkMode) {
      if (!linkStart) { linkStart = n.id; render(); return; }
      if (linkStart !== n.id) addLink(byId(linkStart), n);
      linkStart = null;
      setLinkMode(false);
      return;
    }

    // Arrastar de um ponto de ligação cria uma ligação.
    if (e.target.classList.contains('draw-port')) {
      const line = s('line', { x1: start.x, y1: start.y, x2: start.x, y2: start.y, stroke: '#2f6fdd', 'stroke-width': 2, 'stroke-dasharray': '5 4', 'pointer-events': 'none' });
      svg.append(line);
      const move = (ev) => { const q = svgPoint(ev); line.setAttribute('x2', q.x); line.setAttribute('y2', q.y); };
      const up = (ev) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        line.remove();
        const target = nodeAt(svgPoint(ev));
        if (target && target !== n) addLink(n, target);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      return;
    }

    // Redimensionar
    if (e.target.classList.contains('draw-resize')) {
      remember();
      const orig = { w: n.w, h: n.h };
      const move = (ev) => {
        const q = svgPoint(ev);
        n.w = clamp(snapTo(orig.w + q.x - start.x), 40, 900);
        n.h = clamp(snapTo(orig.h + q.y - start.y), 30, 700);
        render();
      };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); ctx.dirty(); };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      return;
    }

    selectedLink = null;
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      if (selection.has(n.id)) selection.delete(n.id); else selection.add(n.id);
      render();
      return;
    }
    if (!selection.has(n.id)) selection = new Set([n.id]);
    render();

    // Mover (todos os selecionados)
    const moving = selectedNodes().map((m) => ({ m, x: m.x, y: m.y }));
    let moved = false;
    const move = (ev) => {
      const q = svgPoint(ev);
      const dx = q.x - start.x;
      const dy = q.y - start.y;
      if (!moved && Math.hypot(dx, dy) < 3) return;
      if (!moved) { remember(); moved = true; }
      for (const it of moving) {
        it.m.x = clamp(snapTo(it.x + dx), 0, W - it.m.w);
        it.m.y = clamp(snapTo(it.y + dy), 0, H - it.m.h);
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

  // Arrastar no fundo seleciona uma área.
  function onBoardDown(e) {
    if (e.button !== 0 || e.target.closest('.draw-node, .draw-link')) return;
    if (linkMode) { linkStart = null; setLinkMode(false); }
    const start = svgPoint(e);
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (!additive) selection.clear();
    selectedLink = null;
    render();
    const box = s('rect', { class: 'draw-marquee', x: start.x, y: start.y, width: 0, height: 0 });
    svg.append(box);
    const base = new Set(selection);
    const move = (ev) => {
      const q = svgPoint(ev);
      const x0 = Math.min(start.x, q.x), y0 = Math.min(start.y, q.y), x1 = Math.max(start.x, q.x), y1 = Math.max(start.y, q.y);
      Object.entries({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 }).forEach(([k, v]) => box.setAttribute(k, v));
      selection = new Set(base);
      for (const n of nodes) if (n.x >= x0 && n.y >= y0 && n.x + n.w <= x1 && n.y + n.h <= y1) selection.add(n.id);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      render();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // Escrever diretamente sobre a forma.
  function editNodeText(n) {
    const r = svg.getBoundingClientRect();
    const k = r.width / W;
    const br = board.getBoundingClientRect();
    const area = h('textarea', { class: 'draw-text-editor', 'aria-label': 'Texto do elemento' });
    area.value = n.text;
    Object.assign(area.style, {
      left: (r.left - br.left + board.scrollLeft + n.x * k) + 'px',
      top: (r.top - br.top + board.scrollTop + n.y * k) + 'px',
      width: n.w * k + 'px',
      height: n.h * k + 'px',
      fontSize: n.fontSize * k + 'px',
      fontWeight: n.bold ? 700 : 400,
      color: n.color
    });
    board.append(area);
    area.focus();
    area.select();
    setTimeout(() => { if (area.isConnected) area.focus(); }, 0);
    const done = (commit) => {
      if (!area.isConnected) return;
      const value = area.value.slice(0, 400);
      area.remove();
      if (commit && value !== n.text) { remember(); n.text = value; changed(); }
    };
    area.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') done(false);
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) done(true);
    });
    area.addEventListener('blur', () => done(true));
  }

  async function editLinkLabel(l) {
    const res = await MO.dialog({ title: 'Texto da ligação', fields: [{ name: 'label', label: 'Texto (vazio para não mostrar)', value: l.label || '' }], okLabel: 'Aplicar' });
    if (!res) return;
    remember();
    l.label = res.label.trim().slice(0, 40);
    changed();
  }

  function setLinkMode(on) {
    linkMode = on;
    linkStart = null;
    board && board.classList.toggle('linking', on);
    if (on) MO.toast('Clique no primeiro elemento e depois no segundo. Também pode arrastar a partir de um ponto azul.');
    render();
  }

  // ---------- Comandos ----------

  function addShape(type) {
    if (nodes.length >= MAX_NODES) return MO.toast('O desenho chegou ao limite de elementos.');
    remember();
    const r = scroller ? { x: (scroller.scrollLeft + scroller.clientWidth / 2) / zoom, y: (scroller.scrollTop + scroller.clientHeight / 2) / zoom } : { x: W / 2, y: H / 2 };
    const n = node(type, 0, 0, type === 'diamond' ? 'Decisão' : type === 'text' ? 'Texto' : type === 'note' ? 'Nota' : 'Novo elemento', type === 'note' ? '#ffe9a8' : DEFAULT.fill);
    // Procura um lugar livre perto do centro da vista, em espiral.
    const free = (x, y) => nodes.every((m) => x + n.w + 20 <= m.x || m.x + m.w + 20 <= x || y + n.h + 20 <= m.y || m.y + m.h + 20 <= y);
    let spot = null;
    for (let ring = 0; ring < 8 && !spot; ring++) {
      for (let i = -ring; i <= ring && !spot; i++) for (let j = -ring; j <= ring && !spot; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue;
        const x = clamp(snapTo(r.x - n.w / 2 + i * (n.w + 40)), 0, W - n.w);
        const y = clamp(snapTo(r.y - n.h / 2 + j * (n.h + 40)), 0, H - n.h);
        if (free(x, y)) spot = { x, y };
      }
    }
    spot = spot || { x: clamp(snapTo(r.x - n.w / 2), 0, W - n.w), y: clamp(snapTo(r.y - n.h / 2), 0, H - n.h) };
    n.x = spot.x;
    n.y = spot.y;
    nodes.push(n);
    selection = new Set([n.id]);
    selectedLink = null;
    changed();
  }

  function deleteSelection() {
    if (selectedLink) {
      remember();
      links = links.filter((l) => l.id !== selectedLink);
      selectedLink = null;
      changed();
      return true;
    }
    if (!selection.size) return false;
    remember();
    const keep = nodes.map((n) => !selection.has(n.id));
    const newIndex = [];
    let k = 0;
    keep.forEach((ok, i) => { newIndex[i] = ok ? k++ : -1; });
    links = links.filter((l) => keep[l.from] && keep[l.to]).map((l) => ({ ...l, from: newIndex[l.from], to: newIndex[l.to] }));
    nodes = nodes.filter((n) => !selection.has(n.id));
    selection.clear();
    changed();
    return true;
  }

  function copySelection() {
    const list = selectedNodes();
    if (!list.length) return false;
    const index = new Map(list.map((n, i) => [nodes.indexOf(n), i]));
    clipboard = {
      nodes: JSON.parse(JSON.stringify(list)),
      links: links.filter((l) => index.has(l.from) && index.has(l.to)).map((l) => ({ ...l, from: index.get(l.from), to: index.get(l.to) }))
    };
    return true;
  }

  function paste(offset = 40) {
    if (!clipboard || !clipboard.nodes.length) return;
    if (nodes.length + clipboard.nodes.length > MAX_NODES) return MO.toast('O desenho chegou ao limite de elementos.');
    remember();
    const base = nodes.length;
    const fresh = clipboard.nodes.map((n) => ({ ...n, id: uid(), x: clamp(n.x + offset, 0, W - n.w), y: clamp(n.y + offset, 0, H - n.h) }));
    nodes.push(...fresh);
    links.push(...clipboard.links.map((l) => ({ ...l, id: uid(), from: l.from + base, to: l.to + base })));
    selection = new Set(fresh.map((n) => n.id));
    selectedLink = null;
    clipboard = { nodes: fresh.map((n) => ({ ...n })), links: clipboard.links };
    changed();
  }

  function duplicate() {
    if (copySelection()) paste(30);
  }

  function align(kind) {
    const list = selectedNodes();
    if (list.length < 2) return MO.toast('Selecione dois ou mais elementos (Shift+clique ou arrastar à volta).');
    remember();
    const minX = Math.min(...list.map((n) => n.x)), maxX = Math.max(...list.map((n) => n.x + n.w));
    const minY = Math.min(...list.map((n) => n.y)), maxY = Math.max(...list.map((n) => n.y + n.h));
    for (const n of list) {
      if (kind === 'left') n.x = minX;
      if (kind === 'right') n.x = maxX - n.w;
      if (kind === 'center') n.x = Math.round((minX + maxX) / 2 - n.w / 2);
      if (kind === 'top') n.y = minY;
      if (kind === 'bottom') n.y = maxY - n.h;
      if (kind === 'middle') n.y = Math.round((minY + maxY) / 2 - n.h / 2);
    }
    changed();
  }

  function distribute(axis) {
    const list = selectedNodes().sort((a, b) => (axis === 'h' ? a.x - b.x : a.y - b.y));
    if (list.length < 3) return MO.toast('Selecione três ou mais elementos.');
    remember();
    const first = list[0];
    const last = list[list.length - 1];
    const total = list.reduce((t, n) => t + (axis === 'h' ? n.w : n.h), 0);
    const span = axis === 'h' ? last.x + last.w - first.x : last.y + last.h - first.y;
    const gap = (span - total) / (list.length - 1);
    let pos = axis === 'h' ? first.x : first.y;
    for (const n of list) {
      if (axis === 'h') { n.x = Math.round(pos); pos += n.w + gap; } else { n.y = Math.round(pos); pos += n.h + gap; }
    }
    changed();
  }

  // Mudar a ordem de desenho mantém as ligações (que usam índices).
  function reorder(front) {
    const list = selectedNodes();
    if (!list.length) return;
    remember();
    const order = front ? [...nodes.filter((n) => !selection.has(n.id)), ...list] : [...list, ...nodes.filter((n) => !selection.has(n.id))];
    const map = new Map(order.map((n, i) => [nodes.indexOf(n), i]));
    links = links.map((l) => ({ ...l, from: map.get(l.from), to: map.get(l.to) }));
    nodes = order;
    changed();
  }

  // Aplica uma propriedade aos elementos (ou à ligação) selecionados.
  function setProp(key, value) {
    if (selectedLink && ['dashed', 'arrow', 'elbow'].includes(key)) {
      const l = links.find((x) => x.id === selectedLink);
      if (!l) return;
      remember();
      l[key] = value;
      changed();
      return;
    }
    const list = selectedNodes();
    if (!list.length) return MO.toast('Selecione primeiro um elemento.');
    remember();
    for (const n of list) n[key] = value;
    changed();
  }

  function changeType(type) {
    const list = selectedNodes();
    if (!list.length) return MO.toast('Selecione primeiro um elemento.');
    remember();
    for (const n of list) n.type = type;
    changed();
  }

  function nudge(dx, dy) {
    const list = selectedNodes();
    if (!list.length) return false;
    remember();
    for (const n of list) { n.x = clamp(n.x + dx, 0, W - n.w); n.y = clamp(n.y + dy, 0, H - n.h); }
    changed();
    return true;
  }

  // Zoom para mostrar todos os elementos.
  function fit() {
    if (!scroller || !scroller.clientWidth) return;
    const pct = clamp(Math.floor(((scroller.clientWidth - 48) / W) * 10) * 10, 50, 150);
    if (zoomEl && zoomEl.setZoom) zoomEl.setZoom(pct);
    else { zoom = pct / 100; render(); }
  }

  // ---------- Painel de propriedades ----------

  function updateProps() {
    if (!propBox) return;
    const list = selectedNodes();
    const l = selectedLink && links.find((x) => x.id === selectedLink);
    propBox.dataset.mode = l ? 'link' : list.length ? 'node' : 'none';
    const first = list[0];
    propBox.querySelectorAll('[data-prop]').forEach((input) => {
      const key = input.dataset.prop;
      if (l && ['dashed', 'elbow'].includes(key)) input.checked = Boolean(l[key]);
      else if (l && key === 'arrow') input.value = l.arrow;
      else if (first && key in first) {
        if (input.type === 'checkbox') input.checked = Boolean(first[key]);
        else if (key !== 'stroke' || first.stroke !== 'none') input.value = String(first[key]);
      }
    });
  }

  function updateStatus() {
    if (!statusEl) return;
    const n = selection.size;
    statusEl.textContent = `${nodes.length} elemento(s) · ${links.length} ligação(ões)` + (n ? ` · ${n} selecionado(s)` : selectedLink ? ' · ligação selecionada' : '');
  }

  function buildRibbon() {
    const B = MO.bigButton;
    const I = MO.iconButton;
    const shapeBtn = (type, icon) => B(icon, TYPE_LABEL[type], `Acrescentar: ${TYPE_LABEL[type]}`, () => addShape(type));
    const tpl = (key, label, title) => MO.toolButton(label, title, () => MO.modules.draw.newDoc(key), 'wide draw-template');
    const linkBtn = B('line', 'Ligação', 'Ligar dois elementos (também pode arrastar a partir de um ponto azul)', () => setLinkMode(!linkMode));

    const swatches = h('div', { class: 'draw-swatches' }, FILLS.map((c) => h('button', { type: 'button', class: 'draw-swatch', style: `background:${c}`, title: 'Cor de fundo ' + c, 'aria-label': 'Cor de fundo ' + c, onclick: () => setProp('fill', c) })));
    const color = (prop, label) => {
      const input = h('input', { type: 'color', 'data-prop': prop, 'aria-label': label, title: label });
      input.addEventListener('change', () => setProp(prop, input.value));
      return h('label', { class: 'draw-field' }, h('span', null, label), input);
    };
    const size = h('select', { 'data-prop': 'fontSize', 'aria-label': 'Tamanho do texto' }, [12, 14, 16, 18, 20, 24, 28, 36, 48].map((n) => h('option', { value: n }, n + ' px')));
    size.addEventListener('change', () => setProp('fontSize', Number(size.value)));
    const bold = h('input', { type: 'checkbox', 'data-prop': 'bold', 'aria-label': 'Negrito' });
    bold.addEventListener('change', () => setProp('bold', bold.checked));
    const typeSel = h('select', { 'data-prop': 'type', 'aria-label': 'Forma' }, TYPES.map((t) => h('option', { value: t }, TYPE_LABEL[t])));
    typeSel.addEventListener('change', () => changeType(typeSel.value));
    const arrow = h('select', { 'data-prop': 'arrow', 'aria-label': 'Setas' }, [['end', 'Seta no fim'], ['both', 'Setas nas duas pontas'], ['none', 'Sem setas']].map(([v, t]) => h('option', { value: v }, t)));
    arrow.addEventListener('change', () => setProp('arrow', arrow.value));
    const dashed = h('input', { type: 'checkbox', 'data-prop': 'dashed', 'aria-label': 'Tracejado' });
    dashed.addEventListener('change', () => setProp('dashed', dashed.checked));
    const elbow = h('input', { type: 'checkbox', 'data-prop': 'elbow', 'aria-label': 'Em cotovelo' });
    elbow.addEventListener('change', () => setProp('elbow', elbow.checked));

    propBox = h('div', { class: 'draw-props', 'data-mode': 'none' },
      h('p', { class: 'draw-hint' }, 'Selecione um elemento ou uma ligação para mudar o aspeto.'),
      h('div', { class: 'draw-node-props' },
        h('label', { class: 'draw-field' }, h('span', null, 'Forma'), typeSel),
        h('div', { class: 'draw-field' }, h('span', null, 'Fundo'), swatches),
        h('div', { class: 'draw-row' }, color('fill', 'Outra cor'), color('stroke', 'Contorno'), color('color', 'Texto')),
        h('div', { class: 'draw-row' }, h('label', { class: 'draw-field' }, h('span', null, 'Tamanho'), size), h('label', { class: 'draw-check' }, bold, 'Negrito'))
      ),
      h('div', { class: 'draw-link-props' },
        h('label', { class: 'draw-field' }, h('span', null, 'Setas'), arrow),
        h('label', { class: 'draw-check' }, dashed, 'Tracejado'),
        h('label', { class: 'draw-check' }, elbow, 'Em cotovelo'),
        MO.toolButton('Texto da ligação…', 'Escrever um texto na ligação', () => { const l = links.find((x) => x.id === selectedLink); if (l) editLinkLabel(l); }, 'wide')
      )
    );

    const gridBox = h('input', { type: 'checkbox', checked: true, 'aria-label': 'Mostrar grelha' });
    gridBox.addEventListener('change', () => { showGrid = gridBox.checked; render(); });
    const snapBox = h('input', { type: 'checkbox', checked: true, 'aria-label': 'Encaixar na grelha' });
    snapBox.addEventListener('change', () => { snap = snapBox.checked; });

    return MO.ribbon(
      [
        {
          label: 'Inserir',
          groups: [
            { label: 'Anular', rows: [[I('undo', 'Anular (Ctrl+Z)', undo), I('redo', 'Refazer (Ctrl+Y)', redo)]] },
            { label: 'Formas', rows: [[shapeBtn('rect', 'rect'), shapeBtn('rounded', 'textBox')], [shapeBtn('ellipse', 'ellipse'), shapeBtn('diamond', 'branch')], [shapeBtn('parallelogram', 'slideNew'), shapeBtn('cylinder', 'grid')], [shapeBtn('note', 'comment'), shapeBtn('text', 'line')]] },
            { label: 'Ligar', rows: [[linkBtn]] },
            { label: 'Modelos', rows: [[tpl('flow', 'Fluxo', 'Fluxograma com decisão'), tpl('mind', 'Mapa mental', 'Mapa mental'), tpl('org', 'Organização', 'Organograma')], [tpl('timeline', 'Linha temporal', 'Etapas ao longo do tempo'), tpl('swot', 'SWOT', 'Forças, fraquezas, oportunidades e ameaças'), tpl('blank', 'Em branco', 'Começar sem elementos')]] }
          ]
        },
        { label: 'Formatar', groups: [{ label: 'Aspeto', rows: [[propBox]] }] },
        {
          label: 'Organizar',
          groups: [
            { label: 'Alinhar (Shift+clique para vários)', rows: [[I('alignObjLeft', 'Alinhar à esquerda', () => align('left')), I('alignObjCenter', 'Centrar na horizontal', () => align('center')), I('alignObjRight', 'Alinhar à direita', () => align('right'))], [I('alignObjTop', 'Alinhar em cima', () => align('top')), I('alignObjMiddle', 'Centrar na vertical', () => align('middle')), I('alignObjBottom', 'Alinhar em baixo', () => align('bottom'))], [I('distH', 'Distribuir na horizontal', () => distribute('h'), 'Distribuir ↔'), I('distV', 'Distribuir na vertical', () => distribute('v'), 'Distribuir ↕')]] },
            { label: 'Edição', rows: [[B('duplicate', 'Duplicar', 'Duplicar a seleção (Ctrl+D)', duplicate), B('trash', 'Eliminar', 'Eliminar a seleção (Delete)', () => deleteSelection() || MO.toast('Selecione primeiro um elemento ou uma ligação.'))], [B('front', 'Para a frente', 'Trazer para a frente', () => reorder(true)), B('back', 'Para trás', 'Enviar para trás', () => reorder(false))]] },
            { label: 'Grelha e vista', rows: [[h('label', { class: 'draw-check' }, gridBox, 'Mostrar grelha'), h('label', { class: 'draw-check' }, snapBox, 'Encaixar na grelha')], [MO.toolButton('Ajustar ao ecrã', 'Mostrar o desenho inteiro', fit, 'wide')]] }
          ]
        }
      ],
      () => ctx.file()
    );
  }

  // ---------- Exportar ----------

  function exportSvgNode() {
    const clone = svg.cloneNode(true);
    clone.setAttribute('xmlns', SVG_NS);
    clone.setAttribute('width', W);
    clone.setAttribute('height', H);
    clone.removeAttribute('style');
    clone.querySelectorAll('.draw-sel, .draw-resize, .draw-port, .draw-grid, .draw-marquee, .draw-link-hit').forEach((el) => el.remove());
    clone.querySelectorAll('.draw-link.is-selected path').forEach((p) => { p.setAttribute('stroke', '#5f6f66'); p.setAttribute('stroke-width', '2.4'); });
    return clone;
  }
  const serializeSvg = () => '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(exportSvgNode());

  async function exportPng() {
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(exportSvgNode()));
    const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url; });
    const canvas = h('canvas', { width: W * 2, height: H * 2 });
    const g = canvas.getContext('2d');
    g.scale(2, 2);
    g.drawImage(img, 0, 0, W, H);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  }

  // ---------- Ficheiros ----------

  const num = (v, a, b, d) => (Number.isFinite(Number(v)) ? clamp(Number(v), a, b) : d);
  function cleanNode(item) {
    if (!item || !TYPES.includes(item.type) || !Number.isFinite(item.x) || !Number.isFinite(item.y)) return null;
    return {
      id: uid(),
      type: item.type,
      x: clamp(item.x, 0, W - 40),
      y: clamp(item.y, 0, H - 30),
      w: num(item.w, 40, 900, 200),
      h: num(item.h, 30, 700, 90),
      text: String(item.text || '').slice(0, 400),
      fill: MO.HEX.test(item.fill) ? item.fill : DEFAULT.fill,
      stroke: item.stroke === 'none' ? 'none' : MO.HEX.test(item.stroke) ? item.stroke : DEFAULT.stroke,
      color: MO.HEX.test(item.color) ? item.color : DEFAULT.color,
      fontSize: num(item.fontSize, 8, 72, DEFAULT.fontSize),
      bold: item.bold == null ? item.type !== 'text' : Boolean(item.bold)
    };
  }

  MO.modules.draw = {
    id: 'draw', label: 'Desenho', ext: 'modraw', filterName: 'Desenho MyOffice', defaultName: 'Diagrama',

    init(container, context) {
      ctx = context;
      svg = s('svg', { xmlns: SVG_NS, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Área de desenho' });
      board = h('div', { class: 'draw-canvas' }, svg);
      scroller = board;
      statusEl = h('span', { class: 'status-text' });
      zoomEl = MO.zoomControl((k) => { zoom = k; render(); });
      const bar = h('div', { class: 'statusbar' }, statusEl, zoomEl);
      container.append(buildRibbon(), board, bar);
      svg.addEventListener('pointerdown', onBoardDown);
      document.addEventListener('keydown', (e) => {
        if (!isActive() || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable || document.querySelector('dialog[open]')) return;
        const mod = e.ctrlKey || e.metaKey;
        const key = e.key.toLowerCase();
        const step = e.shiftKey ? GRID : 2;
        let handled = true;
        if (mod && key === 'z' && !e.shiftKey) undo();
        else if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) redo();
        else if (mod && key === 'd') duplicate();
        else if (mod && key === 'c') handled = copySelection();
        else if (mod && key === 'v') { if (clipboard) paste(); else handled = false; }
        else if (mod && key === 'a') { selection = new Set(nodes.map((n) => n.id)); selectedLink = null; render(); }
        else if (e.key === 'Delete' || e.key === 'Backspace') handled = deleteSelection();
        else if (e.key === 'Escape') { selection.clear(); selectedLink = null; if (linkMode) setLinkMode(false); else render(); }
        else if (e.key === 'Enter' && selection.size === 1) editNodeText(selectedNodes()[0]);
        else if (e.key === 'ArrowLeft') handled = nudge(-step, 0);
        else if (e.key === 'ArrowRight') handled = nudge(step, 0);
        else if (e.key === 'ArrowUp') handled = nudge(0, -step);
        else if (e.key === 'ArrowDown') handled = nudge(0, step);
        else handled = false;
        if (handled) e.preventDefault();
      });
    },

    newDoc(template) {
      const model = templates(template || 'flow');
      nodes = model.nodes;
      links = model.links;
      selection = new Set();
      selectedLink = null;
      undoStack = [];
      redoStack = [];
      linkMode = false;
      linkStart = null;
      render();
    },

    serialize() {
      return JSON.stringify({ format: 'myoffice-draw', version: 2, nodes: nodes.map(({ id, ...n }) => n), links: links.map(({ id, ...l }) => l) });
    },

    load(text) {
      const data = JSON.parse(text);
      if (!data || data.format !== 'myoffice-draw' || !Array.isArray(data.nodes) || !Array.isArray(data.links)) throw new Error('Formato inválido');
      // Os índices das ligações referem-se à lista original; os elementos inválidos são descartados.
      const map = new Map();
      const clean = [];
      data.nodes.slice(0, MAX_NODES).forEach((item, i) => { const n = cleanNode(item); if (n) { map.set(i, clean.length); clean.push(n); } });
      nodes = clean;
      links = data.links
        .filter((l) => l && Number.isInteger(l.from) && Number.isInteger(l.to) && map.has(l.from) && map.has(l.to) && l.from !== l.to)
        .slice(0, MAX_LINKS)
        .map((l) => link(map.get(l.from), map.get(l.to), { label: String(l.label || '').slice(0, 40), dashed: Boolean(l.dashed), arrow: ['end', 'none', 'both'].includes(l.arrow) ? l.arrow : 'end', elbow: Boolean(l.elbow) }));
      selection = new Set();
      selectedLink = null;
      undoStack = [];
      redoStack = [];
      render();
    },

    exports: [
      { label: 'Desenho vetorial (.svg)', ext: 'svg', filterName: 'Imagem SVG', mime: 'image/svg+xml', get: () => serializeSvg() },
      { label: 'Imagem (.png)', ext: 'png', filterName: 'Imagem PNG', mime: 'image/png', get: () => exportPng() }
    ],

    print() {
      const node = exportSvgNode();
      node.setAttribute('width', '100%');
      node.removeAttribute('height');
      return { node, page: 'A4 landscape', margin: '12mm' };
    },

    // Usado pelos testes.
    _debug: { select: (ids) => { selection = new Set(ids); selectedLink = null; render(); }, nodes: () => nodes, links: () => links },

    show() {
      render();
      // Na primeira vez, o desenho inteiro cabe no ecrã.
      if (!fitted && scroller.clientWidth) { fitted = true; fit(); }
    }
  };
})();
