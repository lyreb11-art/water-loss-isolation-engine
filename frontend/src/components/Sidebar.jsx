/**
 * Sidebar.jsx -- role-aware navigation.
 * Shows different links for Citizen vs Official.
 */
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../AuthContext'

const CITIZEN_LINKS = [
  { to: '/citizen',         label: '🏘️ Home',          exact: true },
  { to: '/citizen/notices', label: '📋 Notices' },
  { to: '/citizen/report',  label: '📢 Report Issue' },
]

const OFFICIAL_LINKS = [
  { to: '/official',          label: '🛠️ Official Home', exact: true },
  { to: '/official/controls', label: '🎛️ Demo Controls' },
  { to: '/official/actions',  label: '🚨 Action Centre' },
]

export default function Sidebar() {
  const { username, role, zone, logout } = useAuth()
  const nav = useNavigate()
  const loc = useLocation()

  const links = role === 'Citizen' ? CITIZEN_LINKS : OFFICIAL_LINKS

  const handleLogout = () => {
    logout()
    nav('/')
  }

  return (
    <aside className="w-64 bg-surface border-r border-border flex flex-col h-screen sticky top-0">
      {/* Brand */}
      <div className="p-5 border-b border-border">
        <div className="text-lg font-bold text-text">💧 Water Loss</div>
        <div className="text-[11px] text-muted uppercase tracking-widest mt-1">
          Isolation Engine
        </div>
      </div>

      {/* Identity */}
      <div className="p-5 border-b border-border">
        <div className="text-xs text-muted mb-1">Signed in as</div>
        <div className="text-sm font-semibold text-text">{username}</div>
        <div className="text-[11px] text-primary mt-1">{role}</div>
        {zone && (
          <div className="text-[11px] text-muted mt-1">
            Zone: <span className="text-teal">{zone}</span>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 p-3 space-y-1">
        {links.map((l) => {
          const active = l.exact ? loc.pathname === l.to : loc.pathname.startsWith(l.to)
          return (
            <Link
              key={l.to}
              to={l.to}
              className={`block px-3 py-2 rounded-lg text-sm transition-colors ${
                active
                  ? 'bg-primary/15 text-primary border border-primary/30'
                  : 'text-muted hover:text-text hover:bg-panel border border-transparent'
              }`}
            >
              {l.label}
            </Link>
          )
        })}
      </nav>

      {/* Logout */}
      <div className="p-3 border-t border-border">
        <button
          onClick={handleLogout}
          className="w-full btn btn-ghost text-sm"
        >
          🚪 Logout
        </button>
      </div>
    </aside>
  )
}