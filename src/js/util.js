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
        } else if (name === 'style') {
          keep = !/url\s*\(|expression|@import|behavior|position\s*:/i.test(value);
        }
        if (!keep) n.removeAttribute(attr.name);
      }
    });
    return doc.body.innerHTML;
  };

  // Escolhe um ficheiro através do seletor do sistema. as: 'text' | 'dataURL'
  MO.pickFile = function ({ accept, as = 'text', maxBytes = 64 * 1024 * 1024 }) {
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
        reader.onload = () => resolve({ name: file.name, content: reader.result });
        reader.onerror = () => resolve(null);
        if (as === 'dataURL') reader.readAsDataURL(file);
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

  MO.colorButton = function (label, title, value, onInput, onDone) {
    const input = h('input', { type: 'color', value, title, 'aria-label': title });
    input.addEventListener('input', () => onInput(input.value));
    if (onDone) input.addEventListener('change', () => onDone(input.value));
    return h('label', { class: 'tool color', title }, h('span', null, label), input);
  };

  MO.sep = () => h('span', { class: 'tool-sep' });
})();
