const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  launchApps: (paths, opts) => ipcRenderer.send('launch-apps', paths, opts),
  registerHotkeys: (keys) => ipcRenderer.send('register-hotkeys', keys),
  setAfkThreshold: (seconds) => ipcRenderer.send('set-afk-threshold', seconds),
  onTriggerSave: (callback) => ipcRenderer.on('trigger-save', callback),
  onTriggerTimer: (callback) => ipcRenderer.on('trigger-timer', callback),
  onAutoLogEp: (callback) => ipcRenderer.on('auto-log-ep', (event, folderPath) => callback(folderPath)),
  onAutoLogYt: (callback) => ipcRenderer.on('auto-log-yt', (_event, data) => callback(data)),
  onAfkPause: (callback) => ipcRenderer.on('afk-pause', callback),
  onAutoLogMokuro: (callback) => ipcRenderer.on('auto-log-mokuro', (event, data) => callback(data)),
  onAppClosed: (callback) => ipcRenderer.on('app-closed', (event, mediaName) => callback(mediaName))
  searchAPI: (opts) => ipcRenderer.invoke('search-api', opts),
});