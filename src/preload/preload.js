'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  checklist: {
    get: () => ipcRenderer.invoke('checklist:get'),
    toggle: (id, value) => ipcRenderer.invoke('checklist:toggle', id, value),
    finish: () => ipcRenderer.invoke('checklist:finish'),
    emergency: (payload) => ipcRenderer.invoke('checklist:emergency', payload),
    onUpdate: (cb) => {
      const handler = (_e, data) => cb(data);
      ipcRenderer.on('checklist:update', handler);
      return () => ipcRenderer.removeListener('checklist:update', handler);
    },
  },
  settings: {
    open: () => ipcRenderer.invoke('settings:open'),
    get: () => ipcRenderer.invoke('settings:get'),
    save: (patch) => ipcRenderer.invoke('settings:save', patch),
    dataPath: () => ipcRenderer.invoke('settings:reveal'),
    exportFile: () => ipcRenderer.invoke('settings:exportFile'),
    importFile: () => ipcRenderer.invoke('settings:importFile'),
    exportCode: () => ipcRenderer.invoke('settings:exportCode'),
    importCode: (code) => ipcRenderer.invoke('settings:importCode', code),
  },
  notify: {
    test: (mode) => ipcRenderer.invoke('notify:test', mode),
  },
  bedtime: {
    get: () => ipcRenderer.invoke('bedtime:get'),
    dismiss: () => ipcRenderer.invoke('bedtime:dismiss'),
    snooze: () => ipcRenderer.invoke('bedtime:snooze'),
    preview: () => ipcRenderer.invoke('bedtime:preview'),
    onRefresh: (cb) => {
      const handler = () => cb();
      ipcRenderer.on('bedtime:refresh', handler);
      return () => ipcRenderer.removeListener('bedtime:refresh', handler);
    },
  },
  events: {
    list: () => ipcRenderer.invoke('events:list'),
    add: (payload) => ipcRenderer.invoke('events:add', payload),
    update: (id, patch) => ipcRenderer.invoke('events:update', id, patch),
    remove: (id) => ipcRenderer.invoke('events:delete', id),
    openCalendar: () => ipcRenderer.invoke('events:openCalendar'),
    onChange: (cb) => {
      const handler = (_e, data) => cb(data);
      ipcRenderer.on('events:changed', handler);
      return () => ipcRenderer.removeListener('events:changed', handler);
    },
  },
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    close: () => ipcRenderer.invoke('window:close'),
  },
});
