'use strict';

const { app, BrowserWindow, Menu, dialog, ipcMain, session, shell } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');

const NATIVE_EXT = ['modoc', 'mosheet', 'moslides'];
const OPEN_EXT = [...NATIVE_EXT, 'html', 'htm', 'txt', 'csv'];
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_RECENT = 8;

let win = null;
let dirty = false;
let rendererReady = false;
let pendingFile = null;
let recent = [];
// Caminhos escolhidos pelo utilizador num diálogo; só estes podem ser reescritos sem perguntar.
const approvedPaths = new Set();

const extOf = (p) => path.extname(p).slice(1).toLowerCase();
const recentFile = () => path.join(app.getPath('userData'), 'recent.json');

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
    if (Array.isArray(list)) recent = list.filter((p) => typeof p === 'string').slice(0, MAX_RECENT);
  } catch {
    recent = [];
  }
}

async function addRecent(p) {
  if (!NATIVE_EXT.includes(extOf(p))) return;
  recent = [p, ...recent.filter((x) => x !== p)].slice(0, MAX_RECENT);
  app.addRecentDocument(p);
  try {
    await fs.writeFile(recentFile(), JSON.stringify(recent));
  } catch {
    /* a lista de recentes é apenas uma conveniência */
  }
}

async function readDocument(p) {
  if (!OPEN_EXT.includes(extOf(p))) return { error: 'Tipo de ficheiro não suportado.' };
  try {
    const stat = await fs.stat(p);
    if (stat.size > MAX_FILE_BYTES) return { error: 'O ficheiro é demasiado grande.' };
    const content = await fs.readFile(p, 'utf8');
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
        { role: 'toggleDevTools', label: 'Ferramentas de programador' }
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
      spellcheck: true
    }
  });

  win.loadFile(path.join(__dirname, 'src', 'index.html'));

  // A aplicação é uma única página local: nunca navega nem abre janelas.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

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
  });

  win.on('closed', () => {
    win = null;
  });
}

function fromOurWindow(event) {
  return win && event.sender === win.webContents;
}

function registerIpc() {
  ipcMain.on('app:ready', (event) => {
    if (!fromOurWindow(event)) return;
    rendererReady = true;
    if (pendingFile) {
      const p = pendingFile;
      pendingFile = null;
      openInRenderer(p);
    }
  });

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
        { name: 'Documentos MyOffice', extensions: NATIVE_EXT }
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
    if (!fromOurWindow(event) || !opts || typeof opts.content !== 'string') return null;
    const filters = Array.isArray(opts.filters) ? opts.filters : [];
    const ext = filters[0] && filters[0].extensions && String(filters[0].extensions[0] || '');
    let target = typeof opts.path === 'string' && approvedPaths.has(opts.path) ? opts.path : null;

    if (!target) {
      const res = await dialog.showSaveDialog(win, {
        title: 'Guardar',
        defaultPath: path.basename(String(opts.defaultName || 'Sem título')),
        filters
      });
      if (res.canceled || !res.filePath) return null;
      target = res.filePath;
      if (ext && !path.extname(target)) target += '.' + ext;
    }

    try {
      await fs.writeFile(target, opts.content, 'utf8');
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
      await fs.writeFile(target, data);
    } catch {
      return { error: 'Não foi possível criar o PDF.' };
    }
    return { path: target, name: path.basename(target) };
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  pendingFile = fileFromArgv(process.argv);

  app.on('second-instance', (_event, argv) => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
    const p = fileFromArgv(argv);
    if (p) openInRenderer(p);
  });

  // macOS: ficheiro aberto a partir do Finder.
  app.on('open-file', (event, p) => {
    event.preventDefault();
    if (app.isReady() && !win) createWindow();
    openInRenderer(p);
  });

  app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(permission === 'fullscreen');
    });
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
