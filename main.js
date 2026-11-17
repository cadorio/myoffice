'use strict';

const { app, BrowserWindow, Menu, dialog, ipcMain, session } = require('electron');
const { fileURLToPath } = require('url');
const license = require('./license').createManager(app);
const ai = require('./ai');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');

const NATIVE_EXT = ['modoc', 'mosheet', 'moslides'];
// Formatos do Word, Excel e PowerPoint: são binários (ZIP) e convertidos na interface.
const BINARY_EXT = ['docx', 'xlsx', 'pptx'];
const OPEN_EXT = [...NATIVE_EXT, ...BINARY_EXT, 'html', 'htm', 'txt', 'csv'];
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_RECENT = 8;
const APP_ROOT = path.join(__dirname, 'src') + path.sep;

let win = null;
let dirty = false;
let rendererReady = false;
let pendingFile = null;
let pendingView = null;
let recent = [];
// Caminhos escolhidos pelo utilizador num diálogo; só estes podem ser reescritos sem perguntar.
const approvedPaths = new Set();

const extOf = (p) => path.extname(p).slice(1).toLowerCase();
const recentFile = () => path.join(app.getPath('userData'), 'recent.json');

function viewFromArgv(argv) {
  const args = new Set(argv);
  for (const id of ['writer', 'sheets', 'slides']) {
    if (args.has('--' + id)) return id;
  }
  return null;
}

function fileFromArgv(argv) {
  for (const arg of argv.slice(1).reverse()) {
    if (arg.startsWith('-')) continue;
    if (!OPEN_EXT.includes(extOf(arg))) continue;
    const full = path.resolve(arg);
    if (fsSync.existsSync(full)) return full;
  }
  return null;
}

async function loadRecent() {
  try {
    const list = JSON.parse(await fs.readFile(recentFile(), 'utf8'));
    // O ficheiro pode ter sido alterado fora da aplicação: só entram caminhos absolutos de documentos próprios.
    if (Array.isArray(list)) {
      recent = list.filter((p) => typeof p === 'string' && path.isAbsolute(p) && NATIVE_EXT.includes(extOf(p))).slice(0, MAX_RECENT);
    }
  } catch {
    recent = [];
  }
}

async function addRecent(p) {
  if (!NATIVE_EXT.includes(extOf(p))) return;
  recent = [p, ...recent.filter((x) => x !== p)].slice(0, MAX_RECENT);
  app.addRecentDocument(p);
  try {
    await writeAtomic(recentFile(), JSON.stringify(recent));
  } catch {
    /* a lista de recentes é apenas uma conveniência */
  }
}

// Escreve primeiro num ficheiro temporário e só depois substitui o destino, para que uma falha
// a meio (disco cheio, corte de energia) não deixe o documento do utilizador truncado.
async function writeAtomic(target, data) {
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(tmp, data, typeof data === 'string' ? { encoding: 'utf8', mode: 0o600 } : { mode: 0o600 });
    await fs.rename(tmp, target);
  } catch (error) {
    await fs.rm(tmp, { force: true });
    throw error;
  }
}

async function readDocument(p) {
  if (!OPEN_EXT.includes(extOf(p))) return { error: 'Tipo de ficheiro não suportado.' };
  try {
    const stat = await fs.stat(p);
    if (stat.size > MAX_FILE_BYTES) return { error: 'O ficheiro é demasiado grande.' };
    const content = BINARY_EXT.includes(extOf(p)) ? new Uint8Array(await fs.readFile(p)) : await fs.readFile(p, 'utf8');
    approvedPaths.add(p);
    await addRecent(p);
    return { path: p, name: path.basename(p), content };
  } catch {
    return { error: 'Não foi possível ler o ficheiro.' };
  }
}

async function openInRenderer(p) {
  if (!win || !rendererReady) {
    pendingFile = p;
    return;
  }
  win.webContents.send('open-file', await readDocument(p));
}

function openViewInRenderer(view) {
  if (!['writer', 'sheets', 'slides'].includes(view)) return;
  if (!win || !rendererReady) {
    pendingView = view;
    return;
  }
  win.webContents.send('open-view', view);
}

function sendMenu(action) {
  if (win) win.webContents.send('menu', action);
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const item = (label, action, accelerator) => ({ label, accelerator, click: () => sendMenu(action) });
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'Ficheiro',
      submenu: [
        item('Novo', 'new', 'CmdOrCtrl+N'),
        item('Abrir…', 'open', 'CmdOrCtrl+O'),
        { type: 'separator' },
        item('Guardar', 'save', 'CmdOrCtrl+S'),
        item('Guardar como…', 'saveAs', 'CmdOrCtrl+Shift+S'),
        item('Exportar como PDF…', 'exportPdf', 'CmdOrCtrl+P'),
        { type: 'separator' },
        isMac ? { role: 'close', label: 'Fechar' } : { role: 'quit', label: 'Sair' }
      ]
    },
    {
      label: 'Editar',
      submenu: [
        { role: 'cut', label: 'Cortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Colar' },
        { role: 'selectAll', label: 'Selecionar tudo' }
      ]
    },
    {
      label: 'Ver',
      submenu: [
        item('Início', 'home', 'CmdOrCtrl+0'),
        item('Texto', 'writer', 'CmdOrCtrl+1'),
        item('Folhas', 'sheets', 'CmdOrCtrl+2'),
        item('Diapositivos', 'slides', 'CmdOrCtrl+3'),
        { type: 'separator' },
        { role: 'zoomIn', label: 'Aumentar zoom' },
        { role: 'zoomOut', label: 'Diminuir zoom' },
        { role: 'resetZoom', label: 'Zoom normal', accelerator: 'CmdOrCtrl+Alt+0' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Ecrã inteiro' },
        // As ferramentas de programador só existem em desenvolvimento, nunca na aplicação instalada.
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools', label: 'Ferramentas de programador' }])
      ]
    },
    {
      label: 'Ajuda',
      submenu: [item('Acerca do MyOffice', 'about')]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  rendererReady = false;
  dirty = false;
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    // Branco: esta cor também preenche as margens das páginas exportadas para PDF.
    backgroundColor: '#ffffff',
    title: 'MyOffice',
    icon: process.platform === 'linux' ? path.join(__dirname, 'build', 'icon.png') : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      devTools: !app.isPackaged,
      // Fora do macOS o corretor descarregaria dicionários da Internet; a aplicação não faz pedidos de rede.
      spellcheck: process.platform === 'darwin'
    }
  });

  win.loadFile(path.join(__dirname, 'src', 'index.html'));

  // A aplicação é uma única página local: nunca navega nem abre janelas.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  win.on('close', (e) => {
    if (!dirty) return;
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Cancelar', 'Sair sem guardar'],
      defaultId: 0,
      cancelId: 0,
      message: 'Existem alterações por guardar.',
      detail: 'Se sair agora, essas alterações serão perdidas.'
    });
    if (choice === 0) e.preventDefault();
    // O utilizador escolheu descartar as alterações. Síncrono, porque a aplicação termina logo a seguir.
    else for (const id of DRAFT_MODULES) fsSync.rmSync(draftFile(id), { force: true });
  });

  // Se a página deixar de responder, o utilizador pode esperar ou recarregar; os rascunhos de
  // recuperação automática permitem retomar o trabalho depois de recarregar.
  win.on('unresponsive', () => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Esperar', 'Recarregar'],
      defaultId: 0,
      cancelId: 0,
      message: 'A aplicação não está a responder.',
      detail: 'Pode esperar que termine ou recarregar. Ao recarregar, as alterações desde a última recuperação automática (até 30 segundos) perdem-se.'
    });
    if (choice === 1 && win) {
      dirty = false;
      rendererReady = false;
      win.webContents.forcefullyCrashRenderer();
      win.reload();
    }
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit' || !win) return;
    dirty = false;
    rendererReady = false;
    win.reload();
  });

  win.on('closed', () => {
    win = null;
  });
}

// Só a página principal da nossa janela pode usar o IPC (nunca um iframe ou outra origem).
function fromOurWindow(event) {
  return Boolean(win) && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame;
}

// ---------- Recuperação automática ----------
// A interface envia de 30 em 30 segundos uma cópia dos documentos com alterações por guardar.
const DRAFT_MODULES = ['writer', 'sheets', 'slides'];
const draftFile = (id) => path.join(app.getPath('userData'), 'drafts', id + '.json');

async function saveDraft(draft) {
  if (!draft || !DRAFT_MODULES.includes(draft.module) || typeof draft.content !== 'string' || draft.content.length > MAX_FILE_BYTES) return false;
  try {
    await fs.mkdir(path.dirname(draftFile(draft.module)), { recursive: true });
    const name = typeof draft.name === 'string' ? draft.name.slice(0, 255) : null;
    const origin = typeof draft.path === 'string' && approvedPaths.has(draft.path) ? draft.path : null;
    await writeAtomic(draftFile(draft.module), JSON.stringify({ name, path: origin, saved: Date.now(), content: draft.content }));
    return true;
  } catch {
    return false;
  }
}

async function listDrafts() {
  const out = [];
  for (const id of DRAFT_MODULES) {
    try {
      const draft = JSON.parse(await fs.readFile(draftFile(id), 'utf8'));
      if (typeof draft.content !== 'string') continue;
      // O caminho original só é devolvido se ainda existir; volta a ficar autorizado para gravação.
      let origin = null;
      if (typeof draft.path === 'string' && NATIVE_EXT.includes(extOf(draft.path)) && fsSync.existsSync(draft.path)) {
        origin = draft.path;
        approvedPaths.add(origin);
      }
      out.push({ module: id, name: typeof draft.name === 'string' ? draft.name : null, path: origin, saved: Number(draft.saved) || 0, content: draft.content });
    } catch {
      /* sem rascunho para este módulo */
    }
  }
  return out;
}

async function clearDrafts(id) {
  for (const module of id ? [id] : DRAFT_MODULES) {
    if (DRAFT_MODULES.includes(module)) await fs.rm(draftFile(module), { force: true }).catch(() => {});
  }
}

const SAVE_EXT = [...NATIVE_EXT, ...BINARY_EXT, 'html', 'txt', 'csv'];
function cleanExt(filters) {
  const ext = Array.isArray(filters) && filters[0] && Array.isArray(filters[0].extensions) ? String(filters[0].extensions[0]).toLowerCase() : '';
  return SAVE_EXT.includes(ext) ? ext : null;
}

// A aplicação é só uma página local. Bloqueia todos os pedidos de rede e a leitura de ficheiros
// fora da pasta da interface, mesmo que algum conteúdo malicioso chegasse a ser carregado.
function lockDownSession() {
  const ses = session.defaultSession;
  ses.webRequest.onBeforeRequest((details, callback) => {
    let allowed = /^(data|blob|devtools|chrome-devtools):/i.test(details.url);
    if (!allowed && details.url.startsWith('file:')) {
      try {
        allowed = fileURLToPath(details.url).startsWith(APP_ROOT);
      } catch {
        allowed = false;
      }
    }
    callback({ cancel: !allowed });
  });
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === 'fullscreen'));
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'fullscreen');
}

const LICENSE_BLOCK = 'O período experimental terminou. Ative uma licença em Ficheiro › Licença para guardar e exportar.';

function registerIpc() {
  ai.register(ipcMain, fromOurWindow);
  ipcMain.handle('license:status', (event) => (fromOurWindow(event) ? license.status() : null));
  ipcMain.handle('license:activate', (event, key) => (fromOurWindow(event) ? license.activate(key) : null));

  ipcMain.on('app:ready', (event) => {
    if (!fromOurWindow(event)) return;
    rendererReady = true;
    if (pendingFile) {
      const p = pendingFile;
      pendingFile = null;
      openInRenderer(p);
    } else if (pendingView) {
      const view = pendingView;
      pendingView = null;
      win.webContents.send('open-view', view);
    }
  });

  ipcMain.handle('draft:save', (event, draft) => (fromOurWindow(event) ? saveDraft(draft) : false));
  ipcMain.handle('draft:list', (event) => (fromOurWindow(event) ? listDrafts() : []));
  ipcMain.handle('draft:clear', (event, id) => (fromOurWindow(event) ? clearDrafts(typeof id === 'string' ? id : null) : null));

  ipcMain.on('app:dirty', (event, value) => {
    if (fromOurWindow(event)) dirty = Boolean(value);
  });

  ipcMain.handle('recent:get', async (event) => {
    if (!fromOurWindow(event)) return [];
    const alive = [];
    for (const p of recent) {
      try {
        await fs.access(p);
        alive.push({ path: p, name: path.basename(p) });
      } catch {
        /* o ficheiro já não existe */
      }
    }
    return alive;
  });

  ipcMain.handle('file:open', async (event) => {
    if (!fromOurWindow(event)) return null;
    const res = await dialog.showOpenDialog(win, {
      title: 'Abrir',
      properties: ['openFile'],
      filters: [
        { name: 'Ficheiros suportados', extensions: OPEN_EXT },
        { name: 'Documentos MyOffice', extensions: NATIVE_EXT },
        { name: 'Word, Excel e PowerPoint', extensions: BINARY_EXT }
      ]
    });
    if (res.canceled || !res.filePaths[0]) return null;
    return readDocument(res.filePaths[0]);
  });

  ipcMain.handle('file:openRecent', async (event, p) => {
    if (!fromOurWindow(event)) return null;
    if (typeof p !== 'string' || !recent.includes(p)) return { error: 'Ficheiro desconhecido.' };
    return readDocument(p);
  });

  ipcMain.handle('file:save', async (event, opts) => {
    if (!fromOurWindow(event) || !opts) return null;
    if (!(await license.status()).canSave) return { error: LICENSE_BLOCK };
    const binary = opts.content instanceof Uint8Array;
    if (!binary && typeof opts.content !== 'string') return null;
    if (opts.content.length > MAX_FILE_BYTES) return { error: 'O documento é demasiado grande para ser guardado.' };
    const ext = cleanExt(opts.filters);
    if (!ext) return null;
    // O conteúdo tem de corresponder ao tipo: binário só nos formatos ZIP, texto nos restantes.
    if (binary !== BINARY_EXT.includes(ext)) return null;
    const filters = [{ name: String(opts.filters[0].name || ext).slice(0, 60), extensions: [ext] }];
    // Escrita direta só em documentos próprios que o utilizador já abriu ou guardou; tudo o resto passa pelo diálogo.
    const direct = typeof opts.path === 'string' && approvedPaths.has(opts.path) && NATIVE_EXT.includes(extOf(opts.path));
    let target = direct ? opts.path : null;

    if (!target) {
      const res = await dialog.showSaveDialog(win, {
        title: 'Guardar',
        defaultPath: path.basename(String(opts.defaultName || 'Sem título')),
        filters
      });
      if (res.canceled || !res.filePath) return null;
      target = res.filePath;
      const chosenExt = path.extname(target).toLowerCase();
      if (chosenExt !== '.' + ext) {
        target = chosenExt ? target.slice(0, -chosenExt.length) + '.' + ext : target + '.' + ext;
      }
    }

    try {
      await writeAtomic(target, binary ? Buffer.from(opts.content.buffer, opts.content.byteOffset, opts.content.byteLength) : opts.content);
    } catch {
      return { error: 'Não foi possível guardar o ficheiro.' };
    }
    if (opts.remember) {
      approvedPaths.add(target);
      await addRecent(target);
    }
    return { path: target, name: path.basename(target) };
  });

  ipcMain.handle('file:exportPdf', async (event, opts) => {
    if (!fromOurWindow(event)) return null;
    if (!(await license.status()).canSave) return { error: LICENSE_BLOCK };
    const res = await dialog.showSaveDialog(win, {
      title: 'Exportar como PDF',
      defaultPath: path.basename(String((opts && opts.defaultName) || 'Documento.pdf')),
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });
    if (res.canceled || !res.filePath) return null;
    const target = path.extname(res.filePath) ? res.filePath : res.filePath + '.pdf';
    try {
      // O tamanho e as margens da página vêm da regra @page definida pela aplicação.
      const data = await win.webContents.printToPDF({
        printBackground: true,
        preferCSSPageSize: true,
        margins: { top: 0, bottom: 0, left: 0, right: 0 }
      });
      await writeAtomic(target, data);
    } catch {
      return { error: 'Não foi possível criar o PDF.' };
    }
    return { path: target, name: path.basename(target) };
  });
}

// Nenhum conteúdo pode criar webviews, navegar ou abrir janelas.
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.on('will-navigate', (event) => event.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  pendingFile = fileFromArgv(process.argv);
  pendingView = pendingFile ? null : viewFromArgv(process.argv);

  app.on('second-instance', (_event, argv) => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
    const p = fileFromArgv(argv);
    if (p) openInRenderer(p);
    else {
      const view = viewFromArgv(argv);
      if (view) openViewInRenderer(view);
    }
  });

  // macOS: ficheiro aberto a partir do Finder.
  app.on('open-file', (event, p) => {
    event.preventDefault();
    if (app.isReady() && !win) createWindow();
    openInRenderer(p);
  });

  app.whenReady().then(async () => {
    lockDownSession();
    await loadRecent();
    registerIpc();
    buildMenu();
    createWindow();

    app.on('activate', () => {
      if (!win) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
