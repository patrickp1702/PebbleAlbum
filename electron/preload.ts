/**
 * preload.ts — Secure bridge. Exposes a typed `window.pebble` API to the
 * renderer via contextBridge. The renderer has NO direct Node/fs access; every
 * privileged operation goes through an IPC channel handled in the main process.
 */
import { contextBridge, ipcRenderer } from 'electron';
import type { PebbleApi } from '../src/types/ipc.types';

const api: PebbleApi = {
  // Folder & images
  openFolderDialog: () => ipcRenderer.invoke('folder:open'),
  listImages: (folderPath) => ipcRenderer.invoke('folder:list', folderPath),
  readImageBase64: (absolutePath) => ipcRenderer.invoke('image:readBase64', absolutePath),
  watchFolder: (folderPath) => ipcRenderer.send('folder:watch', folderPath),
  stopWatchFolder: () => ipcRenderer.send('folder:stopWatch'),
  getImageExif: (absolutePath) => ipcRenderer.invoke('image:exif', absolutePath),
  analyzeFolder: (folderPath) => ipcRenderer.invoke('analyze:folder', folderPath),
  onAnalyzeProgress: (cb) => {
    ipcRenderer.removeAllListeners('analyze:progress');
    ipcRenderer.on('analyze:progress', (_e, p) => cb(p));
  },
  moveToDuplicates: (folder, files) => ipcRenderer.invoke('files:moveToDuplicates', folder, files),
  saveImage: (dataUrl, defaultName) => ipcRenderer.invoke('image:saveDataUrl', dataUrl, defaultName),
  collageSaveTemp: (session) => ipcRenderer.invoke('collage:saveTemp', session),
  collageLoadTemp: () => ipcRenderer.invoke('collage:loadTemp'),
  collageClearTemp: () => ipcRenderer.invoke('collage:clearTemp'),
  onFolderChanged: (cb) => {
    ipcRenderer.removeAllListeners('folder:changed');
    ipcRenderer.on('folder:changed', (_e, files: string[]) => cb(files));
  },

  // Project
  saveProject: (project, savePath) => ipcRenderer.invoke('project:save', project, savePath),
  loadProject: (filePath) => ipcRenderer.invoke('project:load', filePath),
  openProjectDialog: () => ipcRenderer.invoke('project:openDialog'),
  saveProjectDialog: (project) => ipcRenderer.invoke('project:saveDialog', project),
  getRecentProjects: () => ipcRenderer.invoke('project:recents:get'),
  addRecentProject: (path, name) => ipcRenderer.invoke('project:recents:add', path, name),
  deleteRecentProject: (path) => ipcRenderer.invoke('project:recents:delete', path),
  autosave: (project) => ipcRenderer.invoke('project:autosave', project),
  listSavedProjects: () => ipcRenderer.invoke('project:list'),
  deleteProject: (path) => ipcRenderer.invoke('project:delete', path),

  // Thumbnails
  generateThumbnail: (imagePath, size) => ipcRenderer.invoke('thumb:generate', imagePath, size),
  getCachePath: (projectPath) => ipcRenderer.invoke('thumb:cachePath', projectPath),
  clearThumbnailCache: (projectPath) => ipcRenderer.invoke('thumb:clear', projectPath),

  // Export
  exportToPDF: (pages, options) => ipcRenderer.invoke('export:pdf', pages, options),
  exportToJPEG: (pages, options) => ipcRenderer.invoke('export:jpeg', pages, options),
  exportToPNG: (pages, options) => ipcRenderer.invoke('export:png', pages, options),
  onExportProgress: (callback) => {
    ipcRenderer.removeAllListeners('export:progress');
    ipcRenderer.on('export:progress', (_e, pct: number, step: string) => callback(pct, step));
  },

  // App
  getAppVersion: () => ipcRenderer.invoke('app:version'),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  revealInExplorer: (p) => ipcRenderer.invoke('app:reveal', p),
  openPath: (p) => ipcRenderer.invoke('app:openPath', p),
  getHomePath: () => ipcRenderer.invoke('app:home'),
  getPebbleFolderPath: () => ipcRenderer.invoke('app:pebbleFolder'),
  checkForUpdates: () => ipcRenderer.invoke('app:checkUpdates'),

  // AI / MCP
  getMcpConnectInfo: () => ipcRenderer.invoke('ai:mcpConfig'),

  // Cutout Studio + custom stickers
  saveCutout: (sourceFolder, baseName, dataUrl) => ipcRenderer.invoke('cutout:save', sourceFolder, baseName, dataUrl),
  saveSticker: (dataUrl, name) => ipcRenderer.invoke('stickers:save', dataUrl, name),
  saveEraseMask: (sourceFolder, imageId, dataUrl) => ipcRenderer.invoke('cutout:saveMask', sourceFolder, imageId, dataUrl),
  addPhotos: (sourceFolder) => ipcRenderer.invoke('folder:addPhotos', sourceFolder),
  listCustomStickers: () => ipcRenderer.invoke('stickers:list'),
  deleteCustomSticker: (p) => ipcRenderer.invoke('stickers:delete', p),

  // Slideshow music + video export
  listMusic: () => ipcRenderer.invoke('music:list'),
  addMusic: () => ipcRenderer.invoke('music:add'),
  readMusicBase64: (p) => ipcRenderer.invoke('music:readBase64', p),
  saveVideo: (data, defaultName) => ipcRenderer.invoke('video:save', data, defaultName),

  // Duplicate Folder Finder
  dupScan: (roots, opts) => ipcRenderer.invoke('folderdup:scan', roots, opts),
  dupSync: () => ipcRenderer.invoke('folderdup:sync'),
  dupSetMatchBy: (matchBy) => ipcRenderer.invoke('folderdup:setMatchBy', matchBy),
  onDupProgress: (cb) => {
    ipcRenderer.removeAllListeners('folderdup:progress');
    ipcRenderer.on('folderdup:progress', (_e, p) => cb(p));
  },
};

contextBridge.exposeInMainWorld('pebble', api);
