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
  license: {
    status: () => ipcRenderer.invoke('license:status'),
    activate: (key) => ipcRenderer.invoke('license:activate', key)
  },
  onMenu: (callback) => ipcRenderer.on('menu', (_event, action) => callback(action)),
  onOpenFile: (callback) => ipcRenderer.on('open-file', (_event, file) => callback(file))
});
