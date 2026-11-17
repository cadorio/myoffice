'use strict';

(function () {
  const MO = (window.MO = window.MO || {});
  MO.modules = {};

  // Cria um elemento: h('button', { class: 'x', onclick: fn }, 'texto', outroElemento)
  MO.h = function (tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style') Object.assign(el.style, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  };

  const h = MO.h;

  MO.escapeHTML = (s) =>
    String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

  MO.HEX = /^#[0-9a-fA-F]{6}$/;
  MO.IMAGE_DATA_URL = /^data:image\/(png|jpeg|gif|webp|bmp);base64,[A-Za-z0-9+/=\s]+$/i;

  const BAD_TAGS =
    'script,style,iframe,frame,frameset,object,embed,link,meta,base,form,input,button,select,textarea,' +
    'svg,math,audio,video,source,template,noscript,title,head,dialog';
  const URL_ATTRS = ['href', 'src', 'action', 'formaction', 'background', 'poster', 'xlink:href'];

  // Propriedades de estilo que um documento pode trazer. Tudo o resto é descartado, para que um
  // ficheiro não consiga sobrepor-se à interface (position, z-index, transform…) nem pedir recursos.
  const SAFE_STYLES = [
    'color', 'background-color', 'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant',
    'text-align', 'text-decoration', 'text-decoration-line', 'text-indent', 'line-height', 'vertical-align',
    'margin-left', 'margin-right', 'padding-left', 'list-style-type', 'width', 'height', 'max-width', 'white-space'
  ];
  const SAFE_CLASSES = ['page-break'];

  function cleanStyle(el) {
    const kept = [];
    for (const prop of SAFE_STYLES) {
      const value = el.style.getPropertyValue(prop);
      if (!value || value.length > 200 || /url\s*\(|expression|var\s*\(|[<>{}\\]/i.test(value)) continue;
      if (/^(width|height|max-width|margin-|padding-|text-indent)/.test(prop) && /-\d|\d{5,}/.test(value)) continue;
      kept.push(`${prop}: ${value}`);
    }
    if (kept.length) el.setAttribute('style', kept.join('; '));
    else el.removeAttribute('style');
  }

  // Limpa HTML vindo de ficheiros ou da área de transferência antes de o colocar na página.
  MO.sanitizeHTML = function (html) {
    const doc = new DOMParser().parseFromString('<!doctype html><body>' + String(html), 'text/html');
    doc.body.querySelectorAll(BAD_TAGS).forEach((n) => n.remove());
    doc.body.querySelectorAll('*').forEach((n) => {
      for (const attr of [...n.attributes]) {
        const name = attr.name.toLowerCase();
        const value = attr.value;
        let keep = true;
        if (name.startsWith('on') || ['srcdoc', 'srcset', 'contenteditable', 'id', 'name', 'target'].includes(name)) {
          keep = false;
        } else if (URL_ATTRS.includes(name)) {
          const url = value.replace(/[\u0000- ]+/g, '');
          if (n.tagName === 'IMG' && name === 'src') keep = MO.IMAGE_DATA_URL.test(url);
          else keep = name === 'href' && /^(https?:|mailto:|#)/i.test(url);
        } else if (name === 'class') {
          const classes = value.split(/\s+/).filter((c) => SAFE_CLASSES.includes(c));
          if (classes.length) n.setAttribute('class', classes.join(' '));
          else keep = false;
        } else if (name === 'style' || name === 'hidden' || name === 'tabindex' || name === 'draggable' || name.startsWith('data-') || name.startsWith('aria-')) {
          keep = name === 'style';
        }
        if (!keep) n.removeAttribute(attr.name);
      }
      if (n.hasAttribute('style')) cleanStyle(n);
    });
    return doc.body.innerHTML;
  };

  // Escolhe um ficheiro através do seletor do sistema. as: 'text' | 'dataURL'
  // binaryExt: extensões lidas como bytes (Uint8Array) em vez de texto.
  MO.pickFile = function ({ accept, as = 'text', maxBytes = 64 * 1024 * 1024, binaryExt = [] }) {
    return new Promise((resolve) => {
      const input = h('input', { type: 'file', accept });
      input.addEventListener('cancel', () => resolve(null));
      input.addEventListener('change', () => {
        const file = input.files[0];
        if (!file) return resolve(null);
        if (file.size > maxBytes) {
          MO.toast('O ficheiro é demasiado grande.');
          return resolve(null);
        }
        const reader = new FileReader();
        const binary = binaryExt.includes(file.name.split('.').pop().toLowerCase());
        reader.onload = () => resolve({ name: file.name, content: binary ? new Uint8Array(reader.result) : reader.result });
        reader.onerror = () => resolve(null);
        if (binary) reader.readAsArrayBuffer(file);
        else if (as === 'dataURL') reader.readAsDataURL(file);
        else reader.readAsText(file);
      });
      input.click();
    });
  };

  MO.pickImage = async function () {
    const file = await MO.pickFile({ accept: 'image/png,image/jpeg,image/gif,image/webp', as: 'dataURL', maxBytes: 8 * 1024 * 1024 });
    if (!file) return null;
    if (!MO.IMAGE_DATA_URL.test(file.content)) {
      MO.toast('Formato de imagem não suportado.');
      return null;
    }
    return file.content;
  };

  // DOCX e PPTX aceitam PNG, JPEG e GIF; converte WebP para PNG antes de o guardar no documento.
  MO.officeImageDataURL = function (src) {
    if (!MO.IMAGE_DATA_URL.test(src || '')) return Promise.reject(new Error('Formato de imagem inválido.'));
    if (/^data:image\/(png|jpeg|gif);/i.test(src)) return Promise.resolve(src);
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        try {
          const scale = Math.min(1, 4096 / Math.max(image.naturalWidth, image.naturalHeight));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
          const context = canvas.getContext('2d');
          if (!context) throw new Error('Não foi possível preparar a imagem.');
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/png'));
        } catch (error) {
          reject(error);
        }
      };
      image.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
      image.src = src;
    });
  };

  MO.download = function (name, content, mime) {
    const url = URL.createObjectURL(new Blob([content], { type: mime || 'application/octet-stream' }));
    const a = h('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  let toastTimer = null;
  MO.toast = function (message) {
    let el = document.getElementById('toast');
    if (!el) {
      el = h('div', { id: 'toast', role: 'status' });
      document.body.append(el);
    }
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  };

  // Diálogo modal simples (o prompt() nativo não existe no Electron).
  // fields: [{ name, label, type, value, min, max }] -> devolve { name: valor } ou null.
  MO.dialog = function ({ title, message, fields = [], okLabel = 'OK', cancelLabel = 'Cancelar' }) {
    return new Promise((resolve) => {
      let result = null;
      const inputs = fields.map((f) =>
        h('input', {
          type: f.type || 'text',
          value: f.value == null ? '' : f.value,
          min: f.min,
          max: f.max,
          placeholder: f.placeholder,
          'data-name': f.name
        })
      );
      const form = h(
        'form',
        { method: 'dialog' },
        h('h2', null, title),
        message ? h('p', null, message) : null,
        fields.map((f, i) => h('label', null, h('span', null, f.label), inputs[i])),
        h(
          'div',
          { class: 'dialog-actions' },
          cancelLabel ? h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, cancelLabel) : null,
          h('button', { type: 'submit', class: 'btn primary' }, okLabel)
        )
      );
      const dlg = h('dialog', { class: 'mo-dialog' }, form);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        result = {};
        for (const input of inputs) result[input.dataset.name] = input.value;
        dlg.close();
      });
      dlg.addEventListener('close', () => {
        dlg.remove();
        resolve(result);
      });
      document.body.append(dlg);
      dlg.showModal();
      if (inputs[0]) inputs[0].select();
    });
  };

  // Botão de barra de ferramentas que não rouba o foco (nem a seleção) ao editor.
  MO.toolButton = function (label, title, onClick, extraClass) {
    const btn = h('button', { type: 'button', class: 'tool' + (extraClass ? ' ' + extraClass : ''), title, 'aria-label': title }, label);
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', onClick);
    return btn;
  };

  // listId: datalist com as cores do tema, mostradas como amostras no seletor.
  MO.colorButton = function (label, title, value, onInput, onDone, listId) {
    const input = h('input', { type: 'color', value, title, 'aria-label': title, list: listId });
    input.addEventListener('input', () => onInput(input.value));
    if (onDone) input.addEventListener('change', () => onDone(input.value));
    return h('label', { class: 'tool color', title }, h('span', null, label), input);
  };

  MO.sep = () => h('span', { class: 'tool-sep' });

  // ---------- Ícones (SVG de traço, desenhados para esta aplicação) ----------

  const ICONS = {
    undo: 'M8 6 3 11l5 5M3 11h11a5.5 5.5 0 0 1 0 11h-3',
    redo: 'M16 6l5 5-5 5M21 11H10a5.5 5.5 0 0 0 0 11h3',
    alignLeft: 'M4 6h16M4 10h10M4 14h16M4 18h10',
    alignCenter: 'M4 6h16M7 10h10M4 14h16M7 18h10',
    alignRight: 'M4 6h16M10 10h10M4 14h16M10 18h10',
    justify: 'M4 6h16M4 10h16M4 14h16M4 18h16',
    bullets: 'M9 6h11M9 12h11M9 18h11M4.5 6h.5M4.5 12h.5M4.5 18h.5',
    numbers: 'M10 6h10M10 12h10M10 18h10M4 5l1.5-1v5M4 15h2.5L4 19h2.5',
    outdent: 'M11 6h9M11 12h9M11 18h9M7 9l-3 3 3 3',
    indent: 'M11 6h9M11 12h9M11 18h9M4 9l3 3-3 3',
    table: 'M3 5h18v14H3zM3 10h18M3 15h18M9 5v14M15 5v14',
    image: 'M3 5h18v14H3zM3 17l5-5 4 4 3-3 6 6M15.5 9h.5',
    link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
    line: 'M4 12h16',
    textBox: 'M3 5h18v14H3zM8 9h8M12 9v7',
    rect: 'M4 6h16v12H4z',
    ellipse: 'M12 5.5c4.4 0 8 2.9 8 6.5s-3.6 6.5-8 6.5-8-2.9-8-6.5 3.6-6.5 8-6.5z',
    slideNew: 'M3 5h15v10H3zM19 16v6M16 19h6',
    duplicate: 'M8 8h12v12H8zM4 16V4h12',
    trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
    up: 'M12 19V5M6 11l6-6 6 6',
    down: 'M12 5v14M6 13l6 6 6-6',
    play: 'M7 4l13 8-13 8z',
    playCurrent: 'M3 5h18v11H3zM10 8l5 2.5-5 2.5zM8 20h8',
    sum: 'M17 5H7l6 7-6 7h10',
    eraser: 'M4 20h16M7 16l8-10 5 4-8 10H9z',
    front: 'M10 10h10v10H10zM4 14V4h10',
    back: 'M4 4h10v10H4zM14 10h6v10H10v-6',
    close: 'M6 6l12 12M18 6 6 18',
    save: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6',
    grid: 'M5 5h.5M12 5h.5M19 5h.5M5 12h.5M12 12h.5M19 12h.5M5 19h.5M12 19h.5M19 19h.5',
    arrowLeft: 'M19 12H5M11 6l-6 6 6 6',
    home: 'M4 11l8-7 8 7v9h-5v-6H9v6H4z',
    folder: 'M3 6h6l2 2h10v11H3z',
    fileNew: 'M6 3h8l4 4v14H6zM14 3v4h4',
    export: 'M12 3v12M7 10l5 5 5-5M4 20h16',
    fill: 'M4 4h16v16H4zM4 15h16',
    average: 'M5 19 19 5M12 4.5a7.5 7.5 0 1 0 .1 0z',
    count: 'M5 8h14M5 16h14M9 4 7 20M17 4l-2 16',
    max: 'M4 20h16M7 20V10M12 20V4M17 20v-7',
    min: 'M4 20h16M7 20v-7M12 20v-3M17 20V8',
    branch: 'M6 4v16M6 12h6a6 6 0 0 0 6-6V4M12 12a6 6 0 0 1 6 6v2',
    sortAsc: 'M4 6h4M4 12h7M4 18h10M18 5v14M15 16l3 3 3-3',
    sortDesc: 'M4 6h10M4 12h7M4 18h4M18 5v14M15 16l3 3 3-3',
    filter: 'M4 5h16l-6.5 7.5v5l-3 1.5v-6.5z',
    chart: 'M4 19V5M4 19h17M8 16v-4M13 16V8M18 16V4',
    sparkle: 'M11 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z',
    key: 'M8 11a4 4 0 1 0 .1 0zM11.5 13.5 20 5M17 8l2.5 2.5M14.5 10.5l2 2',
    search: 'M10.5 4a6.5 6.5 0 1 0 .1 0zM15.5 15.5 20 20',
    pageBreak: 'M6 3v6h12V3M6 21v-6h12v6M3 12h2M8 12h2M13 12h2M18 12h3',
    lookup: 'M3 5h18v14H3zM3 10h18M9 5v14M13 14.5h5M16 12.5l2 2-2 2',
    sun: 'M12 7.5a4.5 4.5 0 1 0 .1 0zM12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8',
    moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z'
  };

  MO.icon = function (name) {
    const span = h('span', { class: 'icon' + (name === 'grid' ? ' dots' : ''), 'aria-hidden': 'true' });
    span.innerHTML = `<svg viewBox="0 0 24 24"><path d="${ICONS[name] || ''}"/></svg>`;
    return span;
  };

  MO.iconButton = (icon, title, onClick, text) => MO.toolButton([MO.icon(icon), text], title, onClick, text ? 'wide' : '');

  MO.bigButton = (icon, label, title, onClick) => MO.toolButton([MO.icon(icon), h('span', null, label)], title, onClick, 'big');

  // Controlo de zoom para a barra de estado. onChange recebe o fator (1 = 100%).
  MO.zoomControl = function (onChange) {
    const range = h('input', { type: 'range', min: '50', max: '200', step: '10', value: '100', 'aria-label': 'Zoom' });
    const out = h('output', null, '100%');
    const set = (value) => {
      const pct = Math.max(50, Math.min(200, Math.round(value / 10) * 10));
      range.value = pct;
      out.textContent = pct + '%';
      onChange(pct / 100);
    };
    range.addEventListener('input', () => set(Number(range.value)));
    const step = (delta) => MO.toolButton(delta < 0 ? '−' : '+', delta < 0 ? 'Reduzir' : 'Ampliar', () => set(Number(range.value) + delta));
    const minus = step(-10);
    const plus = step(10);
    minus.className = plus.className = '';
    out.addEventListener('dblclick', () => set(100));
    out.title = 'Duplo clique para repor 100%';
    return h('div', { class: 'zoom' }, minus, range, plus, out);
  };

  // Liga botões do friso a um estado (ativo/inativo). titles: { 'Início do título': chave }.
  // Devolve uma função que recebe (chave) => booleano e atualiza os botões.
  MO.toolStates = function (container, titles) {
    const pairs = [];
    container.querySelectorAll('button.tool').forEach((btn) => {
      for (const [prefix, key] of Object.entries(titles)) if (btn.title.startsWith(prefix)) pairs.push([btn, key]);
    });
    return (isOn) => {
      for (const [btn, key] of pairs) {
        const on = Boolean(isOn(key));
        btn.classList.toggle('on', on);
        btn.setAttribute('aria-pressed', String(on));
      }
    };
  };

  // Friso com separadores. tabs: [{ label, groups: [{ label, rows: [[elementos…], …] }] }]
  MO.ribbon = function (tabs, onFile) {
    const fileTab = h('button', { type: 'button', class: 'ribbon-tab file', onclick: onFile }, 'Ficheiro');
    const tabBar = h('div', { class: 'ribbon-tabs', role: 'tablist' }, fileTab);
    const panels = [];
    const buttons = [];

    function activate(index) {
      panels.forEach((panel, i) => (panel.hidden = i !== index));
      buttons.forEach((btn, i) => {
        btn.classList.toggle('active', i === index);
        btn.setAttribute('aria-selected', String(i === index));
      });
    }

    tabs.forEach((tab, index) => {
      const panel = h(
        'div',
        { class: 'ribbon-panel', role: 'tabpanel', 'aria-label': tab.label },
        tab.groups.map((group) =>
          h(
            'div',
            { class: 'ribbon-group' },
            h('div', { class: 'ribbon-rows' }, group.rows.map((row) => h('div', { class: 'ribbon-row' }, row))),
            h('div', { class: 'ribbon-label' }, group.label)
          )
        )
      );
      const btn = h('button', { type: 'button', class: 'ribbon-tab', role: 'tab' }, tab.label);
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', () => activate(index));
      panels.push(panel);
      buttons.push(btn);
      tabBar.append(btn);
    });
    activate(0);
    return h('div', { class: 'ribbon' }, tabBar, panels);
  };
})();
