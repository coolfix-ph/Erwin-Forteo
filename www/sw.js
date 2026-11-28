// CoolFix service worker.
// - Hindi ginagalaw ang request sa ibang domain (Supabase, PayMongo, Google Maps, map tiles): diretso sa internet.
// - Pahina (index.html): laging kinukuha muna sa internet para laging bago ang app; cache lang kapag offline.
// - app.js/config.js na may ?v=: naka-cache ayon sa version, kaya bagong file agad kapag pinalitan ang ?v=.
// - Iba pang file (vendor, img): ipinapakita ang naka-cache, tapos ina-update sa likod.
const CACHE = "coolfix-v1";
const SHELL = ["./", "manifest.webmanifest", "img/logo.png", "img/favicon.png", "img/icons/icon-192.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => { }));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.endsWith("/sw.js")) return;

  if (req.mode === "navigate") {
    e.respondWith((async () => {
      try {
        const res = await fetch(req, { cache: "no-store" });
        if (res.ok && url.pathname.match(/\/(index\.html)?$/)) (await caches.open(CACHE)).put("./", res.clone());
        return res;
      } catch (err) {
        return (await caches.match(req, { ignoreSearch: true })) || (await caches.match("./")) ||
          new Response("<meta charset=utf-8><p style='font:16px system-ui;padding:24px'>Walang internet. Subukan ulit kapag may koneksyon na.</p>", { headers: { "content-type": "text/html; charset=utf-8" } });
      }
    })());
    return;
  }

  if (url.searchParams.has("v")) {
    e.respondWith(caches.open(CACHE).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) {
        // burahin ang lumang version ng parehong file
        for (const k of await c.keys()) { const u = new URL(k.url); if (u.pathname === url.pathname && u.search !== url.search) c.delete(k) }
        c.put(req, res.clone());
      }
      return res;
    }));
    return;
  }

  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(req);
    const net = fetch(req).then(res => { if (res.ok && res.type === "basic") c.put(req, res.clone()); return res }).catch(() => hit);
    if (hit) { e.waitUntil(net); return hit }
    return net;
  }));
});
