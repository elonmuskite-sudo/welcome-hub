import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createChatFileReference,
  storagePathFromChatFileUrl,
  createR2FileReference,
  r2PathFromFileUrl,
} from '../src/lib/chatFileUrl.js'

test('stable chat file references preserve storage paths', () => {
  const path = '123e4567-e89b-42d3-a456-426614174000/123e4567-e89b-42d3-a456-426614174001/meeting notes.pdf'
  const reference = createChatFileReference(path)

  assert.equal(reference, `storage://${path}`)
  assert.equal(storagePathFromChatFileUrl(reference), path)
})

test('previous signed and public chat file links resolve to the durable object path', () => {
  assert.equal(
    storagePathFromChatFileUrl('https://project.example/storage/v1/object/sign/chat-files/user%2Fchat%2Fdocument.pdf?token=expired'),
    'user/chat/document.pdf',
  )
  assert.equal(
    storagePathFromChatFileUrl('https://project.example/storage/v1/object/public/chat-files/user/chat/document.pdf'),
    'user/chat/document.pdf',
  )
})

test('invalid and unrelated file references are rejected or left unresolved', () => {
  assert.throws(() => createChatFileReference('../private/file.pdf'))
  assert.equal(storagePathFromChatFileUrl('storage://user/../private/file.pdf'), null)
  assert.equal(storagePathFromChatFileUrl('https://example.com/image.png'), null)
})

test('R2 object references round-trip through the r2:// scheme', () => {
  const key = 'chat-attachments/123e4567-e89b-42d3-a456-426614174000/1717171717171-meeting-notes.pdf'
  const reference = createR2FileReference(key)

  assert.equal(reference, `r2://${key}`)
  assert.equal(r2PathFromFileUrl(reference), key)
})

test('R2 references reject traversal and non-R2 inputs', () => {
  assert.throws(() => createR2FileReference('chat-attachments/../private/file.pdf'))
  assert.equal(r2PathFromFileUrl('r2://chat-attachments/../private/file.pdf'), null)
  assert.equal(r2PathFromFileUrl('storage://user/chat/document.pdf'), null)
  assert.equal(r2PathFromFileUrl('https://example.com/image.png'), null)
})
