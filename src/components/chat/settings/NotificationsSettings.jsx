import { useState, useCallback, useEffect } from 'react'
import { useSetting } from '../../../hooks/useSetting'
import { listNotificationTones, playNotificationTone } from '../../../lib/notification-tones'
import { Volume2, VolumeX, Bell, Play, Check, MessageSquareText, Phone } from 'lucide-react'
import SettingsRow from './SettingsRow'
import * as Switch from '@radix-ui/react-switch'
import { supabase } from '../../../lib/supabase'
import { isAppwriteAuthEnabled } from '../../../lib/appwrite'
import { enableCallAlerts } from '../../../lib/callPush'

export default function NotificationsSettings() {
  const [notificationSound, setNotificationSound] = useSetting('notificationSound', true)
  const [notificationTone, setNotificationTone] = useSetting('notificationTone', 'chime')
  const [notificationVolume, setNotificationVolume] = useSetting('notificationVolume', 0.5)
  const [playingId, setPlayingId] = useState(null)
  const [phone, setPhone] = useState('')
  const [pendingPhone, setPendingPhone] = useState('')
  const [phoneCode, setPhoneCode] = useState('')
  const [phoneVerified, setPhoneVerified] = useState(false)
  const [smsOptIn, setSmsOptIn] = useState(false)
  const [smsBusy, setSmsBusy] = useState(false)
  const [smsError, setSmsError] = useState('')
  const [smsNotice, setSmsNotice] = useState('')
  const [callAlertsEnabled, setCallAlertsEnabled] = useState(() => {
    try { return window.localStorage.getItem('nexus-call-alerts-enabled') === 'true' } catch { return false }
  })
  const [callAlertsBusy, setCallAlertsBusy] = useState(false)
  const [callAlertsError, setCallAlertsError] = useState('')

  const handleEnableCallAlerts = useCallback(async () => {
    setCallAlertsBusy(true)
    setCallAlertsError('')
    try {
      await enableCallAlerts()
      window.localStorage.setItem('nexus-call-alerts-enabled', 'true')
      setCallAlertsEnabled(true)
    } catch (error) {
      setCallAlertsError(error.message || 'Background call alerts could not be enabled.')
    } finally {
      setCallAlertsBusy(false)
    }
  }, [])

  useEffect(() => {
    if (!supabase || isAppwriteAuthEnabled()) return undefined
    let active = true
    supabase.auth.getUser().then(({ data, error }) => {
      if (error) throw error
      if (!active) return
      const authUser = data.user
      setPhone(authUser?.phone || '')
      setPhoneVerified(Boolean(authUser?.phone_confirmed_at))
      setSmsOptIn(authUser?.user_metadata?.sms_transactional_opt_in === true)
    }).catch((error) => {
      if (active) setSmsError(error.message || 'Could not load SMS notification settings.')
    })
    return () => { active = false }
  }, [])

  const requestPhoneVerification = async () => {
    const normalized = phone.trim()
    if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
      setSmsError('Enter a valid international phone number in E.164 format, such as +14155552671.')
      return
    }
    setSmsBusy(true)
    setSmsError('')
    setSmsNotice('')
    try {
      const { error } = await supabase.auth.updateUser({ phone: normalized })
      if (error) throw error
      setPendingPhone(normalized)
      setSmsNotice('A verification code was sent by SMS. Enter it here to confirm this number.')
    } catch (error) {
      setSmsError(error.message || 'Could not send a phone verification code.')
    } finally {
      setSmsBusy(false)
    }
  }

  const confirmPhone = async () => {
    if (!/^\d{6,8}$/.test(phoneCode)) {
      setSmsError('Enter the SMS verification code.')
      return
    }
    setSmsBusy(true)
    setSmsError('')
    setSmsNotice('')
    try {
      const { error } = await supabase.auth.verifyOtp({
        phone: pendingPhone,
        token: phoneCode,
        type: 'phone_change',
      })
      if (error) throw error
      const { data, error: userError } = await supabase.auth.getUser()
      if (userError) throw userError
      setPhone(data.user?.phone || pendingPhone)
      setPhoneVerified(Boolean(data.user?.phone_confirmed_at))
      setPendingPhone('')
      setPhoneCode('')
      setSmsNotice('Your phone number is verified.')
    } catch (error) {
      setSmsError(error.message || 'Could not verify this phone number.')
    } finally {
      setSmsBusy(false)
    }
  }

  const resendPhoneVerification = async () => {
    setSmsBusy(true)
    setSmsError('')
    setSmsNotice('')
    try {
      const { error } = await supabase.auth.updateUser({ phone: pendingPhone })
      if (error) throw error
      setSmsNotice('A new verification code was sent by SMS.')
    } catch (error) {
      setSmsError(error.message || 'Could not resend the phone verification code.')
    } finally {
      setSmsBusy(false)
    }
  }

  const updateSmsConsent = async (checked) => {
    if (checked && !phoneVerified) {
      setSmsError('Verify a phone number before opting in to SMS alerts.')
      return
    }
    setSmsBusy(true)
    setSmsError('')
    setSmsNotice('')
    try {
      const { data, error: userError } = await supabase.auth.getUser()
      if (userError) throw userError
      const { error } = await supabase.auth.updateUser({
        data: { ...userData(data.user?.user_metadata), sms_transactional_opt_in: checked },
      })
      if (error) throw error
      setSmsOptIn(checked)
      setSmsNotice(checked ? 'SMS alerts enabled.' : 'SMS alerts disabled.')
    } catch (error) {
      setSmsError(error.message || 'Could not update SMS consent.')
    } finally {
      setSmsBusy(false)
    }
  }

  const tones = listNotificationTones()
  const supportsSmsSettings = Boolean(supabase) && !isAppwriteAuthEnabled()

  const handlePreviewTone = useCallback(async (toneId) => {
    setPlayingId(toneId)
    await playNotificationTone(toneId, notificationVolume)
    setTimeout(() => setPlayingId((curr) => (curr === toneId ? null : curr)), 650)
  }, [notificationVolume])

  const handleToggleSound = useCallback((checked) => {
    setNotificationSound(checked)
    if (checked) {
      playNotificationTone(notificationTone, notificationVolume)
    }
  }, [setNotificationSound, notificationTone, notificationVolume])

  const handleSelectTone = useCallback((toneId) => {
    setNotificationTone(toneId)
    handlePreviewTone(toneId)
  }, [setNotificationTone, handlePreviewTone])

  return (
    <div className="space-y-8">
      <SettingsRow
        label="Background call alerts"
        description="Receive a push alert when someone calls while Nexus Chat is closed."
        icon={<Phone className="w-5 h-5" />}
      >
        <div className="w-full space-y-3">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              {callAlertsEnabled ? 'Enabled on this device' : 'Not enabled on this device'}
            </p>
            <button
              type="button"
              onClick={handleEnableCallAlerts}
              disabled={callAlertsBusy}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {callAlertsBusy ? 'Enabling…' : callAlertsEnabled ? 'Refresh device registration' : 'Enable call alerts'}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Allow system notifications. Calls can be answered after opening the app from the alert.
          </p>
          {callAlertsError && <p role="alert" className="text-sm text-destructive">{callAlertsError}</p>}
        </div>
      </SettingsRow>
      {supportsSmsSettings && (
        <section className="rounded-2xl border border-border bg-card p-5" aria-labelledby="sms-notifications-title">
          <div className="flex items-start gap-3">
            <MessageSquareText className="mt-0.5 h-5 w-5 text-primary" />
            <div className="min-w-0 flex-1">
              <h3 id="sms-notifications-title" className="font-semibold text-foreground">SMS notifications</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Verify a phone number to receive optional sign-in security alerts and identity-review status updates.
                Email sign-in is unchanged. No marketing texts are sent.
              </p>
              <label htmlFor="sms-phone" className="mt-4 block text-sm font-medium text-foreground">Mobile number</label>
              <div className="mt-1 flex flex-col gap-2 sm:flex-row">
                <input
                  id="sms-phone"
                  type="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="+14155552671"
                  disabled={phoneVerified || Boolean(pendingPhone) || smsBusy}
                  className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground disabled:opacity-70"
                />
                {!phoneVerified && !pendingPhone && (
                  <button
                    type="button"
                    onClick={requestPhoneVerification}
                    disabled={smsBusy}
                    className="rounded-lg border border-border bg-muted px-4 py-2 text-sm font-semibold text-foreground disabled:opacity-50"
                  >
                    {smsBusy ? 'Sending…' : 'Verify number'}
                  </button>
                )}
                {phoneVerified && (
                  <button
                    type="button"
                    onClick={() => { setPhoneVerified(false); setPhone(''); setSmsOptIn(false); updateSmsConsent(false) }}
                    disabled={smsBusy}
                    className="rounded-lg border border-border bg-muted px-4 py-2 text-sm font-semibold text-foreground disabled:opacity-50"
                  >
                    Change number
                  </button>
                )}
              </div>
              {pendingPhone && (
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <label className="sr-only" htmlFor="sms-verification-code">SMS verification code</label>
                  <input
                    id="sms-verification-code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={phoneCode}
                    onChange={(event) => setPhoneCode(event.target.value.replace(/\D/g, '').slice(0, 8))}
                    placeholder="Verification code"
                    className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground"
                  />
                  <button
                    type="button"
                    onClick={confirmPhone}
                    disabled={smsBusy}
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                  >
                    {smsBusy ? 'Verifying…' : 'Confirm number'}
                  </button>
                  <button
                    type="button"
                    onClick={resendPhoneVerification}
                    disabled={smsBusy}
                    className="rounded-lg border border-border bg-muted px-4 py-2 text-sm font-semibold text-foreground disabled:opacity-50"
                  >
                    Resend code
                  </button>
                  <button
                    type="button"
                    onClick={() => { setPendingPhone(''); setPhoneCode(''); setSmsNotice('') }}
                    disabled={smsBusy}
                    className="rounded-lg border border-border bg-muted px-4 py-2 text-sm font-semibold text-foreground disabled:opacity-50"
                  >
                    Change number
                  </button>
                </div>
              )}
              {phoneVerified && (
                <label className="mt-4 flex items-start gap-3 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={smsOptIn}
                    onChange={(event) => updateSmsConsent(event.target.checked)}
                    disabled={smsBusy}
                    className="mt-0.5 accent-primary"
                  />
                  <span>
                    Send me transactional SMS sign-in alerts and identity-review status updates. Message and data
                    rates may apply. Reply STOP to opt out or turn this off here. Consent is optional and is not
                    required to use the app.
                  </span>
                </label>
              )}
              {smsError && <p role="alert" className="mt-3 text-sm text-destructive">{smsError}</p>}
              {smsNotice && <p role="status" className="mt-3 text-sm text-primary">{smsNotice}</p>}
            </div>
          </div>
        </section>
      )}
      <SettingsRow
        label="Notification sounds"
        description="Play a tone when a new notification appears"
        icon={<Bell className="w-5 h-5" />}
      >
        <div className="flex items-center justify-between gap-4 py-1 w-full">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            {notificationSound ? <Volume2 className="w-4 h-4 text-primary" /> : <VolumeX className="w-4 h-4 text-muted-foreground" />}
            <span>{notificationSound ? 'Enabled' : 'Muted'}</span>
          </div>
          <Switch.Root
            checked={notificationSound}
            onCheckedChange={handleToggleSound}
            className="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input"
          >
            <Switch.Thumb
              className={`pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0`}
            />
          </Switch.Root>
        </div>
      </SettingsRow>

      <div>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-foreground">Notification tone</h3>
            <p className="mt-1 text-sm text-muted-foreground">Choose the sound that plays for incoming popups and system notifications.</p>
          </div>
        </div>
        <div
          className="grid gap-3 sm:grid-cols-2"
          aria-label="Notification tone selection"
        >
          {tones.map((tone) => {
            const selected = notificationTone === tone.id
            const isPlaying = playingId === tone.id
            const disabled = !notificationSound && !selected
            return (
              <button
                key={tone.id}
                type="button"
                onClick={() => handleSelectTone(tone.id)}
                disabled={disabled}
                className={`group relative flex items-center justify-between gap-3 rounded-2xl border p-4 text-left transition disabled:opacity-50 disabled:cursor-not-allowed ${
                  selected
                    ? 'border-primary bg-primary/5 ring-2 ring-primary/30 shadow-sm'
                    : 'border-border bg-card hover:border-muted-foreground/30 hover:bg-muted/40'
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className={`font-medium truncate ${selected ? 'text-primary' : 'text-foreground'}`}>{tone.name}</p>
                    {selected && (
                      <span className="inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground p-0.5">
                        <Check className="w-3 h-3" />
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground truncate">{tone.description}</p>
                </div>
                <span
                  className={`inline-flex h-9 w-9 items-center justify-center rounded-full border transition ${
                    isPlaying
                      ? 'border-primary bg-primary text-primary-foreground animate-pulse'
                      : 'border-border bg-muted text-muted-foreground group-hover:border-primary group-hover:text-primary'
                  }`}
                  aria-label={`Preview ${tone.name}`}
                >
                  <Play className="w-4 h-4" />
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <SettingsRow
        label="Notification volume"
        description="How loud to play notification tones"
        icon={<Volume2 className="w-5 h-5" />}
      >
        <div className="w-full py-2">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 text-sm">
              <VolumeX className="w-4 h-4 text-muted-foreground" />
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={notificationVolume}
                onChange={(e) => setNotificationVolume(parseFloat(e.target.value))}
                onMouseUp={() => playNotificationTone(notificationTone, notificationVolume)}
                onKeyUp={() => playNotificationTone(notificationTone, notificationVolume)}
                className="w-48 sm:w-64 accent-primary"
                aria-label="Notification volume"
              />
              <Volume2 className="w-4 h-4 text-muted-foreground" />
            </div>
            <span className="text-sm font-medium tabular-nums text-muted-foreground w-12 text-right">
              {Math.round(notificationVolume * 100)}%
            </span>
          </div>
        </div>
      </SettingsRow>
    </div>
  )
}

function userData(metadata) {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {}
}
