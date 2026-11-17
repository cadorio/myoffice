'use strict';

// Módulo "Texto": editor de documentos.
(function () {
  const MO = window.MO;
  const { h, toolButton, colorButton, iconButton, bigButton } = MO;

  const FONTS = [
    ['Tipo de letra', 'inherit'],
    ['Sans-serif', 'Arial, Helvetica, sans-serif'],
    ['Serif', 'Georgia, "Times New Roman", serif'],
    ['Monoespaçado', '"Courier New", Courier, monospace'],
    ['Verdana', 'Verdana, Geneva, sans-serif'],
    ['Trebuchet', '"Trebuchet MS", Tahoma, sans-serif']
  ];
  const SIZES = [9, 10, 11, 12, 14, 16, 18, 24, 32, 48];
  const BLOCKS = [
    ['Normal', 'p'],
    ['Título 1', 'h1'],
    ['Título 2', 'h2'],
    ['Título 3', 'h3'],
    ['Citação', 'blockquote']
  ];
  const EMPTY = '<p><br></p>';

  // Tema do documento: tipos de letra do texto e dos títulos e cores dos títulos (ver themes.js).
  const T = MO.Themes;
  const PICKER = 'colors-writer';
  let theme = T.LIST[0];
  let themeRow;
  let docHeader = '';
  let docFooter = '';
  // Comentários, notas de rodapé e página: o texto fica aqui; no documento só fica a marca (data-id).
  let docComments = {}; // id -> { text, date }
  let docNotes = {}; // id -> texto
  let docPage = { size: 'A4', orient: 'portrait', margin: 'normal' };
  let tracking = false;
  let commentsBox, notesBox, trackButton;
  const newId = () => Math.random().toString(36).slice(2, 10);
  const PAGE_SIZES = { A4: [210, 297], Letter: [215.9, 279.4], A5: [148, 210] };
  const PAGE_MARGINS = { normal: [25, 20], narrow: [12.7, 12.7], wide: [25.4, 38.1] };

  function showTheme(node) {
    const look = T.docLook(theme);
    node.style.setProperty('--doc-font', look.body);
    node.style.setProperty('--doc-head-font', look.head);
    node.style.setProperty('--doc-head-color', look.color);
    node.style.setProperty('--doc-accent', look.accent);
  }

  function setTheme(next) {
    theme = next;
    showTheme(editor);
    T.markActive(themeRow, theme.id);
    T.setPickerColors(PICKER, theme);
  }

  // Estilos partilhados entre o editor, a impressão e o HTML exportado.
  const DOC_CSS = `
body { font-family: Georgia, "Times New Roman", serif; font-size: 12pt; line-height: 1.5; color: #1c2130; max-width: 170mm; margin: 20mm auto; }
h1 { font-size: 24pt; margin: 0 0 12pt; } h2 { font-size: 18pt; margin: 14pt 0 8pt; } h3 { font-size: 14pt; margin: 12pt 0 6pt; }
p { margin: 0 0 8pt; } blockquote { margin: 8pt 0 8pt 12pt; padding-left: 12pt; border-left: 3px solid #c5cad6; color: #4a5263; }
table { border-collapse: collapse; width: 100%; margin: 8pt 0; } td, th { border: 1px solid #9aa1b1; padding: 4pt 6pt; vertical-align: top; }
img { max-width: 100%; } hr { border: 0; border-top: 1px solid #9aa1b1; margin: 12pt 0; }
hr.page-break { border: 0; margin: 0; break-after: page; }`;

  let ctx, editor, statusEl, savedRange;
  let showStates = () => {};

  const STATE_TITLES = {
    Negrito: 'bold',
    'Itálico': 'italic',
    Sublinhado: 'underline',
    Rasurado: 'strikeThrough',
    'Lista de marcas': 'insertUnorderedList',
    'Lista numerada': 'insertOrderedList',
    'Alinhar à esquerda': 'justifyLeft',
    Centrar: 'justifyCenter',
    'Alinhar à direita': 'justifyRight',
    Justificar: 'justifyFull'
  };

  // Mostra no friso a formatação do texto onde está o cursor.
  function updateStates() {
    const sel = document.getSelection();
    if (!sel.rangeCount || !editor.contains(sel.anchorNode)) return;
    showStates((cmd) => document.queryCommandState(cmd));
  }

  function changed() {
    updateStats();
    ctx.dirty();
  }

  function updateStats() {
    const text = editor.innerText.replace(/ /g, ' ');
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const chars = text.replace(/\n/g, '').length;
    const selection = document.getSelection();
    const selectedText = selection && editor.contains(selection.anchorNode) ? selection.toString().trim() : '';
    const selectedWords = selectedText ? selectedText.split(/\s+/).length : 0;
    const selectedChars = selectedText.replace(/\n/g, '').length;
    const prefix = selectedText ? `${selectedWords} ${selectedWords === 1 ? 'palavra' : 'palavras'} selecionadas · ${selectedChars} ${selectedChars === 1 ? 'carácter' : 'caracteres'} · ` : '';
    const reading = words ? ` · ~${Math.max(1, Math.ceil(words / 200))} min de leitura` : '';
    statusEl.textContent = `${prefix}${words} ${words === 1 ? 'palavra' : 'palavras'} · ${chars} ${chars === 1 ? 'carácter' : 'caracteres'}${reading}`;
  }

  function rememberSelection() {
    const sel = document.getSelection();
    if (sel.rangeCount && editor.contains(sel.anchorNode)) savedRange = sel.getRangeAt(0).cloneRange();
  }

  // Os selects e os seletores de cor tiram o foco ao editor; repõe a última seleção antes de aplicar.
  function restoreSelection() {
    const sel = document.getSelection();
    if (document.activeElement === editor && sel.rangeCount && editor.contains(sel.anchorNode)) return;
    editor.focus();
    if (savedRange) {
      sel.removeAllRanges();
      sel.addRange(savedRange);
    }
  }

  function exec(cmd, value) {
    restoreSelection();
    document.execCommand('styleWithCSS', false, true);
    document.execCommand(cmd, false, value);
    changed();
    updateStates();
  }

  function setFontSize(pt) {
    restoreSelection();
    // O comando fontSize só aceita 1–7: marca com 7 e troca pela medida real.
    document.execCommand('styleWithCSS', false, false);
    document.execCommand('fontSize', false, '7');
    editor.querySelectorAll('font[size="7"]').forEach((font) => {
      const span = h('span', { style: { fontSize: pt + 'pt' } });
      span.append(...font.childNodes);
      font.replaceWith(span);
    });
    changed();
  }

  function insertHTML(html) {
    exec('insertHTML', html);
  }

  async function insertLink() {
    rememberSelection();
    const res = await MO.dialog({
      title: 'Inserir ligação',
      fields: [{ name: 'url', label: 'Endereço', type: 'text', placeholder: 'https://exemplo.pt' }],
      okLabel: 'Inserir'
    });
    if (!res || !res.url.trim()) return;
    let url = res.url.trim();
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = 'https://' + url;
    if (!/^(https?:|mailto:)/i.test(url)) return MO.toast('Só são aceites ligações http, https ou mailto.');
    if (savedRange && !savedRange.collapsed) exec('createLink', url);
    else insertHTML(`<a href="${MO.escapeHTML(url)}">${MO.escapeHTML(url)}</a>`);
  }

  async function insertImage() {
    rememberSelection();
    const src = await MO.pickImage();
    if (!src) return;
    try {
      const officeSrc = await MO.officeImageDataURL(src);
      insertHTML(`<img src="${officeSrc}" alt="">`);
    } catch {
      MO.toast('Não foi possível preparar a imagem para o documento Office.');
    }
  }

  // Gráfico: escolher o tipo e escrever ou colar os dados; entra no documento como imagem.
  async function insertChart() {
    rememberSelection();
    const spec = await MO.Charts.dialog({ title: 'Inserir gráfico', okLabel: 'Inserir', editableData: true, spec: { type: 'column', title: 'Vendas por trimestre', categories: ['T1', 'T2', 'T3', 'T4'], series: [{ name: '2025', values: [120, 150, 170, 160] }, { name: '2026', values: [140, 165, 190, 210] }] } });
    if (!spec) return;
    try {
      const png = await MO.Charts.toPng(MO.Charts.render(spec, { width: 640, height: 380 }));
      insertHTML(`<img src="${png}" alt="${MO.escapeHTML(spec.title || 'Gráfico')}" style="width: 640px">`);
    } catch {
      MO.toast('Não foi possível criar o gráfico.');
    }
  }

  async function insertTable() {
    rememberSelection();
    const res = await MO.dialog({
      title: 'Inserir tabela',
      fields: [
        { name: 'rows', label: 'Linhas', type: 'number', value: 3, min: 1, max: 50 },
        { name: 'cols', label: 'Colunas', type: 'number', value: 3, min: 1, max: 12 }
      ],
      okLabel: 'Inserir'
    });
    if (!res) return;
    const rows = Math.min(50, Math.max(1, parseInt(res.rows, 10) || 1));
    const cols = Math.min(12, Math.max(1, parseInt(res.cols, 10) || 1));
    const row = '<tr>' + '<td><br></td>'.repeat(cols) + '</tr>';
    insertHTML('<table><tbody>' + row.repeat(rows) + '</tbody></table>' + EMPTY);
  }

  async function findReplace() {
    const res = await MO.dialog({
      title: 'Localizar e substituir',
      fields: [
        { name: 'find', label: 'Localizar' },
        { name: 'replace', label: 'Substituir por (deixe vazio para só localizar)' }
      ],
      okLabel: 'Continuar'
    });
    if (!res || !res.find) return;
    if (!res.replace) {
      editor.focus();
      document.getSelection().collapse(editor, 0);
      if (!window.find(res.find, false, false, false)) MO.toast('Não foram encontradas ocorrências.');
      return;
    }
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    const needle = res.find.toLowerCase();
    let count = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.nodeValue;
      let out = '';
      let from = 0;
      for (let at = text.toLowerCase().indexOf(needle); at !== -1; at = text.toLowerCase().indexOf(needle, from)) {
        out += text.slice(from, at) + res.replace;
        from = at + needle.length;
        count++;
      }
      if (from) node.nodeValue = out + text.slice(from);
    }
    if (count) changed();
    MO.toast(count ? `${count} ${count === 1 ? 'substituição feita' : 'substituições feitas'}.` : 'Não foram encontradas ocorrências.');
  }

  async function aiReview() {
    const text = editor.innerText.trim();
    if (!text) return MO.toast('Escreva algum conteúdo antes de pedir uma revisão.');
    if (!window.api?.ai?.assist) return MO.toast('O assistente de IA está disponível na aplicação instalada.');
    MO.toast('A preparar a revisão local…');
    const result = await window.api.ai.assist({ module: 'writer', task: 'review', content: text });
    if (result.error) return MO.toast(result.error);
    await MO.dialog({ title: 'Assistente MyOffice · Revisão', message: result.answer, okLabel: 'Fechar' });
  }

  // ---------- Parágrafo: espaçamentos e avanço ----------

  const BLOCK_SEL = 'p, h1, h2, h3, h4, li, blockquote, td, th';
  // Blocos tocados pela seleção (ou o bloco onde está o cursor).
  function selectedBlocks() {
    restoreSelection();
    const sel = document.getSelection();
    if (!sel.rangeCount || !editor.contains(sel.anchorNode)) return [];
    const range = sel.getRangeAt(0);
    const list = [...editor.querySelectorAll(BLOCK_SEL)].filter((el) => range.intersectsNode(el) && !el.querySelector(BLOCK_SEL.replace(/, td, th$/, '')));
    if (list.length) return list;
    const node = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    const block = node && node.closest(BLOCK_SEL);
    return block && editor.contains(block) ? [block] : [];
  }

  function styleBlocks(prop, value) {
    const blocks = selectedBlocks();
    if (!blocks.length) return MO.toast('Coloque o cursor no parágrafo.');
    for (const b of blocks) b.style[prop] = value;
    changed();
  }

  // ---------- Letra: maiúsculas e minúsculas ----------

  function changeCase(mode) {
    restoreSelection();
    const sel = document.getSelection();
    if (!sel.rangeCount || sel.isCollapsed || !editor.contains(sel.anchorNode)) return MO.toast('Selecione o texto.');
    const range = sel.getRangeAt(0);
    const walker = document.createTreeWalker(range.commonAncestorContainer.nodeType === 3 ? range.commonAncestorContainer.parentNode : range.commonAncestorContainer, NodeFilter.SHOW_TEXT);
    const nodes = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (range.intersectsNode(n)) nodes.push(n);
    let startOfWord = true;
    const conv = (t) => {
      if (mode === 'upper') return t.toLocaleUpperCase('pt-PT');
      if (mode === 'lower') return t.toLocaleLowerCase('pt-PT');
      // Primeira letra de cada palavra em maiúscula.
      let out = '';
      for (const ch of t) {
        out += startOfWord ? ch.toLocaleUpperCase('pt-PT') : ch.toLocaleLowerCase('pt-PT');
        startOfWord = /[\s\-–—(«"]/.test(ch);
      }
      return out;
    };
    for (const n of nodes) {
      const a = n === range.startContainer ? range.startOffset : 0;
      const b = n === range.endContainer ? range.endOffset : n.nodeValue.length;
      n.nodeValue = n.nodeValue.slice(0, a) + conv(n.nodeValue.slice(a, b)) + n.nodeValue.slice(b);
    }
    changed();
  }

  // ---------- Pincel de formatação ----------

  let painter = null;
  let painterButton = null;
  function copyFormat() {
    restoreSelection();
    const sel = document.getSelection();
    if (!sel.rangeCount || !editor.contains(sel.anchorNode)) return MO.toast('Coloque o cursor no texto cujo formato quer copiar.');
    const node = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
    const cs = getComputedStyle(node);
    painter = {
      bold: document.queryCommandState('bold'), italic: document.queryCommandState('italic'), underline: document.queryCommandState('underline'),
      strike: document.queryCommandState('strikeThrough'), sup: document.queryCommandState('superscript'), sub: document.queryCommandState('subscript'),
      color: cs.color, font: cs.fontFamily, size: Math.round(parseFloat(cs.fontSize) * 0.75 * 2) / 2,
      bg: (() => { for (let n = node; n && n !== editor; n = n.parentElement) { const b = getComputedStyle(n).backgroundColor; if (b && !/rgba\(0, 0, 0, 0\)|transparent/.test(b) && n.tagName !== 'TD' && n.tagName !== 'TH') return b; } return null; })()
    };
    painterButton && painterButton.classList.add('on');
    MO.toast('Selecione o texto onde quer aplicar o formato (Esc para cancelar).');
  }
  function applyPainter() {
    const sel = document.getSelection();
    if (!painter || !sel.rangeCount || sel.isCollapsed || !editor.contains(sel.anchorNode)) return;
    const f = painter;
    painter = null;
    painterButton && painterButton.classList.remove('on');
    document.execCommand('styleWithCSS', false, true);
    document.execCommand('removeFormat');
    for (const [on, cmd] of [[f.bold, 'bold'], [f.italic, 'italic'], [f.underline, 'underline'], [f.strike, 'strikeThrough'], [f.sup, 'superscript'], [f.sub, 'subscript']]) if (on) document.execCommand(cmd);
    document.execCommand('foreColor', false, f.color);
    if (f.bg) document.execCommand('hiliteColor', false, f.bg);
    document.execCommand('fontName', false, f.font);
    setFontSize(f.size);
    changed();
  }

  // ---------- Inserir: símbolos e data ----------

  const SYMBOLS = '© ® ™ € £ $ ¥ § ¶ † • · … – — « » “ ” ‘ ’ ° ± × ÷ ≈ ≠ ≤ ≥ ∞ √ ∑ π µ Ω α β γ Δ ½ ¼ ¾ ¹ ² ³ ª º → ← ↑ ↓ ↔ ⇒ ✓ ✗ ★ ☆ ♥ ☎ ✉ ✂ ☐ ☑ ⚠ ℹ ¿ ¡ Ç ç Ã ã Õ õ Á á É é Í í Ó ó Ú ú À à Â â Ê ê Ô ô Ü ü Ñ ñ'.split(' ');
  function symbolDialog() {
    rememberSelection();
    const dlg = h('dialog', { class: 'mo-dialog symbol-dialog' },
      h('form', { method: 'dialog' },
        h('h2', null, 'Inserir símbolo'),
        h('div', { class: 'symbol-grid' }, SYMBOLS.map((ch) => h('button', { type: 'button', class: 'symbol', title: `${ch} (U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')})`, onclick: () => { dlg.close(); exec('insertText', ch); } }, ch))),
        h('div', { class: 'mo-dialog-actions' }, h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Fechar'))));
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
  }
  function insertDate() {
    rememberSelection();
    exec('insertText', new Date().toLocaleDateString('pt-PT', { day: 'numeric', month: 'long', year: 'numeric' }));
  }

  // ---------- Tabelas ----------

  function currentCell() {
    restoreSelection();
    const sel = document.getSelection();
    if (!sel.rangeCount || !editor.contains(sel.anchorNode)) return null;
    const node = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
    const cell = node && node.closest('td, th');
    return cell && editor.contains(cell) ? cell : null;
  }
  function withCell(fn) {
    const cell = currentCell();
    if (!cell) return MO.toast('Coloque o cursor numa célula da tabela.');
    fn(cell, cell.closest('table'));
    changed();
  }
  const emptyCell = (tag = 'td') => h(tag, null, h('br'));
  const addRow = (after) => withCell((cell) => {
    const tr = cell.parentElement;
    const width = [...tr.cells].reduce((n, c) => n + (c.colSpan || 1), 0);
    const row = h('tr', null, Array.from({ length: width }, () => emptyCell()));
    tr.parentElement.insertBefore(row, after ? tr.nextSibling : tr);
  });
  const addCol = (after) => withCell((cell, table) => {
    const index = cell.cellIndex + (after ? 1 : 0);
    for (const tr of table.rows) tr.insertBefore(emptyCell(tr.cells[0] && tr.cells[0].tagName === 'TH' ? 'th' : 'td'), tr.cells[index] || null);
  });
  const deleteRow = () => withCell((cell, table) => {
    cell.parentElement.remove();
    if (!table.rows.length) table.remove();
  });
  const deleteCol = () => withCell((cell, table) => {
    const index = cell.cellIndex;
    for (const tr of [...table.rows]) { const c = tr.cells[index]; if (c) { if (c.colSpan > 1) c.colSpan--; else c.remove(); } }
    if (![...table.rows].some((tr) => tr.cells.length)) table.remove();
  });
  const mergeRight = () => withCell((cell) => {
    const next = cell.nextElementSibling;
    if (!next) return MO.toast('Não há célula à direita.');
    if (next.textContent.trim()) cell.append(' ', ...next.childNodes);
    cell.colSpan = (cell.colSpan || 1) + (next.colSpan || 1);
    next.remove();
  });
  const mergeDown = () => withCell((cell, table) => {
    const rows = [...table.rows];
    const r = rows.indexOf(cell.parentElement) + (cell.rowSpan || 1);
    const below = rows[r] && rows[r].cells[cell.cellIndex];
    if (!below) return MO.toast('Não há célula em baixo.');
    if (below.textContent.trim()) cell.append(h('br'), ...below.childNodes);
    cell.rowSpan = (cell.rowSpan || 1) + (below.rowSpan || 1);
    below.remove();
  });
  const splitCell = () => withCell((cell, table) => {
    if ((cell.colSpan || 1) > 1) { cell.colSpan -= 1; cell.after(emptyCell(cell.tagName.toLowerCase())); return; }
    if ((cell.rowSpan || 1) > 1) {
      const rows = [...table.rows];
      const r = rows.indexOf(cell.parentElement) + cell.rowSpan - 1;
      cell.rowSpan -= 1;
      const target = rows[r];
      if (target) target.insertBefore(emptyCell(), target.cells[cell.cellIndex] || null);
      return;
    }
    MO.toast('Esta célula não está unida a outras.');
  });
  // A primeira linha passa a cabeçalho (repete-se em cada página no Word) ou volta a ser normal.
  const toggleHeader = () => withCell((cell, table) => {
    const first = table.rows[0];
    const toTh = !first.cells[0] || first.cells[0].tagName !== 'TH';
    for (const c of [...first.cells]) {
      const n = h(toTh ? 'th' : 'td');
      for (const a of ['colspan', 'rowspan', 'style']) if (c.hasAttribute(a)) n.setAttribute(a, c.getAttribute(a));
      n.append(...c.childNodes);
      c.replaceWith(n);
    }
  });
  function shadeCells(color) {
    restoreSelection();
    const sel = document.getSelection();
    const range = sel.rangeCount ? sel.getRangeAt(0) : null;
    const cells = range ? [...editor.querySelectorAll('td, th')].filter((c) => range.intersectsNode(c)) : [];
    const one = currentCell();
    const list = cells.length ? cells : one ? [one] : [];
    if (!list.length) return MO.toast('Coloque o cursor numa célula da tabela.');
    for (const c of list) c.style.backgroundColor = color || '';
    changed();
  }

  // ---------- Imagens: tamanho, alinhamento e texto à volta ----------

  let imageBar = null;
  let activeImage = null;
  function hideImageBar() { if (imageBar) imageBar.hidden = true; if (activeImage) activeImage.classList.remove('img-selected'); activeImage = null; }
  function showImageBar(img) {
    if (activeImage && activeImage !== img) activeImage.classList.remove('img-selected');
    activeImage = img;
    img.classList.add('img-selected');
    const set = (fn) => () => { if (!activeImage) return; fn(activeImage); changed(); placeImageBar(); };
    const block = (img2) => img2.closest('p, li, td, th, h1, h2, h3, div') || img2.parentElement;
    if (!imageBar) {
      imageBar = h('div', { class: 'image-bar', role: 'toolbar', 'aria-label': 'Imagem' },
        h('span', null, 'Tamanho'),
        ...[25, 50, 75, 100].map((p) => h('button', { type: 'button', title: `${p}% da largura`, onclick: set((im) => { im.style.width = p + '%'; im.style.height = 'auto'; }) }, p + '%')),
        h('span', null, 'Posição'),
        h('button', { type: 'button', title: 'Em linha, à esquerda', onclick: set((im) => { im.style.float = ''; im.style.margin = ''; block(im).style.textAlign = 'left'; }) }, 'Esquerda'),
        h('button', { type: 'button', title: 'Em linha, ao centro', onclick: set((im) => { im.style.float = ''; im.style.margin = ''; block(im).style.textAlign = 'center'; }) }, 'Centro'),
        h('button', { type: 'button', title: 'Em linha, à direita', onclick: set((im) => { im.style.float = ''; im.style.margin = ''; block(im).style.textAlign = 'right'; }) }, 'Direita'),
        h('span', null, 'Texto à volta'),
        h('button', { type: 'button', title: 'Imagem à esquerda, texto à direita', onclick: set((im) => { im.style.float = 'left'; im.style.marginRight = '12px'; im.style.marginLeft = '0'; im.style.marginBottom = '6px'; }) }, '◧'),
        h('button', { type: 'button', title: 'Imagem à direita, texto à esquerda', onclick: set((im) => { im.style.float = 'right'; im.style.marginLeft = '12px'; im.style.marginRight = '0'; im.style.marginBottom = '6px'; }) }, '◨'),
        h('button', { type: 'button', class: 'danger', title: 'Eliminar imagem', onclick: () => { if (activeImage) { activeImage.remove(); hideImageBar(); changed(); } } }, '×'));
      imageBar.addEventListener('mousedown', (e) => e.preventDefault());
      editor.parentElement.append(imageBar);
    }
    imageBar.hidden = false;
    placeImageBar();
  }
  function placeImageBar() {
    if (!activeImage || !imageBar) return;
    const host = editor.parentElement;
    const r = activeImage.getBoundingClientRect();
    const hr = host.getBoundingClientRect();
    imageBar.style.left = Math.max(4, r.left - hr.left + host.scrollLeft) + 'px';
    imageBar.style.top = Math.max(4, r.top - hr.top + host.scrollTop - 44) + 'px';
  }

  // ---------- Colunas de texto ----------

  function setColumns(n) {
    docPage = { ...docPage, columns: n };
    applyPage();
    ctx.dirty();
  }

  // ---------- Mala direta (cartas em série) ----------

  let mergeData = null; // { fields, records }
  let mergeFieldSelect = null;
  async function chooseMergeList() {
    const picked = await MO.pickFile({ accept: '.csv,.xlsx', binaryExt: ['xlsx'] });
    if (!picked) return;
    let rows = [];
    try {
      if (/\.xlsx$/i.test(picked.name)) {
        const sheet = MO.OOXML.importXlsx(picked.content, 100000, 256).sheets[0];
        const values = MO.Formula.compute(sheet.cells, 100000, 256);
        for (const a of Object.keys(sheet.cells)) { const p = MO.Formula.parseAddr(a); if (p) (rows[p.r] ||= [])[p.c] = MO.Formula.format(values.get(a)); }
        rows = rows.filter(Boolean).map((r) => Array.from(r, (v) => v ?? ''));
      } else {
        const text = String(picked.content);
        const sep = ((text.split('\n')[0] || '').match(/;/g) || []).length ? ';' : ',';
        rows = text.split(/\r?\n/).filter((l) => l.trim()).map((l) => l.split(sep).map((v) => v.replace(/^"|"$/g, '').trim()));
      }
    } catch {
      return MO.toast('Não foi possível ler a lista.');
    }
    if (rows.length < 2) return MO.toast('A lista precisa de uma linha de cabeçalhos e pelo menos um registo.');
    const fields = rows[0].map((f, i) => String(f || `Campo ${i + 1}`).trim().slice(0, 60));
    mergeData = { fields, records: rows.slice(1, 1001) };
    mergeFieldSelect.replaceChildren(h('option', { value: '' }, 'Inserir campo…'), ...fields.map((f) => h('option', { value: f }, f)));
    MO.toast(`Lista com ${mergeData.records.length} registo(s) e ${fields.length} campo(s). Insira os campos no texto.`);
  }
  function insertMergeField(name) {
    if (!name) return;
    exec('insertText', `«${name}»`);
  }
  async function finishMerge() {
    if (!mergeData) return MO.toast('Escolha primeiro a lista (Correspondência › Escolher lista).');
    const template = editor.innerHTML;
    if (!/«[^«»]+»/.test(editor.textContent)) return MO.toast('O documento ainda não tem campos «…». Use Inserir campo.');
    if (!(await MO.dialog({ title: 'Concluir a mala direta', message: `Vai ser criado um documento com ${mergeData.records.length} cópia(s), uma por registo, separadas por quebras de página. O documento atual é substituído (guarde-o antes se quiser manter o modelo).`, okLabel: 'Criar documento', cancelLabel: 'Cancelar' }))) return;
    // Comentários e notas de rodapé não são repetidos nas cópias.
    const clean = template.replace(/<sup class="mo-fn"[^>]*>.*?<\/sup>/g, '').replace(/<mark class="mo-comment"[^>]*>(.*?)<\/mark>/g, '$1');
    const pages = mergeData.records.map((rec) => clean.replace(/«([^«»<>]{1,60})»/g, (m, name) => {
      const i = mergeData.fields.indexOf(name.trim());
      return i < 0 ? m : MO.escapeHTML(String(rec[i] ?? ''));
    }));
    editor.innerHTML = MO.sanitizeHTML(pages.join('<hr class="page-break">'));
    docComments = {};
    docNotes = {};
    renderComments();
    renderNotes();
    changed();
    MO.toast(`Documento criado com ${pages.length} cópia(s).`);
  }

  function select(options, title, onChange, resetAfter) {
    const el = h(
      'select',
      { class: 'tool-select', title, 'aria-label': title },
      options.map(([label, value]) => h('option', { value }, label))
    );
    el.addEventListener('change', () => {
      onChange(el.value);
      if (resetAfter) el.selectedIndex = 0;
    });
    return el;
  }

  function styleChip(label, tag) {
    const btn = toolButton(label, 'Estilo: ' + label, () => exec('formatBlock', tag), 'style-chip style-' + tag);
    return btn;
  }

  function buildRibbon() {
    themeRow = h('div', { class: 'theme-gallery' }, T.gallery((t) => {
      setTheme(t);
      changed();
    }));
    return MO.ribbon(
      [
        {
          label: 'Base',
          groups: [
            {
              label: 'Anular',
              rows: [[iconButton('undo', 'Anular (Ctrl+Z)', () => exec('undo'))], [iconButton('redo', 'Refazer (Ctrl+Y)', () => exec('redo'))]]
            },
            {
              label: 'Tipo de letra',
              rows: [
                [
                  select(FONTS, 'Tipo de letra', (v) => exec('fontName', v)),
                  select([['Tamanho', ''], ...SIZES.map((s) => [String(s), String(s)])], 'Tamanho da letra', (v) => v && setFontSize(v), true)
                ],
                [
                  toolButton('N', 'Negrito (Ctrl+B)', () => exec('bold'), 'bold'),
                  toolButton('I', 'Itálico (Ctrl+I)', () => exec('italic'), 'italic'),
                  toolButton('S', 'Sublinhado (Ctrl+U)', () => exec('underline'), 'underline'),
                  toolButton('abc', 'Rasurado', () => exec('strikeThrough'), 'strike'),
                  colorButton('A', 'Cor do texto', '#c62828', (v) => exec('foreColor', v), null, PICKER),
                  colorButton('ab', 'Cor de realce', '#fff3a3', (v) => exec('hiliteColor', v), null, PICKER),
                  iconButton('eraser', 'Limpar formatação', () => exec('removeFormat'))
                ],
                [
                  toolButton(['x', h('sup', null, '2')], 'Expoente (Ctrl+Shift++)', () => exec('superscript'), 'sup'),
                  toolButton(['x', h('sub', null, '2')], 'Índice (Ctrl+=)', () => exec('subscript'), 'sub'),
                  select([['Aa', ''], ['MAIÚSCULAS', 'upper'], ['minúsculas', 'lower'], ['Primeira Letra Maiúscula', 'title']], 'Maiúsculas e minúsculas', (v) => v && changeCase(v), true),
                  (painterButton = toolButton('🖌', 'Pincel de formatação: copiar o formato e aplicá-lo a outro texto', copyFormat, 'painter'))
                ]
              ]
            },
            {
              label: 'Parágrafo',
              rows: [
                [
                  iconButton('bullets', 'Lista de marcas', () => exec('insertUnorderedList')),
                  iconButton('numbers', 'Lista numerada', () => exec('insertOrderedList')),
                  iconButton('outdent', 'Diminuir avanço', () => exec('outdent')),
                  iconButton('indent', 'Aumentar avanço', () => exec('indent'))
                ],
                [
                  iconButton('alignLeft', 'Alinhar à esquerda', () => exec('justifyLeft')),
                  iconButton('alignCenter', 'Centrar', () => exec('justifyCenter')),
                  iconButton('alignRight', 'Alinhar à direita', () => exec('justifyRight')),
                  iconButton('justify', 'Justificar', () => exec('justifyFull'))
                ],
                [
                  select([['Entre linhas', ''], ['1,0', '1'], ['1,15', '1.15'], ['1,5', '1.5'], ['2,0', '2'], ['3,0', '3']], 'Espaçamento entre linhas', (v) => v && styleBlocks('lineHeight', v), true),
                  select([['Espaço depois', ''], ['0 pt', '0pt'], ['6 pt', '6pt'], ['12 pt', '12pt'], ['18 pt', '18pt']], 'Espaço depois do parágrafo', (v) => v && styleBlocks('marginBottom', v), true),
                  select([['Espaço antes', ''], ['0 pt', '0pt'], ['6 pt', '6pt'], ['12 pt', '12pt'], ['18 pt', '18pt']], 'Espaço antes do parágrafo', (v) => v && styleBlocks('marginTop', v), true),
                  toolButton('↦', 'Avanço da primeira linha (liga/desliga)', () => { const b = selectedBlocks(); const on = b.length && !b[0].style.textIndent; styleBlocks('textIndent', on ? '1.25cm' : ''); }, 'firstline')
                ]
              ]
            },
            {
              label: 'Estilos',
              rows: [BLOCKS.map(([label, tag]) => styleChip(label, tag))]
            },
            {
              label: 'Edição',
              rows: [[bigButton('search', 'Localizar', 'Localizar e substituir', findReplace), bigButton('sparkle', 'Rever com IA', 'Extrair frases relevantes e assinalar padrões com o motor próprio do MyOffice', aiReview)]]
            }
          ]
        },
        {
          label: 'Estrutura',
          groups: [
            { label: 'Temas do documento', rows: [themeRow] },
            { label: 'Página', rows: [[bigButton('pageSetup', 'Configurar página', 'Tamanho do papel, orientação e margens', pageDialog), bigButton('pageBreak', 'Cabeçalho e rodapé', 'Definir texto repetido e numeração de páginas', editPageParts)], [select([['Colunas', ''], ['Uma coluna', '1'], ['Duas colunas', '2'], ['Três colunas', '3']], 'Colunas de texto', (v) => v && setColumns(Number(v)), true)]] }
          ]
        },
        reviewTab(),
        {
          label: 'Correspondência',
          groups: [
            { label: 'Mala direta (cartas em série)', rows: [
              [bigButton('folder', 'Escolher lista', 'Escolher a lista de destinatários (Excel ou CSV, com cabeçalhos na 1.ª linha)', chooseMergeList)],
              [(mergeFieldSelect = h('select', { class: 'tool-select', title: 'Inserir campo', 'aria-label': 'Inserir campo da lista', onchange: (e) => { insertMergeField(e.target.value); e.target.value = ''; } }, h('option', { value: '' }, 'Inserir campo…')))],
              [bigButton('accept', 'Concluir e juntar', 'Criar um documento com uma cópia por registo da lista', finishMerge)]
            ] }
          ]
        },
        {
          label: 'Inserir',
          groups: [
            { label: 'Tabelas', rows: [[bigButton('table', 'Tabela', 'Inserir tabela', insertTable)]] },
            {
              label: 'Tabela (com o cursor numa célula)',
              rows: [
                [iconButton('rowAdd', 'Inserir linha abaixo', () => addRow(true)), iconButton('rowAdd', 'Inserir linha acima', () => addRow(false)), iconButton('colAdd', 'Inserir coluna à direita', () => addCol(true)), iconButton('colAdd', 'Inserir coluna à esquerda', () => addCol(false))],
                [iconButton('rowDel', 'Eliminar linha', deleteRow), iconButton('colDel', 'Eliminar coluna', deleteCol), iconButton('merge', 'Unir com a célula à direita', mergeRight), iconButton('merge', 'Unir com a célula de baixo', mergeDown), iconButton('unmerge', 'Separar células', splitCell)],
                [toolButton('Cabeçalho', 'Primeira linha como cabeçalho (repete-se em cada página no Word)', toggleHeader, 'wide'), colorButton('▦', 'Cor de fundo das células', '#e8f0fb', (v) => shadeCells(v), null, PICKER), toolButton('Sem cor', 'Tirar a cor de fundo das células', () => shadeCells(''), 'wide')]
              ]
            },
            { label: 'Ilustrações', rows: [[bigButton('image', 'Imagem', 'Inserir imagem', insertImage)], [bigButton('chart', 'Gráfico', 'Inserir um gráfico (colunas, barras, linhas, circular…)', insertChart)]] },
            { label: 'Ligações', rows: [[bigButton('link', 'Ligação', 'Inserir ligação', insertLink)]] },
            {
              label: 'Referências',
              rows: [[
                bigButton('toc', 'Índice', 'Inserir ou atualizar o índice a partir dos títulos', insertToc),
                bigButton('footnote', 'Nota de rodapé', 'Inserir nota de rodapé no cursor', addFootnote)
              ]]
            },
            {
              label: 'Elementos',
              rows: [
                [
                  bigButton('line', 'Linha', 'Linha horizontal', () => insertHTML('<hr>' + EMPTY)),
                  bigButton('pageBreak', 'Quebra de página', 'Inserir quebra de página', () => insertHTML('<hr class="page-break">' + EMPTY))
                ],
                [
                  bigButton('sparkle', 'Símbolo', 'Inserir símbolo ou carácter especial (©, €, →, ✓…)', symbolDialog),
                  bigButton('pageSetup', 'Data', 'Inserir a data de hoje', insertDate)
                ]
              ]
            }
          ]
        }
      ],
      () => ctx.file()
    );
  }

  function reviewTab() {
    commentsBox = h('div', { class: 'comments-box' });
    trackButton = bigButton('track', 'Controlar alterações', 'Ligar ou desligar o controlo de alterações', () => setTracking(!tracking));
    return {
      label: 'Rever',
      groups: [
        { label: 'Comentários', rows: [[bigButton('comment', 'Novo comentário', 'Comentar o texto selecionado', addComment)], [commentsBox]] },
        {
          label: 'Controlar alterações',
          rows: [[
            trackButton,
            bigButton('accept', 'Aceitar todas', 'Aceitar todas as alterações controladas', () => resolveChanges(true)),
            bigButton('reject', 'Rejeitar todas', 'Rejeitar todas as alterações controladas', () => resolveChanges(false))
          ]]
        }
      ]
    };
  }

  // ---------- Comentários ----------

  async function addComment() {
    restoreSelection();
    const sel = document.getSelection();
    if (!sel.rangeCount || sel.isCollapsed || !editor.contains(sel.anchorNode)) return MO.toast('Selecione o texto a comentar.');
    const range = sel.getRangeAt(0).cloneRange();
    const res = await MO.dialog({ title: 'Novo comentário', fields: [{ name: 'text', label: 'Comentário', placeholder: 'Escreva o comentário' }], okLabel: 'Comentar' });
    if (!res || !res.text.trim()) return;
    const id = newId();
    docComments[id] = { text: res.text.trim().slice(0, 2000), date: new Date().toISOString() };
    const mark = h('mark', { class: 'mo-comment', 'data-id': id });
    try {
      range.surroundContents(mark);
    } catch {
      // A seleção atravessa vários parágrafos: marca-se o texto, sem a formatação interior.
      mark.textContent = range.toString();
      range.deleteContents();
      range.insertNode(mark);
    }
    changed();
    renderComments();
  }

  function resolveComment(id) {
    editor.querySelectorAll(`mark.mo-comment[data-id="${id}"]`).forEach((m) => m.replaceWith(...m.childNodes));
    delete docComments[id];
    changed();
    renderComments();
  }

  function renderComments() {
    if (!commentsBox) return;
    const marks = [...editor.querySelectorAll('mark.mo-comment[data-id]')];
    const seen = new Set();
    const items = [];
    for (const m of marks) {
      const id = m.dataset.id;
      if (seen.has(id) || !docComments[id]) continue;
      seen.add(id);
      const c = docComments[id];
      const quote = m.textContent.trim().slice(0, 60);
      items.push(h('div', { class: 'comment-card' },
        h('q', null, quote),
        h('p', null, c.text),
        h('div', { class: 'comment-actions' },
          h('button', { type: 'button', class: 'btn', onclick: () => { m.scrollIntoView({ block: 'center', behavior: 'smooth' }); m.classList.add('flash'); setTimeout(() => m.classList.remove('flash'), 1200); } }, 'Ver'),
          h('button', { type: 'button', class: 'btn', onclick: () => resolveComment(id) }, 'Resolver'))));
    }
    // Comentários cujo texto foi apagado deixam de existir.
    for (const id of Object.keys(docComments)) if (!seen.has(id)) delete docComments[id];
    commentsBox.replaceChildren(...(items.length ? items : [h('p', { class: 'comments-empty' }, 'Sem comentários. Selecione texto e use «Novo comentário».')]));
  }

  // ---------- Controlar alterações ----------
  // Com o controlo ligado, o texto escrito fica marcado como inserido e o apagado fica riscado,
  // até alguém aceitar ou rejeitar as alterações.

  function setTracking(on) {
    tracking = on;
    if (trackButton) {
      trackButton.classList.toggle('on', on);
      trackButton.setAttribute('aria-pressed', String(on));
    }
    MO.toast(on ? 'Controlo de alterações ligado.' : 'Controlo de alterações desligado.');
  }

  const closestIn = (node, selector) => {
    const el = node && (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement);
    const found = el && el.closest(selector);
    return found && editor.contains(found) ? found : null;
  };

  function placeCaret(node, after) {
    const sel = document.getSelection();
    const r = document.createRange();
    if (after) r.setStartAfter(node);
    else r.setStartBefore(node);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
  }

  function trackedInsert(text) {
    const sel = document.getSelection();
    if (!sel.rangeCount) return;
    let range = sel.getRangeAt(0);
    if (!range.collapsed) {
      trackedDelete(range.cloneRange(), true);
      range = sel.getRangeAt(0);
    }
    const inside = closestIn(range.startContainer, 'ins.mo-ins');
    const node = document.createTextNode(text);
    if (inside) range.insertNode(node);
    else range.insertNode(h('ins', { class: 'mo-ins' }, node));
    placeCaret(node, true);
  }

  function trackedDelete(range, caretAfter) {
    // Texto que já era uma inserção controlada é apagado de verdade.
    if (closestIn(range.commonAncestorContainer, 'ins.mo-ins')) {
      range.deleteContents();
      return;
    }
    const content = range.extractContents();
    content.querySelectorAll('ins.mo-ins').forEach((n) => n.remove());
    content.querySelectorAll('del.mo-del').forEach((n) => n.replaceWith(...n.childNodes));
    if (!content.textContent) return;
    const del = h('del', { class: 'mo-del' });
    del.append(content);
    range.insertNode(del);
    placeCaret(del, Boolean(caretAfter));
  }

  function onBeforeInput(e) {
    if (!tracking) return;
    const sel = document.getSelection();
    if (!sel.rangeCount) return;
    if (e.inputType === 'insertText' || e.inputType === 'insertReplacementText') {
      e.preventDefault();
      trackedInsert(e.data || (e.dataTransfer && e.dataTransfer.getData('text/plain')) || '');
      changed();
    } else if (/^delete/.test(e.inputType)) {
      e.preventDefault();
      const forward = /Forward/.test(e.inputType);
      if (sel.isCollapsed) {
        sel.modify('extend', forward ? 'forward' : 'backward', /Word/.test(e.inputType) ? 'word' : 'character');
        if (sel.isCollapsed) return;
      }
      trackedDelete(sel.getRangeAt(0).cloneRange(), forward);
      changed();
    }
  }

  function resolveChanges(accept) {
    const ins = editor.querySelectorAll('ins.mo-ins');
    const del = editor.querySelectorAll('del.mo-del');
    if (!ins.length && !del.length) return MO.toast('Não há alterações por rever.');
    ins.forEach((n) => (accept ? n.replaceWith(...n.childNodes) : n.remove()));
    del.forEach((n) => (accept ? n.remove() : n.replaceWith(...n.childNodes)));
    editor.normalize();
    changed();
    MO.toast(accept ? 'Alterações aceites.' : 'Alterações rejeitadas.');
  }

  // ---------- Notas de rodapé ----------

  async function addFootnote() {
    restoreSelection();
    const sel = document.getSelection();
    if (!sel.rangeCount || !editor.contains(sel.anchorNode)) return MO.toast('Coloque o cursor onde quer a nota.');
    const range = sel.getRangeAt(0).cloneRange();
    const res = await MO.dialog({ title: 'Nova nota de rodapé', fields: [{ name: 'text', label: 'Texto da nota', placeholder: 'Ex.: Fonte: INE, 2025.' }], okLabel: 'Inserir' });
    if (!res || !res.text.trim()) return;
    const id = newId();
    docNotes[id] = res.text.trim().slice(0, 2000);
    range.collapse(false);
    range.insertNode(h('sup', { class: 'mo-fn', 'data-id': id }, '0'));
    changed();
    renderNotes();
  }

  function renderNotes() {
    if (!notesBox) return;
    const marks = [...editor.querySelectorAll('sup.mo-fn[data-id]')];
    const used = new Set();
    const items = [];
    marks.forEach((m) => {
      const id = m.dataset.id;
      if (docNotes[id] == null || used.has(id)) { m.remove(); return; }
      used.add(id);
      const n = items.length + 1;
      if (m.textContent !== String(n)) m.textContent = String(n);
      m.contentEditable = 'false';
      items.push(h('li', null, h('button', { type: 'button', class: 'note-text', title: 'Editar a nota', onclick: () => editNote(id) }, docNotes[id])));
    });
    for (const id of Object.keys(docNotes)) if (!used.has(id)) delete docNotes[id];
    notesBox.hidden = !items.length;
    notesBox.replaceChildren(h('h4', null, 'Notas'), h('ol', null, items));
  }

  async function editNote(id) {
    const res = await MO.dialog({ title: 'Editar nota de rodapé', fields: [{ name: 'text', label: 'Texto da nota (vazio para apagar)', value: docNotes[id] }], okLabel: 'Guardar' });
    if (!res) return;
    if (res.text.trim()) docNotes[id] = res.text.trim().slice(0, 2000);
    else delete docNotes[id];
    changed();
    renderNotes();
  }

  // ---------- Índice automático ----------

  function tocHTML() {
    const heads = [...editor.querySelectorAll('h1, h2, h3')].filter((el) => !el.closest('.mo-toc') && el.textContent.trim());
    if (!heads.length) return null;
    return '<p class="mo-toc-title">Índice</p>' + heads.map((el) => `<p class="mo-toc-${el.tagName[1]}">${MO.escapeHTML(el.textContent.trim())}</p>`).join('');
  }

  function insertToc() {
    const html = tocHTML();
    if (!html) return MO.toast('Use estilos de Título 1, 2 ou 3 no documento para criar o índice.');
    const existing = editor.querySelector('.mo-toc');
    if (existing) {
      existing.innerHTML = html;
      MO.toast('Índice atualizado.');
    } else {
      insertHTML(`<div class="mo-toc">${html}</div>${EMPTY}`);
    }
    lockToc();
    changed();
  }

  function lockToc() {
    editor.querySelectorAll('.mo-toc').forEach((el) => (el.contentEditable = 'false'));
  }

  // ---------- Configurar página ----------

  function applyPage() {
    const [w, hgt] = PAGE_SIZES[docPage.size] || PAGE_SIZES.A4;
    const [mv, mh] = PAGE_MARGINS[docPage.margin] || PAGE_MARGINS.normal;
    const landscape = docPage.orient === 'landscape';
    editor.style.width = (landscape ? hgt : w) + 'mm';
    editor.style.minHeight = (landscape ? w : hgt) + 'mm';
    editor.style.padding = `${mv}mm ${mh}mm`;
    editor.style.columnCount = docPage.columns > 1 ? String(docPage.columns) : '';
    editor.style.columnGap = docPage.columns > 1 ? '10mm' : '';
    if (notesBox) notesBox.style.width = editor.style.width;
  }

  function pageDialog() {
    const select = (id, label, options, value) => {
      const el = h('select', { id }, options.map(([v, text]) => h('option', { value: v, selected: v === value }, text)));
      return [el, h('label', null, h('span', null, label), el)];
    };
    const [size, sizeLabel] = select('page-size', 'Tamanho do papel', [['A4', 'A4 (210 × 297 mm)'], ['Letter', 'Carta (216 × 279 mm)'], ['A5', 'A5 (148 × 210 mm)']], docPage.size);
    const [orient, orientLabel] = select('page-orient', 'Orientação', [['portrait', 'Vertical'], ['landscape', 'Horizontal']], docPage.orient);
    const [margin, marginLabel] = select('page-margin', 'Margens', [['normal', 'Normais (2,5 × 2 cm)'], ['narrow', 'Estreitas (1,27 cm)'], ['wide', 'Largas (2,54 × 3,81 cm)']], docPage.margin);
    const dlg = h('dialog', { class: 'mo-dialog' }, h('form', { method: 'dialog' },
      h('h2', null, 'Configurar página'),
      h('p', null, 'Aplica-se ao ecrã, à impressão, ao PDF e ao Word.'),
      sizeLabel, orientLabel, marginLabel,
      h('div', { class: 'dialog-actions' }, h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Cancelar'), h('button', { type: 'submit', class: 'btn primary' }, 'Aplicar'))));
    dlg.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      docPage = { size: size.value, orient: orient.value, margin: margin.value, columns: docPage.columns || 1 };
      applyPage();
      ctx.dirty();
      dlg.close();
    });
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
  }

  function cleanPage(input) {
    const p = input && typeof input === 'object' ? input : {};
    return {
      size: Object.hasOwn(PAGE_SIZES, p.size) ? p.size : 'A4',
      orient: p.orient === 'landscape' ? 'landscape' : 'portrait',
      margin: Object.hasOwn(PAGE_MARGINS, p.margin) ? p.margin : 'normal',
      columns: [2, 3].includes(p.columns) ? p.columns : 1
    };
  }

  function cleanTextMap(input, kind) {
    const out = {};
    for (const [id, value] of Object.entries(input && typeof input === 'object' ? input : {}).slice(0, 2000)) {
      if (!/^[a-z0-9]{1,24}$/.test(id)) continue;
      const text = typeof value === 'string' ? value : value && typeof value.text === 'string' ? value.text : null;
      if (text == null) continue;
      out[id] = kind === 'comment' ? { text: text.slice(0, 2000), date: value && typeof value.date === 'string' && !Number.isNaN(Date.parse(value.date)) ? value.date : new Date().toISOString() } : text.slice(0, 2000);
    }
    return out;
  }

  async function editPageParts() {
    const result = await MO.dialog({
      title: 'Cabeçalho e rodapé',
      message: 'O texto aparece em todas as páginas exportadas para PDF e Word.',
      fields: [
        { name: 'header', label: 'Cabeçalho', value: docHeader, placeholder: 'Ex.: nome da organização' },
        { name: 'footer', label: 'Rodapé', value: docFooter, placeholder: 'Ex.: confidencial · 2026' }
      ],
      okLabel: 'Aplicar'
    });
    if (!result) return;
    docHeader = result.header.slice(0, 180);
    docFooter = result.footer.slice(0, 180);
    ctx.dirty();
    MO.toast('Cabeçalho e rodapé atualizados.');
  }

  function standaloneHTML(title) {
    const look = T.docLook(theme);
    return (
      '<!DOCTYPE html>\n<html lang="pt">\n<head>\n<meta charset="utf-8">\n' +
      `<title>${MO.escapeHTML(title)}</title>\n<style>${DOC_CSS}\nbody { font-family: ${look.body}; }\nh1, h2, h3 { font-family: ${look.head}; color: ${look.color}; }\nblockquote { border-left-color: ${look.accent}; }\n.page-header,.page-footer { color:#667085; font:9pt Arial,sans-serif; border-bottom:1px solid #d0d5dd; padding:6pt 0; }\n.page-footer { border-top:1px solid #d0d5dd; border-bottom:0; margin-top:20pt; }\n</style>\n</head>\n<body>\n${docHeader ? `<header class="page-header">${MO.escapeHTML(docHeader)}</header>` : ''}\n${editor.innerHTML}\n${docFooter ? `<footer class="page-footer">${MO.escapeHTML(docFooter)}</footer>` : ''}\n</body>\n</html>\n`
    );
  }

  MO.modules.writer = {
    id: 'writer',
    label: 'Texto',
    ext: 'modoc',
    filterName: 'Documento MyOffice',
    defaultName: 'Documento',

    init(container, context) {
      ctx = context;
      editor = h('div', { class: 'page', contenteditable: 'true', spellcheck: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Documento' });
      editor.lang = 'pt-PT';
      statusEl = h('span', { class: 'status-text' });
      const ribbon = buildRibbon();
      const bar = h('div', { class: 'statusbar' }, statusEl, MO.zoomControl((k) => (editor.style.zoom = k)));
      notesBox = h('aside', { class: 'page-notes', hidden: true, 'aria-label': 'Notas de rodapé' });
      container.append(ribbon, h('div', { class: 'page-scroll' }, editor, notesBox), bar);
      editor.addEventListener('beforeinput', onBeforeInput);
      // Comentários e notas atualizam-se depois de cada alteração (no máximo uma vez por fotograma).
      let refreshFrame = 0;
      editor.addEventListener('input', () => {
        if (refreshFrame) return;
        refreshFrame = requestAnimationFrame(() => { refreshFrame = 0; renderComments(); renderNotes(); });
      });
      showStates = MO.toolStates(ribbon, STATE_TITLES);
      document.addEventListener('selectionchange', updateStates);

      editor.addEventListener('input', changed);
      document.addEventListener('selectionchange', rememberSelection);
      document.addEventListener('selectionchange', updateStats);

      // Pincel de formatação: aplica ao largar o rato sobre o texto selecionado.
      editor.addEventListener('mouseup', () => { if (painter) setTimeout(applyPainter, 0); });
      // Imagens: clicar mostra a barra de tamanho e posição.
      editor.addEventListener('click', (e) => { if (e.target.tagName === 'IMG') showImageBar(e.target); else hideImageBar(); });
      editor.parentElement.addEventListener('scroll', () => placeImageBar(), { passive: true });
      editor.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && painter) { painter = null; painterButton && painterButton.classList.remove('on'); }
        if (activeImage && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); activeImage.remove(); hideImageBar(); changed(); return; }
        if (activeImage) hideImageBar();
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === '+' || e.key === '=')) { e.preventDefault(); exec('superscript'); return; }
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === '=') { e.preventDefault(); exec('subscript'); return; }
        if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          const inList = document.queryCommandState('insertUnorderedList') || document.queryCommandState('insertOrderedList');
          if (inList) exec(e.shiftKey ? 'outdent' : 'indent');
          else if (!e.shiftKey) exec('insertText', '\t');
        }
      });

      // Cola sempre conteúdo limpo.
      editor.addEventListener('paste', (e) => {
        const data = e.clipboardData;
        if (!data) return;
        const html = data.getData('text/html');
        const text = data.getData('text/plain');
        if (!html && !text) return;
        e.preventDefault();
        if (html) insertHTML(MO.sanitizeHTML(html));
        else exec('insertText', text);
      });
    },

    newDoc(template) {
      setTheme(T.LIST[0]);
      docHeader = ''; docFooter = '';
      docComments = {}; docNotes = {}; docPage = cleanPage(null); tracking = false;
      const templates = {
        report: '<h1>Relatório de projeto</h1><p><strong>Responsável:</strong> [Nome]</p><p><strong>Data:</strong> [Data]</p><h2>1. Resumo executivo</h2><p>Apresente aqui os principais objetivos, resultados e conclusões.</p><h2>2. Objetivos</h2><p>Descreva o que se pretende alcançar.</p><h2>3. Desenvolvimento</h2><p>Registe as atividades realizadas, os recursos utilizados e os resultados obtidos.</p><h2>4. Conclusões e próximos passos</h2><p>Resuma as conclusões e identifique as ações seguintes.</p>',
        meeting: '<h1>Ata de reunião</h1><p><strong>Data:</strong> [Data] &nbsp; <strong>Hora:</strong> [Hora]</p><p><strong>Participantes:</strong> [Nomes]</p><h2>Agenda</h2><ul><li>[Tema 1]</li><li>[Tema 2]</li></ul><h2>Decisões</h2><p>Registe as decisões tomadas.</p><h2>Ações a realizar</h2><table><tbody><tr><th>Ação</th><th>Responsável</th><th>Prazo</th></tr><tr><td>[Ação]</td><td>[Nome]</td><td>[Data]</td></tr></tbody></table><h2>Próxima reunião</h2><p>[Data e hora]</p>'
      };
      editor.innerHTML = templates[template] || EMPTY;
      savedRange = null;
      applyPage();
      afterLoad();
    },

    serialize() {
      renderComments();
      renderNotes();
      return JSON.stringify({ format: 'myoffice-doc', version: 3, theme: theme.id, html: editor.innerHTML, header: docHeader, footer: docFooter, comments: docComments, notes: docNotes, page: docPage });
    },

    load(text, ext) {
      let html;
      let nextTheme = T.LIST[0];
      if (ext === 'modoc') {
        const data = JSON.parse(text);
        if (!data || data.format !== 'myoffice-doc' || typeof data.html !== 'string') throw new Error('Formato inválido');
        html = data.html;
        docHeader = String(data.header || '').slice(0, 180);
        docFooter = String(data.footer || '').slice(0, 180);
        nextTheme = T.byId(data.theme);
        docComments = cleanTextMap(data.comments, 'comment');
        docNotes = cleanTextMap(data.notes, 'note');
        docPage = cleanPage(data.page);
      } else if (ext === 'docx') {
        const doc = MO.OOXML.importDocx(text);
        docComments = cleanTextMap(doc.comments, 'comment');
        docNotes = cleanTextMap(doc.notes, 'note');
        docPage = cleanPage(doc.page);
        html = doc.html;
        docHeader = String(doc.header || '').slice(0, 180);
        docFooter = String(doc.footer || '').slice(0, 180);
      } else if (ext === 'txt') {
        docHeader = ''; docFooter = ''; docComments = {}; docNotes = {}; docPage = cleanPage(null);
        html = text
          .split(/\r?\n/)
          .map((line) => `<p>${MO.escapeHTML(line) || '<br>'}</p>`)
          .join('');
      } else {
        docHeader = ''; docFooter = ''; docComments = {}; docNotes = {}; docPage = cleanPage(null);
        html = text;
      }
      editor.innerHTML = MO.sanitizeHTML(html) || EMPTY;
      setTheme(nextTheme);
      savedRange = null;
      tracking = false;
      applyPage();
      afterLoad();
    },

    exports: [
      { label: 'Documento do Word (.docx)', ext: 'docx', filterName: 'Documento do Word', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', get: () => { renderNotes(); return MO.OOXML.exportDocx(editor, T.docLook(theme), { header: docHeader, footer: docFooter, comments: docComments, notes: docNotes, page: docPage }); } },
      { label: 'Página web (.html)', ext: 'html', filterName: 'Página web', mime: 'text/html', get: (title) => standaloneHTML(title) },
      { label: 'Texto simples (.txt)', ext: 'txt', filterName: 'Texto simples', mime: 'text/plain', get: () => editor.innerText }
    ],

    print() {
      const node = h('div', { class: 'print-document' });
      if (docHeader) node.append(h('div', { class: 'print-running-header' }, docHeader));
      const body = h('div', { class: 'print-doc' });
      renderNotes();
      body.innerHTML = editor.innerHTML;
      if (docPage.columns > 1) Object.assign(body.style, { columnCount: String(docPage.columns), columnGap: '10mm' });
      body.querySelectorAll('.img-selected').forEach((im) => im.classList.remove('img-selected'));
      // Na impressão os comentários não aparecem; as alterações controladas mostram-se marcadas.
      body.querySelectorAll('mark.mo-comment').forEach((m) => m.replaceWith(...m.childNodes));
      showTheme(body);
      node.append(body);
      if (Object.keys(docNotes).length) {
        const notes = notesBox.cloneNode(true);
        notes.hidden = false;
        notes.style.width = '';
        notes.querySelectorAll('button').forEach((b) => b.replaceWith(b.textContent));
        node.append(notes);
      }
      if (docFooter) node.append(h('div', { class: 'print-running-footer' }, docFooter));
      const [mv, mh] = PAGE_MARGINS[docPage.margin] || PAGE_MARGINS.normal;
      return { node, page: `${docPage.size === 'Letter' ? 'letter' : docPage.size} ${docPage.orient}`, margin: `${mv}mm ${mh}mm`, pageRule: '@bottom-right { content: counter(page) " / " counter(pages); font: 9pt Arial; color: #667085; }' };
    },

    // Usado pelo Assistente: ler o texto do documento e inserir um rascunho no fim.
    assist: {
      text: () => (editor ? editor.innerText : ''),
      insert(html) {
        if (!editor) return;
        const empty = !editor.innerText.trim();
        const clean = MO.sanitizeHTML(html);
        if (empty) editor.innerHTML = clean;
        else editor.insertAdjacentHTML('beforeend', clean);
        ctx.dirty();
      }
    },
    show() {
      editor.focus();
    }
  };

  function afterLoad() {
    lockToc();
    renderComments();
    renderNotes();
    updateStats();
    if (trackButton) trackButton.classList.toggle('on', tracking);
  }

  // Estado das funcionalidades de revisão (usado pelos testes).
  MO.modules.writer.review = {
    get tracking() { return tracking; },
    comments: () => ({ ...docComments }),
    notes: () => ({ ...docNotes }),
    page: () => ({ ...docPage })
  };
})();
