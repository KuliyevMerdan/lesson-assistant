const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  startSession: (payload) => ipcRenderer.invoke('start-session', payload),
  askManual: (payload) => ipcRenderer.invoke('ask-manual', payload),
  onSttLine: (cb) => ipcRenderer.on('stt-line', (_e, text) => cb(text)),
  onAnswer: (cb) => ipcRenderer.on('answer', (_e, payload) => cb(payload)),
  onStatus: (cb) => ipcRenderer.on('status', (_e, text) => cb(text)),
});
