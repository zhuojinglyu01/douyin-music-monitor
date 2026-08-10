const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  getConfig: () => ipcRenderer.invoke("get-config"),
  saveConfig: (patch) => ipcRenderer.invoke("save-config", patch),
  getRising: () => ipcRenderer.invoke("get-rising"),
  getLog: () => ipcRenderer.invoke("get-log"),
  getStatus: () => ipcRenderer.invoke("get-status"),
  start: () => ipcRenderer.invoke("start"),
  stop: () => ipcRenderer.invoke("stop"),
  login: () => ipcRenderer.invoke("login"),
});
