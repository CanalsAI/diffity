import { fetchDiffSummary, type DiffSummary } from './api';

let pendingLoadToken: string | null = null;

export function allowOneLargeDiffLoad(): string {
  pendingLoadToken = crypto.randomUUID();
  return pendingLoadToken;
}

export function consumeLargeDiffLoad(token: string | null): boolean {
  if (!token || token !== pendingLoadToken) {
    return false;
  }
  pendingLoadToken = null;
  return true;
}

export async function getLargeDiffSummary(ref: string): Promise<DiffSummary | null> {
  const summary = await fetchDiffSummary(ref);
  return summary.fileCount > summary.threshold ? summary : null;
}

export async function refreshDiffWithGate(
  ref: string,
  refresh: () => void,
  showGate: () => void,
): Promise<void> {
  if (await getLargeDiffSummary(ref)) {
    showGate();
  } else {
    refresh();
  }
}
