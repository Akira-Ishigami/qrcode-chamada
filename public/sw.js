// Service Worker — Web Push handler para notificações do Calendário Escolar

self.addEventListener("push", (event) => {
  let data = { title: "Calendário Escolar", body: "Novo evento adicionado", url: "/calendario.html" };

  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (e) {}

  const options = {
    body:    data.body,
    icon:    "/icon-192.png",
    badge:   "/icon-192.png",
    vibrate: [100, 50, 100],
    data:    { url: data.url },
    actions: [
      { action: "ver", title: "Ver Calendário" },
      { action: "fechar", title: "Fechar" },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action === "fechar") return;

  const url = event.notification.data?.url ?? "/calendario.html";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(url) && "focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

self.addEventListener("install",  () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
