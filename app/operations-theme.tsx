'use client';
import { useSyncExternalStore } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { THEME_KEY } from './theme-script';
import './operations-theme.css';

// Light / Dark / System (pilot plan item 8). The early script in app/layout.tsx sets data-theme on <html>; this file
// only saves a new choice and re-applies it. The choice is per device and never sent to the server.
export type ThemeChoice = 'light' | 'dark' | 'system';
const CHOICES: { value: ThemeChoice; label: string; Icon: typeof Sun }[] = [{ value: 'light', label: 'Light', Icon: Sun }, { value: 'dark', label: 'Dark', Icon: Moon }, { value: 'system', label: 'System', Icon: Monitor }];
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

/** Three-way switch. `compact` shows icons only (login screen); labels stay available to screen readers. */
export function ThemeSwitch({ compact = false }: { compact?: boolean }) {
  const { choice } = useTheme();
  return <fieldset className={'ops-theme-switch' + (compact ? ' compact' : '')}>
    <legend className={compact ? 'sr-only' : undefined}>Appearance</legend>
    <div>{CHOICES.map(({ value, label, Icon }) => <label key={value} title={compact ? label : undefined} className={choice === value ? 'active' : ''}>
      <input type="radio" name="ops-theme" value={value} checked={choice === value} onChange={() => setThemeChoice(value)} />
      <Icon size={16} aria-hidden="true" /><span className={compact ? 'sr-only' : undefined}>{label}</span>
    </label>)}</div>
  </fieldset>;
}

export function AppearanceSettings() {
  return <section className="ops-card ops-pad ops-appearance">
    <h2>Appearance</h2>
    <p>Choose light or dark, or follow this device&apos;s setting. Saved on this device only. Proposals and PDFs always stay light.</p>
    <ThemeSwitch />
  </section>;
}
