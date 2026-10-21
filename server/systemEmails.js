import { resolveResendFrom } from '../supabase/functions/_shared/system-email.js'

export { identityReviewEmail, securityAlertEmail } from '../supabase/functions/_shared/system-email.js'

export async function sendSystemEmail({ to, subject, text, html, idempotencyKey }) {
  const apiKey = String(process.env.RESEND_API_KEY || '').trim()
  if (!apiKey) throw new Error('Resend email delivery is not configured.')
  if (!to || !idempotencyKey) throw new Error('Email recipient and idempotency key are required.')

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': String(idempotencyKey).slice(0, 256),
    },
    body: JSON.stringify({
      from: resolveResendFrom(process.env.RESEND_FROM),
      to: [to],
      subject,
      text,
      html,
    }),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    console.error('Resend system email delivery failed', response.status, detail)
    throw new Error('Email delivery failed. Check the Resend API key and verified sender domain.')
  }
}
