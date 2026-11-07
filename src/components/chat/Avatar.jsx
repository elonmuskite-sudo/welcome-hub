import { useEffect, useState } from 'react'
import { resolveProfilePhotoUrl } from '../../lib/storageManager'

export default function Avatar({ src, alt, size = 'md' }) {
  const [resolvedSrc, setResolvedSrc] = useState(src)
  const sizeClasses = {
    sm: 'w-8 h-8',
    md: 'w-10 h-10',
    lg: 'w-12 h-12',
    xl: 'w-20 h-20',
    '2xl': 'w-28 h-28'
  }

  const getInitials = (name) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  useEffect(() => {
    let active = true
    setResolvedSrc(src)
    if (typeof src === 'string' && src.startsWith('storage://')) {
      resolveProfilePhotoUrl(src).then((url) => {
        if (active) setResolvedSrc(url)
      }).catch((error) => {
        console.error('Could not load the profile photo.', error)
        if (active) setResolvedSrc(null)
      })
    }
    return () => { active = false }
  }, [src])

  return (
    <div className={`${sizeClasses[size]} rounded-full overflow-hidden bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-semibold`}>
      {resolvedSrc ? (
        <img src={resolvedSrc} alt={alt} className="w-full h-full object-cover" />
      ) : (
        <span className={size === '2xl' ? 'text-2xl' : size === 'xl' ? 'text-lg' : 'text-sm'}>
          {getInitials(alt || 'User')}
        </span>
      )}
    </div>
  )
}
