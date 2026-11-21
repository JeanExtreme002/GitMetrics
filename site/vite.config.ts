import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/** Replaces <!-- include:name --> with site/partials/name.html, so every page shares one header and footer. */
function partials(): Plugin {
  return {
    name: 'site-partials',
    transformIndexHtml(html) {
      return html.replace(/<!-- include:([\w-]+) -->/g, (_match, name: string) =>
        readFileSync(here(`partials/${name}.html`), 'utf8'),
      );
    },
  };
}

// The landing page at https://gitmetrics.pro, built separately from the app and deployed to GitHub
// Pages by .github/workflows/pages.yml. It reuses the images in assets/ (logo, screenshots, social
// preview) as its public folder.
export default defineConfig({
  root: here('.'),
  publicDir: here('../assets'),
  plugins: [partials()],
  build: {
    outDir: here('../dist-site'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        home: here('index.html'),
        getStarted: here('get-started/index.html'),
      },
    },
  },
});
