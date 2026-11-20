import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { createReadStream, readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string };

// Blockly's sprites and sounds are served from the app itself (offline-first, strict CSP).
// (blockly's "exports" hide package.json, so resolve the main entry, which sits at the package root.)
const blocklyMedia = resolve(dirname(createRequire(import.meta.url).resolve('blockly')), 'media');

// Pyodide (Python in WebAssembly) for the Python environment, served from the app at /pyodide/ so
// Python works offline. Only these files are needed: no packages are downloaded at run time.
const pyodideDir = dirname(createRequire(import.meta.url).resolve('pyodide'));
const PYODIDE_FILES: Record<string, string> = {
  'pyodide.mjs': 'text/javascript',
  'pyodide.asm.mjs': 'text/javascript',
  'pyodide.asm.wasm': 'application/wasm',
  'python_stdlib.zip': 'application/zip',
  'pyodide-lock.json': 'application/json',
};
// The AI models, served from the app at /models/<name>/ (each folder has a README with its source,
// licence and checksums): MobileNet v2 for the image classifier, PoseNet for body pose.
const MODELS: Record<string, string> = {
  mobilenet: resolve(__dirname, 'models/mobilenet-v2-0.35'),
  posenet: resolve(__dirname, 'models/posenet-mobilenet-075'),
};
const MODEL_FILES: Record<string, string> = { 'model.json': 'application/json', 'group1-shard1of1.bin': 'application/octet-stream' };

function pyodideAssets(): Plugin {
  return {
    name: 'tariro-pyodide-assets',
    configureServer(server) {
      server.middlewares.use('/pyodide/', (req, res, next) => {
        const name = (req.url ?? '').split('?')[0]!.replace(/^\/+/, '');
        const type = PYODIDE_FILES[name];
        if (!type) return next();
        res.setHeader('Content-Type', type);
        createReadStream(resolve(pyodideDir, name)).pipe(res);
      });
      for (const [model, dir] of Object.entries(MODELS))
        server.middlewares.use(`/models/${model}/`, (req, res, next) => {
          const name = (req.url ?? '').split('?')[0]!.replace(/^\/+/, '');
          const type = MODEL_FILES[name];
          if (!type) return next();
          res.setHeader('Content-Type', type);
          createReadStream(resolve(dir, name)).pipe(res);
        });
    },
    generateBundle() {
      for (const name of Object.keys(PYODIDE_FILES)) this.emitFile({ type: 'asset', fileName: `pyodide/${name}`, source: readFileSync(resolve(pyodideDir, name)) });
      for (const [model, dir] of Object.entries(MODELS))
        for (const name of Object.keys(MODEL_FILES)) this.emitFile({ type: 'asset', fileName: `models/${model}/${name}`, source: readFileSync(resolve(dir, name)) });
    },
  };
}

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
    plugins: [react(), pyodideAssets()],
    worker: { format: 'es' },
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } },
    },
  },
});
