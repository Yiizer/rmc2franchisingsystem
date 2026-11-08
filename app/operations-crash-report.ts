'use client';
import { useEffect } from 'react';
import type { CrashSource } from '@/lib/operations/types';
import { api } from './operations-common';

// Automatic error tracking (pilot plan 2026-11-16, item 6). Uncaught errors in the browser are logged into the same
// Problem reports list as typed reports, on an Errors tab. No outside service. Only the error message, a shortened
// stack, the page, the open inquiry id, the window size and the browser are sent; never form contents or screenshots.
const MAX_PER_LOAD = 5;
const sent = new Set<string>();
let currentPage = 'Unknown page';

const inquiryFromHash = () => /^#(?:inquiry|my-clients)\/([A-Za-z0-9-]{1,40})$/.exec(window.location.hash)?.[1];
const fromExtension = (text = '') => /(?:chrome|moz|safari(?:-web)?)-extension:\/\//.test(text);
/** Browser noise that is not a bug in this app. */
const ignored = (message: string) => /^(?:Script error\.?|ResizeObserver loop)/i.test(message) || /AbortError|The user aborted a request/i.test(message);

export function sendCrash(source: CrashSource, error: unknown, fallbackMessage = '') {
  try {
    const failure = error instanceof Error ? error : undefined;
    // Answers from our own server (they carry a status) were already shown to the person and are not crashes.
    if (failure && typeof (failure as Error & { status?: unknown }).status === 'number') return;
    const message = (failure ? failure.name !== 'Error' ? failure.name + ': ' + failure.message : failure.message : typeof error === 'string' ? error : fallbackMessage || 'Unknown error').trim().slice(0, 1000);
    const stack = (failure?.stack || '').slice(0, 8000);
    if (!message || ignored(message) || fromExtension(stack)) return;
    const key = message + '|' + stack.split('\n').slice(0, 2).join('|');
    if (sent.has(key) || sent.size >= MAX_PER_LOAD) return;
    sent.add(key);
    const inquiryId = inquiryFromHash();
    void api('problem-reports', { kind: 'error', source, message, ...(stack ? { stack } : {}), page: currentPage, ...(inquiryId ? { inquiryId } : {}), viewport: Math.round(window.innerWidth) + 'x' + Math.round(window.innerHeight) }).catch(() => undefined);
  } catch { /* error tracking must never cause an error itself */ }
}

/** Listens for uncaught errors while someone is signed in. Called once from the top bar. */
export function useCrashReporter(page: string) {
  useEffect(() => { currentPage = page || 'Unknown page'; }, [page]);
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      if (event.filename && (fromExtension(event.filename) || !event.filename.startsWith(window.location.origin))) return;
      sendCrash('error', event.error, event.message);
    };
    const onRejection = (event: PromiseRejectionEvent) => sendCrash('unhandledrejection', event.reason, String(event.reason ?? ''));
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => { window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onRejection); };
  }, []);
}
