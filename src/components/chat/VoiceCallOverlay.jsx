import { Phone, PhoneOff, Mic, MicOff } from 'lucide-react'
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
  if (call.state === 'ringing') return call.direction === 'incoming' ? 'Incoming voice call' : 'Calling…'
  if (call.state === 'connecting') return 'Connecting…'
  if (call.state === 'connected') return formatDuration(call.duration)
  return 'Call ended'
}

export default function VoiceCallOverlay() {
  const { call, acceptCall, declineCall, endCall, toggleMute } = useCall()

  if (!call) return null

  const isIncomingRinging = call.direction === 'incoming' && call.state === 'ringing'
  const canMute = call.state === 'connected' || call.state === 'connecting'

  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-gray-900/95 px-6">
      <div className="text-center">
        <Avatar src={call.peerAvatar} alt={call.peerName} size="2xl" />
        <h2 className="mt-6 text-2xl font-semibold text-white">{call.peerName}</h2>
        <p
          className={`mt-2 ${
            call.state === 'connected' ? 'font-mono text-lg text-green-400' : 'text-gray-400'
          } ${call.state === 'ringing' || call.state === 'connecting' ? 'animate-pulse' : ''}`}
        >
          {statusLabel(call)}
        </p>
        {call.error && <p className="mt-2 text-sm text-red-400">{call.error}</p>}
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
