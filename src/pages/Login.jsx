import { useState, useEffect } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { ShieldCheckIcon } from '@heroicons/react/24/solid'
import { Eye, EyeOff } from 'lucide-react'
import { useAuth } from '../lib/AuthContext'
import ChatButton from '../components/chat/ChatButton'
import { startSignInEmailCode } from '../lib/supabase'
import AuthShell from '../components/AuthShell'

export default function Login() {
  const location = useLocation()
  const [mode, setMode] = useState('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { login, user, resendVerificationCode } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (user) {
      navigate(user.role === 'admin' ? '/admin' : '/app', { replace: true })
    }
  }, [user, navigate])

  const themeClasses = { muted: 'text-muted-foreground', input: 'border-input bg-background text-foreground focus:border-primary focus:ring-primary', button: 'bg-primary text-primary-foreground hover:bg-primary/90' }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      if (mode === 'code') {
        await startSignInEmailCode(email)
        sessionStorage.setItem('nexus-pending-verification-email', email.trim().toLowerCase())
        sessionStorage.setItem('nexus-pending-verification-purpose', 'email')
        navigate('/verify-email', { state: { email: email.trim().toLowerCase(), purpose: 'email' } })
        return
      }
      const result = await login(email, password)
      const destination = result?.user?.role === 'admin' ? '/admin' : '/app'
      navigate(destination)
    } catch (err) {
      const pendingEmail = email.trim().toLowerCase()
      const unconfirmed = err?.code === 'email_not_confirmed' || /not confirmed/i.test(err.message || '')
      if (unconfirmed) {
        try {
          sessionStorage.setItem('nexus-pending-verification-email', pendingEmail)
          sessionStorage.setItem('nexus-pending-verification-purpose', 'signup')
        } catch {
          // Route state still carries the address for this verification visit.
        }
        let notice = 'Enter the verification code sent to your email.'
        try {
          await resendVerificationCode(pendingEmail, 'signup')
        } catch (resendError) {
          notice = resendError.message || notice
        }
        navigate('/verify-email', {
          replace: true,
          state: { email: pendingEmail, purpose: 'signup', notice },
        })
        return
      }
      setError(err.message || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell
      title="Welcome back to Nexus"
      subtitle="Sign in using the email address associated with your Nexus account."
      compact
    >
      <div className="w-full">
          {location.state?.notice && <p role="status" className="mb-5 text-sm text-primary">{location.state.notice}</p>}
          <div className="mb-6 grid grid-cols-2 gap-2 border-b border-border pb-3">
            <ChatButton onClick={() => setMode('password')} variant={mode === 'password' ? 'primary' : 'ghost'} className="px-3 py-2">Password</ChatButton>
            <ChatButton onClick={() => setMode('code')} variant={mode === 'code' ? 'primary' : 'ghost'} className="px-3 py-2">Email code</ChatButton>
          </div>
          <form onSubmit={handleSubmit} className="mt-6 space-y-5">
            <div>
              <label htmlFor="email" className={`mb-2 block text-sm font-medium ${themeClasses.muted}`}>Email address</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                className={`w-full rounded-lg border px-4 py-3 text-sm outline-none ring-0 transition ${themeClasses.input}`}
                placeholder="you@example.com"
              />
            </div>
            {mode === 'password' && <div>
              <label htmlFor="password" className={`mb-2 block text-sm font-medium ${themeClasses.muted}`}>Password</label>
              <div className="relative">
                <input
                  id="password"
                  type={passwordVisible ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className={`w-full rounded-lg border px-4 py-3 pr-12 text-sm outline-none transition ${themeClasses.input}`}
                  placeholder="••••••••"
                />
                <ChatButton
                  type="button"
                  onClick={() => setPasswordVisible((visible) => !visible)}
                  aria-label={passwordVisible ? 'Hide password' : 'Show password'}
                  aria-pressed={passwordVisible}
                  title={passwordVisible ? 'Hide password' : 'Show password'}
                  className={`absolute inset-y-0 right-0 flex w-12 items-center justify-center ${themeClasses.muted}`}
                >
                  {passwordVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </ChatButton>
              </div>
            </div>}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <ChatButton
              type="submit"
              disabled={loading}
              className={`w-full rounded-lg px-4 py-3 text-sm font-semibold transition disabled:cursor-not-allowed ${themeClasses.button} disabled:opacity-50`}
            >
              {loading ? 'Please wait...' : mode === 'code' ? 'Send sign-in code' : 'Sign in'}
            </ChatButton>
          </form>

          <div className="mt-6 text-center space-y-2">
            <Link to="/forgot-password" className="text-sm text-primary hover:underline">
              Forgot password?
            </Link>
            <p className="text-sm text-muted-foreground">
              New here?{' '}
              <Link to="/register" className="font-semibold text-primary hover:underline">
                Create account
              </Link>
            </p>
          </div>
      </div>
    </AuthShell>
  )
}
