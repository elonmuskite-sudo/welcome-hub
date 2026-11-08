/* eslint-disable react/prop-types */
import { forwardRef } from 'react'

const ChatButton = forwardRef(function ChatButton({ className = '', variant = 'ghost', children, title, ...props }, ref) {
  const variantClass = variant === 'primary'
    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
    : variant === 'call'
      ? 'text-white hover:text-white'
      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
  return <button ref={ref} type="button" title={title} aria-label={props['aria-label'] || title} {...props} className={`chat-button ${variantClass} ${className}`}>{children}</button>
})
export default ChatButton