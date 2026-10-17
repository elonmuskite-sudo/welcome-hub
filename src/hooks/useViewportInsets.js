import { useEffect } from 'react'

// Pixels below this are treated as browser chrome jitter (mobile URL bar
// show/hide shifts innerHeight slightly) rather than an on-screen keyboard.
const KEYBOARD_MIN_INSET = 24
// Android resizes the layout viewport instead of overlaying it, so there the
// keyboard shows up as the viewport shrinking relative to the tallest
// keyboard-free height seen for the current orientation.
const KEYBOARD_MIN_SHRINK = 140
const MOBILE_MAX_WIDTH = 767
const NAV_SELECTOR = '[data-chat-bottom-nav]'
const GAP = 8

function readViewport() {
  if (typeof window === 'undefined') return { height: 0, inset: 0 }
  const viewport = window.visualViewport
  const innerHeight = window.innerHeight
  if (!viewport) return { height: innerHeight, inset: 0 }
  // Pinch-zoom shrinks the visual viewport too; only trust it at 1x so a zoomed
  // page never collapses the app shell.
  const height = viewport.scale > 1.01 ? innerHeight : viewport.height
  // iOS keeps window.innerHeight when the keyboard opens while the visual
  // viewport shrinks; offsetTop covers the visual-viewport scroll iOS applies to
  // reveal a focused field.
  const inset = innerHeight - viewport.height - viewport.offsetTop
  return { height, inset: inset > KEYBOARD_MIN_INSET ? inset : 0 }
}

/**
 * Keeps the chat shell in sync with the real, on-device viewport:
 *  - `--vv-height`          visible viewport height; the mobile app shell height
 *                           so the composer can never leave the screen
 *  - `--keyboard-inset`     pixels obscured by the on-screen keyboard
 *  - `--bottom-nav-height`  measured height of the mobile bottom navigation
 *  - `--chat-bottom-offset` space the composer reserves at the bottom: the nav
 *                           height + 8px when the keyboard is closed, or a
 *                           single 8px gap when the shell already ends at the
 *                           keyboard
 *
 * Also toggles the `keyboard-open` class on <html> while the keyboard is up, so
 * the mobile bottom navigation can step aside for the composer.
 *
 * Reacts to visualViewport resize/scroll (keyboard show/hide), orientation
 * changes, and the bottom navigation resizing.
 */
export function useViewportInsets() {
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return
    const root = document.documentElement
    const viewport = window.visualViewport
    let navHeight = 0
    let frame = 0
    let baselineHeight = 0
    let baselineWidth = 0

    const write = () => {
      frame = 0
      const { height, inset } = readViewport()
      const width = window.innerWidth
      // A different width means a rotation or window resize: the old height is
      // no longer a valid keyboard-free baseline.
      if (width !== baselineWidth) {
        baselineWidth = width
        baselineHeight = height
      }
      if (height > baselineHeight) baselineHeight = height
      const keyboardOpen = inset > 0 || (width <= MOBILE_MAX_WIDTH && baselineHeight - height > KEYBOARD_MIN_SHRINK)
      // While typing the shell already ends at the keyboard, so the composer
      // only needs the 8px rhythm; the bottom nav is hidden for the same reason.
      const offset = keyboardOpen ? GAP : navHeight + GAP
      root.style.setProperty('--vv-height', `${Math.round(height)}px`)
      root.style.setProperty('--bottom-nav-height', `${Math.round(navHeight)}px`)
      root.style.setProperty('--keyboard-inset', `${Math.round(inset)}px`)
      root.style.setProperty('--chat-bottom-offset', `${Math.round(offset)}px`)
      root.classList.toggle('keyboard-open', keyboardOpen)
    }

    const schedule = () => {
      if (frame) return
      frame = window.requestAnimationFrame(write)
    }

    const nav = document.querySelector(NAV_SELECTOR)
    let observer = null
    if (nav) {
      navHeight = nav.getBoundingClientRect().height
      if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver((entries) => {
          // The nav is hidden while typing, which reports a 0 height; keep the
          // last real measurement so the closed-keyboard offset stays correct.
          const measured = entries[0]?.contentRect?.height ?? 0
          if (measured > 0) navHeight = measured
          schedule()
        })
        observer.observe(nav)
      }
    }

    write()

    viewport?.addEventListener('resize', schedule)
    viewport?.addEventListener('scroll', schedule)
    window.addEventListener('resize', schedule)
    window.addEventListener('orientationchange', schedule)

    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      observer?.disconnect()
      viewport?.removeEventListener('resize', schedule)
      viewport?.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('orientationchange', schedule)
      root.classList.remove('keyboard-open')
    }
  }, [])
}
