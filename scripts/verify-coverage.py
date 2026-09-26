"""
Verify the media actually covers the viewport with no bare band, across several
wallpapers and two extreme window shapes.

This is the regression test for the 'black band at the bottom' bug: the layer
used inset -6% + width 112% + scale(1.06), compounding three over-scales with
different origins, which left uncovered area.

Usage: python verify-coverage.py <url> <shots-dir>
"""
import sys

from playwright.sync_api import sync_playwright

URL = sys.argv[1]
OUT = sys.argv[2]
results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    print(f"  {'PASS' if cond else 'FAIL'}  {name}" + (f" — {detail}" if detail else ""))


def measure(page):
    """Return per-element coverage of the viewport by the media box."""
    return page.evaluate(
        """() => {
            const bd = document.querySelector('.lgw-backdrop');
            if (!bd) return { ok: false, why: 'no backdrop' };
            const el = bd.querySelector('video') || bd.querySelector('img');
            if (!el) return { ok: false, why: 'no media' };
            const r = el.getBoundingClientRect();
            // The media must cover the viewport on every side. The transform is
            // applied, so use the visual rect (getBoundingClientRect includes it).
            const covers = r.left <= 0.5 && r.top <= 0.5
                        && r.right >= innerWidth - 0.5 && r.bottom >= innerHeight - 0.5;
            return {
                ok: true,
                viewport: [innerWidth, innerHeight],
                rect: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)],
                covers,
                gaps: {
                    left: Math.round(Math.max(0, 0 - r.left)),
                    top: Math.round(Math.max(0, 0 - r.top)),
                    right: Math.round(Math.max(0, r.right - innerWidth)),
                    bottom: Math.round(Math.max(0, r.bottom - innerHeight)),
                },
                objectFit: getComputedStyle(el).objectFit,
                intrinsic: el.tagName === 'VIDEO' ? [el.videoWidth, el.videoHeight] : [el.naturalWidth, el.naturalHeight],
            };
        }"""
    )


with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=["--autoplay-policy=no-user-gesture-required"])

    for label, viewport in [("wide 1600x950", {"width": 1600, "height": 950}),
                            ("tall 1100x1200", {"width": 1100, "height": 1200}),
                            ("ultrawide 2100x820", {"width": 2100, "height": 820})]:
        print(f"\n== {label} ==")
        page = b.new_context(viewport=viewport).new_page()
        page.goto(URL, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(6500)
        page.evaluate(
            """() => { for (const t of ['继续','我知道了','确定']) {
                const el=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()===t);
                if (el) { el.click(); return; } } }"""
        )
        page.wait_for_timeout(900)

        # Cover both a video and an image wallpaper, which have different
        # intrinsic ratios.
        for kind in ("video", "image"):
            page.evaluate(
                """async (kind) => {
                    const inv = await (await fetch('/api/liquid-glass/inventory')).json();
                    const w = inv.wallpapers.find(x => x.type === kind && x.mediaUrl);
                    if (!w) return;
                    localStorage.setItem('liquid-glass-wallpaper/v1', JSON.stringify({
                        enabled: true, activeId: w.id, blur: 28, saturation: 118, tint: 12,
                        vignette: 18, grain: true, fit: 'cover', parallax: false }));
                }""",
                kind,
            )
            page.reload(wait_until="domcontentloaded")
            page.wait_for_timeout(8000)
            m = measure(page)
            if not m.get("ok"):
                check(f"{label} / {kind}", False, str(m))
                continue
            check(
                f"{label} / {kind} covers viewport",
                m["covers"],
                f"rect={m['rect']} gaps={m['gaps']} intrinsic={m['intrinsic']} fit={m['objectFit']}",
            )
            # Sample the bottom band specifically: the reported symptom.
            band = page.evaluate(
                """() => {
                    const bd = document.querySelector('.lgw-backdrop');
                    const vw = innerWidth, vh = innerHeight;
                    // Is any opaque shell element over the bottom 15%?
                    let blocked = 0, total = 0;
                    for (let i = 1; i <= 6; i++) {
                        const x = Math.round(vw * i / 7);
                        const y = Math.round(vh * 0.93);
                        total++;
                        let el = document.elementFromPoint(x, y);
                        while (el) {
                            const cs = getComputedStyle(el);
                            const r = el.getBoundingClientRect();
                            if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)'
                                && r.width >= vw * 0.7 && r.height >= vh * 0.7) { blocked++; break; }
                            el = el.parentElement;
                        }
                    }
                    return { blocked, total };
                }"""
            )
            check(
                f"{label} / {kind} bottom band unobstructed",
                band["blocked"] == 0,
                f"{band['blocked']}/{band['total']} blocked",
            )

        page.screenshot(path=f"{OUT}/cover-{label.split()[0]}.png")
        print(f"  shot  {OUT}/cover-{label.split()[0]}.png")
        page.context.close()

    b.close()

passed = sum(1 for _, ok, _ in results if ok)
failed = len(results) - passed
print(f"\n{passed} passed, {failed} failed")
sys.exit(0 if failed == 0 else 1)
