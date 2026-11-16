'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  open: () => ipcRenderer.invoke('file:open'),
  openRecent: (path) => ipcRenderer.invoke('file:openRecent', path),
  save: (opts) => ipcRenderer.invoke('file:save', opts),
  exportPdf: (opts) => ipcRenderer.invoke('file:exportPdf', opts),
  getRecent: () => ipcRenderer.invoke('recent:get'),
  ai: {
    status: () => ipcRenderer.invoke('ai:status'),
    download: (id) => ipcRenderer.invoke('ai:download', id),
    cancel: () => ipcRenderer.invoke('ai:cancel'),
    remove: (id) => ipcRenderer.invoke('ai:remove', id),
    generate: (input) => ipcRenderer.invoke('ai:generate', input),
    suggest: (input) => ipcRenderer.invoke('ai:suggest', input),
    onEvent: (callback) => ipcRenderer.on('ai:event', (_event, message) => callback(message))
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
  onOpenView: (callback) => ipcRenderer.on('open-view', (_event, view) => callback(view))
});
