import { useEffect } from 'react'

// Pixels below this are treated as browser chrome jitter (mobile URL bar
// show/hide shifts innerHeight slightly) rather than an on-screen keyboard.
const KEYBOARD_MIN_INSET = 24
const NAV_SELECTOR = '[data-chat-bottom-nav]'
const GAP = 8

function readKeyboardInset() {
  const viewport = window.visualViewport
  if (!viewport) return 0
  const inset = window.innerHeight - viewport.height - viewport.offsetTop
  return inset > KEYBOARD_MIN_INSET ? inset : 0
}

/**
 * Keeps the chat shell in sync with the real, on-device viewport:
 *  - `--keyboard-inset`      pixels obscured by the on-screen keyboard
 *  - `--bottom-nav-height`   measured height of the mobile bottom navigation
 *  - `--chat-bottom-offset`  safe bottom offset for the chat composer
 *    (max(nav height + 8px, keyboard inset) so the composer is never covered)
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

    const write = () => {
      frame = 0
      const keyboardInset = readKeyboardInset()
      const offset = Math.max(navHeight + GAP, keyboardInset)
      root.style.setProperty('--bottom-nav-height', `${Math.round(navHeight)}px`)
      root.style.setProperty('--keyboard-inset', `${Math.round(keyboardInset)}px`)
      root.style.setProperty('--chat-bottom-offset', `${Math.round(offset)}px`)
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
          navHeight = entries[0]?.contentRect?.height ?? nav.getBoundingClientRect().height
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
