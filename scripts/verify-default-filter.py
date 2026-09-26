"""
Verify the default library view excludes low-resolution scene previews.

Usage: python verify-default-filter.py <url> <shots-dir>
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
    page.wait_for_timeout(900)
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

    inv = page.evaluate("""async () => await (await fetch('/api/liquid-glass/inventory')).json()""")
    by_type = {}
    for w in inv["wallpapers"]:
        by_type[w["type"]] = by_type.get(w["type"], 0) + 1
    print("  library:", json.dumps(by_type))

    state = page.evaluate(
        """() => {
            const card = document.querySelector('[data-lgw-card]');
            const pressed = [...card.querySelectorAll('.lgw-filter')]
                .filter(b => b.getAttribute('aria-pressed') === 'true')
                .map(b => b.textContent.trim());
            return {
                activeFilter: pressed,
                tiles: card.querySelectorAll('.lgw-tile').length,
                badges: [...card.querySelectorAll('.lgw-badge-type')].map(e => e.textContent.trim()),
                hint: card.querySelector('.lgw-hint')?.textContent?.trim() ?? null,
            };
        }"""
    )
    print("  " + json.dumps(state, ensure_ascii=False, indent=None)[:400])

    check("default filter is 清晰", any("清晰" in f for f in state["activeFilter"]), str(state["activeFilter"]))
    check(
        "default tile count excludes scenes",
        state["tiles"] == by_type.get("video", 0) + by_type.get("image", 0) + by_type.get("web", 0),
        f"tiles={state['tiles']} expected={by_type.get('video',0)+by_type.get('image',0)+by_type.get('web',0)}",
    )
    check(
        "no scene tiles in the default view",
        not any("场景" in b for b in state["badges"]),
        str(sorted(set(state["badges"]))),
    )
    check("hint explains the exclusion", state["hint"] and "场景" in state["hint"], str(state["hint"])[:70])
    page.screenshot(path=f"{OUT}/default-filter.png")
    print(f"  shot  {OUT}/default-filter.png")

    # Switching to 场景 must still work.
    page.evaluate(
        """() => { const card = document.querySelector('[data-lgw-card]');
             const b = [...card.querySelectorAll('.lgw-filter')].find(x => x.textContent.includes('场景'));
             if (b) b.click(); }"""
    )
    page.wait_for_timeout(1800)
    scene_state = page.evaluate(
        """() => {
            const card = document.querySelector('[data-lgw-card]');
            return { tiles: card.querySelectorAll('.lgw-tile').length,
                     badges: [...new Set([...card.querySelectorAll('.lgw-badge-type')].map(e => e.textContent.trim()))] };
        }"""
    )
    print("  after switching to 场景: " + json.dumps(scene_state, ensure_ascii=False))
    check("scene view still lists scenes", scene_state["tiles"] == by_type.get("scene", 0),
          f"tiles={scene_state['tiles']}")
    page.screenshot(path=f"{OUT}/default-filter-scene.png")

    check("no uncaught page errors", len(errs) == 0, "; ".join(errs[:2]))
    b.close()

passed = sum(1 for _, ok, _ in results if ok)
failed = len(results) - passed
print(f"\n{passed} passed, {failed} failed")
sys.exit(0 if failed == 0 else 1)
