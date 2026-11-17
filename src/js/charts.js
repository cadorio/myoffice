'use strict';

// Motor de gráficos do MyOffice, partilhado pelas Folhas, pelo Texto e pelos Diapositivos.
// Desenha em SVG, sem bibliotecas externas. O texto é sempre inserido como texto (nunca HTML).
(function () {
  const MO = window.MO;
  const NS = 'http://www.w3.org/2000/svg';

  const TYPES = {
    column: 'Colunas',
    stacked: 'Colunas empilhadas',
    bar: 'Barras',
    line: 'Linhas',
    area: 'Área',
    pie: 'Circular',
    doughnut: 'Anel',
    scatter: 'Dispersão'
  };
  const PALETTES = {
    myoffice: { name: 'MyOffice', colors: ['#16865b', '#2f6fdd', '#e47758', '#c79a1e', '#8a5cd1', '#1aa3a3', '#d14d72', '#6b7a72'] },
    office: { name: 'Clássica', colors: ['#4472c4', '#ed7d31', '#a5a5a5', '#ffc000', '#5b9bd5', '#70ad47', '#264478', '#9e480e'] },
    sereno: { name: 'Serena', colors: ['#3d7a6b', '#7fb3a6', '#2e5e8c', '#9cc3e6', '#a07c4f', '#d9c1a0', '#5f6f66', '#b8c7be'] },
    vivo: { name: 'Viva', colors: ['#e63946', '#f4a261', '#2a9d8f', '#264653', '#e9c46a', '#8338ec', '#3a86ff', '#ff006e'] },
    cinza: { name: 'Cinzentos', colors: ['#1f2933', '#52606d', '#7b8794', '#9aa5b1', '#cbd2d9', '#3e4c59', '#616e7c', '#e4e7eb'] }
  };

  const el = (tag, attrs, text) => {
    const node = document.createElementNS(NS, tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, String(v));
    if (text != null) node.textContent = String(text);
    return node;
  };
  const fmt = (n) => (Number.isFinite(n) ? new Intl.NumberFormat('pt-PT', { maximumFractionDigits: Math.abs(n) < 10 ? 2 : 0 }).format(n) : '');
  const short = (t, n) => (String(t).length > n ? String(t).slice(0, n - 1) + '…' : String(t));

  // Escala "redonda" para os eixos: 0, 250, 500… em vez de 0, 237, 474…
  function niceScale(min, max, ticks = 5) {
    if (min === max) { max = min + 1; min = Math.min(0, min); }
    const span = max - min;
    const step0 = span / ticks;
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) || 10 * mag;
    const lo = Math.floor(min / step) * step;
    const hi = Math.ceil(max / step) * step;
    const out = [];
    for (let v = lo; v <= hi + step / 2; v += step) out.push(Number(v.toFixed(10)));
    return { min: lo, max: hi, ticks: out };
  }

  // Limpa e valida os dados de um gráfico.
  function normalize(spec) {
    const categories = (Array.isArray(spec.categories) ? spec.categories : []).slice(0, 200).map((c) => String(c ?? ''));
    const series = (Array.isArray(spec.series) ? spec.series : []).slice(0, 12).map((s, i) => ({
      name: String((s && s.name) || `Série ${i + 1}`).slice(0, 60),
      values: categories.map((_c, k) => { const v = Number(s && s.values && s.values[k]); return Number.isFinite(v) ? v : null; })
    }));
    return {
      type: Object.hasOwn(TYPES, spec.type) ? spec.type : 'column',
      title: String(spec.title || '').slice(0, 120),
      categories,
      series,
      legend: spec.legend !== false,
      labels: Boolean(spec.labels),
      palette: Object.hasOwn(PALETTES, spec.palette) ? spec.palette : 'myoffice'
    };
  }

  function render(input, size = {}) {
    const spec = normalize(input);
    const W = Math.max(240, Math.round(size.width || 640));
    const H = Math.max(160, Math.round(size.height || 380));
    const colors = PALETTES[spec.palette].colors;
    const color = (i) => colors[i % colors.length];
    const svg = el('svg', { xmlns: NS, viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': spec.title || 'Gráfico', 'font-family': 'Arial, Helvetica, sans-serif' });
    svg.append(el('rect', { x: 0, y: 0, width: W, height: H, fill: '#ffffff' }));
    const text = (x, y, t, attrs = {}) => svg.appendChild(el('text', { x, y, fill: '#3b4a42', 'font-size': 12, ...attrs }, t));

    let top = 14;
    if (spec.title) { text(W / 2, 30, short(spec.title, 70), { 'text-anchor': 'middle', 'font-size': 17, 'font-weight': 700, fill: '#1d2622' }); top = 46; }
    const pieLike = spec.type === 'pie' || spec.type === 'doughnut';
    const legendItems = pieLike ? spec.categories : spec.series.map((s) => s.name);
    const showLegend = spec.legend && legendItems.length > (pieLike ? 0 : 1);
    let bottom = H - 12;
    if (showLegend) {
      // Legenda em baixo, centrada, em uma ou mais linhas.
      const items = legendItems.slice(0, 16).map((name, i) => ({ name: short(name, 22), i }));
      const rows = [];
      let row = [];
      let width = 0;
      for (const it of items) {
        const w = 22 + it.name.length * 6.8 + 14;
        if (width + w > W - 30 && row.length) { rows.push({ row, width }); row = []; width = 0; }
        row.push({ ...it, w });
        width += w;
      }
      if (row.length) rows.push({ row, width });
      bottom = H - 10 - rows.length * 20;
      rows.forEach(({ row: r, width: rw }, k) => {
        let x = (W - rw) / 2;
        const y = bottom + 14 + k * 20;
        for (const it of r) {
          svg.append(el('rect', { x, y: y - 9, width: 12, height: 12, rx: 3, fill: color(it.i) }));
          text(x + 18, y + 1, it.name, { 'font-size': 12 });
          x += it.w;
        }
      });
      bottom -= 6;
    }

    if (!spec.series.length || !spec.categories.length) {
      text(W / 2, H / 2, 'Sem dados para mostrar', { 'text-anchor': 'middle', fill: '#8a968f' });
      return svg;
    }

    if (pieLike) {
      const values = spec.series[0].values.map((v) => Math.max(0, v || 0));
      const total = values.reduce((a, b) => a + b, 0);
      const cx = W / 2;
      const cy = (top + bottom) / 2;
      const r = Math.max(30, Math.min(W / 2 - 30, (bottom - top) / 2 - 6));
      const inner = spec.type === 'doughnut' ? r * 0.56 : 0;
      if (!total) { text(cx, cy, 'Sem valores positivos', { 'text-anchor': 'middle', fill: '#8a968f' }); return svg; }
      let angle = -Math.PI / 2;
      values.forEach((v, i) => {
        if (!v) return;
        const a = (v / total) * Math.PI * 2;
        const end = angle + a;
        const large = a > Math.PI ? 1 : 0;
        const p = (rad, rr) => `${(cx + rr * Math.cos(rad)).toFixed(2)},${(cy + rr * Math.sin(rad)).toFixed(2)}`;
        let d;
        if (a >= Math.PI * 2 - 1e-6) d = inner ? `M${p(0, r)} A${r},${r} 0 1 1 ${p(Math.PI, r)} A${r},${r} 0 1 1 ${p(0, r)} M${p(0, inner)} A${inner},${inner} 0 1 0 ${p(Math.PI, inner)} A${inner},${inner} 0 1 0 ${p(0, inner)} Z` : `M${p(0, r)} A${r},${r} 0 1 1 ${p(Math.PI, r)} A${r},${r} 0 1 1 ${p(0, r)} Z`;
        else if (inner) d = `M${p(angle, r)} A${r},${r} 0 ${large} 1 ${p(end, r)} L${p(end, inner)} A${inner},${inner} 0 ${large} 0 ${p(angle, inner)} Z`;
        else d = `M${cx},${cy} L${p(angle, r)} A${r},${r} 0 ${large} 1 ${p(end, r)} Z`;
        const slice = el('path', { d, fill: color(i), stroke: '#ffffff', 'stroke-width': 2, 'fill-rule': 'evenodd' });
        slice.append(el('title', null, `${spec.categories[i]}: ${fmt(v)} (${fmt((v / total) * 100)}%)`));
        svg.append(slice);
        if (spec.labels && a > 0.25) {
          const mid = angle + a / 2;
          const lr = inner ? (r + inner) / 2 : r * 0.64;
          text(cx + lr * Math.cos(mid), cy + lr * Math.sin(mid) + 4, `${fmt((v / total) * 100)}%`, { 'text-anchor': 'middle', fill: '#ffffff', 'font-weight': 700 });
        }
        angle = end;
      });
      if (inner) text(cx, cy + 6, fmt(total), { 'text-anchor': 'middle', 'font-size': 18, 'font-weight': 700, fill: '#1d2622' });
      return svg;
    }

    // Gráficos com eixos
    const horizontal = spec.type === 'bar';
    const stacked = spec.type === 'stacked';
    const scatter = spec.type === 'scatter';
    let vals = [];
    if (stacked) {
      spec.categories.forEach((_c, k) => {
        let pos = 0, neg = 0;
        for (const s of spec.series) { const v = s.values[k] || 0; if (v >= 0) pos += v; else neg += v; }
        vals.push(pos, neg);
      });
    } else vals = spec.series.flatMap((s) => s.values.filter((v) => v != null));
    const scale = niceScale(Math.min(0, ...vals), Math.max(0, ...vals));
    const xNums = scatter ? spec.categories.map(Number) : null;
    const xScale = scatter ? niceScale(Math.min(...xNums.filter(Number.isFinite), 0), Math.max(...xNums.filter(Number.isFinite), 1)) : null;

    const labelW = horizontal ? Math.min(140, 12 + Math.max(...spec.categories.map((c) => short(c, 18).length)) * 6.6) : Math.max(36, 10 + Math.max(...scale.ticks.map((t) => fmt(t).length)) * 7);
    const left = labelW + 10;
    const right = W - 18;
    const plotTop = top + 6;
    const plotBottom = bottom - (horizontal ? 22 : 26);
    const pw = right - left;
    const ph = plotBottom - plotTop;
    const vPos = (v) => (horizontal ? left + ((v - scale.min) / (scale.max - scale.min)) * pw : plotBottom - ((v - scale.min) / (scale.max - scale.min)) * ph);
    const n = spec.categories.length;

    // Grelha e eixo dos valores
    for (const t of scale.ticks) {
      const p = vPos(t);
      if (horizontal) {
        svg.append(el('line', { x1: p, x2: p, y1: plotTop, y2: plotBottom, stroke: t === 0 ? '#9aa39d' : '#e3e8e4' }));
        text(p, plotBottom + 16, fmt(t), { 'text-anchor': 'middle', 'font-size': 11, fill: '#6b7a72' });
      } else {
        svg.append(el('line', { x1: left, x2: right, y1: p, y2: p, stroke: t === 0 ? '#9aa39d' : '#e3e8e4' }));
        text(left - 8, p + 4, fmt(t), { 'text-anchor': 'end', 'font-size': 11, fill: '#6b7a72' });
      }
    }

    if (scatter) {
      const xPos = (v) => left + ((v - xScale.min) / (xScale.max - xScale.min)) * pw;
      for (const t of xScale.ticks) text(xPos(t), plotBottom + 16, fmt(t), { 'text-anchor': 'middle', 'font-size': 11, fill: '#6b7a72' });
      spec.series.forEach((s, i) => s.values.forEach((v, k) => {
        if (v == null || !Number.isFinite(xNums[k])) return;
        const dot = el('circle', { cx: xPos(xNums[k]), cy: vPos(v), r: 5, fill: color(i), 'fill-opacity': 0.85, stroke: '#ffffff', 'stroke-width': 1 });
        dot.append(el('title', null, `${s.name}: (${fmt(xNums[k])}; ${fmt(v)})`));
        svg.append(dot);
      }));
      return svg;
    }

    const slot = (horizontal ? ph : pw) / n;
    const catPos = (k) => (horizontal ? plotTop + slot * (k + 0.5) : left + slot * (k + 0.5));
    // Rótulos das categorias (saltam alguns quando não cabem)
    const every = horizontal ? Math.max(1, Math.ceil(n / (ph / 16))) : Math.max(1, Math.ceil(n / (pw / 46)));
    spec.categories.forEach((c, k) => {
      if (k % every) return;
      if (horizontal) text(left - 8, catPos(k) + 4, short(c, 18), { 'text-anchor': 'end', 'font-size': 11 });
      else text(catPos(k), plotBottom + 17, short(c, Math.max(4, Math.floor(slot * every / 6.5))), { 'text-anchor': 'middle', 'font-size': 11 });
    });

    const zero = vPos(Math.max(scale.min, Math.min(scale.max, 0)));
    const label = (x, y, v, anchor = 'middle') => spec.labels && text(x, y, fmt(v), { 'text-anchor': anchor, 'font-size': 11, 'font-weight': 700, fill: '#1d2622' });

    if (spec.type === 'column' || spec.type === 'bar' || stacked) {
      const groups = stacked ? 1 : spec.series.length;
      const band = slot * 0.74;
      const barW = Math.max(2, band / groups);
      spec.categories.forEach((_c, k) => {
        let pos = 0, neg = 0;
        spec.series.forEach((s, i) => {
          const v = s.values[k];
          if (v == null) return;
          let a, b;
          if (stacked) { if (v >= 0) { a = pos; b = pos + v; pos = b; } else { a = neg; b = neg + v; neg = b; } } else { a = 0; b = v; }
          const offset = stacked ? -band / 2 : -band / 2 + i * barW;
          const p1 = vPos(a), p2 = vPos(b);
          const rect = horizontal
            ? el('rect', { x: Math.min(p1, p2), y: catPos(k) + offset, width: Math.abs(p2 - p1), height: barW - 1, rx: 2, fill: color(i) })
            : el('rect', { x: catPos(k) + offset, y: Math.min(p1, p2), width: barW - 1, height: Math.abs(p2 - p1), rx: 2, fill: color(i) });
          rect.append(el('title', null, `${s.name} · ${spec.categories[k]}: ${fmt(v)}`));
          svg.append(rect);
          if (!stacked) {
            if (horizontal) label(p2 + (v >= 0 ? 4 : -4), catPos(k) + offset + barW / 2 + 4, v, v >= 0 ? 'start' : 'end');
            else label(catPos(k) + offset + barW / 2, p2 + (v >= 0 ? -5 : 14), v);
          }
        });
        if (stacked && spec.labels) label(catPos(k), vPos(pos) - 5, pos);
      });
      return svg;
    }

    // Linhas e área
    spec.series.forEach((s, i) => {
      const pts = s.values.map((v, k) => (v == null ? null : [catPos(k), vPos(v)]));
      const runs = [];
      let run = [];
      for (const p of pts) { if (p) run.push(p); else if (run.length) { runs.push(run); run = []; } }
      if (run.length) runs.push(run);
      for (const r of runs) {
        const d = 'M' + r.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L');
        if (spec.type === 'area') svg.append(el('path', { d: `${d} L${r[r.length - 1][0].toFixed(1)},${zero} L${r[0][0].toFixed(1)},${zero} Z`, fill: color(i), 'fill-opacity': 0.22 }));
        svg.append(el('path', { d, fill: 'none', stroke: color(i), 'stroke-width': 2.6, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      }
      pts.forEach((p, k) => {
        if (!p) return;
        const dot = el('circle', { cx: p[0], cy: p[1], r: spec.type === 'area' ? 2.5 : 4, fill: color(i), stroke: '#ffffff', 'stroke-width': 1.2 });
        dot.append(el('title', null, `${s.name} · ${spec.categories[k]}: ${fmt(s.values[k])}`));
        svg.append(dot);
        label(p[0], p[1] - 8, s.values[k]);
      });
    });
    return svg;
  }

  // Lê uma tabela (linhas de valores) no formato do gráfico: 1.ª linha = nomes das séries,
  // 1.ª coluna = categorias, restantes colunas = valores.
  function fromTable(rows, opts = {}) {
    const clean = rows.filter((r) => r.some((v) => String(v ?? '').trim() !== ''));
    if (clean.length < 2 || Math.max(...clean.map((r) => r.length)) < 2) return null;
    const num = (v) => {
      if (typeof v === 'number') return v;
      const t = String(v ?? '').trim().replace(/[€$%\s]/g, '');
      if (!t) return null;
      const n = Number(/,/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t);
      return Number.isFinite(n) ? n : null;
    };
    const head = clean[0];
    const firstIsHeader = head.slice(1).some((v) => num(v) == null && String(v ?? '').trim());
    const body = firstIsHeader ? clean.slice(1) : clean;
    const width = Math.max(...clean.map((r) => r.length));
    const series = [];
    for (let c = 1; c < width; c++) {
      const values = body.map((r) => num(r[c]));
      if (values.some((v) => v != null)) series.push({ name: firstIsHeader ? String(head[c] || `Série ${c}`) : `Série ${c}`, values });
    }
    if (!series.length) return null;
    return normalize({ ...opts, categories: body.map((r, i) => String(r[0] ?? '').trim() || `Linha ${i + 1}`), series });
  }

  // Converte o SVG em PNG (para inserir no Texto e nos Diapositivos, e para exportar).
  async function toPng(svg, scale = 2) {
    const w = Number(svg.getAttribute('width'));
    const hh = Number(svg.getAttribute('height'));
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg));
    const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url; });
    const canvas = document.createElement('canvas');
    canvas.width = w * scale;
    canvas.height = hh * scale;
    const g = canvas.getContext('2d');
    g.scale(scale, scale);
    g.drawImage(img, 0, 0, w, hh);
    return canvas.toDataURL('image/png');
  }

  // ---------- Diálogo para escolher o tipo e o aspeto ----------

  // opts: { spec, title, okLabel, editableData } -> Promise<spec | null>
  function dialog(opts) {
    const { h } = MO;
    let spec = normalize(opts.spec || { type: 'column' });
    return new Promise((resolve) => {
      const preview = h('div', { class: 'chart-preview' });
      const types = h('div', { class: 'chart-types', role: 'radiogroup', 'aria-label': 'Tipo de gráfico' });
      const draw = () => {
        preview.replaceChildren(render(spec, { width: 620, height: 340 }));
        types.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.type === spec.type));
      };
      for (const [type, label] of Object.entries(TYPES)) {
        const thumb = render({ ...spec, type, title: '', legend: false, labels: false }, { width: 240, height: 160 });
        const b = h('button', { type: 'button', class: 'chart-type', 'data-type': type, role: 'radio', title: label }, thumb, h('span', null, label));
        b.addEventListener('click', () => { spec.type = type; draw(); });
        types.append(b);
      }
      const title = h('input', { type: 'text', value: spec.title, placeholder: 'Título do gráfico', 'aria-label': 'Título do gráfico' });
      title.addEventListener('input', () => { spec.title = title.value.slice(0, 120); draw(); });
      const legend = h('input', { type: 'checkbox', checked: spec.legend });
      legend.addEventListener('change', () => { spec.legend = legend.checked; draw(); });
      const labels = h('input', { type: 'checkbox', checked: spec.labels });
      labels.addEventListener('change', () => { spec.labels = labels.checked; draw(); });
      const palette = h('select', { 'aria-label': 'Cores' }, Object.entries(PALETTES).map(([k, p]) => h('option', { value: k, selected: k === spec.palette }, p.name)));
      palette.addEventListener('change', () => { spec.palette = palette.value; draw(); });

      // Dados editáveis (Texto e Diapositivos): tabela separada por tabulações ou ponto e vírgula.
      let dataArea = null;
      if (opts.editableData) {
        const lines = [['', ...spec.series.map((s) => s.name)].join('\t'), ...spec.categories.map((c, k) => [c, ...spec.series.map((s) => (s.values[k] ?? ''))].join('\t'))];
        dataArea = h('textarea', { class: 'chart-data', rows: 7, spellcheck: 'false', 'aria-label': 'Dados do gráfico' });
        dataArea.value = lines.join('\n');
        dataArea.addEventListener('input', () => {
          const rows = dataArea.value.split(/\r?\n/).map((l) => l.split(/\t|;/));
          const next = fromTable(rows, spec);
          if (next) { spec = { ...next, type: spec.type }; draw(); }
        });
      }

      const dlg = h('dialog', { class: 'mo-dialog chart-dialog' },
        h('form', { method: 'dialog' },
          h('h2', null, opts.title || 'Gráfico'),
          h('div', { class: 'chart-dialog-body' },
            h('div', { class: 'chart-side' },
              types,
              h('label', { class: 'chart-field' }, h('span', null, 'Título'), title),
              h('div', { class: 'chart-row' }, h('label', { class: 'chart-check' }, legend, 'Legenda'), h('label', { class: 'chart-check' }, labels, 'Valores'), h('label', { class: 'chart-field' }, h('span', null, 'Cores'), palette)),
              dataArea ? h('label', { class: 'chart-field' }, h('span', null, 'Dados (cole do Excel ou escreva; 1.ª linha = séries, 1.ª coluna = categorias)'), dataArea) : null
            ),
            preview
          ),
          h('div', { class: 'mo-dialog-actions' },
            h('button', { type: 'button', class: 'btn', onclick: () => dlg.close('') }, 'Cancelar'),
            h('button', { type: 'submit', class: 'btn primary', value: 'ok' }, opts.okLabel || 'Inserir')
          )
        )
      );
      dlg.addEventListener('close', () => { dlg.remove(); resolve(dlg.returnValue === 'ok' ? normalize(spec) : null); });
      document.body.append(dlg);
      draw();
      dlg.showModal();
    });
  }

  MO.Charts = { TYPES, PALETTES, render, normalize, fromTable, toPng, dialog, niceScale };
})();
