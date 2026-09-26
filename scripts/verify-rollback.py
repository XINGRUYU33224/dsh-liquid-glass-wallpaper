"""
Verify the rollback: settings panel is usable again, wallpaper still visible.

Usage: python verify-rollback.py <url> <shots-dir>
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

    print("== nothing is frosted any more ==")
    glassed = page.evaluate("() => document.querySelectorAll('.lgw-glasspanel').length")
    check("no .lgw-glasspanel elements", glassed == 0, str(glassed))

    print("\n== wallpaper still visible ==")
    # Select a wallpaper first: a fresh profile has no saved selection, so the
    # layer correctly mounts empty.
    page.evaluate(
        """async () => {
            const inv = await (await fetch('/api/liquid-glass/inventory')).json();
            const v = inv.wallpapers.find(w => w.type === 'video' && w.mediaUrl);
            if (v) localStorage.setItem('liquid-glass-wallpaper/v1', JSON.stringify({
                enabled: true, activeId: v.id, blur: 28, saturation: 118, tint: 12,
                vignette: 18, grain: true, fit: 'cover', parallax: false }));
        }"""
    )
    page.reload(wait_until="domcontentloaded")
    page.wait_for_timeout(8000)
    live = page.evaluate(
        """() => {
            const bd = document.querySelector('.lgw-backdrop');
            const media = bd && (bd.querySelector('video') || bd.querySelector('img'));
            return { mounted: !!bd,
                     hasMedia: !!media,
                     layers: bd ? [...bd.children].map(c => c.className) : [],
                     htmlAttr: document.documentElement.hasAttribute('data-liquid-glass') };
        }"""
    )
    check("backdrop mounted", live["mounted"])
    check("media present", live["hasMedia"])
    check("layer stack intact", live["layers"][0] == "lgw-stage", str(live["layers"]))
    check("scope attribute set", live["htmlAttr"])

    print("\n== settings panel opens at a usable width ==")
    page.evaluate(
        """() => { const a=[...document.querySelectorAll('button,[role=button],a')];
             const h=a.find(e=>(e.textContent||'').trim()==='设置'); if(h) h.click(); }"""
    )
    page.wait_for_timeout(2500)
    w = page.evaluate(
        """() => {
            const ov = document.querySelector('[class*="overlay"]');
            const card = document.querySelector('[data-lgw-card]');
            return { overlay: ov ? Math.round(ov.getBoundingClientRect().width) : null,
                     card: card ? Math.round(card.getBoundingClientRect().width) : null,
                     innerW: innerWidth };
        }"""
    )
    print("  " + json.dumps(w))
    check("settings overlay is wider than 280px", (w["overlay"] or 0) > 400, f"overlay={w['overlay']}")

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
            const r = c.getBoundingClientRect();
            const ov = document.querySelector('[class*="overlay"]');
            const tiles = c.querySelectorAll('.lgw-tile').length;
            const ranges = c.querySelectorAll('input[type=range]').length;
            return { w: Math.round(r.width), overlay: ov ? Math.round(ov.getBoundingClientRect().width) : null,
                     tiles, ranges };
        }"""
    )
    print("  " + json.dumps(card))
    check("card renders at a usable width", card and card["w"] >= 300, str(card and card["w"]))
    check("wallpaper grid still present", card and card["tiles"] > 50, str(card and card["tiles"]))
    check("glass sliders still present", card and card["ranges"] >= 4, str(card and card["ranges"]))
    page.screenshot(path=f"{OUT}/rollback-card.png")
    print(f"  shot  {OUT}/rollback-card.png")

    print("\n== sidebar is opaque again (expected after the rollback) ==")
    page.evaluate(
        """() => { const c=document.querySelector('[data-slot="settings.close"]')
              || [...document.querySelectorAll('button')].find(b=>(b.textContent||'').trim()==='关闭');
            if(c) c.click(); }"""
    )
    page.wait_for_timeout(2000)
    side = page.evaluate(
        """() => {
            const el = document.elementFromPoint(100, Math.round(innerHeight*0.7));
            const chain = [];
            let n = el;
            while (n && n !== document.body) {
                const cs = getComputedStyle(n);
                if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)') {
                    chain.push({ cls: String(n.className||'').slice(0,40), bg: cs.backgroundColor });
                }
                n = n.parentElement;
            }
            return chain.slice(0, 3);
        }"""
    )
    print("  " + json.dumps(side, ensure_ascii=False))
    check("sidebar keeps its own background (rollback worked)", len(side) > 0, str(side[:1]))
    page.screenshot(path=f"{OUT}/rollback-main.png")
    print(f"  shot  {OUT}/rollback-main.png")

    check("no uncaught page errors", len(errs) == 0, "; ".join(errs[:2]))
    b.close()

passed = sum(1 for _, ok, _ in results if ok)
failed = len(results) - passed
print(f"\n{passed} passed, {failed} failed")
sys.exit(0 if failed == 0 else 1)
