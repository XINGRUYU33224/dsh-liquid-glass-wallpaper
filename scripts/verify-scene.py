"""
Verify the scene-preview treatment.

Scene previews are 1:1 and <=1080px; in a 16:9 viewport they must be cropped
with an upward bias and shown with gentler glass, while video keeps the user's
full settings.

Usage: python verify-scene.py <url> <shots-dir>
"""
import json
import sys

from playwright.sync_api import sync_playwright

URL = sys.argv[1]
OUT = sys.argv[2] if len(sys.argv) > 2 else "E:/Harness work/shots"
results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    print(f"  {'PASS' if cond else 'FAIL'}  {name}" + (f" — {detail}" if detail else ""))


with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=["--autoplay-policy=no-user-gesture-required"])
    page = b.new_context(viewport={"width": 1600, "height": 950}).new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto(URL, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(6000)
    page.evaluate(
        """() => { for (const t of ['继续','我知道了','确定']) {
            const el=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()===t);
            if (el) { el.click(); return; } } }"""
    )
    page.wait_for_timeout(1000)

    inv = page.evaluate("""async () => await (await fetch('/api/liquid-glass/inventory')).json()""")
    scene = next((w for w in inv["wallpapers"] if w["type"] == "scene" and w["previewUrl"]), None)
    video = next((w for w in inv["wallpapers"] if w["type"] == "video" and w["mediaUrl"]), None)
    check("library has a scene with a preview", scene is not None, scene["title"][:30] if scene else "")
    check("library has a video", video is not None)

    def select(item):
        page.evaluate(
            """(it) => localStorage.setItem('liquid-glass-wallpaper/v1', JSON.stringify({
                enabled: true, activeId: it.id, blur: 28, saturation: 118, tint: 12,
                vignette: 18, grain: true, fit: 'cover', parallax: false }))""",
            item,
        )
        page.reload(wait_until="domcontentloaded")
        page.wait_for_timeout(7000)
        return page.evaluate(
            """() => {
                const bd = document.querySelector('.lgw-backdrop');
                const img = bd.querySelector('.lgw-media');
                const cs = bd ? getComputedStyle(bd) : null;
                const ics = img ? getComputedStyle(img) : null;
                const r = img ? img.getBoundingClientRect() : null;
                return {
                    blur: cs ? cs.getPropertyValue('--lgw-blur').trim() : null,
                    sat: cs ? cs.getPropertyValue('--lgw-sat').trim() : null,
                    vignette: cs ? cs.getPropertyValue('--lgw-vignette-color').trim() : null,
                    objectFit: ics ? ics.objectFit : null,
                    objectPosition: ics ? ics.objectPosition : null,
                    natural: img && img.naturalWidth ? [img.naturalWidth, img.naturalHeight] : null,
                    hasVideo: !!bd.querySelector('video'),
                };
            }"""
        )

    print("\n== a scene (still preview) ==")
    s = select(scene)
    print("  " + json.dumps(s, ensure_ascii=False))
    check("scene renders as an image, not a video", not s["hasVideo"])
    check("scene uses cover (no letterbox bars)", s["objectFit"] == "cover", str(s["objectFit"]))
    check(
        "scene crop is biased upward",
        s["objectPosition"] and "38%" in s["objectPosition"],
        str(s["objectPosition"]),
    )
    check(
        "scene frost is reduced below the video default",
        s["blur"] and int(s["blur"].replace("px", "")) <= 12,
        f"blur={s['blur']}",
    )
    check(
        "scene saturation is not lifted as hard",
        s["sat"] and int(s["sat"].replace("%", "")) <= 104,
        f"sat={s['sat']}",
    )
    if s["natural"]:
        check("preview is square as measured", s["natural"][0] == s["natural"][1], str(s["natural"]))
    page.screenshot(path=f"{OUT}/scene-treated.png")
    print(f"  shot  {OUT}/scene-treated.png")

    print("\n== a video keeps the user's settings ==")
    v = select(video)
    print("  " + json.dumps(v, ensure_ascii=False))
    check("video still renders a <video>", v["hasVideo"])
    check("video keeps the user's frost value", v["blur"] == "28px", f"blur={v['blur']}")
    check(
        "video crop is centred",
        v["objectPosition"] in ("center center", "50% 50%"),
        str(v["objectPosition"]),
    )
    page.screenshot(path=f"{OUT}/scene-video-for-compare.png")
    print(f"  shot  {OUT}/scene-video-for-compare.png")

    print("\n== the card labels the difference ==")
    page.evaluate(
        """() => { const a=[...document.querySelectorAll('button,[role=button],a')];
             const h=a.find(e=>(e.textContent||'').trim()==='设置'); if(h) h.click(); }"""
    )
    page.wait_for_timeout(2500)
    page.evaluate(
        """() => { const hit=[...document.querySelectorAll('*')].filter(e=>
              (e.textContent||'').trim()==='液态玻璃壁纸' && e.children.length===0)[0];
            if (hit) (hit.closest('button,[role=button],li,a')||hit).click(); }"""
    )
    page.wait_for_timeout(2500)
    body = page.inner_text("body")
    check("scene tiles say 预览", "场景 · 预览" in body or "场景 · 预览图" in body)
    check("video tiles say 原生", "视频 · 原生" in body)
    check("the hint explains the trade-off", "只显示项目的预览图" in body or "预览图" in body)
    page.screenshot(path=f"{OUT}/scene-card-labels.png")
    print(f"  shot  {OUT}/scene-card-labels.png")

    check("no uncaught page errors", len(errs) == 0, "; ".join(errs[:2]))
    b.close()

passed = sum(1 for _, ok, _ in results if ok)
failed = len(results) - passed
print(f"\n{passed} passed, {failed} failed")
sys.exit(0 if failed == 0 else 1)
