import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { defineConfig, type Plugin } from 'vite';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/** The version being released, so the page always names the one npm serves. */
const VERSION = (JSON.parse(readFileSync(here('../package.json'), 'utf8')) as { version: string }).version;

/**
 * Replaces <!-- include:name --> with site/partials/name.html, so every page shares one header and
 * footer, then %VERSION% and %YEAR% with the package's version and the current year.
 */
function partials(): Plugin {
  return {
    name: 'site-partials',
    transformIndexHtml(html) {
      return html
        .replace(/<!-- include:([\w-]+) -->/g, (_match, name: string) =>
          readFileSync(here(`partials/${name}.html`), 'utf8'),
        )
        .replaceAll('%VERSION%', VERSION)
        .replaceAll('%YEAR%', String(new Date().getFullYear()));
    },
  };
}

/** Screenshots served as WebP in several widths; the pages pick one with srcset. */
const SCREENSHOTS: Record<string, string> = {
  overview: '../assets/overview.png',
  'pages-grid': '../assets/pages-grid.png',
  'pull-request': '../assets/pull-request.png',
  'sign-in': '../assets/sign-in.png',
};
export const SCREENSHOT_WIDTHS = [640, 1040, 1600, 2080];

const webp = (name: string, width: number) =>
  sharp(here(SCREENSHOTS[name]!))
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();

/**
 * Builds /img/<name>-<width>.webp from the PNG screenshots in assets/: emitted into the build, and
 * generated on request by the dev server, so both show the same images.
 */
function responsiveScreenshots(): Plugin {
  return {
    name: 'site-screenshots',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const match = /^\/img\/([\w-]+)-(\d+)\.webp$/.exec(req.url ?? '');
        if (!match || !SCREENSHOTS[match[1]!]) return next();
        webp(match[1]!, Number(match[2]))
          .then((image) => {
            res.setHeader('Content-Type', 'image/webp');
            res.end(image);
          })
          .catch(next);
      });
    },
    async generateBundle() {
      for (const name of Object.keys(SCREENSHOTS)) {
        for (const width of SCREENSHOT_WIDTHS) {
          this.emitFile({
            type: 'asset',
            fileName: `img/${name}-${width}.webp`,
            source: await webp(name, width),
          });
        }
      }
    },
  };
}

// The landing page at https://gitmetrics.pro, built separately from the app and deployed to GitHub
// Pages by .github/workflows/pages.yml. It reuses the images in assets/ (logo, screenshots, social
// preview) as its public folder.
export default defineConfig({
  root: here('.'),
  publicDir: here('../assets'),
  plugins: [partials(), responsiveScreenshots()],
  build: {
    outDir: here('../dist-site'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        home: here('index.html'),
        getStarted: here('get-started/index.html'),
        notFound: here('404.html'),
      },
    },
  },
});
