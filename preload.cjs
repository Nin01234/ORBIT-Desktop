// Deliberately expose no Node or filesystem APIs to the web page.
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("orbitDesktop", Object.freeze({
  isDesktop: true,
  openSpotify: () => ipcRenderer.invoke("orbit:spotify-open"),
  version: process.env.npm_package_version || "1.0.0",
  downloadMedia: item => ipcRenderer.invoke("orbit:offline-download", item),
  listOffline: () => ipcRenderer.invoke("orbit:offline-list"),
  deleteOffline: id => ipcRenderer.invoke("orbit:offline-delete", id),
  onOfflineUpdated: callback => { if (typeof callback === "function") ipcRenderer.on("orbit:offline-updated", (_event, data) => callback(data)); },
  onOmniDownload: callback => { if (typeof callback === "function") ipcRenderer.on("orbit:omni-download", (_event, data) => callback(data)); }
}));
