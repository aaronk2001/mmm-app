const { contextBridge, ipcRenderer } = require('electron');

// Expose a safe, minimal API to the renderer.
contextBridge.exposeInMainWorld('mmm', {
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  platform: process.platform,
});
