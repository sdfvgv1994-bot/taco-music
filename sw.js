// taco 歌單 App 的 service worker：有網路就拿最新的，沒網路時至少打得開畫面（歌單還在，歌要有網路才能播）。
// 只處理這個網站自己的檔案；YouTube 的播放器、縮圖、歌名都直接連線，不經過這裡，也不存。
const CACHE = "taco-playlist-v1";
const CORE = ["./", "./manifest.json", "./core.js", "./app.js", "./icon-192.png"];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(CORE.map((u) => c.add(u)))));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("taco-playlist") && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  const nav = req.mode === "navigate";
  const key = nav ? new URL("./", self.registration.scope).href : url.origin + url.pathname;
  e.respondWith(fetch(nav ? new Request(req.url, { cache: "no-cache", credentials: "same-origin" }) : req).then((res) => {
    if (res.ok && res.status === 200) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(key, copy)); }
    return res;
  }).catch(() => caches.match(key).then((hit) => hit || Promise.reject(new Error("offline")))));
});
