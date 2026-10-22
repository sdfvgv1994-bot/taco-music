/* taco 歌單：畫面、YouTube 官方嵌入播放器（IFrame Player API）、存檔、安裝到桌面。
   規則和資料處理在 core.js。 */
"use strict";
const $ = (id) => document.getElementById(id);
const KEY = "taco-playlist-v1";
// 背景時一律不碰播放器、不碰聲音裝置：Edge 實測只要在背景讀播放器秒數或監聽聲音裝置，就會把歌暫停（10/22 診斷）
// 診斷用：網址加 ?off=all 關掉記位置和自動接播
const OFF = new Set((new URLSearchParams(location.search).get("off") || "").split(",").filter(Boolean));
const on = (k) => !OFF.has("all") && !OFF.has(k);
const POS_KEY = "taco-playlist-pos";   // 正在播哪一首、第幾秒（切 App 回來、頁面重開時接著播）
const st = load();
let player = null, ready = false, playing = false, resolver = null, resolverReady = false;
let wasPlayingWhenHidden = false;   // 離開畫面時（或在背景時）正在播
let stolenPause = false, pausedAt = 0;   // 在背景被暫停、什麼時候被暫停
let bgWant = false, bgTries = 0, bgTimer = 0;   // 背景播完換到下一首，等著它播起來；重試了幾次
const bgLog = [];   // 背景時發生了什麼（除錯用，只放在記憶體，回到前景顯示在「小提醒」裡）
const STATE_NAME = { "-1": "還沒開始", 0: "播完", 1: "播放中", 2: "暫停", 3: "緩衝中", 5: "準備好了" };
function blog(msg) {
  if (!document.hidden) return;
  const d = new Date();
  bgLog.push(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")} ${msg}`);
  if (bgLog.length > 40) bgLog.shift();
}
let lastPos = null;   // 前景時最後一次讀到的位置 {id, t, d, at}：切走那一刻用它推算，不在背景問播放器
let playedId = null;       // 播放器真的播過哪一首（只準備好、還沒播的不算，免得把記下的秒數洗成 0）
const listQueue = [];   // 等著展開的 YouTube 播放清單

function load() {
  try { const d = JSON.parse(localStorage.getItem(KEY)); if (d && Array.isArray(d.songs)) return Object.assign(newState(), d, { cur: -1 }); } catch (e) { /* 沒存檔或瀏覽器不給存 */ }
  return newState();
}
function save() { try { localStorage.setItem(KEY, JSON.stringify({ songs: st.songs, shuffle: st.shuffle, repeat: st.repeat, order: st.order, autoResume: st.autoResume !== false })); } catch (e) { /* 存不了就算了 */ } }
/* 前景時讀播放器的位置（背景時不讀） */
function readPos() {
  const s = st.songs[st.cur];
  if (document.hidden || !ready || !s || playedId !== s.id || !player.getCurrentTime) return;
  const d = player.getVideoData && player.getVideoData();
  if (d && d.video_id && d.video_id !== s.id) return;   // 剛換歌、播放器還是上一首的秒數：先不記
  lastPos = { id: s.id, t: player.getCurrentTime() || 0, d: (player.getDuration && player.getDuration()) || 0, at: Date.now(), playing };
}
/* 存位置：只用前景讀到的位置；還在播的話加上經過的時間推算 */
function savePos() {
  if (!lastPos || !st.songs[st.cur] || lastPos.id !== st.songs[st.cur].id) return;
  const t = lastPos.t + (lastPos.playing ? (Date.now() - lastPos.at) / 1000 : 0);
  try { localStorage.setItem(POS_KEY, JSON.stringify({ id: lastPos.id, t: lastPos.d ? Math.min(t, lastPos.d) : t, d: lastPos.d, at: Date.now() })); } catch (e) { /* 存不了就算了 */ }
}
function noAutoResume() { wasPlayingWhenHidden = false; stolenPause = false; pausedAt = 0; bgWant = false; bgTries = 0; clearTimeout(bgTimer); bgTimer = 0; }
function clearPos() { try { localStorage.removeItem(POS_KEY); } catch (e) { /* 沒關係 */ } }
function restorePos() {
  let pos = null;
  try { pos = JSON.parse(localStorage.getItem(POS_KEY)); } catch (e) { pos = null; }
  const r = resumeTarget(st, pos, Date.now(), pos && pos.d);
  if (!r) return;
  st.cur = r.index;
  player.cueVideoById({ videoId: st.songs[r.index].id, startSeconds: r.start });
  render();
  say(`接著上次的位置（${Math.floor(r.start / 60)}:${String(r.start % 60).padStart(2, "0")}），按 ▶ 繼續`);
}
function say(text, err) { const m = $("msg"); m.textContent = text; m.className = err ? "msg err" : "msg"; }

/* ---------- 畫面 ---------- */
const REPEAT = { all: "🔁 全部循環", one: "🔂 單曲循環", off: "➡ 不循環" };
function render() {
  const ol = $("list");
  ol.textContent = "";
  st.songs.forEach((s, i) => {
    const li = document.createElement("li");
    if (i === st.cur) li.className = "cur";
    if (s.bad) li.classList.add("bad");
    const img = document.createElement("img");
    img.src = `https://i.ytimg.com/vi/${s.id}/mqdefault.jpg`; img.alt = ""; img.loading = "lazy";
    const t = document.createElement("div"); t.className = "t";
    const b = document.createElement("b"); b.textContent = s.title || "（播放後顯示歌名）";
    const sm = document.createElement("small"); sm.textContent = s.bad ? "無法播放（上傳者不開放嵌入）" : i === st.cur ? (playing ? "▶ 播放中" : "⏸ 暫停") : `第 ${i + 1} 首`;
    t.append(b, sm); t.onclick = () => playAt(i);
    const ops = document.createElement("div"); ops.className = "ops";
    for (const [label, aria, fn] of [["↑", "往上移", () => moveSong(st, i, -1)], ["↓", "往下移", () => moveSong(st, i, 1)], ["✕", "刪除", () => { if (i === st.cur) stop(); removeSong(st, i); }]]) {
      const btn = document.createElement("button"); btn.textContent = label; btn.setAttribute("aria-label", aria);
      btn.onclick = () => { fn(); save(); render(); }; ops.append(btn);
    }
    li.append(img, t, ops); ol.append(li);
  });
  $("count").textContent = st.songs.length ? `共 ${st.songs.length} 首` : "歌單是空的";
  $("clear").hidden = !st.songs.length;
  const cur = st.songs[st.cur];
  $("now").textContent = cur ? (cur.title || "載入中…") : "";
  $("empty").hidden = st.cur >= 0;
  $("emptyText").innerHTML = st.songs.length ? "點一首歌，或按 ▶ 開始播放" : "貼上 YouTube 連結加入歌單，<br>點一首歌就開始播放";
  $("play").textContent = playing ? "⏸" : "▶";
  $("shuffle").classList.toggle("on", st.shuffle);
  $("repeat").textContent = REPEAT[st.repeat];
  $("repeat").classList.toggle("on", st.repeat !== "off");
  $("auto").textContent = `↩ 自動接播：${st.autoResume !== false ? "開" : "關"}`;
  $("auto").classList.toggle("on", st.autoResume !== false);
  $("code").value = exportCode(st);
  mediaSession(cur);
}

/* ---------- 加歌 ---------- */
function addText(text) {
  const found = parseAll(text);
  if (!found.length) { say("看不懂這個連結：請貼 YouTube 影片或播放清單的網址", true); return; }
  const ids = found.filter((r) => r.video && !r.list).map((r) => r.video);
  const lists = found.filter((r) => r.list).map((r) => r.list);
  // 「影片＋清單」的連結（從播放清單裡分享出來的）：整份清單都加
  const n = addSongs(st, ids);
  save(); render();
  fetchTitles();
  if (lists.length) { listQueue.push(...lists); say(`加入 ${n} 首，正在讀取播放清單…`); resolveLists(); }
  else say(n ? `加入 ${n} 首` : "這些歌已經在歌單裡了");
}

/* 播放清單 → 一首首影片：用另一個（不播放的）YouTube 播放器載入清單，再問它裡面有哪些影片 */
function resolveLists() {
  if (!resolverReady || !listQueue.length) return;
  resolver.cuePlaylist({ listType: "playlist", list: listQueue[0] });
  clearTimeout(resolveLists.t);
  resolveLists.t = setTimeout(() => { listQueue.shift(); say("讀不到這個播放清單（可能是私人清單）", true); resolveLists(); }, 12000);
}
function onResolverState(e) {
  if (e.data !== YT.PlayerState.CUED || !listQueue.length) return;
  const ids = resolver.getPlaylist() || [];
  if (!ids.length) return;
  clearTimeout(resolveLists.t);
  listQueue.shift();
  const n = addSongs(st, ids);
  save(); render(); fetchTitles();
  say(`從播放清單加入 ${n} 首` + (ids.length > n ? `（${ids.length - n} 首本來就有）` : ""));
  resolveLists();
}

/* 歌名：問 YouTube 的 oEmbed（官方的公開資料）；問不到就等播放時從播放器拿 */
let titleBusy = false;
async function fetchTitles() {
  if (titleBusy) return;
  titleBusy = true;
  try {
    for (const s of st.songs) {
      if (s.title || s.noTitle) continue;
      try {
        const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent("https://www.youtube.com/watch?v=" + s.id)}`);
        if (r.ok) { const d = await r.json(); s.title = String(d.title || "").slice(0, 200); }
        else { s.noTitle = true; if (r.status === 401 || r.status === 403) s.bad = true; }
      } catch (e) { s.noTitle = true; }
      save(); render();
    }
  } finally { titleBusy = false; }
}

/* ---------- 播放 ---------- */
function playAt(i) {
  if (i < 0 || i >= st.songs.length) { stop(); return; }
  st.cur = i;
  if (ready) player.loadVideoById(st.songs[i].id);
  render();
}
function stop() { if (ready) player.stopVideo(); playing = false; noAutoResume(); render(); }
function step(d, auto) { playAt(nextIndex(st, d, auto)); }
function onState(e) {
  const S = YT.PlayerState;
  blog(`播放器：${STATE_NAME[e.data] ?? e.data}`);
  // 背景播完換到下一首，瀏覽器卻沒讓新歌播起來：等一下再按一次播放（最多 3 次）
  if (bgWant && document.hidden && (e.data === S.PAUSED || e.data === S.CUED || e.data === S.UNSTARTED) && !bgTimer && bgTries < 3) {
    const n = ++bgTries;
    bgTimer = setTimeout(() => { bgTimer = 0; if (bgWant && !playing && document.hidden) { blog(`重試播放 #${n}`); player.playVideo(); } }, 1500 * n);
  }
  if (e.data === S.PLAYING) {
    playing = true;
    if (bgWant) { blog("新歌播起來了"); bgWant = false; bgTries = 0; clearTimeout(bgTimer); bgTimer = 0; }
    if (st.songs[st.cur]) playedId = st.songs[st.cur].id;
    if (document.hidden) {   // 在背景換到新歌或重播：不問播放器，從 0 秒開始推算，頁面被收掉重開也接得回來
      wasPlayingWhenHidden = true; stolenPause = false;
      if (st.songs[st.cur] && (!lastPos || lastPos.id !== st.songs[st.cur].id || lastPos.ended)) { lastPos = { id: st.songs[st.cur].id, t: 0, d: 0, at: Date.now(), playing: true }; savePos(); }
    } else readPos();
    if (/按 ▶ 繼續播放/.test($("msg").textContent)) say("");   // 在背景（又）播起來了：之後被搶走聲音也要能接回來
    const s = st.songs[st.cur], d = player.getVideoData && player.getVideoData();
    if (s && d && d.title && s.title !== d.title) { s.title = d.title; save(); }
    if (s && s.bad) { delete s.bad; save(); }
  } else if (e.data === S.PAUSED || e.data === S.CUED) {
    // 在背景被暫停：多半是別的 App 搶走聲音（切去 YouTube 找影片、點開來播，常常超過好幾秒）。不想要的話關掉「自動接著播」
    if (e.data === S.PAUSED && document.hidden && wasPlayingWhenHidden) { stolenPause = true; pausedAt = Date.now(); }
    playing = false;   // 先標成沒在播，readPos 記下的位置才不會在暫停後一直往後加
    readPos();
  }
  else if (e.data === S.ENDED) {
    playing = false; noAutoResume(); clearPos(); if (lastPos) lastPos.ended = true;
    if (document.hidden) { bgWant = true; bgTries = 0; clearTimeout(bgTimer); bgTimer = 0; blog("播完，換下一首"); }   // stop()（不循環播到最後）會把 bgWant 清掉
    step(1, true); return;
  }
  render();
}
function onError() {   // 100 影片被刪除、101／150 上傳者不開放嵌入：標記起來，自動跳下一首
  const s = st.songs[st.cur];
  if (s) { s.bad = true; save(); }
  if (document.hidden) { bgWant = true; bgTries = 0; clearTimeout(bgTimer); bgTimer = 0; blog("這首無法播放，換下一首"); }
  playing = false; render();
  setTimeout(() => step(1, true), 800);
}

window.onYouTubeIframeAPIReady = function () {
  const vars = { playsinline: 1, rel: 0, origin: location.origin };
  player = new YT.Player("yt", { width: "100%", height: "100%", playerVars: vars,
    events: { onReady: () => { ready = true; if (st.cur < 0) restorePos(); }, onStateChange: onState, onError } });
  resolver = new YT.Player("resolverYt", { width: 200, height: 200, playerVars: { origin: location.origin },
    events: { onReady: () => { resolverReady = true; resolveLists(); }, onStateChange: onResolverState } });
};
(function loadApi() {
  const s = document.createElement("script");
  s.src = "https://www.youtube.com/iframe_api";
  s.onerror = () => say("連不上 YouTube：請確認網路後重開", true);
  document.head.append(s);
})();

/* 鎖定畫面、耳機按鍵的上一首／下一首（瀏覽器支援才有） */
function mediaSession(cur) {
  if (!("mediaSession" in navigator)) return;
  try {
    navigator.mediaSession.metadata = cur ? new MediaMetadata({ title: cur.title || "taco 歌單", artist: "taco 歌單",
      artwork: [{ src: `https://i.ytimg.com/vi/${cur.id}/hqdefault.jpg`, sizes: "480x360", type: "image/jpeg" }] }) : null;
    if (!mediaSession.set) {
      mediaSession.set = true;
      navigator.mediaSession.setActionHandler("play", () => ready && player.playVideo());
      navigator.mediaSession.setActionHandler("pause", () => { noAutoResume(); if (ready) player.pauseVideo(); });
      navigator.mediaSession.setActionHandler("previoustrack", () => step(-1));
      navigator.mediaSession.setActionHandler("nexttrack", () => step(1));
    }
  } catch (e) { /* 不支援就算了 */ }
}

/* ---------- 按鈕 ---------- */
$("addBtn").onclick = () => { addText($("link").value); $("link").value = ""; };
$("link").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("addBtn").click(); } });
$("link").addEventListener("paste", () => setTimeout(() => { if (parseAll($("link").value).length) $("addBtn").click(); }, 0));
$("paste").onclick = async () => {
  try { const t = await navigator.clipboard.readText(); if (t) addText(t); else say("剪貼簿是空的", true); }
  catch (e) { say("瀏覽器不讓讀剪貼簿：請長按上面的輸入框貼上", true); }
};
$("play").onclick = () => {
  if (!ready) { say("播放器還在載入，等一下再按", true); return; }
  if (st.cur < 0) { if (st.songs.length) playAt(nextIndex(st, 1)); return; }
  if (playing) { noAutoResume(); player.pauseVideo(); } else player.playVideo();
};
$("prev").onclick = () => step(-1);
$("next").onclick = () => step(1);
$("shuffle").onclick = () => { st.shuffle = !st.shuffle; st.order = st.shuffle ? shuffled(st.songs.length, st.cur) : []; save(); render(); };
$("auto").onclick = () => { st.autoResume = st.autoResume === false; save(); render(); say(st.autoResume ? "切到別的 App 被暫停，回來會自動接著播" : "切回來不會自動接著播"); };
$("repeat").onclick = () => { st.repeat = { all: "one", one: "off", off: "all" }[st.repeat]; save(); render(); };
$("clear").onclick = () => { if (!confirm("確定清空整個歌單？")) return; stop(); st.songs = []; st.cur = -1; st.order = []; save(); render(); };
$("copy").onclick = async () => {
  try { await navigator.clipboard.writeText($("code").value); $("copy").textContent = "已複製 ✓"; }
  catch (e) { $("code").select(); $("copy").textContent = "請按住上面的文字複製"; }
  setTimeout(() => { $("copy").textContent = "複製備份碼"; }, 2000);
};
$("importBtn").onclick = () => {
  const songs = importCode($("importText").value);
  if (!songs.length) { say("看不懂要匯入的內容", true); return; }
  const before = st.songs.length;
  addSongs(st, songs.map((s) => s.id));
  for (const s of songs) { const t = st.songs.find((x) => x.id === s.id); if (t && !t.title && s.title) t.title = s.title; }
  $("importText").value = "";
  save(); render(); fetchTitles();
  say(`匯入 ${st.songs.length - before} 首`);
};

/* 螢幕保持亮著（Wake Lock）：手機關螢幕時瀏覽器會停播，開著這個比較不會斷 */
let wake = null;
async function setWake(on) {
  try { if (on) { wake = await navigator.wakeLock.request("screen"); wake.addEventListener("release", () => { if (!document.hidden) wake = null; showWake(); }); } else if (wake) { await wake.release(); wake = null; } }
  catch (e) { say("這個瀏覽器不支援保持螢幕亮著", true); wake = null; }
  showWake();
}
function showWake() { $("wake").textContent = `💡 螢幕保持亮著：${wake ? "開" : "關"}`; $("wake").classList.toggle("on", !!wake); }
$("wake").onclick = () => setWake(!wake);
function showBgLog() {
  const el = $("bglog");
  if (!el) return;
  el.textContent = bgLog.length ? "上次在背景發生的事（除錯用）：\n" + bgLog.join("\n") : "";
  el.hidden = !bgLog.length;
}
if (on("vis")) document.addEventListener("visibilitychange", () => {
  // 切走：只記旗標、存前景讀到的位置；不呼叫播放器
  if (document.hidden) { wasPlayingWhenHidden = playing; stolenPause = false; pausedAt = 0; bgLog.length = 0; blog(playing ? "切到背景（播放中）" : "切到背景（沒在播）"); savePos(); return; }
  if (wake && wake.released) setWake(true);
  showBgLog();
  // 背景換到下一首但沒播起來：回來時直接幫你播（自動接播關掉就不動）
  if (bgWant && !playing && st.autoResume !== false && ready && st.cur >= 0) {
    setTimeout(() => { if (!playing && !document.hidden) { player.playVideo(); say("背景換歌時瀏覽器沒讓它播，已幫你接著播"); } }, 400);
    noAutoResume(); return;
  }
  readPos();   // 回到前景：校正一次位置
  // 切到 YouTube 等 App 時聲音被搶走、播放器被暫停：回來後自動接著播（離開前就暫停、或在背景自己按暫停的不動它）
  if (shouldAutoResume({ stolen: stolenPause, autoResume: st.autoResume, pausedAt }) && ready && st.cur >= 0) setTimeout(() => {
    if (playing || document.hidden) return;
    player.playVideo();
    say("已自動接著播（不想要可以關掉「↩ 自動接播」）");
    setTimeout(() => {   // 瀏覽器不讓自動播的話，提示一下（還在緩衝就不算）
      if (playing || document.hidden) return;   // 又切走了：不在背景問播放器
      const s = player.getPlayerState && player.getPlayerState();
      if (s !== YT.PlayerState.BUFFERING) say("按 ▶ 繼續播放");
    }, 2500);
  }, 400);
  noAutoResume();
});
// 前景播放時每 3 秒讀一次位置、存起來（背景時 readPos 什麼都不做）
if (on("int")) setInterval(() => { if (playing && !document.hidden) { readPos(); savePos(); } }, 3000);

/* ---------- 安裝到桌面（PWA） ---------- */
let installEvt = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvt = e; $("install").hidden = false; });
$("install").onclick = async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; $("install").hidden = true; };
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});

(function version() {
  const v = document.querySelector('meta[name="app-version"]').content, b = document.querySelector('meta[name="app-built"]').content;
  $("ver").textContent = `版本 ${v}${b ? "（" + b + "）" : ""}` + (OFF.size ? `・診斷模式：關掉 ${[...OFF].join("、")}` : "");
})();

render();
fetchTitles();
