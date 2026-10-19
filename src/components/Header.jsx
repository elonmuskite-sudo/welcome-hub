import { SunIcon, MoonIcon } from '@heroicons/react/24/solid'
import { Link, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useTheme } from '../hooks/useTheme'
import { useAuth } from '../lib/AuthContext'
import Avatar from './chat/Avatar'

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

export default function Header({ showSignIn = true, children }) {
  const { theme, toggleTheme } = useTheme()
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [logoStyle, setLogoStyle] = useState('brand-float')
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)

  useEffect(() => {
    // pick a random logo animation/style on load
    const styles = ['brand-float', 'brand-spin', 'brand-wiggle', 'brand-pulse']
    setLogoStyle(randomChoice(styles))
  }, [])

  // preserve capability to detect Capacitor/native platform without importing
  const isNative = typeof window !== 'undefined' && window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform()

  return (
    <header className="sticky top-0 z-50 mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3 border-b border-border bg-card/80 text-foreground shadow-[0_18px_50px_rgba(15,23,42,0.10)] backdrop-blur-xl px-4 py-4 transition-all sm:px-6 lg:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <div className="brand-badge flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-[18px] bg-gradient-to-br from-sky-500 via-cyan-400 to-blue-600 p-1 shadow-[0_18px_45px_rgba(59,130,246,0.30)]">
          <div className={`flex h-full w-full items-center justify-center rounded-[14px] bg-slate-950/90 shadow-[inset_0_1px_15px_rgba(255,255,255,0.18)] ${logoStyle}`}>
            <img src="/logo.png" alt="Nexus logo" className="h-8 w-8 rounded-lg object-contain" />
          </div>
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-foreground">Nexus</p>
          <h1 className="truncate text-sm font-semibold sm:text-base">Privacy-first encrypted messaging</h1>
        </div>
      </div>

      {children}

      <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
        <button
          onClick={toggleTheme}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-muted text-foreground hover:bg-muted/80 transition animate-in fade-in duration-200"
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? <SunIcon className="h-4 w-4" /> : <MoonIcon className="h-4 w-4" />}
        </button>
        {user ? (
          <div className="relative">
            <button
              onClick={() => setProfileMenuOpen((open) => !open)}
              className="flex items-center gap-2 hover:opacity-85 transition active:scale-95 duration-200"
              title="Profile menu"
              aria-haspopup="menu"
              aria-expanded={profileMenuOpen}
            >
              <Avatar src={user.avatarUrl} alt={user.fullName || 'User'} size="sm" />
            </button>
            {profileMenuOpen && (
              <div role="menu" className="absolute right-0 top-full mt-2 w-48 rounded-xl border border-border bg-card shadow-lg overflow-hidden z-50">
                <Link
                  to="/app/settings/profile"
                  onClick={() => setProfileMenuOpen(false)}
                  className="block px-4 py-2.5 text-sm text-foreground hover:bg-muted transition"
                  role="menuitem"
                >
                  Profile settings
                </Link>
                <button
                  onClick={async () => { setProfileMenuOpen(false); await logout(); navigate('/login', { replace: true }) }}
                  className="w-full text-left px-4 py-2.5 text-sm font-medium text-destructive hover:bg-destructive/10 transition"
                  role="menuitem"
                >
                  Log out
                </button>
              </div>
            )}
          </div>
        ) : (
          !isNative && showSignIn && (
            <Link to="/login" className="rounded-full bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition sm:px-4">
              Sign in
            </Link>
          )
        )}
      </div>
    </header>
  )
}
