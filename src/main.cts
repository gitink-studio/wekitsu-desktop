import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "path";

const isDev = !app.isPackaged;

function createWindow() {
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, "preload.cjs"),
        },
    });


    win.webContents.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
    win.loadURL("https://wekitsu.weloadin.lol");
    // win.webContents.openDevTools();

}

app.whenReady().then(() => {
    createWindow();

    ipcMain.handle('open-path', async (event: any, fullPath: any) => {
        try {
            console.log('opening path', fullPath);
            const result = await shell.openPath(`w:/${fullPath}`);
            // 'result' will contain an error message if the path could not be opened, 
            // otherwise an empty string.
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

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
});
