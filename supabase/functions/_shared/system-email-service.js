import { identityReviewEmail, securityAlertEmail } from './system-email.js'
import { hasSmsConsent, identityReviewSms, securityAlertSms } from './system-sms.js'

const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i

function result(status, body) {
  return { status, body }
}

export function createSystemEmailService({ adminClientFactory, emailSender, smsSender }) {
  return async function sendSystemNotification({ url, serviceRoleKey, token, action, verificationId }) {
    if (!url || !serviceRoleKey) {
      return result(503, { error: 'System email delivery is not configured on the server.' })
    }
    if (!['security-alert', 'identity-review'].includes(action)) {
      return result(400, { error: 'Invalid system email action.' })
    }
    if (action === 'identity-review' && !UUID_PATTERN.test(String(verificationId || ''))) {
      return result(400, { error: 'A valid identity verification ID is required.' })
    }
    if (!token || token.length > 8192) return result(401, { error: 'Sign in required.' })

    const admin = adminClientFactory(url, serviceRoleKey)
    const { data: userData, error: userError } = await admin.auth.getUser(token)
    if (userError || !userData?.user || !userData.user.email_confirmed_at) {
      return result(401, { error: 'A verified account session is required.' })
    }
    const { data: claimsData, error: claimsError } = await admin.auth.getClaims(token)
    if (claimsError || claimsData?.claims?.sub !== userData.user.id) {
      return result(401, { error: 'A valid account session is required.' })
    }

    const user = userData.user
    if (action === 'security-alert') {
      const sessionId = String(claimsData.claims.session_id || '')
      if (!sessionId || sessionId.length > 128 || !user.email) {
        return result(401, { error: 'A verified account session is required.' })
      }
      const { data: isAdmin, error: roleError } = await admin.rpc('has_role', {
        _user_id: user.id,
        _role: 'admin',
      })
      if (roleError) {
        console.error('System email role check failed', roleError)
        return result(503, { error: 'The account role could not be verified.' })
      }
      if (isAdmin && claimsData.claims.aal !== 'aal2') {
        return result(403, { error: 'Administrator multi-factor authentication is required.' })
      }
      const bucketKey = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(`security-alert:${user.id}`),
      ).then((digest) => Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(''))
      const { data: allowed, error: limitError } = await admin.rpc('consume_auth_email_code_limit', {
        p_bucket_key: bucketKey,
        p_window_seconds: 3600,
        p_limit: 3,
      })
      if (limitError) {
        console.error('Sign-in alert rate limit check failed', limitError)
        return result(503, { error: 'Sign-in alert rate limiting is unavailable.' })
      }
      if (allowed !== true) return result(429, { error: 'Sign-in alert email rate limit exceeded.' })

      try {
        await emailSender({
          to: user.email,
          ...securityAlertEmail(),
          idempotencyKey: `security-alert/${user.id}/${sessionId}`,
        })
        if (hasSmsConsent(user)) {
          if (!smsSender) throw new Error('Twilio SMS delivery is not configured on the server.')
          await smsSender({ to: user.phone, body: securityAlertSms() })
        }
        return result(200, { ok: true })
      } catch (error) {
        console.error('Sign-in notification delivery failed', error)
        return result(502, { error: 'The sign-in notification could not be delivered.' })
      }
    }

    const { data: isAdmin, error: roleError } = await admin.rpc('has_role', {
      _user_id: user.id,
      _role: 'admin',
    })
    if (roleError) {
      console.error('Identity status email role check failed', roleError)
      return result(503, { error: 'Admin access could not be verified.' })
    }
    if (isAdmin !== true || claimsData.claims.aal !== 'aal2') {
      return result(403, { error: 'Administrator multi-factor authentication is required.' })
    }

    const { data: verification, error: verificationError } = await admin
      .from('identity_verifications')
      .select('id, user_id, status, reviewer_note, reviewed_by, reviewed_at')
      .eq('id', verificationId)
      .eq('reviewed_by', user.id)
      .maybeSingle()
    if (verificationError) {
      console.error('Identity status email lookup failed', verificationError)
      return result(503, { error: 'The review status could not be verified.' })
    }
    if (!verification || !['approved', 'rejected'].includes(verification.status) || !verification.reviewed_at) {
      return result(404, { error: 'The completed identity review could not be found.' })
    }

    const { data: member, error: memberError } = await admin
      .from('members')
      .select('email, email_verified')
      .eq('id', verification.user_id)
      .maybeSingle()
    if (memberError) {
      console.error('Identity status email recipient lookup failed', memberError)
      return result(503, { error: 'The review recipient could not be verified.' })
    }
    if (!member?.email || member.email_verified !== true) {
      return result(409, { error: 'The reviewed account does not have a verified email address.' })
    }
    const { data: recipientAuthData, error: recipientAuthError } = await admin.auth.admin.getUserById(verification.user_id)
    if (recipientAuthError || !recipientAuthData?.user) {
      console.error('Identity status SMS recipient lookup failed', recipientAuthError)
      return result(503, { error: 'The review recipient notification settings could not be verified.' })
    }
    const reviewedAt = new Date(verification.reviewed_at).getTime()
    if (!Number.isFinite(reviewedAt)) return result(503, { error: 'The review timestamp could not be verified.' })

    try {
      await emailSender({
        to: member.email,
        ...identityReviewEmail({ status: verification.status, reviewerNote: verification.reviewer_note }),
        idempotencyKey: `identity-review/${verification.id}/${verification.status}/${reviewedAt}`,
      })
      if (hasSmsConsent(recipientAuthData.user)) {
        if (!smsSender) throw new Error('Twilio SMS delivery is not configured on the server.')
        await smsSender({
          to: recipientAuthData.user.phone,
          body: identityReviewSms(verification.status),
        })
      }
      return result(200, { ok: true })
    } catch (error) {
      console.error('Identity status notification delivery failed', error)
      return result(502, { error: 'The identity review was saved, but its notification could not be delivered.' })
    }
  }
}
