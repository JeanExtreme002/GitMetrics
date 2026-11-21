#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { defaultDataDir } from './store.js';

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
MyGitDash ${version()}
A local dashboard for your GitHub repositories.

Usage
  mygitdash [options]

Options
  -p, --port <number>  Port to listen on (default: ${DEFAULT_PORT})
      --no-open        Do not open the browser automatically
  -v, --version        Print the version
  -h, --help           Show this message

Environment
  MYGITDASH_HOME       Where MyGitDash keeps its data (default: ~/.mygitdash)
  MYGITDASH_CLIENT_ID  Use your own GitHub OAuth App for "Sign in with GitHub"
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
      console.error(`Unknown option: ${arg}\nRun "mygitdash --help" to see the available options.`);
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const port = args.dev ? DEV_API_PORT : await pickPort(args.port ?? DEFAULT_PORT, args.port !== undefined);
  const app = createApp({ webDir: args.dev ? null : path.join(here, 'web') });

  serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, () => {
    const url = `http://localhost:${port}`;
    if (args.dev) {
      console.log(`API ready on ${url} (open the Vite URL to use the app)`);
      return;
    }
    console.log(`\n  MyGitDash ${version()} is running at ${url}`);
    console.log(`  Data folder: ${defaultDataDir()}`);
    console.log('  Press Ctrl+C to stop.\n');
    if (args.open) openBrowser(url);
  });

  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
}

void main();
