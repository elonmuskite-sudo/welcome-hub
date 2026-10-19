import ChatButton from '../components/chat/ChatButton'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import AuthShell from '../components/AuthShell'
import { useAuth } from '../lib/AuthContext'

export default function ResetPassword() {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [confirmPasswordVisible, setConfirmPasswordVisible] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const { resetPassword } = useAuth()

  const themeClasses = { muted: 'text-muted-foreground', input: 'border-input bg-background text-foreground focus:border-primary focus:ring-primary', button: 'bg-primary text-primary-foreground hover:bg-primary/90' }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setLoading(true)

    try {
      const result = await resetPassword(password)
      if (!result.ok) {
        throw new Error('Password reset failed.')
      }
      navigate('/login', { replace: true })
    } catch (err) {
      setError(err.message || 'Failed to reset password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell title="Reset your password" subtitle="Choose a new password for your Nexus account and continue securely." compact>
      <div className="mx-auto w-full max-w-md">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className={`mb-2 block text-sm font-medium ${themeClasses.muted}`}>
              New Password
            </label>
            <div className="relative">
              <input
                id="password"
                  type={passwordVisible ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="new-password"
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
          </div>
          <div>
            <label className={`mb-2 block text-sm font-medium ${themeClasses.muted}`}>
              Confirm New Password
            </label>
            <div className="relative">
              <input
                type={confirmPasswordVisible ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
                className={`w-full rounded-lg border px-4 py-3 pr-12 text-sm outline-none transition ${themeClasses.input}`}
                placeholder="••••••••"
              />
              <ChatButton
                type="button"
                onClick={() => setConfirmPasswordVisible((visible) => !visible)}
                aria-label={confirmPasswordVisible ? 'Hide password' : 'Show password'}
                aria-pressed={confirmPasswordVisible}
                title={confirmPasswordVisible ? 'Hide password' : 'Show password'}
                className={`absolute inset-y-0 right-0 flex w-12 items-center justify-center ${themeClasses.muted}`}
              >
                {confirmPasswordVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </ChatButton>
            </div>
          </div>
          {error && <p className="text-center text-sm text-destructive">{error}</p>}
          <ChatButton
            type="submit"
            disabled={loading}
            className={`w-full rounded-lg px-4 py-3 font-semibold transition-colors disabled:cursor-not-allowed ${themeClasses.button} disabled:opacity-50`}
          >
            {loading ? 'Resetting...' : 'Reset Password'}
          </ChatButton>
        </form>
        <p className={`mt-6 text-center text-sm ${themeClasses.muted}`}>
            Remember your password?{' '}
            <Link to="/login" className="font-medium text-primary hover:underline">
              Log in
            </Link>
          </p>
      </div>
    </AuthShell>
  )
}
