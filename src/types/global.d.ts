import type { PebbleApi } from './ipc.types';

declare global {
  interface Window {
    /** Bridge exposed by electron/preload.ts via contextBridge. */
    pebble: PebbleApi;
  }
}

export {};
