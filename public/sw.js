// Service Worker for Academic ERP HOD Mobile Push Notifications

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Handle direct messages from client application
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    const { title, options } = event.data;
    const notificationOptions = {
      body: options?.body || 'Your scheduled reminder is due now.',
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      tag: options?.tag || 'hod-reminder',
      renotify: true,
      data: options?.data || '/',
      vibrate: [200, 100, 200, 100, 200],
      ...options
    };
    event.waitUntil(
      self.registration.showNotification(title || '🔔 Academic Dashboard', notificationOptions)
    );
  }
});

// Handle incoming Web Push notifications
self.addEventListener('push', (event) => {
  let data = { title: '🔔 Academic Dashboard', body: 'Your scheduled reminder is due now.' };
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body || 'Your scheduled reminder is due now.',
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    tag: data.tag || 'hod-reminder',
    renotify: true,
    data: data.url || '/',
    vibrate: [200, 100, 200, 100, 200],
    actions: [
      { action: 'open', title: 'Open Dashboard' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title || '🔔 Academic Dashboard', options)
  );
});

// Handle notification click action
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = event.notification.data || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (let client of windowClients) {
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
