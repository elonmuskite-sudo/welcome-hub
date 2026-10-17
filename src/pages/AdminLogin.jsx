import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ShieldCheckIcon } from '@heroicons/react/24/solid'
import { Eye, EyeOff } from 'lucide-react'
import { useAuth } from '../lib/AuthContext'
import ChatButton from '../components/chat/ChatButton'
import AuthShell from '../components/AuthShell'
import { establishAdminSession } from '../lib/adminSession'

const MAX_EMAIL_LENGTH = 254
const MIN_PASSWORD_LENGTH = 8
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

// Where to go after a successful admin sign-in. Only same-admin paths are
// honoured so the query parameter cannot be used as an open redirect.
function resolveNext(search, fallbackState) {
  const requested = new URLSearchParams(search).get('next') || fallbackState || ''
  if (requested.startsWith('/admin/') && !requested.startsWith('/admin/login')) return requested
  return '/admin/dashboard'
}

// Dedicated admin sign-in. Reachable without a session (it is the only /admin
// route middleware.js allows through); every other admin path is gated.
export default function AdminLogin() {
  const { login, user, loading, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const next = resolveNext(location.search, location.state?.from)
  const signedInNonAdmin = Boolean(user) && user.role !== 'admin'

  useEffect(() => {
    if (loading || !user || user.role !== 'admin') return
    let active = true
    const complete = async () => {
      await establishAdminSession()
      if (active) navigate(next, { replace: true })
    }
    complete()
    return () => { active = false }
  }, [loading, user, next, navigate])

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (busy) return

    const normalizedEmail = email.trim().toLowerCase()
    if (!EMAIL_PATTERN.test(normalizedEmail) || normalizedEmail.length > MAX_EMAIL_LENGTH) {
      setError('Enter a valid email address.')
      return
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Admin passwords are at least ${MIN_PASSWORD_LENGTH} characters long.`)
      return
    }

    setError('')
    setBusy(true)
    try {
      const result = await login(normalizedEmail, password)
      if (result?.user?.role !== 'admin') {
        setError('This account does not have admin access.')
        return
      }
      const established = await establishAdminSession()
      if (!established) {
        console.warn('[admin] The server admin session cookie could not be established. Direct visits to /admin will ask you to sign in again.')
      }
      navigate(next, { replace: true })
    } catch (loginError) {
      setError(loginError?.message || 'Admin sign in failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell
      title="Admin sign in"
      subtitle="This area is restricted to Nexus administrators. All access is verified against the server."
      compact
    >
      <div className="w-full">
        {signedInNonAdmin ? (
          <div className="space-y-4">
            <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              You are signed in as {user.email}, which does not have admin access.
            </p>
            <div className="flex flex-wrap gap-2">
              <ChatButton
                onClick={async () => { await logout(); setError('') }}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
              >
                Sign in as an administrator
              </ChatButton>
              <ChatButton onClick={() => navigate('/app')} className="rounded-lg border border-border px-4 py-2 text-sm">
                Back to Nexus
              </ChatButton>
            </div>
          </div>
        ) : (
          <>
            <p className="mb-5 flex items-center gap-2 text-sm text-muted-foreground">
              <ShieldCheckIcon className="h-5 w-5 text-primary" /> Administrator credentials required.
            </p>
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label htmlFor="admin-email" className="mb-2 block text-sm font-medium text-muted-foreground">Email address</label>
                <input
                  id="admin-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  maxLength={MAX_EMAIL_LENGTH}
                  required
                  className="w-full rounded-lg border border-input bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-primary"
                  placeholder="admin@nexus-chat-world.com"
                />
              </div>
              <div>
                <label htmlFor="admin-password" className="mb-2 block text-sm font-medium text-muted-foreground">Password</label>
                <div className="relative">
                  <input
                    id="admin-password"
                    type={passwordVisible ? 'text' : 'password'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    autoComplete="current-password"
                    className="w-full rounded-lg border border-input bg-background px-4 py-3 pr-12 text-sm text-foreground outline-none transition focus:border-primary focus:ring-primary"
                    placeholder="••••••••"
                  />
                  <ChatButton
                    type="button"
                    onClick={() => setPasswordVisible((visible) => !visible)}
                    aria-label={passwordVisible ? 'Hide password' : 'Show password'}
                    aria-pressed={passwordVisible}
                    className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-muted-foreground"
                  >
                    {passwordVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </ChatButton>
                </div>
              </div>
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <ChatButton
                type="submit"
                disabled={busy || loading}
                className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? 'Verifying…' : 'Sign in to admin'}
              </ChatButton>
            </form>
          </>
        )}
      </div>
    </AuthShell>
  )
}
