import { beforeEach, describe, expect, it, vi } from 'vitest';

const { ensureQueryData, fetchDiffSummary } = vi.hoisted(() => ({
  ensureQueryData: vi.fn(),
  fetchDiffSummary: vi.fn(),
}));

vi.mock('../src/lib/query-client', () => ({ queryClient: { ensureQueryData } }));
vi.mock('../src/lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/lib/api')>(),
  fetchDiffSummary,
}));

import { clientLoader } from '../src/routes/diff';
import { allowOneLargeDiffLoad, refreshDiffWithGate } from '../src/lib/large-diff-gate';

function load(search = '') {
  return clientLoader({ request: new Request(`http://localhost/diff${search}`) } as Parameters<typeof clientLoader>[0]);
}

describe('large diff gate', () => {
  beforeEach(() => {
    ensureQueryData.mockReset();
    fetchDiffSummary.mockReset();
  });

  it('does not request the diff or viewed-file hashes when the file count exceeds the threshold', async () => {
    fetchDiffSummary.mockResolvedValue({ fileCount: 2621, threshold: 500 });

    const result = await load('?ref=work');

    expect(result.largeDiff).toEqual({ fileCount: 2621, threshold: 500 });
    expect(ensureQueryData).not.toHaveBeenCalled();
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
    expect(ensureQueryData).toHaveBeenCalledTimes(3);
  });

  it('loads diffs at the threshold without prompting', async () => {
    fetchDiffSummary.mockResolvedValue({ fileCount: 500, threshold: 500 });

    const result = await load('?ref=work');

    expect(result.largeDiff).toBeNull();
    expect(ensureQueryData).toHaveBeenCalledTimes(3);
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
