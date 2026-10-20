import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'

const SettingsContext = createContext()

function hexToHsl(hex) {
  const m = typeof hex === 'string' && hex.match(/^#([0-9a-f]{6})$/i)
  if (!m) return null
  const n = parseInt(m[1], 16)
  const r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2
  let h = 0, s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    h *= 60
  }
  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`
}

function readFromStorage(key, defaultValue) {
  if (typeof window === 'undefined') return defaultValue
  try {
    const stored = window.localStorage.getItem(key)
    return stored !== null ? JSON.parse(stored) : defaultValue
  } catch {
    return defaultValue
  }
}

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(() => ({
    chatWallpaper: readFromStorage('chatWallpaper', 'nature'),
    notificationSound: readFromStorage('notificationSound', true),
    notificationTone: readFromStorage('notificationTone', 'chime'),
    notificationVolume: readFromStorage('notificationVolume', 0.5),
    badgeBlue: readFromStorage('badgeBlue', null),
    badgeGold: readFromStorage('badgeGold', null),
    readReceipts: readFromStorage('readReceipts', true),
  }))

  useEffect(() => {
    const root = document.documentElement
    for (const [key, cssVar] of [['badgeBlue', '--badge-blue'], ['badgeGold', '--badge-gold']]) {
      const hsl = hexToHsl(settings[key])
      if (hsl) root.style.setProperty(cssVar, hsl)
      else root.style.removeProperty(cssVar)
    }
  }, [settings.badgeBlue, settings.badgeGold])

  useEffect(() => {
    const entries = Object.entries(settings)
    for (const [key, value] of entries) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value))
      } catch {
        // Storage may be unavailable (private mode / quota); settings stay in memory.
      }
    }
  }, [settings])

  const setSetting = useCallback((key, value) => {
    setSettings((prev) => {
      const next = typeof value === 'function' ? value(prev[key]) : value
      if (prev[key] === next) return prev
      return { ...prev, [key]: next }
    })
  }, [])

  const getSetting = useCallback((key, defaultValue) => {
    const current = settings[key]
    return current !== undefined ? current : defaultValue
  }, [settings])

  const value = useMemo(() => ({
    settings,
    setSetting,
    getSetting,
  }), [settings, setSetting, getSetting])

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings() {
  const ctx = useContext(SettingsContext)
  if (!ctx) {
    throw new Error('useSettings must be used within SettingsProvider')
  }
  return ctx
}

export function useSetting(key, defaultValue) {
  const { settings, setSetting } = useSettings()
  const value = settings[key] !== undefined ? settings[key] : defaultValue

  const setValue = useCallback((v) => {
    setSetting(key, v)
  }, [key, setSetting])

  return [value, setValue]
}
