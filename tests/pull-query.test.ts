import { describe, expect, it } from 'vitest';
import { parsePullQuery } from '../src/web/lib/pulls';

describe('a pull request pasted in the search', () => {
  it('reads links to any tab of it, the path alone, and owner/name#number', () => {
    const pull = { owner: 'octo', name: 'app.js', number: 42 };
    expect(parsePullQuery('https://github.com/octo/app.js/pull/42')).toEqual(pull);
    expect(parsePullQuery('  github.com/octo/app.js/pull/42/files#diff-1  ')).toEqual(pull);
    expect(parsePullQuery('http://www.github.com/octo/app.js/pull/42?w=1')).toEqual(pull);
    expect(parsePullQuery('octo/app.js#42')).toEqual(pull);
    // Just the path, without github.com.
    expect(parsePullQuery('octo/app.js/pull/42')).toEqual(pull);
    expect(parsePullQuery('/octo/app.js/pull/42/commits')).toBeNull();
  });

  it('leaves everything else to the repository search', () => {
    for (const text of [
      'octo/app',
      'https://github.com/octo/app',
      'https://github.com/octo/app/issues/42',
      'https://github.com/octo/app/pull/abc',
      'https://evil.example/github.com/octo/app/pull/1',
      'octo/app#',
      'octo/app/pulls/42',
      'octo/app/issues/42',
    ]) {
      expect(parsePullQuery(text)).toBeNull();
    }
  });
});
