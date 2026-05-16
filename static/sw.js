self.addEventListener('push', function(event) {
    const data = event.data ? event.data.json() : { title: '새 기록', body: '새로운 기록이 추가됐어요 ♡' };
    event.waitUntil(
        self.registration.showNotification(data.title, {
            body: data.body,
            vibrate: [200, 100, 200],
            data: { url: self.location.origin }
        })
    );
});

self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window' }).then(function(list) {
            for (const client of list) {
                if ('focus' in client) return client.focus();
            }
            if (clients.openWindow) return clients.openWindow('/');
        })
    );
});
