'use strict';

// MyOffice Desenho: esquemas e diagramas vetoriais, locais e editáveis.
(function () {
  const MO = window.MO;
  const { h } = MO;
  const W = 1000;
  const H = 700;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  let svg, inspector, textField, fillField, linkButton, ctx;
  let nodes = [];
  let links = [];
  let selected = null;
  let dragging = null;
  let linkMode = false;
  let linkStart = null;
  let seq = 0;
  const uid = () => 'd' + Date.now().toString(36) + (seq++).toString(36);
  const s = (tag, attrs, ...kids) => {
    const el = document.createElementNS(SVG_NS, tag);
    if (attrs) for (const [key, value] of Object.entries(attrs)) if (value != null) el.setAttribute(key, value);
    for (const child of kids.flat()) el.append(child && child.nodeType ? child : document.createTextNode(String(child)));
    return el;
  };

  function node(type, x, y, text, fill = '#e8efe5') {
    return { id: uid(), type, x, y, w: type === 'ellipse' ? 190 : 210, h: 92, text, fill, color: '#202a27' };
  }

  function templates(name) {
    if (name === 'mind') return {
      nodes: [node('ellipse', 400, 290, 'Ideia central', '#c5ef75'), node('rect', 90, 110, 'Pesquisa', '#e6ebf7'), node('rect', 710, 110, 'Planeamento', '#e4f1eb'), node('rect', 90, 480, 'Execução', '#fae9e1'), node('rect', 710, 480, 'Resultados', '#eee8f6')],
      links: [[0, 1], [0, 2], [0, 3], [0, 4]].map(([a, b]) => ({ id: uid(), from: a, to: b }))
    };
    if (name === 'org') return {
      nodes: [node('rect', 395, 70, 'Direção', '#c5ef75'), node('rect', 75, 320, 'Equipa de produto', '#e6ebf7'), node('rect', 395, 320, 'Equipa comercial', '#e4f1eb'), node('rect', 715, 320, 'Operações', '#fae9e1')],
      links: [1, 2, 3].map((to) => ({ id: uid(), from: 0, to }))
    };
    return {
      nodes: [node('rect', 55, 285, 'Início', '#e4f1eb'), node('rect', 290, 285, 'Etapa 1', '#e6ebf7'), node('rect', 525, 285, 'Etapa 2', '#f8f0dc'), node('rect', 760, 285, 'Conclusão', '#fae9e1')],
      links: [0, 1, 2].map((from) => ({ id: uid(), from, to: from + 1 }))
    };
  }

  function render() {
    if (!svg) return;
    svg.replaceChildren();
    const defs = s('defs', null,
      s('marker', { id: 'draw-arrow', markerWidth: '10', markerHeight: '10', refX: '8', refY: '5', orient: 'auto', markerUnits: 'strokeWidth' },
        s('path', { d: 'M0,0 L10,5 L0,10 z', fill: '#75827a' })
      )
    );
    svg.append(defs);
    const bg = s('rect', { x: 0, y: 0, width: W, height: H, fill: '#ffffff', rx: 12, 'pointer-events': 'none' });
    svg.append(bg);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.replaceWith(svg.cloneNode(false));
    svg = document.querySelector('.draw-canvas svg');
    svg.append(defs, bg);
    renderNodesOnly();
  }

  function renderNodesOnly() {
    if (!svg) return;
    for (const link of links) {
      const a = nodes[link.from]; const b = nodes[link.to];
      if (!a || !b) continue;
      svg.append(s('line', { x1: a.x + a.w / 2, y1: a.y + a.h / 2, x2: b.x + b.w / 2, y2: b.y + b.h / 2, stroke: '#75827a', 'stroke-width': 4, 'marker-end': 'url(#draw-arrow)' }));
    }
    nodes.forEach((item) => {
      const shape = item.type === 'ellipse'
        ? s('ellipse', { cx: item.x + item.w / 2, cy: item.y + item.h / 2, rx: item.w / 2, ry: item.h / 2, fill: item.fill, stroke: '#d4ded5', 'stroke-width': 2 })
        : item.type === 'diamond'
          ? s('polygon', { points: `${item.x + item.w / 2},${item.y} ${item.x + item.w},${item.y + item.h / 2} ${item.x + item.w / 2},${item.y + item.h} ${item.x},${item.y + item.h / 2}`, fill: item.fill, stroke: '#d4ded5', 'stroke-width': 2 })
          : s('rect', { x: item.x, y: item.y, width: item.w, height: item.h, rx: 13, fill: item.fill, stroke: '#d4ded5', 'stroke-width': 2 });
      const group = s('g', { 'data-id': item.id, class: item.id === selected ? 'draw-node is-selected' : 'draw-node' }, shape);
      String(item.text || '').split('\n').slice(0, 5).forEach((line, i, lines) => group.append(s('text', { x: item.x + item.w / 2, y: item.y + item.h / 2 - (lines.length - 1) * 11 + i * 22, 'text-anchor': 'middle', 'dominant-baseline': 'middle', fill: item.color, 'font-family': 'Arial, sans-serif', 'font-size': 18, 'font-weight': 600 }, line)));
      if (item.id === selected) group.append(s('rect', { x: item.x - 4, y: item.y - 4, width: item.w + 8, height: item.h + 8, rx: 15, fill: 'none', stroke: '#567c5e', 'stroke-dasharray': '7 5', 'stroke-width': 2 }));
      group.addEventListener('pointerdown', (event) => {
        event.stopPropagation();
        if (linkMode) {
          const index = nodes.indexOf(item);
          if (linkStart == null) { linkStart = index; selected = item.id; }
          else if (linkStart !== index) {
            links.push({ id: uid(), from: linkStart, to: index });
            linkStart = null; linkMode = false; linkButton.classList.remove('active');
            selected = item.id; changed(); return;
          }
          render(); updateInspector(); return;
        }
        selected = item.id;
        const bounds = svg.getBoundingClientRect();
        dragging = { id: item.id, x: (event.clientX - bounds.left) * W / bounds.width - item.x, y: (event.clientY - bounds.top) * H / bounds.height - item.y };
        render(); updateInspector();
      });
      svg.append(group);
    });
  }

  function updateInspector() {
    const item = nodes.find((n) => n.id === selected);
    inspector.hidden = !item;
    if (!item) return;
    textField.value = item.text;
    fillField.value = item.fill;
  }

  function changed() { ctx.dirty(); render(); updateInspector(); }

  function addShape(type) {
    const item = node(type, 390, 280, type === 'diamond' ? 'Decisão' : 'Novo elemento', '#e8efe5');
    nodes.push(item); selected = item.id; changed();
  }

  function serializeSvg() {
    const clone = svg.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', W); clone.setAttribute('height', H);
    clone.querySelectorAll('.draw-node.is-selected > rect:last-child').forEach((el) => el.remove());
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
  }

  MO.modules.draw = {
    id: 'draw', label: 'Desenho', ext: 'modraw', filterName: 'Desenho MyOffice', defaultName: 'Diagrama',
    init(container, context) {
      ctx = context;
      svg = s('svg', { xmlns: SVG_NS, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Área de desenho' });
      const addButton = (label, type) => h('button', { type: 'button', class: 'draw-action', onclick: () => addShape(type) }, label);
      linkButton = h('button', { type: 'button', class: 'draw-action', onclick: () => { linkMode = !linkMode; linkStart = null; linkButton.classList.toggle('active', linkMode); MO.toast(linkMode ? 'Selecione dois elementos para os ligar.' : 'Ligação cancelada.'); } }, '＋ Ligação');
      const toolbar = h('div', { class: 'draw-toolbar' },
        h('span', { class: 'draw-toolbar-label' }, 'ELEMENTOS'), addButton('＋ Caixa', 'rect'), addButton('＋ Círculo', 'ellipse'), addButton('＋ Decisão', 'diamond'), linkButton,
        h('span', { class: 'draw-toolbar-divider' }),
        ...[['Fluxo', 'flow'], ['Mapa mental', 'mind'], ['Organização', 'org']].map(([label, key]) => h('button', { type: 'button', class: 'draw-template', onclick: () => this.newDoc(key) }, label))
      );
      textField = h('textarea', { rows: 3, 'aria-label': 'Texto do elemento' });
      fillField = h('input', { type: 'color', 'aria-label': 'Cor do elemento' });
      inspector = h('aside', { class: 'draw-inspector', hidden: true },
        h('h3', null, 'Elemento selecionado'), h('label', null, 'Texto', textField), h('label', null, 'Cor de fundo', fillField),
        h('button', { type: 'button', class: 'btn', onclick: () => { const remove = nodes.findIndex((n) => n.id === selected); nodes = nodes.filter((n) => n.id !== selected); links = links.filter((edge) => edge.from !== remove && edge.to !== remove).map((edge) => ({ ...edge, from: edge.from > remove ? edge.from - 1 : edge.from, to: edge.to > remove ? edge.to - 1 : edge.to })); selected = null; changed(); } }, 'Eliminar elemento')
      );
      const board = h('div', { class: 'draw-canvas', onclick: (e) => { if (e.target === svg) { selected = null; updateInspector(); render(); } } }, svg);
      const workspace = h('div', { class: 'draw-workspace' }, board, inspector);
      container.append(toolbar, workspace);
      textField.addEventListener('input', () => { const item = nodes.find((n) => n.id === selected); if (item) { item.text = textField.value.slice(0, 140); changed(); } });
      fillField.addEventListener('input', () => { const item = nodes.find((n) => n.id === selected); if (item) { item.fill = fillField.value; changed(); } });
      window.addEventListener('pointermove', (event) => {
        if (!dragging) return;
        const item = nodes.find((n) => n.id === dragging.id); if (!item) return;
        const bounds = svg.getBoundingClientRect();
        item.x = Math.max(0, Math.min(W - item.w, (event.clientX - bounds.left) * W / bounds.width - dragging.x));
        item.y = Math.max(0, Math.min(H - item.h, (event.clientY - bounds.top) * H / bounds.height - dragging.y));
        render();
      });
      window.addEventListener('pointerup', () => { if (dragging) { dragging = null; ctx.dirty(); } });
      document.addEventListener('keydown', (event) => { if ((event.key === 'Delete' || event.key === 'Backspace') && selected && document.body.dataset.current === 'draw' && !['INPUT', 'TEXTAREA'].includes(event.target.tagName)) { const remove = nodes.findIndex((n) => n.id === selected); nodes = nodes.filter((n) => n.id !== selected); links = links.filter((edge) => edge.from !== remove && edge.to !== remove).map((edge) => ({ ...edge, from: edge.from > remove ? edge.from - 1 : edge.from, to: edge.to > remove ? edge.to - 1 : edge.to })); selected = null; changed(); } });
    },
    newDoc(template) { const model = templates(template || 'flow'); nodes = model.nodes; links = model.links; selected = null; seq++; render(); updateInspector(); },
    serialize() { return JSON.stringify({ format: 'myoffice-draw', version: 1, nodes, links }); },
    load(text) { const data = JSON.parse(text); if (!data || data.format !== 'myoffice-draw' || !Array.isArray(data.nodes) || !Array.isArray(data.links)) throw new Error('Formato inválido'); nodes = data.nodes.filter((n) => n && ['rect', 'ellipse', 'diamond'].includes(n.type) && Number.isFinite(n.x) && Number.isFinite(n.y)).slice(0, 100).map((item) => ({ id: uid(), type: item.type, x: Math.max(0, Math.min(W - 40, item.x)), y: Math.max(0, Math.min(H - 40, item.y)), w: Math.max(40, Math.min(600, Number(item.w) || 210)), h: Math.max(40, Math.min(400, Number(item.h) || 92)), text: String(item.text || '').slice(0, 140), fill: MO.HEX.test(item.fill) ? item.fill : '#e8efe5', color: MO.HEX.test(item.color) ? item.color : '#202a27' })); links = data.links.filter((edge) => edge && Number.isInteger(edge.from) && Number.isInteger(edge.to) && edge.from >= 0 && edge.to >= 0 && edge.from < nodes.length && edge.to < nodes.length && edge.from !== edge.to).slice(0, 150).map((edge) => ({ id: uid(), from: edge.from, to: edge.to })); selected = null; render(); updateInspector(); },
    exports: [{ label: 'Desenho vetorial (.svg)', ext: 'svg', filterName: 'Imagem SVG', mime: 'image/svg+xml', get: () => serializeSvg() }],
    print() { const node = svg.cloneNode(true); node.setAttribute('width', W); node.setAttribute('height', H); return { node, page: 'A4 landscape', margin: '12mm' }; },
    show() { render(); updateInspector(); }
  };
})();
