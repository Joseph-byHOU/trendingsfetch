const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('trendfetchApi', {
  getConfig: () => ipcRenderer.invoke('app:get-config'),
  saveConfig: (config) => ipcRenderer.invoke('app:save-config', config),
  pickOutputDir: () => ipcRenderer.invoke('app:pick-output-dir'),
  openFolder: (folderPath) => ipcRenderer.invoke('app:open-folder', folderPath),
  loadResults: (outputDir) => ipcRenderer.invoke('app:load-results', outputDir),
  exportCsv: (payload) => ipcRenderer.invoke('app:export-csv', payload),
  startRun: (config) => ipcRenderer.invoke('run:start', config),
  continueManualAuth: () => ipcRenderer.invoke('run:continue-manual-auth'),
  stopRun: () => ipcRenderer.invoke('run:stop'),
  getRunState: () => ipcRenderer.invoke('run:get-state'),
  onLog: (callback) => ipcRenderer.on('run:log', (_event, payload) => callback(payload)),
  onState: (callback) => ipcRenderer.on('run:state', (_event, payload) => callback(payload)),
  offRunListeners: () => {
    ipcRenderer.removeAllListeners('run:log');
    ipcRenderer.removeAllListeners('run:state');
  }
});
