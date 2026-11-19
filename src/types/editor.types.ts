/**
 * editor.types.ts — Renderer-only editor state types.
 */

export type ActiveTool =
  | 'select' | 'crop' | 'text' | 'pan' | 'zoom'
  | 'layout' | 'theme' | 'decoration' | 'proverb';

export type BottomPanel =
  | 'images' | 'layouts' | 'themes' | 'decorations' | 'proverbs' | 'pages' | null;

export interface CanvasGuide {
  id: string;
  axis: 'x' | 'y';
  position: number;
}

export interface RecentProject {
  path: string;
  name: string;
  lastOpened: string;
  imageCount: number;
  pageCount: number;
  coverThumbnail?: string;
}

export interface AppPreferences {
  uiTheme: 'dark' | 'light';
  showRulers: boolean;
  rulerUnit: 'px' | 'mm' | 'inch';
  showGrid: boolean;
  gridSize: number;
  snapToGrid: boolean;
  showSafeZone: boolean;
  showBleed: boolean;
  autosaveEnabled: boolean;
  autosaveDelayMs: number;
}

export type ToastKind = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  timeout?: number;
}
