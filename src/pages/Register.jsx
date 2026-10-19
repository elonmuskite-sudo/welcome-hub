import ChatButton from '../components/chat/ChatButton'
import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import { useAuth } from '../lib/AuthContext'
import AuthShell from '../components/AuthShell'

export default function Register() {
  const [email, setEmail] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [password, setPassword] = useState('')
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [error, setError] = useState('')
  const [existingAccount, setExistingAccount] = useState(false)
  const [loading, setLoading] = useState(false)
  const { register, user } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (user) {
      navigate('/app', { replace: true })
    }
  }, [user, navigate])

  const themeClasses = { muted: 'text-muted-foreground', input: 'border-input bg-background text-foreground focus:border-primary focus:ring-primary', button: 'bg-primary text-primary-foreground hover:bg-primary/90' }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setExistingAccount(false)
    setLoading(true)

    try {
      const result = await register({ email, firstName, lastName, password })
      if (result.needsEmailConfirmation) {
        try {
          sessionStorage.setItem('nexus-pending-verification-email', result.email)
          sessionStorage.setItem('nexus-pending-verification-purpose', 'signup')
          sessionStorage.removeItem('nexus-pending-verification-password')
        } catch {
          // Route state still carries the address for this verification visit.
        }
        navigate('/verify-email', {
          replace: true,
          state: { email: result.email, purpose: 'signup' },
        })
      } else {
        navigate('/app', { replace: true })
      }
    } catch (err) {
      if (err.verificationPending) {
        const pendingEmail = email.trim().toLowerCase()
        try {
          sessionStorage.setItem('nexus-pending-verification-email', pendingEmail)
          sessionStorage.setItem('nexus-pending-verification-purpose', 'signup')
          sessionStorage.removeItem('nexus-pending-verification-password')
        } catch {
          // Route state carries the address for this visit.
        }
        navigate('/verify-email', {
          replace: true,
          state: {
            email: pendingEmail,
            purpose: 'signup',
            notice: 'Your account was created, but email delivery failed. Wait briefly, then request another verification message.',
          },
        })
        return
      }
      setExistingAccount(err.code === 'email_already_registered')
      setError(err.message || 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell
      title="Create your secure Nexus account"
      subtitle="Register with your email address. We’ll email a one-time code to verify your account."
      compact
    >
      <div className="w-full">
          <form onSubmit={handleSubmit} className="mt-6 space-y-5">
            <div>
              <label htmlFor="email" className={`mb-2 block text-sm font-medium ${themeClasses.muted}`}>Email address</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className={`w-full rounded-lg border px-4 py-3 text-sm outline-none transition ${themeClasses.input}`}
                placeholder="you@example.com"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={`mb-2 block text-sm font-medium ${themeClasses.muted}`}>First name</label>
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                  className={`w-full rounded-lg border px-4 py-3 text-sm outline-none transition ${themeClasses.input}`}
                  placeholder="Ava"
                />
              </div>
              <div>
                <label className={`mb-2 block text-sm font-medium ${themeClasses.muted}`}>Last name</label>
                <input
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  required
                  className={`w-full rounded-lg border px-4 py-3 text-sm outline-none transition ${themeClasses.input}`}
                  placeholder="Stone"
                />
              </div>
            </div>
            <div>
              <label htmlFor="password" className={`mb-2 block text-sm font-medium ${themeClasses.muted}`}>Password</label>
              <div className="relative">
                <input
                  id="password"
                  type={passwordVisible ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  className={`w-full rounded-lg border px-4 py-3 pr-12 text-sm outline-none transition ${themeClasses.input}`}
                  placeholder="Your password"
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
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
                {existingAccount && (
                  <>
                    {' '}
                    <Link
                      to="/login"
                      state={{ email: email.trim().toLowerCase() }}
                      className="font-semibold text-primary hover:underline"
                    >
                      Sign in instead
                    </Link>
                  </>
                )}
              </p>
            )}
            <ChatButton
              type="submit"
              disabled={loading}
              className={`w-full rounded-lg px-4 py-3 text-sm font-semibold transition disabled:cursor-not-allowed ${themeClasses.button} disabled:opacity-50`}
            >
              {loading ? 'Creating account...' : 'Create account'}
            </ChatButton>
          </form>
          <p className="mt-6 text-center text-sm text-muted-foreground">
            Already a member?{' '}
            <Link to="/login" className="font-semibold text-primary hover:underline">
              Sign in
            </Link>
          </p>
      </div>
    </AuthShell>
  )
}
