import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router'
import { can, type Action } from '../../shared/permissions'
import { useAuth, useUser } from '../auth'
import { Icon, type IconName } from './Icon'
import { Avatar, RoleBadge } from './ui'

const NAV: { to: string; label: string; icon: IconName; needs?: Action; lockedText?: string }[] = [
  { to: '/', label: 'Dashboard', icon: 'home' },
  { to: '/projects', label: 'Projects', icon: 'folder' },
  { to: '/users', label: 'Users', icon: 'users', needs: 'user:read', lockedText: 'Admins and managers only' },
  { to: '/activity', label: 'Activity', icon: 'activity' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
]

export function Layout() {
  const user = useUser()
  const { signOut } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()

  useEffect(() => setMenuOpen(false), [location.pathname])

  return (
    <div className={`shell${menuOpen ? ' menu-open' : ''}`}>
      <aside className="sidebar" aria-label="Main navigation">
        <div className="brand">
          <span className="brand-mark">Z</span>
          <span>Ziraboard</span>
          <button type="button" className="icon-btn sidebar-close" onClick={() => setMenuOpen(false)} aria-label="Close menu">
            <Icon name="close" />
          </button>
        </div>
        <nav className="nav">
          {NAV.map((item) => {
            const locked = item.needs && !can(user, item.needs)
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) => `nav-link${isActive ? ' active' : ''}${locked ? ' locked' : ''}`}
                title={locked ? item.lockedText : undefined}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
                {locked && <Icon name="lock" size={14} className="nav-lock" />}
              </NavLink>
            )
          })}
        </nav>
        <div className="sidebar-foot">
          <div className="me">
            <Avatar name={user.name} size={36} />
            <div className="me-text">
              <strong>{user.name}</strong>
              <RoleBadge role={user.role} />
            </div>
          </div>
          <button type="button" className="btn btn-ghost btn-block" onClick={() => void signOut()}>
            <Icon name="logout" size={16} /> Sign out
          </button>
        </div>
      </aside>
      <div className="scrim" onClick={() => setMenuOpen(false)} aria-hidden="true" />
      <div className="main">
        <header className="mobile-bar">
          <button type="button" className="icon-btn" onClick={() => setMenuOpen(true)} aria-label="Open menu">
            <Icon name="menu" />
          </button>
          <span className="brand-mark">Z</span>
          <strong>Ziraboard</strong>
          <span style={{ marginLeft: 'auto' }}>
            <RoleBadge role={user.role} />
          </span>
        </header>
        {user.isDemo && (
          <div className="demo-strip">
            You’re using a shared demo account as <strong>{user.role}</strong>. Changes are visible to other visitors and the
            data resets from time to time.
          </div>
        )}
        <main className="content" id="main">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  )
}
