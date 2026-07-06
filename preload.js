const { contextBridge, ipcRenderer } = require('electron');

// Expose a safe, minimal API to the renderer.
contextBridge.exposeInMainWorld('mmm', {
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  platform: process.platform,
  // Daily-driver preferences (persisted by the main process).
  getPrefs: () => ipcRenderer.invoke('get-desktop-prefs'),
  setLaunchOnBoot: (enabled) => ipcRenderer.invoke('set-launch-on-boot', !!enabled),
  setCloseToTray: (enabled) => ipcRenderer.invoke('set-close-to-tray', !!enabled),
});
