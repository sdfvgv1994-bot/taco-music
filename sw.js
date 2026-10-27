// taco 歌單 App 的 service worker：有網路就拿最新的，沒網路時至少打得開畫面（歌單還在，歌要有網路才能播）。
// 只處理這個網站自己的檔案；YouTube 的播放器、縮圖、歌名都直接連線，不經過這裡，也不存。
const PREFIX = "taco-playlist";
const CACHE = PREFIX + "-v2";   // v2：換新的存放區，把舊版可能存錯的首頁清掉
const CORE = ["./", "./manifest.json", "./core.js", "./app.js", "./icon-192.png"];
const abs = (u) => new URL(u, self.registration.scope).href;

// 新版的存放區把 CORE 全部存齊了，才清掉自己舊版的存放區（taco-playlist 開頭的）。
// 存不齊（例如更新那一刻剛好斷網）就先留著舊的，之後首頁存成功時會再檢查一次。
function cleanOldWhenReady() {
  return caches.open(CACHE)
    .then((c) => Promise.all(CORE.map((u) => c.match(abs(u)))))
    .then((hits) => hits.every(Boolean) && caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k)))));
}

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(CORE.map((u) => c.add(u)))));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(cleanOldWhenReady().catch(() => {}).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  const nav = req.mode === "navigate";
  // 存的時候不看 ?v= 版本號，每個檔案只留最新的一份。
  // 只有「打開首頁」才存到首頁的位置；直接開 manifest.json、圖示這類網址時，各自存在自己的位置，
  // 不然會把首頁蓋掉，沒網路打開 App 就變成一堆設定檔文字
  const root = new URL("./", self.registration.scope);   // App 的根目錄，例如 /taco-music/
  const home = nav && (url.pathname === root.pathname || url.pathname === root.pathname + "index.html");
  const key = home ? root.href : url.origin + url.pathname;
  e.respondWith(fetch(nav ? new Request(req.url, { cache: "no-cache", credentials: "same-origin" }) : req).then((res) => {
    const html = (res.headers.get("content-type") || "").includes("text/html");
    if (res.ok && res.status === 200 && (!home || html)) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(key, copy)).then(() => home && cleanOldWhenReady()).catch(() => {});
    }
    return res;
  // 沒網路：先找自己這一版的存放區，找不到才看舊版的
  }).catch(() => caches.open(CACHE).then((c) => c.match(key)).then((hit) => hit || caches.match(key))
    .then((hit) => hit || Promise.reject(new Error("offline")))));
});
