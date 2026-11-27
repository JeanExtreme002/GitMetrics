import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app';
import {
  desktopEntry,
  launchAgent,
  launchCommand,
  launchPaths,
  launchStatus,
  launcherScript,
  pngToIco,
  setAutostart,
  setShortcut,
  type LaunchEnvironment,
} from '../src/server/launch';

let home: string;
beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'gitmetrics-launch-'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

/** A tiny real PNG header: width and height where a PNG keeps them. */
function png(size: number) {
  const data = Buffer.alloc(33);
  data.write('\x89PNG\r\n\x1a\n', 0, 'binary');
  data.writeUInt32BE(size, 16);
  data.writeUInt32BE(size, 20);
  return data;
}

function environment(
  platform: NodeJS.Platform,
  over: Partial<LaunchEnvironment> = {},
): LaunchEnvironment & { calls: string[][] } {
  const calls: string[][] = [];
  const icon = path.join(home, 'icon.png');
  writeFileSync(icon, png(512));
  return {
    platform,
    home,
    dataDir: path.join(home, '.gitmetrics'),
    command: { node: '/opt/node 20/bin/node', args: ["/srv/git's metrics/cli.js"] },
    icon,
    env: { APPDATA: path.join(home, 'AppData'), SystemRoot: 'C:\\Windows' },
    run: async (file, args) => {
      calls.push([file, ...args]);
    },
    calls,
    ...over,
  };
}

describe('the launcher', () => {
  it('starts the same Node and command quietly, on macOS and Linux, whatever the paths hold', () => {
    const script = launcherScript(environment('linux'));
    expect(script.startsWith('#!/bin/sh\n')).toBe(true);
    expect(script).toContain(`export PATH='/opt/node 20/bin':"$PATH"`);
    expect(script).toContain(`exec '/opt/node 20/bin/node' '/srv/git'\\''s metrics/cli.js' "$@" >>`);
    expect(script).toContain('gitmetrics.log');
  });

  it('starts it with no window on Windows', () => {
    const script = launcherScript(
      environment('win32', { command: { node: 'C:\\Node "x"\\node.exe', args: ['C:\\app\\cli.js'] } }),
    );
    expect(script).toContain('shell.Environment("Process")("PATH") = "C:\\Node ""x""" & ";"');
    expect(script).toContain(
      'shell.Run """C:\\Node """"x""""\\node.exe"" ""C:\\app\\cli.js""" & extra, 0, False',
    );
  });

  it('reads an Exec line and a plist as each format asks', () => {
    const entry = desktopEntry('/home/a "b"/$x/launch.sh', '/icon.png', false);
    expect(entry).toContain('Exec="/home/a \\"b\\"/\\$x/launch.sh"');
    expect(entry).toContain('Icon=/icon.png');
    expect(entry).toContain('Terminal=false');
    const quiet = desktopEntry('/l.sh', null, true);
    expect(quiet).toContain('Exec="/l.sh" --no-open');
    expect(quiet).toContain('NoDisplay=true');
    expect(launchAgent('/a & b/launch.sh')).toContain(
      '<string>/a &amp; b/launch.sh</string>\n    <string>--no-open</string>',
    );
  });

  it('wraps the PNG icon as a Windows .ico', () => {
    const ico = pngToIco(png(192));
    expect([...ico.subarray(0, 8)]).toEqual([0, 0, 1, 0, 1, 0, 192, 192]);
    expect(ico.readUInt32LE(14)).toBe(33);
    expect(ico.readUInt32LE(18)).toBe(22);
    expect(pngToIco(png(512)).readUInt8(6)).toBe(0);
  });
});

describe('a shortcut and the start with the computer', () => {
  it('on Linux: entries in the apps menu and the autostart folder, and gone again', async () => {
    const e = environment('linux');
    const paths = launchPaths(e);
    expect(launchStatus(e)).toEqual({
      supported: true,
      platform: 'linux',
      shortcut: false,
      autostart: false,
    });
    await setShortcut(e, true);
    await setAutostart(e, true);
    expect(launchStatus(e)).toMatchObject({ shortcut: true, autostart: true });
    expect(paths.shortcut).toBe(path.join(home, '.local', 'share', 'applications', 'gitmetrics.desktop'));
    expect(readFileSync(paths.shortcut, 'utf8')).toContain(`Exec="${paths.launcher}"`);
    expect(readFileSync(paths.autostart, 'utf8')).toContain('--no-open');
    expect(statSync(paths.launcher).mode & 0o111).toBeTruthy();
    expect(existsSync(path.join(e.dataDir, 'gitmetrics.png'))).toBe(true);
    await setShortcut(e, false);
    await setAutostart(e, false);
    expect(launchStatus(e)).toMatchObject({ shortcut: false, autostart: false });
  });

  it('on macOS: an app in ~/Applications with its icon, and a LaunchAgent', async () => {
    const e = environment('darwin');
    const paths = launchPaths(e);
    await setShortcut(e, true);
    await setAutostart(e, true);
    expect(paths.shortcut).toBe(path.join(home, 'Applications', 'GitMetrics.app'));
    const executable = path.join(paths.shortcut, 'Contents', 'MacOS', 'GitMetrics');
    expect(readFileSync(executable, 'utf8')).toContain(`nohup '${paths.launcher}' >/dev/null 2>&1 &`);
    expect(readFileSync(path.join(paths.shortcut, 'Contents', 'Info.plist'), 'utf8')).toContain(
      '<key>LSUIElement</key>',
    );
    expect(e.calls.at(-1)?.slice(0, 2)).toEqual(['iconutil', '-c']);
    expect(readFileSync(paths.autostart, 'utf8')).toContain('<string>app.gitmetrics</string>');
    await setShortcut(e, false);
    expect(existsSync(paths.shortcut)).toBe(false);
  });

  it('on Windows: shortcuts made through PowerShell, in the Start menu and its Startup folder', async () => {
    const e = environment('win32');
    const paths = launchPaths(e);
    await setShortcut(e, true);
    await setAutostart(e, true);
    const [first, second] = e.calls;
    expect(first![0]).toBe('powershell.exe');
    expect(first!.at(-1)).toContain(`CreateShortcut('${paths.shortcut}')`);
    expect(first!.at(-1)).toContain(path.join('C:\\Windows', 'System32', 'wscript.exe'));
    expect(first!.at(-1)).toContain(`IconLocation = '${path.join(e.dataDir, 'gitmetrics.ico')}'`);
    expect(second!.at(-1)).toContain(`CreateShortcut('${paths.autostart}')`);
    expect(second!.at(-1)).toContain('--no-open');
    expect(paths.autostart).toContain(path.join('Programs', 'Startup'));
  });

  it("isn't offered where it can't be done", async () => {
    const e = environment('freebsd');
    expect(launchStatus(e)).toMatchObject({ supported: false });
    await expect(setShortcut(e, true)).rejects.toThrow();
  });
});

describe('the command that starts it again', () => {
  it('goes through npx when it was started that way, and is this file otherwise', () => {
    const node = path.join(home, 'node', 'bin', 'node');
    const npx = path.join(home, 'node', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js');
    mkdirSync(path.dirname(npx), { recursive: true });
    writeFileSync(npx, '');
    expect(launchCommand('npx', '/cache/cli.js', node)).toEqual({
      node,
      args: [npx, '--yes', '@gitmetrics/app'],
    });
    expect(launchCommand('installed', '/usr/lib/cli.js', node)).toEqual({ node, args: ['/usr/lib/cli.js'] });
    // No npx beside this Node: this file, then.
    expect(launchCommand('npx', '/cache/cli.js', '/nowhere/node')).toEqual({
      node: '/nowhere/node',
      args: ['/cache/cli.js'],
    });
  });
});

describe('the launch routes', () => {
  async function signedIn(options: Parameters<typeof createApp>[0]) {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ login: 'octo', name: null, avatar_url: '', html_url: '' }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'x-oauth-scopes': 'repo' },
      })) as typeof fetch;
    const app = createApp({
      dataDir: path.join(home, 'data'),
      fetchImpl,
      ghToken: async () => 'gho',
      collectTraffic: false,
      ...options,
    });
    const send = (url: string, method = 'GET', json?: unknown) =>
      app.request(url, {
        method,
        headers: { host: 'localhost:4280', 'x-gitmetrics': '1', 'content-type': 'application/json' },
        ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
      });
    expect((await send('/api/auth/gh', 'POST')).status).toBe(200);
    return send;
  }

  it('sets up what was chosen, marks it offered, and refuses what it cannot do', async () => {
    const e = environment('linux');
    const send = await signedIn({
      launch: { platform: e.platform, home, command: e.command, icon: e.icon, env: e.env },
    });
    expect(await (await send('/api/launch')).json()).toEqual({
      supported: true,
      platform: 'linux',
      shortcut: false,
      autostart: false,
      offered: false,
    });
    expect((await send('/api/launch', 'PUT', { shortcut: 'yes' })).status).toBe(400);
    expect(await (await send('/api/launch', 'PUT', { shortcut: true })).json()).toMatchObject({
      shortcut: true,
      autostart: false,
      offered: true,
    });
    expect(
      await (await send('/api/launch', 'PUT', { autostart: true, shortcut: false })).json(),
    ).toMatchObject({ shortcut: false, autostart: true });
  });

  it('is offered once, and only where it can be done', async () => {
    const send = await signedIn({});
    expect(await (await send('/api/launch')).json()).toMatchObject({ supported: false, offered: false });
    expect((await send('/api/launch', 'PUT', { shortcut: true })).status).toBe(400);
    expect(await (await send('/api/launch/offered', 'POST')).json()).toMatchObject({ offered: true });
  });

  it('quits only when it can, after answering', async () => {
    expect((await (await signedIn({}))('/api/quit', 'POST')).status).toBe(400);
    let quit = false;
    const send = await signedIn({ quit: () => (quit = true) });
    expect((await send('/api/quit', 'POST')).status).toBe(200);
    expect(quit).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(quit).toBe(true);
  });
});
