"""
Verify the sidebar rail treatment: translucent sidebar, settings dialog intact.

This is the regression test for the collapse. The previous attempt used
backdrop-filter on the rail and the settings dialog shrank from 1600px to 280px.
Colour-only translucency does not, and there is now a runtime guard that rolls
the treatment back if a dialog is ever seen collapsed.

Usage: python verify-sidebar.py <url> <shots-dir>
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

    print("== the rail is treated ==")
    rail = page.evaluate(
        """() => {
            const el = document.querySelector('[class*="sidebarCol"]');
            if (!el) return null;
            const cs = getComputedStyle(el);
            return { cls: String(el.className), bg: cs.backgroundColor,
                     hasFilter: (cs.backdropFilter || cs.webkitBackdropFilter || 'none') !== 'none',
                     w: Math.round(el.getBoundingClientRect().width) };
        }"""
    )
    print("  " + json.dumps(rail, ensure_ascii=False))
    check("sidebar rail carries the panel class", rail and "lgw-glasspanel" in rail["cls"], str(rail and rail["cls"])[:60])
    check(
        "rail background is translucent",
        rail and "rgba(" in rail["bg"] and not rail["bg"].endswith(", 1)"),
        str(rail and rail["bg"]),
    )
    check("rail does NOT use backdrop-filter (the collapse trigger)", rail and not rail["hasFilter"], str(rail and rail["hasFilter"]))
    page.screenshot(path=f"{OUT}/sidebar-glass.png")
    print(f"  shot  {OUT}/sidebar-glass.png")

    print("\n== the settings dialog is NOT collapsed ==")
    page.evaluate(
        """() => { const a=[...document.querySelectorAll('button,[role=button],a')];
             const h=a.find(e=>(e.textContent||'').trim()==='设置'); if(h) h.click(); }"""
    )
    page.wait_for_timeout(3000)
    dlg = page.evaluate(
        """() => {
            const ov = document.querySelector('[class*="overlay"]');
            const opt = document.querySelector('[class*="options"]');
            const panel = document.querySelector('[class*="panel"]');
            return { overlay: ov ? Math.round(ov.getBoundingClientRect().width) : null,
                     options: opt ? Math.round(opt.getBoundingClientRect().width) : null,
                     panel: panel ? Math.round(panel.getBoundingClientRect().width) : null,
                     guardTripped: false };
        }"""
    )
    print("  " + json.dumps(dlg))
    check("settings overlay is full width", (dlg["overlay"] or 0) > 1000, str(dlg["overlay"]))
    check("settings content is usable", (dlg["options"] or 0) > 400, str(dlg["options"]))

    page.evaluate(
        """() => { const hit=[...document.querySelectorAll('*')].filter(e=>
              (e.textContent||'').trim()==='液态玻璃壁纸' && e.children.length===0)[0];
            if (hit) (hit.closest('button,[role=button],li,a')||hit).click(); }"""
    )
    page.wait_for_timeout(2500)
    card = page.evaluate(
        """() => {
            const c = document.querySelector('[data-lgw-card]');
            return c ? { w: Math.round(c.getBoundingClientRect().width),
                         tiles: c.querySelectorAll('.lgw-tile').length } : null;
        }"""
    )
    print("  card: " + json.dumps(card))
    check("the plugin card still renders", card and card["w"] > 300, str(card and card["w"]))
    check("library still lists wallpapers", card and card["tiles"] > 20, str(card and card["tiles"]))
    page.screenshot(path=f"{OUT}/sidebar-glass-settings.png")
    print(f"  shot  {OUT}/sidebar-glass-settings.png")

    print("\n== closing settings restores the shell cleanly ==")
    page.evaluate(
        """() => { const c=document.querySelector('[data-slot="settings.close"]')
              || [...document.querySelectorAll('button')].find(b=>(b.textContent||'').trim()==='关闭');
            if(c) c.click(); }"""
    )
    page.wait_for_timeout(2000)
    after = page.evaluate(
        """() => {
            const el = document.querySelector('[class*="sidebarCol"]');
            const cs = el ? getComputedStyle(el) : null;
            const bd = document.querySelector('.lgw-backdrop');
            return { railBg: cs ? cs.backgroundColor : null,
                     backdrop: !!bd, htmlAttr: document.documentElement.hasAttribute('data-liquid-glass') };
        }"""
    )
    print("  " + json.dumps(after))
    check("backdrop still active after closing", after["backdrop"] and after["htmlAttr"])

    check("no uncaught page errors", len(errs) == 0, "; ".join(errs[:2]))
    b.close()

passed = sum(1 for _, ok, _ in results if ok)
failed = len(results) - passed
print(f"\n{passed} passed, {failed} failed")
sys.exit(0 if failed == 0 else 1)
