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
  let headerText = '';
  let footerText = '';
  let pageNumbers = false;
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
    statusEl.textContent = `${words} ${words === 1 ? 'palavra' : 'palavras'} · ${chars} ${chars === 1 ? 'carácter' : 'caracteres'}`;
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
    if (src) insertHTML(`<img src="${src}" alt="">`);
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

  async function editPageElement(kind) {
    const isHeader = kind === 'header';
    const current = isHeader ? headerText : footerText;
    const result = await MO.dialog({
      title: isHeader ? 'Cabeçalho do documento' : 'Rodapé do documento',
      fields: [{ name: 'text', label: 'Texto (pode ficar vazio)', type: 'text', value: current, placeholder: isHeader ? 'Ex.: Nome da empresa' : 'Ex.: Confidencial' }],
      okLabel: 'Guardar'
    });
    if (!result) return;
    if (isHeader) headerText = String(result.text || '').slice(0, 250);
    else footerText = String(result.text || '').slice(0, 250);
    changed();
    MO.toast(isHeader ? 'Cabeçalho atualizado.' : 'Rodapé atualizado.');
  }

  async function togglePageNumbers() {
    const result = await MO.dialog({
      title: 'Numeração de páginas',
      message: 'Ativar ou desativar a numeração automática no rodapé dos ficheiros DOCX e na impressão?',
      okLabel: pageNumbers ? 'Desativar' : 'Ativar'
    });
    if (result === null) return;
    pageNumbers = !pageNumbers;
    changed();
    MO.toast(pageNumbers ? 'Numeração de páginas ativada.' : 'Numeração de páginas desativada.');
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
    const result = MO.Assistant.request({ task: 'review', context: text });
    if (result.error) return MO.toast(result.error);
    await MO.dialog({ title: 'MyOffice Intelligence · Revisão experimental', message: result.summary + '\n\n' + result.findings.map((item) => '• ' + item).join('\n') + '\n\nAnálise local baseada em regras; não é ainda um modelo generativo.', okLabel: 'Fechar' });
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
              rows: [[bigButton('search', 'Localizar', 'Localizar e substituir', findReplace), bigButton('sparkle', 'Rever com IA', 'Resumir o documento e sugerir melhorias usando IA local', aiReview)]]
            }
          ]
        },
        {
          label: 'Estrutura',
          groups: [{ label: 'Temas do documento', rows: [themeRow] }]
        },
        {
          label: 'Inserir',
          groups: [
            { label: 'Tabelas', rows: [[bigButton('table', 'Tabela', 'Inserir tabela', insertTable)]] },
            { label: 'Ilustrações', rows: [[bigButton('image', 'Imagem', 'Inserir imagem', insertImage)]] },
            { label: 'Ligações', rows: [[bigButton('link', 'Ligação', 'Inserir ligação', insertLink)]] },
            {
              label: 'Elementos',
              rows: [
                [
                  bigButton('line', 'Linha', 'Linha horizontal', () => insertHTML('<hr>' + EMPTY)),
                  bigButton('pageBreak', 'Quebra de página', 'Inserir quebra de página', () => insertHTML('<hr class="page-break">' + EMPTY))
                ],
                [
                  bigButton('text', 'Cabeçalho', 'Definir cabeçalho do documento', () => editPageElement('header')),
                  bigButton('text', 'Rodapé', 'Definir rodapé do documento', () => editPageElement('footer')),
                  bigButton('numbers', 'N.º página', 'Ativar/desativar numeração automática', togglePageNumbers)
                ]
              ]
            }
          ]
        }
      ],
      () => ctx.file()
    );
  }

  function standaloneHTML(title) {
    const look = T.docLook(theme);
    return (
      '<!DOCTYPE html>\n<html lang="pt">\n<head>\n<meta charset="utf-8">\n' +
      `<title>${MO.escapeHTML(title)}</title>\n<style>${DOC_CSS}\nbody { font-family: ${look.body}; }\nh1, h2, h3 { font-family: ${look.head}; color: ${look.color}; }\nblockquote { border-left-color: ${look.accent}; }\n</style>\n</head>\n<body>\n${editor.innerHTML}\n</body>\n</html>\n`
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
      statusEl = h('span', { class: 'status-text' });
      const ribbon = buildRibbon();
      const bar = h('div', { class: 'statusbar' }, statusEl, MO.zoomControl((k) => (editor.style.zoom = k)));
      container.append(ribbon, h('div', { class: 'page-scroll' }, editor), bar);
      showStates = MO.toolStates(ribbon, STATE_TITLES);
      document.addEventListener('selectionchange', updateStates);

      editor.addEventListener('input', changed);
      document.addEventListener('selectionchange', rememberSelection);

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
      const templates = {
        report: '<h1>Relatório de projeto</h1><p><strong>Responsável:</strong> [Nome]</p><p><strong>Data:</strong> [Data]</p><h2>1. Resumo executivo</h2><p>Apresente aqui os principais objetivos, resultados e conclusões.</p><h2>2. Objetivos</h2><p>Descreva o que se pretende alcançar.</p><h2>3. Desenvolvimento</h2><p>Registe as atividades realizadas, os recursos utilizados e os resultados obtidos.</p><h2>4. Conclusões e próximos passos</h2><p>Resuma as conclusões e identifique as ações seguintes.</p>',
        meeting: '<h1>Ata de reunião</h1><p><strong>Data:</strong> [Data] &nbsp; <strong>Hora:</strong> [Hora]</p><p><strong>Participantes:</strong> [Nomes]</p><h2>Agenda</h2><ul><li>[Tema 1]</li><li>[Tema 2]</li></ul><h2>Decisões</h2><p>Registe as decisões tomadas.</p><h2>Ações a realizar</h2><table><tbody><tr><th>Ação</th><th>Responsável</th><th>Prazo</th></tr><tr><td>[Ação]</td><td>[Nome]</td><td>[Data]</td></tr></tbody></table><h2>Próxima reunião</h2><p>[Data e hora]</p>'
      };
      editor.innerHTML = templates[template] || EMPTY;
      savedRange = null;
      updateStats();
    },

    serialize() {
      return JSON.stringify({ format: 'myoffice-doc', version: 2, theme: theme.id, html: editor.innerHTML, headerText, footerText, pageNumbers });
    },

    load(text, ext) {
      let html;
      let nextTheme = T.LIST[0];
      if (ext === 'modoc') {
        const data = JSON.parse(text);
        if (!data || data.format !== 'myoffice-doc' || typeof data.html !== 'string') throw new Error('Formato inválido');
        html = data.html;
        headerText = String(data.headerText || '').slice(0, 250);
        footerText = String(data.footerText || '').slice(0, 250);
        pageNumbers = Boolean(data.pageNumbers);
        nextTheme = T.byId(data.theme);
      } else if (ext === 'docx') {
        const imported = MO.OOXML.importDocx(text);
        html = imported.html;
        headerText = String(imported.headerText || '').slice(0, 250);
        footerText = String(imported.footerText || '').slice(0, 250);
        pageNumbers = Boolean(imported.pageNumbers);
      } else if (ext === 'txt') {
        headerText = '';
        footerText = '';
        pageNumbers = false;
        html = text
          .split(/\r?\n/)
          .map((line) => `<p>${MO.escapeHTML(line) || '<br>'}</p>`)
          .join('');
      } else {
        html = text;
      }
      if (ext !== 'modoc' && ext !== 'docx' && ext !== 'txt') { headerText = ''; footerText = ''; pageNumbers = false; }
      editor.innerHTML = MO.sanitizeHTML(html) || EMPTY;
      setTheme(nextTheme);
      savedRange = null;
      updateStats();
    },

    exports: [
      { label: 'Documento do Word (.docx)', ext: 'docx', filterName: 'Documento do Word', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', get: () => MO.OOXML.exportDocx(editor, T.docLook(theme), { headerText, footerText, pageNumbers }) },
      { label: 'Página web (.html)', ext: 'html', filterName: 'Página web', mime: 'text/html', get: (title) => standaloneHTML(title) },
      { label: 'Texto simples (.txt)', ext: 'txt', filterName: 'Texto simples', mime: 'text/plain', get: () => editor.innerText }
    ],

    print() {
      const node = h('div', { class: 'print-doc' });
      node.innerHTML = editor.innerHTML;
      showTheme(node);
      if (headerText) node.prepend(h('div', { class: 'print-page-header' }, headerText));
      if (footerText || pageNumbers) node.append(h('div', { class: 'print-page-footer' }, footerText, pageNumbers ? ' · Página automática no DOCX' : ''));
      return { node, page: 'A4 portrait', margin: '20mm' };
    },

    show() {
      editor.focus();
    }
  };
})();
