'use client';
import { useSyncExternalStore } from 'react';
import { Moon, Sun } from 'lucide-react';
import { THEME_KEY } from './theme-script';
import './operations-theme.css';

// Light / Dark (pilot plan item 8). With nothing saved the app follows the device ("system"). The early script in
// app/layout.tsx sets data-theme on <html>; this file only saves a new choice and re-applies it. The choice is per
// device and never sent to the server.
export type ThemeChoice = 'light' | 'dark' | 'system';
const EVENT = 'rmc2-theme-change';

function subscribe(change: () => void) {
  const observer = new MutationObserver(change);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-theme-choice'] });
  window.addEventListener(EVENT, change);
  return () => { observer.disconnect(); window.removeEventListener(EVENT, change); };
}
const snapshot = () => (document.documentElement.getAttribute('data-theme-choice') || 'system') + '|' + (document.documentElement.getAttribute('data-theme') || 'light');

/** The saved choice and the theme in use ("system" resolved to light or dark). */
export function useTheme(): { choice: ThemeChoice; theme: 'light' | 'dark' } {
  const [choice, theme] = useSyncExternalStore(subscribe, snapshot, () => 'system|light').split('|');
  return { choice: choice as ThemeChoice, theme: theme === 'dark' ? 'dark' : 'light' };
}

export function setThemeChoice(choice: ThemeChoice) {
  try { if (choice === 'system') localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, choice); } catch { /* private mode: applies for this visit only */ }
  const apply = (window as Window & { __rmc2ApplyTheme?: () => void }).__rmc2ApplyTheme;
  if (apply) apply();
  // If storage was blocked, apply() reads "system"; set the attributes directly so the choice still holds for this visit.
  const resolved = choice === 'system' ? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : choice;
  document.documentElement.setAttribute('data-theme', resolved); document.documentElement.setAttribute('data-theme-choice', choice);
  window.dispatchEvent(new Event(EVENT));
}

/** Topbar (and sign-in screen) button that flips light and dark. It shows the icon of the theme it switches to. */
export function ThemeToggle() {
  const { theme } = useTheme();
  const label = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  return <button type="button" className="ops-icon ops-theme-toggle" data-now={theme} aria-label={label} title={label} onClick={() => setThemeChoice(theme === 'dark' ? 'light' : 'dark')}>
    <Moon size={18} aria-hidden="true" className="ops-theme-moon" /><Sun size={18} aria-hidden="true" className="ops-theme-sun" />
  </button>;
}
