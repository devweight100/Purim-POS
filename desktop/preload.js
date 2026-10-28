const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isDesktop: true,

  // Hardware Printer & Cash Drawer APIs
  getPrinters: () => ipcRenderer.invoke('get-printers'),
  printSilent: (options) => ipcRenderer.invoke('print-silent', options),
  kickDrawer: (options) => ipcRenderer.invoke('kick-drawer', options),

  // Server & App Configuration
  getServerUrl: () => ipcRenderer.invoke('get-server-url'),
  saveServerUrl: (url) => ipcRenderer.invoke('save-server-url', url),
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (cfg) => ipcRenderer.invoke('save-config', cfg),
  testServerUrl: (url) => ipcRenderer.invoke('test-server-url', url),
  openServerConfig: () => ipcRenderer.invoke('open-server-config'),
  loadPosScreen: (url) => ipcRenderer.invoke('load-pos-screen', url),
  scanNetwork: () => ipcRenderer.invoke('scan-network'),
  getLocalIps: () => ipcRenderer.invoke('get-local-ips'),
  onConnectionFailed: (cb) => {
    ipcRenderer.on('connection-failed', (event, data) => cb(data));
  },

  // Window Controls
  toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),
  reloadApp: () => ipcRenderer.invoke('reload-app'),
});
