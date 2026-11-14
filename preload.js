'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  open: () => ipcRenderer.invoke('file:open'),
  openRecent: (path) => ipcRenderer.invoke('file:openRecent', path),
  save: (opts) => ipcRenderer.invoke('file:save', opts),
  exportPdf: (opts) => ipcRenderer.invoke('file:exportPdf', opts),
  getRecent: () => ipcRenderer.invoke('recent:get'),
  setDirty: (value) => ipcRenderer.send('app:dirty', Boolean(value)),
  ready: () => ipcRenderer.send('app:ready'),
  ai: {
    status: () => ipcRenderer.invoke('ai:status'),
    setKey: (key) => ipcRenderer.invoke('ai:setKey', key),
    generate: (input) => ipcRenderer.invoke('ai:generate', input),
    suggest: (input) => ipcRenderer.invoke('ai:suggest', input)
  },
  onMenu: (callback) => ipcRenderer.on('menu', (_event, action) => callback(action)),
  onOpenFile: (callback) => ipcRenderer.on('open-file', (_event, file) => callback(file))
});
