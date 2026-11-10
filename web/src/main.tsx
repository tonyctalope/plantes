import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { navigate } from './lib/router.tsx';
import './styles.css';

// Scroll positions are restored by the pages themselves once their data is in.
if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';

if ('serviceWorker' in navigator) {
  // The worker shows push notifications; a click on one asks this tab to route.
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
  navigator.serviceWorker.addEventListener('message', (event: MessageEvent<unknown>) => {
    const data = event.data;
    if (data && typeof data === 'object' && 'type' in data && data.type === 'navigate' && 'url' in data) {
      if (typeof data.url === 'string') navigate(data.url);
    }
  });
}

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing from index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
