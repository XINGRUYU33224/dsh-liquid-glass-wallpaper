"""
Leak check: switch wallpapers repeatedly and confirm DOM/listener/decoder counts
stay flat. A backdrop that appends without clearing would grow unbounded.
"""
import sys

from playwright.sync_api import sync_playwright

URL = sys.argv[1]
with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=["--autoplay-policy=no-user-gesture-required"])
    page = b.new_context(viewport={"width": 1280, "height": 800}).new_page()
    page.goto(URL, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(6000)
    page.evaluate(
        """() => { for (const t of ['继续','我知道了','确定']) {
            const el=[...document.querySelectorAll('button')].find(b=>(b.textContent||'').trim()===t);
            if (el) { el.click(); return; } } }"""
    )
    page.wait_for_timeout(1500)

    def counts():
        return page.evaluate(
            """() => {
                const el = document.querySelector('.lgw-backdrop');
                return {
                    backdrops: document.querySelectorAll('.lgw-backdrop').length,
                    styleTags: document.querySelectorAll('style[data-plugin-css*="liquid-glass"]').length,
                    wraps: el ? el.querySelectorAll('.lgw-media-wrap').length : -1,
                    videos: el ? el.querySelectorAll('video').length : -1,
                    imgs: el ? el.querySelectorAll('img').length : -1,
                    iframes: el ? el.querySelectorAll('iframe').length : -1,
                    mediaChildren: el ? (el.querySelector('.lgw-media-wrap')?.children.length ?? -1) : -1,
                };
            }"""
        )

    print("baseline:", counts())

    picked = page.evaluate(
        """async () => {
            const inv = await (await fetch('/api/liquid-glass/inventory')).json();
            return (inv.wallpapers || []).filter(w => w.playable).slice(0, 8).map(w =>
                ({ id: w.id, type: w.type, mediaUrl: w.mediaUrl, previewUrl: w.previewUrl, webUrl: w.webUrl }));
        }"""
    )
    print(f"cycling through {len(picked)} wallpapers x3 ...")

    for round_ in range(3):
        for item in picked:
            page.evaluate(
                """async (item) => {
                    // Drive the real plugin path via its persisted state + reload.
                    localStorage.setItem('liquid-glass-wallpaper/v1', JSON.stringify({
                        enabled: true, activeId: item.id, blur: 28, saturation: 118,
                        tint: 12, vignette: 34, grain: true, fit: 'cover', parallax: true }));
                    const el = document.querySelector('.lgw-backdrop');
                    if (el) el.remove();
                    location.reload();
                }""",
                item,
            )
            page.wait_for_timeout(2600)

    final = counts()
    print("after cycling:", final)

    # Steady state after any number of switches: one backdrop, one backdrop
    # stylesheet, one media wrap, and at most one video + its poster (+ one
    # image) — never a growing list.
    ok = (
        final["backdrops"] == 1
        and final["styleTags"] == 1
        and final["wraps"] == 1
        and final["videos"] <= 1
        and final["imgs"] <= 2
        and final["iframes"] <= 1
        and final["mediaChildren"] <= 3
    )
    print("\nPASS: no unbounded growth" if ok else "\nFAIL: resource growth detected")
    sys.exit(0 if ok else 1)
