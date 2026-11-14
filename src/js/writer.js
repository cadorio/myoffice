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

  // Temas predefinidos do documento: tipo de letra do texto e dos títulos, e cor dos títulos e destaques.
  const SERIF = 'Georgia, "Times New Roman", serif';
  const SANS = '"Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif';
  const THEMES = [
    { id: 'classico', name: 'Clássico', body: SERIF, head: SERIF, color: '#1c2130', accent: '#9aa1b1' },
    { id: 'moderno', name: 'Moderno', body: SANS, head: SANS, color: '#1f5fbf', accent: '#1f5fbf' },
    { id: 'elegante', name: 'Elegante', body: SERIF, head: SERIF, color: '#7a1f3d', accent: '#b8860b' },
    { id: 'natureza', name: 'Natureza', body: SANS, head: SERIF, color: '#14532d', accent: '#2e8b57' },
    { id: 'tecnico', name: 'Técnico', body: SANS, head: '"Courier New", Courier, monospace', color: '#33415c', accent: '#5b6475' },
    { id: 'vivo', name: 'Vivo', body: '"Trebuchet MS", Verdana, sans-serif', head: '"Trebuchet MS", Verdana, sans-serif', color: '#c8491f', accent: '#f08a3c' }
  ];
  let theme = THEMES[0];

  const themeVars = (t) => ({ '--doc-font': t.body, '--doc-head-font': t.head, '--doc-head-color': t.color, '--doc-accent': t.accent });

  function showTheme(node) {
    for (const [name, value] of Object.entries(themeVars(theme))) node.style.setProperty(name, value);
  }

  function applyTheme(next) {
    theme = next;
    showTheme(editor);
    changed();
  }

  function themeChip(t) {
    const chip = toolButton(
      [h('span', { class: 'theme-title', style: { color: t.color, fontFamily: t.head } }, 'Título'), h('span', { class: 'theme-name', style: { fontFamily: t.body } }, t.name)],
      'Aplicar o tema ' + t.name,
      () => applyTheme(t),
      'theme-chip doc-theme'
    );
    chip.style.borderBottom = '3px solid ' + t.accent;
    return chip;
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
                  colorButton('A', 'Cor do texto', '#c62828', (v) => exec('foreColor', v)),
                  colorButton('ab', 'Cor de realce', '#fff3a3', (v) => exec('hiliteColor', v)),
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
              rows: [[bigButton('search', 'Localizar', 'Localizar e substituir', findReplace)]]
            }
          ]
        },
        {
          label: 'Estrutura',
          groups: [{ label: 'Temas do documento', rows: [THEMES.map(themeChip)] }]
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
    return (
      '<!DOCTYPE html>\n<html lang="pt">\n<head>\n<meta charset="utf-8">\n' +
      `<title>${MO.escapeHTML(title)}</title>\n<style>${DOC_CSS}\nbody { font-family: ${theme.body}; }\nh1, h2, h3 { font-family: ${theme.head}; color: ${theme.color}; }\nblockquote { border-left-color: ${theme.accent}; }\n</style>\n</head>\n<body>\n${editor.innerHTML}\n</body>\n</html>\n`
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
      statusEl = h('div', { class: 'statusbar' });
      container.append(buildRibbon(), h('div', { class: 'page-scroll' }, editor), statusEl);

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

    newDoc() {
      theme = THEMES[0];
      showTheme(editor);
      editor.innerHTML = EMPTY;
      savedRange = null;
      updateStats();
    },

    serialize() {
      return JSON.stringify({ format: 'myoffice-doc', version: 1, theme: theme.id, html: editor.innerHTML });
    },

    load(text, ext) {
      let html;
      let nextTheme = THEMES[0];
      if (ext === 'modoc') {
        const data = JSON.parse(text);
        if (!data || data.format !== 'myoffice-doc' || typeof data.html !== 'string') throw new Error('Formato inválido');
        html = data.html;
        nextTheme = THEMES.find((t) => t.id === data.theme) || THEMES[0];
      } else if (ext === 'txt') {
        html = text
          .split(/\r?\n/)
          .map((line) => `<p>${MO.escapeHTML(line) || '<br>'}</p>`)
          .join('');
      } else {
        html = text;
      }
      editor.innerHTML = MO.sanitizeHTML(html) || EMPTY;
      theme = nextTheme;
      showTheme(editor);
      savedRange = null;
      updateStats();
    },

    exports: [
      { label: 'Página web (.html)', ext: 'html', filterName: 'Página web', mime: 'text/html', get: (title) => standaloneHTML(title) },
      { label: 'Texto simples (.txt)', ext: 'txt', filterName: 'Texto simples', mime: 'text/plain', get: () => editor.innerText }
    ],

    print() {
      const node = h('div', { class: 'print-doc' });
      node.innerHTML = editor.innerHTML;
      showTheme(node);
      return { node, page: 'A4 portrait', margin: '20mm' };
    },

    show() {
      editor.focus();
    }
  };
})();
