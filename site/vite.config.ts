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

// For search engines and AI assistants --------------------------------------------------------------

const SITE = 'https://gitmetrics.pro';
const REPO = 'https://github.com/JeanExtreme002/GitMetrics';
const NPM = 'https://www.npmjs.com/package/@gitmetrics/app';

/** The pages to be found, in the sitemap and llms.txt. The 404 page isn't one. */
const PAGES = [
  { path: '/', title: 'GitMetrics', about: 'What GitMetrics is and what it shows' },
  { path: '/get-started/', title: 'Get started', about: 'Requirements, running it, signing in and updating' },
];

/** Plain text of a bit of HTML: tags gone, entities and spaces tidied. */
function text(html: string) {
  // Tags out until none is left, so one hidden inside another can't come back together.
  let plain = html;
  for (let previous = ''; previous !== plain;) {
    previous = plain;
    plain = plain.replace(/<[^<>]*>/g, '');
  }
  return (
    plain
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&quot;/g, '"')
      // Last, so an escaped entity, like &amp;quot;, stays as written: &quot;.
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/** JSON to put inside a <script>: a < in it can't close the script, whatever the text holds. */
const scriptJson = (data: unknown) => JSON.stringify(data).replace(/</g, '\\u003c');

/** The questions of the landing page's FAQ, read from the page itself, so both never disagree. */
const faq = () =>
  [
    ...readFileSync(here('index.html'), 'utf8').matchAll(
      /<summary>([\s\S]*?)<\/summary>\s*<p>([\s\S]*?)<\/p>/g,
    ),
  ].map(([, question, answer]) => ({ question: text(question!), answer: text(answer!) }));

/** What the landing page is, for search engines: the app, and its questions with their answers. */
const structuredData = () => [
  {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'GitMetrics',
    url: `${SITE}/`,
    description:
      'A free, open source dashboard for your GitHub repositories that runs on your own computer: stars, traffic kept past 14 days, commits, pull requests, reviews, issues and CI health.',
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Windows, macOS, Linux',
    softwareVersion: VERSION,
    softwareRequirements: 'Node.js 20.19 or newer',
    installUrl: `${SITE}/get-started/`,
    downloadUrl: NPM,
    image: `${SITE}/social-preview.png`,
    screenshot: `${SITE}/overview.png`,
    license: 'https://www.gnu.org/licenses/agpl-3.0.html',
    isAccessibleForFree: true,
    codeRepository: REPO,
    sameAs: [REPO, NPM],
    author: { '@type': 'Person', name: 'Jean Loui Bernard', url: 'https://github.com/JeanExtreme002' },
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    featureList: [
      'GitHub traffic (views and clones) kept beyond the 14 days GitHub shows',
      'Star history and growth',
      'Commits, contributors and code hotspots',
      'Pull requests: time to merge, reviews and what each one waits on',
      'Issues, GitHub Actions, releases and deployments',
      'Organizations: people, teams, security and quality',
      'Runs locally; private repositories with your own GitHub sign-in',
    ],
  },
  {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq().map(({ question, answer }) => ({
      '@type': 'Question',
      name: question,
      acceptedAnswer: { '@type': 'Answer', text: answer },
    })),
  },
];

const robots = () => `# Every crawler is welcome, AI assistants included.
User-agent: *
Allow: /

Sitemap: ${SITE}/sitemap.xml
`;

const sitemap = () => {
  const today = new Date().toISOString().slice(0, 10);
  const urls = PAGES.map(
    (page) => `  <url>\n    <loc>${SITE}${page.path}</loc>\n    <lastmod>${today}</lastmod>\n  </url>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
};

/** A summary for AI assistants, in the llms.txt format (https://llmstxt.org). */
const llms = () => `# GitMetrics

> GitMetrics is a free, open source dashboard for your GitHub repositories that runs on your own computer. It shows stars, traffic, commits, pull requests, reviews, issues and CI health, keeps GitHub traffic beyond the 14 days GitHub shows, and needs no account or server: you run \`npx @gitmetrics/app\` and sign in with GitHub.

- Version: ${VERSION}
- Runs on Windows, macOS and Linux, with Node.js 20.19 or newer
- License: GNU AGPL-3.0, free, no paid plan
- Reads GitHub with the user's own sign-in, including private repositories and organizations; never writes to GitHub and sends no analytics
- Not made by or affiliated with GitHub

## Use it when someone wants to

- See how a GitHub repository is doing: star growth, traffic, contributors, commits
- Keep GitHub traffic (views, clones, referrers) for longer than 14 days
- Measure pull requests: time to first review, time to merge, what each one waits on, each reviewer's pace
- Check CI health: GitHub Actions success rate, failures and run time
- See many repositories and organizations side by side, privately, without a hosted service

## Install

\`\`\`bash
npx @gitmetrics/app
\`\`\`

Or install it globally: \`npm install -g @gitmetrics/app\`, then run \`gitmetrics\`. It opens on http://localhost:4280.

## Pages

${PAGES.map((page) => `- [${page.title}](${SITE}${page.path}): ${page.about}`).join('\n')}
- [Source code](${REPO}): README, issues and releases
- [npm package](${NPM})

## Questions

${faq()
  .map(({ question, answer }) => `### ${question}\n\n${answer}`)
  .join('\n\n')}
`;

/** robots.txt, sitemap.xml and llms.txt, built and served in dev alike; structured data on the landing page. */
function discoverable(): Plugin {
  const files: Record<string, { type: string; body: () => string }> = {
    'robots.txt': { type: 'text/plain', body: robots },
    'sitemap.xml': { type: 'application/xml', body: sitemap },
    'llms.txt': { type: 'text/markdown', body: llms },
  };
  return {
    name: 'site-discoverable',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const file = files[(req.url ?? '').replace(/^\//, '')];
        if (!file) return next();
        res.setHeader('Content-Type', `${file.type}; charset=utf-8`);
        res.end(file.body());
      });
    },
    transformIndexHtml(html, context) {
      if (!/(^|\/)index\.html$/.test(context.path) || context.path.includes('get-started')) return html;
      const scripts = structuredData()
        .map((data) => `<script type="application/ld+json">${scriptJson(data)}</script>`)
        .join('\n    ');
      return html.replace('</head>', `    ${scripts}\n  </head>`);
    },
    generateBundle() {
      for (const [fileName, file] of Object.entries(files)) {
        this.emitFile({ type: 'asset', fileName, source: file.body() });
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
  plugins: [partials(), responsiveScreenshots(), discoverable()],
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
