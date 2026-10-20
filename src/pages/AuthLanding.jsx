import { ArrowRightIcon, SparklesIcon, UsersIcon, DevicePhoneMobileIcon, ComputerDesktopIcon, ShieldCheckIcon, MicrophoneIcon } from '@heroicons/react/24/solid'
import { Apple } from 'lucide-react' // Keep Apple icon since Heroicons doesn't have it
import { Link } from 'react-router-dom'
import Header from '../components/Header'
import AuthBottomNav from '../components/AuthBottomNav'
import { useTheme } from '../hooks/useTheme'

const features = [
  {
    title: 'Instant conversations',
    description: 'Fast, lightweight chats that feel fluid on desktop and mobile alike.',
    icon: SparklesIcon
  },
  {
    title: 'Protected by design',
    description: 'Encrypted rooms, secure sign-in, and protected media sharing for everyday use.',
    icon: ShieldCheckIcon
  },
  {
    title: 'Voice and video ready',
    description: 'Crystal-clear voice calls and a modern interface built for nonstop communication.',
    icon: MicrophoneIcon
  }
]

const platforms = [
  { label: 'Android', icon: DevicePhoneMobileIcon },
  { label: 'iOS/iPad', icon: Apple },
  { label: 'Windows/Tablet', icon: ComputerDesktopIcon }
]

export default function AuthLanding() {
  useTheme()

  return (
    <div className="min-h-screen bg-background text-foreground transition-all pb-24 md:pb-0">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col justify-between px-4 py-4 sm:px-6 lg:px-8 lg:py-6">
        <Header />

        <main className="grid flex-1 items-center gap-10 py-8 lg:grid-cols-[1.03fr_0.97fr] lg:gap-12 lg:py-10">
          <section className="max-w-2xl">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-primary/10 px-3 py-1 text-sm text-primary">
              <SparklesIcon className="h-4 w-4" />
              Privacy-first encrypted messaging experience
            </div>
            <h2 className="text-4xl font-bold leading-[1.05] sm:text-5xl lg:text-6xl">
              Connect with private conversations and a privacy-first messaging hub.
            </h2>
            <p className="mt-5 max-w-xl text-lg leading-8 text-muted-foreground">
              Launch secure chats, share media, make voice calls, and keep your conversations encrypted across desktop and mobile.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/register" className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 font-semibold text-primary-foreground hover:bg-primary/90 transition">
              Create account <ArrowRightIcon className="h-4 w-4" />
            </Link>
            <Link to="/login" className="inline-flex items-center gap-2 rounded-full border border-border bg-muted px-5 py-3 font-semibold text-foreground hover:bg-muted/80 transition">
              Open app <ArrowRightIcon className="h-4 w-4" />
            </Link>
          </div>

            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              {features.map((feature) => {
                const Icon = feature.icon
                return (
                  <div key={feature.title} className="float-card rounded-2xl border border-border bg-card p-4 shadow-sm backdrop-blur">
                    <Icon className="mb-3 h-6 w-6 text-primary" />
                    <h3 className="font-semibold">{feature.title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{feature.description}</p>
                  </div>
                )
              })}
            </div>
          </section>

          <section className="rounded-[28px] border border-border bg-card p-6 shadow-2xl backdrop-blur-xl sm:p-7 lg:p-8">
            <div className="rounded-2xl border border-primary/20 bg-primary/10 p-4">
              <p className="text-sm font-medium text-primary">Free to use</p>
              <h3 className="mt-2 text-xl font-semibold">Get Nexus for Android, PC, tablets, Mac and iPhone</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Nexus Chat is free to use and has no subscriptions, paid tiers, or in-app purchases. Open it on any device with your account.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link to="/login" className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 font-semibold text-primary-foreground hover:bg-primary/90 transition">
                  <ArrowRightIcon className="h-4 w-4" /> Open app
                </Link>
                <Link to="/register" className="inline-flex items-center gap-2 rounded-full border border-border bg-muted px-4 py-2 font-semibold text-foreground hover:bg-muted/80 transition">
                  <ArrowRightIcon className="h-4 w-4" /> Create account
                </Link>
              </div>
            </div>

            <div className="mt-6 rounded-2xl border border-border bg-muted p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <UsersIcon className="h-4 w-4 text-primary" />
              Included experiences
            </div>
              <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                <li>• Secure sign-in with member number</li>
                <li>• Voice, media and chat support</li>
                <li>• Wallpaper and settings customization</li>
                <li>• Cross-device messaging and privacy controls</li>
                <li>• Free to use — no payments and no in-app purchases</li>
              </ul>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              {platforms.map((platform) => {
                const Icon = platform.icon
                return (
                  <div key={platform.label} className="float-card flex items-center gap-2 rounded-full border border-border bg-muted px-3 py-2 text-sm text-foreground">
                    <Icon className="h-4 w-4 text-primary" /> {platform.label}
                  </div>
                )
              })}
            </div>
          </section>
        </main>

        <footer className="w-full pt-6 pb-24 md:pb-6">
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
            <Link to="/privacy" className="transition hover:text-foreground">Privacy Policy</Link>
            <span aria-hidden="true">·</span>
            <Link to="/terms" className="transition hover:text-foreground">Terms of Service</Link>
            <span aria-hidden="true">·</span>
            <Link to="/delete-account" className="transition hover:text-foreground">Delete account</Link>
          </div>
        </footer>
      </div>
      <AuthBottomNav />
    </div>
  )
}
