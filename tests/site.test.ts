import { describe, expect, it } from 'vitest';
import { compactStars } from '../site/stars';

describe('landing page', () => {
  it('shortens star counts like GitHub does', () => {
    expect(compactStars(7)).toBe('7');
    expect(compactStars(999)).toBe('999');
    expect(compactStars(1000)).toBe('1k');
    expect(compactStars(1234)).toBe('1.2k');
    expect(compactStars(15400)).toBe('15k');
  });
});
