import { useCallback, useEffect, useRef, useState } from 'react'
import { PhotoIcon, VideoCameraIcon, XMarkIcon } from '@heroicons/react/24/solid'
import { useAuth } from '../lib/AuthContext'
import {
  listFeed,
  createFeedPost,
  deleteFeedPost,
  setFeedPostStatus,
  uploadFeedMedia,
  subscribeFeed,
  isFeedAvailable,
  formatTimeAgo,
} from '../lib/feeds'

const MEDIA_ACCEPT = 'image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime,video/x-msvideo,.jpg,.jpeg,.png,.gif,.webp,.mp4,.mov,.avi'
const MAX_MEDIA = 10

// Admin feed module: publish official posts on behalf of the platform and
// moderate any member post (hide, remove, restore or delete).
export default function AdminFeedManager() {
  const { user } = useAuth()
  const [posts, setPosts] = useState([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [text, setText] = useState('')
  const [media, setMedia] = useState([])
  const [progress, setProgress] = useState(null)
  const fileInputRef = useRef(null)
  const feedAvailable = isFeedAvailable()

  const load = useCallback(async () => {
    if (!feedAvailable) return
    try {
      setPosts(await listFeed())
    } catch (error) {
      setMsg(error?.message || 'The feed could not be loaded.')
    }
  }, [feedAvailable])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!feedAvailable) return undefined
    return subscribeFeed(() => { load() })
  }, [feedAvailable, load])

  const addMedia = async (event) => {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (!files.length) return
    setBusy(true)
    setMsg('')
    try {
      for (const file of files) {
        if (media.length >= MAX_MEDIA) throw new Error(`You can attach up to ${MAX_MEDIA} items.`)
        const uploaded = await uploadFeedMedia({
          userId: user?.id,
          file,
          onProgress: (percent) => setProgress({ percent, label: `Uploading ${file.name}` }),
        })
        if (uploaded.scanStatus && uploaded.scanStatus !== 'clean') {
          setMsg(prev => prev || `Virus scanning was unavailable for ${file.name}.`)
        }
        setMedia((prev) => [...prev, {
          url: uploaded.fileUrl,
          type: uploaded.fileType === 'video' ? 'video' : 'image',
          name: uploaded.fileName,
        }])
      }
    } catch (error) {
      setMsg(error?.message || 'The file could not be uploaded.')
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const publish = async () => {
    if (busy) return
    setBusy(true)
    setMsg('')
    try {
      await createFeedPost({ content: text, media, isAdmin: true })
      setText('')
      setMedia([])
      setMsg('Official post published.')
      await load()
    } catch (error) {
      setMsg(error?.message || 'Your post could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  const moderate = async (id, status) => {
    setBusy(true)
    setMsg('')
    try {
      await setFeedPostStatus({ id, status })
      setMsg(status === 'active' ? 'Post restored.' : 'Post hidden from the public feed.')
      await load()
    } catch (error) {
      setMsg(error?.message || 'The post could not be moderated.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id) => {
    if (!window.confirm('Delete this post permanently?')) return
    setBusy(true)
    setMsg('')
    try {
      await deleteFeedPost(id)
      setMsg('Post deleted.')
      await load()
    } catch (error) {
      setMsg(error?.message || 'The post could not be deleted.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mt-8 rounded-[24px] border border-border bg-card p-6 text-card-foreground shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Feed management</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Publish official posts and moderate member content. Hidden and removed posts stay visible to admins only.
          </p>
        </div>
      </div>

      {msg && <p className="mt-3 text-sm text-muted-foreground">{msg}</p>}

      {!feedAvailable ? (
        <p className="mt-4 rounded-2xl border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
          The feed needs a connected database. Apply the Supabase migrations to enable posting and moderation.
        </p>
      ) : (
        <>
          <div className="mt-4 space-y-3 rounded-2xl border border-border bg-muted/40 p-4">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              maxLength={5000}
              placeholder="Write an official announcement…"
              className="w-full resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm"
            />
            {media.length > 0 && (
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                {media.map((item, index) => (
                  <div key={`${item.url}-${index}`} className="relative overflow-hidden rounded-lg border border-border">
                    {item.type === 'video'
                      ? <video src={item.url} className="h-16 w-full object-cover" muted />
                      : <img src={item.url} alt="" className="h-16 w-full object-cover" />}
                    <button
                      type="button"
                      onClick={() => setMedia((prev) => prev.filter((_, i) => i !== index))}
                      className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white"
                      title="Remove media"
                    >
                      <XMarkIcon className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {progress && (
              <div>
                <p className="mb-1 truncate text-xs text-muted-foreground">{progress.label} · {progress.percent}%</p>
                <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full bg-primary" style={{ width: `${progress.percent}%` }} />
                </div>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => fileInputRef.current?.click()} disabled={busy} className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm disabled:opacity-50">
                  <PhotoIcon className="h-4 w-4" /> Photo
                </button>
                <button type="button" onClick={() => fileInputRef.current?.click()} disabled={busy} className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm disabled:opacity-50">
                  <VideoCameraIcon className="h-4 w-4" /> Video
                </button>
                <input ref={fileInputRef} type="file" multiple accept={MEDIA_ACCEPT} className="hidden" onChange={addMedia} />
              </div>
              <button
                type="button"
                onClick={publish}
                disabled={busy || (!text.trim() && media.length === 0)}
                className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              >
                {busy ? 'Publishing…' : 'Publish official post'}
              </button>
            </div>
          </div>

          <div className="mt-6 space-y-3">
            {posts.length === 0 && <p className="text-sm text-muted-foreground">No feed posts yet.</p>}
            {posts.map((post) => (
              <div key={post.id} className="rounded-2xl border border-border bg-muted/40 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {post.userName}
                      {post.isAdminPost && <span className="ml-2 rounded-full bg-primary/15 px-2 py-0.5 text-xs text-primary">Admin</span>}
                      {post.status !== 'active' && <span className="ml-2 rounded-full bg-destructive/10 px-2 py-0.5 text-xs text-destructive">{post.status}</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">{formatTimeAgo(post.createdAt)} · {post.media?.length || 0} media · {post.comments.length} comments</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {post.status === 'active' ? (
                      <>
                        <button disabled={busy} onClick={() => moderate(post.id, 'hidden')} className="rounded-xl border border-border px-3 py-1.5 text-sm disabled:opacity-50">Hide</button>
                        <button disabled={busy} onClick={() => moderate(post.id, 'removed')} className="rounded-xl border border-border px-3 py-1.5 text-sm text-destructive disabled:opacity-50">Remove</button>
                      </>
                    ) : (
                      <button disabled={busy} onClick={() => moderate(post.id, 'active')} className="rounded-xl border border-border px-3 py-1.5 text-sm disabled:opacity-50">Restore</button>
                    )}
                    <button disabled={busy} onClick={() => remove(post.id)} className="rounded-xl border border-border px-3 py-1.5 text-sm text-destructive disabled:opacity-50">Delete</button>
                  </div>
                </div>
                {post.content && <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm text-foreground">{post.content}</p>}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
