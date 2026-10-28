import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const initial = (): Theme => (document.documentElement.classList.contains('dark') ? 'dark' : 'light');

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(initial);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#070b17' : '#eef2ff');
    try {
      localStorage.setItem('omni-theme', theme);
    } catch {
      /* mode privat: abaikan */
    }
  }, [theme]);

  const toggle = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);
  return { theme, toggle };
}
