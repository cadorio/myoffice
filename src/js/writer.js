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
            { label: 'Página', rows: [[bigButton('pageSetup', 'Configurar página', 'Tamanho do papel, orientação e margens', pageDialog), bigButton('pageBreak', 'Cabeçalho e rodapé', 'Definir texto repetido e numeração de páginas', editPageParts)]] }
          ]
        },
        reviewTab(),
        {
          label: 'Inserir',
          groups: [
            { label: 'Tabelas', rows: [[bigButton('table', 'Tabela', 'Inserir tabela', insertTable)]] },
            { label: 'Ilustrações', rows: [[bigButton('image', 'Imagem', 'Inserir imagem', insertImage)]] },
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
      docPage = { size: size.value, orient: orient.value, margin: margin.value };
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
      margin: Object.hasOwn(PAGE_MARGINS, p.margin) ? p.margin : 'normal'
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

      editor.addEventListener('keydown', (e) => {
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
