import { useEffect, useRef } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';

interface KeyboardActions {
  onNextFile: () => void;
  onPrevFile: () => void;
  onNextHunk: () => void;
  onPrevHunk: () => void;
  onToggleCollapse: () => void;
  onCollapseAll: () => void;
  onToggleReviewed: () => void;
  onUnifiedView: () => void;
  onSplitView: () => void;
  onShowHelp: () => void;
  onFocusSearch: () => void;
  onFindInDiff: () => void;
  onEscape: () => void;
}

const HOTKEY_OPTIONS = { preventDefault: true };

function isInputFocused(): boolean {
  const tag = document.activeElement?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA';
}

export function useKeyboard(actions: KeyboardActions) {
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  useHotkeys('j', actions.onNextFile, HOTKEY_OPTIONS);
  useHotkeys('k', actions.onPrevFile, HOTKEY_OPTIONS);
  useHotkeys('n', actions.onNextHunk, HOTKEY_OPTIONS);
  useHotkeys('p', actions.onPrevHunk, HOTKEY_OPTIONS);
  useHotkeys('x', actions.onToggleCollapse, HOTKEY_OPTIONS);
  useHotkeys('shift+x', actions.onCollapseAll, HOTKEY_OPTIONS);
  useHotkeys('r', actions.onToggleReviewed, HOTKEY_OPTIONS);
  useHotkeys('u', actions.onUnifiedView, HOTKEY_OPTIONS);
  useHotkeys('s', actions.onSplitView, HOTKEY_OPTIONS);
  useHotkeys('escape', actions.onEscape, { enableOnFormTags: ['INPUT', 'TEXTAREA'] });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'F') && !e.shiftKey) {
        // Escape hatch: if the in-app search is already focused, let this
        // second press through to the browser's native find. Otherwise focus
        // our search (native find can't be opened from JS).
        const active = document.activeElement as HTMLElement | null;
        if (active?.getAttribute('placeholder') === 'Search changes...') {
          return;
        }
        e.preventDefault();
        actionsRef.current.onFindInDiff();
        return;
      }
      if (e.key === '/' && !isInputFocused()) {
        e.preventDefault();
        actionsRef.current.onFocusSearch();
      }
      if (e.key === '?' && !isInputFocused()) {
        e.preventDefault();
        actionsRef.current.onShowHelp();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}
