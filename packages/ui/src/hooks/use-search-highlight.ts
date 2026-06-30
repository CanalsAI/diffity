import { useEffect } from 'react';
import type { SearchMatch } from '../lib/diff-search';

const ALL_HIGHLIGHT = 'diffity-search';
const CURRENT_HIGHLIGHT = 'diffity-search-current';

interface HighlightRegistry {
  set(name: string, highlight: unknown): void;
  delete(name: string): void;
}

function highlightApi(): { registry: HighlightRegistry; Ctor: new () => { add(range: Range): void } } | null {
  const css = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS;
  const Ctor = (globalThis as { Highlight?: new () => { add(range: Range): void } }).Highlight;
  if (!css?.highlights || typeof Ctor !== 'function') {
    return null;
  }
  return { registry: css.highlights, Ctor };
}

function clearHighlights(registry: HighlightRegistry) {
  registry.delete(ALL_HIGHLIGHT);
  registry.delete(CURRENT_HIGHLIGHT);
}

/**
 * Builds a DOM Range spanning [start, end) character offsets within a content
 * cell. The cell's concatenated text content equals the line content, so we can
 * walk its text nodes and map offsets to (node, offset) boundaries.
 */
function rangeForOffsets(cell: Element, start: number, end: number): Range | null {
  const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
  let pos = 0;
  let startNode: Node | null = null;
  let startOffset = 0;
  let endNode: Node | null = null;
  let endOffset = 0;

  let node = walker.nextNode();
  while (node) {
    const len = node.textContent?.length ?? 0;
    const nodeEnd = pos + len;

    if (startNode === null && start < nodeEnd) {
      startNode = node;
      startOffset = start - pos;
    }
    if (startNode !== null && end <= nodeEnd) {
      endNode = node;
      endOffset = end - pos;
      break;
    }

    pos = nodeEnd;
    node = walker.nextNode();
  }

  if (startNode === null || endNode === null) {
    return null;
  }

  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  return range;
}

/**
 * Highlights search matches in the rendered diff using the CSS Custom Highlight
 * API. Because the diff is virtualized, only matches whose file and line are
 * currently in the DOM can be painted; the hook re-applies whenever the DOM
 * mutates (virtualization re-renders, async syntax highlighting), so matches
 * light up as they scroll into view. If the browser lacks the Highlight API,
 * search navigation still works — only the inline highlight is skipped.
 */
export function useSearchHighlight(params: {
  scrollElement: HTMLElement | null;
  matches: SearchMatch[];
  currentId: string | null;
  active: boolean;
}) {
  const { scrollElement, matches, currentId, active } = params;

  useEffect(() => {
    const api = highlightApi();
    if (!api) {
      return;
    }
    const { registry, Ctor } = api;

    if (!active || matches.length === 0) {
      clearHighlights(registry);
      return;
    }

    const apply = () => {
      const all = new Ctor();
      const current = new Ctor();

      for (const match of matches) {
        const fileEl = document.getElementById(`file-${encodeURIComponent(match.filePath)}`);
        if (!fileEl) {
          continue;
        }
        const cells = fileEl.querySelectorAll(`[data-line-key="${match.lineKey}"]`);
        for (const cell of cells) {
          const range = rangeForOffsets(cell, match.start, match.end);
          if (!range) {
            continue;
          }
          if (match.id === currentId) {
            current.add(range);
          } else {
            all.add(range);
          }
        }
      }

      registry.set(ALL_HIGHLIGHT, all);
      registry.set(CURRENT_HIGHLIGHT, current);
    };

    apply();

    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(apply);
    };

    const observer = new MutationObserver(schedule);
    if (scrollElement) {
      observer.observe(scrollElement, { childList: true, subtree: true, characterData: true });
    }

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      clearHighlights(registry);
    };
  }, [scrollElement, matches, currentId, active]);
}
