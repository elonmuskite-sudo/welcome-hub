import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import AdminMemberManager from '../components/AdminMemberManager'

// Dedicated member-management route. The route itself is wrapped in AdminGuard
// and gated server-side by middleware.js, so only admins ever reach it.
export default function AdminUsers() {
  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-4xl px-4 py-8 space-y-5">
        <Link to="/admin/dashboard" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Admin dashboard
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Members</h1>
          <p className="text-sm text-muted-foreground">
            Search registered members, edit profiles, and grant or remove admin and Premium Member access. Every change is written to the admin audit log.
          </p>
        </div>
        <AdminMemberManager />
      </main>
    </div>
  )
}
