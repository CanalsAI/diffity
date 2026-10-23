import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { ensureQueryData, setQueryData, fetchDiffSummary } = vi.hoisted(() => ({
  ensureQueryData: vi.fn(),
  setQueryData: vi.fn(),
  fetchDiffSummary: vi.fn(),
}));

vi.mock('../src/lib/query-client', () => ({ queryClient: { ensureQueryData, setQueryData } }));
vi.mock('../src/lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/lib/api')>(),
  fetchDiffSummary,
}));

import { clientLoader } from '../src/routes/diff';
import { allowOneLargeDiffLoad, refreshDiffWithGate } from '../src/lib/large-diff-gate';

function load(search = '') {
  return clientLoader({ request: new Request(`http://localhost/diff${search}`) } as Parameters<typeof clientLoader>[0]);
}

describe('diff loader', () => {
  beforeEach(() => {
    ensureQueryData.mockReset();
    ensureQueryData.mockResolvedValue({ root: '/workspace', hostname: 'localhost' });
    setQueryData.mockReset();
    fetchDiffSummary.mockReset();
    const stored = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it.each(['work', 'staged', 'unstaged'])('remembers %s for the workspace', async (ref) => {
    fetchDiffSummary.mockResolvedValue({ fileCount: 0, threshold: 500 });

    await load(`?ref=${ref}`);

    expect(localStorage.getItem('diffity-changes:localhost:/workspace')).toBe(ref);
    if (ref === 'work') {
      expect((await load()).ref).toBe('work');
    } else {
      await expect(load('?view=unified&load=old')).rejects.toMatchObject({
        status: 302,
        headers: new Headers({ Location: `/diff?view=unified&ref=${ref}` }),
      });
    }
  });

  it('keeps workspace choices separate and ignores invalid saved refs', async () => {
    fetchDiffSummary.mockResolvedValue({ fileCount: 0, threshold: 500 });
    localStorage.setItem('diffity-changes:localhost:/other-workspace', 'staged');

    expect((await load()).ref).toBe('work');
    localStorage.setItem('diffity-changes:localhost:/workspace', 'main');
    expect((await load()).ref).toBe('work');
  });

  it('honors explicit refs without replacing the working changes choice with a branch', async () => {
    fetchDiffSummary.mockResolvedValue({ fileCount: 0, threshold: 500 });
    localStorage.setItem('diffity-changes:localhost:/workspace', 'staged');

    expect((await load('?ref=main')).ref).toBe('main');
    expect(localStorage.getItem('diffity-changes:localhost:/workspace')).toBe('staged');
    expect((await load('?ref=unstaged')).ref).toBe('unstaged');
    expect(localStorage.getItem('diffity-changes:localhost:/workspace')).toBe('unstaged');
  });

  it('keeps choices separate for servers behind the same URL with the same checkout path', async () => {
    fetchDiffSummary.mockResolvedValue({ fileCount: 0, threshold: 500 });
    ensureQueryData.mockResolvedValue({ root: '/workspace', hostname: 'first' });
    await load('?ref=staged');

    ensureQueryData.mockResolvedValue({ root: '/workspace', hostname: 'second' });
    expect((await load()).ref).toBe('work');
    await load('?ref=unstaged');

    await expect(load()).rejects.toMatchObject({
      headers: new Headers({ Location: '/diff?ref=unstaged' }),
    });
    ensureQueryData.mockResolvedValue({ root: '/workspace', hostname: 'first' });
    await expect(load()).rejects.toMatchObject({
      headers: new Headers({ Location: '/diff?ref=staged' }),
    });
  });

  it('loads diffs when storage is unavailable', async () => {
    fetchDiffSummary.mockResolvedValue({ fileCount: 0, threshold: 500 });
    vi.stubGlobal('localStorage', undefined);

    expect((await load()).ref).toBe('work');
    expect((await load('?ref=staged')).ref).toBe('staged');
  });

  it('does not request the diff or viewed-file hashes when the file count exceeds the threshold', async () => {
    fetchDiffSummary.mockResolvedValue({ fileCount: 2621, threshold: 500 });

    const result = await load('?ref=work');

    expect(result.largeDiff).toEqual({ fileCount: 2621, threshold: 500 });
    expect(ensureQueryData).toHaveBeenCalledOnce();
    expect(ensureQueryData.mock.calls[0][0].queryKey).toEqual(['repo-info', 'work']);
  });

  it('loads the diff after the user opts in', async () => {
    const token = allowOneLargeDiffLoad();
    const result = await load(`?ref=work&load=${token}`);

    expect(result.largeDiff).toBeNull();
    expect(fetchDiffSummary).not.toHaveBeenCalled();
    expect(ensureQueryData).toHaveBeenCalledTimes(3);

    fetchDiffSummary.mockResolvedValue({ fileCount: 2621, threshold: 500 });
    const reloaded = await load(`?ref=work&load=${token}`);

    expect(reloaded.largeDiff).toEqual({ fileCount: 2621, threshold: 500 });
    expect(ensureQueryData).toHaveBeenCalledTimes(4);
  });

  it('loads diffs at the threshold without prompting', async () => {
    fetchDiffSummary.mockResolvedValue({ fileCount: 500, threshold: 500 });

    const result = await load('?ref=work');

    expect(result.largeDiff).toBeNull();
    expect(ensureQueryData).toHaveBeenCalledTimes(3);
  });

  it('loads the diff with no viewed files when the viewed-files request fails', async () => {
    fetchDiffSummary.mockResolvedValue({ fileCount: 0, threshold: 500 });
    ensureQueryData.mockImplementation(async ({ queryKey }) => {
      if (queryKey[0] === 'viewed') {
        throw new Error('HTTP 502');
      }
      return { root: '/workspace', hostname: 'localhost' };
    });

    const result = await load('?ref=work');

    expect(result.largeDiff).toBeNull();
    expect(setQueryData).toHaveBeenCalledWith(['viewed', 'work'], { viewed: [], viewedAt: {} });
  });

  it('checks the new file count before refreshing an open diff', async () => {
    const refresh = vi.fn();
    const showGate = vi.fn();
    fetchDiffSummary.mockResolvedValue({ fileCount: 2621, threshold: 500 });

    await refreshDiffWithGate('work', refresh, showGate);

    expect(refresh).not.toHaveBeenCalled();
    expect(showGate).toHaveBeenCalledOnce();

    fetchDiffSummary.mockResolvedValue({ fileCount: 500, threshold: 500 });
    await refreshDiffWithGate('work', refresh, showGate);

    expect(refresh).toHaveBeenCalledOnce();
    expect(showGate).toHaveBeenCalledOnce();
  });
});
