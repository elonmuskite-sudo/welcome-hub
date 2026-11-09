import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  CheckCircle2,
  FileImage,
  FileText,
  LoaderCircle,
  RotateCcw,
  ShieldCheck,
  UploadCloud,
  X,
} from 'lucide-react'
import { getKycSession, startKycSession, uploadKycFile } from '../../lib/idswyftKyc'

const ACCEPTED_DOCUMENT_TYPES = ['image/jpeg', 'image/png', 'application/pdf']
const ACCEPTED_SELFIE_TYPES = ['image/jpeg', 'image/png']
const MAX_FILE_BYTES = 4 * 1024 * 1024
const STATUS_LABELS = {
  AWAITING_FRONT: 'Front of ID needed',
  AWAITING_BACK: 'Back of ID needed',
  AWAITING_LIVE: 'Selfie needed',
  PROCESSING: 'Verification in progress',
  APPROVED: 'Approved',
  HARD_REJECTED: 'Not approved',
  SOFT_REJECTED: 'Needs review',
  LIVENESS_FAILED: 'Liveness check failed',
  REVIEW_REQUIRED: 'Needs review',
  FAILED: 'Verification failed',
  EXPIRED: 'Session expired',
}
const FINAL_STATUSES = new Set([
  'APPROVED', 'HARD_REJECTED', 'LIVENESS_FAILED', 'FAILED', 'EXPIRED',
])

function stepForStatus(status) {
  if (status === 'AWAITING_FRONT') return 2
  if (status === 'AWAITING_BACK') return 3
  if (status === 'AWAITING_LIVE') return 4
  return 5
}

function statusMessage(status) {
  if (status === 'APPROVED') return 'Your identity was verified successfully.'
  if (status === 'LIVENESS_FAILED') return 'The live selfie check did not pass. Start a new session and try again in good lighting.'
  if (status === 'HARD_REJECTED') return 'The provider could not verify these documents. You can start a new session and retry.'
  if (status === 'SOFT_REJECTED' || status === 'REVIEW_REQUIRED') return 'Your submission needs additional review. Check back for an updated result.'
  if (status === 'EXPIRED') return 'This session expired. Start a new verification to continue.'
  if (status === 'FAILED') return 'This verification could not be completed. Start a new session to retry.'
  return 'Your documents were received. We are waiting for the verification result.'
}

function FilePreview({ file, previewUrl }) {
  if (!file) return null
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-background p-3">
      {previewUrl && file.type.startsWith('image/')
        ? <img src={previewUrl} alt="Selected document preview" className="h-16 w-20 rounded-lg object-cover" />
        : previewUrl && file.type === 'application/pdf'
          ? <iframe src={previewUrl} title="Selected PDF document preview" className="h-16 w-20 rounded-lg border-0" />
          : file.type === 'application/pdf'
            ? <FileText className="h-8 w-8 text-primary" aria-hidden="true" />
            : <FileImage className="h-8 w-8 text-primary" aria-hidden="true" />}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{file.name}</p>
        <p className="text-xs text-muted-foreground">{(file.size / (1024 * 1024)).toFixed(1)} MB</p>
      </div>
    </div>
  )
}

export default function KycWizard() {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const [session, setSession] = useState(null)
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [open, setOpen] = useState(false)
  const [consent, setConsent] = useState(false)
  const [step, setStep] = useState(1)
  const [file, setFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [cameraActive, setCameraActive] = useState(false)
  const [error, setError] = useState('')
  const [pollError, setPollError] = useState('')

  useEffect(() => {
    let active = true
    getKycSession()
      .then(({ session: result }) => {
        if (!active || !result) return
        setSession(result)
        setStep(stepForStatus(result.status))
      })
      .catch((statusError) => {
        if (active) setError(statusError.message || 'Could not load verification status.')
      })
      .finally(() => { if (active) setLoadingStatus(false) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!file || (!file.type.startsWith('image/') && file.type !== 'application/pdf')) {
      setPreviewUrl('')
      return undefined
    }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
  }, [])

  useEffect(() => {
    if (!cameraActive || !videoRef.current || !streamRef.current) return
    videoRef.current.srcObject = streamRef.current
    videoRef.current.play().catch(() => {
      setError('The camera preview could not start. Choose a selfie file instead.')
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
      setCameraActive(false)
    })
  }, [cameraActive])

  useEffect(() => {
    if (!open || step !== 5 || !session?.id || FINAL_STATUSES.has(session.status)) return undefined
    let active = true
    let timer
    const poll = async () => {
      let updated
      try {
        ({ session: updated } = await getKycSession(session.id))
        if (!active) return
        if (updated) setSession(updated)
        setPollError('')
      } catch (statusError) {
        if (active) setPollError(statusError.message || 'Status update failed; checking again shortly.')
      }
      if (active) timer = setTimeout(poll, updated?.status === 'REVIEW_REQUIRED' ? 15000 : 5000)
    }
    timer = setTimeout(poll, 5000)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [open, session?.id, session?.status, step])

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setCameraActive(false)
  }

  const closeWizard = () => {
    stopCamera()
    setOpen(false)
    setError('')
  }

  const startNewSession = async () => {
    if (busy) return
    setError('')
    setBusy(true)
    try {
      const { session: created } = await startKycSession()
      setSession(created)
      setConsent(false)
      setFile(null)
      setStep(2)
    } catch (startError) {
      setError(startError.message || 'Could not start identity verification.')
    } finally {
      setBusy(false)
    }
  }

  const selectFile = (selected) => {
    if (!selected) return
    const acceptedTypes = step === 4 ? ACCEPTED_SELFIE_TYPES : ACCEPTED_DOCUMENT_TYPES
    if (!acceptedTypes.includes(selected.type)) {
      setFile(null)
      setError(step === 4
        ? 'Choose a JPEG or PNG selfie. WebP is not supported.'
        : 'Choose a JPEG, PNG, or PDF document. WebP is not supported.')
      return
    }
    if (selected.size < 1 || selected.size > MAX_FILE_BYTES) {
      setFile(null)
      setError('Choose a file no larger than 4 MB.')
      return
    }
    setError('')
    setFile(selected)
  }

  const startCamera = async () => {
    setError('')
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera capture is not available in this browser. Choose a JPEG or PNG selfie instead.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
      if (!open || step !== 4) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      streamRef.current = stream
      setCameraActive(true)
    } catch {
      setError('Camera access was blocked. Allow camera access or choose a selfie file instead.')
    }
  }

  const captureSelfie = () => {
    const video = videoRef.current
    if (!video?.videoWidth || !video.videoHeight) {
      setError('The camera is not ready yet. Try again in a moment.')
      return
    }
    const canvas = document.createElement('canvas')
    const scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight))
    canvas.width = Math.round(video.videoWidth * scale)
    canvas.height = Math.round(video.videoHeight * scale)
    canvas.getContext('2d')?.drawImage(video, 0, 0)
    canvas.toBlob((blob) => {
      if (!blob) {
        setError('The selfie could not be captured. Try again.')
        return
      }
      setFile(new File([blob], 'selfie.jpg', { type: 'image/jpeg' }))
      setError('')
      stopCamera()
    }, 'image/jpeg', 0.85)
  }

  const uploadStep = async () => {
    if (!file || !session?.id || busy) return
    const stage = step === 2 ? 'front' : step === 3 ? 'back' : 'selfie'
    setError('')
    if (stage === 'selfie') stopCamera()
    setBusy(true)
    try {
      const { session: updated } = await uploadKycFile({ id: session.id, stage, file })
      setSession(updated)
      setFile(null)
      setStep(stepForStatus(updated.status))
    } catch (uploadError) {
      setError(uploadError.message || 'The file could not be uploaded. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const retry = () => {
    setSession(null)
    setFile(null)
    setStep(1)
    setConsent(false)
    setPollError('')
    setError('')
  }

  const stepTitle = step === 2
    ? 'Front of your ID'
    : step === 3
      ? 'Back of your ID'
      : 'Live selfie'
  const isActive = session && !FINAL_STATUSES.has(session.status)
  const canResume = Boolean(isActive)
  const actionLabel = canResume
    ? 'Continue'
    : isActive
      ? 'View status'
      : session
        ? 'View result'
        : 'Start'

  const openWizard = async () => {
    setOpen(true)
    setError('')
    if (!session?.id) return
    try {
      const { session: updated } = await getKycSession(session.id)
      if (updated) {
        setSession(updated)
        setStep(stepForStatus(updated.status))
      }
    } catch (statusError) {
      setError(statusError.message || 'Could not refresh verification status.')
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <ShieldCheck className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-foreground">Automated identity verification</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Verify your ID and selfie securely with our identity verification provider.
          </p>
          {session && (
            <p className="mt-2 text-xs font-medium text-muted-foreground" role="status">
              {STATUS_LABELS[session.status] || 'Verification status updated'}
            </p>
          )}
          {error && !open && <p className="mt-2 text-sm text-destructive" role="alert">{error}</p>}
        </div>
        <button
          type="button"
          onClick={openWizard}
          disabled={loadingStatus}
          className="shrink-0 rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {loadingStatus ? 'Loading…' : actionLabel}
        </button>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) closeWizard()
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="kyc-title"
            className="max-h-[94dvh] w-full max-w-xl overflow-y-auto rounded-t-3xl border border-border bg-card p-5 shadow-2xl sm:rounded-3xl sm:p-6"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                  {step === 1 ? 'Secure identity check' : `Step ${Math.min(step, 5)} of 5`}
                </p>
                <h2 id="kyc-title" className="mt-1 text-xl font-bold text-foreground">
                  {step === 1 ? 'Verify your identity' : step === 5 ? (session?.status === 'APPROVED' ? 'Verification complete' : 'Verification status') : stepTitle}
                </h2>
              </div>
              <button
                type="button"
                onClick={closeWizard}
                aria-label="Close verification"
                className="rounded-full p-2 text-muted-foreground hover:bg-muted"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {step > 1 && step < 5 && (
              <div className="mt-4 flex gap-1" aria-label={`Step ${step} of 5`}>
                {[1, 2, 3, 4, 5].map((item) => (
                  <span key={item} className={`h-1.5 flex-1 rounded-full ${item <= step ? 'bg-primary' : 'bg-muted'}`} />
                ))}
              </div>
            )}

            {step === 1 && (
              <div className="mt-5 space-y-4">
                <p className="text-sm leading-6 text-muted-foreground">
                  You will photograph the front and back of your ID and take a live selfie. Your files are sent directly to Idswyft through our secure server and are not saved to your Nexus chat storage.
                </p>
                <label className="flex items-start gap-3 rounded-2xl border border-border bg-muted/30 p-4 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(event) => setConsent(event.target.checked)}
                    className="mt-1 accent-primary"
                  />
                  <span>
                    I consent to sending my identity documents and selfie to Idswyft for verification. The provider may process and retain them under its applicable privacy policy.
                  </span>
                </label>
                {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                <button
                  type="button"
                  onClick={canResume ? () => setStep(stepForStatus(session.status)) : startNewSession}
                  disabled={busy || (!canResume && !consent)}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground disabled:opacity-50"
                >
                  {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                  {canResume ? 'Continue verification' : 'Agree and continue'}
                </button>
              </div>
            )}

            {(step === 2 || step === 3) && (
              <div className="mt-5 space-y-4">
                <p className="text-sm text-muted-foreground">
                  Use a clear, well-lit image with all four corners visible. Accepted formats: JPEG, PNG, or PDF. Maximum 4 MB per file.
                </p>
                <label
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault()
                    selectFile(event.dataTransfer.files?.[0])
                  }}
                  className="flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border bg-muted/20 p-5 text-center hover:border-primary/60"
                >
                  <UploadCloud className="h-7 w-7 text-primary" aria-hidden="true" />
                  <span className="text-sm font-medium text-foreground">Choose or drop the {step === 2 ? 'front' : 'back'} of your ID</span>
                  <input
                    type="file"
                    accept={ACCEPTED_DOCUMENT_TYPES.join(',')}
                    onChange={(event) => { selectFile(event.target.files?.[0]); event.target.value = '' }}
                    className="sr-only"
                  />
                </label>
                <FilePreview file={file} previewUrl={previewUrl} />
                {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                <div className="flex gap-2">
                  <button type="button" onClick={() => setStep(1)} className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-3 text-sm font-medium text-foreground">
                    <ArrowLeft className="h-4 w-4" /> Back
                  </button>
                  <button
                    type="button"
                    onClick={uploadStep}
                    disabled={!file || busy}
                    className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                  >
                    {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                    {busy ? 'Uploading securely…' : 'Upload and continue'}
                  </button>
                </div>
              </div>
            )}

            {step === 4 && (
              <div className="mt-5 space-y-4">
                <p className="text-sm text-muted-foreground">
                  Face the camera in good lighting, remove sunglasses, and keep your face centered. You can use a JPEG or PNG if camera capture is unavailable.
                </p>
                {cameraActive && (
                  <video ref={videoRef} playsInline muted className="max-h-72 w-full rounded-2xl bg-muted object-cover" />
                )}
                {file && <FilePreview file={file} previewUrl={previewUrl} />}
                <div className="flex flex-wrap gap-2">
                  {!cameraActive && (
                    <button type="button" onClick={startCamera} className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-3 text-sm font-medium text-foreground">
                      <Camera className="h-4 w-4" /> Open camera
                    </button>
                  )}
                  {cameraActive && (
                    <>
                      <button type="button" onClick={captureSelfie} className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground">
                        <Camera className="h-4 w-4" /> Capture selfie
                      </button>
                      <button type="button" onClick={stopCamera} className="rounded-xl border border-border px-4 py-3 text-sm text-foreground">Cancel camera</button>
                    </>
                  )}
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-border px-4 py-3 text-sm font-medium text-foreground">
                    <UploadCloud className="h-4 w-4" /> Choose a selfie
                    <input
                      type="file"
                      accept={ACCEPTED_SELFIE_TYPES.join(',')}
                      onChange={(event) => { selectFile(event.target.files?.[0]); event.target.value = '' }}
                      className="sr-only"
                    />
                  </label>
                </div>
                {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                <div className="flex gap-2">
                  <button type="button" onClick={() => { stopCamera(); setStep(1) }} className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-3 text-sm font-medium text-foreground">
                    <ArrowLeft className="h-4 w-4" /> Back
                  </button>
                  <button
                    type="button"
                    onClick={uploadStep}
                    disabled={!file || busy}
                    className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                  >
                    {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                    {busy ? 'Sending securely…' : 'Submit selfie'}
                  </button>
                </div>
              </div>
            )}

            {step === 5 && (
              <div className="mt-5 space-y-4 text-center">
                <div className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ${session?.status === 'APPROVED' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                  {session?.status === 'APPROVED'
                    ? <CheckCircle2 className="h-7 w-7" />
                    : FINAL_STATUSES.has(session?.status)
                      ? <RotateCcw className="h-7 w-7" />
                      : <LoaderCircle className="h-7 w-7 animate-spin" />}
                </div>
                <p className="font-semibold text-foreground">{STATUS_LABELS[session?.status] || 'Checking verification status'}</p>
                <p className="text-sm text-muted-foreground">{statusMessage(session?.status)}</p>
                {pollError && <p role="alert" className="text-sm text-destructive">{pollError}</p>}
                {!FINAL_STATUSES.has(session?.status) && (
                  <p className="text-xs text-muted-foreground">This page checks for updates automatically every few seconds.</p>
                )}
                {session?.status === 'APPROVED' ? (
                  <button type="button" onClick={closeWizard} className="w-full rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground">Done</button>
                ) : FINAL_STATUSES.has(session?.status) ? (
                  <button type="button" onClick={retry} className="w-full rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground">Start a new verification</button>
                ) : (
                  <button type="button" onClick={closeWizard} className="w-full rounded-xl border border-border px-4 py-3 text-sm font-medium text-foreground">Close and check back later</button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
