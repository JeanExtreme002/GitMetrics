// Regenerates the pictures in assets/ (overview, pages grid, pull request and sign-in) from the
// real app, so they follow any change to how its pages look:
//
//   npm run screenshots
//
// It builds the app, starts it on a free local port with a temporary data folder (your own
// GitMetrics, sign-in and history are left alone), signs in with your GitHub CLI session, captures
// public pages only, frames them, and deletes the temporary folder, which holds a copy of the token.
// Nothing is published: review the new pictures with `git diff` before committing them.
//
// Needs the GitHub CLI signed in (`gh auth login`) and Playwright's Chromium, installed once with
// `npx playwright install chromium`. Pass --no-build to reuse the current dist/.

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const assets = path.join(root, 'assets');

/** Public pages only: nothing private ends up in a picture. */
const REPO = '/r/JeanExtreme002/FlightRadarAPI';
const OVERVIEW = '/r/microsoft/vscode';
const PULL = '/r/microsoft/vscode/pull/345729';

/** The pages in the grid, each with its caption and the range its chart shows. */
const GRID = [
  { path: `${REPO}/stars`, title: 'Stars', caption: 'Full history, monthly growth and milestones' },
  {
    path: `${REPO}/commits`,
    title: 'Commits',
    caption: 'Contribution calendar, code frequency and work hours',
    range: { section: 'Code frequency', value: '6M' },
  },
  {
    path: `${REPO}/pulls`,
    title: 'Pull requests',
    caption: 'Merge rate, sizes, authors and what is waiting',
    range: { section: 'Pull requests per month', value: '6M' },
  },
  {
    path: `${REPO}/actions`,
    title: 'Actions',
    caption: 'Success rate, failures and run time of every workflow',
  },
];

const step = (message) => console.log(`  ${message}`);

/** A port nothing listens on, so a GitMetrics you have open is never touched. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForServer(url, child) {
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error('GitMetrics stopped while starting.');
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('GitMetrics did not start in time.');
}

/**
 * Opens a page in dark mode and waits until it has loaded everything it shows. `storage` holds
 * other choices the app keeps in localStorage, set before the page loads.
 */
async function open(browser, base, url, viewport, storage = {}) {
  const page = await browser.newPage({ viewport, colorScheme: 'dark', deviceScaleFactor: 2 });
  await page.addInitScript((saved) => {
    localStorage.setItem('mantine-color-scheme-value', 'dark');
    for (const [key, value] of Object.entries(saved)) localStorage.setItem(key, value);
  }, storage);
  await page.goto(base + url);
  await settle(page);
  return page;
}

/** Waits for the requests to end and the loading placeholders to go, then for charts to draw. */
async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 60_000 });
  await page.waitForFunction(
    () => !globalThis.document.querySelector('.mantine-Skeleton-root, .mantine-Loader-root'),
    null,
    {
      timeout: 60_000,
    },
  );
  await page.waitForTimeout(1200);
}

/** Picks a range (like 6M) in the switch beside a section's title. */
async function pickRange(page, { section, value }) {
  const title = await page.getByText(section, { exact: true }).first().boundingBox();
  const options = page.locator('label', { hasText: new RegExp(`^${value}$`) });
  for (let i = 0; i < (await options.count()); i++) {
    const box = await options.nth(i).boundingBox();
    if (box && title && Math.abs(box.y - title.y) < 40) {
      await options.nth(i).click();
      await settle(page);
      await page.mouse.move(0, 0);
      return;
    }
  }
  throw new Error(`No ${value} option beside "${section}".`);
}

const dataUrl = (buffer, type = 'image/png') => `data:${type};base64,${buffer.toString('base64')}`;

const FONT = dataUrl(
  readFileSync(
    path.join(root, 'node_modules/@fontsource-variable/mona-sans/files/mona-sans-latin-wght-normal.woff2'),
  ),
  'font/woff2',
);

/**
 * A window with the three buttons and a title around one capture. `width` is the window's outer
 * width and `content` the height of the capture inside it, so each picture keeps its exact size.
 */
const windowFrame = ({ image, width, content, bar, title, pad, shadow }) => `
  <div class="pad" style="padding:${pad}">
    <div class="win" style="width:${width}px;box-shadow:${shadow}">
      <div class="bar" style="height:${bar}px">
        <span style="background:#ff5f57"></span><span style="background:#febc2e"></span
        ><span style="background:#28c840"></span><p>${title}</p>
      </div>
      <div style="height:${content}px;overflow:hidden"><img src="${image}" style="width:${width - 2}px" /></div>
    </div>
  </div>`;

const STYLE = `
  @font-face { font-family: 'Mona Sans'; src: url(${FONT}) format('woff2'); font-weight: 200 900; }
  html, body { margin: 0; background: transparent; }
  * { box-sizing: border-box; }
  img { display: block; }
  .pad { display: inline-block; }
  .win { overflow: hidden; border: 1px solid rgba(240, 246, 252, 0.14); border-radius: 12px; background: #0b0e13; }
  .bar { position: relative; display: flex; align-items: center; gap: 8px; padding-left: 15px;
         border-bottom: 1px solid #000; background: #1b1f26; box-sizing: content-box; }
  .bar span { width: 12px; height: 12px; border-radius: 50%; }
  .bar p { position: absolute; inset: 0; margin: 0; color: #9198a1; font: 500 12px -apple-system, system-ui, sans-serif;
           line-height: inherit; display: flex; align-items: center; justify-content: center; }
  .grid { display: inline-grid; grid-template-columns: 784px 784px; grid-auto-rows: 632px; gap: 25px 24px;
          padding: 4px; }
  .tile { display: flex; flex-direction: column; overflow: hidden; border: 1px solid rgba(240, 246, 252, 0.12);
          border-radius: 10px; background: #151b23; font-family: 'Mona Sans', sans-serif; text-align: center; }
  .tile .shot { flex: none; height: 544px; overflow: hidden; border-bottom: 1px solid rgba(240, 246, 252, 0.1); }
  .tile .shot img { width: 782px; }
  .tile .caption { display: flex; flex: 1; flex-direction: column; justify-content: center; gap: 4px; }
  .tile h2 { margin: 0; color: #f0f6fc; font-size: 19px; font-weight: 700; line-height: 1.2; }
  .tile p { margin: 0; color: #9198a1; font-size: 15px; line-height: 1.3; }
`;

/** Renders the HTML and saves what it draws, with a transparent background. */
async function render(browser, html, file) {
  const page = await browser.newPage({ viewport: { width: 1700, height: 1400 }, deviceScaleFactor: 2 });
  await page.setContent(
    `<!doctype html><html><head><style>${STYLE}</style></head><body>${html}</body></html>`,
  );
  await page.evaluate(() => globalThis.document.fonts.ready);
  const box = await page.locator('body > *').first().boundingBox();
  await page.screenshot({ path: path.join(assets, file), omitBackground: true, clip: box });
  await page.close();
  step(`assets/${file} (${box.width}×${box.height})`);
}

async function main() {
  if (!process.argv.includes('--no-build')) {
    step('Building the app…');
    const build = spawnSync('npm', ['run', 'build'], {
      cwd: root,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    if (build.status !== 0) throw new Error('The build failed.');
  }

  const home = mkdtempSync(path.join(tmpdir(), 'gitmetrics-screenshots-'));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(
    process.execPath,
    [path.join(root, 'dist/cli.js'), '--port', String(port), '--no-open'],
    {
      env: { ...process.env, GITMETRICS_HOME: home, GITMETRICS_NO_UPDATE_CHECK: '1' },
      stdio: 'ignore',
    },
  );
  const browser = await chromium.launch();
  try {
    await waitForServer(`${base}/api/auth/status`, server);
    step(`GitMetrics is running on ${base}, with a temporary data folder.`);

    // Signed out: the sign-in screen.
    const signIn = await open(browser, base, '/login', { width: 1200, height: 760 });
    const signInShot = await signIn.screenshot({ clip: { x: 160, y: 150, width: 880, height: 500 } });
    await signIn.close();

    const auth = await fetch(`${base}/api/auth/gh`, { method: 'POST', headers: { 'x-gitmetrics': '1' } });
    if (!auth.ok) throw new Error('Could not sign in with the GitHub CLI. Sign in first with: gh auth login');
    step('Signed in with the GitHub CLI.');
    // The offer to open it like an app comes after signing in: put off, so it covers no picture.
    await fetch(`${base}/api/launch/offered`, { method: 'POST', headers: { 'x-gitmetrics': '1' } });

    // The overview's chart on commits rather than stars: Mantine keeps the choice as JSON.
    const overview = await open(
      browser,
      base,
      OVERVIEW,
      { width: 1440, height: 1000 },
      { 'gitmetrics:overview-chart': JSON.stringify('commits') },
    );
    const overviewShot = await overview.screenshot();
    await overview.close();

    const pull = await open(browser, base, PULL, { width: 1440, height: 1010 });
    const pullShot = await pull.screenshot();
    await pull.close();

    const tiles = [];
    for (const tile of GRID) {
      const page = await open(browser, base, tile.path, { width: 1440, height: 1000 });
      if (tile.range) await pickRange(page, tile.range);
      tiles.push({ ...tile, shot: await page.screenshot() });
      await page.close();
    }
    step('Captured every page.');

    // Shadows fade out inside the room around each window, so no edge shows on any background.
    await render(
      browser,
      windowFrame({
        image: dataUrl(overviewShot),
        width: 1440,
        content: 997,
        bar: 40,
        title: 'GitMetrics',
        pad: '20px 72px 68px',
        shadow: '0 16px 32px rgba(0,0,0,.28), 0 4px 12px rgba(0,0,0,.15)',
      }),
      'overview.png',
    );
    await render(
      browser,
      windowFrame({
        image: dataUrl(pullShot),
        width: 1442,
        content: 1010,
        bar: 40,
        title: 'GitMetrics',
        pad: '12px 12px 20px',
        shadow: '0 4px 10px rgba(0,0,0,.22), 0 1px 3px rgba(0,0,0,.12)',
      }),
      'pull-request.png',
    );
    await render(
      browser,
      windowFrame({
        image: dataUrl(signInShot),
        width: 880,
        content: 500,
        bar: 36,
        title: 'localhost:4280',
        pad: '40px',
        shadow: '0 10px 24px rgba(0,0,0,.2), 0 2px 6px rgba(0,0,0,.12)',
      }),
      'sign-in.png',
    );
    await render(
      browser,
      `<div class="grid">${tiles
        .map(
          (t) => `<div class="tile"><div class="shot"><img src="${dataUrl(t.shot)}" /></div>
            <div class="caption"><h2>${t.title}</h2><p>${t.caption}</p></div></div>`,
        )
        .join('')}</div>`,
      'pages-grid.png',
    );
  } finally {
    await browser.close();
    server.kill();
    rmSync(home, { recursive: true, force: true });
    step('Stopped GitMetrics and deleted the temporary data folder.');
  }
}

console.log('\nGitMetrics screenshots\n');
main()
  .then(() => console.log('\nDone. Review the pictures with git diff before committing them.\n'))
  .catch((error) => {
    console.error(`\n${error.message}\n`);
    process.exit(1);
  });
