/* taco 歌單：不碰畫面的部分（解析 YouTube 連結、歌單順序、備份碼），網頁和測試共用。
   歌曲一律用 YouTube 官方嵌入播放器播放，不下載任何影音。 */
"use strict";
const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const YT_LIST = /^[A-Za-z0-9_-]{10,64}$/;
const YT_HOSTS = ["youtube.com", "youtube-nocookie.com", "youtu.be"];

/* 一個連結 → {video?, list?}；看不懂就回 null。可以接受影片、Shorts、播放清單、分享連結或 11 碼影片代號 */
function parseYouTube(text) {
  text = String(text || "").trim();
  if (!text) return null;
  if (YT_ID.test(text)) return { video: text };
  let u;
  try { u = new URL(/^https?:\/\//i.test(text) ? text : "https://" + text); } catch (e) { return null; }
  const host = u.hostname.toLowerCase().replace(/^(www\.|m\.|music\.)/, "");
  if (!YT_HOSTS.includes(host)) return null;
  let video = null;
  const list = u.searchParams.get("list");
  if (host === "youtu.be") video = u.pathname.slice(1).split("/")[0];
  else if (u.pathname === "/watch") video = u.searchParams.get("v");
  else { const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/); if (m) video = m[1]; }
  const r = {};
  if (video && YT_ID.test(video)) r.video = video;
  if (list && YT_LIST.test(list) && !/^(RD|UL|LL|WL)/.test(list)) r.list = list;   // 自動合輯、稍後觀看這類清單沒辦法載入
  return r.video || r.list ? r : null;
}

/* 一段文字裡可能貼了好幾個連結（或混著別的字）：全部找出來 */
function parseAll(text) {
  const out = [];
  text = String(text || "");
  const tokens = text.match(/(?:https?:\/\/)?(?:[a-z0-9-]+\.)*(?:youtube(?:-nocookie)?\.com|youtu\.be)\/[\w\-./?=&%#:+~]+/gi) || [];
  for (const raw of text.split(/\r?\n/)) {   // 單獨一行的 11 碼影片代號（全小寫英文字的不算，免得把一般單字當成影片）
    const line = raw.trim();
    if (YT_ID.test(line) && !/^[a-z]+$/.test(line)) tokens.push(line);
  }
  for (const t of tokens) { const r = parseYouTube(t.replace(/[.,:]+$/, "")); if (r) out.push(r); }
  return out;
}

/* ---------- 歌單 ---------- */
function newState() { return { songs: [], cur: -1, shuffle: false, repeat: "all", order: [] }; }

function shuffled(n, first, rand = Math.random) {
  const a = [...Array(n).keys()].filter((i) => i !== first);
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return first >= 0 && first < n ? [first, ...a] : a;
}
function reshuffle(st, rand) { st.order = st.shuffle ? shuffled(st.songs.length, st.cur, rand) : []; }

/* 加歌：已經在歌單裡的不重複加；回傳實際加了幾首 */
function addSongs(st, ids, rand) {
  const have = new Set(st.songs.map((s) => s.id));
  let n = 0;
  for (const id of ids) if (YT_ID.test(id) && !have.has(id)) { have.add(id); st.songs.push({ id, title: "" }); n++; }
  if (n) reshuffle(st, rand);
  return n;
}
function removeSong(st, i, rand) {
  if (i < 0 || i >= st.songs.length) return;
  st.songs.splice(i, 1);
  if (st.cur === i) st.cur = -1; else if (st.cur > i) st.cur--;
  reshuffle(st, rand);
}
function moveSong(st, i, d) {
  const j = i + d;
  if (i < 0 || j < 0 || i >= st.songs.length || j >= st.songs.length) return false;
  [st.songs[i], st.songs[j]] = [st.songs[j], st.songs[i]];
  if (st.cur === i) st.cur = j; else if (st.cur === j) st.cur = i;
  st.order = st.order.map((k) => (k === i ? j : k === j ? i : k));
  return true;
}

/* 下一首是哪一首：step = 1 下一首、-1 上一首；auto = 播完自動換歌（單曲循環、不循環時才有差）。
   播不了的歌（bad）自動換歌時跳過；回傳 -1 代表停下來 */
function nextIndex(st, step = 1, auto = false) {
  const n = st.songs.length;
  if (!n) return -1;
  if (auto && st.repeat === "one" && st.cur >= 0 && !st.songs[st.cur].bad) return st.cur;
  const seq = st.shuffle && st.order.length === n ? st.order : [...Array(n).keys()];
  let p = seq.indexOf(st.cur);
  for (let tries = 0; tries < n; tries++) {
    p += step;
    if (p >= n) { if (auto && st.repeat === "off") return -1; p = 0; }
    if (p < 0) p = n - 1;
    if (!auto || !st.songs[seq[p]].bad) return seq[p];
  }
  return -1;
}

/* ---------- 備份碼：把歌單搬到另一支手機 ---------- */
function exportCode(st) { return JSON.stringify({ app: "taco-playlist", v: 1, songs: st.songs.map((s) => [s.id, s.title || ""]) }); }
/* 備份碼或一般連結都可以；回傳 [{id,title}] */
function importCode(text) {
  try {
    const d = JSON.parse(text);
    if (d && d.app === "taco-playlist" && Array.isArray(d.songs))
      return d.songs.filter((s) => Array.isArray(s) && YT_ID.test(s[0])).map((s) => ({ id: s[0], title: String(s[1] || "").slice(0, 200) }));
  } catch (e) { /* 不是備份碼：當成連結 */ }
  return parseAll(text).filter((r) => r.video).map((r) => ({ id: r.video, title: "" }));
}

if (typeof module !== "undefined") module.exports = { parseYouTube, parseAll, newState, addSongs, removeSong, moveSong, nextIndex, exportCode, importCode, shuffled };
