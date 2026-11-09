export function applyCallMediaPreferences(stream, call) {
  const cameraEnabled = call?.kind === 'video' && (call.cameraEnabled ?? true)
  stream.getAudioTracks().forEach((track) => { track.enabled = !call?.muted })
  stream.getVideoTracks().forEach((track) => { track.enabled = cameraEnabled })
  return cameraEnabled
}
