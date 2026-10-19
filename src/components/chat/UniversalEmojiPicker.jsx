import { useState } from 'react';
import { XMarkIcon, MagnifyingGlassIcon } from '@heroicons/react/24/solid';

const EMOJI_CATEGORIES = [
  {
    name: 'Smileys',
    icon: '😀',
    emojis: [
      { char: '😀', name: 'happy grin smile smiley' },
      { char: '😃', name: 'happy grin smile smiley' },
      { char: '😄', name: 'happy grin smile smiley' },
      { char: '😁', name: 'grin smile happy beaming' },
      { char: '😆', name: 'grin smile happy squinting' },
      { char: '😅', name: 'sweat smile happy relieved' },
      { char: '😂', name: 'joy tears laugh happy' },
      { char: '🤣', name: 'rofl laugh happy rolling' },
      { char: '😊', name: 'smile happy blush warm' },
      { char: '😇', name: 'halo innocent angel' },
      { char: '🙂', name: 'slight smile' },
      { char: '🙃', name: 'upside down silly' },
      { char: '😉', name: 'wink sly' },
      { char: '😌', name: 'relieved content calm' },
      { char: '😍', name: 'heart eyes love warm' },
      { char: '🥰', name: 'love hearts blush warm' },
      { char: '😘', name: 'blow kiss love' },
      { char: '😗', name: 'kiss' },
      { char: '😙', name: 'kiss smile' },
      { char: '😚', name: 'kiss closed eyes' },
      { char: '😋', name: 'yum delicious food' },
      { char: '😛', name: 'tongue silly' },
      { char: '😝', name: 'tongue squinting silly' },
      { char: '😜', name: 'tongue winking silly' },
      { char: '🤪', name: 'zany crazy silly' },
      { char: '🤨', name: 'raised eyebrow skeptical' },
      { char: '🧐', name: 'monocle smart' },
      { char: '🤓', name: 'nerd smart book' },
      { char: '😎', name: 'cool sunglasses sun' },
      { char: '🥸', name: 'disguise mask' },
      { char: '🤩', name: 'star struck excited' },
      { char: '🥳', name: 'party celebrate' },
      { char: '😏', name: 'smirk sly' },
      { char: '😒', name: 'unamused annoyed' },
      { char: '😞', name: 'disappointed sad' },
      { char: '😔', name: 'pensive sad' },
      { char: '😟', name: 'worried sad' },
      { char: '😕', name: 'confused' },
      { char: '🙁', name: 'frown sad' },
      { char: '☹️', name: 'frown sad' },
      { char: '😣', name: 'persevere struggle' },
      { char: '😖', name: 'confounded struggle' },
      { char: '😫', name: 'tired weary' },
      { char: '😩', name: 'weary tired' },
      { char: '🥺', name: 'pleading beg sad' },
      { char: '😢', name: 'cry tear sad' },
      { char: '😭', name: 'sob cry tear sad loud' },
      { char: '😤', name: 'triumph angry steam' },
      { char: '😠', name: 'angry mad annoyed' },
      { char: '😡', name: 'rage angry mad red' }
    ]
  },
  {
    name: 'Gestures',
    icon: '👍',
    emojis: [
      { char: '👍', name: 'thumbs up like ok' },
      { char: '👎', name: 'thumbs down dislike no' },
      { char: '👊', name: 'fist punch hit' },
      { char: '✊', name: 'fist raised power' },
      { char: '🤛', name: 'fist left' },
      { char: '🤜', name: 'fist right' },
      { char: '🤞', name: 'fingers crossed luck' },
      { char: '✌️', name: 'victory peace sign' },
      { char: '🤟', name: 'love sign rock' },
      { char: '🤘', name: 'horns metal rock' },
      { char: '👌', name: 'ok sign correct' },
      { char: '🤌', name: 'pinched fingers italian' },
      { char: '🤏', name: 'pinching small' },
      { char: '👈', name: 'point left' },
      { char: '👉', name: 'point right' },
      { char: '👆', name: 'point up' },
      { char: '👇', name: 'point down' },
      { char: '☝️', name: 'point up hand' },
      { char: '✋', name: 'raised hand stop' },
      { char: '🤚', name: 'raised back hand' },
      { char: '🖐️', name: 'hand fingers splayed' },
      { char: '🖖', name: 'vulcan salute sci fi' },
      { char: '👋', name: 'wave hello goodbye' },
      { char: '🤙', name: 'call me phone' },
      { char: '💪', name: 'flex bicep strong strength' },
      { char: '🙏', name: 'please pray thanks high five' },
      { char: '🤝', name: 'handshake agree deal' },
      { char: '👏', name: 'clap applaud' },
      { char: '🙌', name: 'hooray celebrate hands' },
      { char: '🫶', name: 'heart hands love' }
    ]
  },
  {
    name: 'Hearts',
    icon: '❤️',
    emojis: [
      { char: '❤️', name: 'red heart love' },
      { char: '🧡', name: 'orange heart love' },
      { char: '💛', name: 'yellow heart love' },
      { char: '💚', name: 'green heart love' },
      { char: '💙', name: 'blue heart love' },
      { char: '💜', name: 'purple heart love' },
      { char: '🖤', name: 'black heart love' },
      { char: '🤍', name: 'white heart love' },
      { char: '🤎', name: 'brown heart love' },
      { char: '💔', name: 'broken heart sad' },
      { char: '❤️‍🔥', name: 'heart on fire love' },
      { char: '❤️‍🩹', name: 'mending heart heal' },
      { char: '❣️', name: 'heart exclamation' },
      { char: '💕', name: 'two hearts love' },
      { char: '💞', name: 'revolving hearts love' },
      { char: '💓', name: 'beating heart love' },
      { char: '💗', name: 'growing heart love' },
      { char: '💖', name: 'sparkle heart love' },
      { char: '💘', name: 'arrow heart love' },
      { char: '💝', name: 'ribbon heart gift' }
    ]
  },
  {
    name: 'Animals',
    icon: '🐱',
    emojis: [
      { char: '🐶', name: 'dog puppy pet animal' },
      { char: '🐱', name: 'cat kitten pet animal' },
      { char: '🐭', name: 'mouse rat animal' },
      { char: '🐹', name: 'hamster animal' },
      { char: '🐰', name: 'rabbit bunny animal' },
      { char: '🦊', name: 'fox animal' },
      { char: '🐻', name: 'bear animal' },
      { char: '🐼', name: 'panda animal' },
      { char: '🐨', name: 'koala animal' },
      { char: '🐯', name: 'tiger animal' },
      { char: '🦁', name: 'lion king animal' },
      { char: '🐮', name: 'cow animal' },
      { char: '🐷', name: 'pig animal' },
      { char: '🐸', name: 'frog animal' },
      { char: '🐵', name: 'monkey animal' },
      { char: '🐔', name: 'chicken bird animal' },
      { char: '🐧', name: 'penguin bird animal' },
      { char: '🐦', name: 'bird animal' },
      { char: '🦆', name: 'duck bird animal' },
      { char: '🦅', name: 'eagle bird animal' },
      { char: '🦉', name: 'owl bird animal' },
      { char: '🦋', name: 'butterfly insect' },
      { char: '🐝', name: 'bee insect honey' },
      { char: '🐛', name: 'bug caterpillar insect' },
      { char: '🐌', name: 'snail insect' }
    ]
  },
  {
    name: 'Food',
    icon: '🍎',
    emojis: [
      { char: '🍏', name: 'apple green fruit' },
      { char: '🍎', name: 'apple red fruit' },
      { char: '🍐', name: 'pear fruit' },
      { char: '🍊', name: 'orange tangerine fruit' },
      { char: '🍋', name: 'lemon fruit' },
      { char: '🍌', name: 'banana fruit' },
      { char: '🍉', name: 'watermelon fruit' },
      { char: '🍇', name: 'grape fruit' },
      { char: '🍓', name: 'strawberry fruit berry' },
      { char: '🫐', name: 'blueberry fruit berry' },
      { char: '🍔', name: 'hamburger burger fast food' },
      { char: '🍟', name: 'fries chips fast food' },
      { char: '🍕', name: 'pizza cheese fast food' },
      { char: '🥪', name: 'sandwich bread food' },
      { char: '🌮', name: 'taco mexican food' },
      { char: ' Donuts', name: 'donut sweet cake' },
      { char: '🍪', name: 'cookie sweet biscuit' },
      { char: '🎂', name: 'cake birthday sweet' },
      { char: '🍰', name: 'cake slice sweet' },
      { char: '🥤', name: 'soda cup drink' }
    ]
  },
  {
    name: 'Symbols',
    icon: '💡',
    emojis: [
      { char: '💡', name: 'bulb light idea' },
      { char: '🕯️', name: 'candle light' },
      { char: '🔦', name: 'flashlight light' },
      { char: '🔔', name: 'bell ring notification' },
      { char: '🔕', name: 'bell mute silent' },
      { char: '🎵', name: 'music note song' },
      { char: '🎶', name: 'music notes song' },
      { char: '🎧', name: 'headphones music' },
      { char: '🎨', name: 'palette paint art' },
      { char: '🎮', name: 'controller game video' },
      { char: '🎯', name: 'target bullseye hit' },
      { char: '🔮', name: 'crystal ball magic' },
      { char: '🎈', name: 'balloon party celebrate' },
      { char: '🎉', name: 'party popper celebrate' },
      { char: '🎊', name: 'confetti celebrate' },
      { char: '🎁', name: 'gift present box' },
      { char: '🎀', name: 'ribbon bow' }
    ]
  }
];

export default function UniversalEmojiPicker({ onSelect, onClose }) {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('Smileys');

  const filteredEmojis = search.trim()
    ? EMOJI_CATEGORIES.flatMap(cat => cat.emojis).filter(
        emoji => emoji.name.toLowerCase().includes(search.toLowerCase())
      )
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      {/* Click outside to close */}
      <div className="absolute inset-0 cursor-default" onClick={onClose} />

      <div className="relative bg-card w-full max-w-sm rounded-2xl shadow-xl overflow-hidden border border-border flex flex-col h-[min(400px,calc(100dvh_-_2rem))] z-10 animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="p-3 border-b border-border flex items-center justify-between bg-card">
          <span className="font-bold text-foreground text-sm">Select Reaction Emoji</span>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded-full transition">
            <XMarkIcon className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Search */}
        <div className="p-2 border-b border-border bg-card">
          <div className="relative">
            <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search emojis..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-muted border-none rounded-lg text-xs text-foreground focus:ring-1 focus:ring-primary focus:outline-none"
            />
          </div>
        </div>

        {/* Categories Selector */}
        {!search && (
          <div className="flex justify-around border-b border-border bg-muted/20 py-1 flex-shrink-0">
            {EMOJI_CATEGORIES.map(category => (
              <button
                key={category.name}
                onClick={() => setActiveCategory(category.name)}
                className={`p-1.5 rounded-lg text-base hover:bg-muted transition-colors ${
                  activeCategory === category.name ? 'bg-muted scale-110 shadow-sm border border-border/60' : ''
                }`}
                title={category.name}
              >
                {category.icon}
              </button>
            ))}
          </div>
        )}

        {/* Emojis Grid Container */}
        <div className="flex-1 overflow-y-auto p-3">
          {search ? (
            filteredEmojis.length === 0 ? (
              <p className="text-center text-xs text-muted-foreground mt-8">No matching emojis</p>
            ) : (
              <div className="grid grid-cols-6 gap-2">
                {filteredEmojis.map((emoji, index) => (
                  <button
                    key={index}
                    onClick={() => onSelect(emoji.char)}
                    className="text-2xl w-10 h-10 flex items-center justify-center hover:bg-muted active:scale-90 rounded-lg transition"
                  >
                    {emoji.char}
                  </button>
                ))}
              </div>
            )
          ) : (
            <div className="grid grid-cols-6 gap-2">
              {EMOJI_CATEGORIES.find(cat => cat.name === activeCategory)?.emojis.map((emoji, index) => (
                <button
                  key={index}
                  onClick={() => onSelect(emoji.char)}
                  className="text-2xl w-10 h-10 flex items-center justify-center hover:bg-muted active:scale-90 rounded-lg transition"
                >
                  {emoji.char}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
