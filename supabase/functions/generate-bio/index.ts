import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { z } from 'npm:zod@3'

const Body = z.object({
  name: z.string().max(120).optional().default(''),
  interests: z.array(z.string().min(1).max(60)).max(20).default([]),
  draft: z.string().max(1500).optional().default(''),
})

const json = (b: unknown, status: number) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

// The AI provider is configured through environment variables so this function
// is not tied to any single vendor.
function aiConfiguration() {
  const baseUrl = (Deno.env.get('AI_API_URL') || '').replace(/\/+$/, '')
  const key = Deno.env.get('AI_API_KEY')
  const model = Deno.env.get('AI_MODEL') || 'gpt-4o-mini'
  if (!baseUrl || !key) return null
  return { baseUrl, key, model }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const auth = req.headers.get('Authorization') || ''
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })
  const { data: { user } } = await sb.auth.getUser(auth.replace('Bearer ', ''))
  if (!user) return json({ error: 'Please sign in first.' }, 401)

  const parsed = Body.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return json({ error: 'Invalid input', details: parsed.error.flatten().fieldErrors }, 400)
  const { name, interests, draft } = parsed.data
  if (!interests.length && !draft.trim()) return json({ error: 'Add some interests or a rough bio first.' }, 400)

  const ai = aiConfiguration()
  if (!ai) return json({ error: 'AI is not configured.' }, 500)

  const messages = [
    { role: 'system', content: 'You write short, warm, first-person profile bios for a chat app called Nexus. 2-3 sentences, under 300 characters, no hashtags, no emojis unless the user used them, no invented facts. Reply with the bio text only.' },
    { role: 'user', content: `Name: ${name || '(not given)'}\nInterests: ${interests.join(', ') || '(none)'}\nRough bio: ${draft || '(none)'}` },
  ]

  try {
    const r = await fetch(`${ai.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: req.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ai.key}` },
      body: JSON.stringify({ model: ai.model, messages, stream: true }),
    })
    if (!r.ok || !r.body) {
      const t = await r.text().catch(() => '')
      let msg = 'The AI could not write a bio right now.'
      try { msg = JSON.parse(t)?.error?.message || msg } catch { /* ignore */ }
      if (r.status === 429) msg = 'Too many requests — please wait a moment and try again.'
      return json({ error: msg }, r.status)
    }

    // Translate the provider's chat-completion stream into the event shape the
    // client already consumes.
    const encoder = new TextEncoder()
    const decoder = new TextDecoder()
    const stream = new ReadableStream({
      async start(controller) {
        const emit = (payload: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
        const reader = r.body!.getReader()
        let buffer = ''
        try {
          for (;;) {
            const { value, done } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            let index
            while ((index = buffer.indexOf('\n')) >= 0) {
              const line = buffer.slice(0, index).trim()
              buffer = buffer.slice(index + 1)
              if (!line.startsWith('data:')) continue
              const data = line.slice(5).trim()
              if (!data || data === '[DONE]') continue
              try {
                const delta = JSON.parse(data)?.choices?.[0]?.delta?.content
                if (delta) emit({ type: 'response.output_text.delta', delta })
              } catch { /* partial line */ }
            }
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        } catch (error) {
          try { emit({ type: 'error', error: { message: (error as Error).message } }) } catch { /* stream already closed */ }
          controller.close()
        }
      },
      cancel() { r.body?.cancel().catch(() => { /* ignore */ }) },
    })
    return new Response(stream, { status: 200, headers: { ...corsHeaders, 'Content-Type': 'text/event-stream' } })
  } catch (e) {
    if (req.signal.aborted) return new Response(null, { status: 499, headers: corsHeaders })
    return json({ error: String((e as Error).message || e) }, 500)
  }
})
