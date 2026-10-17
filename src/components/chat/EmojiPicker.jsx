import { useEffect, useState } from 'react'
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

  return (
    <div className="chat-emoji-picker chat-enter" role="dialog" aria-label="Emoji picker">
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
