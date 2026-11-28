import { execFile } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { LaunchStatus } from '../shared/types.js';

/*
 * Opening GitMetrics without a terminal: a shortcut among the computer's apps, and starting it
 * when the computer does, each done the way its system does it.
 *
 * - macOS: an app in ~/Applications (Launchpad and Spotlight find it), and a LaunchAgent.
 * - Linux: a .desktop entry in the apps menu, and one in the XDG autostart folder.
 * - Windows: a shortcut in the Start menu, and one in its Startup folder.
 *
 * Both run a small launcher script kept in the data folder, which starts GitMetrics with the same
 * Node and the same command it was started with, quietly, with no terminal window.
 */

export type Platform = 'darwin' | 'linux' | 'win32';

/** How this GitMetrics was started: its Node, and the arguments that start it again. */
export interface LaunchCommand {
  node: string;
  args: string[];
}

export interface LaunchEnvironment {
  platform: NodeJS.Platform;
  home: string;
  /** The data folder, where the launcher scripts and the icon are kept. */
  dataDir: string;
  command: LaunchCommand;
  /** The app's icon as a PNG, to give the shortcut a face. */
  icon: string | null;
  env: NodeJS.ProcessEnv;
  /** Runs a system tool (PowerShell, sips, iconutil): a stand-in in tests. */
  run?: (file: string, args: string[]) => Promise<void>;
}

const NAME = 'GitMetrics';
const LABEL = 'app.gitmetrics';
const COMMENT = 'Every number behind your GitHub repositories';

const supported = (platform: NodeJS.Platform): platform is Platform =>
  platform === 'darwin' || platform === 'linux' || platform === 'win32';

const runTool = (file: string, args: string[]) =>
  new Promise<void>((resolve, reject) => {
    execFile(file, args, { timeout: 20_000, windowsHide: true }, (error) =>
      error ? reject(error) : resolve(),
    );
  });

/** Where each piece goes, on this system. */
export function launchPaths(e: LaunchEnvironment) {
  if (e.platform === 'darwin') {
    return {
      launcher: path.join(e.dataDir, 'launch.sh'),
      shortcut: path.join(e.home, 'Applications', `${NAME}.app`),
      autostart: path.join(e.home, 'Library', 'LaunchAgents', `${LABEL}.plist`),
    };
  }
  if (e.platform === 'win32') {
    const programs = path.join(
      e.env.APPDATA ?? path.join(e.home, 'AppData', 'Roaming'),
      'Microsoft',
      'Windows',
      'Start Menu',
      'Programs',
    );
    return {
      launcher: path.join(e.dataDir, 'launch.vbs'),
      shortcut: path.join(programs, `${NAME}.lnk`),
      autostart: path.join(programs, 'Startup', `${NAME}.lnk`),
    };
  }
  const data = e.env.XDG_DATA_HOME || path.join(e.home, '.local', 'share');
  const config = e.env.XDG_CONFIG_HOME || path.join(e.home, '.config');
  return {
    launcher: path.join(e.dataDir, 'launch.sh'),
    shortcut: path.join(data, 'applications', 'gitmetrics.desktop'),
    autostart: path.join(config, 'autostart', 'gitmetrics.desktop'),
  };
}

/** Whether each is set up now. */
export function launchStatus(e: LaunchEnvironment): Omit<LaunchStatus, 'offered'> {
  if (!supported(e.platform)) return { supported: false, platform: null, shortcut: false, autostart: false };
  const paths = launchPaths(e);
  return {
    supported: true,
    platform: e.platform,
    shortcut: existsSync(paths.shortcut),
    autostart: existsSync(paths.autostart),
  };
}

// The launcher -------------------------------------------------------------------------------------

/** A word as a POSIX shell reads it, whatever it holds. */
const sh = (word: string) => `'${word.replace(/'/g, `'\\''`)}'`;
/** A string as VBScript reads it. */
const vbs = (text: string) => `"${text.replace(/"/g, '""')}"`;

/** The script both the shortcut and the start with the computer run. */
export function launcherScript(e: LaunchEnvironment): string {
  const { node, args } = e.command;
  // The folder Node is in, read the way the system writes its paths.
  const bin = (e.platform === 'win32' ? path.win32 : path.posix).dirname(node);
  if (e.platform === 'win32') {
    const line = [node, ...args].map((part) => `""${part.replace(/"/g, '""""')}""`).join(' ');
    return [
      "' Starts GitMetrics with no window, as its shortcut and its start with Windows do.",
      'Set shell = CreateObject("WScript.Shell")',
      `shell.Environment("Process")("PATH") = ${vbs(bin)} & ";" & shell.Environment("Process")("PATH")`,
      'extra = ""',
      'For Each argument In WScript.Arguments',
      '  extra = extra & " " & argument',
      'Next',
      `shell.Run "${line}" & extra, 0, False`,
      '',
    ].join('\r\n');
  }
  return [
    '#!/bin/sh',
    '# Starts GitMetrics, as its shortcut and its start with the computer do, with its output kept in a log.',
    `export PATH=${sh(bin)}:"$PATH"`,
    `exec ${[node, ...args].map(sh).join(' ')} "$@" >>${sh(path.join(e.dataDir, 'gitmetrics.log'))} 2>&1`,
    '',
  ].join('\n');
}

function writeLauncher(e: LaunchEnvironment) {
  const { launcher } = launchPaths(e);
  mkdirSync(path.dirname(launcher), { recursive: true });
  writeFileSync(launcher, launcherScript(e));
  if (e.platform !== 'win32') chmodSync(launcher, 0o755);
  return launcher;
}

// Each system's pieces ---------------------------------------------------------------------------

/** A value as a .desktop file's Exec line reads it. */
const desktopArg = (text: string) => `"${text.replace(/(["`$\\])/g, '\\$1')}"`;

export function desktopEntry(launcher: string, icon: string | null, autostart: boolean): string {
  return [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${NAME}`,
    `Comment=${COMMENT}`,
    `Exec=${desktopArg(launcher)}${autostart ? ' --no-open' : ''}`,
    ...(icon ? [`Icon=${icon}`] : []),
    'Terminal=false',
    'Categories=Development;',
    ...(autostart ? ['X-GNOME-Autostart-enabled=true', 'NoDisplay=true'] : []),
    '',
  ].join('\n');
}

const xml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function launchAgent(launcher: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(launcher)}</string>
    <string>--no-open</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
`;
}

function appInfo(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>${NAME}</string>
  <key>CFBundleDisplayName</key>
  <string>${NAME}</string>
  <key>CFBundleIdentifier</key>
  <string>${LABEL}.launcher</string>
  <key>CFBundleExecutable</key>
  <string>${NAME}</string>
  <key>CFBundleIconFile</key>
  <string>${NAME}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>LSUIElement</key>
  <true/>
</dict>
</plist>
`;
}

/** The PNG icon as a Windows .ico, which holds a PNG as it is. */
export function pngToIco(png: Buffer): Buffer {
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header.writeUInt8(width >= 256 ? 0 : width, 6);
  header.writeUInt8(height >= 256 ? 0 : height, 7);
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18);
  return Buffer.concat([header, png]);
}

/** A PowerShell string, single-quoted. */
const ps = (text: string) => `'${text.replace(/'/g, "''")}'`;

async function windowsShortcut(e: LaunchEnvironment, file: string, launcher: string, extra: string) {
  const run = e.run ?? runTool;
  let icon = '';
  if (e.icon) {
    icon = path.join(e.dataDir, 'gitmetrics.ico');
    writeFileSync(icon, pngToIco(readFileSync(e.icon)));
  }
  const wscript = path.join(e.env.SystemRoot ?? e.env.WINDIR ?? 'C:\\Windows', 'System32', 'wscript.exe');
  mkdirSync(path.dirname(file), { recursive: true });
  const script = [
    `$s = (New-Object -ComObject WScript.Shell).CreateShortcut(${ps(file)})`,
    `$s.TargetPath = ${ps(wscript)}`,
    `$s.Arguments = ${ps(`"${launcher}"${extra}`)}`,
    `$s.WorkingDirectory = ${ps(e.dataDir)}`,
    `$s.Description = ${ps(COMMENT)}`,
    ...(icon ? [`$s.IconLocation = ${ps(icon)}`] : []),
    '$s.Save()',
  ].join('; ');
  await run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    script,
  ]);
}

async function macApp(e: LaunchEnvironment, app: string, launcher: string) {
  const contents = path.join(app, 'Contents');
  mkdirSync(path.join(contents, 'MacOS'), { recursive: true });
  mkdirSync(path.join(contents, 'Resources'), { recursive: true });
  writeFileSync(path.join(contents, 'Info.plist'), appInfo());
  // Started in the background, so the app's own process ends at once: no icon left bouncing.
  const executable = path.join(contents, 'MacOS', NAME);
  writeFileSync(executable, `#!/bin/sh\nnohup ${sh(launcher)} >/dev/null 2>&1 &\n`);
  chmodSync(executable, 0o755);
  if (!e.icon) return;
  // Its icon, made the way macOS wants it; without one, it still opens.
  const run = e.run ?? runTool;
  const set = path.join(e.dataDir, `${NAME}.iconset`);
  try {
    mkdirSync(set, { recursive: true });
    for (const size of [16, 32, 128, 256, 512]) {
      await run('sips', [
        '-z',
        String(size),
        String(size),
        e.icon,
        '--out',
        path.join(set, `icon_${size}x${size}.png`),
      ]);
      await run('sips', [
        '-z',
        String(size * 2),
        String(size * 2),
        e.icon,
        '--out',
        path.join(set, `icon_${size}x${size}@2x.png`),
      ]);
    }
    await run('iconutil', ['-c', 'icns', set, '-o', path.join(contents, 'Resources', `${NAME}.icns`)]);
  } catch {
    // No icon, then.
  } finally {
    rmSync(set, { recursive: true, force: true });
  }
}

/** Adds GitMetrics to the computer's apps, or takes it away. */
export async function setShortcut(e: LaunchEnvironment, enabled: boolean) {
  if (!supported(e.platform)) throw new Error('Not supported on this system.');
  const { shortcut } = launchPaths(e);
  if (!enabled) {
    rmSync(shortcut, { recursive: true, force: true });
    return;
  }
  const launcher = writeLauncher(e);
  if (e.platform === 'darwin') return macApp(e, shortcut, launcher);
  if (e.platform === 'win32') return windowsShortcut(e, shortcut, launcher, '');
  let icon: string | null = null;
  if (e.icon) {
    icon = path.join(e.dataDir, 'gitmetrics.png');
    copyFileSync(e.icon, icon);
  }
  mkdirSync(path.dirname(shortcut), { recursive: true });
  writeFileSync(shortcut, desktopEntry(launcher, icon, false));
}

/**
 * Shows the app in the Finder, selected, on macOS: one drag from there keeps it in the Dock, which
 * isn't ours to change.
 */
export async function revealShortcut(e: LaunchEnvironment) {
  const { shortcut } = launchPaths(e);
  if (e.platform !== 'darwin' || !existsSync(shortcut)) throw new Error('No app to show.');
  await (e.run ?? runTool)('open', ['-R', shortcut]);
}

/** Starts GitMetrics with the computer, quietly, or stops doing so. From the next start on. */
export async function setAutostart(e: LaunchEnvironment, enabled: boolean) {
  if (!supported(e.platform)) throw new Error('Not supported on this system.');
  const { autostart } = launchPaths(e);
  if (!enabled) {
    rmSync(autostart, { force: true });
    return;
  }
  const launcher = writeLauncher(e);
  mkdirSync(path.dirname(autostart), { recursive: true });
  if (e.platform === 'darwin') writeFileSync(autostart, launchAgent(launcher));
  else if (e.platform === 'win32') await windowsShortcut(e, autostart, launcher, ' --no-open');
  else writeFileSync(autostart, desktopEntry(launcher, null, true));
}

/**
 * The command that starts this GitMetrics again: through npx when it was started that way (its
 * cached copy can be cleared, and npx finds the newest), otherwise this very file.
 */
export function launchCommand(
  kind: 'npx' | 'installed' | 'source',
  cli: string,
  node = process.execPath,
): LaunchCommand {
  if (kind !== 'npx') return { node, args: [cli] };
  const bin = path.dirname(node);
  const npx = [
    path.join(bin, '..', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js'),
    path.join(bin, 'node_modules', 'npm', 'bin', 'npx-cli.js'),
  ].find((file) => existsSync(file));
  return npx ? { node, args: [path.resolve(npx), '--yes', '@gitmetrics/app'] } : { node, args: [cli] };
}
