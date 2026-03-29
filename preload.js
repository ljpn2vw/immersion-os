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
  onAppClosed: (callback) => ipcRenderer.on('app-closed', (event, mediaName) => callback(mediaName)),
  searchAPI: (opts) => ipcRenderer.invoke('search-api', opts),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  // Widget Controls
    launchWidget: (config) => ipcRenderer.invoke('launch-widget', config),
    closeWidget: () => ipcRenderer.send('close-widget'),
    
    // Main App -> Widget
    sendWidgetData: (data) => ipcRenderer.send('send-widget-data', data),
    onWidgetInitConfig: (callback) => ipcRenderer.on('widget-init-config', (event, config) => callback(config)),
    onUpdateWidgetUI: (callback) => ipcRenderer.on('update-widget-ui', (event, data) => callback(data)),
    
    // Widget -> Main App
    sendWidgetAction: (action) => ipcRenderer.send('widget-action', action),
    onTriggerWidgetAction: (callback) => ipcRenderer.on('trigger-widget-action', (event, action) => callback(action)),
	
	getDisplays: () => ipcRenderer.invoke('get-displays'),
	resizeWidget: (size) => ipcRenderer.send('resize-widget', size),
	isWidgetActive: () => ipcRenderer.invoke('is-widget-active'),
	updateTraySetting: (enabled) => ipcRenderer.send('update-tray-setting', enabled),
	toggleReferenceWindow: (data) => ipcRenderer.invoke('toggle-reference-window', data),
	onTriggerDbAlt: (callback) => ipcRenderer.on('trigger-db-alt', () => callback()),
	onTriggerDbMain: (callback) => ipcRenderer.on('trigger-db-main', () => callback()),
});