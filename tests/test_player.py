"""taco 歌單的檢查：App 檔案齊全、core.js 的規則（用 node 跑）。"""
import json
import re
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def test_app_files():
    """可以裝到手機桌面：manifest、圖示、service worker；部署流程會填版本號。"""
    m = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    assert m["scope"] == "./" and m["start_url"] == "./" and m["display"] == "standalone"
    for i in m["icons"]:
        assert (ROOT / i["src"]).is_file(), i["src"]
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    assert re.findall(r'<script src="([^"]+)"', html) == ["core.js", "app.js"]
    assert '<meta name="app-version" content="dev">' in html
    assert re.search(r"\[hidden\][^{]*\{\s*display\s*:\s*none\s*!important", html)
    assert (ROOT / "sw.js").is_file()
    assert "site/index.html" in (ROOT / ".github" / "workflows" / "pages.yml").read_text(encoding="utf-8")


def test_core():
    """解析 YouTube 連結、歌單順序、備份碼（用 node 跑 core.js）。"""
    if not shutil.which("node"):
        return
    js = """
    const c=require(process.argv[1]);const out={};
    const P=(t)=>c.parseYouTube(t);
    out.parse=[P("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30"),P("https://youtu.be/dQw4w9WgXcQ?si=abc"),P("m.youtube.com/shorts/dQw4w9WgXcQ"),
      P("https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG"),P("https://www.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG"),
      P("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ"),P("https://evil.com/watch?v=dQw4w9WgXcQ"),P("https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ"),P("hello"),P("dQw4w9WgXcQ")];
    out.all=c.parseAll("聽這首 https://youtu.be/dQw4w9WgXcQ，還有\\nhttps://www.youtube.com/watch?v=9bZkp7q19f0)\\nprogramming\\nkJQP7kiw5Fk").map(r=>r.video);
    const st=c.newState();out.added=[c.addSongs(st,["aaaaaaaaaaa","bbbbbbbbbbb","ccccccccccc","aaaaaaaaaaa","bad"])];
    st.cur=0;out.next=[c.nextIndex(st,1),c.nextIndex(st,-1)];st.cur=2;out.wrap=c.nextIndex(st,1,true);
    st.repeat="off";out.off=c.nextIndex(st,1,true);out.offManual=c.nextIndex(st,1,false);
    st.repeat="one";out.one=c.nextIndex(st,1,true);out.oneManual=c.nextIndex(st,1,false);
    st.repeat="all";st.cur=0;st.songs[1].bad=true;out.skipBad=c.nextIndex(st,1,true);delete st.songs[1].bad;
    let seed=7;const rand=()=>((seed=seed*16807%2147483647)/2147483647);
    st.shuffle=true;st.cur=1;st.order=c.shuffled(3,1,rand);const seen=new Set([1]);let i=1;
    for(let k=0;k<2;k++){st.cur=c.nextIndex(st,1,true);seen.add(st.cur)}out.shuffleAll=seen.size;out.shuffleFirst=st.order[0];
    c.moveSong(st,0,1);out.moved=st.songs.map(s=>s.id[0]).join("");c.removeSong(st,0);out.removed=st.songs.map(s=>s.id[0]).join("");
    st.songs[0].title="歌名";out.back=c.importCode(c.exportCode(st));out.importLinks=c.importCode("https://youtu.be/dQw4w9WgXcQ").map(s=>s.id);
    out.importJunk=c.importCode('{"app":"taco-playlist","songs":[["<script>",1],["dQw4w9WgXcQ"]]}').map(s=>s.id);
    console.log(JSON.stringify(out));"""
    out = json.loads(subprocess.run(["node", "-e", js, str(ROOT / "core.js")], capture_output=True, text=True, check=True).stdout)
    v = {"video": "dQw4w9WgXcQ"}
    assert out["parse"] == [v, v, v, {"video": "dQw4w9WgXcQ", "list": "PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG"},
                            {"list": "PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG"}, v, None, None, None, v]
    assert out["all"] == ["dQw4w9WgXcQ", "9bZkp7q19f0", "kJQP7kiw5Fk"]
    assert out["added"] == [3]
    assert out["next"] == [1, 2] and out["wrap"] == 0
    assert out["off"] == -1 and out["offManual"] == 0
    assert out["one"] == 2 and out["oneManual"] == 0
    assert out["skipBad"] == 2
    assert out["shuffleAll"] == 3 and out["shuffleFirst"] == 1
    assert out["moved"] == "bac" and out["removed"] == "ac"
    assert out["back"] == [{"id": "aaaaaaaaaaa", "title": "歌名"}, {"id": "ccccccccccc", "title": ""}]
    assert out["importLinks"] == ["dQw4w9WgXcQ"] and out["importJunk"] == ["dQw4w9WgXcQ"]


def test_resume_target():
    """切到別的 App、頁面被收掉重開：接著上次那一首、那一秒播。"""
    if not shutil.which("node"):
        return
    js = """
    const c=require(process.argv[1]);const st=c.newState();c.addSongs(st,["aaaaaaaaaaa","bbbbbbbbbbb"]);
    const now=1e12,R=(p,d)=>c.resumeTarget(st,p,now,d);
    const out=[R({id:"bbbbbbbbbbb",t:83.6,at:now-1000}),R({id:"aaaaaaaaaaa",t:1,at:now}),R({id:"ccccccccccc",t:5,at:now}),
      R({id:"aaaaaaaaaaa",t:30,at:now-13*3600e3}),R({id:"aaaaaaaaaaa",t:198,at:now},200),R(null),R({id:"aaaaaaaaaaa",t:-1,at:now}),R({id:"aaaaaaaaaaa",t:"x",at:now})];
    st.songs[1].bad=true;out.push(R({id:"bbbbbbbbbbb",t:10,at:now}));
    console.log(JSON.stringify(out));"""
    out = json.loads(subprocess.run(["node", "-e", js, str(ROOT / "core.js")], capture_output=True, text=True, check=True).stdout)
    assert out == [{"index": 1, "start": 81}, {"index": 0, "start": 0}, None, None, None, None, None, None, None]


def test_should_auto_resume():
    """切回歌單要不要自動接著播：被搶聲音才接；開關關掉、超過 30 分鐘都不接。"""
    if not shutil.which("node"):
        return
    js = """
    const c=require(process.argv[1]);const now=1e12,S=(o)=>c.shouldAutoResume(o,now);
    console.log(JSON.stringify([S({stolen:true,pausedAt:now-20e3}),S({stolen:true,pausedAt:now-20e3,autoResume:true}),
      S({stolen:false,pausedAt:now-1}),S({stolen:true,pausedAt:now-1,autoResume:false}),S({stolen:true,pausedAt:now-31*60e3}),
      S({stolen:true,pausedAt:0}),S(null)]));"""
    out = json.loads(subprocess.run(["node", "-e", js, str(ROOT / "core.js")], capture_output=True, text=True, check=True).stdout)
    assert out == [True, True, False, False, False, False, False]


def test_auto_resume_setting_saved():
    """「自動接播」開關會存進歌單設定；舊存檔沒有這欄時當成開。"""
    app = (ROOT / "app.js").read_text(encoding="utf-8")
    assert "autoResume: st.autoResume !== false" in app
    assert 'id="auto"' in (ROOT / "index.html").read_text(encoding="utf-8")


def test_offline_home_not_overwritten():
    """離線快取：直接開 manifest.json 不會把首頁蓋掉；升級後第一次離線也打得開；只清自己的舊存放區。"""
    sw = (ROOT / "sw.js").read_text(encoding="utf-8")
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    # 只有打開首頁才存到首頁的位置（直接開 manifest.json 不會把首頁蓋掉）
    assert "const home = nav &&" in sw and 'includes("text/html")' in sw
    # 換新存放區；只清自己舊版的（同網域其他 App 的不能刪），而且要新版存齊了才清
    assert 'const PREFIX = "taco-playlist"' in sw and 'const CACHE = PREFIX + "-v2"' in sw
    assert "k.startsWith(PREFIX) && k !== CACHE" in sw and "hits.every(Boolean)" in sw
    # 沒網路時先找自己這一版的存放區
    assert "caches.open(CACHE).then((c) => c.match(key))" in sw
    # 網頁用到的每個程式檔、樣式檔都要預先存好，升級後第一次離線才打得開
    core = re.search(r"const CORE = \[(.*?)\];", sw, re.S).group(1)
    for f in re.findall(r'<script src="([^"]+)"', html) + re.findall(r'<link rel="stylesheet" href="([^"]+)"', html):
        if not f.startswith("http"):
            assert '"./' + f + '"' in core, f
