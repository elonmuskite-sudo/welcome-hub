import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareAdminMfa, verifyAdminMfaCode } from '../src/lib/adminMfa.js'

function createAuth({
  assurance = { currentLevel: 'aal1', nextLevel: 'aal2' },
  factors = { all: [], totp: [] },
  enrollment = {
    id: 'new-totp-factor',
    totp: { qr_code: '<svg></svg>', secret: 'setup-secret' },
  },
} = {}) {
  const calls = []
  const auth = {
    mfa: {
      async getAuthenticatorAssuranceLevel() {
        calls.push(['assurance'])
        return { data: assurance, error: null }
      },
      async listFactors() {
        calls.push(['listFactors'])
        return { data: factors, error: null }
      },
      async unenroll(params) {
        calls.push(['unenroll', params])
        return { data: { id: params.factorId }, error: null }
      },
      async enroll(params) {
        calls.push(['enroll', params])
        return { data: enrollment, error: null }
      },
      async challenge(params) {
        calls.push(['challenge', params])
        return { data: { id: 'challenge-id' }, error: null }
      },
      async verify(params) {
        calls.push(['verify', params])
        return { data: {}, error: null }
      },
    },
  }
  return { auth, calls }
}

test('an AAL2 admin does not enroll or challenge another factor', async () => {
  const { auth, calls } = createAuth({ assurance: { currentLevel: 'aal2', nextLevel: 'aal2' } })
  assert.deepEqual(await prepareAdminMfa(auth, 'admin@example.test'), { mode: 'verified' })
  assert.deepEqual(calls, [['assurance']])
})

test('an existing verified TOTP factor is required at sign-in', async () => {
  const { auth, calls } = createAuth({
    factors: { all: [], totp: [{ id: 'existing-factor', status: 'verified' }] },
  })
  assert.deepEqual(await prepareAdminMfa(auth, 'admin@example.test'), {
    mode: 'challenge',
    factorId: 'existing-factor',
  })
  assert.deepEqual(calls.map(([name]) => name), ['assurance', 'listFactors'])
})

test('first-time admin setup removes incomplete factors and returns a new TOTP enrollment', async () => {
  const { auth, calls } = createAuth({
    factors: {
      all: [{ id: 'incomplete-factor', factor_type: 'totp', status: 'unverified' }],
      totp: [],
    },
  })
  const result = await prepareAdminMfa(auth, 'admin@example.test')
  assert.deepEqual(result, {
    mode: 'enroll',
    factorId: 'new-totp-factor',
    qrCode: '<svg></svg>',
    secret: 'setup-secret',
  })
  assert.deepEqual(calls.map(([name]) => name), ['assurance', 'listFactors', 'unenroll', 'enroll'])
  assert.deepEqual(calls.at(-1), ['enroll', {
    factorType: 'totp',
    friendlyName: 'Nexus admin (admin@example.test)',
  }])
})

test('verification challenges the factor and requires the session to reach AAL2', async () => {
  const { auth, calls } = createAuth({ assurance: { currentLevel: 'aal2', nextLevel: 'aal2' } })
  await verifyAdminMfaCode(auth, 'totp-factor', ' 123456 ')
  assert.deepEqual(calls, [
    ['challenge', { factorId: 'totp-factor' }],
    ['verify', { factorId: 'totp-factor', challengeId: 'challenge-id', code: '123456' }],
    ['assurance'],
  ])
})

test('invalid codes and unsuccessful assurance upgrades fail closed', async () => {
  const { auth } = createAuth()
  await assert.rejects(verifyAdminMfaCode(auth, 'totp-factor', '12345'), /six-digit/)
  await assert.rejects(verifyAdminMfaCode(auth, 'totp-factor', '123456'), /required security level/)
})

test('missing authenticator configuration fails closed', async () => {
  await assert.rejects(prepareAdminMfa({}, 'admin@example.test'), /not configured/)
})
