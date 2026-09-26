"""
Open the DSH Settings UI and verify the liquid-glass wallpaper card is present
and functional: find the section, open it, screenshot the card, drive a control.

Usage: python verify-card.py <base-url>
"""
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
    ctx = b.new_context(viewport={"width": 1600, "height": 950})
    page = ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))

    page.goto(URL, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(5000)

    # Dismiss the beta notice modal if it is showing.
    print("== dismiss notice ==")
    for label in ["继续", "继续使用", "我知道了", "确定"]:
        btn = page.locator(f"button:has-text('{label}')")
        if btn.count() > 0 and btn.first.is_visible():
            btn.first.click()
            print(f"  dismissed via '{label}'")
            page.wait_for_timeout(1500)
            break
    else:
        print("  no notice modal")

    # Open Settings. Clicks are dispatched in-page: a third-party skin may paint
    # a decorative overlay over the sidebar, and this script verifies the
    # liquid-glass plugin, not that skin's hit-testing.
    print("\n== open settings ==")
    opened = page.evaluate(
        """() => {
            const sel = ["[data-dsh-part='settings-button']", "button[aria-label*='设置']",
                         "button[title*='设置']", "[data-slot*='settings']"];
            for (const s of sel) {
                const el = document.querySelector(s);
                if (el) { el.click(); return s; }
            }
            // Fall back to any element whose text is exactly 设置.
            const all = [...document.querySelectorAll('button, [role=button], a')];
            const hit = all.find(e => (e.textContent || '').trim() === '设置');
            if (hit) { hit.click(); return 'text:设置'; }
            return null;
        }"""
    )
    opened = opened is not None
    check("settings opened", opened, str(opened))
    page.wait_for_timeout(2500)

    page.screenshot(path=f"{OUT}/02-settings-open.png")

    # Find our section in the settings nav.
    print("\n== find liquid-glass section ==")
    clicked = page.evaluate(
        """() => {
            const all = [...document.querySelectorAll('*')];
            const hit = all.filter(e => (e.textContent || '').trim() === '液态玻璃壁纸' && e.children.length === 0)[0];
            if (hit) { (hit.closest('button, [role=button], li, a') || hit).click(); return true; }
            return false;
        }"""
    )
    if clicked:
        page.wait_for_timeout(2500)
    check("liquid-glass section clicked", clicked)

    page.screenshot(path=f"{OUT}/03-liquid-glass-card.png")
    print(f"  shot  {OUT}/03-liquid-glass-card.png")

    # Assert card internals.
    print("\n== card internals ==")
    body = page.inner_text("body")
    check("card label rendered", "液态玻璃壁纸" in body)
    check("card intro copy rendered", "Wallpaper Engine" in body or "壁纸库" in body)

    # The wallpaper grid should list tiles once the inventory answers.
    tiles = page.locator("button[title*='·']")
    tile_count = tiles.count()
    check("wallpaper tiles rendered", tile_count > 0, f"{tile_count} tiles")
    if tile_count > 0:
        print(f"  first tile: {tiles.first.get_attribute('title')}")

    # Sliders.
    ranges = page.locator("input[type=range]")
    check("glass sliders rendered", ranges.count() >= 4, f"{ranges.count()} sliders")

    # Select the first wallpaper tile and confirm the backdrop reacts.
    print("\n== select a wallpaper from the card ==")
    if tile_count > 0:
        tiles.first.evaluate("el => el.click()")
        page.wait_for_timeout(4000)
        page.screenshot(path=f"{OUT}/04-selected.png")
        print(f"  shot  {OUT}/04-selected.png")
        state = page.evaluate("() => localStorage.getItem('liquid-glass-wallpaper/v1')")
        check("selection persisted", state is not None and "activeId" in str(state), str(state)[:110])
        media = page.evaluate(
            """() => {
                const el = document.querySelector('.lgw-backdrop');
                const v = el && el.querySelector('video');
                const i = el && el.querySelector('img');
                const f = el && el.querySelector('iframe');
                return { video: v ? { w: v.videoWidth, paused: v.paused } : null,
                         img: i ? { w: i.naturalWidth } : null, iframe: !!f };
            }"""
        )
        check("backdrop shows media after selection", bool(media.get("video") or media.get("img") or media.get("iframe")), str(media))

    check("no uncaught page errors", len(errs) == 0, "; ".join(errs[:2]))

    ctx.close()
    b.close()

passed = sum(1 for _, ok, _ in results if ok)
failed = len(results) - passed
print(f"\n{passed} passed, {failed} failed")
sys.exit(0 if failed == 0 else 1)
