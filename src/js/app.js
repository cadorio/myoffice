'use strict';

// Estrutura comum: barra de título, vista "Ficheiro", navegação entre módulos e gestão de ficheiros.
(function () {
  const MO = window.MO;
  const { h } = MO;
  // Dentro do Electron existe window.api (ver preload.js). Sem ela, a aplicação
  // funciona num browser com transferências e o seletor de ficheiros normal.
  const api = window.api || null;
  // Na aplicação instalada, cada programa tem a sua janela: ?app=sheets mostra só as Folhas.
  const SOLO = (() => {
    const id = api ? new URLSearchParams(location.search).get('app') : null;
    return ['home', 'writer', 'sheets', 'slides', 'draw', 'notes', 'pdf', 'db', 'assistant'].includes(id) ? id : null;
  })();
  MO.solo = SOLO;

  const ORDER = ['writer', 'sheets', 'slides', 'draw', 'notes', 'pdf', 'db'];
  const EXT_MODULE = { modoc: 'writer', html: 'writer', htm: 'writer', txt: 'writer', mosheet: 'sheets', csv: 'sheets', moslides: 'slides', modraw: 'draw', monotes: 'notes', pdf: 'pdf', modb: 'db', accdb: 'db', mdb: 'db', docx: 'writer', xlsx: 'sheets', pptx: 'slides' };
  const BINARY_EXT = ['docx', 'xlsx', 'pptx', 'pdf', 'modb', 'accdb', 'mdb'];
  const APP_ICON = { writer: 'icon-text.svg', sheets: 'icon-sheets.svg', slides: 'icon-slides.svg', draw: 'icon-draw.svg', notes: 'icon-notes.svg', pdf: 'icon-pdf.svg', db: 'icon-db.svg', assistant: 'icon-assistant.svg' };
  const docs = {};
  let current = 'home';

  const $ = (sel) => document.querySelector(sel);
  const baseName = (name) => name.replace(/\.[^.]+$/, '');

  function titleOf(id) {
    const d = docs[id];
    return d.name ? baseName(d.name) : MO.modules[id].defaultName + ' sem título';
  }

  function updateChrome() {
    const inModule = ORDER.includes(current);
    if (inModule) {
      const d = docs[current];
      const state = d.dirty ? ' • Por guardar' : d.path || d.name ? ' • Guardado' : '';
      $('#app-name').textContent = MO.modules[current].label;
      $('#doc-title').textContent = titleOf(current) + state;
      document.title = `${titleOf(current)}${d.dirty ? ' •' : ''} — ${MO.BRAND.name}${SOLO ? ' ' + MO.modules[current].label : ''}`;
    } else if (current === 'assistant') {
      $('#app-name').textContent = 'Assistente IA';
      $('#doc-title').textContent = 'Ajuda para trabalhar melhor';
      document.title = `Assistente IA — ${MO.BRAND.name}`;
    } else {
      $('#app-name').textContent = MO.BRAND.name;
      $('#doc-title').textContent = '';
      document.title = MO.BRAND.name;
    }
    document.querySelectorAll('.rail-btn').forEach((btn) => {
      const active = btn.dataset.view === current;
      btn.classList.toggle('active', active);
      if (active) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    });
    if (api) api.setDirty(ORDER.some((id) => docs[id].dirty));
  }

  MO.showView = (id) => show(id);
  function show(id) {
    // Outro programa abre na sua própria janela.
    if (SOLO && id !== SOLO) {
      api.openApp(id);
      return;
    }
    current = id;
    document.querySelectorAll('.view').forEach((view) => (view.hidden = view.id !== 'view-' + id));
    document.body.dataset.current = id;
    closeLauncher();
    closeBackstage();
    if (id === 'home') {
      greet();
      refreshRecent();
    }
    else if (id === 'assistant') MO.AssistantApp.show();
    else MO.modules[id].show();
    updateChrome();
  }

  const confirmDiscard = (id) =>
    !docs[id].dirty || window.confirm(`"${titleOf(id)}" tem alterações por guardar. Quer mesmo descartá-las?`);

  // ---------- Ficheiros ----------

  function newDoc() {
    if (current === 'home' || !confirmDiscard(current)) return;
    hideStart();
    MO.modules[current].newDoc();
    docs[current] = { path: null, name: null, dirty: false };
    dropDraft(current);
    MO.modules[current].show();
    updateChrome();
  }

  async function loadFile(file) {
    if (!file) return;
    if (file.error) return MO.toast(file.error);
    const ext = file.name.split('.').pop().toLowerCase();
    const id = Object.hasOwn(EXT_MODULE, ext) ? EXT_MODULE[ext] : null;
    if (!id) return MO.toast('Tipo de ficheiro não suportado.');
    if (SOLO && id !== SOLO) {
      // O ficheiro pertence a outro programa: abre na janela dele.
      if (file.path) api.openPath(file.path);
      return;
    }
    const importNotices = {
      docx: 'O Texto importa o conteúdo e a formatação mais comuns. Comentários, alterações controladas e alguns elementos avançados podem não ser transferidos. O original não será alterado; o documento convertido será guardado como .modoc.',
      xlsx: 'Folhas importa valores, fórmulas, formatação básica e gráficos simples de colunas/linhas. Tabelas dinâmicas Excel, gráficos avançados e fórmulas não suportadas podem não ser transferidos. O original não será alterado; o livro convertido será guardado como .mosheet.',
      accdb: 'As tabelas e os dados do Access são importados para uma base de dados MyOffice. Consultas, formulários, relatórios e macros do Access não são convertidos. O original não será alterado.',
      mdb: 'As tabelas e os dados do Access são importados para uma base de dados MyOffice. Consultas, formulários, relatórios e macros do Access não são convertidos. O original não será alterado.',
      pptx: 'Diapositivos importa texto, formas, imagens, transições simples e animações básicas por elemento. SmartArt e alguns elementos avançados podem não ser transferidos. O original não será alterado; a apresentação convertida será guardada como .moslides.'
    };
    if (importNotices[ext]) {
      const proceed = await MO.dialog({ title: 'Importar uma cópia do ficheiro Office?', message: importNotices[ext], okLabel: 'Importar cópia', cancelLabel: 'Voltar' });
      if (!proceed) return;
    }
    if (!confirmDiscard(id)) return;
    const mod = MO.modules[id];
    try {
      if (BINARY_EXT.includes(ext) !== file.content instanceof Uint8Array) throw new Error('Tipo de conteúdo inesperado');
      await mod.load(file.content, ext);
    } catch {
      return MO.toast(`Não foi possível abrir "${file.name}": o ficheiro não é válido.`);
    }
    // Ficheiros importados (HTML, TXT, CSV) são guardados depois no formato próprio.
    const native = ext === mod.ext;
    docs[id] = { path: native ? file.path : null, name: file.name, dirty: false };
    dropDraft(id);
    hideStart();
    show(id);
  }

  // Um ficheiro largado numa janela (por exemplo um PDF arrastado) segue o caminho normal.
  MO.openFileObject = (file) => loadFile(file);

  async function openFile() {
    if (api) return loadFile(await api.open());
    const picked = await MO.pickFile({ accept: Object.keys(EXT_MODULE).map((e) => '.' + e).join(','), binaryExt: BINARY_EXT });
    if (picked) loadFile({ path: null, name: picked.name, content: picked.content });
  }

  // Inicia um documento a partir de um modelo real, pronto a editar.
  function createFromTemplate(id, template) {
    if (SOLO && id !== SOLO) {
      if (MO.modules[id]) api.openApp(id, template);
      return;
    }
    if (!MO.modules[id] || !confirmDiscard(id)) return;
    hideStart();
    current = id;
    MO.modules[id].newDoc(template);
    docs[id] = { path: null, name: null, dirty: Boolean(template), };
    dropDraft(id);
    show(id);
    if (template) {
      stale.add(id);
      MO.toast('Modelo criado. Personalize e guarde o seu ficheiro.');
    }
  }

  async function save(saveAs, quiet = false) {
    if (current === 'home') return;
    const id = current;
    const mod = MO.modules[id];
    const d = docs[id];
    let content;
    try {
      content = await mod.serialize();
    } catch {
      return MO.toast('Não há nada para guardar.');
    }
    const defaultName = (d.name ? baseName(d.name) : mod.defaultName) + '.' + mod.ext;
    if (api) {
      const res = await api.save({
        path: saveAs ? null : d.path,
        content,
        defaultName,
        filters: [{ name: mod.filterName, extensions: [mod.ext] }],
        remember: true
      });
      if (!res) return;
      if (res.error) return MO.toast(res.error);
      d.path = res.path;
      d.name = res.name;
    } else {
      MO.download(defaultName, content, mod.binary ? 'application/pdf' : 'application/json');
      d.name = defaultName;
    }
    d.dirty = false;
    dropDraft(id);
    updateChrome();
    if (!quiet) MO.toast('Guardado.');
  }

  async function exportAs(exp) {
    const id = current;
    const title = titleOf(id);
    const name = title + '.' + exp.ext;
    let content;
    try {
      content = await exp.get(title);
    } catch {
      return MO.toast('Não foi possível exportar o documento.');
    }
    if (!api) return MO.download(name, content, exp.mime);
    const res = await api.save({ path: null, content, defaultName: name, filters: [{ name: exp.filterName, extensions: [exp.ext] }], remember: false });
    if (res && res.error) MO.toast(res.error);
    else if (res) MO.toast(`Exportado para ${res.name}.`);
  }

  // Prepara a área de impressão com o documento atual e corre a ação pedida (PDF, pré-visualização, imprimir).
  async function withPrintArea(run) {
    if (current === 'home' || !MO.modules[current]) return;
    const { node, page, margin, pageRule } = await MO.modules[current].print();
    const area = $('#print-area');
    $('#print-page').textContent = `@page { size: ${page}; margin: ${margin}; ${pageRule || ''} }`;
    area.replaceChildren(node);
    try {
      await run();
    } finally {
      area.replaceChildren();
    }
  }

  const exportPdf = () => withPrintArea(async () => {
    if (!api) return window.print();
    const res = await api.exportPdf({ defaultName: titleOf(current) + '.pdf' });
    if (res && res.error) MO.toast(res.error);
    else if (res) MO.toast(`Exportado para ${res.name}.`);
  });

  const printPreview = () => withPrintArea(async () => {
    if (!api) return window.print();
    MO.toast('A preparar a pré-visualização…');
    const res = await api.printPreview({ title: titleOf(current) });
    if (res && res.error) MO.toast(res.error);
  });

  const printNow = () => withPrintArea(async () => {
    if (!api) return window.print();
    const res = await api.print();
    if (res && res.error) MO.toast(res.error);
  });

  // ---------- Iniciador de aplicações ----------

  function closeLauncher() {
    $('#launcher-menu').hidden = true;
    $('#launcher').setAttribute('aria-expanded', 'false');
  }

  function toggleLauncher() {
    const menu = $('#launcher-menu');
    menu.hidden = !menu.hidden;
    $('#launcher').setAttribute('aria-expanded', String(!menu.hidden));
  }

  // ---------- Vista "Ficheiro" ----------

  function closeBackstage() {
    const bs = $('#backstage');
    if (bs.hidden) return;
    bs.hidden = true;
    if (ORDER.includes(current)) MO.modules[current].show();
  }

  function openBackstage() {
    if (current === 'home') return;
    const mod = MO.modules[current];
    $('#bs-title').textContent = titleOf(current);
    $('#bs-pdf').lastChild.textContent = api ? 'Exportar como PDF' : 'Imprimir / PDF';
    const items = [
      { label: api ? 'Documento PDF (.pdf)' : 'Imprimir ou guardar como PDF', run: exportPdf },
      ...mod.exports.map((exp) => ({ label: exp.label, run: () => exportAs(exp) }))
    ];
    $('#export-list').replaceChildren(
      ...items.map((item) =>
        h(
          'button',
          {
            type: 'button',
            class: 'export-item',
            onclick: () => {
              closeBackstage();
              item.run();
            }
          },
          MO.icon('export'),
          item.label
        )
      )
    );
    refreshRecent();
    $('#backstage').hidden = false;
    $('.bs-back').focus();
  }

  // ---------- Recentes (só na aplicação instalada) ----------

  // ---------- Ecrã de início de cada programa ----------
  // Cada programa abre no seu próprio início (em branco, modelos, recentes desse tipo), como o Word
  // e o Excel. Só existe na aplicação instalada, onde cada programa tem a sua janela.

  const START_TEMPLATES = {
    db: [['clientes', 'Clientes', 'Contactos e cidades'], ['inventario', 'Inventário', 'Produtos, preços e stock'], ['encomendas', 'Encomendas', 'Clientes, produtos e encomendas ligados']],
    draw: [['flow', 'Fluxograma', 'Etapas e decisões'], ['mind', 'Mapa mental', 'Ideias à volta de um tema'], ['org', 'Organograma', 'Equipas e funções'], ['timeline', 'Linha temporal', 'Etapas ao longo do tempo'], ['swot', 'SWOT', 'Forças, fraquezas, oportunidades e ameaças']],
    notes: [['meeting', 'Reuniões', 'Agenda, participantes e ações'], ['study', 'Estudos', 'Uma secção por disciplina'], ['project', 'Projeto', 'Visão geral, tarefas e ideias']]
  };
  const START_TITLE = { writer: 'Texto', sheets: 'Folhas', slides: 'Diapositivos', draw: 'Desenho', notes: 'Notas', pdf: 'PDF', db: 'Bases de dados' };
  const START_BLANK = { writer: 'Documento em branco', sheets: 'Livro em branco', slides: 'Apresentação em branco', draw: 'Desenho em branco', notes: 'Caderno em branco', pdf: null, db: 'Base de dados em branco' };
  let startEl = null;

  function hideStart() {
    if (startEl) { startEl.remove(); startEl = null; document.body.classList.remove('has-start'); }
  }

  async function showStart(id) {
    if (!MO.modules[id] || startEl) return;
    const view = $('#view-' + id);
    const cards = [];
    if (START_BLANK[id]) {
      cards.push(h('button', { type: 'button', class: 'start-card blank', onclick: () => { hideStart(); MO.modules[id].show(); } },
        h('span', { class: 'start-thumb blank-thumb' }, '＋'), h('strong', null, START_BLANK[id])));
    }
    // Modelos do ecrã inicial que pertencem a este programa.
    for (const card of document.querySelectorAll(`#view-home .template-card[data-template-module="${id}"]`)) {
      const clone = card.cloneNode(true);
      clone.classList.add('start-card');
      cards.push(clone);
    }
    for (const [key, name, hint] of START_TEMPLATES[id] || []) {
      if (key === 'flow') continue; // o desenho em branco já abre o fluxograma
      cards.push(h('button', { type: 'button', class: 'start-card template-card', 'data-template-module': id, 'data-template': key },
        h('span', { class: 'start-thumb' }, MO.icon(id === 'db' ? 'table' : 'branch')), h('strong', null, name), h('small', null, hint)));
    }
    const recentList = h('ul', { class: 'start-recent' });
    const empty = h('p', { class: 'start-empty' }, 'Ainda não há ficheiros recentes deste programa.');
    startEl = h('section', { class: 'start-screen', 'aria-label': `Início — ${START_TITLE[id]}` },
      h('div', { class: 'start-inner' },
        h('header', { class: 'start-head' },
          h('span', { class: 'app-tile ' + (id === 'notes' ? 'notas' : id) }, h('img', { src: 'assets/' + APP_ICON[id], alt: '' })),
          h('h1', null, START_TITLE[id]),
          h('button', { type: 'button', class: 'btn', 'data-action': 'open' }, 'Abrir…')
        ),
        cards.length ? h('div', { class: 'start-cards' }, cards) : h('p', { class: 'start-lead' }, id === 'pdf' ? 'Abra um PDF para o ler, anotar, assinar ou organizar. Também pode arrastá-lo para esta janela.' : ''),
        h('h2', null, 'Recentes'),
        recentList,
        empty
      )
    );
    view.append(startEl);
    document.body.classList.add('has-start');
    const list = api ? await api.getRecent() : [];
    const mine = list.filter((item) => EXT_MODULE[item.name.split('.').pop().toLowerCase()] === id);
    empty.hidden = mine.length > 0;
    recentList.replaceChildren(...mine.map((item) => h('li', null,
      h('button', { type: 'button', class: 'recent-item', title: item.path, onclick: async () => loadFile(await api.openRecent(item.path)) },
        h('span', { class: 'app-tile ' + (id === 'notes' ? 'notas' : id) }, h('img', { src: 'assets/' + APP_ICON[id], alt: '' })),
        h('span', { class: 'recent-name' }, item.name),
        h('span', { class: 'recent-path' }, item.path)))));
  }

  async function refreshRecent() {
    const list = api ? await api.getRecent() : [];
    document.querySelectorAll('.recent-empty').forEach((el) => (el.hidden = list.length > 0));
    document.querySelectorAll('.recent-list').forEach((ul) =>
      ul.replaceChildren(
        ...list.map((item) => {
          const ext = item.name.split('.').pop().toLowerCase();
          const id = Object.hasOwn(EXT_MODULE, ext) ? EXT_MODULE[ext] : 'writer';
          return h(
            'li',
            null,
            h(
              'button',
              { type: 'button', class: 'recent-item', title: item.path, onclick: async () => loadFile(await api.openRecent(item.path)) },
              h('span', { class: 'app-tile ' + (id === 'notes' ? 'notas' : id) }, h('img', { src: 'assets/' + APP_ICON[id], alt: '' })),
              h('span', { class: 'recent-name' }, item.name),
              h('span', { class: 'recent-path' }, item.path)
            )
          );
        })
      )
    );
    filterRecent($('#recent-search')?.value || '');
  }

  function filterRecent(query) {
    const needle = String(query || '').trim().toLocaleLowerCase('pt-PT');
    document.querySelectorAll('.recent-list .recent-item').forEach((item) => {
      item.closest('li').hidden = needle && !item.textContent.toLocaleLowerCase('pt-PT').includes(needle);
    });
    document.querySelectorAll('.recent-empty').forEach((empty) => {
      const hasFiles = document.querySelector('.recent-list li');
      const visible = [...document.querySelectorAll('.recent-list li')].some((li) => !li.hidden);
      empty.textContent = hasFiles && needle && !visible
        ? 'Não foram encontrados ficheiros com esse nome.'
        : 'Ainda não existem ficheiros recentes. Abra um ficheiro para começar.';
      empty.hidden = Boolean(visible);
    });
  }

  // ---------- Recuperação automática (só na aplicação instalada) ----------

  const DRAFT_INTERVAL = 30000;
  const stale = new Set(); // módulos alterados desde o último rascunho

  function dropDraft(id) {
    stale.delete(id);
    if (api) api.drafts.clear(id);
  }

  async function writeDrafts() {
    for (const id of [...stale]) {
      if (!docs[id].dirty || MO.modules[id].noDrafts) continue;
      stale.delete(id);
      let content;
      try {
        content = MO.modules[id].serialize();
      } catch {
        continue;
      }
      await api.drafts.save({ module: id, name: docs[id].name, path: docs[id].path, content });
    }
  }

  async function initRecovery() {
    // Cada janela recupera só o seu programa; o ecrã inicial e o Assistente não têm documentos.
    const drafts = (await api.drafts.list()).filter((d) => !SOLO || d.module === SOLO);
    if (drafts.length) {
      const names = drafts.map((d) => `• ${d.name ? baseName(d.name) : MO.modules[d.module].defaultName + ' sem título'} (${MO.modules[d.module].label})`).join('\n');
      const res = await MO.dialog({
        title: 'Recuperar documentos',
        message: `A aplicação fechou com alterações por guardar. Quer recuperar?\n${names}`,
        okLabel: 'Recuperar',
        cancelLabel: 'Descartar'
      });
      if (res) {
        let last = null;
        for (const draft of drafts) {
          try {
            MO.modules[draft.module].load(draft.content, MO.modules[draft.module].ext);
            docs[draft.module] = { path: draft.path, name: draft.name, dirty: true };
            stale.add(draft.module);
            last = draft.module;
            hideStart();
          } catch {
            MO.toast('Não foi possível recuperar um dos documentos.');
          }
        }
        if (last) show(last);
        updateChrome();
      } else {
        for (const draft of drafts) api.drafts.clear(draft.module);
      }
    }
    // O rascunho é escrito num momento de inatividade, para não interromper quem está a escrever.
    setInterval(() => {
      if (stale.size) (window.requestIdleCallback || setTimeout)(() => writeDrafts(), { timeout: 5000 });
    }, DRAFT_INTERVAL);
  }

  // ---------- Modo claro / escuro ----------

  function storedMode() {
    try {
      return localStorage.getItem('mo-mode');
    } catch {
      return null;
    }
  }

  function setMode(mode, remember) {
    document.documentElement.dataset.mode = mode;
    $('#mode-toggle').replaceChildren(MO.icon(mode === 'dark' ? 'sun' : 'moon'));
    if (!remember) return;
    try {
      localStorage.setItem('mo-mode', mode);
    } catch {
      /* sem armazenamento, a escolha vale só para esta sessão */
    }
  }

  function initMode() {
    const system = window.matchMedia('(prefers-color-scheme: dark)');
    const saved = storedMode();
    setMode(saved === 'dark' || saved === 'light' ? saved : system.matches ? 'dark' : 'light', false);
    // Sem escolha guardada, acompanha o sistema operativo.
    system.addEventListener('change', (e) => {
      if (!storedMode()) setMode(e.matches ? 'dark' : 'light', false);
    });
    $('#mode-toggle').addEventListener('click', () => setMode(document.documentElement.dataset.mode === 'dark' ? 'light' : 'dark', true));
  }

  function greet() {
    $('#greeting').textContent = 'Bom trabalho começa aqui.';
  }

  // ---------- Ações globais ----------

  const BRAND = MO.BRAND.name;
  const dateText = (iso) => new Date(iso).toLocaleDateString('pt-PT');

  function about() {
    const dlg = h(
      'dialog',
      { class: 'mo-dialog wide' },
      h('h2', null, BRAND),
      h('p', null, 'Suite de escritório para desktop: Texto, Folhas e Diapositivos. Funciona sem ligação à Internet e os seus documentos ficam apenas no seu computador.'),
      h('h3', null, 'Componentes de terceiros'),
      h('pre', { class: 'notices', tabindex: '0' }, MO.NOTICES || ''),
      h('div', { class: 'dialog-actions' }, h('button', { type: 'button', class: 'btn primary', onclick: () => dlg.close() }, 'Fechar'))
    );
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
  }

  // ---------- Licença (só na aplicação instalada e com licenciamento configurado) ----------

  function licenseText(st) {
    if (st.licensed) return `Licenciado a ${st.name || 'utilizador registado'}` + (st.expires ? `, válido até ${dateText(st.expires)}.` : '.');
    if (st.trialDaysLeft > 0) return `Período experimental: ${st.trialDaysLeft === 1 ? 'resta 1 dia' : `restam ${st.trialDaysLeft} dias`}.`;
    return 'O período experimental terminou. Pode continuar a abrir documentos, mas para guardar e exportar precisa de uma licença.';
  }

  async function licenseDialog() {
    if (!api) return;
    const st = await api.license.status();
    if (!st.enabled) return;
    const res = await MO.dialog({
      title: 'Licença',
      message: licenseText(st) + (st.reason ? ` (${st.reason})` : ''),
      fields: [{ name: 'key', label: 'Chave de licença', placeholder: 'Cole aqui a chave que recebeu' }],
      okLabel: 'Ativar'
    });
    if (!res || !res.key.trim()) return;
    const out = await api.license.activate(res.key);
    MO.toast(out.error ? out.error : 'Licença ativada. Obrigado!');
  }

  async function initLicense() {
    if (!api) return;
    const st = await api.license.status();
    if (!st.enabled) return;
    $('#bs-license').hidden = false;
    if (!st.licensed && st.trialDaysLeft <= 7) MO.toast(licenseText(st));
  }

  function run(action) {
    const actions = { new: newDoc, open: openFile, save: () => save(false), saveAs: () => save(true), exportPdf, printPreview, print: printNow, about, license: licenseDialog, closeFile: closeBackstage };
    if (actions[action]) {
      closeBackstage();
      actions[action]();
    } else if (action === 'assistant' || MO.modules[action]) {
      show(action);
    }
  }

  // ---------- Design "Estúdio": documento ao centro, ferramentas num painel lateral ----------

  // Cada módulo cria o seu friso (.ribbon) e o conteúdo. Aqui o conteúdo vai para uma coluna
  // principal e o friso passa a ser o painel de ferramentas à direita, que se pode recolher.
  function studioLayout(view) {
    const ribbon = view.querySelector(':scope > .ribbon');
    if (!ribbon) return;
    const mainCol = h('div', { class: 'studio-main' });
    mainCol.append(...[...view.children].filter((el) => el !== ribbon));
    const collapse = h('button', { type: 'button', class: 'inspector-toggle', title: 'Mostrar ou esconder as ferramentas (Ctrl+.)', 'aria-label': 'Mostrar ou esconder as ferramentas' }, MO.icon('sidebar'));
    collapse.addEventListener('click', () => toggleInspector(view));
    const head = h('div', { class: 'inspector-head' }, h('span', { class: 'inspector-title' }, 'Ferramentas'), h('kbd', { class: 'inspector-kbd', title: 'Paleta de comandos' }, 'Ctrl K'), collapse);
    ribbon.classList.add('inspector');
    ribbon.prepend(head);
    view.append(mainCol, ribbon);
    let collapsed = false;
    try {
      collapsed = localStorage.getItem('mo-inspector-' + view.id) === '1';
    } catch {
      collapsed = false;
    }
    view.classList.toggle('inspector-collapsed', collapsed);
  }

  function toggleInspector(view = document.querySelector('.view.module:not([hidden])')) {
    if (!view) return;
    const collapsed = view.classList.toggle('inspector-collapsed');
    try {
      localStorage.setItem('mo-inspector-' + view.id, collapsed ? '1' : '0');
    } catch {
      /* preferência só para esta sessão */
    }
  }

  // ---------- Paleta de comandos (Ctrl+K) ----------
  // Encontra qualquer comando pelo nome: ferramentas da aplicação atual, mudar de aplicação e ações de ficheiro.

  const plain = (text) => String(text || '').toLocaleLowerCase('pt-PT').normalize('NFD').replace(/\p{M}/gu, '');
  let palette = null;

  function paletteCommands() {
    const out = [];
    const view = document.querySelector('.view.module:not([hidden])');
    if (view) {
      const panels = [...view.querySelectorAll('.ribbon-panel')];
      const tabs = [...view.querySelectorAll('.ribbon-tab:not(.file)')];
      panels.forEach((panel, i) => {
        const section = tabs[i] ? tabs[i].textContent.trim() : '';
        panel.querySelectorAll('button.tool').forEach((btn) => {
          const label = (btn.title || btn.textContent).trim();
          if (!label) return;
          out.push({ label, hint: section, run: () => { tabs[i] && tabs[i].click(); btn.click(); } });
        });
      });
    }
    const actions = [
      ['Novo documento', 'new'], ['Abrir ficheiro…', 'open'], ['Guardar', 'save'], ['Guardar como…', 'saveAs'], ['Exportar como PDF', 'exportPdf'], ['Pré-visualizar impressão', 'printPreview'], ['Imprimir…', 'print'], ['Acerca do MyOffice', 'about']
    ];
    for (const [label, action] of actions) out.push({ label, hint: 'Ficheiro', run: () => run(action) });
    for (const [label, id] of [['Abrir Texto', 'writer'], ['Abrir Folhas', 'sheets'], ['Abrir Diapositivos', 'slides'], ['Abrir Desenho', 'draw'], ['Abrir Notas', 'notes'], ['Abrir PDF', 'pdf'], ['Abrir Bases de dados', 'db'], ['Abrir Assistente', 'assistant']]) {
      if (id === current) continue;
      out.push({ label, hint: 'Aplicações', run: () => show(id) });
    }
    out.push({ label: 'Mudar entre modo claro e escuro', hint: 'Aparência', run: () => $('#mode-toggle').click() });
    if (view) out.push({ label: 'Mostrar ou esconder as ferramentas', hint: 'Aparência', run: () => toggleInspector(view) });
    return out;
  }

  function openPalette() {
    if (palette) return;
    const commands = paletteCommands();
    const input = h('input', { type: 'search', class: 'palette-input', placeholder: 'Escreva um comando: negrito, gráfico, PDF…', 'aria-label': 'Procurar comando' });
    const list = h('ul', { class: 'palette-list', role: 'listbox' });
    const dlg = h('dialog', { class: 'palette', 'aria-label': 'Paleta de comandos' }, input, list, h('p', { class: 'palette-foot' }, '↑ ↓ para escolher · Enter para executar · Esc para fechar'));
    let shown = [];
    let active = 0;
    const draw = () => {
      const q = plain(input.value).split(/\s+/).filter(Boolean);
      shown = commands.filter((c) => q.every((w) => plain(c.label + ' ' + c.hint).includes(w))).slice(0, 12);
      active = Math.min(active, Math.max(0, shown.length - 1));
      list.replaceChildren(
        ...(shown.length
          ? shown.map((c, i) =>
              h('li', { role: 'option', class: 'palette-item' + (i === active ? ' active' : ''), 'aria-selected': String(i === active), onclick: () => runItem(i) }, h('span', null, c.label), h('small', null, c.hint))
            )
          : [h('li', { class: 'palette-empty' }, 'Nenhum comando encontrado.')])
      );
    };
    const runItem = (i) => {
      const item = shown[i];
      dlg.close();
      if (item) item.run();
    };
    input.addEventListener('input', () => {
      active = 0;
      draw();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        active = (active + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % Math.max(1, shown.length);
        draw();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        runItem(active);
      }
    });
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) dlg.close();
    });
    dlg.addEventListener('close', () => {
      dlg.remove();
      palette = null;
    });
    palette = dlg;
    document.body.append(dlg);
    draw();
    dlg.showModal();
    input.focus();
  }

  function initPalette() {
    $('#palette-btn')?.addEventListener('click', openPalette);
    document.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openPalette();
      } else if (mod && e.key === '.') {
        e.preventDefault();
        toggleInspector();
      }
    });
  }

  function init() {
    document.querySelectorAll('[data-icon]').forEach((el) => el.prepend(MO.icon(el.dataset.icon)));
    initMode();

    MO.AssistantApp.init($('#view-assistant'));

    for (const id of ORDER) {
      docs[id] = { path: null, name: null, dirty: false };
      MO.modules[id].init($('#view-' + id), {
        dirty() {
          stale.add(id);
          if (docs[id].dirty) return;
          docs[id].dirty = true;
          updateChrome();
        },
        file: openBackstage,
        // Guarda sem perguntar quando o documento já tem ficheiro (usado pelas Notas).
        autosave() { if (docs[id].path && docs[id].dirty && current === id) save(false, true); }
      });
      MO.modules[id].newDoc();
      studioLayout($('#view-' + id));
    }
    initPalette();

    document.addEventListener('click', (e) => {
      const templateBtn = e.target.closest('[data-template-module]');
      const viewBtn = e.target.closest('[data-view]');
      const actionBtn = e.target.closest('[data-action]');
      if (templateBtn) createFromTemplate(templateBtn.dataset.templateModule, templateBtn.dataset.template || 'default');
      else if (viewBtn) show(viewBtn.dataset.view);
      else if (actionBtn) run(actionBtn.dataset.action);
      if (!e.target.closest('.menu-wrap')) closeLauncher();
    });
    $('#launcher').addEventListener('click', toggleLauncher);
    $('#recent-search')?.addEventListener('input', (e) => filterRecent(e.target.value));

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!$('#launcher-menu').hidden) closeLauncher();
      else if (!$('#backstage').hidden && !document.querySelector('dialog[open]')) closeBackstage();
    });

    if (api) {
      // Os atalhos de teclado vêm do menu da aplicação.
      api.onMenu(run);
      api.onOpenFile(loadFile);
      api.onOpenView((view) => {
        if (ORDER.includes(view)) show(view);
      });
      if (SOLO) {
        api.onTemplate((template) => createFromTemplate(SOLO, template));
        api.onDeliver((action) => {
          if (action.kind === 'formula' && SOLO === 'sheets') {
            MO.modules.sheets.assist.put(action.value);
            MO.toast(`Fórmula do Assistente inserida em ${MO.modules.sheets.assist.activeAddr()}.`);
          } else if (action.kind === 'draft' && SOLO === 'writer') {
            MO.modules.writer.assist.insert(action.value);
            MO.toast('Rascunho do Assistente inserido.');
          }
        });
        api.onContentRequest(() => (SOLO === 'writer' ? MO.modules.writer.assist.text() : SOLO === 'sheets' ? MO.modules.sheets.assist.table() : ''));
        document.body.dataset.solo = SOLO;
      }
      api.ready();
      initLicense();
      initRecovery();
    } else {
      document.addEventListener('keydown', (e) => {
        if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
        const action = { s: e.shiftKey ? 'saveAs' : 'save', o: 'open', p: 'print' }[e.key.toLowerCase()];
        if (!action) return;
        e.preventDefault();
        run(action);
      });
      window.addEventListener('beforeunload', (e) => {
        if (ORDER.some((id) => docs[id].dirty)) e.preventDefault();
      });
    }

    const requestedView = SOLO || new URLSearchParams(location.search).get('view');
    show(ORDER.includes(requestedView) || requestedView === 'assistant' ? requestedView : 'home');
    // Programa aberto sozinho: começa no seu ecrã de início.
    if (SOLO && MO.modules[SOLO]) showStart(SOLO);
  }

  init();
})();
