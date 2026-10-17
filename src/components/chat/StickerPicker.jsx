/* eslint-disable react/prop-types */
import { useState } from 'react'
import { X } from 'lucide-react'
import ChatButton from './ChatButton'
import { STICKER_PACKS } from '../../data/stickers'

export default function StickerPicker({ onSelect, onClose }) {
  const [activePack, setActivePack] = useState(STICKER_PACKS[0].id)
  const pack = STICKER_PACKS.find(p => p.id === activePack)

  return (
    <div className="mb-2 w-full bg-popover text-popover-foreground rounded-lg chat-surface chat-enter border border-border overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <div className="flex gap-2">
          {STICKER_PACKS.map(p => (
            <ChatButton
              key={p.id}
              onClick={() => setActivePack(p.id)}
              className={`px-3 py-1 text-sm rounded-full transition-colors ${
                activePack === p.id
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {p.name}
            </ChatButton>
          ))}
        </div>
        <ChatButton
          title="Close stickers" onClick={onClose}
          className="p-1 hover:bg-muted rounded-full"
        >
          <X className="w-4 h-4 text-muted-foreground" />
        </ChatButton>
      </div>

      <div className="grid grid-cols-6 gap-2 p-2 max-h-[min(40vh,220px)] overflow-y-auto">
        {pack?.stickers.map(sticker => (
          <ChatButton
            key={sticker.id}
            onClick={() => onSelect(sticker)}
            className="text-3xl p-2 hover:bg-muted rounded-lg transition-colors"
            title={sticker.label}
          >
            {sticker.emoji}
          </ChatButton>
        ))}
      </div>
    </div>
  )
}
