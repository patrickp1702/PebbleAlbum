/**
 * electron-builder packaging configuration.
 * Produces installable artifacts:
 *   - macOS: dmg + zip (universal-capable)
 *   - Windows: NSIS installer
 *   - Linux: AppImage + deb
 * Run via: npm run dist (or dist:mac / dist:win / dist:linux)
 */
module.exports = {
  appId: 'com.pebblealbum.app',
  productName: 'PebbleAlbum',
  copyright: 'Copyright © 2026 PebbleAlbum Studio',
  directories: { output: 'release', buildResources: 'build' },
  // The renderer + main are bundled by electron-vite into out/ (pdfkit is bundled
  // into the main bundle too — see electron.vite.config.ts), so the ONLY runtime
  // node_modules we need is the native sharp (+ its @img binary). Exclude the unused
  // optional fabric deps (renderer uses the DOM canvas) so they're never shipped.
  files: ['out/**/*', 'package.json', '!**/node_modules/canvas/**/*', '!**/node_modules/jsdom/**/*'],
  // ⚠ Do NOT rebuild native modules. sharp 0.33 ships N-API prebuilt binaries that
  // run under Electron as-is; the only other "native" dep is the unused `canvas`,
  // whose from-source rebuild fails without system libs (pkg-config/cairo/pixman).
  npmRebuild: false,
  // sharp's native binary lives in @img/* (0.33+), so unpack both from the asar.
  // ffmpeg-static ships a platform ffmpeg binary used to re-encode the recorded
  // slideshow into a standard MP4 — it must live outside the asar to be spawnable.
  asarUnpack: ['**/node_modules/sharp/**/*', '**/node_modules/@img/**/*', '**/node_modules/ffmpeg-static/**/*'],
  mac: {
    // A 1024² PNG is fine — electron-builder converts it to .icns at package time
    // (no macOS-only iconutil needed). Drop in build/icon.icns to override.
    icon: 'build/icon.png',
    category: 'public.app-category.photography',
    // arm64 only: with npmRebuild:false (so the unused `canvas` never compiles),
    // electron-builder copies the HOST-arch sharp binary into every slice, so a
    // mixed arm64+x64 build ships an arm64 binary inside the x64 app → it crashes
    // with "Could not load the sharp module using the darwin-x64 runtime".
    // To also ship Intel, build x64 separately on/for x64 with its sharp binary
    // present (see the note in README / docs), not in this same pass.
    target: [
      { target: 'dmg', arch: ['arm64'] },
      { target: 'zip', arch: ['arm64'] },
    ],
  },
  win: {
    icon: 'build/icon.ico',
    target: [{ target: 'nsis', arch: ['x64'] }],
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
  },
  linux: {
    icon: 'build/icon.png',
    category: 'Graphics',
    target: ['AppImage', 'deb'],
  },
  extraResources: [
    { from: 'assets/', to: 'assets/' },
    // The MCP server is a standalone Node script launched by external AI agents;
    // ship it (and its skills) + the config JSONs outside the asar so plain Node
    // can read them.
    { from: 'mcp/', to: 'mcp/' },
    { from: 'src/config/', to: 'config/' },
  ],
};
