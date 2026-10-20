import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabase'
import { appwriteData, isAppwriteAuthEnabled } from '../lib/appwrite'
import Header from '../components/Header'
import BottomNav from '../components/chat/BottomNav'
import AppTopNav from '../components/chat/AppTopNav'
import NotificationStack from '../components/chat/NotificationStack'
import IdentityReviewQueue from '../components/IdentityReviewQueue'
import AdminMemberManager from '../components/AdminMemberManager'
import AdminFeedManager from '../components/AdminFeedManager'
import AdminReportManager from '../components/AdminReportManager'

export default function AdminDashboard() {
  const { user } = useAuth()
  const [activeUsers, setActiveUsers] = useState([])
  const [recentMessages, setRecentMessages] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const loadAdminData = async () => {
      if (!isAppwriteAuthEnabled() && !supabase) {
        setError('The database is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
        setLoading(false)
        return
      }

      try {
        if (isAppwriteAuthEnabled()) {
          const { members, messages } = await appwriteData('admin.dashboard')
          setActiveUsers(members || [])
          setRecentMessages(messages || [])
          return
        }
        const [users, messages] = await Promise.all([
          supabase.from('members').select('id, member_id, full_name, created_at').order('created_at', { ascending: false }).limit(20),
          supabase.from('messages').select('id, chat_id, type, content, created_at').order('created_at', { ascending: false }).limit(20),
        ])
        if (users.error) throw users.error
        if (messages.error) throw messages.error
        users.documents = users.data
        messages.documents = messages.data

        setActiveUsers(users.documents || [])
        setRecentMessages(messages.documents || [])
      } catch (err) {
        setError(err?.message || 'Failed to load admin data.')
      } finally {
        setLoading(false)
      }
    }

    loadAdminData()
  }, [])

  return (
    <div className="relative min-h-screen flex flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <Header showSignIn={false}>
        <AppTopNav variant="admin" />
      </Header>

      <main className="flex-1 overflow-y-auto mx-auto w-full max-w-7xl px-4 py-8 pb-[120px] sm:px-6 lg:px-8">
        <div className="mb-8 rounded-[32px] border border-slate-200 bg-white p-8 shadow-lg shadow-slate-200/30 dark:border-slate-800 dark:bg-slate-900 dark:shadow-slate-950/30">
          <p className="text-sm uppercase tracking-[0.27em] text-blue-600">Admin dashboard</p>
          <h1 className="mt-4 text-3xl font-semibold">Workspace administration</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            Monitor active members, review recent messages.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link to="/admin/users" className="inline-flex rounded-xl border border-border px-3 py-2 text-sm font-medium text-primary hover:bg-muted">Manage members</Link>
            <Link to="/admin/diagnostics" className="inline-flex rounded-xl border border-border px-3 py-2 text-sm font-medium text-primary hover:bg-muted">Configuration diagnostics</Link>
          </div>
          <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">Signed in as {user?.fullName || user?.nexusId}</p>
        </div>

        <section className="mb-8 rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-xl font-semibold">Database schemas</h2>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Database changes are applied by running docs/supabase-schema.sql in your Supabase SQL editor.
          </p>
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
            Run <code>npm run admin:bootstrap</code> from a trusted local environment to create or grant the initial admin account.
          </p>
        </section>

        {loading ? (
          <div className="rounded-[24px] border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
            Loading admin data...
          </div>
        ) : error ? (
          <div className="rounded-[24px] border border-rose-200 bg-rose-50 p-8 text-center text-rose-700 shadow-sm dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200">
            {error}
          </div>
        ) : (
          <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr]">
            <section className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-xl font-semibold">Active members</h2>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Latest registered members and account details.</p>
              <div className="mt-6 space-y-4">
                {activeUsers.map((member) => (
                  <div key={member.$id || member.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="font-semibold text-slate-900 dark:text-slate-100">{member.full_name || member.member_id}</p>
                        <p className="text-sm text-slate-500 dark:text-slate-400">Member #{member.member_id}</p>
                      </div>
                      <p className="text-sm text-slate-500 dark:text-slate-400">{new Date(member.created_at || member.$createdAt).toLocaleString()}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-xl font-semibold">Recent messages</h2>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Most recent chat activity across the workspace.</p>
              <div className="mt-6 space-y-4">
                {recentMessages.map((msg) => (
                  <div key={msg.$id || msg.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
                    <p className="text-sm text-slate-500 dark:text-slate-400">{new Date(msg.created_at || msg.$createdAt).toLocaleString()}</p>
                    <p className="mt-2 font-semibold text-slate-900 dark:text-slate-100">{msg.type === 'text' ? msg.content : `(${msg.type}) ${msg.content}`}</p>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Chat ID: {msg.chat_id}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
        <AdminMemberManager />
        <AdminFeedManager />
        <AdminReportManager />
        <IdentityReviewQueue />
      </main>

      <BottomNav />
      <NotificationStack />
    </div>
  )
}
