/*
 * AIRA Web_Push service worker.
 *
 * A minimal, build-step-free service worker served from the site root at `/sw.js`.
 * The Settings page registers it (`navigator.serviceWorker.register('/sw.js')`) once
 * the user grants the Notification permission; the push subscription obtained from
 * `registration.pushManager.subscribe(...)` is POSTed to
 * `/api/notifications/subscriptions`.
 *
 * The server (WebPushSender, VAPID) delivers a payload shaped as
 * `{ title, body, data }` (see src/lib/notifications/web-push-sender.ts). This worker:
 *   1. on 'push'            — shows a system notification from that payload.
 *   2. on 'notificationclick' — focuses an existing AIRA tab, or opens one.
 *
 * Plain ES5-ish JS so it runs in the service-worker global scope without bundling.
 */

/* global self, clients */

self.addEventListener('push', function (event) {
  // Decode the JSON payload the server sent. Fall back to an empty object so a
  // malformed/empty push still surfaces a generic notification rather than throwing.
  var payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch (err) {
      payload = { body: event.data.text() };
    }
  }

  var title = payload.title || 'AIRA';
  var options = {
    body: payload.body || '',
    data: payload.data || {},
    // A stable tag collapses repeat notifications of the same kind; the icon/badge
    // reuse the app's existing public assets if present.
    icon: '/icon.png',
    badge: '/badge.png',
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();

  // Prefer a deep link supplied in the payload data, else land on the app root.
  var targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (windowClients) {
      // Focus an already-open AIRA tab when one exists.
      for (var i = 0; i < windowClients.length; i += 1) {
        var client = windowClients[i];
        if ('focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      // Otherwise open a new window to the target.
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
      return undefined;
    }),
  );
});
