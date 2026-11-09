import test from 'node:test'
import assert from 'node:assert/strict'
import { validateFirebaseServiceAccount } from '../server/firebaseServiceAccount.js'

const serviceAccount = {
  type: 'service_account',
  project_id: 'nexus-test',
  client_email: 'push@nexus-test.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----',
}

test('Firebase service-account JSON is parsed for server-side FCM', () => {
  assert.deepEqual(validateFirebaseServiceAccount(JSON.stringify(serviceAccount)), serviceAccount)
})

test('Firebase service-account JSON rejects malformed or incomplete credentials', () => {
  assert.throws(() => validateFirebaseServiceAccount('not-json'), /valid JSON/)
  assert.throws(
    () => validateFirebaseServiceAccount(JSON.stringify({ type: 'service_account' })),
    /complete Firebase service-account/,
  )
})
