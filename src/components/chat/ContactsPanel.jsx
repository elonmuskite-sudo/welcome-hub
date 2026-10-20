import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChatBubbleLeftIcon, UserGroupIcon, PlusIcon, XMarkIcon, PhoneIcon, UserPlusIcon } from '@heroicons/react/24/solid'
import Avatar from './Avatar'
import UnsavedContactPrompt from './UnsavedContactPrompt'
import { useAuth } from '../../lib/AuthContext'
import { useSyncStatus } from '../../hooks/useSyncStatus'
import { SyncSpinner } from '../SyncIndicator'
import { createChat, getChats, getContacts, addContact, formatNexusId, searchUserByNexusId, isContactSaved } from '../../lib/persistence'
import { VerificationBadgeIcon, fetchVerificationBadges, BADGE_REFRESH_EVENT } from './VerificationBadge'

const nexusDigits = (value) => String(value || '').replace(/\D/g, '')

export default function ContactsPanel() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [contacts, setContacts] = useState([])
  const [badges, setBadges] = useState({})
  const [chatError, setChatError] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [match, setMatch] = useState(null)
  const [matchBadge, setMatchBadge] = useState('none')
  const [lookupState, setLookupState] = useState('')
  const [newContactNexusId, setNewContactNexusId] = useState('')
  const [promptAction, setPromptAction] = useState(null)
  const [promptBusy, setPromptBusy] = useState(false)
  const { keys: syncKeys } = useSyncStatus()
  const contactsSyncing = syncKeys.includes('contacts')

  useEffect(() => {
    const loadContacts = async () => {
      const data = await getContacts()
      setContacts(data)
    }
    loadContacts()

    const handleUpdate = () => loadContacts()
    window.addEventListener('nexus-contacts:updated', handleUpdate)
    return () => window.removeEventListener('nexus-contacts:updated', handleUpdate)
  }, [])

  const memberIds = contacts.map((contact) => nexusDigits(contact.nexusId)).filter(Boolean).join(',')
  useEffect(() => {
    let active = true
    const loadBadges = () => fetchVerificationBadges(memberIds ? memberIds.split(',') : [])
      .then((map) => { if (active) setBadges(Object.fromEntries(map)) })
      .catch(() => { if (active) setBadges({}) })
    loadBadges()
    window.addEventListener(BADGE_REFRESH_EVENT, loadBadges)
    return () => { active = false; window.removeEventListener(BADGE_REFRESH_EVENT, loadBadges) }
  }, [memberIds])

  const resolveChatId = async (recipient, fallbackTitle) => {
    if (!user?.id) throw new Error('Sign in to start a conversation.')
    if (String(recipient.id) === String(user.id)) throw new Error('You cannot start a private chat with yourself.')
    const chats = await getChats(user.id)
    const participants = [String(user.id), String(recipient.id)].sort()
    const existing = chats.find((chat) => {
      const ids = (chat.participant_ids || []).map(String).sort()
      return ids.length === participants.length && ids.every((id, index) => id === participants[index])
    })
    if (existing) return existing.id
    const newChat = await createChat({
      title: recipient.fullName || fallbackTitle,
      type: 'private',
      avatar_url: recipient.avatarUrl || null,
      owner_id: user.id,
      participantIds: participants,
    })
    return newChat.id
  }

  const handleStartChat = async (contact) => {
    setChatError('')
    try {
      const recipient = await searchUserByNexusId(contact.nexusId)
      if (!recipient) throw new Error('This Nexus ID is not linked to a registered account.')
      const id = await resolveChatId(recipient, contact.name)
      navigate(`/app/chat/${id}`)
    } catch (error) {
      setChatError(error?.message || 'Could not start the conversation.')
    }
  }

  // Run the selected lookup action ("call" or "message") on a resolved match.
  const runLookupAction = async (action, recipient) => {
    setChatError('')
    try {
      const id = await resolveChatId(recipient, match?.fullName)
      setNewContactNexusId('')
      setShowAddModal(false)
      if (action === 'call') {
        navigate(`/app/chat/${id}`, { state: { autoStartCall: true } })
      } else {
        navigate(`/app/chat/${id}`)
      }
    } catch (error) {
      setChatError(error?.message || 'Could not start the conversation.')
    }
  }

  const saveMatchContact = async () => {
    if (!match) return
    await addContact({
      name: match.fullName || 'Nexus user',
      nexusId: formatNexusId(newContactNexusId),
      avatarUrl: match.avatarUrl || null,
    })
    setNewContactNexusId('')
    setShowAddModal(false)
  }

  // Guarded entry point: unsaved lookups must confirm before calling or messaging.
  const requestLookupAction = async (action) => {
    if (!match) return
    const saved = await isContactSaved(match.nexusId)
    if (saved) {
      await runLookupAction(action, match)
      return
    }
    setPromptAction(action)
  }

  const handlePromptSaveFirst = async () => {
    if (!match || !promptAction) return
    setPromptBusy(true)
    const action = promptAction
    try {
      await addContact({
        name: match.fullName || 'Nexus user',
        nexusId: formatNexusId(newContactNexusId),
        avatarUrl: match.avatarUrl || null,
      })
      setPromptAction(null)
      await runLookupAction(action, match)
    } catch (error) {
      setChatError(error?.message || 'Could not save this contact.')
      setPromptAction(null)
    } finally {
      setPromptBusy(false)
    }
  }

  const handlePromptIgnore = async () => {
    if (!match || !promptAction) return
    const action = promptAction
    setPromptAction(null)
    await runLookupAction(action, match)
  }

  useEffect(() => {
    const digits = newContactNexusId.replace(/\D/g, '')
    setMatch(null)
    setMatchBadge('none')
    if (digits.length !== 10) { setLookupState(''); return }
    let active = true
    setLookupState('searching')
    searchUserByNexusId(digits)
      .then((found) => { if (active) { setMatch(found); setLookupState(found ? 'found' : 'missing') } })
      .catch(() => { if (active) setLookupState('missing') })
    return () => { active = false }
  }, [newContactNexusId])

  useEffect(() => {
    if (!match) return
    let active = true
    fetchVerificationBadges([nexusDigits(match.nexusId)])
      .then((map) => { if (active) setMatchBadge(map.get(nexusDigits(match.nexusId)) || 'none') })
      .catch(() => { if (active) setMatchBadge('none') })
    return () => { active = false }
  }, [match])

  const handleAddContact = async (e) => {
    e.preventDefault()
    if (!match) return
    await saveMatchContact()
  }

  return (
    <div className="flex-1 flex flex-col bg-background h-full overflow-hidden">
      {/* Header */}
      <div className="p-6 border-b border-border bg-card shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <UserGroupIcon className="w-7 h-7 text-primary" />
              Contacts
            </h2>
            <p className="text-sm text-muted-foreground mt-1">Your existing secure contacts on Nexus Network</p>
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:opacity-90 transition duration-200"
          >
            <PlusIcon className="w-4 h-4" />
            Add Contact
          </button>
        </div>
      </div>

      {/* Contact List */}
      <div className="flex-1 overflow-y-auto p-6 max-w-4xl w-full mx-auto relative" aria-busy={contactsSyncing || undefined}>
        {contactsSyncing && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/20 backdrop-blur-[1px] transition-all duration-300 animate-in fade-in">
            <div className="flex flex-col items-center gap-2 rounded-2xl bg-card/90 px-6 py-4 shadow-xl border border-border/50 scale-95 animate-in zoom-in-95 duration-300">
              <SyncSpinner className="h-6 w-6" label="Syncing contacts" />
              <span className="text-xs font-semibold text-foreground tracking-tight">Syncing…</span>
            </div>
          </div>
        )}
        {chatError && <p role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{chatError}</p>}
        {contacts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
              <UserGroupIcon className="w-8 h-8 text-muted-foreground" />
            </div>
            <p className="text-foreground font-medium text-center">No contacts yet</p>
            <p className="text-sm text-muted-foreground mt-1 text-center">Add contacts to start messaging</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {contacts.map(contact => (
              <div 
                key={contact.id} 
                className="flex items-center justify-between p-4 bg-card border border-border rounded-xl shadow-sm hover:shadow-md transition duration-200"
              >
                <div className="flex items-center gap-4">
                  <Avatar src={contact.avatarUrl} alt={contact.name} size="md" />
                  <div className="min-w-0">
                    <h3 className="font-bold text-foreground leading-tight flex items-center gap-1.5">
                      <span className="truncate">{contact.name}</span>
                      <VerificationBadgeIcon level={badges[nexusDigits(contact.nexusId)] || 'none'} className="w-4 h-4 flex-shrink-0" />
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5">ID: {contact.nexusId}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleStartChat(contact)}
                    className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:opacity-90 transition duration-200"
                  >
                    <ChatBubbleLeftIcon className="w-4 h-4" />
                    Chat
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Contact Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div 
            className="absolute inset-0 cursor-default" 
            onClick={() => setShowAddModal(false)}
          />
          <div className="relative bg-card w-full max-w-md rounded-2xl shadow-xl overflow-hidden border border-border z-10 flex max-h-[calc(100dvh_-_2rem)] flex-col animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-border flex items-center justify-between bg-card">
              <h3 className="font-bold text-foreground text-lg">Add New Contact</h3>
              <button 
                onClick={() => setShowAddModal(false)} 
                className="p-2 hover:bg-muted rounded-full transition"
              >
                <XMarkIcon className="w-5 h-5 text-muted-foreground" />
              </button>
            </div>
            <form onSubmit={handleAddContact} className="p-6 space-y-4 min-h-0 overflow-y-auto">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Nexus ID</label>
                <input
                  type="text"
                  inputMode="numeric"
                  autoFocus
                  value={newContactNexusId}
                  onChange={(e) => setNewContactNexusId(e.target.value.replace(/[^\d-]/g, '').slice(0, 12))}
                  placeholder="10-XXXX-XXXX"
                  className="w-full px-4 py-2 bg-muted border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  required
                />
                <p className="text-xs text-muted-foreground mt-1">Enter the 10-digit Nexus ID (e.g., 1012345678)</p>
                {lookupState === 'searching' && (
                  <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                    <SyncSpinner className="h-3.5 w-3.5" label="Looking up contact" />
                    <span>Looking up…</span>
                  </div>
                )}
                {lookupState === 'missing' && <p className="text-xs text-destructive mt-2">No account found for this Nexus ID.</p>}
                {match && (
                  <div className="mt-3 rounded-xl border border-primary/30 bg-primary/10 p-3 animate-in fade-in zoom-in-95 duration-200">
                    <div className="flex items-center gap-3">
                      <Avatar src={match.avatarUrl} alt={match.fullName} size="md" />
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground truncate flex items-center gap-1.5">
                          <span className="truncate">{match.fullName || 'Nexus user'}</span>
                          <VerificationBadgeIcon level={matchBadge} className="w-4 h-4 flex-shrink-0" />
                        </p>
                        <p className="text-xs text-muted-foreground">{formatNexusId(newContactNexusId)}</p>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => requestLookupAction('message')}
                        className="flex items-center justify-center gap-1.5 rounded-lg bg-primary px-2 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 transition"
                      >
                        <ChatBubbleLeftIcon className="w-4 h-4" />
                        Message
                      </button>
                      <button
                        type="button"
                        onClick={() => requestLookupAction('call')}
                        className="flex items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-2 py-2 text-xs font-semibold text-foreground hover:bg-muted transition"
                      >
                        <PhoneIcon className="w-4 h-4" />
                        Call
                      </button>
                      <button
                        type="button"
                        onClick={saveMatchContact}
                        className="flex items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-2 py-2 text-xs font-semibold text-foreground hover:bg-muted transition"
                      >
                        <UserPlusIcon className="w-4 h-4" />
                        Save
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 px-4 py-2 bg-muted text-foreground rounded-lg hover:bg-muted/80 transition duration-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition duration-200"
                >
                  Add Contact
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <UnsavedContactPrompt
        open={Boolean(match && promptAction)}
        contact={{ name: match?.fullName }}
        action={promptAction || 'message'}
        busy={promptBusy}
        onSaveFirst={handlePromptSaveFirst}
        onIgnore={handlePromptIgnore}
        onClose={() => setPromptAction(null)}
      />
    </div>
  )
}
