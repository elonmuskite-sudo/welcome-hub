import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeftIcon,
  HeartIcon,
  ChatBubbleOvalLeftEllipsisIcon,
  ShareIcon,
  XMarkIcon,
  PaperAirplaneIcon,
  LinkIcon,
  CheckIcon,
  PencilSquareIcon,
  TrashIcon,
  PhotoIcon,
  VideoCameraIcon,
  EllipsisHorizontalIcon,
} from '@heroicons/react/24/solid'
import Avatar from '../components/chat/Avatar'
import { useAuth } from '../lib/AuthContext'
import { createChat, getChats, sendChatMessage, getContacts, searchUserByNexusId } from '../lib/persistence'
import UniversalEmojiPicker from '../components/chat/UniversalEmojiPicker'
import {
  listFeed,
  createFeedPost,
  updateFeedPost,
  deleteFeedPost,
  createFeedComment,
  updateFeedComment,
  deleteFeedComment,
  setFeedReaction,
  setFeedCommentReaction,
  setFeedPostStatus,
  setFeedCommentStatus,
  uploadFeedMedia,
  subscribeFeed,
  formatTimeAgo,
  FEED_REACTION_EMOJIS,
  isFeedAvailable,
} from '../lib/feeds'

const MEDIA_ACCEPT = 'image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime,video/x-msvideo,.jpg,.jpeg,.png,.gif,.webp,.mp4,.mov,.avi'
const MAX_MEDIA = 10

function MediaGrid({ media }) {
  if (!media?.length) return null
  return (
    <div className={`grid gap-1 px-4 pb-3 ${media.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
      {media.map((item, index) => (
        <div key={`${item.url}-${index}`} className="overflow-hidden rounded-xl border border-border bg-black/5">
          {item.type === 'video' ? (
            <video src={item.url} controls playsInline preload="metadata" className="max-h-[420px] w-full bg-black object-contain" />
          ) : (
            <img src={item.url} alt={item.name || `Post media ${index + 1}`} loading="lazy" className="max-h-[420px] w-full object-cover" />
          )}
        </div>
      ))}
    </div>
  )
}

function ReactionSummary({ reactions, reactedBy, userId }) {
  const entries = Object.entries(reactions || {}).filter(([, count]) => count > 0)
  if (!entries.length) return null
  const mine = reactedBy?.[String(userId)]
  return (
    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
      <span className="flex items-center gap-0.5">
        {entries.map(([emoji, count]) => (
          <span key={emoji} className="rounded-full bg-muted px-1.5 py-0.5 text-xs">{emoji} {count}</span>
        ))}
      </span>
      {mine && <span className="text-xs text-primary">You reacted {mine}</span>}
    </div>
  )
}

export default function FeedsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const isAdmin = user?.role === 'admin'
  const feedAvailable = isFeedAvailable()

  const [feeds, setFeeds] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [contacts, setContacts] = useState([])

  const [composerOpen, setComposerOpen] = useState(false)
  const [composerId, setComposerId] = useState(null)
  const [composerText, setComposerText] = useState('')
  const [composerMedia, setComposerMedia] = useState([])
  const [composerBusy, setComposerBusy] = useState(false)
  const [composerProgress, setComposerProgress] = useState(null)
  const fileInputRef = useRef(null)

  const [activeCommentFeedId, setActiveCommentFeedId] = useState(null)
  const [commentInput, setCommentInput] = useState('')
  const [replyInputs, setReplyInputs] = useState({})
  const [activeReplyId, setActiveReplyId] = useState(null)
  const [editingComment, setEditingComment] = useState({ id: null, text: '' })

  const [reactionPickerId, setReactionPickerId] = useState(null)
  const [commentReactionPickerId, setCommentReactionPickerId] = useState(null)
  const [pickerTarget, setPickerTarget] = useState(null)

  const [activeShareFeedId, setActiveShareFeedId] = useState(null)
  const [copiedStatus, setCopiedStatus] = useState(false)
  const [sharedStatus, setSharedStatus] = useState({})
  const [shareError, setShareError] = useState('')

  const [menuFeedId, setMenuFeedId] = useState(null)

  const loadFeed = useCallback(async () => {
    if (!feedAvailable) {
      setLoading(false)
      setError('The feed needs a connected database. Ask an administrator to apply the Supabase migrations.')
      return
    }
    try {
      const next = await listFeed()
      setFeeds(next)
      setError('')
    } catch (loadError) {
      setError(loadError?.message || 'The feed could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [feedAvailable])

  useEffect(() => { loadFeed() }, [loadFeed])

  useEffect(() => {
    if (!feedAvailable) return undefined
    return subscribeFeed(() => { loadFeed() })
  }, [feedAvailable, loadFeed])

  useEffect(() => {
    const loadContacts = async () => {
      try { setContacts(await getContacts()) } catch { setContacts([]) }
    }
    loadContacts()
    const handleUpdate = () => loadContacts()
    window.addEventListener('nexus-contacts:updated', handleUpdate)
    return () => window.removeEventListener('nexus-contacts:updated', handleUpdate)
  }, [])

  useEffect(() => {
    setSharedStatus({})
    setCopiedStatus(false)
  }, [activeShareFeedId])

  // ---- Composer -----------------------------------------------------------
  const resetComposer = () => {
    setComposerOpen(false)
    setComposerId(null)
    setComposerText('')
    setComposerMedia([])
    setComposerProgress(null)
  }

  const startEdit = (feed) => {
    setComposerId(feed.id)
    setComposerText(feed.content || '')
    setComposerMedia(Array.isArray(feed.media) ? feed.media : [])
    setComposerOpen(true)
    setMenuFeedId(null)
  }

  const addMedia = async (event) => {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (!files.length) return
    setComposerBusy(true)
    setError('')
    setNotice('')
    const unscanned = []
    try {
      for (const file of files) {
        if (composerMedia.length >= MAX_MEDIA) throw new Error(`You can attach up to ${MAX_MEDIA} items.`)
        const uploaded = await uploadFeedMedia({
          userId: user?.id,
          file,
          onProgress: (percent) => setComposerProgress({ percent, label: `Uploading ${file.name}` }),
        })
        if (uploaded.scanStatus && uploaded.scanStatus !== 'clean') unscanned.push(file.name)
        setComposerMedia((prev) => [...prev, {
          url: uploaded.fileUrl,
          type: uploaded.fileType === 'video' ? 'video' : 'image',
          name: uploaded.fileName,
        }])
      }
      if (unscanned.length) setNotice(`Virus scanning was unavailable for: ${unscanned.join(', ')}.`)
    } catch (uploadError) {
      setError(uploadError?.message || 'The file could not be uploaded.')
    } finally {
      setComposerBusy(false)
      setComposerProgress(null)
    }
  }

  const publish = async () => {
    if (composerBusy) return
    setError('')
    setNotice('')
    setComposerBusy(true)
    try {
      if (composerId) {
        await updateFeedPost({ id: composerId, content: composerText, media: composerMedia })
        setNotice('Post updated.')
      } else {
        await createFeedPost({ content: composerText, media: composerMedia, isAdmin })
        setNotice('Post published.')
      }
      resetComposer()
      await loadFeed()
    } catch (publishError) {
      setError(publishError?.message || 'Your post could not be saved.')
    } finally {
      setComposerBusy(false)
    }
  }

  const removePost = async (feedId) => {
    if (!window.confirm('Delete this post permanently?')) return
    setMenuFeedId(null)
    try {
      await deleteFeedPost(feedId)
      setFeeds((prev) => prev.filter((feed) => feed.id !== feedId))
      setNotice('Post deleted.')
    } catch (deleteError) {
      setError(deleteError?.message || 'The post could not be deleted.')
    }
  }

  const moderatePost = async (feedId, status) => {
    setMenuFeedId(null)
    try {
      await setFeedPostStatus({ id: feedId, status })
      setNotice(status === 'active' ? 'Post restored.' : 'Post hidden from the public feed.')
      await loadFeed()
    } catch (moderateError) {
      setError(moderateError?.message || 'The post could not be moderated.')
    }
  }

  // ---- Reactions ----------------------------------------------------------
  const reactToPost = async (feedId, emoji) => {
    if (!user?.id) return
    setReactionPickerId(null)
    setPickerTarget(null)
    try {
      await setFeedReaction({ postId: feedId, userId: user.id, emoji })
      await loadFeed()
    } catch (reactionError) {
      setError(reactionError?.message || 'Your reaction could not be saved.')
    }
  }

  const reactToComment = async (commentId, emoji) => {
    if (!user?.id) return
    setCommentReactionPickerId(null)
    setPickerTarget(null)
    try {
      await setFeedCommentReaction({ commentId, userId: user.id, emoji })
      await loadFeed()
    } catch (reactionError) {
      setError(reactionError?.message || 'Your reaction could not be saved.')
    }
  }

  // ---- Comments -----------------------------------------------------------
  const addComment = async (feedId, parentId = null) => {
    const text = parentId ? (replyInputs[parentId] || '') : commentInput
    if (!text.trim()) return
    try {
      await createFeedComment({ postId: feedId, content: text, parentId })
      if (parentId) { setReplyInputs((prev) => ({ ...prev, [parentId]: '' })); setActiveReplyId(null) }
      else setCommentInput('')
      await loadFeed()
    } catch (commentError) {
      setError(commentError?.message || 'Your comment could not be added.')
    }
  }

  const saveCommentEdit = async (commentId) => {
    if (!editingComment.text.trim()) return
    try {
      await updateFeedComment({ id: commentId, content: editingComment.text })
      setEditingComment({ id: null, text: '' })
      await loadFeed()
    } catch (commentError) {
      setError(commentError?.message || 'The comment could not be updated.')
    }
  }

  const removeComment = async (commentId) => {
    if (!window.confirm('Delete this comment?')) return
    try {
      await deleteFeedComment(commentId)
      await loadFeed()
    } catch (commentError) {
      setError(commentError?.message || 'The comment could not be deleted.')
    }
  }

  const moderateComment = async (commentId, status) => {
    try {
      await setFeedCommentStatus({ id: commentId, status })
      await loadFeed()
    } catch (commentError) {
      setError(commentError?.message || 'The comment could not be moderated.')
    }
  }

  // ---- Share --------------------------------------------------------------
  const handleCopyLink = () => {
    const link = `${window.location.origin}/app/feeds#post-${activeShareFeedId}`
    navigator.clipboard?.writeText(link)
    setCopiedStatus(true)
    setTimeout(() => setCopiedStatus(false), 2000)
  }

  const handleSendToContact = async (contact) => {
    const activeShareFeed = feeds.find((feed) => feed.id === activeShareFeedId)
    if (!activeShareFeed) return
    setShareError('')
    try {
      const recipient = await searchUserByNexusId(contact.nexusId)
      if (!recipient || !user?.id) throw new Error('Could not resolve this contact to a registered Nexus account.')
      const chats = await getChats(user.id)
      const participants = [String(user.id), String(recipient.id)].sort()
      let chat = chats.find((item) => {
        const ids = (item.participant_ids || []).map(String).sort()
        return ids.length === participants.length && ids.every((id, index) => id === participants[index])
      })
      if (!chat) {
        chat = await createChat({
          title: recipient.fullName || contact.name,
          type: 'private',
          avatar_url: recipient.avatarUrl || null,
          owner_id: user.id,
          participantIds: participants,
        })
      }
      const content = `📢 Shared post by ${activeShareFeed.userName}:\n\n"${activeShareFeed.content}"`
      await sendChatMessage(chat.id, { content, type: 'text', sender_id: String(user.id) })
      setSharedStatus((prev) => ({ ...prev, [contact.id]: true }))
    } catch (shareSendError) {
      setShareError(shareSendError?.message || 'The post could not be delivered.')
    }
  }

  const activeCommentFeed = feeds.find((feed) => feed.id === activeCommentFeedId)
  const activeShareFeed = feeds.find((feed) => feed.id === activeShareFeedId)

  const renderComment = (comment, feedId, depth = 0) => (
    <div key={comment.id} className={`flex items-start gap-3 ${depth ? 'mt-3 border-l border-border/70 pl-3' : 'border-b border-border/40 pb-4 last:border-0 last:pb-0'}`}>
      <Avatar src={comment.userAvatar} alt={comment.userName} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="rounded-2xl bg-muted/70 px-4 py-2.5 dark:bg-muted/40">
          <span className="mr-1.5 text-sm font-bold text-foreground">{comment.userName}</span>
          {editingComment.id === comment.id ? (
            <span className="mt-1 flex gap-2">
              <input
                value={editingComment.text}
                onChange={(e) => setEditingComment({ id: comment.id, text: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') saveCommentEdit(comment.id) }}
                className="flex-1 rounded-lg border border-border bg-background px-2 py-1 text-sm"
              />
              <button onClick={() => saveCommentEdit(comment.id)} className="text-xs font-semibold text-primary">Save</button>
              <button onClick={() => setEditingComment({ id: null, text: '' })} className="text-xs text-muted-foreground">Cancel</button>
            </span>
          ) : (
            <span className="break-words text-sm text-foreground">{comment.content}</span>
          )}
          {comment.edited && editingComment.id !== comment.id && <span className="ml-1 text-[10px] text-muted-foreground">(edited)</span>}
          {comment.status !== 'active' && <span className="ml-2 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] text-destructive">{comment.status}</span>}
        </div>

        <div className="ml-2 mt-1.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="text-[10px]">{formatTimeAgo(comment.createdAt)}</span>

          {comment.reactions && Object.values(comment.reactions).some((count) => count > 0) && (
            <span className="flex items-center gap-1">
              {Object.entries(comment.reactions).filter(([, count]) => count > 0).map(([emoji, count]) => (
                <span key={emoji} className="rounded-full border border-border px-1.5 py-0.5">{emoji} {count}</span>
              ))}
              {comment.reactedBy?.[String(user?.id)] && <span className="text-primary">You: {comment.reactedBy[String(user?.id)]}</span>}
            </span>
          )}

          <span className="relative">
            <button
              onClick={() => setCommentReactionPickerId(commentReactionPickerId === comment.id ? null : comment.id)}
              className={`font-semibold hover:underline ${comment.reactedBy?.[String(user?.id)] ? 'text-primary' : ''}`}
            >
              React
            </button>
            {commentReactionPickerId === comment.id && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setCommentReactionPickerId(null)} />
                <div className="absolute bottom-full left-0 z-20 mb-1.5 flex items-center gap-1.5 rounded-full border border-border bg-card px-2 py-1.5 shadow-lg">
                  {FEED_REACTION_EMOJIS.map((emoji) => (
                    <button key={emoji} onClick={() => reactToComment(comment.id, emoji)} className="text-base transition hover:scale-125">{emoji}</button>
                  ))}
                  <button
                    onClick={() => { setPickerTarget({ kind: 'comment', id: comment.id }); setCommentReactionPickerId(null) }}
                    className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-sm font-bold text-muted-foreground"
                    title="More reactions"
                  >+</button>
                </div>
              </>
            )}
          </span>

          <button onClick={() => setActiveReplyId(activeReplyId === comment.id ? null : comment.id)} className="font-semibold hover:underline">
            {comment.replies?.length ? `Reply (${comment.replies.length})` : 'Reply'}
          </button>

          {(String(comment.userId) === String(user?.id)) && (
            <>
              <button onClick={() => setEditingComment({ id: comment.id, text: comment.content })} className="hover:underline">Edit</button>
              <button onClick={() => removeComment(comment.id)} className="text-destructive hover:underline">Delete</button>
            </>
          )}
          {isAdmin && comment.status === 'active' && (
            <>
              <button onClick={() => moderateComment(comment.id, 'hidden')} className="hover:underline">Hide</button>
              <button onClick={() => moderateComment(comment.id, 'removed')} className="text-destructive hover:underline">Remove</button>
            </>
          )}
          {isAdmin && comment.status !== 'active' && (
            <button onClick={() => moderateComment(comment.id, 'active')} className="hover:underline">Restore</button>
          )}
        </div>

        {activeReplyId === comment.id && (
          <div className="ml-2 mt-2 flex gap-2">
            <input
              value={replyInputs[comment.id] || ''}
              onChange={(e) => setReplyInputs((prev) => ({ ...prev, [comment.id]: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter') addComment(feedId, comment.id) }}
              placeholder={`Reply to ${comment.userName}...`}
              className="flex-1 rounded-full border border-border bg-muted/60 px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <button onClick={() => addComment(feedId, comment.id)} className="rounded-full bg-primary p-1.5 text-primary-foreground">
              <PaperAirplaneIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {comment.replies?.map((reply) => renderComment(reply, feedId, depth + 1))}
      </div>
    </div>
  )

  return (
    <div className="flex h-full flex-1 flex-col bg-background text-foreground">
      <div className="sticky top-0 z-10 flex items-center gap-4 border-b border-border bg-card p-4 shadow-sm">
        <button onClick={() => navigate('/app')} className="rounded-full p-2 transition hover:bg-muted">
          <ArrowLeftIcon className="h-5 w-5" />
        </button>
        <h1 className="text-xl font-bold">Feed</h1>
        <div className="ml-auto flex items-center gap-2">
          {isAdmin && (
            <span className="hidden rounded-full bg-badge-blue/15 px-2 py-1 text-xs font-medium text-badge-blue sm:inline">Admin posting</span>
          )}
          <button
            onClick={() => { resetComposer(); setComposerOpen(true) }}
            className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Create post
          </button>
        </div>
      </div>

      <div className="mx-auto w-full max-w-2xl flex-1 space-y-4 overflow-y-auto p-4">
        {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
        {notice && <p role="status" className="rounded-lg border border-primary/30 bg-primary/10 p-3 text-sm text-primary">{notice}</p>}

        {loading ? (
          <p className="py-12 text-center text-sm text-muted-foreground">Loading feed…</p>
        ) : feeds.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center">
            <ChatBubbleOvalLeftEllipsisIcon className="mb-2 h-12 w-12 text-muted-foreground/40" />
            <p className="font-medium text-foreground">No posts yet</p>
            <p className="text-sm text-muted-foreground">Be the first to share something.</p>
          </div>
        ) : (
          feeds.map((feed) => {
            const isOwner = String(feed.userId) === String(user?.id)
            const myReaction = feed.reactedBy?.[String(user?.id)]
            const hidden = feed.status !== 'active'
            return (
              <article key={feed.id} id={`post-${feed.id}`} className={`rounded-xl border border-border bg-card shadow-sm ${hidden ? 'opacity-80' : ''}`}>
                <div className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    <Avatar src={feed.userAvatar} alt={feed.userName} size="md" />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-foreground">{feed.userName}</span>
                        {feed.isAdminPost && (
                          <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground">Admin</span>
                        )}
                        {hidden && <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] text-destructive">{feed.status}</span>}
                      </div>
                      <span className="text-xs text-muted-foreground">{formatTimeAgo(feed.createdAt)}{feed.edited ? ' · edited' : ''}</span>
                    </div>
                  </div>
                  {(isOwner || isAdmin) && (
                    <div className="relative">
                      <button onClick={() => setMenuFeedId(menuFeedId === feed.id ? null : feed.id)} className="rounded-full p-2 hover:bg-muted" title="Post options">
                        <EllipsisHorizontalIcon className="h-5 w-5 text-muted-foreground" />
                      </button>
                      {menuFeedId === feed.id && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setMenuFeedId(null)} />
                          <div className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-xl border border-border bg-card py-1 text-sm shadow-lg">
                            {isOwner && <button onClick={() => startEdit(feed)} className="flex w-full items-center gap-2 px-3 py-2 hover:bg-muted"><PencilSquareIcon className="h-4 w-4" /> Edit post</button>}
                            {isOwner && <button onClick={() => removePost(feed.id)} className="flex w-full items-center gap-2 px-3 py-2 text-destructive hover:bg-muted"><TrashIcon className="h-4 w-4" /> Delete post</button>}
                            {isAdmin && feed.status === 'active' && <button onClick={() => moderatePost(feed.id, 'hidden')} className="w-full px-3 py-2 text-left hover:bg-muted">Hide from feed</button>}
                            {isAdmin && feed.status === 'active' && <button onClick={() => moderatePost(feed.id, 'removed')} className="w-full px-3 py-2 text-left text-destructive hover:bg-muted">Remove post</button>}
                            {isAdmin && feed.status !== 'active' && <button onClick={() => moderatePost(feed.id, 'active')} className="w-full px-3 py-2 text-left hover:bg-muted">Restore post</button>}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {feed.content && <p className="whitespace-pre-wrap px-4 pb-3 leading-relaxed text-foreground">{feed.content}</p>}
                <MediaGrid media={feed.media} />

                <div className="flex items-center justify-between border-b border-border px-4 py-2">
                  <ReactionSummary reactions={feed.reactions} reactedBy={feed.reactedBy} userId={user?.id} />
                  <button onClick={() => setActiveCommentFeedId(feed.id)} className="text-sm text-muted-foreground hover:underline">
                    {feed.comments.length} comments
                  </button>
                </div>

                <div className="relative flex items-center justify-between px-2 py-1">
                  <button
                    onClick={() => setReactionPickerId(reactionPickerId === feed.id ? null : feed.id)}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-md py-2 transition hover:bg-muted ${myReaction ? 'text-primary' : 'text-muted-foreground'}`}
                  >
                    <HeartIcon className={`h-5 w-5 ${myReaction ? 'fill-current' : 'text-muted-foreground'}`} />
                    <span className="font-medium">{myReaction ? myReaction : 'React'}</span>
                  </button>
                  <button onClick={() => setActiveCommentFeedId(feed.id)} className="flex flex-1 items-center justify-center gap-2 rounded-md py-2 text-muted-foreground transition hover:bg-muted">
                    <ChatBubbleOvalLeftEllipsisIcon className="h-5 w-5 text-muted-foreground" />
                    <span>Comment</span>
                  </button>
                  <button onClick={() => setActiveShareFeedId(feed.id)} className="flex flex-1 items-center justify-center gap-2 rounded-md py-2 text-muted-foreground transition hover:bg-muted">
                    <ShareIcon className="h-5 w-5 text-muted-foreground" />
                    <span>Share</span>
                  </button>

                  {reactionPickerId === feed.id && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setReactionPickerId(null)} />
                      <div className="absolute bottom-full left-2 z-20 mb-1 flex items-center gap-1.5 rounded-full border border-border bg-card px-2 py-1.5 shadow-lg">
                        {FEED_REACTION_EMOJIS.map((emoji) => (
                          <button key={emoji} onClick={() => reactToPost(feed.id, emoji)} className="text-lg transition hover:scale-125">{emoji}</button>
                        ))}
                        <button
                          onClick={() => { setPickerTarget({ kind: 'post', id: feed.id }); setReactionPickerId(null) }}
                          className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-sm font-bold text-muted-foreground"
                          title="More reactions"
                        >+</button>
                      </div>
                    </>
                  )}
                </div>
              </article>
            )
          })
        )}
      </div>

      {/* Composer */}
      {composerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="absolute inset-0" onClick={() => { if (!composerBusy) resetComposer() }} />
          <div className="relative z-10 flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xl">
            <div className="flex items-center justify-between border-b border-border p-4">
              <h3 className="font-bold text-foreground">{composerId ? 'Edit post' : 'Create post'}</h3>
              <button onClick={() => { if (!composerBusy) resetComposer() }} className="rounded-full p-1.5 hover:bg-muted">
                <XMarkIcon className="h-5 w-5 text-muted-foreground" />
              </button>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              <textarea
                value={composerText}
                onChange={(e) => setComposerText(e.target.value)}
                rows={4}
                maxLength={5000}
                placeholder="What's on your mind?"
                className="w-full resize-none rounded-xl border border-border bg-muted px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
              {composerMedia.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {composerMedia.map((item, index) => (
                    <div key={`${item.url}-${index}`} className="relative overflow-hidden rounded-lg border border-border">
                      {item.type === 'video' ? <video src={item.url} className="h-24 w-full object-cover" muted /> : <img src={item.url} alt="" className="h-24 w-full object-cover" />}
                      <button
                        onClick={() => setComposerMedia((prev) => prev.filter((_, i) => i !== index))}
                        className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white"
                        title="Remove media"
                      >
                        <XMarkIcon className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {composerProgress && (
                <div>
                  <p className="mb-1 truncate text-xs text-muted-foreground">{composerProgress.label} · {composerProgress.percent}%</p>
                  <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-primary" style={{ width: `${composerProgress.percent}%` }} />
                  </div>
                </div>
              )}
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-border p-4">
              <div className="flex items-center gap-2">
                <button onClick={() => fileInputRef.current?.click()} disabled={composerBusy} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50">
                  <PhotoIcon className="h-4 w-4" /> Photo
                </button>
                <button onClick={() => fileInputRef.current?.click()} disabled={composerBusy} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50">
                  <VideoCameraIcon className="h-4 w-4" /> Video
                </button>
                <input ref={fileInputRef} type="file" multiple accept={MEDIA_ACCEPT} className="hidden" onChange={addMedia} />
              </div>
              <button
                onClick={publish}
                disabled={composerBusy || (!composerText.trim() && composerMedia.length === 0)}
                className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              >
                {composerBusy ? 'Saving…' : composerId ? 'Save changes' : 'Publish'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Comments modal */}
      {activeCommentFeed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="absolute inset-0" onClick={() => setActiveCommentFeedId(null)} />
          <div className="relative z-10 flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xl">
            <div className="flex items-center justify-between border-b border-border p-4">
              <div>
                <h3 className="text-lg font-bold text-foreground">Comments</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">On {activeCommentFeed.userName}&apos;s post</p>
              </div>
              <button onClick={() => setActiveCommentFeedId(null)} className="rounded-full p-1.5 hover:bg-muted">
                <XMarkIcon className="h-5 w-5 text-muted-foreground" />
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              {activeCommentFeed.comments.length === 0 ? (
                <div className="flex flex-col items-center py-12 text-center">
                  <ChatBubbleOvalLeftEllipsisIcon className="mb-2 h-12 w-12 text-muted-foreground/40" />
                  <p className="text-sm font-medium text-foreground">No comments yet</p>
                  <p className="text-xs text-muted-foreground">Be the first to share your thoughts.</p>
                </div>
              ) : (
                activeCommentFeed.comments.map((comment) => renderComment(comment, activeCommentFeed.id))
              )}
            </div>

            <div className="border-t border-border p-4">
              <div className="flex gap-2">
                <input
                  value={commentInput}
                  onChange={(e) => setCommentInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addComment(activeCommentFeed.id) }}
                  placeholder="Write a comment..."
                  className="flex-1 rounded-full border border-border bg-muted px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <button onClick={() => addComment(activeCommentFeed.id)} className="rounded-full bg-primary p-2.5 text-primary-foreground">
                  <PaperAirplaneIcon className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Share modal */}
      {activeShareFeed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="absolute inset-0" onClick={() => setActiveShareFeedId(null)} />
          <div className="relative z-10 flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xl">
            <div className="flex items-center justify-between border-b border-border p-4">
              <h3 className="text-lg font-bold text-foreground">Share post</h3>
              <button onClick={() => setActiveShareFeedId(null)} className="rounded-full p-1.5 hover:bg-muted">
                <XMarkIcon className="h-5 w-5 text-muted-foreground" />
              </button>
            </div>
            <div className="flex-1 space-y-5 overflow-y-auto p-4">
              {shareError && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{shareError}</p>}
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-foreground">Copy link</h4>
                <div className="flex items-center gap-2 rounded-xl border border-border bg-muted p-2.5">
                  <LinkIcon className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                  <span className="flex-1 select-all truncate text-xs text-muted-foreground">{`${window.location.origin}/app/feeds#post-${activeShareFeed.id}`}</span>
                  <button onClick={handleCopyLink} className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium ${copiedStatus ? 'bg-green-500 text-white' : 'bg-primary text-primary-foreground'}`}>
                    {copiedStatus ? <><CheckIcon className="h-3.5 w-3.5" /> Copied</> : 'Copy'}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-foreground">Send to Nexus contacts</h4>
                {contacts.length === 0 ? (
                  <p className="py-4 text-center text-xs text-muted-foreground">No contacts found</p>
                ) : (
                  <div className="max-h-60 space-y-2.5 overflow-y-auto pr-1">
                    {contacts.map((contact) => {
                      const isSent = sharedStatus[contact.id]
                      return (
                        <div key={contact.id} className="flex items-center justify-between rounded-xl border border-border bg-card p-2">
                          <div className="flex items-center gap-3">
                            <Avatar src={contact.avatarUrl} alt={contact.name} size="sm" />
                            <div>
                              <span className="block text-sm font-bold leading-none text-foreground">{contact.name}</span>
                              <span className="text-[10px] text-muted-foreground">ID: {contact.nexusId}</span>
                            </div>
                          </div>
                          <button
                            onClick={() => handleSendToContact(contact)}
                            disabled={isSent}
                            className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium ${isSent ? 'cursor-default border border-green-500/20 bg-green-500/10 text-green-500' : 'bg-secondary text-secondary-foreground'}`}
                          >
                            {isSent ? <><CheckIcon className="h-3.5 w-3.5" /> Sent</> : 'Send'}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {pickerTarget && (
        <UniversalEmojiPicker
          onSelect={(emoji) => {
            if (pickerTarget.kind === 'post') reactToPost(pickerTarget.id, emoji)
            else reactToComment(pickerTarget.id, emoji)
          }}
          onClose={() => setPickerTarget(null)}
        />
      )}
    </div>
  )
}
