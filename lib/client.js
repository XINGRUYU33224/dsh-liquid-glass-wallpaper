window.__ModuleLoader__.load({
	id: "dsh-liquid-glass-wallpaper",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");
		/**
		 * dsh-liquid-glass-wallpaper — client half.
		 *
		 * Two responsibilities:
		 *   1. a full-viewport backdrop layer that renders the selected wallpaper
		 *      behind the GUI, wrapped in the liquid-glass treatment (frost, tint,
		 *      chroma, vignette), and
		 *   2. a settings card that lists the local Wallpaper Engine library.
		 *
		 * Loaded by the DSH module loader as a client plugin bundle.
		 */

		const PLUGIN_ID = 'dsh-liquid-glass-wallpaper'
		const API = '/api/liquid-glass'
		const LS_KEY = 'liquid-glass-wallpaper/v1'

		/* ------------------------------------------------------------------ *
		 * persistence
		 * ------------------------------------------------------------------ */

		const DEFAULTS = {
		  enabled: true,
		  activeId: null,
		  blur: 28,
		  frost: 42,
		  tint: 12,
		  saturation: 118,
		  // A light corner falloff only: the shell's own transcript scrim already
		  // darkens the lower half, and a heavy vignette on top reads as a black band.
		  vignette: 18,
		  dim: 18,
		  grain: true,
		  fit: 'cover',
		  parallax: true,
		}

		/**
		 * Per-source adjustments for still previews.
		 *
		 * Every scene preview in a normal Wallpaper Engine library is a 1:1 image
		 * (measured: 45 of 45, max 1080x1080). Shown with `cover` in a 16:9 viewport
		 * that crops ~40% of the height and then upscales 1.5-1.8x, so a scene reads as
		 * a blurred, badly framed band.
		 *
		 * A still has no motion to hide behind, so it gets a gentler treatment:
		 *   - far less frost (heavy blur on an already soft, upscaled image is mush),
		 *   - less saturation lift (upscaling exaggerates colour banding),
		 *   - a slightly stronger vignette to hide the upscaled edges,
		 *   - `contain` by default is NOT used: letterboxing a square into 16:9 leaves
		 *     big empty bars, which looks worse than cropping. Instead the crop is kept
		 *     but biased toward the top, where scene art usually centres its subject.
		 */
		const STILL_TUNING = {
		  blur: 12,
		  saturation: 104,
		  vignette: 26,
		  grain: true,
		  objectPosition: 'center 38%',
		}

		/** Media kinds that are a single still rather than a moving source. */
		function isStill(type) {
		  return type === 'scene' || type === 'image'
		}

		function loadState() {
		  try {
		    const raw = localStorage.getItem(LS_KEY)
		    if (!raw) return { ...DEFAULTS }
		    const parsed = JSON.parse(raw)
		    if (parsed === null || typeof parsed !== 'object') return { ...DEFAULTS }
		    return { ...DEFAULTS, ...parsed }
		  } catch {
		    return { ...DEFAULTS }
		  }
		}

		function saveState(state) {
		  try {
		    localStorage.setItem(LS_KEY, JSON.stringify(state))
		  } catch {
		    /* storage may be unavailable; the session still works */
		  }
		}

		/* ------------------------------------------------------------------ *
		 * backdrop layer
		 * ------------------------------------------------------------------ */

		const STYLE_ID = `${PLUGIN_ID}/backdrop.css`
		const ROOT_ATTR = 'data-liquid-glass'

		/**
		 * The backdrop CSS. Everything is scoped under a dedicated root attribute so
		 * the layer can be fully removed by dropping the attribute.
		 */
		const CSS = `
		/*
		 * The shell paints opaque backgrounds on its own full-size containers, which
		 * are SIBLINGS of this layer and therefore win the paint order. Nothing at
		 * z-index: 0 or below can show through them.
		 *
		 * Rather than fight the stacking order (fragile, and it would put the wallpaper
		 * over the chrome), the layer clears the *background paint* of the shell's
		 * full-viewport containers while it is active. Those containers are pure
		 * backdrop surfaces — clearing them changes no layout, text or control — and
		 * the shell's real UI cards keep their own backgrounds and stay readable.
		 *
		 * Everything is scoped under the root attribute, so the GUI is untouched while
		 * the layer is off.
		 */
		html[${ROOT_ATTR}],
		html[${ROOT_ATTR}] body {
		  background: transparent !important;
		}

		/*
		 * Only the shell's opaque FULL-VIEWPORT surfaces are cleared. The chrome panels
		 * (sidebar rail, transcript column) are deliberately left alone.
		 *
		 * Frosting them was tried and removed: identifying a "chrome panel" by geometry
		 * is unreliable, because the shell reuses the sidebar column as the settings
		 * dialog's panel. Applying the glass class there changed how the shell sized its
		 * flex children and collapsed the settings pane to 280px. A slightly more
		 * integrated sidebar is not worth a broken settings UI.
		 */

		/*
		 * The layer root.
		 *
		 * contain: strict makes this a self-contained paint/stacking context, so the
		 * full-viewport backdrop-filter inside can never invalidate the shell's layout
		 * or force the rest of the page to re-composite.
		 */
		.lgw-backdrop {
		  position: fixed;
		  inset: 0;
		  z-index: 0;
		  overflow: hidden;
		  pointer-events: none;
		  contain: strict;
		  isolation: isolate;
		}

		/*
		 * The media stage: the only element whose transform changes at runtime.
		 *
		 * Parallax used to write --lgw-px/--lgw-py onto .lgw-backdrop, the PARENT of
		 * the frosted layer. Changing a custom property on an ancestor invalidates every
		 * backdrop-filter in that subtree, so each mouse move forced a full-screen blur
		 * recompute. That was the reported stutter, and the flicker between the settings
		 * panel and the chat. The animated value lives on this leaf and the blur layer
		 * is its SIBLING, so a mouse move costs one compositor transform.
		 */
		.lgw-stage {
		  position: absolute;
		  inset: 0;
		  transform: translate3d(var(--lgw-px, 0px), var(--lgw-py, 0px), 0);
		  transition: transform 700ms cubic-bezier(0.22, 0.61, 0.36, 1);
		  will-change: transform;
		  backface-visibility: hidden;
		}

		/*
		 * The wallpaper media.
		 *
		 * Sizing is deliberately simple: the element covers the stage exactly and
		 * object-fit does all aspect-ratio handling. An earlier version also applied
		 * inset -6% + width 112% + scale(1.06): three over-scales with different
		 * origins, which drifted the media off centre and left a bare band.
		 */
		.lgw-media {
		  position: absolute;
		  inset: 0;
		  width: 100%;
		  height: 100%;
		  object-fit: var(--lgw-fit, cover);
		  object-position: center center;
		  /* One uniform over-scale, so the stage translate never exposes an edge. */
		  transform: scale(1.06);
		  transform-origin: center center;
		  user-select: none;
		  -webkit-user-drag: none;
		  background: transparent;
		}

		.lgw-media-frame {
		  position: absolute;
		  inset: 0;
		  border: 0;
		  width: 100%;
		  height: 100%;
		}

		/* Frosted pane sitting over the media. Oversized a little so the blur reads to
		   the very edge instead of feathering off at the last pixel. */
		/*
		 * Layer order inside .lgw-backdrop. The stage (media) paints first, then the
		 * frosted pane, then the cheap overlays. The poster keeps z-index 0 within the
		 * stage so the video crossfades over it rather than beside it.
		 */
		.lgw-media-wrap { z-index: 0; }
		.lgw-poster { z-index: 0; }

		/* The video fades in only once it has a fully decoded first frame. */
		.lgw-fade {
		  opacity: 0;
		  transition: opacity 380ms ease;
		  z-index: 1;
		}
		.lgw-fade-in {
		  opacity: 1;
		}

		@media (prefers-reduced-motion: reduce) {
		  .lgw-fade { transition: none; }
		}

		.lgw-frost {
		  position: absolute;
		  inset: -2px;
		  backdrop-filter: blur(var(--lgw-blur, 28px)) saturate(var(--lgw-sat, 118%));
		  -webkit-backdrop-filter: blur(var(--lgw-blur, 28px)) saturate(var(--lgw-sat, 118%));
		  background: var(--lgw-tint-color, transparent);
		}

		/*
		 * Specular sheen: the "wet glass" highlight raked across the top-left.
		 *
		 * This used mix-blend-mode: soft-light. A blend mode forces the whole stacking
		 * context into an offscreen buffer, and doing that directly on top of a
		 * full-viewport backdrop-filter is the worst-case compositing path. Plain
		 * alpha looks the same here because the gradient is already white-on-transparent.
		 */
		.lgw-sheen {
		  position: absolute;
		  inset: 0;
		  background:
		    radial-gradient(120% 80% at 12% 0%, rgba(255, 255, 255, 0.16) 0%, rgba(255, 255, 255, 0) 55%),
		    radial-gradient(90% 70% at 88% 100%, rgba(255, 255, 255, 0.08) 0%, rgba(255, 255, 255, 0) 60%);
		  opacity: 0.85;
		}

		/* Corner falloff keeps the chrome readable over bright wallpapers. */
		.lgw-vignette {
		  position: absolute;
		  inset: 0;
		  background:
		    radial-gradient(130% 110% at 50% 45%, rgba(0, 0, 0, 0) 42%, var(--lgw-vignette-color, rgba(0,0,0,0.34)) 100%);
		}

		/*
		 * Film grain: kills the banding large blurs create.
		 *
		 * Was mix-blend-mode: overlay at 0.16 opacity, another offscreen blend on top
		 * of the blur. Plain alpha reads almost identically over photographic wallpaper
		 * and costs nothing extra.
		 */
		.lgw-grain {
		  position: absolute;
		  inset: 0;
		  opacity: 0.10;
		  background-image: var(--lgw-grain-url);
		  background-repeat: repeat;
		  background-size: 180px 180px;
		}
		`

		/** A tiny inline SVG noise field — no network, no asset files. */
		function grainUrl() {
		  const svg =
		    `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180">` +
		    `<filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" stitchTiles="stitch"/>` +
		    `<feColorMatrix type="saturate" values="0"/></filter>` +
		    `<rect width="180" height="180" filter="url(%23n)" opacity="0.5"/></svg>`
		  return `url("data:image/svg+xml;utf8,${svg.replace(/#/g, '%23').replace(/"/g, "'")}")`
		}

		function ensureStyle() {
		  if (typeof document === 'undefined') return
		  if (document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`) !== null) return
		  const tag = document.createElement('style')
		  tag.dataset.plugin = PLUGIN_ID
		  tag.dataset.pluginCss = STYLE_ID
		  tag.textContent = CSS
		  document.head.appendChild(tag)
		}

		/**
		 * Re-dresses the shell so the wallpaper shows through.
		 *
		 * Each element is classified ONCE and remembered, so a repeat pass is a map
		 * lookup rather than a `getBoundingClientRect()` + `getComputedStyle()` per
		 * element. That matters because this runs from a MutationObserver: measuring on
		 * every pass forces synchronous layout, and writing `style` on an element we had
		 * already handled re-triggers the observer. Remembering the decision breaks both.
		 *
		 * The cache is not blind, though: the shell REUSES elements for different roles
		 * (the sidebar column becomes the settings dialog's panel, at the same size), so
		 * a cached element is re-checked whenever it has moved or resized since we
		 * dressed it. Without that, a panel dressed as chrome keeps its glass when it
		 * becomes a dialog — which is how the settings pane ended up 280px wide.
		 */
		const SHELL_STATE = new WeakMap() // el -> { kind, rect }
		const SHELL_TOUCHED = new Set() // every element modified, for exact restore
		const PRIOR = new WeakMap() // el -> the inline state it had before we touched it

		/** True when the element's box has changed since we classified it. */
		function geometryChanged(el, prev) {
		  const r = el.getBoundingClientRect()
		  return (
		    Math.abs(r.width - prev.w) > 4 ||
		    Math.abs(r.height - prev.h) > 4 ||
		    Math.abs(r.left - prev.x) > 4 ||
		    Math.abs(r.top - prev.y) > 4
		  )
		}

		function undressOne(el) {
		  const prior = PRIOR.get(el)
		  if (prior) {
		    if (prior.bg.value) el.style.setProperty('background-color', prior.bg.value, prior.bg.priority)
		    else el.style.removeProperty('background-color')
		  }
		  PRIOR.delete(el)
		  SHELL_STATE.delete(el)
		  SHELL_TOUCHED.delete(el)
		}

		function dressShell(layer) {
		  if (typeof document === 'undefined' || !document.body) return
		  const vw = window.innerWidth
		  const vh = window.innerHeight
		  if (!vw || !vh) return

		  for (const el of document.querySelectorAll('div, aside, nav, main, section')) {
		    if (el === layer || layer.contains(el) || el.contains(layer)) continue
		    if (!document.body.contains(el)) continue

		    const cached = SHELL_STATE.get(el)
		    if (cached) {
		      // Still ours, unless the shell has repurposed the element (the sidebar
		      // column becomes the settings dialog's panel at the same size).
		      if (!geometryChanged(el, cached)) continue
		      undressOne(el)
		    }

		    // Never touch an element inside a dialog, menu or form control: it is drawn
		    // above the wallpaper anyway, and clearing its background breaks its layout.
		    if (el.closest('[role="dialog"], [role="menu"], button, input, textarea, select')) continue

		    const rect = el.getBoundingClientRect()
		    if (rect.width < 120 || rect.height < 80) continue

		    // Backdrop surfaces only: things that cover most of the window. A sidebar,
		    // a card or a dialog is never touched.
		    if (rect.width < vw * 0.7 || rect.height < vh * 0.7) continue

		    const cs = getComputedStyle(el)
		    if (!cs.backgroundColor || cs.backgroundColor === 'rgba(0, 0, 0, 0)') continue

		    PRIOR.set(el, {
		      bg: {
		        value: el.style.getPropertyValue('background-color'),
		        priority: el.style.getPropertyPriority('background-color'),
		      },
		    })
		    el.style.setProperty('background-color', 'transparent', 'important')
		    SHELL_STATE.set(el, {
		      kind: 'cleared',
		      w: rect.width,
		      h: rect.height,
		      x: rect.left,
		      y: rect.top,
		    })
		    SHELL_TOUCHED.add(el)
		  }
		}

		/** Undo every change `dressShell` made, restoring the exact prior state. */
		function undressShell() {
		  for (const el of SHELL_TOUCHED) {
		    const prior = PRIOR.get(el)
		    if (prior) {
		      if (prior.bg.value) el.style.setProperty('background-color', prior.bg.value, prior.bg.priority)
		      else el.style.removeProperty('background-color')
		    }
		    PRIOR.delete(el)
		    SHELL_STATE.delete(el)
		  }
		  SHELL_TOUCHED.clear()
		}

		/**
		 * Owns the backdrop DOM and reflects state onto it. One instance per page.
		 */
		class Backdrop {
		  constructor() {
		    this.state = loadState()
		    this.root = null
		    this.video = null
		    this.iframe = null
		    this.img = null
		    this.rafPending = false
		    this.dressed = false
		    this.stage = null
		    this.lastPx = null
		    this.lastPy = null
		    this.onPointerMove = this.onPointerMove.bind(this)
		  }

		  /**
		   * Create the layer lazily. Returns the backdrop element, or null when the
		   * document has no `<body>` yet — the client can run before the shell's body
		   * exists, and inserting into a missing body would throw and take the whole
		   * plugin down at boot.
		   */
		  mount() {
		    if (this.root) return this.root
		    if (typeof document === 'undefined' || !document.body) return null
		    ensureStyle()
		    const root = document.createElement('div')
		    root.className = 'lgw-backdrop'
		    root.dataset.lgwRoot = ''
		    root.setAttribute('aria-hidden', 'true')

		    /*
		     * Layer order, back to front:
		     *   .lgw-stage   the media, and the ONLY element parallax transforms
		     *   .lgw-frost   a SIBLING of the stage, so animating the stage never
		     *                invalidates this backdrop-filter
		     *   .lgw-sheen / .lgw-vignette / .lgw-grain   cheap alpha overlays
		     */
		    this.stage = document.createElement('div')
		    this.stage.className = 'lgw-stage'

		    this.media = document.createElement('div')
		    this.media.className = 'lgw-media-wrap'
		    this.media.style.position = 'absolute'
		    this.media.style.inset = '0'
		    this.stage.appendChild(this.media)

		    this.frost = document.createElement('div')
		    this.frost.className = 'lgw-frost'
		    this.sheen = document.createElement('div')
		    this.sheen.className = 'lgw-sheen'
		    this.vignette = document.createElement('div')
		    this.vignette.className = 'lgw-vignette'
		    this.grain = document.createElement('div')
		    this.grain.className = 'lgw-grain'
		    this.grain.style.setProperty('--lgw-grain-url', grainUrl())

		    root.append(this.stage, this.frost, this.sheen, this.vignette, this.grain)
		    document.body.insertBefore(root, document.body.firstChild)
		    this.root = root
		    return root
		  }

		  /** Tear down all media and detach, restoring the shell's own backgrounds. */
		  destroy() {
		    window.removeEventListener('pointermove', this.onPointerMove)
		    this.clearMedia()
		    if (this.dressed) {
		      undressShell()
		      this.dressed = false
		    }
		    this.stage = null
		    if (this.root?.parentNode) this.root.parentNode.removeChild(this.root)
		    this.root = null
		    // A dropped rAF callback (background tab) would otherwise leave this true
		    // forever, wedging parallax off for the rest of the session.
		    this.rafPending = false
		    document.documentElement.removeAttribute(ROOT_ATTR)
		  }

		  clearMedia() {
		    // Drop any pending autoplay-retry listeners first: they close over the
		    // element being discarded and would revive a detached <video>.
		    if (this.detachResume) {
		      this.detachResume()
		      this.detachResume = null
		    }
		    if (this.video) {
		      try {
		        this.video.pause()
		        this.video.removeAttribute('src')
		        this.video.load()
		      } catch {
		        /* already gone */
		      }
		      this.video = null
		    }
		    if (this.iframe) {
		      this.iframe = null
		    }
		    if (this.img) {
		      this.img = null
		    }
		    this.poster = null
		    this.media?.replaceChildren()
		  }

		  /** Swap in a new wallpaper descriptor (from the inventory). */
		  setMedia(item) {
		    // Nothing to do before the document has a body; the boot path retries.
		    if (this.mount() === null) return
		    this.clearMedia()
		    this.poster = null
		    // Remember what kind of source is live: a still needs different glass
		    // settings from a video (see STILL_TUNING).
		    this.mediaType = item ? item.type : null
		    if (!item) return

		    if (item.type === 'video' && item.mediaUrl) {
		      // Paint the still preview underneath so the backdrop is never a black
		      // frame while the video decodes (and stays usable if autoplay is refused).
		      if (item.previewUrl) {
		        const poster = document.createElement('img')
		        poster.className = 'lgw-media lgw-poster'
		        poster.src = item.previewUrl
		        poster.alt = ''
		        poster.decoding = 'async'
		        poster.style.objectFit = this.state.fit
		        this.media.appendChild(poster)
		        this.poster = poster
		      }

		      const video = document.createElement('video')
		      video.className = 'lgw-media'
		      video.src = item.mediaUrl
		      video.autoplay = true
		      video.loop = true
		      video.muted = true
		      video.playsInline = true
		      video.disablePictureInPicture = true
		      video.preload = 'auto'
		      video.style.objectFit = this.state.fit

		      /**
		       * Autoplay is refused until the page has seen a user gesture. Retry on the
		       * first interaction instead of leaving a frozen frame.
		       *
		       * The retry listeners are owned by this activation and removed both when
		       * they fire and on teardown, so switching wallpapers can never revive a
		       * discarded <video> or accumulate window listeners.
		       */
		      let releaseResume = null
		      const play = () => {
		        const promise = video.play()
		        if (!promise || typeof promise.catch !== 'function') return
		        promise.catch(() => {
		          // A previous attempt may already be armed; keep exactly one.
		          if (releaseResume) releaseResume()
		          const resume = () => {
		            releaseResume?.()
		            // Only resume if this video is still the live one.
		            if (this.video === video) video.play().catch(() => {})
		          }
		          releaseResume = () => {
		            window.removeEventListener('pointerdown', resume)
		            window.removeEventListener('keydown', resume)
		            releaseResume = null
		          }
		          window.addEventListener('pointerdown', resume)
		          window.addEventListener('keydown', resume)
		          this.detachResume = () => releaseResume?.()
		        })
		      }
		      video.addEventListener('loadeddata', play, { once: true })
		      /*
		       * Crossfade, but only from a fully decoded first frame. The video starts
		       * transparent and is revealed on `loadeddata`, while the poster beneath it
		       * stays until then. Without this both layers composited at partial opacity
		       * while one was still decoding: the "blurry mess" seen when switching.
		       */
		      video.classList.add('lgw-fade')
		      video.addEventListener('loadeddata', () => video.classList.add('lgw-fade-in'), { once: true })
		      play()
		      this.media.appendChild(video)
		      this.video = video
		    } else if (item.type === 'web' && item.webUrl) {
		      const frame = document.createElement('iframe')
		      frame.className = 'lgw-media-frame'
		      frame.src = item.webUrl
		      frame.setAttribute('sandbox', 'allow-scripts')
		      frame.setAttribute('scrolling', 'no')
		      this.media.appendChild(frame)
		      this.iframe = frame
		    } else {
		      const src = item.mediaUrl || item.previewUrl
		      if (!src) return
		      const img = document.createElement('img')
		      img.className = 'lgw-media'
		      img.src = src
		      img.alt = ''
		      img.decoding = 'async'
		      img.style.objectFit = this.state.fit
		      // Square stills cropped into a wide viewport: bias the crop upward, which
		      // is where scene art normally puts its subject.
		      if (isStill(item.type)) img.style.objectPosition = STILL_TUNING.objectPosition
		      this.media.appendChild(img)
		      this.img = img
		    }
		  }

		  /** Paint the current state onto the layer. */
		  render() {
		    const s = this.state
		    if (typeof document === 'undefined') return
		    // No body yet (very early boot): there is nothing to paint onto, and the
		    // next render — or the boot restore — will mount and paint.
		    if (this.mount() === null) return
		    const html = document.documentElement
		    if (!s.enabled) {
		      html.removeAttribute(ROOT_ATTR)
		      this.root.style.display = 'none'
		      window.removeEventListener('pointermove', this.onPointerMove)
		      if (this.dressed) {
		        undressShell()
		        this.dressed = false
		      }
		      return
		    }
		    this.root.style.display = ''
		    html.setAttribute(ROOT_ATTR, '')
		    // The shell's opaque roots are siblings of this layer and must be made
		    // transparent for the wallpaper to be visible at all; panel surfaces are
		    // frosted so the chrome reads as liquid glass.
		    dressShell(this.root)
		    this.dressed = true

		    /*
		     * A still preview is a different medium from a video and gets its own
		     * treatment. Scene previews are 1:1 and at most 1080px, so they are cropped
		     * ~40% and upscaled ~1.5x in a 16:9 window: heavy frost on top of that is
		     * what reads as "very blurry". Reduce the frost and the saturation lift,
		     * and deepen the vignette slightly to soften the upscaled edges.
		     *
		     * The user's own sliders still win: this only shifts the value they see
		     * when a still is active, and the card shows the effective number.
		     */
		    const still = isStill(this.mediaType)
		    const blur = still ? Math.min(s.blur, STILL_TUNING.blur) : s.blur
		    const sat = still ? Math.min(s.saturation, STILL_TUNING.saturation) : s.saturation
		    const vignette = still ? Math.max(s.vignette, STILL_TUNING.vignette) : s.vignette

		    this.root.style.setProperty('--lgw-blur', `${blur}px`)
		    this.root.style.setProperty('--lgw-sat', `${sat}%`)
		    this.root.style.setProperty('--lgw-fit', s.fit)
		    this.root.style.setProperty('--lgw-tint-color', `rgba(10, 14, 26, ${(s.tint / 100).toFixed(3)})`)
		    this.root.style.setProperty(
		      '--lgw-vignette-color',
		      `rgba(0, 0, 0, ${(vignette / 100).toFixed(3)})`,
		    )
		    this.grain.style.display = s.grain ? '' : 'none'
		    // Keep every visible media element on the same fit, including the poster
		    // that shows while a video is still decoding or paused.
		    for (const el of [this.video, this.img, this.poster]) {
		      if (!el) continue
		      el.style.objectFit = s.fit
		      el.style.objectPosition = still ? STILL_TUNING.objectPosition : 'center center'
		    }
		    if (s.parallax) window.addEventListener('pointermove', this.onPointerMove, { passive: true })
		    else window.removeEventListener('pointermove', this.onPointerMove)
		  }

		  /**
		   * Subtle depth parallax — a few pixels, never enough to look loose.
		   *
		   * The translate is written to `.lgw-stage`, a leaf holding only the media.
		   * Writing it to the layer root instead would invalidate the sibling
		   * `backdrop-filter` on every mouse move: a full-screen blur recompute per
		   * frame, which is what made the GUI stutter and flicker.
		   *
		   * `requestAnimationFrame` coalesces a burst of pointer events into one write
		   * per frame, and an unchanged value is skipped entirely.
		   */
		  onPointerMove(event) {
		    if (this.rafPending) return
		    this.rafPending = true
		    requestAnimationFrame(() => {
		      this.rafPending = false
		      const stage = this.stage
		      if (!stage) return
		      const px = `${((event.clientX / window.innerWidth - 0.5) * -18).toFixed(2)}px`
		      const py = `${((event.clientY / window.innerHeight - 0.5) * -12).toFixed(2)}px`
		      if (px === this.lastPx && py === this.lastPy) return
		      this.lastPx = px
		      this.lastPy = py
		      stage.style.setProperty('--lgw-px', px)
		      stage.style.setProperty('--lgw-py', py)
		    })
		  }

		  set(patch) {
		    this.state = { ...this.state, ...patch }
		    saveState(this.state)
		    this.render()
		  }

		  onExit() {
		    this.destroy()
		  }
		}

		/* ------------------------------------------------------------------ *
		 * plugin wiring
		 * ------------------------------------------------------------------ */

		const __x_name = 'liquid-glass-wallpaper-client'

		/**
		 * Required client services. `slots` hosts the settings card; `locale` provides
		 * the card label. Both are declared because the cordis context refuses to hand
		 * over a service that `inject` does not list.
		 */
		const __x_inject = ['slots', 'locale']

		let backdrop = null

		/** Shared singleton so the settings card drives the live layer. */
		function getBackdrop() {
		  if (!backdrop) backdrop = new Backdrop()
		  return backdrop
		}

		/**
		 * The shell re-renders while in use (opening Settings, switching sessions) and
		 * can mount a new opaque root. Re-dress on structural change only.
		 *
		 * The observer watches `childList` and NOT `attributes`. Watching `style` was a
		 * feedback loop: `dressShell` writes inline styles, those writes matched the
		 * filter, and the observer fired again — a self-sustaining cycle that made the
		 * settings UI unresponsive. `dressShell` is also idempotent per element, so even
		 * a repeated pass costs a map lookup rather than a layout read.
		 */
		let shellObserver = null
		function watchShell(backdropRef) {
		  if (typeof MutationObserver === 'undefined' || !document.body) return
		  if (shellObserver) return
		  let queued = false
		  shellObserver = new MutationObserver(() => {
		    if (queued) return
		    queued = true
		    requestAnimationFrame(() => {
		      queued = false
		      const bd = backdropRef()
		      if (bd && bd.root && bd.state.enabled) dressShell(bd.root)
		    })
		  })
		  shellObserver.observe(document.body, { childList: true, subtree: true })
		}

		/**
		 * Fetch the inventory and apply the remembered selection.
		 *
		 * One fetch at boot, and the selection is re-checked when the response lands so
		 * a wallpaper the user picked while it was in flight is never clobbered (the
		 * media file can be hundreds of MB — a duplicate load is very visible).
		 *
		 * @returns the inventory response, or null.
		 */
		let restoreInFlight = null
		function restoreSelection() {
		  if (restoreInFlight) return restoreInFlight
		  const bd = getBackdrop()
		  const wanted = bd.state.activeId
		  restoreInFlight = fetch(`${API}/inventory`)
		    .then((r) => r.json())
		    .catch(() => null)
		    .then((data) => {
		      restoreInFlight = null
		      if (!data?.ok) return null
		      if (!wanted || bd.state.activeId !== wanted) return data
		      const found = data.wallpapers.find((w) => w.id === wanted)
		      if (found && bd.state.enabled) {
		        bd.setMedia(found)
		        bd.render()
		      }
		      return data
		    })
		  return restoreInFlight
		}

		/** Format a byte size for the card. */
		function humanSize(bytes) {
		  if (!Number.isFinite(bytes) || bytes <= 0) return '—'
		  const units = ['B', 'KB', 'MB', 'GB']
		  let value = bytes
		  let i = 0
		  while (value >= 1024 && i < units.length - 1) {
		    value /= 1024
		    i += 1
		  }
		  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
		}

		/**
		 * Type labels. Scenes carry a "预览图" suffix because that is literally what
		 * they are: this plugin cannot replay a scene's .pkg, so it shows the project's
		 * preview still, which is 1:1 and at most 1080px. Saying so in the grid beats
		 * letting someone pick one and wonder why it looks soft.
		 */
		const TYPE_LABEL = { video: '视频', scene: '场景 · 预览图', web: '网页', image: '图片' }

		/** Short badge text for a tile, with a native/preview quality hint. */
		function typeBadge(item) {
		  if (item.type === 'video') return '视频 · 原生'
		  if (item.type === 'scene') return '场景 · 预览'
		  return TYPE_LABEL[item.type] ?? item.type
		}

		/**
		 * The settings card. Registered into the settings section slot; if that slot is
		 * unavailable the plugin still works via the auto-restore path below.
		 */
		function Card({ ctx }) {
		  const { useCallback, useEffect, useMemo, useRef, useState } = React
		  const [items, setItems] = useState(null)
		  const [error, setError] = useState(null)
		  const [filter, setFilter] = useState('all')
		  const [query, setQuery] = useState('')
		  const [state, setState] = useState(() => getBackdrop().state)
		  const [busy, setBusy] = useState(false)
		  const booted = useRef(false)

		  const bd = getBackdrop()

		  useEffect(() => {
		    ensureCardStyle()
		  }, [])

		  const refresh = useCallback(async (force = false) => {
		    setBusy(true)
		    setError(null)
		    try {
		      const res = await fetch(`${API}/inventory${force ? '?refresh=1' : ''}`)
		      const data = await res.json()
		      if (!data.ok) throw new Error(data.error || 'inventory failed')
		      setItems(data.wallpapers)
		    } catch (e) {
		      setError(e instanceof Error ? e.message : String(e))
		    } finally {
		      setBusy(false)
		    }
		  }, [])

		  useEffect(() => {
		    if (booted.current) return
		    booted.current = true
		    refresh(false)
		  }, [refresh])

		  // Keep the card's own view of the selection in sync with the live layer: the
		  // backdrop is restored at plugin boot, which can happen before this card
		  // mounts. The card never fetches or applies the media itself — that is the
		  // backdrop's job, so there is one inventory fetch and one media load.
		  useEffect(() => {
		    setState({ ...bd.state })
		  }, [bd])

		  const useWallpaper = useCallback(
		    (item) => {
		      bd.setMedia(item)
		      const next = { ...bd.state, activeId: item.id, enabled: true }
		      bd.state = next
		      saveState(next)
		      bd.render()
		      setState(next)
		    },
		    [bd],
		  )

		  const patch = useCallback(
		    (key, value) => {
		      bd.set({ [key]: value })
		      setState({ ...bd.state })
		    },
		    [bd],
		  )

		  const clear = useCallback(() => {
		    bd.setMedia(null)
		    const next = { ...bd.state, activeId: null }
		    bd.state = next
		    saveState(next)
		    bd.render()
		    setState(next)
		  }, [bd])

		  const counts = useMemo(() => {
		    const c = { all: items?.length ?? 0, video: 0, scene: 0, web: 0, image: 0 }
		    for (const i of items ?? []) c[i.type] = (c[i.type] ?? 0) + 1
		    return c
		  }, [items])

		  const visible = useMemo(() => {
		    let list = items ?? []
		    if (filter !== 'all') list = list.filter((i) => i.type === filter)
		    const q = query.trim().toLowerCase()
		    if (q) {
		      list = list.filter(
		        (i) => i.title.toLowerCase().includes(q) || i.tags.some((t) => t.toLowerCase().includes(q)),
		      )
		    }
		    return list
		  }, [items, filter, query])

		  const active = (items ?? []).find((i) => i.id === state.activeId)

		  const el = React.createElement

		  /** One labelled slider. */
		  const slider = (label, key, min, max, unit = '') => {
		    const pct = ((state[key] - min) / (max - min)) * 100
		    return el(
		      'div',
		      { className: 'lgw-row', key },
		      el(
		        'div',
		        { className: 'lgw-row-head' },
		        el('span', { className: 'lgw-row-label' }, label),
		        el('span', { className: 'lgw-row-value' }, `${state[key]}${unit}`),
		      ),
		      el('input', {
		        className: 'lgw-range',
		        type: 'range',
		        min,
		        max,
		        value: state[key],
		        style: { '--lgw-fill': `${pct}%` },
		        onChange: (e) => patch(key, Number(e.target.value)),
		        'aria-label': label,
		      }),
		    )
		  }

		  /** One toggle chip. */
		  const chip = (label, key) =>
		    el(
		      'button',
		      {
		        key,
		        type: 'button',
		        className: 'lgw-chip',
		        'aria-pressed': Boolean(state[key]),
		        onClick: () => patch(key, !state[key]),
		      },
		      label,
		    )

		  return el(
		    'div',
		    { className: 'lgw-card', 'data-lgw-card': '' },

		    // ---- header ----------------------------------------------------
		    el(
		      'div',
		      { className: 'lgw-head' },
		      el('h3', { className: 'lgw-title' }, '液态玻璃壁纸'),
		      el(
		        'button',
		        {
		          type: 'button',
		          className: 'lgw-switch',
		          'aria-pressed': Boolean(state.enabled),
		          'aria-label': state.enabled ? '关闭壁纸' : '启用壁纸',
		          onClick: () => patch('enabled', !state.enabled),
		        },
		        el('span', { className: 'lgw-thumb' }),
		      ),
		    ),
		    el(
		      'p',
		      { className: 'lgw-intro' },
		      '读取本机 Wallpaper Engine 壁纸库作为界面背景，并叠加液态玻璃质感：磨砂、色彩浓度、染色、暗角与颗粒。壁纸是你自己的本地文件，不会被上传。',
		    ),

		    error ? el('p', { className: 'lgw-error' }, `读取失败：${error}`) : null,

		    // ---- active wallpaper ------------------------------------------
		    el(
		      'div',
		      { className: 'lgw-active' },
		      el(
		        'div',
		        { className: 'lgw-active-info' },
		        el('span', { className: 'lgw-active-label' }, '当前壁纸'),
		        el(
		          'span',
		          { className: 'lgw-active-name' },
		          error
		            ? '不可用'
		            : items === null
		              ? '载入中…'
		              : (active?.title ?? '未选择'),
		        ),
		      ),
		      state.activeId ? el('button', { type: 'button', className: 'lgw-btn', onClick: clear }, '清除') : null,
		      el(
		        'button',
		        { type: 'button', className: 'lgw-btn', onClick: () => refresh(true), disabled: busy },
		        busy ? '扫描中…' : '重新扫描',
		      ),
		    ),

		    // ---- glass controls --------------------------------------------
		    el('div', { className: 'lgw-group' }, '玻璃质感'),
		    slider('磨砂强度', 'blur', 0, 60, ' px'),
		    slider('色彩浓度', 'saturation', 60, 220, '%'),
		    slider('玻璃染色', 'tint', 0, 60, '%'),
		    slider('暗角', 'vignette', 0, 80, '%'),
		    el(
		      'div',
		      { className: 'lgw-chips' },
		      chip('颗粒', 'grain'),
		      chip('视差', 'parallax'),
		      el(
		        'button',
		        {
		          type: 'button',
		          className: 'lgw-chip',
		          'aria-pressed': state.fit === 'contain',
		          onClick: () => patch('fit', state.fit === 'cover' ? 'contain' : 'cover'),
		        },
		        state.fit === 'cover' ? '填充' : '适应',
		      ),
		    ),

		    // ---- library ---------------------------------------------------
		    el(
		      'div',
		      { className: 'lgw-lib-head' },
		      el('span', { className: 'lgw-group' }, `壁纸库${items ? ` · ${items.length}` : ''}`),
		      el('input', {
		        className: 'lgw-search',
		        type: 'search',
		        placeholder: '搜索标题或标签…',
		        value: query,
		        onChange: (e) => setQuery(e.target.value),
		        'aria-label': '搜索壁纸',
		      }),
		    ),
		    el(
		      'div',
		      { className: 'lgw-filters' },
		      ...['all', 'video', 'scene', 'web', 'image'].map((k) =>
		        el(
		          'button',
		          {
		            key: k,
		            type: 'button',
		            className: 'lgw-filter',
		            'aria-pressed': filter === k,
		            onClick: () => setFilter(k),
		          },
		          `${k === 'all' ? '全部' : (TYPE_LABEL[k] ?? k)} ${counts[k] ?? 0}`,
		        ),
		      ),
		    ),
		    // Quality expectation, stated once rather than per tile.
		    counts.scene > 0
		      ? el(
		          'p',
		          { className: 'lgw-hint' },
		          '视频类按原生分辨率播放，最清晰；场景类只能显示项目的预览图（通常 1:1、≤1080px，' +
		            '裁入宽屏后会被放大），因此天生偏软。场景已自动降低磨砂强度以免雪上加霜。',
		        )
		      : null,

		    !items && !error ? el('p', { className: 'lgw-intro' }, '正在扫描 Wallpaper Engine 库…') : null,
		    items && visible.length === 0 ? el('p', { className: 'lgw-intro' }, '没有匹配的壁纸。') : null,

		    el(
		      'div',
		      { className: 'lgw-grid' },
		      ...visible.slice(0, 240).map((item) =>
		        el(
		          'button',
		          {
		            key: item.id,
		            type: 'button',
		            className: 'lgw-tile',
		            'aria-pressed': item.id === state.activeId,
		            onClick: () => useWallpaper(item),
		            title: `${item.title} · ${humanSize(item.size)}`,
		          },
		          el(
		            'span',
		            { className: 'lgw-thumbwrap' },
		            item.previewUrl
		              ? el('img', { src: item.previewUrl, alt: '', loading: 'lazy' })
		              : el('span', { className: 'lgw-thumb-empty' }),
		            el('span', { className: 'lgw-badge-type' }, typeBadge(item)),
		            item.id === state.activeId ? el('span', { className: 'lgw-badge-on' }, '使用中') : null,
		          ),
		          el('span', { className: 'lgw-tile-name' }, item.title),
		        ),
		      ),
		    ),
		  )
		}

		/* ------------------------------------------------------------------ *
		 * styles (scoped by a hash-free prefix; only this card uses them)
		 * ------------------------------------------------------------------ */

		/* ------------------------------------------------------------------ *
		 * card stylesheet
		 *
		 * Inline styles are not enough: an active catalog skin ships L3 `!important`
		 * patches that can restyle generic element and class selectors. Every
		 * structural rule here is therefore scoped under a private data attribute and
		 * carries `!important`, so the card's layout survives any skin.
		 * ------------------------------------------------------------------ */

		const CARD_CSS_ID = `${PLUGIN_ID}/card.css`

		const CARD_CSS = `
		/*
		 * The card must fill the settings pane.
		 *
		 * Two things squeezed it to ~44px:
		 *
		 *   1. the shell wraps a section in a flex row whose children are
		 *      flex: 1 1 0%. As a flex item with flex: 0 1 auto the card shrank to its
		 *      content, and width: 100% does not help when the basis resolves to zero —
		 *      it needs flex-grow;
		 *   2. a long unbreakable CJK string then set that content width.
		 *
		 * So: grow to fill, never shrink below a readable width, and allow wrapping.
		 */
		[data-lgw-card] {
		  display: flex !important;
		  flex-direction: column !important;
		  gap: 16px !important;
		  flex: 1 1 auto !important;
		  width: 100% !important;
		  max-width: 100% !important;
		  min-width: 320px !important;
		}
		[data-lgw-card] * { box-sizing: border-box; min-width: 0; }
		[data-lgw-card] p, [data-lgw-card] span {
		  overflow-wrap: break-word !important;
		  word-break: normal !important;
		}

		[data-lgw-card] .lgw-head { display: flex !important; align-items: center !important; gap: 12px !important; }
		[data-lgw-card] .lgw-title { margin: 0 !important; font-size: 15px !important; font-weight: 600 !important; color: var(--dsw-alias-label-primary) !important; }
		[data-lgw-card] .lgw-intro { margin: 0 !important; font-size: 13px !important; line-height: 1.6 !important; color: var(--dsw-alias-label-secondary) !important; }
		[data-lgw-card] .lgw-error { margin: 0 !important; font-size: 13px !important; color: var(--dsw-alias-state-error-primary, #b42318) !important; }
		[data-lgw-card] .lgw-group { margin: 0 !important; font-size: 11.5px !important; font-weight: 700 !important; letter-spacing: .06em !important; text-transform: uppercase !important; color: var(--dsw-alias-label-tertiary) !important; }

		/* switch */
		[data-lgw-card] .lgw-switch { margin-left: auto !important; width: 40px !important; height: 22px !important; flex: none !important; padding: 2px !important; border-radius: 999px !important; border: 1px solid var(--dsw-alias-border-l3, #cbd5e1) !important; background: var(--dsw-alias-bg-layer-3, #e2e8f0) !important; cursor: pointer !important; display: inline-flex !important; align-items: center !important; transition: background .16s, border-color .16s !important; }
		[data-lgw-card] .lgw-switch[aria-pressed="true"] { border-color: var(--dsw-alias-brand-primary, #2b7cd9) !important; background: var(--dsw-alias-brand-primary, #2b7cd9) !important; }
		[data-lgw-card] .lgw-thumb { width: 18px !important; height: 18px !important; border-radius: 50% !important; background: var(--dsw-alias-label-primary-foreground, #fff) !important; box-shadow: 0 0 0 1px var(--dsw-alias-border-l4, #0f172a1f) !important; transition: transform .16s !important; display: block !important; transform: translateX(0) !important; }
		[data-lgw-card] .lgw-switch[aria-pressed="true"] .lgw-thumb { transform: translateX(18px) !important; }

		/* active wallpaper strip */
		[data-lgw-card] .lgw-active { display: flex !important; align-items: center !important; gap: 10px !important; flex-wrap: wrap !important; padding: 10px 12px !important; border-radius: 10px !important; border: 1px solid var(--dsw-alias-border-l2) !important; background: var(--dsw-alias-bg-layer-2) !important; }
		[data-lgw-card] .lgw-active-info { display: flex !important; flex-direction: column !important; gap: 2px !important; min-width: 0 !important; flex: 1 1 auto !important; }
		[data-lgw-card] .lgw-active-label { font-size: 11px !important; color: var(--dsw-alias-label-tertiary) !important; }
		[data-lgw-card] .lgw-active-name { font-size: 13px !important; font-weight: 600 !important; color: var(--dsw-alias-label-primary) !important; overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important; }

		/* sliders */
		[data-lgw-card] .lgw-row { display: flex !important; flex-direction: column !important; gap: 7px !important; }
		[data-lgw-card] .lgw-row-head { display: flex !important; align-items: center !important; gap: 8px !important; }
		[data-lgw-card] .lgw-row-label { font-size: 12.5px !important; color: var(--dsw-alias-label-primary) !important; }
		[data-lgw-card] .lgw-row-value { margin-left: auto !important; font-size: 12px !important; font-variant-numeric: tabular-nums !important; color: var(--dsw-alias-brand-primary, #2b7cd9) !important; }
		[data-lgw-card] input[type="range"].lgw-range { -webkit-appearance: none !important; appearance: none !important; width: 100% !important; height: 22px !important; margin: 0 !important; padding: 0 !important; cursor: pointer !important; background: transparent !important; border: 0 !important; }
		[data-lgw-card] input[type="range"].lgw-range::-webkit-slider-runnable-track { height: 5px !important; border-radius: 999px !important; background: linear-gradient(90deg, var(--dsw-alias-brand-primary, #2b7cd9) 0%, var(--dsw-alias-brand-primary, #2b7cd9) var(--lgw-fill, 50%), color-mix(in srgb, var(--dsw-alias-label-tertiary, #9aa4b5) 38%, transparent) var(--lgw-fill, 50%)) !important; }
		[data-lgw-card] input[type="range"].lgw-range::-webkit-slider-thumb { -webkit-appearance: none !important; appearance: none !important; width: 15px !important; height: 15px !important; margin-top: -5px !important; border-radius: 50% !important; background: #fff !important; border: 1px solid rgba(0,0,0,.16) !important; box-shadow: 0 1px 4px rgba(0,0,0,.28) !important; transition: transform .12s !important; }
		[data-lgw-card] input[type="range"].lgw-range:hover::-webkit-slider-thumb { transform: scale(1.12) !important; }
		[data-lgw-card] input[type="range"].lgw-range::-moz-range-track { height: 5px !important; border-radius: 999px !important; background: color-mix(in srgb, var(--dsw-alias-label-tertiary, #9aa4b5) 38%, transparent) !important; }
		[data-lgw-card] input[type="range"].lgw-range::-moz-range-progress { height: 5px !important; border-radius: 999px !important; background: var(--dsw-alias-brand-primary, #2b7cd9) !important; }
		[data-lgw-card] input[type="range"].lgw-range::-moz-range-thumb { width: 14px !important; height: 14px !important; border-radius: 50% !important; background: #fff !important; border: 1px solid rgba(0,0,0,.16) !important; box-shadow: 0 1px 4px rgba(0,0,0,.28) !important; }

		/* chips + buttons */
		[data-lgw-card] .lgw-chips { display: flex !important; gap: 7px !important; flex-wrap: wrap !important; }
		[data-lgw-card] .lgw-chip, [data-lgw-card] .lgw-btn, [data-lgw-card] .lgw-filter {
		  font: inherit !important; font-size: 12px !important; line-height: 1.5 !important;
		  padding: 5px 12px !important; cursor: pointer !important; border-radius: 999px !important;
		  border: 1px solid var(--dsw-alias-border-l2) !important; background: transparent !important;
		  color: var(--dsw-alias-label-secondary) !important; transition: all .14s !important;
		}
		[data-lgw-card] .lgw-btn { border-radius: 8px !important; font-weight: 600 !important; color: var(--dsw-alias-label-primary) !important; }
		[data-lgw-card] .lgw-filter { border-radius: 8px !important; background: var(--dsw-alias-bg-layer-1) !important; }
		[data-lgw-card] .lgw-chip:hover, [data-lgw-card] .lgw-btn:hover, [data-lgw-card] .lgw-filter:hover { border-color: var(--dsw-alias-label-dimmed) !important; color: var(--dsw-alias-label-primary) !important; }
		[data-lgw-card] .lgw-chip[aria-pressed="true"], [data-lgw-card] .lgw-filter[aria-pressed="true"] {
		  border-color: var(--dsw-alias-brand-primary, #2b7cd9) !important;
		  background: var(--dsw-alias-button-primary-dimmed, #e8f1fc) !important;
		  color: var(--dsw-alias-brand-primary, #1e63b8) !important;
		}
		[data-lgw-card] .lgw-btn:disabled { opacity: .5 !important; cursor: default !important; }

		/* library header */
		[data-lgw-card] .lgw-lib-head { display: flex !important; align-items: center !important; gap: 10px !important; flex-wrap: wrap !important; }
		[data-lgw-card] input.lgw-search { margin-left: auto !important; flex: 1 1 170px !important; min-width: 140px !important; height: 32px !important; font: inherit !important; font-size: 12px !important; padding: 0 11px !important; border-radius: 8px !important; border: 1px solid var(--dsw-alias-border-l2) !important; background: var(--dsw-specific-input-major, rgba(0,0,0,.04)) !important; color: var(--dsw-alias-label-primary) !important; outline: none !important; }
		[data-lgw-card] input.lgw-search:focus { border-color: var(--dsw-alias-brand-primary, #2b7cd9) !important; box-shadow: 0 0 0 3px var(--dsw-alias-button-primary-dimmed, rgba(43,124,217,.18)) !important; }
		[data-lgw-card] .lgw-filters { display: flex !important; gap: 6px !important; flex-wrap: wrap !important; }
		[data-lgw-card] .lgw-hint {
		  margin: 0 !important; font-size: 11.5px !important; line-height: 1.55 !important;
		  color: var(--dsw-alias-label-tertiary) !important;
		  padding: 7px 10px !important; border-radius: 8px !important;
		  border: 1px solid var(--dsw-alias-border-l2) !important;
		  background: var(--dsw-alias-bg-layer-1) !important;
		}

		/* the wallpaper grid — the rule a skin is most likely to break */
		[data-lgw-card] .lgw-grid {
		  display: grid !important;
		  grid-template-columns: repeat(auto-fill, minmax(148px, 1fr)) !important;
		  gap: 11px !important;
		  width: 100% !important;
		  margin: 0 !important;
		  padding: 0 !important;
		  list-style: none !important;
		}
		[data-lgw-card] .lgw-tile {
		  display: flex !important; flex-direction: column !important; gap: 7px !important;
		  width: 100% !important; min-width: 0 !important; padding: 7px !important;
		  cursor: pointer !important; text-align: left !important; border-radius: 11px !important;
		  border: 1px solid var(--dsw-alias-border-l2) !important;
		  background: var(--dsw-alias-bg-layer-1) !important;
		  transition: border-color .16s, transform .16s, box-shadow .16s !important;
		}
		[data-lgw-card] .lgw-tile:hover { border-color: var(--dsw-alias-label-dimmed) !important; transform: translateY(-2px) !important; box-shadow: 0 6px 18px rgba(0,0,0,.16) !important; }
		[data-lgw-card] .lgw-tile[aria-pressed="true"] {
		  border-color: var(--dsw-alias-brand-primary, #2b7cd9) !important;
		  background: var(--dsw-alias-button-primary-dimmed, #e8f1fc) !important;
		  box-shadow: 0 0 0 1px var(--dsw-alias-brand-primary, #2b7cd9) inset !important;
		}
		[data-lgw-card] .lgw-thumbwrap {
		  position: relative !important; display: block !important; width: 100% !important;
		  aspect-ratio: 16 / 9 !important; overflow: hidden !important; border-radius: 8px !important;
		  background: var(--dsw-alias-bg-layer-2) !important;
		}
		[data-lgw-card] .lgw-thumbwrap img { width: 100% !important; height: 100% !important; object-fit: cover !important; display: block !important; }
		[data-lgw-card] .lgw-badge-type, [data-lgw-card] .lgw-badge-on {
		  position: absolute !important; top: 6px !important; font-size: 10px !important;
		  line-height: 1 !important; padding: 3px 6px !important; border-radius: 5px !important; color: #fff !important;
		}
		[data-lgw-card] .lgw-badge-type { left: 6px !important; background: rgba(0,0,0,.58) !important; backdrop-filter: blur(6px) !important; }
		[data-lgw-card] .lgw-badge-on { right: 6px !important; border-radius: 999px !important; background: var(--dsw-alias-brand-primary, #2b7cd9) !important; }
		[data-lgw-card] .lgw-tile-name { font-size: 12px !important; line-height: 1.4 !important; color: var(--dsw-alias-label-primary) !important; overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important; }

		@media (prefers-reduced-motion: reduce) {
		  [data-lgw-card] .lgw-tile, [data-lgw-card] .lgw-thumb, [data-lgw-card] .lgw-chip { transition: none !important; }
		}
		`

		function ensureCardStyle() {
		  if (typeof document === 'undefined') return
		  if (document.querySelector(`style[data-plugin-css="${CARD_CSS_ID}"]`) !== null) return
		  const tag = document.createElement('style')
		  tag.dataset.plugin = PLUGIN_ID
		  tag.dataset.pluginCss = CARD_CSS_ID
		  tag.textContent = CARD_CSS
		  document.head.appendChild(tag)
		}


		/** Plugin entry. */
		function __x_apply(ctx) {
		  const bd = getBackdrop()
		  bd.render()
		  // The shell re-renders often; keep its backdrop surfaces transparent while we
		  // are active, and re-apply if it paints new ones.
		  watchShell(() => backdrop)

		  // Diagnostic breadcrumb: proves apply() ran and shows which services the
		  // runtime actually handed over.
		  try {
		    window.__LGW_DIAG__ = {
		      applied: true,
		      hasSlots: Boolean(ctx && ctx.slots),
		      hasLocale: Boolean(ctx && ctx.locale),
		      hasEffect: Boolean(ctx && typeof ctx.effect === 'function'),
		    }
		  } catch {
		    /* diagnostics are best-effort */
		  }

		  // Restore the remembered wallpaper so a reload boots straight into it.
		  //
		  // This is the only restore path at boot: the settings card mounts lazily
		  // (only when Settings is opened), and when it does mount it adopts whatever
		  // `activeId` is current — so there is exactly one inventory fetch per boot
		  // and no race that could clobber a fresh selection.
		  if (bd.state.enabled && bd.state.activeId) {
		    restoreSelection()
		  }

		  if (typeof ctx.effect === 'function') {
		    ctx.effect(() => () => {
		      /* the backdrop is page-lived; it is removed with the document */
		    }, 'liquid-glass-wallpaper: backdrop')
		  }

		  if (!ctx.slots || typeof ctx.slots.register !== 'function') return

		  // Register the copy dictionary the way the first-party sections do, so the
		  // shell resolves the nav label through the same path.
		  if (ctx.locale && typeof ctx.locale.register === 'function') {
		    try {
		      ctx.locale.register('liquidGlassWallpaper', {
		        zh: { title: '液态玻璃壁纸' },
		        en: { title: 'Liquid Glass Wallpaper' },
		      })
		    } catch {
		      /* locale is optional */
		    }
		  }

		  const TITLE = '液态玻璃壁纸'

		  /**
		   * The settings nav projects `label` through `resolveSlotLabel`. Give it a
		   * plain function that always returns a non-empty string, and ALSO publish
		   * the locale dictionary so the shell can resolve either form.
		   */
		  const label = () => TITLE

		  /**
		   * Props the section component receives. The slot contract hands the
		   * component its composed props; we add the plugin context so the card can
		   * reach the backdrop singleton.
		   */
		  const injected = () => ({ lgwCtx: ctx })

		  const section = (props) => Card({ ctx, ...props })

		  const register = () => {
		    try {
		      const disposer = ctx.slots.register(
		        {
		          name: 'settings.section',
		          id: 'liquid-glass-wallpaper',
		          order: 118,
		          label,
		          locale: 'liquidGlassWallpaper',
		          inject: injected,
		        },
		        section,
		      )
		      try {
		        window.__LGW_DIAG__ = { ...(window.__LGW_DIAG__ ?? {}), registered: true, disposerType: typeof disposer }
		      } catch {
		        /* diagnostics are best-effort */
		      }
		      return disposer
		    } catch (error) {
		      try {
		        window.__LGW_DIAG__ = { ...(window.__LGW_DIAG__ ?? {}), registered: false, registerError: String(error) }
		      } catch {
		        /* diagnostics are best-effort */
		      }
		      console.error('[liquid-glass-wallpaper] settings card registration failed:', error)
		      return () => {}
		    }
		  }

		  if (typeof ctx.slots.inject === 'function') {
		    try {
		      ctx.slots.inject('settings.section', register)
		    } catch (error) {
		      console.error('[liquid-glass-wallpaper] settings slot inject failed:', error)
		      try {
		        window.__LGW_DIAG__ = { ...(window.__LGW_DIAG__ ?? {}), injectError: String(error) }
		      } catch {
		        /* diagnostics are best-effort */
		      }
		    }
		  } else {
		    register()
		  }
		}

		exports.name = __x_name;
		exports.inject = __x_inject;
		exports.apply = __x_apply;
		return module.exports;
	}
});
