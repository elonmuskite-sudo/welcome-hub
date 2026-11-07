import { useState, useRef, useEffect } from 'react'
import { useAuth } from '../../../lib/AuthContext'
import { uploadChatFile } from '../../../lib/storageManager'
import Avatar from '../Avatar'
import BioWriter from './BioWriter'
import { Camera, Copy, Check, Save } from 'lucide-react'

export default function ProfileEdit() {
  const { user, updateProfile } = useAuth()
  const [firstName, setFirstName] = useState(user?.firstName || '')
  const [lastName, setLastName] = useState(user?.lastName || '')
  const [bio, setBio] = useState(user?.bio || '')
  const [interests, setInterests] = useState(user?.interests || [])
  const [copied, setCopied] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [avatarPreview, setAvatarPreview] = useState(user?.avatarUrl || null)
  const [avatarFile, setAvatarFile] = useState(null)
  const fileInputRef = useRef(null)

  useEffect(() => {
    if (user) {
      setFirstName(user.firstName || '')
      setLastName(user.lastName || '')
      setAvatarPreview(user.avatarUrl || null)
      setAvatarFile(null)
      setBio(user.bio || '')
      setInterests(user.interests || [])
    }
  }, [user])

  useEffect(() => () => {
    if (avatarPreview?.startsWith('blob:')) URL.revokeObjectURL(avatarPreview)
  }, [avatarPreview])

  const handleAvatarClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Choose a JPG, PNG, or WebP image.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Profile photos must be 5 MB or smaller.')
      return
    }
    setError('')
    setAvatarFile(file)
    setAvatarPreview(URL.createObjectURL(file))
  }

  const handleCopyNexusId = () => {
    if (user?.nexusIdDisplay) {
      navigator.clipboard.writeText(user.nexusIdDisplay)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    const updates = {
      firstName,
      lastName,
      fullName: `${firstName} ${lastName}`.trim(),
      bio: bio.trim(),
      interests,
    }
    try {
      if (avatarFile) {
        const { fileUrl } = await uploadChatFile({
          userId: user.id,
          chatId: null,
          file: avatarFile,
          kind: 'image',
        })
        updates.avatarUrl = fileUrl
      }
      await updateProfile(updates)
      setAvatarFile(null)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (saveError) {
      setError(saveError?.message || 'Your profile could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6 max-w-md">
      {/* Avatar Section */}
      <div className="flex flex-col items-center gap-3">
        <div 
          onClick={handleAvatarClick}
          className="relative group cursor-pointer rounded-full overflow-hidden hover:opacity-90 transition duration-200"
        >
          <Avatar src={avatarPreview || user?.avatarUrl} alt={user?.fullName || 'User'} size="2xl" />
          <div className="absolute inset-0 bg-black/45 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <Camera className="w-8 h-8 text-white animate-pulse" />
          </div>
        </div>
        
        {avatarPreview && avatarPreview !== user?.avatarUrl && (
          <span className="px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-amber-500 text-white rounded-full shadow-sm animate-pulse">
            Unsaved Preview
          </span>
        )}

        <button 
          onClick={handleAvatarClick}
          className="text-xs font-semibold text-primary hover:underline"
        >
          Change Profile Photo
        </button>
        <input
          type="file" 
          ref={fileInputRef} 
          onChange={handleFileChange} 
          accept="image/jpeg,image/png,image/webp"
          className="hidden" 
        />
      </div>

      {/* Copiable Nexus ID */}
      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Your Nexus ID (Unique Member ID)
        </label>
        <div className="flex items-center gap-2 bg-muted/50 p-3 rounded-xl border border-border">
          <span className="text-foreground font-mono font-medium tracking-wide flex-1">
            {user?.nexusIdDisplay || '10-XXXX-XXXX'}
          </span>
          <button
            onClick={handleCopyNexusId}
            className={`p-2 rounded-lg transition duration-200 ${
              copied 
                ? 'bg-green-500 text-white' 
                : 'bg-secondary text-secondary-foreground hover:bg-muted'
            }`}
            title="Copy Nexus ID"
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Provide this secure Nexus number to contacts so they can add and message you end-to-end encrypted.
        </p>
      </div>

      {/* Form Details */}
      <form onSubmit={handleSave} className="space-y-4 pt-2">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              First Name
            </label>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="w-full bg-card border border-border rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition"
              required
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Last Name
            </label>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="w-full bg-card border border-border rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition"
              required
            />
          </div>
        </div>

        <BioWriter name={`${firstName} ${lastName}`.trim()} bio={bio} setBio={setBio} interests={interests} setInterests={setInterests} />

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

        <button
          type="submit"
          disabled={saving}
          className="w-full flex items-center justify-center gap-2 py-3 bg-primary text-primary-foreground font-medium rounded-xl hover:opacity-90 active:scale-[0.99] transition duration-200"
        >
          {saving ? (
            'Saving…'
          ) : saved ? (
            <>
              <Check className="w-4 h-4" />
              Saved!
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              Save Changes
            </>
          )}
        </button>
      </form>
    </div>
  )
}
