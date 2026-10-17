import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ATTACHMENT_ACCEPT,
  UNSUPPORTED_FILE_MESSAGE,
  classifyFileType,
  fileExtension,
  formatBytes,
  isSupportedFile,
} from '../src/lib/chatAttachments.js'

test('accepts every required attachment type', () => {
  const allowed = [
    { name: 'photo.jpg', type: 'image/jpeg' },
    { name: 'photo.png', type: 'image/png' },
    { name: 'anim.gif', type: 'image/gif' },
    { name: 'photo.webp', type: 'image/webp' },
    { name: 'clip.mp4', type: 'video/mp4' },
    { name: 'clip.mov', type: 'video/quicktime' },
    { name: 'clip.avi', type: 'video/x-msvideo' },
    { name: 'song.mp3', type: 'audio/mpeg' },
    { name: 'song.wav', type: 'audio/wav' },
    { name: 'song.aac', type: 'audio/aac' },
    { name: 'doc.pdf', type: 'application/pdf' },
    { name: 'doc.doc', type: 'application/msword' },
    { name: 'doc.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    { name: 'sheet.xls', type: 'application/vnd.ms-excel' },
    { name: 'sheet.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  ]
  for (const file of allowed) {
    assert.equal(isSupportedFile(file), true, `${file.name} should be supported`)
  }
})

test('accepts supported files when the picker reports a generic or empty MIME type', () => {
  const allowed = [
    { name: 'sheet.xlsx', type: 'application/octet-stream' },
    { name: 'doc.docx', type: '' },
    { name: 'report.XLS', type: 'application/zip' },
    { name: 'song.wav', type: 'application/octet-stream' },
  ]
  for (const file of allowed) {
    assert.equal(isSupportedFile(file), true, `${file.name} should be supported by extension`)
  }
})

test('rejects unsupported and dangerous files', () => {
  const rejected = [
    { name: 'run.exe', type: 'application/x-msdownload' },
    { name: 'script.js', type: 'text/javascript' },
    { name: 'archive.rar', type: 'application/octet-stream' },
    { name: 'noext', type: '' },
    { name: 'payload.bat', type: 'application/octet-stream' },
  ]
  for (const file of rejected) {
    assert.equal(isSupportedFile(file), false, `${file.name} should be rejected`)
  }
  assert.equal(isSupportedFile(null), false)
})

test('accept filter exposes both MIME types and extensions for every category', () => {
  for (const token of ['image/jpeg', 'video/mp4', 'audio/mpeg', 'application/pdf', 'application/vnd.ms-excel']) {
    assert.ok(ATTACHMENT_ACCEPT.includes(token), `accept should list ${token}`)
  }
  for (const token of ['.jpg', '.mp4', '.mp3', '.pdf', '.docx', '.xlsx']) {
    assert.ok(ATTACHMENT_ACCEPT.includes(token), `accept should list ${token}`)
  }
})

test('error copy lists the supported categories', () => {
  assert.match(UNSUPPORTED_FILE_MESSAGE, /JPG, PNG, GIF, WebP/)
  assert.match(UNSUPPORTED_FILE_MESSAGE, /MP4, MOV, AVI/)
  assert.match(UNSUPPORTED_FILE_MESSAGE, /MP3, WAV, AAC/)
  assert.match(UNSUPPORTED_FILE_MESSAGE, /Word\/Excel/)
})

test('classifies file types for storage metadata', () => {
  assert.equal(classifyFileType('image/png'), 'image')
  assert.equal(classifyFileType('image/gif'), 'sticker')
  assert.equal(classifyFileType('video/mp4'), 'video')
  assert.equal(classifyFileType('audio/mpeg'), 'audio')
  assert.equal(classifyFileType('audio/mpeg', 'voice'), 'voice')
  assert.equal(classifyFileType('application/pdf'), 'file')
})

test('detects extensions case-insensitively', () => {
  assert.equal(fileExtension('Report.XLSX'), 'xlsx')
  assert.equal(fileExtension('no-extension'), '')
  assert.equal(fileExtension(undefined), '')
})

test('formats byte counts for the upload UI', () => {
  assert.equal(formatBytes(512), '512 B')
  assert.equal(formatBytes(2048), '2.0 KB')
  assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB')
  assert.equal(formatBytes(3 * 1024 * 1024 * 1024), '3.00 GB')
})
