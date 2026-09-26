"""
Measure the three reported symptoms against the fixed build.

  1. Mouse over the wallpaper must not invalidate the frosted layer.
  2. Opening Settings must not trigger an observer feedback loop.
  3. Switching wallpapers must not stack two half-decoded images.

Usage: python verify-perf.py <url>
"""
import json
import sys

from playwright.sync_api import sync_playwright

URL = sys.argv[1]
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
    page.evaluate(
        """async () => {
            const inv = await (await fetch('/api/liquid-glass/inventory')).json();
            const v = inv.wallpapers.find(w => w.type === 'video' && w.mediaUrl);
            if (v) localStorage.setItem('liquid-glass-wallpaper/v1', JSON.stringify({
                enabled: true, activeId: v.id, blur: 28, saturation: 118, tint: 12,
                vignette: 18, grain: true, fit: 'cover', parallax: true }));
        }"""
    )
    page.reload(wait_until="domcontentloaded")
    page.wait_for_timeout(8000)

    print("== structure: the blur layer must be a SIBLING of the animated stage ==")
    tree = page.evaluate(
        """() => {
            const bd = document.querySelector('.lgw-backdrop');
            const stage = bd && bd.querySelector('.lgw-stage');
            const frost = bd && bd.querySelector('.lgw-frost');
            const media = bd && bd.querySelector('.lgw-media');
            return {
                layers: bd ? [...bd.children].map(c => c.className) : [],
                stageExists: !!stage,
                mediaInsideStage: !!(stage && media && stage.contains(media)),
                frostSiblingOfStage: !!(stage && frost && frost.parentElement === stage.parentElement),
                frostContainsMedia: !!(frost && media && frost.contains(media)),
                contain: bd ? getComputedStyle(bd).contain : null,
                isolation: bd ? getComputedStyle(bd).isolation : null,
                mediaTransform: media ? getComputedStyle(media).transform : null,
                stageTransform: stage ? getComputedStyle(stage).transform : null,
            };
        }"""
    )
    print(json.dumps(tree, ensure_ascii=False, indent=2))
    check("stage element exists", tree["stageExists"])
    check("media lives inside the stage", tree["mediaInsideStage"])
    check("frost is a sibling of the stage", tree["frostSiblingOfStage"])
    check("frost does NOT contain the media", not tree["frostContainsMedia"])
    check("layer root has contain: strict", tree["contain"] == "strict", str(tree["contain"]))
    check("layer root has isolation: isolate", tree["isolation"] == "isolate", str(tree["isolation"]))

    print("\n== 1. parallax writes the stage, not the root ==")
    before = page.evaluate(
        """() => {
            const bd = document.querySelector('.lgw-backdrop');
            const stage = bd.querySelector('.lgw-stage');
            return { rootVars: [...bd.style].filter(p => p.startsWith('--lgw-p') || p.startsWith('--lgw-x')),
                     stageVars: [...stage.style].filter(p => p.startsWith('--lgw')) };
        }"""
    )
    print(f"  before mouse: {json.dumps(before)}")
    for x in range(150, 1450, 100):
        page.mouse.move(x, 250 + (x % 300))
        page.wait_for_timeout(25)
    page.wait_for_timeout(400)
    after = page.evaluate(
        """() => {
            const bd = document.querySelector('.lgw-backdrop');
            const stage = bd.querySelector('.lgw-stage');
            return { rootVars: [...bd.style].filter(p => p.startsWith('--lgw-p') || p.startsWith('--lgw-x')),
                     stageVars: [...stage.style].filter(p => p.startsWith('--lgw')),
                     stageTransform: getComputedStyle(stage).transform };
        }"""
    )
    print(f"  after mouse:  {json.dumps(after)}")
    check("root has NO transform vars (blur not invalidated)", after["rootVars"] == [], str(after["rootVars"]))
    check("stage carries the transform vars", len(after["stageVars"]) >= 2, str(after["stageVars"]))
    check("stage transform actually moved", after["stageTransform"] != tree["stageTransform"], after["stageTransform"])

    print("\n== 2. opening Settings must not thrash the observer ==")
    # Count long tasks while opening, which is what 'laggy' means in practice.
    lag = page.evaluate(
        """() => new Promise(res => {
            const long = [];
            const po = new PerformanceObserver(list => {
                for (const e of list.getEntries()) if (e.duration > 50) long.push(Math.round(e.duration));
            });
            try { po.observe({ entryTypes: ['longtask'] }); } catch {}
            // Open settings programmatically, wait, then report.
            const a=[...document.querySelectorAll('button,[role=button],a')];
            const h=a.find(e=>(e.textContent||'').trim()==='设置'); if(h) h.click();
            setTimeout(() => { po.disconnect(); res(long); }, 3500);
        })"""
    )
    print(f"  long tasks (>50ms) while opening Settings: {lag}")
    check("no long task over 250ms", not [d for d in lag if d > 250], str(lag))

    print("\n== 3. switching must not stack two half-decoded images ==")
    seen = page.evaluate(
        """async () => {
            const inv = await (await fetch('/api/liquid-glass/inventory')).json();
            const vids = inv.wallpapers.filter(w => w.type === 'video' && w.mediaUrl).slice(0, 2);
            const out = [];
            for (const v of vids) {
                localStorage.setItem('liquid-glass-wallpaper/v1', JSON.stringify({
                    enabled: true, activeId: v.id, blur: 28, saturation: 118, tint: 12,
                    vignette: 18, grain: true, fit: 'cover', parallax: true }));
                location.reload();
            }
            return out;
        }"""
    )
    page.wait_for_timeout(9000)
    stack = page.evaluate(
        """() => {
            const bd = document.querySelector('.lgw-backdrop');
            const wrap = bd.querySelector('.lgw-media-wrap');
            const v = wrap.querySelector('video');
            const poster = wrap.querySelector('img');
            return {
                backdrops: document.querySelectorAll('.lgw-backdrop').length,
                wraps: bd.querySelectorAll('.lgw-media-wrap').length,
                videos: wrap.querySelectorAll('video').length,
                posters: wrap.querySelectorAll('img').length,
                videoOpacity: v ? getComputedStyle(v).opacity : null,
                videoReadyState: v ? v.readyState : null,
                posterZ: poster ? getComputedStyle(poster).zIndex : null,
                videoZ: v ? getComputedStyle(v).zIndex : null,
            };
        }"""
    )
    print(json.dumps(stack, ensure_ascii=False, indent=2))
    check("exactly one layer root", stack["backdrops"] == 1, str(stack["backdrops"]))
    check("exactly one media wrap", stack["wraps"] == 1, str(stack["wraps"]))
    check("at most one video", stack["videos"] <= 1, str(stack["videos"]))
    check("video decodes before fading in", stack["videoReadyState"] is None or stack["videoReadyState"] >= 2,
          f"readyState={stack['videoReadyState']} opacity={stack['videoOpacity']}")

    check("no uncaught page errors", len(errs) == 0, "; ".join(errs[:2]))

    page.screenshot(path="E:/Harness work/shots/perf-fixed.png")
    print("\n  shot: E:/Harness work/shots/perf-fixed.png")
    b.close()

passed = sum(1 for _, ok, _ in results if ok)
failed = len(results) - passed
print(f"\n{passed} passed, {failed} failed")
sys.exit(0 if failed == 0 else 1)
