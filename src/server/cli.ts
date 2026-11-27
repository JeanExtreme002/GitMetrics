#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import type { UpdateInfo } from '../shared/types.js';
import { createApp } from './app.js';
import { launchCommand } from './launch.js';
import { defaultDataDir } from './store.js';
import { NO_UPDATE_CHECK, PACKAGE, RELAUNCHED, installKind, latestVersion, updateInfo } from './update.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PORT = 4280;
const DEV_API_PORT = 4281;

function version(): string {
  for (const candidate of ['../package.json', '../../package.json']) {
    const file = path.join(here, candidate);
    if (existsSync(file)) return (JSON.parse(readFileSync(file, 'utf8')) as { version: string }).version;
  }
  return 'unknown';
}

const HELP = `
GitMetrics ${version()}
A local dashboard for your GitHub repositories.

Usage
  gitmetrics [options]

Options
  -p, --port <number>  Port to listen on (default: ${DEFAULT_PORT})
      --no-open        Do not open the browser automatically
  -v, --version        Print the version
  -h, --help           Show this message

Environment
  GITMETRICS_HOME       Where GitMetrics keeps its data (default: ~/.gitmetrics)
  GITMETRICS_CLIENT_ID  Use your own GitHub OAuth App for "Sign in with GitHub"
  GITMETRICS_NO_UPDATE_CHECK=1  Don't check npm for a newer version
`;

interface Args {
  port?: number;
  open: boolean;
  dev: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { open: true, dev: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      console.log(HELP);
      process.exit(0);
    } else if (arg === '-v' || arg === '--version') {
      console.log(version());
      process.exit(0);
    } else if (arg === '-p' || arg === '--port') {
      const port = Number(argv[++i]);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        console.error('The port must be a number between 1 and 65535.');
        process.exit(1);
      }
      args.port = port;
    } else if (arg === '--no-open') {
      args.open = false;
    } else if (arg === '--dev') {
      args.dev = true;
    } else {
      console.error(`Unknown option: ${arg}\nRun "gitmetrics --help" to see the available options.`);
      process.exit(1);
    }
  }
  return args;
}

const isFree = (port: number) =>
  new Promise<boolean>((resolve) => {
    const probe = createServer()
      .once('error', () => resolve(false))
      .once('listening', () => probe.close(() => resolve(true)))
      .listen(port, '127.0.0.1');
  });

async function pickPort(preferred: number, strict: boolean): Promise<number> {
  for (let port = preferred; port < preferred + 20; port++) {
    if (await isFree(port)) return port;
    if (strict) break;
  }
  console.error(`Port ${preferred} is already in use. Try another one with --port.`);
  process.exit(1);
}

function openBrowser(url: string) {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
  const child = spawn(command, args as string[], { stdio: 'ignore', detached: true });
  child.on('error', () => undefined);
  child.unref();
}

/**
 * Checks npm for a newer GitMetrics. Started through npx, it restarts into the newer version
 * right away (npx would otherwise keep running the copy it cached the first time); installed
 * with npm, it only reports the update, since reinstalling a global package may need admin
 * rights and Windows locks the running files.
 */
async function checkForUpdate(): Promise<UpdateInfo | undefined> {
  if (process.env[NO_UPDATE_CHECK] === '1') return undefined;
  const kind = installKind(fileURLToPath(import.meta.url));
  if (kind === 'source') return undefined;
  return updateInfo(version(), await latestVersion(defaultDataDir()), kind);
}

/** Hands over to the newer version through npx; if that can't start, runs this one instead. */
function relaunch(args: Args, update: UpdateInfo) {
  console.log(`\n  Updating GitMetrics ${update.current} → ${update.latest}…`);
  const windows = process.platform === 'win32';
  // The arguments were validated by parseArgs, so they are safe to hand to the shell on Windows.
  const child = spawn(
    windows ? 'npx.cmd' : 'npx',
    ['--yes', `${PACKAGE}@${update.latest}`, ...process.argv.slice(2)],
    { stdio: 'inherit', shell: windows, env: { ...process.env, [RELAUNCHED]: '1' } },
  );
  const forward = (signal: NodeJS.Signals) => () => child.kill(signal);
  process.on('SIGINT', forward('SIGINT'));
  process.on('SIGTERM', forward('SIGTERM'));
  child.on('exit', (code) => process.exit(code ?? 0));
  child.on('error', () => {
    console.log(`  Couldn't update, starting ${update.current} instead.`);
    void start(args, update);
  });
}

/**
 * Whether a GitMetrics already answers on this port: a shortcut clicked while it runs in the
 * background should open it, not start a second one beside it.
 */
async function running(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/update`, {
      signal: AbortSignal.timeout(1500),
    });
    const body = (await response.json()) as { current?: unknown };
    return response.ok && typeof body.current === 'string';
  } catch {
    return false;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.dev && args.port === undefined && (await running(DEFAULT_PORT))) {
    const url = `http://localhost:${DEFAULT_PORT}`;
    console.log(`\n  GitMetrics is already running at ${url}\n`);
    if (args.open) openBrowser(url);
    return;
  }
  const update = args.dev ? undefined : await checkForUpdate();
  const viaNpx = update?.command?.startsWith('npx ');
  if (update?.available && viaNpx && process.env[RELAUNCHED] !== '1') relaunch(args, update);
  else await start(args, update);
}

async function start(args: Args, update: UpdateInfo | undefined) {
  const port = args.dev ? DEV_API_PORT : await pickPort(args.port ?? DEFAULT_PORT, args.port !== undefined);
  const web = path.join(here, 'web');
  const cli = fileURLToPath(import.meta.url);
  const icon = path.join(web, 'icon-512.png');
  const app = createApp({
    webDir: args.dev ? null : web,
    update,
    // How to start this GitMetrics again: for its shortcut, and its start with the computer.
    ...(args.dev
      ? {}
      : {
          launch: {
            platform: process.platform,
            home: homedir(),
            command: launchCommand(installKind(cli), cli),
            icon: existsSync(icon) ? icon : null,
            env: process.env,
          },
        }),
    quit: () => process.exit(0),
    // Checked every hour; it collects once a day.
    collectEvery: 60 * 60_000,
  });

  serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, () => {
    const url = `http://localhost:${port}`;
    if (args.dev) {
      console.log(`API ready on ${url} (open the Vite URL to use the app)`);
      return;
    }
    console.log(`\n  GitMetrics ${version()} is running at ${url}`);
    console.log(`  Data folder: ${defaultDataDir()}`);
    if (update?.available && update.command) {
      console.log(`  Update available: ${update.current} → ${update.latest}. Run: ${update.command}`);
    }
    console.log('  Press Ctrl+C to stop.\n');
    if (args.open) openBrowser(url);
  });

  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
}

void main();
