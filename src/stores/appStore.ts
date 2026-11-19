/**
 * appStore.ts — App-wide state: recent projects, user preferences, UI theme,
 * toast notifications, and the personal proverb library.
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { v4 as uuid } from 'uuid';
import type { RecentProject, AppPreferences, Toast, ToastKind } from '@shared/editor.types';

const DEFAULT_PREFS: AppPreferences = {
  uiTheme: 'dark', showRulers: true, rulerUnit: 'px', showGrid: false, gridSize: 50,
  snapToGrid: false, showSafeZone: true, showBleed: false,
  autosaveEnabled: true, autosaveDelayMs: 2000,
};

export const useAppStore = defineStore('app', () => {
  const recentProjects = ref<RecentProject[]>([]);
  const preferences = ref<AppPreferences>({ ...DEFAULT_PREFS });
  const toasts = ref<Toast[]>([]);
  const appVersion = ref('1.0.0');
  const myProverbs = ref<string[]>([]);

  async function loadRecents(): Promise<void> {
    try { recentProjects.value = await window.pebble.getRecentProjects(); } catch { /* none yet */ }
  }

  async function loadVersion(): Promise<void> {
    try { appVersion.value = await window.pebble.getAppVersion(); } catch { /* dev */ }
  }

  function toast(message: string, kind: ToastKind = 'info', timeout = 3000): void {
    const t: Toast = { id: uuid(), kind, message, timeout };
    toasts.value.push(t);
    if (timeout) setTimeout(() => dismissToast(t.id), timeout);
  }

  function dismissToast(id: string): void {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }

  function toggleUiTheme(): void {
    preferences.value.uiTheme = preferences.value.uiTheme === 'dark' ? 'light' : 'dark';
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('light', preferences.value.uiTheme === 'light');
    }
  }

  function addMyProverb(text: string): void {
    if (text.trim() && !myProverbs.value.includes(text.trim())) myProverbs.value.push(text.trim());
  }

  return {
    recentProjects, preferences, toasts, appVersion, myProverbs,
    loadRecents, loadVersion, toast, dismissToast, toggleUiTheme, addMyProverb,
  };
});
