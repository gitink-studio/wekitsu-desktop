import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("api", {
    ping: () => "pong",
});

contextBridge.exposeInMainWorld('versions', {
    node: () => process.versions.node,
    chrome: () => process.versions.chrome,
    electron: () => process.versions.electron
});

contextBridge.exposeInMainWorld('electronAPI', {
    openExplorer: (path: string) => ipcRenderer.invoke('open-path', path),
    getSettings: () => ipcRenderer.invoke('get-settings'),
    saveSettings: (settings: { workspacePath: string, remotePath: string }) => ipcRenderer.invoke('save-settings', settings),
    selectDirectory: () => ipcRenderer.invoke('select-directory')
});
