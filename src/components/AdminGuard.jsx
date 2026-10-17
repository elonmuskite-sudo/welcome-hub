import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabase'
import { appwriteData, isAppwriteAuthEnabled } from '../lib/appwrite'
import { establishAdminSession } from '../lib/adminSession'

// Admin access is re-confirmed with the database on every visit; the cached role
// is only a first filter. Unauthenticated visitors are sent to the admin sign-in
// page, and the server session cookie is refreshed for the middleware gate.
export default function AdminGuard({ children }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  const [verified, setVerified] = useState(null)

  useEffect(() => {
    let active = true
    if (!user?.id || user.role !== 'admin' || (!supabase && !isAppwriteAuthEnabled())) { setVerified(false); return undefined }
    setVerified(null)
    const verify = isAppwriteAuthEnabled()
      ? appwriteData('admin.verify').then(() => true)
      : supabase.rpc('has_role', { _user_id: user.id, _role: 'admin' })
        .then(({ data, error }) => { if (error) throw error; return data === true })
    verify.then((isAdmin) => {
      if (!active) return
      setVerified(isAdmin)
      // Keeps the signed cookie (and therefore the server-side gate) alive.
      if (isAdmin) establishAdminSession()
    }).catch(() => { if (active) setVerified(false) })
    return () => { active = false }
  }, [user?.id, user?.role])

  if (!loading && !user) {
    return <Navigate to="/admin/login" replace state={{ from: `${location.pathname}${location.search}` }} />
  }
  if (!loading && user && user.role !== 'admin') return <Navigate to="/app" replace />
  if (verified === false && !loading) return <Navigate to="/app" replace />

  if (loading || verified !== true) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    )
  }

  return children
}
