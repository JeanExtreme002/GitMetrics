import react from '@vitejs/plugin-react';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { Plugin } from 'vite';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

/**
 * Lists every module in the web bundle in dist/.modules-web.json, so
 * scripts/third-party-licenses.mjs knows which packages ship with the app.
 */
function bundledModules(): Plugin {
  return {
    name: 'bundled-modules',
    apply: 'build',
    generateBundle(_options, bundle) {
      const ids = new Set<string>(this.getModuleIds());
      for (const output of Object.values(bundle)) {
        if (output.type === 'chunk') for (const id of Object.keys(output.modules)) ids.add(id);
      }
      const dist = new URL('./dist/', import.meta.url);
      mkdirSync(dist, { recursive: true });
      writeFileSync(new URL('.modules-web.json', dist), JSON.stringify([...ids]));
    },
  };
}

export default defineConfig({
  root: 'src/web',
  publicDir: 'public',
  plugins: [react(), bundledModules()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:4281' },
    },
  },
});
