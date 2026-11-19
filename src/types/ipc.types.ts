/**
 * ipc.types.ts — Contract shared by preload, main-process IPC handlers, and the
 * renderer. Keeping these here avoids duplicate definitions and lets the
 * `window.pebble` typings stay in sync with the handlers.
 */
import type { ImageRecord, PebbleProject, ExifData, DuplicateGroup, Orientation } from './pebble.types';
import type { RecentProject } from './editor.types';

/** Persisted "resume" state for the standalone Collage Creator (single temp file). */
export interface CollageSession {
  v: number;
  collage: {
    folder: string;
    selected: string[];
    layoutId: string;
    themeId: string;
    orientation: Orientation;
    bgColor: string;
    phase: 'setup' | 'edit';
    /** Folder photo list, stored only while in setup (in edit it lives in project.imageRegistry). */
    records?: ImageRecord[];
  };
  /** The one-page in-memory collage project (null until the editor is entered). */
  project: PebbleProject | null;
}

/** Result of duplicate/quality analysis over a source folder. */
export interface AnalyzeResult {
  records: ImageRecord[];
  groups: DuplicateGroup[];
}

/** Live progress while analyzing a folder. */
export interface AnalyzeProgress {
  phase: 'scan' | 'analyze' | 'done';
  done: number;
  total: number;
}

export interface ExportPageData {
  index: number;
  /** Full-resolution PNG data URL rendered by the renderer. */
  dataUrl: string;
}

export interface PDFExportOptions {
  outputDir: string;
  projectName: string;
  dpi: number;
  includeBleedMarks: boolean;
  includePageNumbers: boolean;
  widthPx: number;
  heightPx: number;
}

export interface ImageExportOptions {
  outputDir: string;
  projectName: string;
  quality: number;
  format: 'jpeg' | 'png';
}

export interface UpdateInfo {
  version: string;
  notes: string;
  url: string;
}

/** Details for connecting an external AI agent to the PebbleAlbum MCP server. */
export interface McpConnectInfo {
  /** Absolute path to the MCP server script. */
  serverPath: string;
  /** Launch command (usually "node"). */
  command: string;
  /** Launch args ([serverPath]). */
  args: string[];
  /** Env passed to the server (projects folder + app root). */
  env: Record<string, string>;
  /** Ready-to-paste MCP client config JSON. */
  configJson: string;
  /** Fast/efficient starter prompt ({{PROJECT}} placeholder). */
  promptFast: string;
  /** Thorough "deep analysis + complete" starter prompt ({{PROJECT}} placeholder). */
  promptDeep: string;
  /** The ~/Documents/Pebble folder projects are saved in. */
  projectsFolder: string;
}

/** The full API surface exposed to the renderer via contextBridge. */
export interface PebbleApi {
  // Folder & images
  openFolderDialog: () => Promise<string | null>;
  listImages: (folderPath: string) => Promise<ImageRecord[]>;
  readImageBase64: (absolutePath: string) => Promise<string>;
  watchFolder: (folderPath: string) => void;
  stopWatchFolder: () => void;
  getImageExif: (absolutePath: string) => Promise<ExifData>;
  onFolderChanged: (cb: (files: string[]) => void) => void;
  /** Analyze a folder for near-duplicates + photo quality (culling). */
  analyzeFolder: (folderPath: string) => Promise<AnalyzeResult>;
  /** Subscribe to analyze progress events (scan/analyze phases). */
  onAnalyzeProgress: (cb: (p: AnalyzeProgress) => void) => void;
  /** Move chosen photos into `<folder>/duplicate` (Duplicate Finder tool). */
  moveToDuplicates: (folder: string, files: string[]) => Promise<{ movedCount: number; duplicateFolder: string; skipped: number }>;
  /** Save a base64 image data URL to a user-chosen file (Save dialog). Returns the path or null. */
  saveImage: (dataUrl: string, defaultName?: string) => Promise<string | null>;
  /** Collage Creator resume-session (single hidden temp file in the Pebble folder). */
  collageSaveTemp: (session: CollageSession) => Promise<void>;
  collageLoadTemp: () => Promise<CollageSession | null>;
  collageClearTemp: () => Promise<void>;

  // Project
  saveProject: (project: PebbleProject, savePath?: string) => Promise<string>;
  loadProject: (filePath: string) => Promise<PebbleProject>;
  openProjectDialog: () => Promise<string | null>;
  saveProjectDialog: (project: PebbleProject) => Promise<string | null>;
  getRecentProjects: () => Promise<RecentProject[]>;
  addRecentProject: (path: string, name: string) => Promise<void>;
  deleteRecentProject: (path: string) => Promise<void>;
  autosave: (project: PebbleProject) => Promise<void>;
  /** List every saved .pebble project in the projects folder, with metadata. */
  listSavedProjects: () => Promise<RecentProject[]>;
  /** Delete a saved project file (+ backup) and drop it from recents. */
  deleteProject: (path: string) => Promise<void>;

  // Thumbnails
  generateThumbnail: (imagePath: string, size: number) => Promise<string>;
  getCachePath: (projectPath: string) => Promise<string>;
  clearThumbnailCache: (projectPath: string) => Promise<void>;

  // Export
  exportToPDF: (pages: ExportPageData[], options: PDFExportOptions) => Promise<string>;
  exportToJPEG: (pages: ExportPageData[], options: ImageExportOptions) => Promise<string[]>;
  exportToPNG: (pages: ExportPageData[], options: ImageExportOptions) => Promise<string[]>;
  onExportProgress: (callback: (progress: number, step: string) => void) => void;

  // App
  getAppVersion: () => Promise<string>;
  openExternal: (url: string) => Promise<void>;
  revealInExplorer: (path: string) => Promise<void>;
  /** Open a folder/file in the OS file manager (brings it to the front). */
  openPath: (path: string) => Promise<string>;
  getHomePath: () => Promise<string>;
  getPebbleFolderPath: () => Promise<string>;
  checkForUpdates: () => Promise<UpdateInfo | null>;

  // AI / MCP
  /** Get the MCP connect config JSON + starter prompt for an external AI agent. */
  getMcpConnectInfo: () => Promise<McpConnectInfo>;

  // Cutout Studio + custom stickers
  /** Save a transparent PNG cutout into `<sourceFolder>/cutouts/`. */
  saveCutout: (sourceFolder: string, baseName: string, dataUrl: string) => Promise<CutoutSaveResult>;
  /** Save a PNG into the global My Stickers library (~/PebbleAlbum/stickers). */
  saveSticker: (dataUrl: string, name?: string) => Promise<CustomSticker>;
  /** Save an erase-mask PNG (alpha = keep) as a NEW file under
   *  `<sourceFolder>/.pebble_masks/`. Returns its project-relative path. */
  saveEraseMask: (sourceFolder: string, imageId: string, dataUrl: string) => Promise<{ relativePath: string }>;
  /** "Add photo": file dialog (multi-select). Files outside the album folder are
   *  copied into `<sourceFolder>/added/`. Returns a registry record per photo. */
  addPhotos: (sourceFolder: string) => Promise<ImageRecord[]>;
  listCustomStickers: () => Promise<CustomSticker[]>;
  deleteCustomSticker: (path: string) => Promise<void>;

  // Slideshow music + video export
  /** Bundled default tracks + the user's ~/PebbleAlbum/music library. */
  listMusic: () => Promise<MusicTrack[]>;
  /** File-dialog: copy chosen audio files into the music library. */
  addMusic: () => Promise<MusicTrack[]>;
  /** Read a library track as a data URL (for WebAudio playback/recording). */
  readMusicBase64: (path: string) => Promise<string>;
  /** Save a recorded slideshow video via a Save dialog. Returns path or null. */
  saveVideo: (data: ArrayBuffer, defaultName: string) => Promise<string | null>;

  // Duplicate Folder Finder
  /** Full scan (or cache-resume) + analysis of the given roots. */
  dupScan: (roots: string[], opts: DupScanOptions) => Promise<DupReport>;
  /** Incremental re-scan (mtime-skip) + re-analysis of the current session. */
  dupSync: () => Promise<DupReport>;
  /** Re-analyse the existing snapshot with a different match key (no disk I/O). */
  dupSetMatchBy: (matchBy: DupMatchBy) => Promise<DupReport>;
  onDupProgress: (cb: (p: DupProgress) => void) => void;
}

/** A slideshow music track (bundled default or user library). */
export interface MusicTrack { path: string; name: string; source: 'bundled' | 'library' }

// ---- Duplicate Folder Finder (quick tool) ----------------------------------

/** How two files are considered "the same" (metadata only — never content). */
export type DupMatchBy = 'name' | 'name_date' | 'name_size' | 'name_date_size';

export interface DupScanOptions { matchBy: DupMatchBy; skipSystemDirs: boolean }

export interface DupProgress {
  phase: 'scan' | 'analyze' | 'done';
  dirs: number;
  files: number;
  /** Dirs reused from the previous snapshot without re-statting (sync). */
  reusedDirs: number;
  currentPath?: string;
}

/** Compact folder-table row sent once per report; rows reference it by id. */
export interface DupFolderInfo {
  id: number;
  /** Parent folder id, −1 for a selected root itself. */
  parent: number;
  /** Index into report.roots. */
  root: number;
  path: string;
  /** Direct (non-junk) file count. */
  files: number;
  /** Recursive file count (whole subtree). */
  recFiles: number;
}

export interface DupFolderPair {
  a: number;
  b: number;
  /** Directly shared file keys between the two folders. */
  shared: number;
  /** Rolled-up shared count incl. matched subtrees (folder-of-folder). */
  recShared: number;
  /** recShared / min(recFilesA, recFilesB), 0..1 — the slider filters this. */
  sim: number;
  scope: 'within' | 'across';
}

export interface DupFileGroup {
  name: string;
  size: number;
  mtime: number;
  /** Folder ids containing this file (capped — see total). */
  locs: number[];
  total: number;
  scope: 'within' | 'across';
}

export interface DupReport {
  roots: string[];
  folders: DupFolderInfo[];
  /** Every candidate pair with sim ≥ 0.3 (sorted by sim desc, capped). */
  pairs: DupFolderPair[];
  fileGroups: DupFileGroup[];
  stats: {
    dirs: number; files: number;
    scanMs: number; analyzeMs: number;
    reusedDirs: number; cacheHit: boolean;
    pairsTotal: number; fileGroupsTotal: number;
  };
}

/** A saved cutout PNG inside the album's source folder (cutouts/…). */
export interface CutoutSaveResult { absolutePath: string; relativePath: string; width: number; height: number }

/** A PNG in the user's global "My Stickers" library (~/PebbleAlbum/stickers). */
export interface CustomSticker { path: string; name: string; width: number; height: number }
