// ClipLab Service Worker: macht die App installierbar und lädt die Oberfläche auch bei schlechtem Netz.
// API, Logins und Videos gehen immer direkt ans Netz und werden nie zwischengespeichert.
const CACHE = "cliplab-v19";
const SHELL = ["/", "/auto", "/studio", "/einstellungen", "/manifest.webmanifest", "/nav.js?v=8", "/tiktok-ui.js?v=1", "/bg.js?v=2", "/icons/icon.svg", "/icons/icon-192.png",
  "/fonts/poppins-500.woff", "/fonts/poppins-700.woff", "/fonts/lora-italic.woff"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim())
    .then(() => self.clients.matchAll({ type: "window" }))
    .then((list) => list.forEach((c) => c.postMessage({ type: "cliplab-updated", cache: CACHE }))));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (/^\/(api|auth|media)\//.test(url.pathname)) return;           // nie cachen
  if (e.request.mode === "navigate") {                                // Seiten: erst Netz, dann Cache
    e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open(CACHE).then((x) => x.put(e.request, c)); return r; })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("/"))));
    return;
  }
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => {   // Dateien: erst Cache
    if (r.ok) { const c = r.clone(); caches.open(CACHE).then((x) => x.put(e.request, c)); }
    return r;
  })));
});

// Push-Nachrichten (z. B. "Clip ist online") anzeigen und beim Antippen öffnen
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "ClipLab", {
    body: d.body || "", icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", data: { url: d.url || "/" },
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    const same = list.find((c) => new URL(c.url).origin === location.origin && !/^https?:/.test(url.replace(location.origin, "")));
    if (same && url.startsWith("/")) { same.navigate(url); return same.focus(); }
    return self.clients.openWindow(url);
  }));
});
