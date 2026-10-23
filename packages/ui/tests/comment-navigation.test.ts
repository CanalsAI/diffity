import { describe, expect, it } from 'vitest';
import type { CommentThread } from '../src/types/comment';
import {
  buildFirstOpenThreadByFile,
  buildThreadCountsByFile,
  getFilesCommentedSinceViewed,
  getThreadLineLabel,
  getThreadPreview,
} from '../src/lib/comment-navigation';

function makeThread(overrides: Partial<CommentThread> = {}): CommentThread {
  return {
    id: 'thread-1',
    filePath: 'src/example.ts',
    side: 'new',
    startLine: 10,
    endLine: 10,
    comments: [
      {
        id: 'comment-1',
        author: { name: 'You', type: 'user' },
        body: 'Please tighten this up a bit.',
        createdAt: '2026-03-17T12:00:00Z',
      },
    ],
    status: 'open',
    ...overrides,
  };
}

describe('buildFirstOpenThreadByFile', () => {
  it('picks the first unresolved thread in diff order and then by line', () => {
    const firstThreads = buildFirstOpenThreadByFile(
      [
        makeThread({ id: 'resolved', filePath: 'src/ignored.ts', status: 'resolved' }),
        makeThread({ id: 'general', filePath: '__general__' }),
        makeThread({ id: 'b-20', filePath: 'src/b.ts', startLine: 20 }),
        makeThread({ id: 'a-12', filePath: 'src/a.ts', startLine: 12, side: 'old' }),
        makeThread({ id: 'a-5', filePath: 'src/a.ts', startLine: 5 }),
      ],
      ['src/b.ts', 'src/a.ts'],
    );

    expect(Array.from(firstThreads.entries())).toEqual([
      ['src/b.ts', 'b-20'],
      ['src/a.ts', 'a-5'],
    ]);
  });
});

describe('buildThreadCountsByFile', () => {
  it('counts unresolved file threads only', () => {
    const counts = buildThreadCountsByFile([
      makeThread({ id: 'one', filePath: 'src/a.ts' }),
      makeThread({ id: 'two', filePath: 'src/a.ts' }),
      makeThread({ id: 'resolved', filePath: 'src/b.ts', status: 'resolved' }),
      makeThread({ id: 'general', filePath: '__general__' }),
    ]);

    expect(Array.from(counts.entries())).toEqual([['src/a.ts', 2]]);
  });
});

describe('getFilesCommentedSinceViewed', () => {
  it('returns viewed files with an unresolved comment or reply newer than the viewed time', () => {
    const reply = {
      id: 'reply',
      author: { name: 'Agent', type: 'agent' as const },
      body: 'Follow-up',
      createdAt: '2026-03-17T14:00:00Z',
    };
    const files = getFilesCommentedSinceViewed(
      [
        makeThread({ id: 'old', filePath: 'src/old.ts' }),
        makeThread({ id: 'new', filePath: 'src/new.ts' }),
        makeThread({ id: 'reply', filePath: 'src/reply.ts', comments: [...makeThread().comments, reply] }),
        makeThread({ id: 'resolved', filePath: 'src/resolved.ts', status: 'resolved' }),
        makeThread({ id: 'unviewed', filePath: 'src/unviewed.ts' }),
      ],
      {
        'src/old.ts': '2026-03-17T13:00:00Z',
        'src/new.ts': '2026-03-17T11:00:00Z',
        'src/reply.ts': '2026-03-17T13:00:00Z',
        'src/resolved.ts': '2026-03-17T11:00:00Z',
      },
    );

    expect(Array.from(files).sort()).toEqual(['src/new.ts', 'src/reply.ts']);
  });
});

describe('thread formatting helpers', () => {
  it('formats single-line and multi-line labels', () => {
    expect(getThreadLineLabel(makeThread({ startLine: 7, endLine: 7 }))).toBe('L7');
    expect(getThreadLineLabel(makeThread({ startLine: 7, endLine: 10 }))).toBe('L7-10');
  });

  it('normalizes whitespace and truncates previews', () => {
    const preview = getThreadPreview(
      makeThread({
        comments: [
          {
            id: 'comment-1',
            author: { name: 'You', type: 'user' },
            body: '  Multi-line\ncomment with   extra spacing and enough text to force truncation in the preview list.  ',
            createdAt: '2026-03-17T12:00:00Z',
          },
        ],
      }),
      48,
    );

    expect(preview).toBe('Multi-line comment with extra spacing and...');
  });
});
