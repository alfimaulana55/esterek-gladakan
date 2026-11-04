/* =====================================================================
 * E-Sterek Gladakan - Service Worker (PWA)
 * - App shell (index.html, manifest, ikon) disimpan agar aplikasi bisa dibuka offline.
 * - Permintaan POST ke Apps Script TIDAK pernah di-cache. Data tetap dari server / IndexedDB.
 * - Setiap kali mengganti ikon atau file statis, naikkan SHELL_VERSION (mis. "v2")
 *   agar cache lama dibuang dan perubahan langsung terlihat.
 * ===================================================================== */

const SHELL_VERSION = "v1";
const SHELL_CACHE = "esterek-shell-" + SHELL_VERSION;
const CDN_CACHE = "esterek-cdn-" + SHELL_VERSION;
const PHOTO_CACHE = "esterek-photo-" + SHELL_VERSION;
const PHOTO_CACHE_MAX = 300;   // batas jumlah foto yang disimpan untuk offline

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png"
];
const CDN_HOSTS = ["cdn.tailwindcss.com", "cdnjs.cloudflare.com"];
const PHOTO_HOSTS = ["lh3.googleusercontent.com"];
const KEEP_CACHES = [SHELL_CACHE, CDN_CACHE, PHOTO_CACHE];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(function (cache) {
        // Satu file gagal (mis. ikon belum ada) tidak membatalkan proses install
        return Promise.allSettled(APP_SHELL.map(function (url) { return cache.add(url); }));
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (names) {
        return Promise.all(
          names.filter(function (n) { return KEEP_CACHES.indexOf(n) === -1; })
               .map(function (n) { return caches.delete(n); })
        );
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  const req = event.request;

  // Hanya GET yang ditangani. POST ke Apps Script lewat jaringan biasa (tidak di-cache).
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (req.mode === "navigate") {
      event.respondWith(networkFirstPage(req));      // buka halaman: utamakan versi terbaru
    } else {
      event.respondWith(staleWhileRevalidate(req, SHELL_CACHE));
    }
  } else if (CDN_HOSTS.indexOf(url.hostname) !== -1) {
    event.respondWith(staleWhileRevalidate(req, CDN_CACHE));   // Tailwind & Font Awesome
  } else if (PHOTO_HOSTS.indexOf(url.hostname) !== -1) {
    event.respondWith(cacheFirstPhoto(req));                   // foto WBP
  }
  // host lain (script.google.com, dll.) tidak disentuh
});

// Halaman utama: coba jaringan dulu; jika offline pakai salinan yang tersimpan
async function networkFirstPage(req) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put("./index.html", res.clone()).catch(function () {});
    return res;
  } catch (err) {
    const cached = await cache.match("./index.html", { ignoreSearch: true });
    return cached || Response.error();
  }
}

// Aset statis: tampilkan dari cache lalu perbarui di latar belakang
async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const network = fetch(req)
    .then(function (res) {
      if (res.ok || res.type === "opaque") cache.put(req, res.clone()).catch(function () {});
      return res;
    })
    .catch(function () { return null; });
  if (cached) return cached;
  return (await network) || Response.error();
}

// Foto: simpan versi CORS (bukan "opaque") agar bisa dibaca offline, batasi jumlahnya
async function cacheFirstPhoto(req) {
  const cache = await caches.open(PHOTO_CACHE);
  const cached = await cache.match(req.url);
  if (cached) return cached;
  try {
    const res = await fetch(req.url, { mode: "cors", credentials: "omit" });
    if (res.ok) {
      cache.put(req.url, res.clone())
        .then(function () { return trimCache(cache, PHOTO_CACHE_MAX); })
        .catch(function () {});
    }
    return res;
  } catch (err) {
    return fetch(req);   // gagal CORS: tampilkan saja, tidak disimpan
  }
}

async function trimCache(cache, max) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) {
    await cache.delete(keys[i]);
  }
}
