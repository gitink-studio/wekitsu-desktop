import { app, BrowserWindow, ipcMain, shell, Menu, nativeImage, dialog } from "electron";
import path from "path";
import fs from "fs";
import { autoUpdater } from "electron-updater";
import Store from "electron-store";
import dotenv from "dotenv";

dotenv.config({ path: app.isPackaged ? path.join(process.resourcesPath, '.env') : path.join(__dirname, '../.env') });

const store = new Store();

// Connect the auto-updater to the main window for progress events if desired
// autoUpdater.on('update-downloaded', () => {
// autoUpdater.quitAndInstall(); 
// });

const isDev = !app.isPackaged;
let mainWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;

// Simple red dot icon base64 for tray
const iconBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAADFJREFUOE9jZGRk/M+AhYGRkZGEHosGMDQwOAywYAByFNDXAAAAAElFTkSuQmCC';
const icon = nativeImage.createFromDataURL(iconBase64);

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        // Someone tried to run a second instance, we should focus our window.
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            if (!mainWindow.isVisible()) mainWindow.show();
            mainWindow.focus();
        } else if (settingsWindow) {
            if (settingsWindow.isMinimized()) settingsWindow.restore();
            if (!settingsWindow.isVisible()) settingsWindow.show();
            settingsWindow.focus();
        }
    });

    // Create myWindow, load the rest of the app, etc...
    app.whenReady().then(() => {
        setupIpcHandlers();
        createMenu();

        // precise "checkForUpdatesAndNotify" is good for default behavior
        autoUpdater.checkForUpdatesAndNotify();

        checkSettingsAndStart();
    });
}

function checkSettingsAndStart() {
    const workspacePath = store.get("workspacePath") as string | undefined;
    const remotePath = store.get("remotePath") as string | undefined;

    if (workspacePath && remotePath) {
        if (!mainWindow) {
            createWindow();
        }
    } else {
        createSettingsWindow();
    }
}

function setupIpcHandlers() {
    ipcMain.handle('open-path', async (event: any, fullPath: any) => {
        try {
            console.log('opening path', fullPath);
            const workspacePath = store.get("workspacePath") as string | undefined;
            if (!workspacePath) {
                return "Workspace path is not configured.";
            }

            const targetPath = path.join(workspacePath, fullPath);
            // Security check: Ensure path does not contain '..' to prevent directory traversal attacks if not intended
            // const safePath = path.normalize(fullPath).replace(/^(\.\.(\/|\\|$))+/, '');
            const result = await shell.openPath(targetPath);
            if (result) {
                console.error(`Error opening path: ${result}`);
            }
            return result;
        } catch (error) {
            console.error('Failed to open path:', error);
            return error instanceof Error ? error.message : 'Unknown error occurred';
        }
    });

    ipcMain.handle('get-settings', () => {
        return {
            workspacePath: store.get("workspacePath") || "",
            remotePath: store.get("remotePath") || ""
        };
    });

    ipcMain.handle('save-settings', (event, settings: { workspacePath: string, remotePath: string }) => {
        store.set("workspacePath", settings.workspacePath);
        store.set("remotePath", settings.remotePath);

        if (settingsWindow) {
            settingsWindow.close();
        }

        if (!mainWindow) {
            createWindow();
        }

        return { success: true };
    });

    ipcMain.handle('select-directory', async () => {
        if (!settingsWindow) return null;
        const result = await dialog.showOpenDialog(settingsWindow, {
            properties: ['openDirectory']
        });
        if (result.canceled) {
            return null;
        } else {
            return result.filePaths[0];
        }
    });

    ipcMain.handle('check-path-exists', (event, relativePath: string) => {
        const workspacePath = store.get("workspacePath") as string | undefined;
        if (!workspacePath) return false;

        try {
            const fullPath = path.join(workspacePath, relativePath);
            return fs.existsSync(fullPath);
        } catch (error) {
            console.error("Error checking path existence:", error);
            return false;
        }
    });

    ipcMain.handle('SyncFromServer', async (event, relativePath: string) => {
        const workspaceDir = store.get("workspacePath") as string | undefined;
        const remoteDir = store.get("remotePath") as string | undefined;

        if (!workspaceDir || !remoteDir) {
            return { success: false, error: "Paths not configured" };
        }

        const sourcePath = path.join(remoteDir, relativePath);
        const destPath = path.join(workspaceDir, relativePath);

        let progressWindow: BrowserWindow | null = new BrowserWindow({
            width: 400,
            height: 120,
            frame: false,
            parent: mainWindow || undefined,
            modal: !!mainWindow,
            webPreferences: {
                preload: path.join(__dirname, "preload.cjs"),
                nodeIntegration: false,
                contextIsolation: true
            },
            resizable: false,
            alwaysOnTop: true,
            show: false
        });

        progressWindow.loadFile(path.join(__dirname, "sync-progress.html"));

        // Wait for the window to actually be ready to show before blocking/working
        await new Promise<void>((resolve) => {
            if (!progressWindow) return resolve();
            progressWindow.once('ready-to-show', () => {
                progressWindow?.show();
                // Add a tiny delay so the window has time to render its initial state
                setTimeout(resolve, 50);
            });
        });

        // Dynamically import dir-compare and fs-extra to avoid issues if they aren't fully resolved yet, or just require them
        try {
            const dircompare = require('dir-compare');
            const fse = require('fs-extra');

            if (!fse.existsSync(sourcePath)) {
                if (progressWindow) { progressWindow.close(); progressWindow = null; }
                return { success: false, error: "Source path does not exist" };
            }

            // Ensure destination exists asynchronously
            await fse.ensureDir(destPath);

            const options = { compareContent: true, excludeFilter: '.wekitsu' };
            const res = await dircompare.compare(sourcePath, destPath, options);

            if (res.diffSet) {
                for (const dif of res.diffSet) {
                    if (dif.state === 'left' || dif.state === 'distinct') {
                        const src = path.join(dif.path1, dif.name1);
                        const dst = path.join(destPath, dif.relativePath, dif.name1);
                        console.log('syncing', src, 'to', dst);
                        if (progressWindow && !progressWindow.isDestroyed()) {
                            progressWindow.webContents.send('sync-progress', dif.name1);
                        }

                        if (dif.type1 === 'directory') {
                            await fse.ensureDir(dst);
                        } else if (dif.type1 === 'file') {
                            await fse.copy(src, dst, { overwrite: true });
                        }
                    }
                }
            }

            if (progressWindow && !progressWindow.isDestroyed()) { progressWindow.close(); progressWindow = null; }
            return { success: true };
        } catch (error: any) {
            console.error("Error syncing from server:", error);
            if (progressWindow && !progressWindow.isDestroyed()) { progressWindow.close(); progressWindow = null; }
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('api-create-asset', async (event, payload: any) => {
        try {
            const apiUrl = process.env.WEKITSU_API_URL || 'https://wekitsu-api.weloadin.lol';
            const response = await fetch(`${apiUrl}/createAsset`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await response.json();
            return { success: response.ok, data, status: response.status };
        } catch (error: any) {
            console.error('API createAsset error:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('api-snapshot', async (event, payload: {
        taskId: string, type: string, message: string, username?: string, userId?: string, bypassZip?: boolean,
        thumbnailPath?: string, previewPath?: string
    }) => {
        try {
            const formData = new FormData();
            formData.append('taskId', payload.taskId);
            formData.append('type', payload.type);
            formData.append('message', payload.message);
            if (payload.username) formData.append('username', payload.username);
            if (payload.userId) formData.append('userId', payload.userId);
            if (payload.bypassZip !== undefined) formData.append('bypassZip', payload.bypassZip.toString());

            if (payload.thumbnailPath && fs.existsSync(payload.thumbnailPath)) {
                const buffer = await fs.promises.readFile(payload.thumbnailPath);
                const blob = new Blob([buffer], { type: 'image/png' });
                formData.append('thumbnail', blob, path.basename(payload.thumbnailPath));
            }

            if (payload.previewPath && fs.existsSync(payload.previewPath)) {
                const buffer = await fs.promises.readFile(payload.previewPath);
                const blob = new Blob([buffer], { type: 'video/mp4' });
                formData.append('preview', blob, path.basename(payload.previewPath));
            }

            const apiUrl = process.env.WEKITSU_API_URL || 'https://wekitsu-api.weloadin.lol';
            const response = await fetch(`${apiUrl}/snapshot`, {
                method: 'POST',
                body: formData
            });
            const data = await response.json();
            return { success: response.ok, data, status: response.status };
        } catch (error: any) {
            console.error('API snapshot error:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('api-get-snapshots', async (event, taskId: string) => {
        try {
            const apiUrl = process.env.WEKITSU_API_URL || 'https://wekitsu-api.weloadin.lol';
            const response = await fetch(`${apiUrl}/snapshots/${taskId}`);
            const data = await response.json();
            return { success: response.ok, data, status: response.status };
        } catch (error: any) {
            console.error('API get-snapshots error:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('api-rollback-snapshot', async (event, { taskId, commitId }: { taskId: string, commitId: string }) => {
        try {
            const apiUrl = process.env.WEKITSU_API_URL || 'https://wekitsu-api.weloadin.lol';
            const response = await fetch(`${apiUrl}/snapshots/${taskId}/${commitId}/rollback`, {
                method: 'POST'
            });
            const data = await response.json();
            return { success: response.ok, data, status: response.status };
        } catch (error: any) {
            console.error('API rollback-snapshot error:', error);
            return { success: false, error: error.message };
        }
    });
}

function createSettingsWindow() {
    if (settingsWindow) {
        settingsWindow.focus();
        return;
    }

    settingsWindow = new BrowserWindow({
        width: 500,
        height: 600,
        webPreferences: {
            preload: path.join(__dirname, "preload.cjs"),
            nodeIntegration: false,
            contextIsolation: true
        },
        icon: icon,
        title: "Wekitsu Settings",
        autoHideMenuBar: true
    });

    settingsWindow.loadFile(path.join(__dirname, "settings.html"));

    settingsWindow.on('closed', () => {
        settingsWindow = null;
        if (!mainWindow && process.platform !== "darwin") {
            app.quit();
        }
    });
}

function createWindow() {
    if (mainWindow) {
        mainWindow.focus();
        return;
    }

    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, "preload.cjs"),
        },
        icon: icon
    });

    mainWindow.setMenuBarVisibility(true);

    mainWindow.webContents.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
    mainWindow.loadURL("http://localhost:8080");
    // mainWindow.loadURL("https://192.168.88.189:8080");
    // mainWindow.webContents.openDevTools();
}



function createMenu() {
    const template: Electron.MenuItemConstructorOptions[] = [
        {
            label: 'File',
            submenu: [
                {
                    label: 'Settings',
                    click: () => createSettingsWindow()
                },
                { type: 'separator' },
                { role: 'quit' }
            ]
        },
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'forceReload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' }
            ]
        },
        {
            label: 'Help',
            submenu: [
                {
                    label: 'About',
                    click: () => {
                        const targetWindow = mainWindow || settingsWindow;
                        if (targetWindow) {
                            dialog.showMessageBox(targetWindow, {
                                type: 'info',
                                title: 'About',
                                message: app.getName(),
                                detail: `Version: ${app.getVersion()}\nElectron: ${process.versions.electron}\nChrome: ${process.versions.chrome}\nNode: ${process.versions.node}`,
                                buttons: ['OK'],
                                icon: icon
                            });
                        }
                    }
                }
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}

app.on("window-all-closed", () => {
    // keeping app active in background (macOS style) is effectively what we are doing with tray minimize
    // but on Windows usually it quits if all windows closed. However, we are intercepting close.
    // So this might not even be hit unless we force quite.
    if (process.platform !== "darwin") app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        checkSettingsAndStart();
    }
});

