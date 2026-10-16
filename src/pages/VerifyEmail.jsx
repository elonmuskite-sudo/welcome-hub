import ChatButton from '../components/chat/ChatButton'
import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import AuthShell from '../components/AuthShell'
import { useAuth } from '../lib/AuthContext'
import { completeAppwriteVerification } from '../lib/appwrite'

const PENDING_EMAIL_KEY = 'nexus-pending-verification-email'
const PENDING_PURPOSE_KEY = 'nexus-pending-verification-purpose'

function getPendingEmail() {
  try {
    return sessionStorage.getItem(PENDING_EMAIL_KEY) || ''
  } catch {
    return ''
  }
}

function getPendingPurpose() {
  try {
    return sessionStorage.getItem(PENDING_PURPOSE_KEY) || 'signup'
  } catch {
    return 'signup'
  }
}

function clearPendingEmail() {
  try {
    sessionStorage.removeItem(PENDING_EMAIL_KEY)
  } catch {
    // Verification succeeded; session storage is optional.
  }
}

export default function VerifyEmail() {
  const location = useLocation()
  const navigate = useNavigate()
  const { verifyEmailCode, resendVerificationCode } = useAuth()
  const appwriteProvider = new URLSearchParams(location.search).get('provider') === 'appwrite'
  const [email] = useState(() => location.state?.email || getPendingEmail())
  const [purpose] = useState(() => location.state?.purpose || new URLSearchParams(location.search).get('purpose') || getPendingPurpose())
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState(location.state?.notice || '')
  const [verifying, setVerifying] = useState(false)
  const [resending, setResending] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)

  useEffect(() => {
    if (!resendCooldown) return undefined
    const timer = window.setTimeout(() => {
      setResendCooldown((seconds) => Math.max(0, seconds - 1))
    }, 1000)
    return () => window.clearTimeout(timer)
  }, [resendCooldown])

  useEffect(() => {
    if (!appwriteProvider) return
    const params = new URLSearchParams(location.search)
    const userId = params.get('userId')
    const secret = params.get('secret')
    if (!userId || !secret) return

    let active = true
    setVerifying(true)
    completeAppwriteVerification(userId, secret)
      .then(() => {
        clearPendingEmail()
        try {
          sessionStorage.removeItem(PENDING_PURPOSE_KEY)
          sessionStorage.removeItem('nexus-pending-verification-password')
        } catch {
          // Verification succeeded; session storage is optional.
        }
        navigate('/login', { replace: true, state: { notice: 'Your email is verified. You can now sign in.' } })
      })
      .catch((verifyError) => {
        if (active) setError(verifyError.message || 'Could not verify this email link. Request a new one and try again.')
      })
      .finally(() => { if (active) setVerifying(false) })
    return () => { active = false }
  }, [appwriteProvider, location.search, navigate])

  const handleVerify = async (event) => {
    event.preventDefault()
    setError('')
    if (!/^\d{4,8}$/.test(code)) {
      setError('Enter the code from your email.')
      return
    }

    setVerifying(true)
    try {
      await verifyEmailCode(email, code, purpose)
      clearPendingEmail()
      try {
        sessionStorage.removeItem(PENDING_PURPOSE_KEY)
        sessionStorage.removeItem('nexus-pending-verification-password')
      } catch {
        // Verification succeeded; session storage is optional.
      }
      navigate(purpose === 'recovery' ? '/reset-password' : '/app', { replace: true })
    } catch (verifyError) {
      setError(verifyError.message || 'Could not verify this code. Request a new one and try again.')
    } finally {
      setVerifying(false)
    }
  }

  const handleResend = async () => {
    setError('')
    setResending(true)
    try {
      await resendVerificationCode(email, purpose)
      setResendCooldown(60)
      setMessage('A new verification code has been sent.')
    } catch (resendError) {
      setError(resendError.message || 'Could not resend the verification code.')
    } finally {
      setResending(false)
    }
  }

  if (appwriteProvider) {
    return (
      <AuthShell title="Verify your email" subtitle="Open the verification link Appwrite sent to your inbox." compact>
        <div className="mx-auto w-full max-w-md text-foreground">
          {verifying && <p role="status" className="text-sm text-muted-foreground">Verifying your email...</p>}
          {!verifying && !error && (
            <>
              <p className="text-sm text-muted-foreground">
                {email ? `A verification link was sent to ${email}.` : 'Check your inbox for the verification link.'}
              </p>
              {message && <p role="status" className="mt-3 text-sm text-primary">{message}</p>}
              <ChatButton
                type="button"
                onClick={handleResend}
                disabled={resending || resendCooldown > 0}
                className="mt-5 w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              >
                {resending ? 'Sending...' : resendCooldown ? `Resend in ${resendCooldown}s` : 'Resend verification link'}
              </ChatButton>
            </>
          )}
          {error && (
            <>
              <p role="alert" className="text-sm text-destructive">{error}</p>
              <ChatButton
                type="button"
                onClick={handleResend}
                disabled={resending || resendCooldown > 0}
                className="mt-5 w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              >
                {resending ? 'Sending...' : 'Request a new verification link'}
              </ChatButton>
            </>
          )}
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Verify your email"
      subtitle={email
        ? `${purpose === 'recovery' ? 'Enter the password recovery code sent to' : purpose === 'email' ? 'Enter the sign-in code sent to' : 'Enter the verification code sent to'} ${email}.`
        : 'Complete registration or password recovery to request a code.'}
      compact
    >
      {email ? (
        <div className="mx-auto w-full max-w-md text-foreground">
          <form onSubmit={handleVerify} className="space-y-5">
            <div>
              <label htmlFor="verification-code" className="mb-2 block text-sm font-medium">Verification code</label>
              <input
                id="verification-code"
                type="text"
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 8))}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{4,8}"
                minLength={4}
                maxLength={8}
                required
                autoFocus
                className="w-full rounded-xl border border-input bg-background px-4 py-3 text-center text-2xl font-semibold tracking-normal text-foreground outline-none focus:ring-2 focus:ring-ring"
                aria-describedby="verification-code-help"
              />
              <p id="verification-code-help" className="mt-2 text-sm text-muted-foreground">
                Codes are valid for a limited time.
              </p>
            </div>

            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            {message && <p role="status" className="text-sm text-primary">{message}</p>}

            <ChatButton
              type="submit"
              disabled={verifying || code.length < 4}
              className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {verifying ? 'Verifying...' : purpose === 'recovery' ? 'Verify recovery code' : purpose === 'email' ? 'Verify sign-in code' : 'Verify email'}
            </ChatButton>
          </form>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">Didn’t receive the code?</span>
            <ChatButton
              type="button"
              onClick={handleResend}
              disabled={resending || resendCooldown > 0}
              className="font-medium text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-50"
            >
              {resending ? 'Sending...' : resendCooldown ? `Resend in ${resendCooldown}s` : 'Resend code'}
            </ChatButton>
          </div>
        </div>
      ) : (
        <div className="mx-auto w-full max-w-md rounded-2xl border border-border bg-card p-6 text-center text-card-foreground shadow-sm">
          <p className="text-sm text-muted-foreground">Your verification email is not available in this browser session.</p>
          <Link to="/register" className="mt-4 inline-block font-medium text-primary hover:underline">
            Return to registration
          </Link>
        </div>
      )}
    </AuthShell>
  )
}