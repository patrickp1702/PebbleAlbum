/**
 * main.ts — Electron main process entry. Creates the BrowserWindow, wires up
 * all IPC handlers, and manages app lifecycle. Renderer security is locked down:
 * context isolation on, node integration off, and a strict preload bridge.
 */
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerFolderIpc } from './ipc/folder.ipc';
import { registerImageIpc } from './ipc/image.ipc';
import { registerThumbnailIpc } from './ipc/thumbnail.ipc';
import { registerProjectIpc, pebbleRoot } from './ipc/project.ipc';
import { registerExportIpc } from './ipc/export.ipc';
import { registerAiIpc } from './ipc/ai.ipc';
import { registerAnalyzeIpc } from './ipc/analyze.ipc';
import { registerFilesIpc } from './ipc/files.ipc';
import { registerCutoutIpc } from './ipc/cutout.ipc';
import { registerMusicIpc } from './ipc/music.ipc';
import { registerFolderDupIpc } from './ipc/folderdup.ipc';

const __dirnameLocal = path.dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | null = null;

// Dev/test only: PEBBLE_DEBUG_PORT=9223 exposes the Chrome DevTools protocol so
// automated tests (Playwright over CDP) can drive the app. Never set in prod.
if (process.env.PEBBLE_DEBUG_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.PEBBLE_DEBUG_PORT);
}

// Slideshow music + video export use WebAudio; without this Chromium can keep
// the AudioContext suspended (autoplay policy), which silences playback and
// stalls MediaRecorder while it waits for audio frames.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Keep the render loop + timers running at full speed when the window is not
// focused / is occluded. Without this, Chromium throttles requestAnimationFrame
// and clamps timers for background windows — which froze the slideshow VIDEO
// EXPORT (captureStream repeated the last frame and the ~28s show stretched to
// minutes) the moment the user switched away. These switches + the per-window
// backgroundThrottling:false make export (and preview playback) focus-independent.
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#1A1A2E',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false,
    webPreferences: {
      preload: path.join(__dirnameLocal, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Don't pause/slow rAF + timers when the window is backgrounded — the video
      // export records the live canvas in real time and must not freeze on blur.
      backgroundThrottling: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  // electron-vite injects ELECTRON_RENDERER_URL in dev; load the built file otherwise.
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) mainWindow.loadURL(devUrl);
  else mainWindow.loadFile(path.join(__dirnameLocal, '../renderer/index.html'));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

/** App-level IPC handlers (version, shell helpers, paths, updates). */
function registerAppIpc(): void {
  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('app:openExternal', (_e, url: string) => shell.openExternal(url));
  ipcMain.handle('app:reveal', (_e, p: string) => shell.showItemInFolder(p));
  // Open a folder (or file) in the OS file manager and bring it to the front.
  // shell.openPath uses `open`/`explorer`, which activates Finder/Explorer —
  // unlike showItemInFolder, which only selects in the parent and often stays
  // behind the app window. Returns '' on success or an error string.
  ipcMain.handle('app:openPath', (_e, p: string) => shell.openPath(p));
  ipcMain.handle('app:home', () => app.getPath('home'));
  ipcMain.handle('app:pebbleFolder', () => pebbleRoot());
  ipcMain.handle('app:checkUpdates', () => null); // hook for an updater later
}

app.whenReady().then(() => {
  registerFolderIpc();
  registerImageIpc();
  registerThumbnailIpc();
  registerProjectIpc();
  registerExportIpc();
  registerAppIpc();
  registerAiIpc();
  registerAnalyzeIpc();
  registerFilesIpc();
  registerCutoutIpc();
  registerMusicIpc();
  registerFolderDupIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
