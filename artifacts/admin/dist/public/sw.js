self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "New Notification", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "Krishna Village";
  const options = {
    body: data.body || "",
    icon: "/admin/kv-icon.png",
    badge: "/admin/favicon-32.png",
    tag: data.type || "notification",
    requireInteraction: data.type === "urgent_maintenance",
    data: data,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes("/admin") && "focus" in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow("/admin/maintenance");
      }
    }),
  );
});
