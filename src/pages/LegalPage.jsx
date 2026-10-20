import { ArrowLeftIcon } from '@heroicons/react/24/solid'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import Header from '../components/Header'

// Both stores require the privacy policy and terms to be reachable without an
// account, so this page renders standalone at /privacy and /terms and also
// inside the signed-in shell at /app/privacy and /app/terms.
const SUPPORT_EMAIL = 'support@nexus-chat-world.com'
const LAST_UPDATED = '20 October 2026'
const APP_NAME = 'Nexus Chat'

function Section({ title, children }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <div className="mt-2 space-y-3 text-sm leading-6 text-muted-foreground">{children}</div>
    </section>
  )
}

function PrivacyContent() {
  return (
    <>
      <Section title="What this policy covers">
        <p>
          {APP_NAME} is a messaging app. This policy explains what information we collect,
          why we collect it, and the choices you have. It applies to the {APP_NAME} web app and
          the Android and iOS builds.
        </p>
      </Section>

      <Section title="Information we collect">
        <p><strong className="text-foreground">Account details.</strong> Your name, email address and a generated member number. We use these to create and secure your account.</p>
        <p><strong className="text-foreground">Profile details you provide.</strong> An optional avatar, bio and interests.</p>
        <p><strong className="text-foreground">Messages and media.</strong> Text messages are end-to-end encrypted on your device only while E2EE is enabled in Settings → Privacy. New accounts have it enabled by default when setup succeeds. If E2EE is off, text messages are not end-to-end encrypted. Attachments and voice notes are not covered by E2EE; we store files so they can be delivered to recipients.</p>
        <p><strong className="text-foreground">Contacts and feed content.</strong> The contacts you save and any posts, comments or reactions you publish in the social feed.</p>
        <p><strong className="text-foreground">Identity verification (optional).</strong> If you choose manual verification, you upload a government ID and a selfie. Instant verification runs on your device using face matching. We only keep what is needed to review and record the outcome.</p>
        <p><strong className="text-foreground">Technical data.</strong> Basic device and connection information needed to deliver messages reliably and keep the service secure.</p>
      </Section>

      <Section title="How we use your information">
        <p>We use your information to provide messaging, calls, the social feed and account features; to verify identity when you ask us to; to keep the service safe and prevent abuse; and to send service emails such as verification codes and a one-time welcome message.</p>
      </Section>

      <Section title="What we never do">
        <p>{APP_NAME} is free to use. We do not sell storage upgrades, subscriptions or in-app purchases, and we do not sell your personal information.</p>
      </Section>

      <Section title="Reports and moderation">
        <p>If you report a post, comment or member, we record the report and the reason you selected so our moderators can review it. You can block a member to hide their content from your own view. See the Terms of service for how to report abuse and contact us.</p>
      </Section>

      <Section title="Service providers">
        <p>We rely on trusted providers to run the service: Supabase (database, authentication and file storage), Resend (transactional email) and our hosting provider. These providers only process data on our instructions.</p>
      </Section>

      <Section title="Data retention">
        <p>We keep your account information for as long as your account exists. When you delete your account we remove your account record and associated personal data, except where we are required to keep limited records by law.</p>
      </Section>

      <Section title="Your choices and rights">
        <p>You can edit your profile at any time in Settings. Delete your account in Settings → Account, or use our public <Link className="text-primary hover:underline" to="/delete-account">account deletion request page</Link> if you cannot sign in. We remove your account and associated data after verifying a request, except for limited records we are required to retain by law. You can also contact us to ask for a copy of your data or to raise a privacy question.</p>
      </Section>

      <Section title="Children">
        <p>{APP_NAME} is not directed to children under 13, and we do not knowingly collect data from them. If you believe a child has created an account, contact us and we will remove it.</p>
      </Section>

      <Section title="Security">
        <p>Data is encrypted in transit. Text messages use end-to-end encryption only when E2EE is enabled; keys are generated and held on your device. If a recipient key is unavailable or encryption fails, the app does not send that text message. Attachments and voice notes are not end-to-end encrypted. Staff access to account records is limited and audited.</p>
      </Section>

      <Section title="Changes to this policy">
        <p>We may update this policy. When we make material changes we will update the date above and, where required, notify you in the app.</p>
      </Section>

      <Section title="Contact us">
        <p>Questions about privacy? Email <a className="text-primary hover:underline" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.</p>
      </Section>
    </>
  )
}

function TermsContent() {
  return (
    <>
      <Section title="Accepting these terms">
        <p>By creating an account or using {APP_NAME}, you agree to these terms. If you do not agree, please do not use the service.</p>
      </Section>

      <Section title="Your account">
        <p>You are responsible for the activity on your account and for keeping your password secure. You must provide accurate information and be old enough to use the service in your country.</p>
      </Section>

      <Section title="Acceptable use">
        <p>You agree not to use {APP_NAME} to break the law, to harass or harm others, to share content that is illegal or exploitative, to spread malware, to impersonate others, or to attempt to disrupt or gain unauthorised access to the service.</p>
      </Section>

      <Section title="Your content">
        <p>You keep ownership of the content you create. You give us the limited permission needed to store, deliver and display that content so the service can work. You are responsible for content you upload, including ensuring you have the right to share it.</p>
      </Section>

      <Section title="Reporting and blocking">
        <p>There is no tolerance for objectionable content or abusive behaviour. You can report any post, comment or member from the ⋯ menu in the feed, and you can block a member so their posts and comments are hidden from you. Blocked members can be managed in Settings → Account.</p>
        <p>We review reports and may remove content or suspend accounts that break these terms. To report abuse or ask us to act on content, email <a className="text-primary hover:underline" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.</p>
      </Section>

      <Section title="No payments or purchases">
        <p>{APP_NAME} is provided free of charge. There are no paid tiers, storage upgrades, subscriptions or in-app purchases.</p>
      </Section>

      <Section title="Ending your account">
        <p>You can delete your account at any time from Settings → Account. If you cannot sign in, use our public <Link className="text-primary hover:underline" to="/delete-account">account deletion request page</Link>. We may suspend or remove accounts that break these terms or that we must remove by law.</p>
      </Section>

      <Section title="Service availability and disclaimer">
        <p>We work to keep {APP_NAME} available and reliable, but it is provided “as is” without warranties. To the extent permitted by law, we are not liable for indirect or incidental losses arising from your use of the service.</p>
      </Section>

      <Section title="Changes to these terms">
        <p>We may update these terms. When we make material changes we will update the date above and, where required, notify you in the app. Continued use after a change means you accept the updated terms.</p>
      </Section>

      <Section title="Contact us">
        <p>Questions about these terms? Email <a className="text-primary hover:underline" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.</p>
      </Section>
    </>
  )
}

export default function LegalPage({ doc = 'privacy' }) {
  const location = useLocation()
  const navigate = useNavigate()
  const inApp = location.pathname.startsWith('/app')
  const isPrivacy = doc === 'privacy'
  const title = isPrivacy ? 'Privacy policy' : 'Terms of service'

  const goBack = () => {
    if (inApp) navigate('/app/settings')
    else navigate('/')
  }

  const body = (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <button
        type="button"
        onClick={goBack}
        className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        Back
      </button>
      <h1 className="text-3xl font-bold text-foreground">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated {LAST_UPDATED}</p>
      {isPrivacy ? <PrivacyContent /> : <TermsContent />}
    </div>
  )

  if (inApp) {
    return <div className="flex-1 overflow-y-auto bg-background">{body}</div>
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8 lg:py-6">
        <Header />
      </div>
      {body}
    </div>
  )
}
