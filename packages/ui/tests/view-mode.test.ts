import { afterEach, describe, expect, it, vi } from 'vitest';
import { getViewMode, saveViewMode } from '../src/lib/view-mode';

afterEach(() => vi.unstubAllGlobals());

describe('view mode preference', () => {
  it('restores the saved choice and honors explicit URL overrides', () => {
    vi.stubGlobal('document', { cookie: 'other=value; diffity-view-mode=unified' });

    expect(getViewMode()).toBe('unified');
    expect(getViewMode('split')).toBe('split');
    expect(getViewMode('invalid')).toBe('unified');

    document.cookie = 'diffity-view-mode=split';
    expect(getViewMode()).toBe('split');
    expect(getViewMode('unified')).toBe('unified');
  });

  it('defaults to split for missing or invalid preferences', () => {
    vi.stubGlobal('document', { cookie: 'diffity-view-mode=invalid' });
    expect(getViewMode()).toBe('split');
    document.cookie = '';
    expect(getViewMode()).toBe('split');
  });

  it('shares choices across workspace subdomains', () => {
    vi.stubGlobal('window', { location: new URL('https://5391--first.devspaces.example.com/diff') });
    vi.stubGlobal('document', { cookie: '' });

    saveViewMode('unified');

    expect(document.cookie).toBe('diffity-view-mode=unified; Path=/; Max-Age=31536000; SameSite=Lax; Domain=devspaces.example.com; Secure');

    vi.stubGlobal('window', { location: new URL('https://5392--second.devspaces.example.com/diff') });
    saveViewMode('split');
    expect(document.cookie).toContain('diffity-view-mode=split;');
    expect(document.cookie).toContain('Domain=devspaces.example.com; Secure');
  });

  it('keeps standalone preferences on their own host', () => {
    vi.stubGlobal('window', { location: new URL('http://localhost:5391/diff') });
    vi.stubGlobal('document', { cookie: '' });

    saveViewMode('unified');

    expect(document.cookie).toBe('diffity-view-mode=unified; Path=/; Max-Age=31536000; SameSite=Lax');
  });

  it('still works when browser storage is unavailable', () => {
    vi.stubGlobal('window', { location: new URL('https://5391--first.devspaces.example.com/diff') });
    vi.stubGlobal('document', {
      get cookie(): string { throw new Error('blocked'); },
      set cookie(_value: string) { throw new Error('blocked'); },
    });

    expect(getViewMode()).toBe('split');
    expect(getViewMode('unified')).toBe('unified');
    expect(() => saveViewMode('unified')).not.toThrow();
  });
});
