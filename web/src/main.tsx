import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import PageErrorBoundary from './components/PageErrorBoundary';

// New deployments may remove a lazy-loaded chunk still referenced by an open tab.
window.addEventListener('vite:preloadError', (event) => {
  try {
    const lastReload = Number(sessionStorage.getItem('chunk-reload-at') || '0');
    if (Date.now() - lastReload < 60000 || !navigator.onLine) return;
    sessionStorage.setItem('chunk-reload-at', String(Date.now()));
    event.preventDefault();
    window.location.reload();
  } catch { /* The error boundary remains available when storage is disabled. */ }
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PageErrorBoundary><App /></PageErrorBoundary>
  </React.StrictMode>,
);

if ('serviceWorker' in navigator && (window.isSecureContext || window.location.hostname === 'localhost')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.error('Service worker registration failed:', error);
    });
  });
}
