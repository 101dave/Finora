/**
 * Theme: follows the system preference until a person makes an explicit choice,
 * then remembers that choice.
 */
import { THEME_KEY } from './config.js';

const listeners = new Set();

function storedPreference() {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch (error) {
    return null;
  }
}

export function systemTheme() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function currentTheme() {
  return storedPreference() ?? systemTheme();
}

function paintChrome(theme) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#14110e' : '#f7f4ee');

  const icon = theme === 'dark' ? '☀' : '☾';
  const label = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';

  for (const node of document.querySelectorAll('#themeIcon, #authThemeIcon')) node.textContent = icon;
  for (const button of document.querySelectorAll('#themeBtn, #authThemeBtn')) {
    button.setAttribute('aria-label', label);
    button.title = label;
  }
}

export function applyTheme() {
  const theme = currentTheme();
  document.documentElement.dataset.theme = theme;
  paintChrome(theme);
  return theme;
}

export function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch (error) { /* private mode: the choice simply won't be remembered */ }

  applyTheme();
  for (const listener of listeners) listener(next);
  return next;
}

export function onThemeChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function initTheme() {
  applyTheme();

  const query = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  if (!query?.addEventListener) return;

  query.addEventListener('change', () => {
    if (storedPreference()) return; // an explicit choice wins over the system
    const theme = applyTheme();
    for (const listener of listeners) listener(theme);
  });
}
