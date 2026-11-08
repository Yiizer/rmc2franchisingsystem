'use client';
import { useEffect } from 'react';
import { sendCrash } from './operations-crash-report';
import './operations-report-problem.css';

// Shown instead of a blank screen when a screen fails to draw. The error is logged to Problem reports (Errors tab).
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => { sendCrash('render', error); }, [error]);
  return <main className="ops-app ops-crash-screen">
    <section className="ops-card ops-pad" role="alert">
      <h1>Something went wrong on this screen</h1>
      <p>The problem was logged for the Head automatically. Anything already saved is safe. Try again, or reload the page.</p>
      <div className="ops-actions"><button type="button" className="ops-btn primary" onClick={() => retry()}>Try again</button><button type="button" className="ops-btn" onClick={() => window.location.reload()}>Reload page</button></div>
    </section>
  </main>;
}
