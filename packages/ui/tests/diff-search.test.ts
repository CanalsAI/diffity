import { describe, it, expect } from 'vitest';
import type { DiffFile, DiffLine } from '@diffity/parser';
import { findMatches, getLineKey } from '../src/lib/diff-search';

function line(type: DiffLine['type'], content: string, oldNum: number | null, newNum: number | null): DiffLine {
  return { type, content, oldLineNumber: oldNum, newLineNumber: newNum };
}

function fileWith(path: string, lines: DiffLine[]): DiffFile {
  return {
    oldPath: path,
    newPath: path,
    status: 'modified',
    additions: 0,
    deletions: 0,
    isBinary: false,
    hunks: [{ header: '', oldStart: 1, oldCount: 0, newStart: 1, newCount: 0, lines }],
  };
}

describe('getLineKey', () => {
  it('encodes type and both line numbers', () => {
    expect(getLineKey(line('context', 'x', 3, 4))).toBe('context:3:4');
    expect(getLineKey(line('add', 'x', null, 7))).toBe('add::7');
    expect(getLineKey(line('delete', 'x', 5, null))).toBe('delete:5:');
  });
});

describe('findMatches', () => {
  it('returns nothing for an empty query', () => {
    const files = [fileWith('a.ts', [line('add', 'hello world', null, 1)])];
    expect(findMatches(files, '')).toEqual([]);
  });

  it('matches case-insensitively across files', () => {
    const files = [
      fileWith('a.ts', [line('add', 'const Foo = 1', null, 1)]),
      fileWith('b.ts', [line('context', 'return foo()', 2, 2)]),
    ];
    const matches = findMatches(files, 'foo');
    expect(matches).toHaveLength(2);
    expect(matches[0].fileIndex).toBe(0);
    expect(matches[0].filePath).toBe('a.ts');
    expect(matches[0].side).toBe('new');
    expect(matches[1].fileIndex).toBe(1);
    expect(matches[1].filePath).toBe('b.ts');
  });

  it('reports the character offsets of the match', () => {
    const files = [fileWith('a.ts', [line('add', 'abc target xyz', null, 1)])];
    const [match] = findMatches(files, 'target');
    expect(match.start).toBe(4);
    expect(match.end).toBe(10);
  });

  it('finds every occurrence within a line with distinct ids', () => {
    const files = [fileWith('a.ts', [line('add', 'na na na', null, 1)])];
    const matches = findMatches(files, 'na');
    expect(matches).toHaveLength(3);
    expect(matches.map((m) => m.start)).toEqual([0, 3, 6]);
    expect(new Set(matches.map((m) => m.id)).size).toBe(3);
  });

  it('uses the old side for deleted lines', () => {
    const files = [fileWith('a.ts', [line('delete', 'gone', 9, null)])];
    const [match] = findMatches(files, 'gone');
    expect(match.side).toBe('old');
    expect(match.lineKey).toBe('delete:9:');
  });

  it('skips empty line content', () => {
    const files = [fileWith('a.ts', [line('context', '', 1, 1)])];
    expect(findMatches(files, 'x')).toEqual([]);
  });
});
