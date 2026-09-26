"""
Verify scene wallpapers are gone from the running GUI.

Usage: python verify-no-scene.py <url> <shots-dir>
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

    inv = page.evaluate("""async () => await (await fetch('/api/liquid-glass/inventory')).json()""")
    by = {}
    for w in inv["wallpapers"]:
        by[w["type"]] = by.get(w["type"], 0) + 1
    print("  inventory:", json.dumps(by), "total:", inv["total"])
    check("no scenes in the inventory", by.get("scene", 0) == 0, str(by.get("scene")))
    check("only supported types", set(by) <= {"video", "image", "web"}, str(sorted(by)))
    check("sceneUrl absent from every entry", all("sceneUrl" not in w for w in inv["wallpapers"]))

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

    card = page.evaluate(
        """() => {
            const c = document.querySelector('[data-lgw-card]');
            if (!c) return null;
            return {
                filters: [...c.querySelectorAll('.lgw-filter')].map(b => b.textContent.trim()),
                tiles: c.querySelectorAll('.lgw-tile').length,
                badges: [...new Set([...c.querySelectorAll('.lgw-badge-type')].map(e => e.textContent.trim()))],
                hasSceneFilter: [...c.querySelectorAll('.lgw-filter')].some(b => b.textContent.includes('场景')),
                hasSharpFilter: [...c.querySelectorAll('.lgw-filter')].some(b => b.textContent.includes('清晰')),
                hint: c.querySelector('.lgw-hint')?.textContent ?? null,
            };
        }"""
    )
    print("  " + json.dumps(card, ensure_ascii=False)[:420])

    check("no 场景 filter button", not card["hasSceneFilter"], str(card["filters"]))
    check("no 清晰 filter button (no longer needed)", not card["hasSharpFilter"], str(card["filters"]))
    check("tile count matches the inventory", card["tiles"] == inv["total"], f"{card['tiles']} vs {inv['total']}")
    check("no scene badge", not any("场景" in x for x in card["badges"]), str(card["badges"]))
    check("no quality hint about scenes", card["hint"] is None, str(card["hint"])[:60])
    page.screenshot(path=f"{OUT}/no-scene-card.png")
    print(f"  shot  {OUT}/no-scene-card.png")

    check("no uncaught page errors", len(errs) == 0, "; ".join(errs[:2]))
    b.close()

passed = sum(1 for _, ok, _ in results if ok)
failed = len(results) - passed
print(f"\n{passed} passed, {failed} failed")
sys.exit(0 if failed == 0 else 1)
