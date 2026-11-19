import { resolve } from 'node:path';
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import vue from '@vitejs/plugin-vue';

/**
 * pdfkit is BUNDLED into the main process (see the externalizeDepsPlugin `exclude`)
 * so electron-builder never has to ship pdfkit's fragile, deeply-hoisted dependency
 * chain (fontkit → deep-equal → call-bind → … → call-bind-apply-helpers) in
 * node_modules — its dependency collector mis-places those and the app crashes at
 * startup. pdfkit loads its standard-font metrics (.afm) lazily via
 * `__dirname + '/data/<font>.afm'`; once bundled, __dirname is the out/main dir, so
 * we copy those data files there so PDF text / page numbers still render.
 */
function copyPdfkitData() {
  return {
    name: 'copy-pdfkit-afm',
    closeBundle() {
      try {
        const src = resolve(__dirname, 'node_modules/pdfkit/js/data');
        const dst = resolve(__dirname, 'out/main/data');
        mkdirSync(dst, { recursive: true });
        for (const f of readdirSync(src)) copyFileSync(resolve(src, f), resolve(dst, f));
      } catch (e) { console.warn('[copy-pdfkit-afm] skipped:', (e as Error).message); }
    },
  };
}

/**
 * electron-vite configuration.
 * Three build targets: main process, preload script, and the Vue renderer.
 * The renderer resolves `@` to `src` and `@shared` to the shared type definitions
 * that are imported by both the main process and the renderer.
 */
export default defineConfig({
  main: {
    // Bundle pdfkit (+ its transitive helper chain) into the main bundle; keep the
    // native `sharp` external (it loads its own prebuilt N-API binary at runtime).
    plugins: [externalizeDepsPlugin({ exclude: ['pdfkit'] }), copyPdfkitData()],
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'electron/main.ts') } },
    },
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/types') },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/preload.ts') },
        // Force a CommonJS `.cjs` preload. With `"type": "module"` in
        // package.json the default output would be `index.mjs`; emitting `.cjs`
        // is the most reliable form for a contextBridge preload and matches the
        // path loaded in electron/main.ts.
        output: { format: 'cjs', entryFileNames: 'index.cjs' },
      },
    },
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/types') },
    },
  },
  renderer: {
    root: '.',
    plugins: [vue()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
        '@shared': resolve(__dirname, 'src/types'),
      },
    },
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'index.html') } },
    },
  },
});
