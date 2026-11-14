'use strict';

// Estrutura comum: navegação entre módulos e gestão de ficheiros.
(function () {
  const MO = window.MO;
  const { h } = MO;
  // Dentro do Electron existe window.api (ver preload.js). Sem ela, a aplicação
  // funciona num browser com transferências e o seletor de ficheiros normal.
  const api = window.api || null;

  const ORDER = ['writer', 'sheets', 'slides'];
  const EXT_MODULE = { modoc: 'writer', html: 'writer', htm: 'writer', txt: 'writer', mosheet: 'sheets', csv: 'sheets', moslides: 'slides' };
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
    $('#doc-actions').classList.toggle('home-only', !inModule);
    if (inModule) {
      const d = docs[current];
      $('#doc-title').textContent = titleOf(current) + (d.dirty ? ' •' : '');
      document.title = `${titleOf(current)}${d.dirty ? ' •' : ''} — MyOffice`;
    } else {
      $('#doc-title').textContent = 'MyOffice';
      document.title = 'MyOffice';
    }
    document.querySelectorAll('.rail-btn').forEach((btn) => {
      const active = btn.dataset.view === current;
      btn.classList.toggle('active', active);
      if (active) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
      const d = docs[btn.dataset.view];
      btn.classList.toggle('dirty', Boolean(d && d.dirty));
    });
    if (api) api.setDirty(ORDER.some((id) => docs[id].dirty));
  }

  function show(id) {
    current = id;
    document.querySelectorAll('.view').forEach((view) => (view.hidden = view.id !== 'view-' + id));
    document.body.dataset.current = id;
    closeExportMenu();
    if (id === 'home') refreshRecent();
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
    MO.modules[current].show();
    updateChrome();
  }

  function loadFile(file) {
    if (!file) return;
    if (file.error) return MO.toast(file.error);
    const ext = file.name.split('.').pop().toLowerCase();
    const id = EXT_MODULE[ext];
    if (!id) return MO.toast('Tipo de ficheiro não suportado.');
    if (!confirmDiscard(id)) return;
    const mod = MO.modules[id];
    try {
      mod.load(file.content, ext);
    } catch {
      return MO.toast(`Não foi possível abrir "${file.name}": o ficheiro não é válido.`);
    }
    // Ficheiros importados (HTML, TXT, CSV) são guardados depois no formato próprio.
    const native = ext === mod.ext;
    docs[id] = { path: native ? file.path : null, name: file.name, dirty: false };
    show(id);
  }

  async function openFile() {
    if (api) return loadFile(await api.open());
    const picked = await MO.pickFile({ accept: Object.keys(EXT_MODULE).map((e) => '.' + e).join(',') });
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
    updateChrome();
    MO.toast('Guardado.');
  }

  async function exportAs(exp) {
    const id = current;
    const title = titleOf(id);
    const name = title + '.' + exp.ext;
    const content = exp.get(title);
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

  // ---------- Menu Exportar ----------

  function closeExportMenu() {
    $('#export-menu').hidden = true;
    $('#export-btn').setAttribute('aria-expanded', 'false');
  }

  function toggleExportMenu() {
    const menu = $('#export-menu');
    if (!menu.hidden) return closeExportMenu();
    const items = [
      { label: api ? 'Documento PDF (.pdf)' : 'Imprimir / PDF…', run: exportPdf },
      ...MO.modules[current].exports.map((exp) => ({ label: exp.label, run: () => exportAs(exp) }))
    ];
    menu.replaceChildren(
      ...items.map((item) =>
        h(
          'button',
          {
            type: 'button',
            class: 'menu-item',
            onclick: () => {
              closeExportMenu();
              item.run();
            }
          },
          item.label
        )
      )
    );
    menu.hidden = false;
    $('#export-btn').setAttribute('aria-expanded', 'true');
  }

  // ---------- Recentes (só na aplicação instalada) ----------

  async function refreshRecent() {
    if (!api) return;
    const list = await api.getRecent();
    $('#recent').hidden = !list.length;
    $('#recent-list').replaceChildren(
      ...list.map((item) =>
        h(
          'li',
          null,
          h('button', { type: 'button', class: 'recent-item', title: item.path, onclick: async () => loadFile(await api.openRecent(item.path)) }, item.name)
        )
      )
    );
  }

  // ---------- Ações globais ----------

  function about() {
    MO.dialog({
      title: 'MyOffice',
      message: 'Suite de escritório para desktop: Texto, Folhas e Diapositivos. Os seus documentos ficam apenas no seu computador.',
      cancelLabel: null,
      okLabel: 'Fechar'
    });
  }

  function run(action) {
    const actions = { new: newDoc, open: openFile, save: () => save(false), saveAs: () => save(true), exportPdf, about };
    if (actions[action]) actions[action]();
    else if (action === 'home' || MO.modules[action]) show(action);
  }

  function init() {
    for (const id of ORDER) {
      docs[id] = { path: null, name: null, dirty: false };
      MO.modules[id].init($('#view-' + id), {
        dirty() {
          if (docs[id].dirty) return;
          docs[id].dirty = true;
          updateChrome();
        }
      });
      MO.modules[id].newDoc();
    }

    document.addEventListener('click', (e) => {
      const viewBtn = e.target.closest('[data-view]');
      const actionBtn = e.target.closest('[data-action]');
      if (viewBtn) show(viewBtn.dataset.view);
      else if (actionBtn) run(actionBtn.dataset.action);
      if (!e.target.closest('.menu-wrap')) closeExportMenu();
    });
    $('#export-btn').addEventListener('click', toggleExportMenu);

    if (api) {
      // Os atalhos de teclado vêm do menu da aplicação.
      api.onMenu(run);
      api.onOpenFile(loadFile);
      api.ready();
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
