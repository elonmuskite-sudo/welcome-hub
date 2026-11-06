import { useEffect, useRef, useState } from 'react'
import { Camera, IdCard, LoaderCircle } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../lib/AuthContext'
import { appwriteData, isAppwriteAuthEnabled } from '../../../lib/appwrite'
import VerificationBadge from '../VerificationBadge'
import KycWizard from '../../kyc/KycWizard'

const DOCUMENT_TYPES = [
  { value: 'passport', label: 'Passport' },
  { value: 'national_id', label: 'National ID card' },
  { value: 'drivers_licence', label: 'Driving licence' },
]
const ACCEPTED_IMAGE_TYPES = 'image/jpeg,image/png,image/webp'
const MAX_IDENTITY_IMAGE_BYTES = 15 * 1024 * 1024

const EMPTY_FORM = {
  fullLegalName: '',
  dateOfBirth: '',
  documentType: 'passport',
  documentNumber: '',
  issuingCountry: '',
}

export default function VerificationSettings() {
  const { user } = useAuth()
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const [record, setRecord] = useState(null)
  const [selfie, setSelfie] = useState(null)
  const [selfiePreview, setSelfiePreview] = useState('')
  const [idDoc, setIdDoc] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  const loadRecord = async () => {
    try {
      if (isAppwriteAuthEnabled()) {
        const { record: result } = await appwriteData('verification.get')
        setRecord(result)
      } else {
        const { data, error: queryError } = await supabase.from('identity_verifications')
          .select('status, tier, match_score, reviewer_note, full_legal_name, date_of_birth, document_type, document_number, issuing_country, created_at')
          .eq('user_id', user.id).maybeSingle()
        if (queryError) throw queryError
        setRecord(data)
      }
    } catch (loadError) {
      setError(loadError.message || 'Could not load verification status.')
    }
  }

  useEffect(() => {
    if ((!supabase && !isAppwriteAuthEnabled()) || !user?.id) return undefined
    loadRecord()
    const timer = setInterval(loadRecord, 10000)
    return () => { clearInterval(timer); streamRef.current?.getTracks().forEach((t) => t.stop()) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  useEffect(() => {
    if (!selfie) { setSelfiePreview(''); return undefined }
    const url = URL.createObjectURL(selfie)
    setSelfiePreview(url)
    return () => URL.revokeObjectURL(url)
  }, [selfie])

  const startCamera = async () => {
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
      streamRef.current = stream
      videoRef.current.srcObject = stream
      await videoRef.current.play()
    } catch {
      setError('Camera access was blocked. Allow camera access and try again.')
    }
  }

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }

  const capture = () => {
    const v = videoRef.current
    if (!v?.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = v.videoWidth; canvas.height = v.videoHeight
    canvas.getContext('2d').drawImage(v, 0, 0)
    canvas.toBlob((blob) => setSelfie(blob), 'image/jpeg', 0.92)
    stopCamera()
  }

  const selectIdentityDocument = (event) => {
    const file = event.target.files?.[0] || null
    event.target.value = ''
    if (!file) return
    if (!ACCEPTED_IMAGE_TYPES.split(',').includes(file.type)) {
      setIdDoc(null)
      setError('Choose a JPG, PNG, or WebP image of your identity document.')
      return
    }
    if (file.size < 1 || file.size > MAX_IDENTITY_IMAGE_BYTES) {
      setIdDoc(null)
      setError('Identity images must be smaller than 15 MB.')
      return
    }
    setError('')
    setIdDoc(file)
  }

  const uploadIdentityFile = async (blob, fileName, mimeType) => {
    if (!blob || blob.size < 1 || blob.size > MAX_IDENTITY_IMAGE_BYTES) {
      throw new Error('Identity images must be smaller than 15 MB.')
    }
    if (!ACCEPTED_IMAGE_TYPES.split(',').includes(mimeType)) {
      throw new Error('Choose a JPG, PNG, or WebP image of your identity document.')
    }
    if (isAppwriteAuthEnabled()) {
      if (!supabase) throw new Error('Secure identity uploads are not configured.')
      const { path, token } = await appwriteData('verification.upload.prepare', {
        fileName, mimeType, sizeBytes: blob.size,
      })
      const { error: uploadError } = await supabase.storage.from('identity-docs')
        .uploadToSignedUrl(path, token, blob, { contentType: mimeType })
      if (uploadError) throw uploadError
      return path
    }
    const path = `${user.id}/${fileName}`
    const { error: uploadError } = await supabase.storage.from('identity-docs').upload(path, blob, { contentType: mimeType })
    if (uploadError) throw uploadError
    return path
  }

  const submitManual = async () => {
    if (!selfie || !idDoc || busy) return
    if (!form.fullLegalName.trim() || !form.dateOfBirth || !form.documentNumber.trim() || !form.issuingCountry.trim()) {
      setError('Complete every field, attach your government ID and take a selfie.')
      return
    }
    setError(''); setInfo('')
    try {
      setBusy('Uploading securely…')
      const stamp = Date.now()
      const idExt = (idDoc.name?.split('.').pop() || 'jpg').toLowerCase()
      const selfiePath = await uploadIdentityFile(selfie, `selfie-${stamp}.jpg`, 'image/jpeg')
      const idPath = await uploadIdentityFile(idDoc, `id-${stamp}.${idExt}`, idDoc.type || 'image/jpeg')

      const details = {
        tier: 'manual',
        fullLegalName: form.fullLegalName.trim(),
        dateOfBirth: form.dateOfBirth,
        documentType: form.documentType,
        documentNumber: form.documentNumber.trim(),
        issuingCountry: form.issuingCountry.trim(),
      }

      if (isAppwriteAuthEnabled()) {
        const { record: result } = await appwriteData('verification.submit', { ...details, selfiePath, idPath })
        setRecord(result)
      } else {
        const { error: insError } = await supabase.from('identity_verifications').upsert({
          user_id: user.id, status: 'pending', tier: 'manual',
          match_score: null,
          selfie_path: selfiePath, id_document_path: idPath,
          full_legal_name: details.fullLegalName,
          date_of_birth: details.dateOfBirth,
          document_type: details.documentType,
          document_number: details.documentNumber,
          issuing_country: details.issuingCountry,
          reviewer_note: null, reviewed_by: null, reviewed_at: null,
        }, { onConflict: 'user_id' })
        if (insError) throw insError
        setRecord({ status: 'pending', tier: 'manual', match_score: null })
      }
      setSelfie(null)
      setIdDoc(null)
      setForm(EMPTY_FORM)
      setInfo('Your submission is pending review by an administrator. Automated identity checks are not enabled.')
    } catch (err) {
      setError(err.message || 'Verification could not be submitted.')
    } finally {
      setBusy('')
    }
  }

  const status = record?.status
  const canSubmit = !status || status === 'rejected'

  const SelfieCard = (
    <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
      <p className="flex items-center gap-2 font-semibold text-foreground"><Camera className="w-4 h-4" /> Take a clear selfie</p>
      {selfie ? (
        <div className="flex items-center gap-3">
          {selfiePreview && <img src={selfiePreview} alt="Your selfie" className="h-24 rounded-xl" />}
          <button onClick={() => { setSelfie(null); startCamera() }} className="text-sm text-primary hover:underline">Retake</button>
        </div>
      ) : (
        <>
          <video ref={videoRef} playsInline muted className="w-full max-w-sm rounded-xl bg-muted" />
          <div className="flex gap-2">
            <button onClick={startCamera} className="rounded-full border border-border px-4 py-2 text-sm">Start camera</button>
            <button onClick={capture} className="rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground">Capture</button>
          </div>
        </>
      )}
    </div>
  )

  return (
    <div className="space-y-5">
      <KycWizard />
      <div className="flex items-center gap-2 rounded-2xl border border-border bg-muted/30 p-4">
        <VerificationBadge userId={user?.id} className="w-6 h-6" />
        <div>
          {status && (
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {status === 'approved' ? 'Verified' : status === 'pending' ? 'Pending Verification' : status === 'rejected' ? 'Rejected' : 'Not Verified'}
            </p>
          )}
          <p className="text-sm text-foreground">
            {status === 'approved'
              ? 'An administrator approved your identity submission. The blue verified check is shown on your profile.'
              : status === 'pending'
                ? 'Your documents were received and are waiting for admin review. The blue verified check appears once an admin approves them; this page updates automatically.'
                : status === 'rejected'
                  ? `Your submission was not accepted${record.reviewer_note ? ` — reason: ${record.reviewer_note}` : ''}. Please submit again for manual review.`
                  : 'This option sends a government ID and live selfie for administrator review. Use the Idswyft option above for provider-based document and liveness checks.'}
          </p>
        </div>
      </div>

      {canSubmit && (
        <>
          {SelfieCard}

          <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
            <p className="font-semibold text-foreground">Identity details</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                <span className="mb-1 block text-muted-foreground">Full legal name</span>
                <input value={form.fullLegalName} onChange={(e) => setForm({ ...form, fullLegalName: e.target.value })}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm" placeholder="As shown on your ID" />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-muted-foreground">Date of birth</span>
                <input type="date" value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm" />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-muted-foreground">Document type</span>
                <select value={form.documentType} onChange={(e) => setForm({ ...form, documentType: e.target.value })}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm">
                  {DOCUMENT_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-muted-foreground">Document number</span>
                <input value={form.documentNumber} onChange={(e) => setForm({ ...form, documentNumber: e.target.value })}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm" />
              </label>
              <label className="text-sm sm:col-span-2">
                <span className="mb-1 block text-muted-foreground">Issuing country</span>
                <input value={form.issuingCountry} onChange={(e) => setForm({ ...form, issuingCountry: e.target.value })}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm" placeholder="e.g. United Kingdom" />
              </label>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
            <p className="flex items-center gap-2 font-semibold text-foreground"><IdCard className="w-4 h-4" /> Upload your government ID</p>
            <input type="file" accept={ACCEPTED_IMAGE_TYPES} onChange={selectIdentityDocument} className="text-sm" />
            <p className="text-xs text-muted-foreground">A clear photo of the photo page of your passport, national ID or driving licence. Maximum file size: 15 MB.</p>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {info && <p className="text-sm text-primary">{info}</p>}

          <button onClick={submitManual} disabled={!selfie || !idDoc || !!busy}
            className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">
            {busy ? <><LoaderCircle className="w-4 h-4 animate-spin" /> {busy}</> : 'Submit for admin review'}
          </button>
          <p className="text-xs text-muted-foreground">
            Manual submissions remain pending until an administrator reviews them. Idswyft KYC results are recorded separately and do not automatically grant the existing profile badge.
          </p>
        </>
      )}
    </div>
  )
}
