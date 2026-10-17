import { memo, useMemo } from 'react'
import Avatar from './Avatar'
import { format } from 'date-fns'
import { Lock } from 'lucide-react'
import ChatButton from './ChatButton'
import { decodeContent } from '../../lib/chatProtocol'
import VerificationBadge from './VerificationBadge'
import { useAuth } from '../../lib/AuthContext'

export function peerIdOf(chat, myId) {
  const ids = (chat?.participant_ids || []).map(String).filter((id) => id !== String(myId || ''))
  return ids.length === 1 ? ids[0] : null
}

// Resolves the conversation name from the viewer's perspective: a 1:1 chat is
// shown as the *other* participant. Falls back to the stored title for groups
// or chats created before participant names were recorded.
export function chatDisplayName(chat, viewerId) {
  const names = chat?.participant_names
  const peerId = peerIdOf(chat, viewerId)
  if (peerId && names && names[peerId]) return names[peerId]
  return chat?.title || 'Chat'
}

function ChatListItem({ chat, selected, onClick }) {
  const { user } = useAuth()
  const peerId = peerIdOf(chat, user?.id)
  const displayName = chatDisplayName(chat, user?.id)
  const timeLabel = useMemo(() => {
    if (!chat.last_message_time) return null
    try {
      return format(new Date(chat.last_message_time), 'h:mm a')
    } catch {
      return null
    }
  }, [chat.last_message_time])

  return (
    <ChatButton
      onClick={onClick}
      className={`w-full text-left flex items-center !rounded-none !h-auto !justify-start p-4 chat-enter ${
        selected ? 'bg-primary/10 border-l-2 border-primary' : 'border-l-2 border-transparent'
      }`}
    >
      <Avatar src={chat.avatar_url} alt={displayName} />
      <div className="ml-3 flex-1 min-w-0">
        <div className="flex justify-between items-baseline">
          <div className="flex items-center gap-1 min-w-0">
            <h3 className="text-sm font-semibold text-foreground truncate">
              {displayName}
            </h3>
            {peerId && <VerificationBadge userId={peerId} className="w-3.5 h-3.5 flex-shrink-0" />}
            {chat.encrypted && (
              <Lock className="w-3 h-3 text-primary flex-shrink-0" />
            )}
          </div>
          {timeLabel && (
            <span className="text-xs text-muted-foreground ml-2 flex-shrink-0">
              {timeLabel}
            </span>
          )}
        </div>
        <div className="flex justify-between items-center">
          <p className="text-sm text-muted-foreground truncate">
            {decodeContent(chat.last_message).text || 'No messages yet'}
          </p>
          {chat.unread_count > 0 && (
            <span className="ml-2 bg-primary text-primary-foreground text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0">
              {chat.unread_count}
            </span>
          )}
        </div>
      </div>
    </ChatButton>
  )
}

export default memo(ChatListItem, (prev, next) => {
  return (
    prev.chat.id === next.chat.id &&
    prev.chat.title === next.chat.title &&
    prev.chat.participant_names === next.chat.participant_names &&
    prev.chat.last_message === next.chat.last_message &&
    prev.chat.last_message_time === next.chat.last_message_time &&
    prev.chat.unread_count === next.chat.unread_count &&
    prev.chat.avatar_url === next.chat.avatar_url &&
    prev.chat.encrypted === next.chat.encrypted &&
    prev.selected === next.selected && prev.onClick === next.onClick
  )
})
