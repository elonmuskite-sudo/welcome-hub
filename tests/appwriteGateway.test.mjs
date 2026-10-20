import test from 'node:test'
import assert from 'node:assert/strict'
import { executeUserDataOperation } from '../server/appwriteGateway.js'

const userId = '123e4567-e89b-42d3-a456-426614174000'

function makeClient(handler) {
  const calls = []
  return {
    calls,
    async query(sql, values = []) {
      calls.push({ sql: String(sql), values })
      return handler(String(sql), values)
    },
  }
}

test('message insert binds its sender to the verified linked Supabase identity', async () => {
  const client = makeClient((sql, values) => {
    assert.match(sql, /insert into public\.messages/)
    return { rows: [{ id: values[0], sender_id: values[2], content: values[3] }] }
  })
  const result = await executeUserDataOperation(client, { supabaseUserId: userId }, {
    action: 'messages.send',
    chatId: '123e4567-e89b-42d3-a456-426614174001',
    senderId: '123e4567-e89b-42d3-a456-426614174099',
    content: 'hello',
  })

  assert.equal(result.message.sender_id, userId)
  assert.equal(client.calls[0].values[2], userId)
})

test('message polling advances its authenticated composite cursor without skipping ties', async () => {
  const lastMessage = {
    id: '123e4567-e89b-42d3-a456-426614174004',
    created_at: '2026-10-14T00:00:01.000Z',
  }
  const client = makeClient((sql, values) => {
    assert.match(sql, /where \(m\.created_at, m\.id\) > \(\$1::timestamptz, \$2::uuid\)/)
    assert.deepEqual(values, ['2026-10-14T00:00:00.000Z', '00000000-0000-1000-8000-000000000000'])
    return { rows: [{ ...lastMessage, chat_id: 'chat-id' }] }
  })
  const result = await executeUserDataOperation(client, { supabaseUserId: userId }, {
    action: 'events.poll',
    since: '2026-10-14T00:00:00.000Z',
    afterId: '00000000-0000-1000-8000-000000000000',
  })

  assert.deepEqual(result.cursor, { since: lastMessage.created_at, afterId: lastMessage.id })
})

test('storage upload preparation scopes the object path and database row to the verified user', async () => {
  const client = makeClient((sql, values) => {
    if (sql.includes('pg_advisory_xact_lock')) return { rows: [] }
    if (sql.includes('sum(size_bytes)')) return { rows: [{ used_bytes: 0 }] }
    if (sql.includes('user_storage_quotas')) return { rows: [{ quota_bytes: 1000000 }] }
    if (sql.includes('insert into public.storage_files')) {
      assert.equal(values[0], userId)
      assert.match(values[7], new RegExp(`^${userId}/direct/`))
      return { rows: [{ id: '123e4567-e89b-42d3-a456-426614174002' }] }
    }
    assert.fail(`Unexpected query: ${sql}`)
  })
  let requestedPath
  const admin = {
    storage: {
      from(bucket) {
        assert.equal(bucket, 'chat-files')
        return {
          async createSignedUploadUrl(path) {
            requestedPath = path
            return { data: { token: 'scoped-upload-token' }, error: null }
          },
        }
      },
    },
  }

  const result = await executeUserDataOperation(client, { supabaseUserId: userId }, {
    action: 'storage.upload.prepare',
    fileName: 'avatar image.png',
    fileType: 'image',
    mimeType: 'image/png',
    sizeBytes: 1234,
  }, admin)

  assert.equal(result.token, 'scoped-upload-token')
  assert.equal(result.path, requestedPath)
  assert.match(result.path, new RegExp(`^${userId}/direct/`))
})

test('storage upload preparation rejects unsupported sizes before writing metadata', async () => {
  const client = makeClient(() => assert.fail('Invalid file must be rejected before database access'))
  await assert.rejects(
    executeUserDataOperation(client, { supabaseUserId: userId }, {
      action: 'storage.upload.prepare',
      fileName: 'large.bin',
      fileType: 'file',
      mimeType: 'application/octet-stream',
      sizeBytes: 51 * 1024 * 1024,
    }, {}),
    { status: 400 },
  )
  assert.equal(client.calls.length, 0)
})

test('storage deletion removes only paths selected under the authenticated RLS context', async () => {
  const client = makeClient((sql, values) => {
    if (sql.includes('select id, storage_path')) {
      return { rows: [{ id: values[0][0], storage_path: `${userId}/direct/file.png` }] }
    }
    if (sql.includes('delete from public.storage_files')) {
      assert.deepEqual(values[0], ['123e4567-e89b-42d3-a456-426614174003'])
      return { rowCount: 1, rows: [] }
    }
    assert.fail(`Unexpected query: ${sql}`)
  })
  let removed
  const admin = {
    storage: {
      from() {
        return {
          async remove(paths) {
            removed = paths
            return { error: null }
          },
        }
      },
    },
  }
  const result = await executeUserDataOperation(client, { supabaseUserId: userId }, {
    action: 'storage.delete',
    fileIds: ['123e4567-e89b-42d3-a456-426614174003'],
  }, admin)

  assert.deepEqual(removed, [`${userId}/direct/file.png`])
  assert.deepEqual(result, { deleted: 1 })
})

test('chat upload completion verifies Storage’s actual object size and content type', async () => {
  const fileId = '123e4567-e89b-42d3-a456-426614174003'
  const client = makeClient((sql) => {
    assert.match(sql, /select id, storage_path, size_bytes, mime_type/)
    return { rows: [{ id: fileId, storage_path: `${userId}/direct/file.png`, size_bytes: 1024, mime_type: 'image/png' }] }
  })
  const admin = {
    storage: {
      from(bucket) {
        assert.equal(bucket, 'chat-files')
        return {
          async info() {
            return { data: { size: 1024, content_type: 'image/png' }, error: null }
          },
          async createSignedUrl() {
            return { data: { signedUrl: 'https://storage.example/signed-file' }, error: null }
          },
        }
      },
    },
  }

  const result = await executeUserDataOperation(client, { supabaseUserId: userId }, {
    action: 'storage.upload.finish',
    fileId,
  }, admin)

  assert.deepEqual(result, { fileUrl: 'https://storage.example/signed-file', scanStatus: 'unavailable' })
})

test('admin dashboard rejects a non-admin before reading workspace data', async () => {
  const client = makeClient((sql) => {
    assert.match(sql, /public\.has_role/)
    return { rows: [{ is_admin: false }] }
  })

  await assert.rejects(
    executeUserDataOperation(client, { supabaseUserId: userId }, { action: 'admin.dashboard' }),
    { status: 403 },
  )
  assert.equal(client.calls.length, 1)
})

test('admin member update requires admin role and calls the existing guarded RPC', async () => {
  const targetId = '123e4567-e89b-42d3-a456-426614174001'
  const client = makeClient((sql, values) => {
    if (sql.includes('public.has_role')) return { rows: [{ is_admin: true }] }
    assert.match(sql, /public\.admin_update_member/)
    assert.deepEqual(values, [targetId, 'Ada', 'Lovelace', ''])
    return { rows: [] }
  })

  const result = await executeUserDataOperation(client, { supabaseUserId: userId }, {
    action: 'admin.member.update',
    memberId: targetId,
    firstName: 'Ada',
    lastName: 'Lovelace',
    bio: '',
  })

  assert.deepEqual(result, { ok: true })
  assert.equal(client.calls.length, 1)
})

test('payment QR settings reject actual Storage objects over the upload limit', async () => {
  const client = makeClient((sql) => {
    assert.match(sql, /public\.has_role/)
    return { rows: [{ is_admin: true }] }
  })
  const admin = {
    storage: {
      from(bucket) {
        assert.equal(bucket, 'payment-qr')
        return {
          async info() {
            return { data: { size: 5 * 1024 * 1024 + 1, content_type: 'image/png' }, error: null }
          },
        }
      },
    },
  }

  await assert.rejects(
    executeUserDataOperation(client, { supabaseUserId: userId }, {
      action: 'payments.settings.save',
      walletAddress: '0x1234567890123456789012345678901234567890',
      qrPath: 'qr-123e4567-e89b-42d3-a456-426614174001.png',
    }, admin),
    { status: 400 },
  )
  assert.equal(client.calls.length, 1)
})

test('identity uploads are scoped to the verified identity and reject invalid sizes', async () => {
  const client = makeClient(() => assert.fail('Upload validation must precede database access'))
  let requestedPath
  const admin = {
    storage: {
      from(bucket) {
        assert.equal(bucket, 'identity-docs')
        return {
          async createSignedUploadUrl(path) {
            requestedPath = path
            return { data: { token: 'identity-upload-token' }, error: null }
          },
        }
      },
    },
  }

  const result = await executeUserDataOperation(client, { supabaseUserId: userId }, {
    action: 'verification.upload.prepare',
    fileName: 'selfie.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 1024,
  }, admin)

  assert.equal(result.token, 'identity-upload-token')
  assert.equal(result.path, requestedPath)
  assert.match(result.path, new RegExp(`^${userId}/`))
  await assert.rejects(
    executeUserDataOperation(client, { supabaseUserId: userId }, {
      action: 'verification.upload.prepare',
      fileName: 'large.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 0,
    }, admin),
    { status: 400 },
  )
})

test('verification submission cannot register another user’s storage paths', async () => {
  const client = makeClient(() => assert.fail('Invalid paths must be rejected before database access'))
  await assert.rejects(
    executeUserDataOperation(client, { supabaseUserId: userId }, {
      action: 'verification.submit',
      selfiePath: 'another-user/selfie.jpg',
      idPath: 'another-user/id.jpg',
      matchScore: 0.9,
    }),
    { status: 400 },
  )
  assert.equal(client.calls.length, 0)
})

test('verification submission checks actual private object metadata before inserting a record', async () => {
  const selfiePath = `${userId}/selfie.jpg`
  const idPath = `${userId}/identity.png`
  const client = makeClient((sql, values) => {
    assert.match(sql, /insert into public\.identity_verifications/)
    assert.deepEqual(values, [userId, 0.9, selfiePath, idPath, 'Ada Lovelace', '1990-01-01', 'passport', 'P1234567', 'United Kingdom'])
    return { rows: [{ status: 'pending', match_score: '0.9' }] }
  })
  const admin = {
    storage: {
      from(bucket) {
        assert.equal(bucket, 'identity-docs')
        return {
          async info(path) {
            return {
              data: {
                size: 1024,
                content_type: path === selfiePath ? 'image/jpeg' : 'image/png',
              },
              error: null,
            }
          },
        }
      },
    },
  }

  const { record } = await executeUserDataOperation(client, { supabaseUserId: userId }, {
    action: 'verification.submit',
    selfiePath,
    idPath,
    matchScore: 0.9,
    fullLegalName: 'Ada Lovelace',
    dateOfBirth: '1990-01-01',
    documentType: 'passport',
    documentNumber: 'P1234567',
    issuingCountry: 'United Kingdom',
  }, admin)

  assert.equal(record.status, 'pending')
  assert.equal(client.calls.length, 1)
})

test('identity review rejects non-admins before attempting a status update', async () => {
  const client = makeClient((sql) => {
    assert.match(sql, /public\.has_role/)
    return { rows: [{ is_admin: false }] }
  })

  await assert.rejects(
    executeUserDataOperation(client, { supabaseUserId: userId }, {
      action: 'verification.admin.review',
      id: '123e4567-e89b-42d3-a456-426614174001',
      status: 'approved',
    }),
    { status: 403 },
  )
  assert.equal(client.calls.length, 1)
})

test('premium member grants are admin-guarded and routed through the audited RPC', async () => {
  const targetId = '123e4567-e89b-42d3-a456-426614174001'
  const client = makeClient((sql, values) => {
    if (sql.includes('public.has_role')) return { rows: [{ is_admin: true }] }
    assert.match(sql, /public\.admin_set_premium_member/)
    assert.deepEqual(values, [targetId, true, null])
    return { rows: [] }
  })

  const result = await executeUserDataOperation(client, { supabaseUserId: userId }, {
    action: 'admin.premium.set',
    memberId: targetId,
    grant: true,
  })

  assert.deepEqual(result, { ok: true })
  assert.equal(client.calls.length, 2)
})

test('premium member grants reject a non-admin before granting the badge', async () => {
  const client = makeClient((sql) => {
    assert.match(sql, /public\.has_role/)
    return { rows: [{ is_admin: false }] }
  })

  await assert.rejects(
    executeUserDataOperation(client, { supabaseUserId: userId }, {
      action: 'admin.premium.set',
      memberId: '123e4567-e89b-42d3-a456-426614174001',
      grant: true,
    }),
    { status: 403 },
  )
  assert.equal(client.calls.length, 1)
})

test('batch verification badges resolve every directory member in one query', async () => {
  const client = makeClient((sql, values) => {
    assert.match(sql, /public\.get_verification_badges/)
    assert.deepEqual(values, [['1012345678', '1098765432']])
    return { rows: [{ member_id: '1012345678', badge: 'premium' }, { member_id: '1098765432', badge: 'none' }] }
  })

  const result = await executeUserDataOperation(client, { supabaseUserId: userId }, {
    action: 'verification.badges',
    memberIds: ['1012345678', '1098765432'],
  })

  assert.deepEqual(result.badges, [
    { member_id: '1012345678', badge: 'premium' },
    { member_id: '1098765432', badge: 'none' },
  ])
  assert.equal(client.calls.length, 1)
})

test('chat listing is scoped to the caller and returns per-participant display names', async () => {
  const client = makeClient((sql, values) => {
    assert.match(sql, /c\.participant_names/)
    assert.match(sql, /where c\.owner_id = \$1\s+or exists \(select 1 from public\.chat_members me/)
    assert.deepEqual(values, [userId])
    return { rows: [{ id: '123e4567-e89b-42d3-a456-426614174010', participant_names: { [userId]: 'Other Person' } }] }
  })

  const result = await executeUserDataOperation(client, { supabaseUserId: userId }, { action: 'chats.list' })

  assert.equal(result.chats[0].participant_names[userId], 'Other Person')
  assert.equal(client.calls.length, 1)
})

test('chat creation persists sanitised per-participant display names', async () => {
  const peerId = '123e4567-e89b-42d3-a456-426614174001'
  const client = makeClient((sql, values) => {
    if (sql.includes('insert into public.chat_members')) return { rows: [] }
    assert.match(sql, /insert into public\.chats/)
    assert.match(sql, /participant_names\)/)
    assert.equal(values[5], userId)
    assert.deepEqual(JSON.parse(values[6]), { [userId]: 'Me', [peerId]: 'Recipient' })
    return { rows: [{ id: '123e4567-e89b-42d3-a456-426614174011', participant_names: JSON.parse(values[6]) }] }
  })

  const result = await executeUserDataOperation(client, { supabaseUserId: userId }, {
    action: 'chats.create',
    title: 'Recipient',
    participantIds: [peerId],
    participantNames: { [userId]: 'Me', [peerId]: 'Recipient', 'not-a-uuid': 'Ignored' },
  })

  assert.deepEqual(result.chat.participant_names, { [userId]: 'Me', [peerId]: 'Recipient' })
  assert.equal(client.calls.length, 3)
})

test('chat creation without participant names stores a null snapshot rather than a shared title', async () => {
  const client = makeClient((sql, values) => {
    if (sql.includes('insert into public.chat_members')) return { rows: [] }
    assert.match(sql, /insert into public\.chats/)
    assert.equal(values[6], null)
    return { rows: [{ id: '123e4567-e89b-42d3-a456-426614174012', participant_names: null }] }
  })

  const result = await executeUserDataOperation(client, { supabaseUserId: userId }, {
    action: 'chats.create',
    title: 'Shared Title',
    participantIds: [],
  })

  assert.equal(result.chat.participant_names, null)
  assert.equal(client.calls.length, 2)
})

test('E2EE status mirror records the provisioning outcome without touching message sending', async () => {
  const client = makeClient((sql, values) => {
    assert.match(sql, /select public\.set_my_e2ee_status\(\$1, \$2\)/)
    assert.deepEqual(values, [true, true])
    return { rows: [] }
  })

  const result = await executeUserDataOperation(client, { supabaseUserId: userId }, {
    action: 'profile.setE2ee',
    enabled: true,
    keyPublished: true,
  })

  assert.deepEqual(result, { ok: true })
  assert.equal(client.calls.length, 1)
})
