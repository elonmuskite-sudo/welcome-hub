import { useEffect, useRef, useState } from 'react'
import { Camera, IdCard, LoaderCircle, Zap, ShieldCheck } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../lib/AuthContext'
import { appwriteData, isAppwriteAuthEnabled } from '../../../lib/appwrite'
import VerificationBadge from '../VerificationBadge'

const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model'
const DOCUMENT_TYPES = [
  { value: 'passport', label: 'Passport' },
  { value: 'national_id', label: 'National ID card' },
  { value: 'drivers_licence', label: 'Driving licence' },
]
const ACCEPTED_IMAGE_TYPES = 'image/jpeg,image/png,image/webp'

let faceApiPromise
async function loadFaceApi() {
  if (!faceApiPromise) {
    faceApiPromise = (async () => {
      const faceapi = await import('@vladmandic/face-api')
      await Promise.all([
        faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      ])
      return faceapi
    })()
  }
  return faceApiPromise
}

// Returns the face descriptor plus the detector's confidence, or null when no
// face is present. The confidence doubles as the automated instant-tier score.
async function detectFace(faceapi, blob) {
  const img = await faceapi.bufferToImage(blob)
  const result = await faceapi.detectSingleFace(img).withFaceLandmarks().withFaceDescriptor()
  if (!result) return null
  return { descriptor: result.descriptor, score: result.detection?.score ?? 1 }
}

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
  const [mode, setMode] = useState('instant')
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

  const uploadIdentityFile = async (blob, fileName, mimeType) => {
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

  // Tier 1 — Instant: an on-device face check auto-approves the caller's own row.
  const submitInstant = async () => {
    if (!selfie || busy) return
    setError(''); setInfo('')
    try {
      setBusy('Checking your selfie…')
      const faceapi = await loadFaceApi()
      const probe = await detectFace(faceapi, selfie)
      if (!probe) throw new Error('No face found in your selfie. Try again in good light.')
      const score = Number(probe.score.toFixed(3))

      setBusy('Uploading securely…')
      const selfiePath = await uploadIdentityFile(selfie, `selfie-${Date.now()}.jpg`, 'image/jpeg')

      if (isAppwriteAuthEnabled()) {
        const { record: result } = await appwriteData('verification.instant', { selfiePath, matchScore: score })
        setRecord(result)
      } else {
        const { error: rpcError } = await supabase.rpc('submit_instant_identity_verification', {
          _selfie_path: selfiePath, _match_score: score,
        })
        if (rpcError) throw rpcError
        setRecord({ status: 'approved', tier: 'instant', match_score: score })
      }
      setSelfie(null)
      setInfo('Identity verified instantly.')
    } catch (err) {
      setError(err.message || 'Instant verification could not be completed.')
    } finally {
      setBusy('')
    }
  }

  // Tier 2 — Manual: structured form + government ID + selfie, held for admin review.
  const submitManual = async () => {
    if (!selfie || !idDoc || busy) return
    if (!form.fullLegalName.trim() || !form.dateOfBirth || !form.documentNumber.trim() || !form.issuingCountry.trim()) {
      setError('Complete every field, attach your government ID and take a selfie.')
      return
    }
    setError(''); setInfo('')
    try {
      setBusy('Checking your photos…')
      const faceapi = await loadFaceApi()
      const [selfieFace, idFace] = await Promise.all([
        detectFace(faceapi, selfie),
        detectFace(faceapi, idDoc),
      ])
      if (!selfieFace) throw new Error('No face found in your selfie. Try again in good light.')
      const distance = idFace ? faceapi.euclideanDistance(selfieFace.descriptor, idFace.descriptor) : null
      const score = distance == null ? null : Math.max(0, Math.min(1, 1 - distance))

      setBusy('Uploading securely…')
      const stamp = Date.now()
      const idExt = (idDoc.name?.split('.').pop() || 'jpg').toLowerCase()
      const selfiePath = await uploadIdentityFile(selfie, `selfie-${stamp}.jpg`, 'image/jpeg')
      const idPath = await uploadIdentityFile(idDoc, `id-${stamp}.${idExt}`, idDoc.type || 'image/jpeg')

      const details = {
        tier: 'manual',
        matchScore: score == null ? null : Number(score.toFixed(3)),
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
          match_score: details.matchScore,
          selfie_path: selfiePath, id_document_path: idPath,
          full_legal_name: details.fullLegalName,
          date_of_birth: details.dateOfBirth,
          document_type: details.documentType,
          document_number: details.documentNumber,
          issuing_country: details.issuingCountry,
          reviewer_note: null, reviewed_by: null, reviewed_at: null,
        }, { onConflict: 'user_id' })
        if (insError) throw insError
        setRecord({ status: 'pending', tier: 'manual', match_score: details.matchScore })
      }
      setSelfie(null)
      setIdDoc(null)
      setForm(EMPTY_FORM)
      setInfo('Your documents were submitted for admin review.')
    } catch (err) {
      setError(err.message || 'Verification could not be submitted.')
    } finally {
      setBusy('')
    }
  }

  const status = record?.status
  const canSubmit = !status || status === 'rejected'
  const tierLabel = record?.tier === 'instant' ? 'instant' : 'manual review'

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
      <div className="flex items-center gap-2 rounded-2xl border border-border bg-muted/30 p-4">
        <VerificationBadge userId={user?.id} className="w-6 h-6" />
        <div>
          {status && (
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {status === 'approved' ? 'Verified' : status === 'pending' ? 'Pending Verification' : 'Not verified'}
            </p>
          )}
          <p className="text-sm text-foreground">
            {status === 'approved'
              ? `Your identity is verified via ${tierLabel}. The blue verified check is shown on your profile.`
              : status === 'pending'
                ? 'Your documents were received and are waiting for admin review. The blue verified check appears once an admin approves them; this page updates automatically.'
                : status === 'rejected'
                  ? `Your documents were not accepted${record.reviewer_note ? ` — reason: ${record.reviewer_note}` : ''}. Please submit again.`
                  : 'Verify your identity to earn the blue verified check. Instant verification is automatic; manual verification is reviewed by an admin.'}
          </p>
        </div>
      </div>

      {canSubmit && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => { setMode('instant'); setError('') }}
              className={`flex flex-col items-start gap-1 rounded-2xl border p-3 text-left transition ${mode === 'instant' ? 'border-primary bg-primary/10' : 'border-border bg-card hover:bg-muted/40'}`}
            >
              <span className="flex items-center gap-2 text-sm font-semibold text-foreground"><Zap className="w-4 h-4 text-primary" /> Instant</span>
              <span className="text-xs text-muted-foreground">Automated selfie check. Verified immediately.</span>
            </button>
            <button
              onClick={() => { setMode('manual'); setError('') }}
              className={`flex flex-col items-start gap-1 rounded-2xl border p-3 text-left transition ${mode === 'manual' ? 'border-primary bg-primary/10' : 'border-border bg-card hover:bg-muted/40'}`}
            >
              <span className="flex items-center gap-2 text-sm font-semibold text-foreground"><ShieldCheck className="w-4 h-4 text-primary" /> Manual</span>
              <span className="text-xs text-muted-foreground">Government ID + selfie. Reviewed by an admin.</span>
            </button>
          </div>

          {SelfieCard}

          {mode === 'manual' && (
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
          )}

          {mode === 'manual' && (
            <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
              <p className="flex items-center gap-2 font-semibold text-foreground"><IdCard className="w-4 h-4" /> Upload your government ID</p>
              <input type="file" accept={ACCEPTED_IMAGE_TYPES} onChange={(e) => setIdDoc(e.target.files?.[0] || null)} className="text-sm" />
              <p className="text-xs text-muted-foreground">A clear photo of the photo page of your passport, national ID or driving licence.</p>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
          {info && <p className="text-sm text-primary">{info}</p>}

          {mode === 'instant' ? (
            <button onClick={submitInstant} disabled={!selfie || !!busy}
              className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">
              {busy ? <><LoaderCircle className="w-4 h-4 animate-spin" /> {busy}</> : 'Verify instantly'}
            </button>
          ) : (
            <button onClick={submitManual} disabled={!selfie || !idDoc || !!busy}
              className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">
              {busy ? <><LoaderCircle className="w-4 h-4 animate-spin" /> {busy}</> : 'Submit for admin review'}
            </button>
          )}
          <p className="text-xs text-muted-foreground">
            Face matching runs on your device. Your photos are stored privately and only reviewers (for manual submissions) can see them.
          </p>
        </>
      )}
    </div>
  )
}
