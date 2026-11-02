import { createContext, useCallback, useContext, useRef, useState, type SetStateAction } from 'react';

const CommentDraftContext = createContext<Map<string, unknown> | null>(null);

export function CommentDraftProvider({ children }: { children: React.ReactNode }) {
  const drafts = useRef(new Map<string, unknown>());
  return <CommentDraftContext value={drafts.current}>{children}</CommentDraftContext>;
}

export function useCommentDraftState<T>(key: string | undefined, initialValue: T): [T, (value: SetStateAction<T>) => void, boolean] {
  const drafts = useContext(CommentDraftContext);
  const initialValueRef = useRef(initialValue);
  const [restored] = useState(() => key !== undefined && !!drafts?.has(key));
  const [value, setValue] = useState<T>(() => restored ? drafts!.get(key!) as T : initialValue);
  const valueRef = useRef(value);

  const updateValue = useCallback((action: SetStateAction<T>) => {
    const nextValue = typeof action === 'function' ? (action as (previous: T) => T)(valueRef.current) : action;
    valueRef.current = nextValue;
    if (key !== undefined) {
      if (Object.is(nextValue, initialValueRef.current)) {
        drafts?.delete(key);
      } else {
        drafts?.set(key, nextValue);
      }
    }
    setValue(nextValue);
  }, [drafts, key]);

  return [value, updateValue, restored];
}
