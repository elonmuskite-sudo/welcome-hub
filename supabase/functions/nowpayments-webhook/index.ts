import { createClient } from 'npm:@supabase/supabase-js@2'

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (v && typeof v === 'object') {
    return Object.keys(v as Record<string, unknown>).sort().reduce((acc, k) => {
      acc[k] = sortKeys((v as Record<string, unknown>)[k]); return acc
    }, {} as Record<string, unknown>)
  }
  return v
}

async function hmacHex(secret: string, msg: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const GB = 1024 ** 3

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const ev: Record<string, unknown> = { outcome: 'received', signature_valid: false }
  const log = async (outcome: string, error?: string) => {
    ev.outcome = outcome; if (error) ev.error = error
    try { await admin.from('payment_webhook_events').insert(ev) } catch (e) { console.error('log failed', e) }
  }

  const secret = Deno.env.get('NOWPAYMENTS_IPN_SECRET')
  const raw = await req.text()
  let body: Record<string, unknown>
  try { body = JSON.parse(raw) } catch { await log('rejected', 'Body is not valid JSON'); return new Response('Bad body', { status: 400 }) }
  ev.payload = body
  ev.order_id = body.order_id ? String(body.order_id) : null
  ev.payment_id = body.payment_id ? String(body.payment_id) : null
  ev.payment_status = body.payment_status ? String(body.payment_status) : null
  if (!secret) { await log('error', 'NOWPAYMENTS_IPN_SECRET is not set'); return new Response('Not configured', { status: 503 }) }

  const expected = await hmacHex(secret, JSON.stringify(sortKeys(body)))
  if (expected !== (req.headers.get('x-nowpayments-sig') || '')) { await log('rejected', 'Signature mismatch'); return new Response('Bad signature', { status: 400 }) }
  ev.signature_valid = true

  try {
    const status = String(body.payment_status || '')
    const orderId = String(body.order_id || '')
    if (!orderId) { await log('ignored', 'No order_id in event'); return new Response('ok') }

    if (['failed', 'expired', 'refunded'].includes(status)) {
      const { error } = await admin.from('storage_purchases').update({ status }).eq('id', orderId).eq('status', 'pending')
      await log(error ? 'error' : `marked_${status}`, error?.message); return new Response('ok')
    }
    if (status !== 'finished') { await log('waiting'); return new Response('ok') }

    const { data: purchase, error: claimErr } = await admin.from('storage_purchases')
      .update({ status: 'paid' }).eq('id', orderId).neq('status', 'paid').select('*').maybeSingle()
    if (claimErr) { await log('error', claimErr.message); return new Response('retry', { status: 500 }) }
    if (!purchase) { await log('duplicate', 'Order already paid or not found'); return new Response('ok') }

    const { data: quota } = await admin.from('user_storage_quotas').select('quota_bytes').eq('user_id', purchase.user_id).maybeSingle()
    const newQuota = Number(quota?.quota_bytes ?? 5 * GB) + Number(purchase.added_bytes)
    const { error: qErr } = await admin.from('user_storage_quotas').upsert({ user_id: purchase.user_id, quota_bytes: newQuota })
    if (qErr) { await log('error', `Storage limit update failed: ${qErr.message}`); return new Response('ok') }

    let emailErr: string | undefined
    try {
      const { data: { user } } = await admin.auth.admin.getUserById(purchase.user_id)
      const resendKey = Deno.env.get('RESEND_API_KEY')
      if (!user?.email || !resendKey) emailErr = 'Receipt email skipped (missing email or keys)'
      else {
        const amount = (purchase.amount_cents / 100).toFixed(2)
        const added = purchase.added_bytes >= 1000 * GB ? '1 TB' : `${Math.round(purchase.added_bytes / GB)} GB`
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: Deno.env.get('RECEIPT_FROM_EMAIL') || 'Receipts <onboarding@resend.dev>',
            to: [user.email],
            subject: `Receipt: +${added} storage`,
            html: `<h2>Thanks for your purchase</h2><p>+${added} storage — $${amount} USD</p><p>Order: ${purchase.id}<br/>Payment: ${body.payment_id ?? ''}<br/>Date: ${new Date().toUTCString()}</p><p>Your new storage limit is ${(newQuota / GB).toFixed(0)} GB.</p>${purchase.receipt_url ? `<p><a href="${purchase.receipt_url}">View payment</a></p>` : ''}`,
          }),
        })
        if (!r.ok) emailErr = `Receipt email failed (${r.status}): ${(await r.text()).slice(0, 200)}`
      }
    } catch (e) { emailErr = `Receipt email failed: ${(e as Error).message}` }

    await log('storage_added', emailErr)
    return new Response('ok')
  } catch (e) {
    await log('error', (e as Error).message)
    return new Response('error', { status: 500 })
  }
})
