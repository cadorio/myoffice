'use strict';

// Estrutura comum: barra de título, vista "Ficheiro", navegação entre módulos e gestão de ficheiros.
(function () {
  const MO = window.MO;
  const { h } = MO;
  // Dentro do Electron existe window.api (ver preload.js). Sem ela, a aplicação
  // funciona num browser com transferências e o seletor de ficheiros normal.
  const api = window.api || null;

  const ORDER = ['writer', 'sheets', 'slides'];
  const EXT_MODULE = { modoc: 'writer', html: 'writer', htm: 'writer', txt: 'writer', mosheet: 'sheets', csv: 'sheets', moslides: 'slides', docx: 'writer', xlsx: 'sheets', pptx: 'slides' };
  const BINARY_EXT = ['docx', 'xlsx', 'pptx'];
  const LETTER = { writer: 'T', sheets: 'F', slides: 'D' };
  const docs = {};
  let current = 'home';

  const $ = (sel) => document.querySelector(sel);
  const baseName = (name) => name.replace(/\.[^.]+$/, '');

  function titleOf(id) {
    const d = docs[id];
    return d.name ? baseName(d.name) : MO.modules[id].defaultName + ' sem título';
  }

  function updateChrome() {
    const inModule = current !== 'home';
    if (inModule) {
      const d = docs[current];
      const state = d.dirty ? ' • Por guardar' : d.path || d.name ? ' • Guardado' : '';
      $('#app-name').textContent = MO.modules[current].label;
      $('#doc-title').textContent = titleOf(current) + state;
      document.title = `${titleOf(current)}${d.dirty ? ' •' : ''} — ${MO.BRAND.name}`;
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

  function show(id) {
    current = id;
    document.querySelectorAll('.view').forEach((view) => (view.hidden = view.id !== 'view-' + id));
    document.body.dataset.current = id;
    closeLauncher();
    closeBackstage();
    if (id === 'home') {
      greet();
      refreshRecent();
    }
    else MO.modules[id].show();
    updateChrome();
  }

  const confirmDiscard = (id) =>
    !docs[id].dirty || window.confirm(`"${titleOf(id)}" tem alterações por guardar. Quer mesmo descartá-las?`);

  // ---------- Ficheiros ----------

  function newDoc() {
    if (current === 'home' || !confirmDiscard(current)) return;
    MO.modules[current].newDoc();
    docs[current] = { path: null, name: null, dirty: false };
    dropDraft(current);
    MO.modules[current].show();
    updateChrome();
  }

  function loadFile(file) {
    if (!file) return;
    if (file.error) return MO.toast(file.error);
    const ext = file.name.split('.').pop().toLowerCase();
    const id = Object.hasOwn(EXT_MODULE, ext) ? EXT_MODULE[ext] : null;
    if (!id) return MO.toast('Tipo de ficheiro não suportado.');
    if (!confirmDiscard(id)) return;
    const mod = MO.modules[id];
    try {
      if (BINARY_EXT.includes(ext) !== file.content instanceof Uint8Array) throw new Error('Tipo de conteúdo inesperado');
      mod.load(file.content, ext);
    } catch {
      return MO.toast(`Não foi possível abrir "${file.name}": o ficheiro não é válido.`);
    }
    // Ficheiros importados (HTML, TXT, CSV) são guardados depois no formato próprio.
    const native = ext === mod.ext;
    docs[id] = { path: native ? file.path : null, name: file.name, dirty: false };
    dropDraft(id);
    show(id);
  }

  async function openFile() {
    if (api) return loadFile(await api.open());
    const picked = await MO.pickFile({ accept: Object.keys(EXT_MODULE).map((e) => '.' + e).join(','), binaryExt: BINARY_EXT });
    if (picked) loadFile({ path: null, name: picked.name, content: picked.content });
  }

  async function save(saveAs) {
    if (current === 'home') return;
    const id = current;
    const mod = MO.modules[id];
    const d = docs[id];
    const content = mod.serialize();
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
      MO.download(defaultName, content, 'application/json');
      d.name = defaultName;
    }
    d.dirty = false;
    dropDraft(id);
    updateChrome();
    MO.toast('Guardado.');
  }

  async function exportAs(exp) {
    const id = current;
    const title = titleOf(id);
    const name = title + '.' + exp.ext;
    let content;
    try {
      content = exp.get(title);
    } catch {
      return MO.toast('Não foi possível exportar o documento.');
    }
    if (!api) return MO.download(name, content, exp.mime);
    const res = await api.save({ path: null, content, defaultName: name, filters: [{ name: exp.filterName, extensions: [exp.ext] }], remember: false });
    if (res && res.error) MO.toast(res.error);
    else if (res) MO.toast(`Exportado para ${res.name}.`);
  }

  async function exportPdf() {
    if (current === 'home') return;
    const { node, page, margin } = MO.modules[current].print();
    const area = $('#print-area');
    $('#print-page').textContent = `@page { size: ${page}; margin: ${margin}; }`;
    area.replaceChildren(node);
    try {
      if (api) {
        const res = await api.exportPdf({ defaultName: titleOf(current) + '.pdf' });
        if (res && res.error) MO.toast(res.error);
        else if (res) MO.toast(`Exportado para ${res.name}.`);
      } else {
        window.print();
      }
    } finally {
      area.replaceChildren();
    }
  }

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
    if (current !== 'home') MO.modules[current].show();
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
              h('span', { class: 'app-tile ' + id }, LETTER[id]),
              h('span', { class: 'recent-name' }, item.name),
              h('span', { class: 'recent-path' }, item.path)
            )
          );
        })
      )
    );
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
      if (!docs[id].dirty) continue;
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
    const drafts = await api.drafts.list();
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
          } catch {
            MO.toast('Não foi possível recuperar um dos documentos.');
          }
        }
        if (last) show(last);
        updateChrome();
      } else {
        api.drafts.clear();
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
    const hour = new Date().getHours();
    $('#greeting').textContent = hour < 6 ? 'Boa noite' : hour < 13 ? 'Bom dia' : hour < 20 ? 'Boa tarde' : 'Boa noite';
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
    const actions = { new: newDoc, open: openFile, save: () => save(false), saveAs: () => save(true), exportPdf, about, license: licenseDialog, closeFile: closeBackstage };
    if (actions[action]) {
      closeBackstage();
      actions[action]();
    } else if (action === 'home' || MO.modules[action]) {
      show(action);
    }
  }

  function init() {
    document.querySelectorAll('[data-icon]').forEach((el) => el.prepend(MO.icon(el.dataset.icon)));
    initMode();

    for (const id of ORDER) {
      docs[id] = { path: null, name: null, dirty: false };
      MO.modules[id].init($('#view-' + id), {
        dirty() {
          stale.add(id);
          if (docs[id].dirty) return;
          docs[id].dirty = true;
          updateChrome();
        },
        file: openBackstage
      });
      MO.modules[id].newDoc();
    }

    document.addEventListener('click', (e) => {
      const viewBtn = e.target.closest('[data-view]');
      const actionBtn = e.target.closest('[data-action]');
      if (viewBtn) show(viewBtn.dataset.view);
      else if (actionBtn) run(actionBtn.dataset.action);
      if (!e.target.closest('.menu-wrap')) closeLauncher();
    });
    $('#launcher').addEventListener('click', toggleLauncher);

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
        if (view === 'writer' || view === 'sheets' || view === 'slides') show(view);
      });
      api.ready();
      initLicense();
      initRecovery();
    } else {
      document.addEventListener('keydown', (e) => {
        if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
        const action = { s: e.shiftKey ? 'saveAs' : 'save', o: 'open', p: 'exportPdf' }[e.key.toLowerCase()];
        if (!action) return;
        e.preventDefault();
        run(action);
      });
      window.addEventListener('beforeunload', (e) => {
        if (ORDER.some((id) => docs[id].dirty)) e.preventDefault();
      });
    }

    show('home');
  }

  init();
})();
