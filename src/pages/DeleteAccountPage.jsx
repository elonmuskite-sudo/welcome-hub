import { Link } from 'react-router-dom'
import Header from '../components/Header'

const SUPPORT_EMAIL = 'support@nexus-chat-world.com'
const requestHref = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Nexus Chat account deletion request')}&body=${encodeURIComponent('Please delete my Nexus Chat account and associated data.\n\nAccount email address: \nNexus ID (if known): ')}`

export default function DeleteAccountPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8 lg:py-6">
        <Header />
      </div>
      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <Link to="/" className="text-sm font-medium text-primary hover:underline">
          Back to Nexus Chat
        </Link>
        <h1 className="mt-5 text-3xl font-bold">Request account deletion</h1>
        <p className="mt-4 text-sm leading-6 text-muted-foreground">
          You can delete your account in the app under Settings → Account. If you
          cannot sign in, request deletion by emailing us from the email address
          registered to your Nexus Chat account.
        </p>
        <a
          href={requestHref}
          className="mt-6 inline-flex rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
        >
          Email a deletion request
        </a>
        <p className="mt-4 text-sm leading-6 text-muted-foreground">
          Include your account email address and, if known, your Nexus ID. Do not
          send your password or identity documents. We will verify account
          ownership before processing the request. You can also email{' '}
          <a className="text-primary hover:underline" href={`mailto:${SUPPORT_EMAIL}`}>
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
        <section className="mt-8 space-y-3 text-sm leading-6 text-muted-foreground">
          <h2 className="text-lg font-semibold text-foreground">What is deleted</h2>
          <p>
            After verification, we delete the account and associated profile,
            contact, message, feed, identity-verification and stored-file data.
            Limited information may be retained where required by law.
          </p>
          <p>
            You can review how account data is handled in our{' '}
            <Link to="/privacy" className="text-primary hover:underline">
              Privacy Policy
            </Link>
            .
          </p>
        </section>
      </main>
    </div>
  )
}
