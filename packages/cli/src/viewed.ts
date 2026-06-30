import { createHash } from 'node:crypto';
import type { DiffFile } from '@diffity/parser';
import { getDb } from './db.js';

interface ViewedRow {
  file_path: string;
  content_hash: string;
}

export interface ViewedRecord {
  filePath: string;
  contentHash: string;
}

/**
 * The stable identity of a file used to display it in the diff. Mirrors the UI's
 * getFilePath: deleted files are keyed by their old path, everything else by the new path.
 */
export function filePathForFile(file: DiffFile): string {
  return file.status === 'deleted' ? file.oldPath : file.newPath;
}

/**
 * A content hash for a file's diff. Computed from the canonical diff (callers must
 * build it without `-w`), so it changes only when the file's actual content changes —
 * toggling "hide whitespace" in the UI does not affect it.
 */
export function hashDiffFile(file: DiffFile): string {
  const parts: string[] = [file.status, file.oldPath, file.newPath];
  for (const hunk of file.hunks) {
    parts.push(hunk.header);
    for (const line of hunk.lines) {
      parts.push(`${line.type}${line.content}${line.noNewline ? '\\' : ''}`);
    }
  }
  return createHash('sha1').update(parts.join('\n')).digest('hex');
}

export function getViewedRecords(ref: string): ViewedRecord[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT file_path, content_hash FROM viewed_files WHERE ref = ?'
  ).all(ref) as ViewedRow[];
  return rows.map((row) => ({ filePath: row.file_path, contentHash: row.content_hash }));
}

export function setViewedFile(ref: string, filePath: string, contentHash: string): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO viewed_files (ref, file_path, content_hash, viewed_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(ref, file_path) DO UPDATE SET content_hash = excluded.content_hash, viewed_at = excluded.viewed_at
  `).run(ref, filePath, contentHash);
}

export function unsetViewedFile(ref: string, filePath: string): void {
  const db = getDb();
  db.prepare('DELETE FROM viewed_files WHERE ref = ? AND file_path = ?').run(ref, filePath);
}
