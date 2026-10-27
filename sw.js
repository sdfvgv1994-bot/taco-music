// taco 歌單 App 的 service worker：有網路就拿最新的，沒網路時至少打得開畫面（歌單還在，歌要有網路才能播）。
// 只處理這個網站自己的檔案；YouTube 的播放器、縮圖、歌名都直接連線，不經過這裡，也不存。
const CACHE = "taco-playlist-v2";   // v2：換新的存放區，把舊版可能存錯的首頁清掉
const CORE = ["./", "./manifest.json", "./core.js", "./app.js", "./icon-192.png"];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(CORE.map((u) => c.add(u)))));
});

self.addEventListener("activate", (e) => {
  const homeKey = new URL("./", self.registration.scope).href;
  // 新的存放區已經存到首頁，才清掉舊的；更新那一刻剛好斷網、首頁沒存到的話，先留著舊的，下次再清
  e.waitUntil(caches.open(CACHE).then((c) => c.match(homeKey)).then((hasHome) => hasHome &&
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("taco-playlist") && k !== CACHE).map((k) => caches.delete(k))))
  ).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  const nav = req.mode === "navigate";
  // 只有「打開首頁」才存到首頁的位置；直接開 manifest.json、圖示這類網址時，各自存在自己的位置，
  // 不然會把首頁蓋掉，沒網路打開 App 就變成一堆設定檔文字
  const root = new URL("./", self.registration.scope);   // App 的根目錄，例如 /taco-music/
  const home = nav && (url.pathname === root.pathname || url.pathname === root.pathname + "index.html");
  const key = home ? root.href : url.origin + url.pathname;
  e.respondWith(fetch(nav ? new Request(req.url, { cache: "no-cache", credentials: "same-origin" }) : req).then((res) => {
    const html = (res.headers.get("content-type") || "").includes("text/html");
    if (res.ok && res.status === 200 && (!home || html)) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(key, copy)); }
    return res;
  }).catch(() => caches.match(key).then((hit) => hit || Promise.reject(new Error("offline")))));
});
