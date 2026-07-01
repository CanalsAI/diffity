import { useState, useCallback } from 'react';

const STORAGE_KEY = 'diffity-auto-collapse';

function getStored(): boolean {
  if (typeof window === 'undefined') {
    return true;
  }
  // Default on: preserve the historical behaviour unless explicitly disabled.
  return localStorage.getItem(STORAGE_KEY) !== 'false';
}

export function useAutoCollapse() {
  const [autoCollapse, setAutoCollapse] = useState<boolean>(getStored);

  const toggleAutoCollapse = useCallback(() => {
    setAutoCollapse(prev => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  return { autoCollapse, toggleAutoCollapse };
}
