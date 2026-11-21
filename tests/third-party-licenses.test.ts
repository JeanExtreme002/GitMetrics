import { describe, expect, it } from 'vitest';
import { collect, packageRoot, render } from '../scripts/third-party-licenses.mjs';

describe('third-party licenses', () => {
  it('finds the package a bundled file belongs to', () => {
    expect(packageRoot('/app/node_modules/react/index.js')).toBe('/app/node_modules/react');
    expect(packageRoot('/app/node_modules/@mantine/core/esm/index.mjs')).toBe(
      '/app/node_modules/@mantine/core',
    );
    // Nested packages belong to the innermost node_modules.
    expect(packageRoot('/app/node_modules/a/node_modules/b/x.js')).toBe('/app/node_modules/a/node_modules/b');
    // Vite ids can carry a leading null byte and a query string.
    expect(packageRoot('\0/app/node_modules/react/jsx.js?commonjs-proxy')).toBe('/app/node_modules/react');
    expect(packageRoot('/app/src/web/main.tsx')).toBeNull();
  });

  it('reads real bundled packages once each, with their license text', () => {
    const packages = collect([
      'node_modules/hono/dist/index.js',
      'node_modules/hono/dist/router.js',
      'node_modules/@fontsource-variable/mona-sans/index.css',
      'src/server/cli.ts',
    ]);
    expect(packages.map((p) => p.name)).toEqual(['@fontsource-variable/mona-sans', 'hono']);
    expect(packages[0]!.license).toBe('OFL-1.1');
    expect(packages[0]!.text).toContain('SIL OPEN FONT LICENSE');
    expect(packages[1]!.text).toContain('MIT');
  });

  it('points to the repository when a package ships no license file', () => {
    const text = render([
      {
        name: 'a',
        version: '1.0.0',
        license: 'MIT',
        text: null,
        repository: 'git+https://github.com/x/a.git',
      },
    ]);
    expect(text).toContain('## a@1.0.0');
    expect(text).toContain('see its repository: https://github.com/x/a.git');
  });
});
