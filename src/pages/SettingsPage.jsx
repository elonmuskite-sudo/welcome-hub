import { useSetting } from '../hooks/useSetting'
import SettingsShell from '../components/chat/settings/SettingsShell'
import AppearanceSettings from '../components/chat/settings/AppearanceSettings'
import NotificationsSettings from '../components/chat/settings/NotificationsSettings'
import PrivacySettings from '../components/chat/settings/PrivacySettings'
import ProfileEdit from '../components/chat/settings/ProfileEdit'
import DataStorageSettings from '../components/chat/settings/DataStorageSettings'
import VerificationSettings from '../components/chat/settings/VerificationSettings'
import BillingHistory from '../components/chat/settings/BillingHistory'
import Avatar from '../components/chat/Avatar'
import VerificationBadge from '../components/chat/VerificationBadge'
import { useAuth } from '../lib/AuthContext'
import { ChevronRight, ArrowLeft, Receipt, Bell, Database, HardDrive, LogOut, Palette, ShieldCheck, UserCircle } from 'lucide-react'
import { useNavigate, useLocation } from 'react-router-dom'

function SettingsMenu() {
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const [notificationSound] = useSetting('notificationSound', true)
  const [notificationTone] = useSetting('notificationTone', 'chime')
  const [chatWallpaper] = useSetting('chatWallpaper', 'nature')

  const sections = [
    {
      id: 'appearance',
      label: 'Appearance',
      description: 'Wallpaper, theme, visual style',
      icon: <Palette className="w-5 h-5" />,
      hint: chatWallpaper ? chatWallpaper.charAt(0).toUpperCase() + chatWallpaper.slice(1) : 'Default',
    },
    {
      id: 'notifications',
      label: 'Notifications',
      description: 'Tone selection, volume, popup sounds',
      icon: <Bell className="w-5 h-5" />,
      hint: notificationSound ? `${notificationTone.charAt(0).toUpperCase()}${notificationTone.slice(1)}` : 'Muted',
    },
    {
      id: 'privacy',
      label: 'Privacy & Security',
      description: 'End-to-end encryption, security code',
      icon: <ShieldCheck className="w-5 h-5" />,
    },
    {
      id: 'storage',
      label: 'Storage',
      description: 'Usage, file breakdown, free up space',
      icon: <HardDrive className="w-5 h-5" />,
    },
    {
      id: 'billing',
      label: 'Billing history',
      description: 'Your payments and storage upgrade status',
      icon: <Receipt className="w-5 h-5" />,
    },
    {
      id: 'verification',
      label: 'Identity verification',
      description: 'Get the blue verified check',
      icon: <UserCircle className="w-5 h-5" />,
    },
  ]

  if (user?.role === 'admin') {
    sections.push({
      id: 'database',
      label: 'Database schemas',
      description: 'How the database is set up',
      icon: <Database className="w-5 h-5" />,
      hint: 'Admin',
    })
  }

  return (
    <SettingsShell>
      <h2 className="text-2xl font-bold text-foreground mb-6">Settings</h2>
      <button
        onClick={() => navigate('/app/settings/profile')}
        className="w-full flex items-center gap-4 p-4 bg-muted/40 hover:bg-muted/75 rounded-2xl border border-border mb-6 transition duration-200"
      >
        <Avatar src={user?.avatarUrl} alt={user?.fullName || 'User'} size="lg" />
        <div className="flex-1 text-left min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <UserCircle className="w-4 h-4 text-muted-foreground" />
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Profile</p>
          </div>
          <h3 className="font-bold text-foreground text-lg leading-tight truncate flex items-center gap-1.5">{user?.fullName || 'Anonymous User'}<VerificationBadge userId={user?.id} className="w-4 h-4 flex-shrink-0" /></h3>
          <p className="text-xs text-muted-foreground mt-1">Nexus ID: {user?.nexusIdDisplay || '10-XXXX-XXXX'}</p>
        </div>
        <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
      </button>

      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        {sections.map((section) => (
          <button
            key={section.id}
            onClick={() => navigate(`/app/settings/${section.id}`)}
            className="w-full group border-b border-border last:border-b-0 flex items-center gap-4 p-4 hover:bg-muted/60 transition-colors text-left"
          >
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary transition">
              {section.icon}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-foreground">{section.label}</p>
              <p className="text-sm text-muted-foreground">{section.description}</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {section.hint && (
                <span className="hidden sm:inline-flex text-xs font-medium text-muted-foreground bg-muted px-2.5 py-1 rounded-full">
                  {section.hint}
                </span>
              )}
              <ChevronRight className="w-5 h-5 text-muted-foreground" />
            </div>
          </button>
        ))}
      </div>

      <button
        onClick={async () => { await logout(); navigate('/login', { replace: true }) }}
        className="mt-6 w-full flex items-center justify-center gap-2 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive hover:bg-destructive/15 transition"
      >
        <LogOut className="w-4 h-4" />
        Log out
      </button>
    </SettingsShell>
  )
}

function SchemaSettings() {
  return (
    <SettingsSubPage title="Database schemas">
      <div className="rounded-2xl border border-border bg-muted/30 p-4 text-sm">
        <p className="font-semibold text-foreground">Database setup</p>
        <p className="mt-2 text-muted-foreground">
          Schema changes run from the trusted deployment environment. Server keys and the admin password are never sent to this browser.
        </p>
        <p className="mt-3 text-muted-foreground">
          Run <code>npm run admin:sync</code> from a configured server environment to inspect or apply changes.
        </p>
      </div>
    </SettingsSubPage>
  )
}

function SettingsSubPage({ title, children }) {
  const navigate = useNavigate()

  return (
    <SettingsShell>
      <button
        onClick={() => navigate('/app/settings')}
        className="flex items-center gap-2 text-primary mb-4 hover:underline"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Settings
      </button>
      <h2 className="text-2xl font-bold text-foreground mb-6">{title}</h2>
      {children}
    </SettingsShell>
  )
}

export default function SettingsPage() {
  const location = useLocation()
  const { user } = useAuth()
  const subPath = location.pathname.split('/app/settings/')[1]

  if (subPath === 'database' && user?.role === 'admin') {
    return <div className="flex-1 overflow-y-auto bg-card"><SchemaSettings /></div>
  }

  if (subPath === 'profile') {
    return (
      <div className="flex-1 overflow-y-auto bg-card">
        <SettingsSubPage title="Profile">
          <ProfileEdit />
        </SettingsSubPage>
      </div>
    )
  }

  if (subPath === 'appearance') {
    return (
      <div className="flex-1 overflow-y-auto bg-card">
        <SettingsSubPage title="Appearance">
          <AppearanceSettings />
        </SettingsSubPage>
      </div>
    )
  }

  if (subPath === 'notifications') {
    return (
      <div className="flex-1 overflow-y-auto bg-card">
        <SettingsSubPage title="Notifications">
          <NotificationsSettings />
        </SettingsSubPage>
      </div>
    )
  }

  if (subPath === 'privacy') {
    return (
      <div className="flex-1 overflow-y-auto bg-card">
        <SettingsSubPage title="Privacy & Security">
          <PrivacySettings />
        </SettingsSubPage>
      </div>
    )
  }

  if (subPath === 'storage') {
    return (
      <div className="flex-1 overflow-y-auto bg-card">
        <SettingsSubPage title="Storage">
          <DataStorageSettings />
        </SettingsSubPage>
      </div>
    )
  }

  if (subPath === 'billing') {
    return (
      <div className="flex-1 overflow-y-auto bg-card">
        <SettingsSubPage title="Billing history">
          <BillingHistory />
        </SettingsSubPage>
      </div>
    )
  }

  if (subPath === 'verification') {
    return (
      <div className="flex-1 overflow-y-auto bg-card">
        <SettingsSubPage title="Identity verification">
          <VerificationSettings />
        </SettingsSubPage>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto bg-card">
      <SettingsMenu />
    </div>
  )
}
