import type { ReactNode } from 'react'
import { Link, Navigate, Route, Routes, useLocation } from 'react-router'
import { can, type Action } from '../shared/permissions'
import { useAuth } from './auth'
import { Icon } from './components/Icon'
import { Layout } from './components/Layout'
import { ActivityPage } from './pages/Activity'
import { LoginPage, RegisterPage } from './pages/AuthPages'
import { DashboardPage } from './pages/Dashboard'
import { ProjectsPage } from './pages/Projects'
import { SettingsPage } from './pages/Settings'
import { UsersPage } from './pages/Users'

function FullPageLoader() {
  return (
    <div className="full-center" aria-busy="true">
      <span className="spinner" />
      <span className="sr-only">Loading</span>
    </div>
  )
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <FullPageLoader />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  return children
}

function GuestOnly({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <FullPageLoader />
  if (user) return <Navigate to="/" replace />
  return children
}

function RequirePermission({ action, children }: { action: Action; children: ReactNode }) {
  const { user } = useAuth()
  return can(user, action) ? children : <Forbidden />
}

function Forbidden() {
  return (
    <div className="state big">
      <div className="state-icon">
        <Icon name="lock" size={24} />
      </div>
      <h1>You don’t have access to this page</h1>
      <p className="muted">The user list is only for admins and managers. Ask an admin if you need access.</p>
      <Link to="/" className="btn">
        Back to dashboard
      </Link>
    </div>
  )
}

function NotFound() {
  return (
    <div className="state big">
      <h1>Page not found</h1>
      <p className="muted">The page you’re looking for doesn’t exist or has moved.</p>
      <Link to="/" className="btn">
        Back to dashboard
      </Link>
    </div>
  )
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<GuestOnly><LoginPage /></GuestOnly>} />
      <Route path="/register" element={<GuestOnly><RegisterPage /></GuestOnly>} />
      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        <Route index element={<DashboardPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="users" element={<RequirePermission action="user:read"><UsersPage /></RequirePermission>} />
        <Route path="activity" element={<ActivityPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
