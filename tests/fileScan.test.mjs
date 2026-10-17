import test from 'node:test'
import assert from 'node:assert/strict'
import {
  fileScanProvider,
  isFileScanConfigured,
  scanFileBuffer,
  unavailableScan,
} from '../server/fileScan.js'

function withoutScanEnv(run) {
  const savedUrl = process.env.FILE_SCAN_API_URL
  const savedKey = process.env.FILE_SCAN_API_KEY
  delete process.env.FILE_SCAN_API_URL
  delete process.env.FILE_SCAN_API_KEY
  try {
    return run()
  } finally {
    if (savedUrl === undefined) delete process.env.FILE_SCAN_API_URL
    else process.env.FILE_SCAN_API_URL = savedUrl
    if (savedKey === undefined) delete process.env.FILE_SCAN_API_KEY
    else process.env.FILE_SCAN_API_KEY = savedKey
  }
}

test('reports unavailable when no provider is configured', () => {
  withoutScanEnv(() => {
    assert.equal(fileScanProvider(), null)
    assert.equal(isFileScanConfigured(), false)
    const result = unavailableScan()
    assert.equal(result.status, 'unavailable')
    assert.equal(result.provider, null)
    assert.ok(result.scannedAt)
  })
})

test('scanFileBuffer never throws and degrades to unavailable without a provider', async () => {
  await withoutScanEnv(async () => {
    const result = await scanFileBuffer(new Uint8Array([1, 2, 3]).buffer, { fileName: 'clip.mp4' })
    assert.equal(result.status, 'unavailable')
  })
})

test('provider config requires both url and key with a valid http(s) scheme', () => {
  const savedUrl = process.env.FILE_SCAN_API_URL
  const savedKey = process.env.FILE_SCAN_API_KEY
  try {
    process.env.FILE_SCAN_API_URL = 'not-a-url'
    process.env.FILE_SCAN_API_KEY = 'secret'
    assert.equal(fileScanProvider(), null)

    process.env.FILE_SCAN_API_URL = 'ftp://scanner.example.com'
    assert.equal(fileScanProvider(), null)

    process.env.FILE_SCAN_API_URL = 'https://scanner.example.com/scan'
    delete process.env.FILE_SCAN_API_KEY
    assert.equal(fileScanProvider(), null)

    process.env.FILE_SCAN_API_KEY = 'secret'
    const provider = fileScanProvider()
    assert.equal(provider.host, 'scanner.example.com')
    assert.equal(provider.key, 'secret')
  } finally {
    if (savedUrl === undefined) delete process.env.FILE_SCAN_API_URL
    else process.env.FILE_SCAN_API_URL = savedUrl
    if (savedKey === undefined) delete process.env.FILE_SCAN_API_KEY
    else process.env.FILE_SCAN_API_KEY = savedKey
  }
})
