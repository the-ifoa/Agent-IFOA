import { NavLink, useLocation } from 'react-router-dom'
import ProfilePage from './ProfilePage'
import SettingsPage from './SettingsPage'

const ProfileIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
  </svg>
)

const SettingsIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
  </svg>
)

const sections = [
  { to: '/dashboard/profile',  label: 'Profile',             hint: 'Personal & account details', icon: <ProfileIcon /> },
  { to: '/dashboard/settings', label: 'Security & Settings', hint: 'Login, MFA, emails',         icon: <SettingsIcon /> },
]

/**
 * Profile + Settings combined on one page with a left-hand section nav.
 * Each section keeps its own URL so existing links/bookmarks still work.
 */
export default function AccountPage() {
  const { pathname } = useLocation()
  const onSettings = pathname.startsWith('/dashboard/settings')

  return (
    <div className="max-w-6xl mx-auto flex flex-col lg:flex-row gap-6 lg:gap-8">
      <aside className="lg:w-60 flex-shrink-0">
        <nav className="lg:sticky lg:top-24 rounded-3xl border border-slate-200/90 bg-white p-2 shadow-[0_2px_12px_rgba(0,0,0,0.03)] flex lg:flex-col gap-1">
          <p className="hidden lg:block px-3 pt-2 pb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">Account</p>
          {sections.map(s => (
            <NavLink
              key={s.to}
              to={s.to}
              className={({ isActive }) =>
                `flex-1 lg:flex-none flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-semibold transition-colors
                ${isActive ? 'bg-[#000021] text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`
              }
            >
              {s.icon}
              <span className="flex flex-col leading-tight">
                <span>{s.label}</span>
                <span className="hidden lg:block text-[11px] font-medium opacity-70">{s.hint}</span>
              </span>
            </NavLink>
          ))}
        </nav>
      </aside>

      <section className="flex-1 min-w-0">
        {onSettings ? <SettingsPage /> : <ProfilePage />}
      </section>
    </div>
  )
}
