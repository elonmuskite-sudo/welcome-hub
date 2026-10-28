import { useEffect, useRef, useState } from 'react'
import data from '@emoji-mart/data'
import EmojiMartPicker from '@emoji-mart/react'

const THEME_STORAGE_KEY = 'nexus-theme'

// The picker must follow the app theme, which is applied as a `dark` class on
// <html> and mirrored in localStorage by the shared theme hook.
function readTheme() {
  if (typeof document === 'undefined') return 'light'
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

// emoji-mart ships the latest Unicode emoji set, so search, skin tones and
// rendering stay consistent across platforms instead of relying on per-device
// font glyphs.
export default function EmojiPicker({ onSelect, onClose }) {
  const [theme, setTheme] = useState(readTheme)
  const pickerContainerRef = useRef(null)

  useEffect(() => {
    const sync = () => setTheme(readTheme())
    const onStorage = (event) => { if (event.key === THEME_STORAGE_KEY) sync() }
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose?.() }
    window.addEventListener('storage', onStorage)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  useEffect(() => {
    const container = pickerContainerRef.current
    if (!container) return undefined

    let shadowObserver = null
    const setInputMode = (root) => {
      root.querySelectorAll('input, textarea, [contenteditable="true"]').forEach((input) => {
        if (input.getAttribute('inputmode') !== 'none') input.setAttribute('inputmode', 'none')
      })
    }
    const pickerObserver = new MutationObserver(() => {
      const picker = container.querySelector('em-emoji-picker')
      const shadowRoot = picker?.shadowRoot
      if (!shadowRoot) return
      setInputMode(shadowRoot)
      shadowObserver?.disconnect()
      shadowObserver = new MutationObserver(() => setInputMode(shadowRoot))
      shadowObserver.observe(shadowRoot, { childList: true, subtree: true })
      pickerObserver.disconnect()
    })

    pickerObserver.observe(container, { childList: true, subtree: true })
    const picker = container.querySelector('em-emoji-picker')
    if (picker?.shadowRoot) {
      setInputMode(picker.shadowRoot)
      shadowObserver = new MutationObserver(() => setInputMode(picker.shadowRoot))
      shadowObserver.observe(picker.shadowRoot, { childList: true, subtree: true })
      pickerObserver.disconnect()
    }

    return () => {
      pickerObserver.disconnect()
      shadowObserver?.disconnect()
    }
  }, [])

  return (
    <div ref={pickerContainerRef} className="chat-emoji-picker chat-enter" role="dialog" aria-label="Emoji picker">
      <EmojiMartPicker
        data={data}
        theme={theme}
        locale="en"
        previewPosition="none"
        skinTonePosition="preview"
        navPosition="bottom"
        searchPosition="sticky"
        perLine={8}
        emojiSize={22}
        emojiButtonSize={34}
        onEmojiSelect={(emoji) => { onSelect?.(emoji?.native || emoji?.id || '') }}
      />
    </div>
  )
}
