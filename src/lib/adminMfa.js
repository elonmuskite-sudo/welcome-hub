export async function prepareAdminMfa(auth, email) {
  if (!auth?.mfa) throw new Error('Administrator MFA is not configured.')

  const { data: assurance, error: assuranceError } = await auth.mfa.getAuthenticatorAssuranceLevel()
  if (assuranceError) throw assuranceError
  if (assurance?.currentLevel === 'aal2') return { mode: 'verified' }

  const { data: factors, error: factorsError } = await auth.mfa.listFactors()
  if (factorsError) throw factorsError

  const verifiedFactor = factors?.totp?.[0]
  if (verifiedFactor) return { mode: 'challenge', factorId: verifiedFactor.id }

  for (const factor of factors?.all || []) {
    if (factor.factor_type !== 'totp' || factor.status !== 'unverified') continue
    const { error } = await auth.mfa.unenroll({ factorId: factor.id })
    if (error) throw error
  }

  const { data: enrollment, error: enrollmentError } = await auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: `Nexus admin (${email || 'account'})`,
  })
  if (enrollmentError) throw enrollmentError
  if (!enrollment?.id || !enrollment.totp?.qr_code || !enrollment.totp.secret) {
    throw new Error('Supabase did not return complete authenticator setup details.')
  }

  return {
    mode: 'enroll',
    factorId: enrollment.id,
    qrCode: enrollment.totp.qr_code,
    secret: enrollment.totp.secret,
  }
}

export async function verifyAdminMfaCode(auth, factorId, code) {
  if (!auth?.mfa) throw new Error('Administrator MFA is not configured.')
  const normalizedCode = String(code || '').trim()
  if (!factorId || !/^\d{6}$/.test(normalizedCode)) {
    throw new Error('Enter the six-digit code from your authenticator app.')
  }

  const { data: challenge, error: challengeError } = await auth.mfa.challenge({ factorId })
  if (challengeError) throw challengeError
  if (!challenge?.id) throw new Error('Supabase did not return an authenticator challenge.')

  const { error: verifyError } = await auth.mfa.verify({
    factorId,
    challengeId: challenge.id,
    code: normalizedCode,
  })
  if (verifyError) throw verifyError

  const { data: assurance, error: assuranceError } = await auth.mfa.getAuthenticatorAssuranceLevel()
  if (assuranceError) throw assuranceError
  if (assurance?.currentLevel !== 'aal2') {
    throw new Error('Authenticator verification did not establish the required security level.')
  }
}
