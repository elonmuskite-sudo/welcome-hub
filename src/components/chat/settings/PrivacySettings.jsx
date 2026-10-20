import { useState, useEffect } from 'react'
import SettingsRow from './SettingsRow'
import { ShieldCheckIcon, KeyIcon, DocumentDuplicateIcon, CheckIcon, EyeIcon } from '@heroicons/react/24/solid'
import { useSetting } from '../../../hooks/useSetting'
import {
  isE2EEEnabled,
  setE2EEEnabled,
  getMyPublicKey,
  generateSecurityCode,
  initializeE2EE,
  publishMyPublicKey,
} from '../../../lib/crypto/e2ee'

export default function PrivacySettings() {
  const [e2eeEnabled, setE2ee] = useState(isE2EEEnabled())
  const [publicKey, setPublicKey] = useState('')
  const [copied, setCopied] = useState(false)
  const [keyError, setKeyError] = useState('')
  const [readReceipts, setReadReceipts] = useSetting('readReceipts', true)

  useEffect(() => {
    initializeE2EE()
      .then(() => getMyPublicKey())
      .then(setPublicKey)
      .catch(() => setPublicKey(''))
    if (isE2EEEnabled()) publishMyPublicKey().catch(() => {})
  }, [])

  const handleToggleE2EE = (enabled) => {
    setE2EEEnabled(enabled)
    setE2ee(enabled)
    setKeyError('')
    // Publish on enable so contacts can actually derive the shared key; without
    // it encryption would fail for everyone else.
    if (enabled) publishMyPublicKey().catch((error) => setKeyError(error?.message || 'Could not publish your encryption key.'))
  }

  const copyPublicKey = () => {
    navigator.clipboard.writeText(publicKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 p-4 bg-green-500/10 rounded-xl border border-green-500/20">
        <ShieldCheckIcon className="w-6 h-6 text-green-500 mt-0.5 flex-shrink-0" />
        <div>
          <h3 className="font-semibold text-foreground">End-to-End Encryption</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Messages are encrypted on your device using AES-256-GCM before being sent.
            Only you and the recipient can read them.
          </p>
        </div>
      </div>

      <SettingsRow label="Enable E2EE">
        <button
          onClick={() => handleToggleE2EE(!e2eeEnabled)}
          className={`relative w-12 h-6 rounded-full transition-colors ${
            e2eeEnabled ? 'bg-green-500' : 'bg-muted'
          }`}
        >
          <span
            className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
              e2eeEnabled ? 'translate-x-6' : 'translate-x-0.5'
            }`}
          />
        </button>
      </SettingsRow>

      <SettingsRow
        label="Read receipts"
        description={
          readReceipts
            ? 'People you message can see when you have read their messages.'
            : 'Read receipts are off: you will not send them, and you will not see when your messages are read.'
        }
        icon={<EyeIcon className="w-4 h-4" />}
      >
        <button
          type="button"
          role="switch"
          aria-checked={readReceipts}
          aria-label="Read receipts"
          onClick={() => setReadReceipts(!readReceipts)}
          className={`relative w-12 h-6 rounded-full transition-colors ${
            readReceipts ? 'bg-green-500' : 'bg-muted'
          }`}
        >
          <span
            className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
              readReceipts ? 'translate-x-6' : 'translate-x-0.5'
            }`}
          />
        </button>
      </SettingsRow>

      {e2eeEnabled && (
        <>
          <div className="p-4 bg-muted/40 rounded-xl border border-border">
            <div className="flex items-center gap-2 mb-2">
              <KeyIcon className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">Your Public Key</span>
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs text-muted-foreground break-all font-mono bg-muted p-2 rounded">
                {publicKey ? `${publicKey.slice(0, 32)}...` : 'Generating...'}
              </code>
              <button
                onClick={copyPublicKey}
                className="p-2 hover:bg-muted rounded-lg transition-colors"
              >
                {copied ? <CheckIcon className="w-4 h-4 text-green-500" /> : <DocumentDuplicateIcon className="w-4 h-4 text-muted-foreground" />}
              </button>
            </div>
          </div>

          <div className="p-4 bg-muted/40 rounded-xl border border-border">
            <p className="text-sm font-medium text-foreground mb-1">Security Code</p>
            <p className="text-2xl font-mono tracking-widest text-foreground">
              {publicKey ? generateSecurityCode(publicKey) : 'Generating...'}
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Compare this code with your contact to verify encryption.
            </p>
          </div>

          {keyError && (
            <p className="text-sm text-destructive" role="alert">{keyError}</p>
          )}
        </>
      )}
    </div>
  )
}
