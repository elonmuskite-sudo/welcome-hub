import { resolveResendFrom } from './otp-email.js'

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character])
}

export function identityReviewEmail({ status, reviewerNote }) {
  if (!['approved', 'rejected'].includes(status)) throw new Error('Invalid identity review status.')
  const label = status === 'approved' ? 'approved' : 'not approved'
  const note = status === 'rejected' && reviewerNote ? String(reviewerNote).slice(0, 500) : ''
  const text = `Your Nexus Chat identity verification was ${label}.${note ? ` Reviewer note: ${note}` : ''}`
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px;color:#172033"><h1 style="font-size:22px;margin:0 0 16px">Nexus Chat</h1><p style="font-size:16px;line-height:1.5">Your identity verification was <strong>${label}</strong>.</p>${note ? `<p style="font-size:16px;line-height:1.5">Reviewer note: ${escapeHtml(note)}</p>` : ''}</div>`
  return { subject: 'Your Nexus Chat identity review status', text, html }
}

export function securityAlertEmail() {
  const text = 'A sign-in to your Nexus Chat account was completed. If this was not you, change your password and contact support.'
  const html = '<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px;color:#172033"><h1 style="font-size:22px;margin:0 0 16px">Nexus Chat security alert</h1><p style="font-size:16px;line-height:1.5">A sign-in to your account was completed. If this was not you, change your password and contact support.</p></div>'
  return { subject: 'New sign-in to your Nexus Chat account', text, html }
}

export { resolveResendFrom }
