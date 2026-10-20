import { memo, useMemo } from 'react'
import Avatar from './Avatar'
import { Lock } from 'lucide-react'
import ChatButton from './ChatButton'
import VerificationBadge from './VerificationBadge'
import { useAuth } from '../../lib/AuthContext'
import { chatListPreview, peerIdOf } from '../../lib/chatPreview'

function ChatListItem({ chat, selected, now, onClick }) {
  const { user } = useAuth()
  const peerId = peerIdOf(chat, user?.id)
  const preview = useMemo(() => chatListPreview(chat, user?.id, now), [chat, user?.id, now])

  return (
    <ChatButton
      onClick={onClick}
      className={`w-full text-left flex items-center !rounded-none !h-auto !justify-start p-4 chat-enter ${
        selected ? 'bg-primary/10 border-l-2 border-primary' : 'border-l-2 border-transparent'
      }`}
    >
      <Avatar src={chat.avatar_url} alt={preview.name} />
      <div className="ml-3 flex-1 min-w-0">
        <div className="flex justify-between items-baseline">
          <div className="flex items-center gap-1 min-w-0">
            <h3 className="text-sm font-semibold text-foreground truncate">
              {preview.name}
            </h3>
            {peerId && <VerificationBadge userId={peerId} className="w-3.5 h-3.5 flex-shrink-0" />}
            {chat.encrypted && (
              <Lock className="w-3 h-3 text-primary flex-shrink-0" />
            )}
          </div>
          {preview.timeLabel && (
            <span className="text-xs text-muted-foreground ml-2 flex-shrink-0">
              {preview.timeLabel}
            </span>
          )}
        </div>
        <div className="flex justify-between items-center">
          <p className="text-sm text-muted-foreground truncate" title={preview.snippet}>
            {preview.sentByViewer && <span aria-hidden="true">You: </span>}
            {preview.snippet}
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
    prev.chat.last_message_sender_id === next.chat.last_message_sender_id &&
    prev.chat.unread_count === next.chat.unread_count &&
    prev.chat.avatar_url === next.chat.avatar_url &&
    prev.chat.encrypted === next.chat.encrypted &&
    prev.now === next.now &&
    prev.selected === next.selected && prev.onClick === next.onClick
  )
})
