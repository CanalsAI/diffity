import { describe, expect, it } from 'vitest';
import { shouldRequestHostClose } from '../src/lib/embedding';

describe('shouldRequestHostClose', () => {
  it('only closes for an unconsumed Escape without an open dialog', () => {
    expect(shouldRequestHostClose(false, false)).toBe(true);
    expect(shouldRequestHostClose(true, false)).toBe(false);
    expect(shouldRequestHostClose(false, true)).toBe(false);
  });
});
