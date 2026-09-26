"""
Capture a glass-treatment demonstration: the same wallpaper at several blur
levels, cropped to the shell so the liquid-glass layers are comparable.
"""
import sys

from playwright.sync_api import sync_playwright

URL = sys.argv[1]
OUT = sys.argv[2]

LEVELS = [0, 14, 28, 44, 60]

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=["--autoplay-policy=no-user-gesture-required"])
    page = b.new_context(viewport={"width": 1280, "height": 800}).new_page()
    page.goto(URL, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(4000)
    page.evaluate(
        """() => { for (const t of ['继续','我知道了','确定']) {
            const el=[...document.querySelectorAll('button')].find(b=>(b.textContent||'').trim()===t);
            if (el) { el.click(); return; } } }"""
    )
    page.wait_for_timeout(1500)

    # Guarantee a video wallpaper is on screen.
    page.evaluate(
        """async () => {
            const inv = await (await fetch('/api/liquid-glass/inventory')).json();
            const v = (inv.wallpapers||[]).find(w => w.type === 'video' && w.mediaUrl && w.previewUrl);
            if (!v) return;
            localStorage.setItem('liquid-glass-wallpaper/v1', JSON.stringify({
                enabled: true, activeId: v.id, blur: 28, saturation: 118, tint: 12,
                vignette: 34, grain: true, fit: 'cover', parallax: false }));
        }"""
    )
    page.reload(wait_until="domcontentloaded")
    page.wait_for_timeout(9000)

    for lvl in LEVELS:
        page.evaluate(
            """(lvl) => {
                const el = document.querySelector('.lgw-backdrop');
                if (el) { el.style.setProperty('--lgw-blur', lvl + 'px'); }
            }""",
            lvl,
        )
        page.wait_for_timeout(900)
        page.screenshot(path=f"{OUT}/glass-blur-{lvl:02d}.png", clip={"x": 0, "y": 0, "width": 1280, "height": 800})
        print(f"  shot  {OUT}/glass-blur-{lvl:02d}.png")

    # Toggling the grain off/on, and the vignette, exercises the other layers.
    page.evaluate(
        """() => {
            const el = document.querySelector('.lgw-backdrop');
            if (!el) return;
            el.style.setProperty('--lgw-blur', '28px');
            const g = el.querySelector('.lgw-grain'); if (g) g.style.display = 'none';
            const v = el.querySelector('.lgw-vignette'); if (v) v.style.display = 'none';
        }"""
    )
    page.wait_for_timeout(900)
    page.screenshot(path=f"{OUT}/glass-plain.png", clip={"x": 0, "y": 0, "width": 1280, "height": 800})
    print(f"  shot  {OUT}/glass-plain.png")

    b.close()
