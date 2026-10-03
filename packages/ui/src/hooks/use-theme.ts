import { useState, useEffect, useLayoutEffect, useCallback } from 'react';

type Theme = 'light' | 'dark';

export function getTheme(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

// The initial theme is resolved before first paint by the bootstrap script in
// root.tsx, so start from whatever it applied.
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(getTheme);

  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme(prev => {
      const next = prev === 'light' ? 'dark' : 'light';
      localStorage.setItem('diffity-theme', next);
      return next;
    });
  }, []);

  return { theme, toggleTheme };
}
