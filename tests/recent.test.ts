import { describe, expect, it } from 'vitest';
import { addRecent, type RecentRepo } from '../src/web/lib/recent';

const repo = (fullName: string): RecentRepo => ({ fullName, ownerAvatarUrl: '' });

describe('recently viewed repositories', () => {
  it('puts the latest visit first and lists each repository once, whatever the case', () => {
    let list: RecentRepo[] = [];
    for (const name of ['a/one', 'b/two', 'A/One']) list = addRecent(list, repo(name));
    expect(list.map((r) => r.fullName)).toEqual(['A/One', 'b/two']);
  });

  it('keeps only the newest ten', () => {
    let list: RecentRepo[] = [];
    for (let i = 1; i <= 12; i++) list = addRecent(list, repo(`o/r${i}`));
    expect(list).toHaveLength(10);
    expect(list[0]!.fullName).toBe('o/r12');
    expect(list.at(-1)!.fullName).toBe('o/r3');
  });
});
