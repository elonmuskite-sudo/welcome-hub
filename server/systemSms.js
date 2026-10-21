import { createTwilioSmsSender } from '../supabase/functions/_shared/system-sms.js'

export const sendSystemSms = createTwilioSmsSender({
  getEnv: (name) => process.env[name],
})
