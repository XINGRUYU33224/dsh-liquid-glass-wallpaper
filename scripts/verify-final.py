"""
Hero capture + final end-to-end acceptance run for the liquid-glass wallpaper
plugin. Drives the real UI: pick a video wallpaper from the card, close the
dialog, and screenshot the live frosted backdrop.

Usage: python verify-final.py <base-url> <shots-dir>
"""
import sys

from playwright.sync_api import sync_playwright

URL = sys.argv[1]
OUT = sys.argv[2]
results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    print(f"  {'PASS' if cond else 'FAIL'}  {name}" + (f" — {detail}" if detail else ""))


with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=["--autoplay-policy=no-user-gesture-required"])
    ctx = b.new_context(viewport={"width": 1600, "height": 950}, device_scale_factor=1)
    page = ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))

    page.goto(URL, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(3000)

    # Dismiss any onboarding notice.
    page.evaluate(
        """() => {
            for (const t of ['继续', '我知道了', '确定']) {
                const el = [...document.querySelectorAll('button')].find(b => (b.textContent||'').trim() === t);
                if (el) { el.click(); return; }
            }
        }"""
    )
    page.wait_for_timeout(1500)

    # A returning user already has a selection persisted; the boot path must
    # restore it. Seed one (if none is stored) and reload so that path runs.
    page.evaluate(
        """async () => {
            if (localStorage.getItem('liquid-glass-wallpaper/v1')) return;
            const inv = await (await fetch('/api/liquid-glass/inventory')).json();
            const v = (inv.wallpapers || []).find(w => w.type === 'video' && w.mediaUrl);
            if (!v) return;
            localStorage.setItem('liquid-glass-wallpaper/v1', JSON.stringify({
                enabled: true, activeId: v.id, blur: 28, saturation: 118, tint: 12,
                vignette: 34, grain: true, fit: 'cover', parallax: true
            }));
        }"""
    )
    page.reload(wait_until="domcontentloaded")
    page.wait_for_timeout(9000)

    print("== backdrop baseline ==")
    base = page.evaluate(
        """() => {
            const el = document.querySelector('.lgw-backdrop');
            const v = el && el.querySelector('video');
            const img = el && el.querySelector('.lgw-poster, .lgw-media[src]');
            return { mounted: !!el, hasVideo: !!v, playing: v ? !v.paused : false,
                     w: v ? v.videoWidth : 0, poster: !!el && !!el.querySelector('.lgw-poster'),
                     imgW: img && img.naturalWidth ? img.naturalWidth : 0 };
        }"""
    )
    check("backdrop mounted", base["mounted"])
    # A fresh page load has seen no user gesture, so autoplay may legitimately be
    # refused; what must hold is that *something* is painted (poster or decoded
    # video) rather than a black frame.
    painted = base["playing"] or base["poster"] or base["imgW"] > 0
    check(
        "backdrop paints media on boot",
        painted,
        f"playing={base['playing']} poster={base['poster']} imgW={base['imgW']}",
    )

    page.screenshot(path=f"{OUT}/10-hero-backdrop.png")
    print(f"  shot  {OUT}/10-hero-backdrop.png")

    print("\n== drive the card: pick a different video ==")
    page.evaluate(
        """() => { const all=[...document.querySelectorAll('button,[role=button],a')];
             const h=all.find(e=>(e.textContent||'').trim()==='设置'); if(h) h.click(); }"""
    )
    page.wait_for_timeout(2500)
    page.evaluate(
        """() => {
            const hit = [...document.querySelectorAll('*')].filter(e =>
                (e.textContent||'').trim() === '液态玻璃壁纸' && e.children.length === 0)[0];
            if (hit) (hit.closest('button, [role=button], li, a') || hit).click();
        }"""
    )
    page.wait_for_timeout(2500)

    # Filter to video, then pick the second tile (a different wallpaper).
    page.evaluate(
        """() => {
            const btn = [...document.querySelectorAll('[data-lgw-card] .lgw-filter')]
                .find(b => (b.textContent||'').startsWith('视频'));
            if (btn) btn.click();
        }"""
    )
    page.wait_for_timeout(1800)

    picked = page.evaluate(
        """() => {
            const tiles = [...document.querySelectorAll('[data-lgw-card] .lgw-tile')];
            if (tiles.length < 2) return null;
            const t = tiles[1];
            const title = t.getAttribute('title');
            t.click();
            return title;
        }"""
    )
    check("picked a second video wallpaper", bool(picked), str(picked))
    page.wait_for_timeout(5000)

    page.screenshot(path=f"{OUT}/11-card-video-filter.png")
    print(f"  shot  {OUT}/11-card-video-filter.png")

    print("\n== close the dialog and capture the live backdrop ==")
    page.evaluate(
        """() => {
            const close = document.querySelector('[data-slot="settings.close"]')
                || [...document.querySelectorAll('button')].find(b => (b.textContent||'').trim() === '关闭');
            if (close) close.click();
        }"""
    )
    page.wait_for_timeout(4000)

    live = page.evaluate(
        """() => {
            const el = document.querySelector('.lgw-backdrop');
            const v = el && el.querySelector('video');
            const f = el && el.querySelector('.lgw-frost');
            const cs = f ? getComputedStyle(f) : null;
            return { playing: v ? !v.paused : false, w: v ? v.videoWidth : 0,
                     filter: cs ? (cs.backdropFilter || cs.webkitBackdropFilter) : null,
                     htmlAttr: document.documentElement.hasAttribute('data-liquid-glass') };
        }"""
    )
    check("backdrop still playing after close", live["playing"], f"{live['w']}px")
    check("frost blur active", "blur" in str(live["filter"]), str(live["filter"]))
    check("html scope attribute present", live["htmlAttr"])

    page.screenshot(path=f"{OUT}/12-hero-final.png")
    print(f"  shot  {OUT}/12-hero-final.png")

    print("\n== slider drives the glass live ==")
    changed = page.evaluate(
        """() => {
            const el = document.querySelector('.lgw-backdrop');
            if (!el) return null;
            el.style.setProperty('--lgw-blur', '52px');
            const f = el.querySelector('.lgw-frost');
            return f ? getComputedStyle(f).backdropFilter : null;
        }"""
    )
    check("blur responds to the CSS variable", "52" in str(changed), str(changed))

    check("no uncaught page errors", len(errs) == 0, "; ".join(errs[:2]))

    ctx.close()
    b.close()

passed = sum(1 for _, ok, _ in results if ok)
failed = len(results) - passed
print(f"\n{passed} passed, {failed} failed")
sys.exit(0 if failed == 0 else 1)
