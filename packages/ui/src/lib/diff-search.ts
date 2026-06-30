import type { DiffFile, DiffLine } from '@diffity/parser';
import { getFilePath } from './diff-utils';

export interface SearchMatch {
  /** Stable, unique identity for this match across renders. */
  id: string;
  /** Index into `diff.files`, used to drive the virtualizer. */
  fileIndex: number;
  filePath: string;
  /** Identifies the rendered content cell within a file (see `getLineKey`). */
  lineKey: string;
  side: 'old' | 'new';
  /** Character offset of the match start within the line content. */
  start: number;
  /** Character offset of the match end within the line content. */
  end: number;
}

/**
 * Stable identifier for a diff line's rendered content cell, scoped to its
 * file. Both the unified and split renderers tag their content `<td>` with this
 * via `data-line-key`, so search highlighting can locate a line in the DOM
 * regardless of view mode. A delete/add/context line always maps to the same
 * key, and the triple is unique within a single file.
 */
export function getLineKey(line: DiffLine): string {
  return `${line.type}:${line.oldLineNumber ?? ''}:${line.newLineNumber ?? ''}`;
}

/**
 * Finds every occurrence of `query` across the diff's hunk line content. The
 * search runs over the parsed data model rather than the DOM, so it covers
 * lines that are currently virtualized away and not rendered. Matching is
 * case-insensitive plain-substring.
 */
export function findMatches(files: DiffFile[], query: string): SearchMatch[] {
  const needle = query.toLowerCase();
  if (needle.length === 0) {
    return [];
  }

  const matches: SearchMatch[] = [];

  for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
    const file = files[fileIndex];
    const filePath = getFilePath(file);

    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        const content = line.content;
        if (!content) {
          continue;
        }

        const haystack = content.toLowerCase();
        const lineKey = getLineKey(line);
        const side: 'old' | 'new' = line.type === 'delete' ? 'old' : 'new';

        let from = 0;
        let idx = haystack.indexOf(needle, from);
        while (idx !== -1) {
          matches.push({
            id: `${fileIndex}:${lineKey}:${idx}`,
            fileIndex,
            filePath,
            lineKey,
            side,
            start: idx,
            end: idx + needle.length,
          });
          from = idx + needle.length;
          idx = haystack.indexOf(needle, from);
        }
      }
    }
  }

  return matches;
}
