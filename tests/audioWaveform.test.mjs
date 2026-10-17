import test from 'node:test'
import assert from 'node:assert/strict'
import { computePeaks, normalizePeaks } from '../src/lib/audioWaveform.js'

test('normalizePeaks scales the loudest sample to 1 and folds sign', () => {
  assert.deepEqual(normalizePeaks([0, -2, 1, 4]), [0, 0.5, 0.25, 1])
})

test('normalizePeaks handles silence and bad input', () => {
  assert.deepEqual(normalizePeaks([0, 0, 0]), [0, 0, 0])
  assert.deepEqual(normalizePeaks(null), [])
})

test('computePeaks returns the requested number of bars within [floor, 1]', () => {
  const samples = Array.from({ length: 320 }, (_, index) => Math.sin(index / 10))
  const peaks = computePeaks(samples, 32)
  assert.equal(peaks.length, 32)
  for (const peak of peaks) {
    assert.ok(peak >= 0.04 && peak <= 1, `peak ${peak} out of range`)
  }
  assert.equal(Math.max(...peaks), 1)
})

test('computePeaks keeps a visible baseline for silent audio', () => {
  const peaks = computePeaks(new Float32Array(320), 16)
  assert.equal(peaks.length, 16)
  for (const peak of peaks) assert.equal(peak, 0.04)
})

test('computePeaks tolerates empty input', () => {
  assert.deepEqual(computePeaks([], 8), new Array(8).fill(0))
  assert.deepEqual(computePeaks(null, 4), new Array(4).fill(0))
})
