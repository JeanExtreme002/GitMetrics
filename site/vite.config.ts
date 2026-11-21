import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// The landing page at https://gitmetrics.pro, built separately from the app and deployed to GitHub
// Pages by .github/workflows/pages.yml. It reuses the images in assets/ (logo, screenshots, social
// preview) as its public folder.
export default defineConfig({
  root: here('.'),
  publicDir: here('../assets'),
  build: {
    outDir: here('../dist-site'),
    emptyOutDir: true,
  },
});
