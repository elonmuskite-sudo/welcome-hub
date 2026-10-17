import { ExclamationTriangleIcon, XMarkIcon } from '@heroicons/react/24/solid'

// Mandatory warning shown when a looked-up number is not yet in the user's
// contacts and they try to call or message it. "Save First" completes contact
// creation before continuing; "Ignore" proceeds without saving.
// eslint-disable-next-line react/prop-types
export default function UnsavedContactPrompt({ open, contact, action, busy, onSaveFirst, onIgnore, onClose }) {
  if (!open || !contact) return null
  const actionLabel = action === 'call' ? 'call' : 'message'
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="absolute inset-0 cursor-default" onClick={onClose} />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="unsaved-contact-title"
        className="relative z-10 w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl"
      >
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-destructive/10 p-2 text-destructive">
            <ExclamationTriangleIcon className="h-6 w-6" />
          </div>
          <div className="flex-1">
            <h3 id="unsaved-contact-title" className="text-lg font-bold text-foreground">
              Save this contact before you {actionLabel}?
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {contact.name || 'This person'} is not in your contacts yet. Saving them first keeps their identity on
              record and lets you reach them again in an emergency. You can still continue without saving.
            </p>
          </div>
          <button onClick={onClose} className="rounded-full p-1.5 hover:bg-muted" aria-label="Close">
            <XMarkIcon className="h-5 w-5 text-muted-foreground" />
          </button>
        </div>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            onClick={onIgnore}
            disabled={busy}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
          >
            Ignore
          </button>
          <button
            onClick={onSaveFirst}
            disabled={busy}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save First'}
          </button>
        </div>
      </div>
    </div>
  )
}
