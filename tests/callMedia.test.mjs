import assert from 'node:assert/strict'
import test from 'node:test'
import { applyCallMediaPreferences } from '../src/lib/callMedia.js'

function fakeStream() {
  const audioTracks = [{ enabled: false }]
  const videoTracks = [{ enabled: false }]
  return {
    audioTracks,
    videoTracks,
    getAudioTracks: () => audioTracks,
    getVideoTracks: () => videoTracks,
  }
}

test('media preferences toggled while connecting are applied when tracks arrive', () => {
  const stream = fakeStream()
  const cameraEnabled = applyCallMediaPreferences(stream, {
    kind: 'video',
    muted: true,
    cameraEnabled: false,
  })

  assert.equal(stream.audioTracks[0].enabled, false)
  assert.equal(stream.videoTracks[0].enabled, false)
  assert.equal(cameraEnabled, false)
})

test('new video calls default camera on and voice calls never enable video', () => {
  const video = fakeStream()
  const voice = fakeStream()
  assert.equal(applyCallMediaPreferences(video, { kind: 'video', muted: false }), true)
  assert.equal(video.audioTracks[0].enabled, true)
  assert.equal(video.videoTracks[0].enabled, true)

  assert.equal(applyCallMediaPreferences(voice, { kind: 'voice', muted: false }), false)
  assert.equal(voice.audioTracks[0].enabled, true)
  assert.equal(voice.videoTracks[0].enabled, false)
})
