import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { resolveResendFrom } from '../_shared/system-email.js'
import { createSystemEmailService } from '../_shared/system-email-service.js'

const json = (status: number, body: Record<string, unknown>) => new Response(
  JSON.stringify(body),
  { status, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
)

function createAdminClient(url: string, serviceRoleKey: string) {
  return createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
}

async function sendWithResend(message: {
  to: string
  subject: string
  text: string
  html: string
  idempotencyKey: string
}) {
  const apiKey = Deno.env.get('RESEND_API_KEY')
  if (!apiKey) throw new Error('Resend email delivery is not configured.')
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': message.idempotencyKey.slice(0, 256),
    },
    body: JSON.stringify({
      from: resolveResendFrom(Deno.env.get('RESEND_FROM')),
      to: [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html,
    }),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    console.error('Resend system email delivery failed', response.status, detail)
    throw new Error('Email delivery failed. Check the Resend API key and verified sender domain.')
  }
}

const sendNotification = createSystemEmailService({
  adminClientFactory: createAdminClient,
  emailSender: sendWithResend,
})

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed.' })

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'Invalid request body.' })
  }

  const url = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceRoleKey) return json(503, { error: 'System email delivery is not configured on the server.' })

  const token = (req.headers.get('Authorization') || '').match(/^Bearer\s+(\S+)$/i)?.[1] || ''
  const result = await sendNotification({
    url,
    serviceRoleKey,
    token,
    action: String(body.action || ''),
    verificationId: String(body.verificationId || ''),
  })
  return json(result.status, result.body)
})
