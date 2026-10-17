// Waveform helpers for voice notes.
//
// `computePeaks` is a pure function so it can be unit tested without a browser
// audio stack; `extractWaveformPeaks` wraps it with the Web Audio decoder.

export function normalizePeaks(peaks) {
  const values = Array.isArray(peaks) ? peaks.map((value) => Math.abs(Number(value) || 0)) : []
  const max = values.reduce((highest, value) => (value > highest ? value : highest), 0)
  if (!max) return values.map(() => 0)
  return values.map((value) => Math.min(1, value / max))
}

export function computePeaks(channelData, bars = 32, floor = 0.04) {
  const samples = channelData?.length || 0
  const count = Math.max(1, Math.floor(bars))
  if (!samples) return new Array(count).fill(0)
  const block = Math.max(1, Math.floor(samples / count))
  const peaks = []
  for (let index = 0; index < count; index += 1) {
    const start = index * block
    let peak = 0
    for (let offset = 0; offset < block; offset += 1) {
      const value = Math.abs(channelData[start + offset] || 0)
      if (value > peak) peak = value
    }
    peaks.push(peak)
  }
  const normalized = normalizePeaks(peaks)
  // Keep a visible baseline so silent stretches still render as thin bars.
  return normalized.map((value) => Math.max(floor, value))
}

export async function extractWaveformPeaks(file, bars = 32) {
  if (!file || typeof window === 'undefined') return null
  const AudioContextClass = window.AudioContext || window.webkitAudioContext
  if (!AudioContextClass || typeof file.arrayBuffer !== 'function') return null
  let context
  try {
    const buffer = await file.arrayBuffer()
    context = new AudioContextClass()
    const decoded = await context.decodeAudioData(buffer)
    const channel = decoded.getChannelData(0)
    return computePeaks(channel, bars)
  } catch {
    return null
  } finally {
    if (context?.close) await context.close().catch(() => {})
  }
}
