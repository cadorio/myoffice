'use strict';

// Desenho à mão livre, partilhado pelo Desenho e pelas Notas.
// Um traço é { pts: [[x, y], ...], color, width, alpha }, em coordenadas da área de desenho.
(function () {
  const MO = window.MO;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const MAX_POINTS = 4000;
  const MAX_STROKES = 2000;

  const PENS = {
    pen: { label: 'Caneta', width: 3, alpha: 1 },
    marker: { label: 'Marcador', width: 18, alpha: 0.35 }
  };
  const COLORS = ['#1d2622', '#2f6fdd', '#c62828', '#17806a', '#e0a100', '#8e44ad'];
  const MARKER_COLORS = ['#ffe14d', '#8ef0a0', '#8fd3ff', '#ff9ed2'];

  // Tira pontos quase repetidos (menos peso no ficheiro, linha igual).
  function simplify(pts, min = 1.5) {
    const out = [];
    for (const p of pts) {
      const last = out[out.length - 1];
      if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= min) out.push([Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]);
    }
    return out.slice(0, MAX_POINTS);
  }

  // Curva suave pelos pontos médios (quadráticas), como uma caneta.
  function pathData(pts) {
    if (!pts.length) return '';
    if (pts.length === 1) return `M${pts[0][0]},${pts[0][1]} l0.1,0`;
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2;
      const my = (pts[i][1] + pts[i + 1][1]) / 2;
      d += ` Q${pts[i][0]},${pts[i][1]} ${mx.toFixed(1)},${my.toFixed(1)}`;
    }
    const last = pts[pts.length - 1];
    return d + ` L${last[0]},${last[1]}`;
  }

  function strokeEl(st) {
    const el = document.createElementNS(SVG_NS, 'path');
    el.setAttribute('d', pathData(st.pts));
    el.setAttribute('fill', 'none');
    el.setAttribute('stroke', st.color);
    el.setAttribute('stroke-width', st.width);
    el.setAttribute('stroke-linecap', 'round');
    el.setAttribute('stroke-linejoin', 'round');
    if (st.alpha < 1) el.setAttribute('stroke-opacity', st.alpha);
    el.setAttribute('class', 'ink-stroke');
    return el;
  }

  // Distância de um ponto ao traço (para a borracha).
  function hits(st, x, y, radius) {
    const r = radius + st.width / 2;
    for (let i = 0; i < st.pts.length; i++) {
      const a = st.pts[i];
      const b = st.pts[i + 1] || a;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len = dx * dx + dy * dy;
      const t = len ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / len)) : 0;
      if (Math.hypot(a[0] + t * dx - x, a[1] + t * dy - y) <= r) return true;
    }
    return false;
  }

  function clean(list, maxX = 100000, maxY = 100000) {
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const st of list.slice(0, MAX_STROKES)) {
      if (!st || !Array.isArray(st.pts)) continue;
      const pts = st.pts.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])).slice(0, MAX_POINTS)
        .map((p) => [Math.max(0, Math.min(maxX, p[0])), Math.max(0, Math.min(maxY, p[1]))]);
      if (!pts.length) continue;
      out.push({
        pts,
        color: MO.HEX.test(st.color) ? st.color : '#1d2622',
        width: Number.isFinite(st.width) ? Math.max(0.5, Math.min(60, st.width)) : 3,
        alpha: Number.isFinite(st.alpha) ? Math.max(0.1, Math.min(1, st.alpha)) : 1
      });
    }
    return out;
  }

  // Liga o desenho à mão a um <svg>. toPoint(e) devolve coordenadas da área.
  // opts: { active: () => 'pen'|'marker'|'eraser'|null, style: () => ({ color, width, alpha }),
  //         strokes: () => array, onAdd(stroke), onErase(indices) }
  function attach(svg, toPoint, opts) {
    let live = null;
    let pts = null;
    svg.addEventListener('pointerdown', (e) => {
      const tool = opts.active();
      if (!tool || e.button > 0) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      svg.setPointerCapture(e.pointerId);
      const p = toPoint(e);
      if (tool === 'eraser') {
        pts = 'erase';
        erase(p);
        return;
      }
      const style = opts.style(tool);
      pts = [[p.x, p.y]];
      live = strokeEl({ pts, ...style });
      live.classList.add('ink-live');
      svg.append(live);
    });
    svg.addEventListener('pointermove', (e) => {
      if (!pts) return;
      const p = toPoint(e);
      if (pts === 'erase') return erase(p);
      // Rato: um ponto por evento. Caneta: também os pontos intermédios.
      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of events) { const q = toPoint(ev); pts.push([q.x, q.y]); }
      live.setAttribute('d', pathData(pts));
    });
    const finish = () => {
      if (!pts) return;
      if (pts !== 'erase' && pts.length) {
        const style = opts.style(opts.active());
        opts.onAdd({ pts: simplify(pts), ...style });
      }
      if (live) live.remove();
      live = null;
      pts = null;
    };
    svg.addEventListener('pointerup', finish);
    svg.addEventListener('pointercancel', finish);

    function erase(p) {
      const list = opts.strokes();
      const gone = [];
      list.forEach((st, i) => { if (hits(st, p.x, p.y, 8)) gone.push(i); });
      if (gone.length) opts.onErase(gone);
    }
  }

  MO.Ink = { PENS, COLORS, MARKER_COLORS, simplify, pathData, strokeEl, hits, clean, attach };
})();
