self.addEventListener("notificationclick", event => {
    event.notification.close();
    event.waitUntil((async () => {
        const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        for (const client of windows) {
            if ("focus" in client) {
                await client.focus();
                return;
            }
        }
        await self.clients.openWindow("./");
    })());
});
