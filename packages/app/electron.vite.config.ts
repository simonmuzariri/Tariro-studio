import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string };

// Blockly's sprites and sounds are served from the app itself (offline-first, strict CSP).
// (blockly's "exports" hide package.json, so resolve the main entry, which sits at the package root.)
const blocklyMedia = resolve(dirname(createRequire(import.meta.url).resolve('blockly')), 'media');

// Workspace packages are bundled (not externalized) so the packaged app never depends on
// workspace symlinks at runtime.
// fflate stays external: its Node ESM build declares `require`, which clashes with the ESM shim.
const bundled = ['@tariro-studio/core', '@tariro-studio/extensions', 'zod'];

export default defineConfig({
  main: {
    build: {
      externalizeDeps: { exclude: bundled },
      rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } },
    },
  },
  preload: {
    // Sandboxed preloads must be a single CommonJS file that only requires 'electron'.
    build: {
      externalizeDeps: false,
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        external: ['electron'],
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    publicDir: blocklyMedia,
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    plugins: [react()],
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } },
    },
  },
});
