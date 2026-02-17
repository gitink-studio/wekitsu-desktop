import { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage } from "electron";
import path from "path";
import { updateElectronApp } from 'update-electron-app';

updateElectronApp();

const isDev = !app.isPackaged;
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

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
        }
    });

    // Create myWindow, load the rest of the app, etc...
    app.whenReady().then(() => {
        createWindow();
        createTray();

        ipcMain.handle('open-path', async (event: any, fullPath: any) => {
            try {
                console.log('opening path', fullPath);
                // Security check: Ensure path does not contain '..' to prevent directory traversal attacks if not intended
                // const safePath = path.normalize(fullPath).replace(/^(\.\.(\/|\\|$))+/, '');
                const result = await shell.openPath(`w:/${fullPath}`);
                if (result) {
                    console.error(`Error opening path: ${result}`);
                }
                return result;
            } catch (error) {
                console.error('Failed to open path:', error);
                return error instanceof Error ? error.message : 'Unknown error occurred';
            }
        });
    });
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, "preload.cjs"),
        },
        icon: icon
    });

    mainWindow.setMenuBarVisibility(false);

    mainWindow.webContents.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
    mainWindow.loadURL("https://wekitsu.weloadin.lol");
    // mainWindow.webContents.openDevTools();

    mainWindow.on('close', (event) => {
        if (!isQuitting) {
            event.preventDefault();
            mainWindow?.hide();
            return false;
        }
        return true;
    });
}

function createTray() {
    tray = new Tray(icon);
    const contextMenu = Menu.buildFromTemplate([
        { label: 'Show App', click: () => mainWindow?.show() },
        {
            label: 'Quit', click: () => {
                isQuitting = true;
                app.quit();
            }
        }
    ]);
    tray.setToolTip('Wekitsu Desktop');
    tray.setContextMenu(contextMenu);

    tray.on('click', () => {
        if (mainWindow?.isVisible()) {
            mainWindow.hide();
        } else {
            mainWindow?.show();
        }
    });
}

app.on("window-all-closed", () => {
    // keeping app active in background (macOS style) is effectively what we are doing with tray minimize
    // but on Windows usually it quits if all windows closed. However, we are intercepting close.
    // So this might not even be hit unless we force quite.
    if (process.platform !== "darwin") app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
