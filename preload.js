'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  open: () => ipcRenderer.invoke('file:open'),
  openRecent: (path) => ipcRenderer.invoke('file:openRecent', path),
  save: (opts) => ipcRenderer.invoke('file:save', opts),
  exportPdf: (opts) => ipcRenderer.invoke('file:exportPdf', opts),
  printPreview: (opts) => ipcRenderer.invoke('file:printPreview', opts),
  print: () => ipcRenderer.invoke('file:print'),
  getRecent: () => ipcRenderer.invoke('recent:get'),
  ai: {
    generate: (input) => ipcRenderer.invoke('ai:generate', input),
    suggest: (input) => ipcRenderer.invoke('ai:suggest', input),
    assist: (input) => ipcRenderer.invoke('ai:assist', input)
  },
  drafts: {
    save: (draft) => ipcRenderer.invoke('draft:save', draft),
    list: () => ipcRenderer.invoke('draft:list'),
    clear: (id) => ipcRenderer.invoke('draft:clear', id)
  },
  setDirty: (value) => ipcRenderer.send('app:dirty', Boolean(value)),
  ready: () => ipcRenderer.send('app:ready'),
  license: {
    status: () => ipcRenderer.invoke('license:status'),
    activate: (key) => ipcRenderer.invoke('license:activate', key)
  },
  onMenu: (callback) => ipcRenderer.on('menu', (_event, action) => callback(action)),
  onOpenFile: (callback) => ipcRenderer.on('open-file', (_event, file) => callback(file)),
  onOpenView: (callback) => ipcRenderer.on('open-view', (_event, view) => callback(view)),
  // Cada programa vive na sua janela.
  openApp: (id, template) => ipcRenderer.send('app:open', id, template),
  openPath: (p) => ipcRenderer.send('app:openPath', p),
  deliver: (id, action) => ipcRenderer.send('app:deliver', id, action),
  contentOf: (id) => ipcRenderer.invoke('app:content', id),
  onTemplate: (callback) => ipcRenderer.on('open-template', (_event, template) => callback(template)),
  onDeliver: (callback) => ipcRenderer.on('deliver', (_event, action) => callback(action)),
  onContentRequest: (callback) => ipcRenderer.on('content-request', (_event, id) => ipcRenderer.send('app:contentReply', id, callback()))
});
