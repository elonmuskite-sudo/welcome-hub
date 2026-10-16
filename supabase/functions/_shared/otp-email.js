const PURPOSE_COPY = {
  signup: {
    subject: 'Your Nexus Chat verification code',
    action: 'verify your email address',
  },
  recovery: {
    subject: 'Your Nexus Chat password reset code',
    action: 'reset your password',
  },
  email: {
    subject: 'Your Nexus Chat sign-in code',
    action: 'sign in',
  },
}

export function otpEmail({ code, purpose }) {
  const copy = PURPOSE_COPY[purpose] || PURPOSE_COPY.signup
  const text = `Your Nexus Chat code is ${code}. Enter this code to ${copy.action}. It expires in 10 minutes. If you did not request this, ignore this email.`
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px;color:#172033"><h1 style="font-size:22px;margin:0 0 16px">Nexus Chat</h1><p style="font-size:16px;line-height:1.5">Use this code to ${copy.action}:</p><p style="font-size:32px;font-weight:700;letter-spacing:8px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;text-align:center;margin:24px 0">${code}</p><p style="font-size:16px;line-height:1.5">This code expires in 10 minutes. If you did not request this, you can ignore this email.</p></div>`
  return { subject: copy.subject, text, html }
}
