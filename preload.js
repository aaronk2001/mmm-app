const { contextBridge, ipcRenderer } = require('electron');

// Expose a safe, minimal API to the renderer.
contextBridge.exposeInMainWorld('mmm', {
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  platform: process.platform,
  // Daily-driver preferences (persisted by the main process).
  getPrefs: () => ipcRenderer.invoke('get-desktop-prefs'),
  setLaunchOnBoot: (enabled) => ipcRenderer.invoke('set-launch-on-boot', !!enabled),
  setCloseToTray: (enabled) => ipcRenderer.invoke('set-close-to-tray', !!enabled),
  // Native OS notification for a critical coach finding — reaches the user even
  // when MMM is minimized to the tray.
  notify: (payload) => ipcRenderer.invoke('coach-notify', payload),
  // Online & Keys (Sprint A, Track 1). get() returns presence booleans only —
  // never a key value. set(provider, '') deletes that provider's key.
  secrets: {
    get: () => ipcRenderer.invoke('secrets:get'),
    set: (provider, value) => ipcRenderer.invoke('secrets:set', { provider, value }),
  },
});
