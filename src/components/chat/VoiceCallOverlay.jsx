import { useEffect, useRef, useState } from 'react'
import { Phone, PhoneOff, Mic, MicOff, Video, VideoOff, SwitchCamera } from 'lucide-react'
import Avatar from './Avatar'
import { useCall } from '../../lib/CallContext'

// Calls can run past an hour, so unlike the voice-note timer this includes hours.
function formatDuration(seconds) {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const pad = (value) => String(value).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`
}

function statusLabel(call) {
  if (call.state === 'ringing') return call.direction === 'incoming'
    ? `Incoming ${call.kind === 'video' ? 'video' : 'voice'} call`
    : 'Calling…'
  if (call.state === 'connecting') return 'Connecting…'
  if (call.state === 'connected') return formatDuration(call.duration)
  return 'Call ended'
}

export default function VoiceCallOverlay() {
  const { call, acceptCall, declineCall, endCall, toggleMute, toggleCamera, switchCamera } = useCall()
  const localVideoRef = useRef(null)
  const remoteVideoRef = useRef(null)
  const [cameraError, setCameraError] = useState('')

  useEffect(() => {
    if (localVideoRef.current) localVideoRef.current.srcObject = call?.localStream || null
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = call?.remoteStream || null
  }, [call?.localStream, call?.remoteStream])

  if (!call) return null

  const isIncomingRinging = call.direction === 'incoming' && call.state === 'ringing'
  const canMute = call.state === 'connected' || call.state === 'connecting'
  const videoCall = call.kind === 'video'
  const canControlCamera = videoCall && (call.state === 'connected' || call.state === 'connecting')

  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-gray-950 px-4 py-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
      {videoCall && call.state !== 'ringing' && (
        <div className="relative flex min-h-0 w-full max-w-5xl flex-1 items-center justify-center overflow-hidden rounded-2xl bg-black">
          <video ref={remoteVideoRef} autoPlay muted playsInline className="h-full max-h-[75vh] w-full object-contain" />
          {!call.remoteStream && <Avatar src={call.peerAvatar} alt={call.peerName} size="2xl" />}
          <div className="absolute bottom-4 right-4 aspect-video w-28 overflow-hidden rounded-xl border border-white/30 bg-gray-900 sm:w-44">
            <video ref={localVideoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
            {!call.cameraEnabled && <span className="absolute inset-0 flex items-center justify-center bg-gray-900 text-xs text-white">Camera off</span>}
          </div>
        </div>
      )}
      <div className={`text-center ${videoCall && call.state !== 'ringing' ? 'mt-3' : ''}`}>
        {(!videoCall || call.state === 'ringing') && <Avatar src={call.peerAvatar} alt={call.peerName} size="2xl" />}
        <h2 className="mt-3 text-2xl font-semibold text-white">{call.peerName}</h2>
        <p
          className={`mt-2 ${
            call.state === 'connected' ? 'font-mono text-lg text-green-400' : 'text-gray-400'
          } ${call.state === 'ringing' || call.state === 'connecting' ? 'animate-pulse' : ''}`}
        >
          {statusLabel(call)}
        </p>
        {call.error && <p className="mt-2 text-sm text-red-400">{call.error}</p>}
        {cameraError && <p role="alert" className="mt-2 text-sm text-red-400">{cameraError}</p>}
      </div>

      {call.state !== 'ended' && (
        <div className="mt-12 flex items-center gap-6">
          {isIncomingRinging && (
            <button
              type="button"
              onClick={acceptCall}
              title="Accept call"
              aria-label="Accept call"
              className="rounded-full bg-green-600 p-5 text-white transition-colors hover:bg-green-700"
            >
              <Phone className="h-7 w-7" />
            </button>
          )}

          {canMute && (
            <button
              type="button"
              onClick={toggleMute}
              title={call.muted ? 'Unmute' : 'Mute'}
              aria-label={call.muted ? 'Unmute' : 'Mute'}
              className={`rounded-full p-4 text-white transition-colors ${
                call.muted ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-700 hover:bg-gray-600'
              }`}
            >
              {call.muted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
            </button>
          )}

          {canControlCamera && (
            <>
              <button
                type="button"
                onClick={toggleCamera}
                title={call.cameraEnabled ? 'Turn camera off' : 'Turn camera on'}
                aria-label={call.cameraEnabled ? 'Turn camera off' : 'Turn camera on'}
                className="rounded-full bg-gray-700 p-4 text-white transition-colors hover:bg-gray-600"
              >
                {call.cameraEnabled ? <Video className="h-6 w-6" /> : <VideoOff className="h-6 w-6" />}
              </button>
              <button
                type="button"
                onClick={() => {
                  setCameraError('')
                  switchCamera().catch((error) => setCameraError(error?.message || 'Could not switch cameras.'))
                }}
                title="Switch camera"
                aria-label="Switch camera"
                className="rounded-full bg-gray-700 p-4 text-white transition-colors hover:bg-gray-600"
              >
                <SwitchCamera className="h-6 w-6" />
              </button>
            </>
          )}

          <button
            type="button"
            onClick={isIncomingRinging ? declineCall : endCall}
            title={isIncomingRinging ? 'Decline call' : 'End call'}
            aria-label={isIncomingRinging ? 'Decline call' : 'End call'}
            className="rounded-full bg-red-600 p-5 text-white transition-colors hover:bg-red-700"
          >
            <PhoneOff className="h-7 w-7" />
          </button>
        </div>
      )}
    </div>
  )
}
