// Writes dist/THIRD_PARTY_LICENSES.md with the license of every package bundled into the
// published app, so their notices ship with it. Reads the module lists the web build
// (dist/.modules-web.json, from vite.config.ts) and the server build (dist/.meta-server.json,
// an esbuild metafile) leave behind, then removes them.
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LICENSE_FILE = /^(licen[cs]e|copying)(\..*)?$/i;

/** "…/node_modules/@scope/pkg/dist/x.js" → "…/node_modules/@scope/pkg" (the innermost package). */
export function packageRoot(file) {
  const normalized = file.replaceAll('\\', '/').replace(/^\0/, '').split('?')[0];
  const marker = '/node_modules/';
  const at = normalized.lastIndexOf(marker);
  if (at < 0) return null;
  const rest = normalized.slice(at + marker.length).split('/');
  const depth = rest[0]?.startsWith('@') ? 2 : 1;
  if (rest.length < depth) return null;
  return normalized.slice(0, at + marker.length) + rest.slice(0, depth).join('/');
}

function describe(root) {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const file = readdirSync(root).find((f) => LICENSE_FILE.test(f));
  return {
    name: pkg.name,
    version: pkg.version,
    license: typeof pkg.license === 'string' ? pkg.license : (pkg.license?.type ?? 'UNKNOWN'),
    text: file ? readFileSync(path.join(root, file), 'utf8').trim() : null,
    repository: typeof pkg.repository === 'string' ? pkg.repository : (pkg.repository?.url ?? null),
  };
}

export function collect(files, cwd = process.cwd()) {
  const roots = new Set();
  for (const file of files) {
    const root = packageRoot(path.isAbsolute(file) ? file : path.join(cwd, file));
    if (root && existsSync(path.join(root, 'package.json'))) roots.add(root);
  }
  const byName = new Map();
  for (const root of roots) {
    const info = describe(root);
    byName.set(`${info.name}@${info.version}`, info);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function render(packages) {
  const lines = [
    '# Third-party licenses',
    '',
    'GitMetrics bundles the open source packages below. Each one keeps its own license, reproduced here.',
    '',
  ];
  for (const p of packages) {
    lines.push(`## ${p.name}@${p.version}`, '', `License: ${p.license}`, '');
    const missing = p.repository
      ? `This package does not ship a license file; see its repository: ${p.repository.replace(/^git\+/, '')}`
      : 'This package does not ship a license file.';
    lines.push(p.text ? ['```text', p.text, '```'].join('\n') : `_${missing}_`, '');
  }
  return lines.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const web = JSON.parse(readFileSync('dist/.modules-web.json', 'utf8'));
  const meta = JSON.parse(readFileSync('dist/.meta-server.json', 'utf8'));
  const packages = collect([...web, ...Object.keys(meta.inputs)]);
  writeFileSync('dist/THIRD_PARTY_LICENSES.md', render(packages));
  rmSync('dist/.modules-web.json');
  rmSync('dist/.meta-server.json');
  console.log(`Third-party licenses: ${packages.length} packages`);
}
