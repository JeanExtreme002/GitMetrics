import { describe, expect, it } from 'vitest';
import { SNOOZE, snoozed } from '../src/web/lib/update';

describe('closing the update popup', () => {
  const at = Date.UTC(2026, 10, 22);

  it('hides it for a week, then shows it again', () => {
    const closed = { version: '1.3.0', at };
    expect(snoozed(closed, '1.3.0', at + SNOOZE - 1)).toBe(true);
    expect(snoozed(closed, '1.3.0', at + SNOOZE)).toBe(false);
  });

  it('shows it right away when an even newer version comes out', () => {
    expect(snoozed({ version: '1.3.0', at }, '1.4.0', at + 1000)).toBe(false);
  });

  it('shows it when it was never closed, or the saved value is from an older build', () => {
    expect(snoozed(null, '1.3.0', at)).toBe(false);
    expect(snoozed('1.3.0' as never, '1.3.0', at)).toBe(false);
  });
});
