/* Plantes service worker: push notifications only (no offline cache, so the
   app never shows stale watering data). Plain JS, served as-is at /sw.js. */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

function readPayload(event) {
  if (!event.data) return {};
  try {
    const data = event.data.json();
    return data && typeof data === 'object' ? data : {};
  } catch {
    return { body: event.data.text() };
  }
}

self.addEventListener('push', (event) => {
  const data = readPayload(event);
  const plantIds = Array.isArray(data.plantIds) ? data.plantIds.filter((id) => Number.isInteger(id) && id > 0) : [];
  const url = typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/';
  const title = typeof data.title === 'string' && data.title ? data.title : 'Plantes';
  const options = {
    body: typeof data.body === 'string' ? data.body : '',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    tag: typeof data.tag === 'string' && data.tag ? data.tag : 'plantes',
    renotify: true,
    lang: 'fr',
    data: { url, plantIds },
    actions: plantIds.length === 1 ? [{ action: 'water', title: 'Arrosé ✓' }] : [],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

async function markWatered(plantId, url) {
  try {
    const response = await fetch(`/api/plants/${plantId}/care`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ type: 'water', source: 'notification' }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch {
    await self.registration.showNotification("L'arrosage n'a pas été enregistré", {
      body: "Ouvre l'appli pour réessayer.",
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      tag: 'plantes-error',
      lang: 'fr',
      data: { url, plantIds: [] },
    });
  }
}

async function openApp(url) {
  const target = new URL(url, self.location.origin).href;
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of windows) {
    if (new URL(client.url).origin !== self.location.origin) continue;
    await client.focus();
    // The page routes itself (no reload) — see main.tsx.
    client.postMessage({ type: 'navigate', url });
    return;
  }
  await self.clients.openWindow(target);
}

self.addEventListener('notificationclick', (event) => {
  const data = event.notification.data || {};
  const url = typeof data.url === 'string' ? data.url : '/';
  const plantIds = Array.isArray(data.plantIds) ? data.plantIds : [];
  event.notification.close();
  if (event.action === 'water' && plantIds.length === 1) {
    event.waitUntil(markWatered(plantIds[0], url));
    return;
  }
  event.waitUntil(openApp(url));
});
