import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useState, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import logo from '../assets/IFOA_USA_dark.png'

export default function Navbar() {
  const { pathname } = useLocation()
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const dropdownRef = useRef(null)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10)
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const handleClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setProfileOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const isActive = (to) => (to === '/' ? pathname === '/' : pathname.startsWith(to))

  const initials = user
    ? ([user?.firstName?.[0], user?.lastName?.[0]].filter(Boolean).join('').toUpperCase() || user?.email?.[0]?.toUpperCase() || '?')
    : null

  const fullName = user
    ? ([user?.firstName, user?.lastName].filter(Boolean).join(' ') || (user?.email ? user.email.split('@')[0] : 'User'))
    : ''

  const handleLogout = () => {
    logout()
    navigate('/')
    setProfileOpen(false)
    setMenuOpen(false)
  }

  const dashPath = user?.role === 'admin' ? '/admin' : '/dashboard'
  const profilePath = user?.role === 'admin' ? '/admin/profile' : '/dashboard/profile'
  const faqPath = user?.role === 'admin' ? '/admin/faq' : user ? '/dashboard/faq' : '/faq'

  return (
    <nav
      className="sticky top-0 z-50 transition-all duration-300 bg-[#020617] border-b border-white/10 shadow-lg"
      style={{ background: '#020617' }}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-[72px] items-center justify-between">

          {/* ── Logo ── */}
          <Link to="/" className="group flex shrink-0 items-center gap-3">
            <div className="flex items-center justify-center rounded-xl px-2 py-1 transition-all duration-200 group-hover:opacity-80">
              <img
                src={logo}
                alt="IFOA USA"
                className="h-8 w-auto object-contain"
              />
            </div>
            <div className="hidden h-5 w-px sm:block bg-white/20" />
            <span
              className="hidden font-mono text-[10px] font-bold uppercase tracking-widest sm:block text-slate-300"
            >
              Agent for Service
            </span>
          </Link>

          {/* ── Desktop nav ── */}
          <div className="hidden items-center gap-2 md:flex">
            <Link
              to="/"
              className={`rounded-full px-5 py-2 text-xs uppercase tracking-widest font-extrabold transition-all duration-150 ${
                isActive('/')
                  ? 'bg-white text-slate-950'
                  : 'text-slate-300 hover:text-white hover:bg-white/10'
              }`}
            >
              Home
            </Link>

            <Link
              to="/faq"
              className={`rounded-full px-5 py-2 text-xs uppercase tracking-widest font-extrabold transition-all duration-150 ${
                isActive('/faq')
                  ? 'bg-white text-slate-950'
                  : 'text-slate-300 hover:text-white hover:bg-white/10'
              }`}
            >
              FAQ
            </Link>

            <div className="mx-2 h-5 w-px bg-white/20" />

            {user ? (
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => setProfileOpen(o => !o)}
                  className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-full border transition-all duration-150 group cursor-pointer ${
                    profileOpen
                      ? 'border-white/30 bg-slate-800'
                      : 'border-white/10 bg-slate-900 hover:border-white/20 hover:bg-slate-800'
                  }`}
                >
                  <div className="w-7 h-7 rounded-full bg-slate-800 border border-white/10 flex items-center justify-center text-white text-xs font-black flex-shrink-0">
                    {initials}
                  </div>
                  <span className="text-sm font-semibold text-slate-200 group-hover:text-white max-w-[120px] truncate">
                    {fullName}
                  </span>
                  <svg
                    className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 ${profileOpen ? 'rotate-180 text-white' : 'group-hover:text-slate-200'}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2.5}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
                  </svg>
                </button>

                <AnimatePresence>
                  {profileOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -8, scale: 0.97 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -8, scale: 0.97 }}
                      transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                      className="absolute right-0 top-[calc(100%+8px)] w-60 bg-slate-900/95 backdrop-blur-md text-white rounded-2xl shadow-2xl border border-white/10 overflow-hidden z-50"
                    >
                      {/* User info */}
                      <div className="px-4 py-3.5 border-b border-white/10 bg-slate-950/60">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-slate-800 border border-white/20 flex items-center justify-center text-white text-xs font-black flex-shrink-0">
                            {initials}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-white truncate">{fullName}</p>
                            <p className="text-xs text-slate-400 truncate">{user?.email}</p>
                          </div>
                        </div>
                      </div>

                      {/* Nav items */}
                      <div className="p-1.5">
                        <Link
                          to={profilePath}
                          onClick={() => setProfileOpen(false)}
                          className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-slate-200 hover:bg-white/10 hover:text-white font-medium transition-colors"
                        >
                          <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                            <circle cx="12" cy="8" r="3.5" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 20c0-4 3.582-6 8-6s8 2 8 6" />
                          </svg>
                          {user?.role === 'admin' ? 'Profile' : 'My Profile'}
                        </Link>
                        <Link
                          to={faqPath}
                          onClick={() => setProfileOpen(false)}
                          className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-slate-200 hover:bg-white/10 hover:text-white font-medium transition-colors"
                        >
                          <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                            <circle cx="12" cy="12" r="9" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9.5 9.5a2.5 2.5 0 0 1 4.5 1.5c0 1.5-2 2-2 3.5M12 17h.01" />
                          </svg>
                          Help &amp; FAQ
                        </Link>
                        <a
                          href="mailto:agent@theifoa.com?subject=IFOA%20Agent%20for%20Service%20Enquiry"
                          onClick={() => setProfileOpen(false)}
                          className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-slate-200 hover:bg-white/10 hover:text-white font-medium transition-colors"
                        >
                          <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0-9.75 6-9.75-6" />
                          </svg>
                          Contact Support
                        </a>
                      </div>

                      {/* Logout */}
                      <div className="p-1.5 border-t border-white/10">
                        <button
                          onClick={handleLogout}
                          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-red-400 hover:bg-red-500/20 font-semibold transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 9V5.25A2.25 2.25 0 0 1 10.5 3h6a2.25 2.25 0 0 1 2.25 2.25v13.5A2.25 2.25 0 0 1 16.5 21h-6a2.25 2.25 0 0 1-2.25-2.25V15M12 9l3 3m0 0-3 3m3-3H2.25" />
                          </svg>
                          Log Out
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ) : (
              <div className="flex items-center gap-2.5">
                <Link
                  to="/login"
                  className="rounded-full px-5 py-2.5 text-xs uppercase tracking-widest font-extrabold text-slate-200 hover:text-white border border-white/20 hover:bg-white/10 transition-all duration-200"
                >
                  Login
                </Link>
                <Link
                  to="/signup"
                  className="rounded-full px-6 py-2.5 text-xs uppercase tracking-widest font-extrabold bg-white text-slate-950 hover:bg-slate-100 transition-all duration-200 shadow-sm"
                >
                  Sign Up
                </Link>
              </div>
            )}
          </div>

          {/* Mobile hamburger */}
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex h-9 w-9 flex-col items-center justify-center gap-[5px] rounded-lg text-white transition-colors hover:bg-white/10 md:hidden"
          >
            <span className={`block h-[1.5px] w-5 origin-center rounded-full bg-current transition-all duration-300 ${menuOpen ? 'translate-y-[6.5px] rotate-45' : ''}`} />
            <span className={`block h-[1.5px] w-5 rounded-full bg-current transition-all duration-300 ${menuOpen ? 'scale-x-0 opacity-0' : ''}`} />
            <span className={`block h-[1.5px] w-5 origin-center rounded-full bg-current transition-all duration-300 ${menuOpen ? '-translate-y-[6.5px] -rotate-45' : ''}`} />
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            className="flex flex-col gap-1.5 px-4 py-4 bg-slate-950/95 backdrop-blur-md shadow-xl md:hidden border-t border-white/10 text-white"
          >
            <Link to="/" onClick={() => setMenuOpen(false)}
              className={`rounded-xl px-4 py-3 text-xs uppercase tracking-widest font-extrabold transition-colors ${
                isActive('/') ? 'bg-white text-slate-950' : 'text-slate-200 hover:bg-white/10'
              }`}>
              Home
            </Link>

            <Link to="/faq" onClick={() => setMenuOpen(false)}
              className={`rounded-xl px-4 py-3 text-xs uppercase tracking-widest font-extrabold transition-colors ${
                isActive('/faq') ? 'bg-white text-slate-950' : 'text-slate-200 hover:bg-white/10'
              }`}>
              Help &amp; FAQ
            </Link>

            {user ? (
              <>
                <Link to={profilePath} onClick={() => setMenuOpen(false)}
                  className="rounded-xl px-4 py-3 text-sm font-semibold text-slate-200 hover:bg-white/10 transition-colors">
                  {user?.role === 'admin' ? 'Profile' : 'My Profile'}
                </Link>
                <a href="mailto:agent@theifoa.com?subject=IFOA%20Agent%20for%20Service%20Enquiry" onClick={() => setMenuOpen(false)}
                  className="rounded-xl px-4 py-3 text-sm font-semibold text-slate-200 hover:bg-white/10 transition-colors">
                  Contact Support
                </a>
                <div className="my-1 h-px bg-white/10" />
                <button onClick={handleLogout}
                  className="rounded-xl px-4 py-3 text-sm font-semibold hover:bg-red-500/20 transition-colors text-left text-red-400">
                  Log Out
                </button>
              </>
            ) : (
              <>
                <div className="my-1 h-px bg-white/10" />
                <Link to="/login" onClick={() => setMenuOpen(false)}
                  className="rounded-full border border-white/20 px-4 py-3 text-center text-xs uppercase tracking-widest font-extrabold text-white transition-all hover:bg-white/10">
                  Login
                </Link>
                <Link to="/signup" onClick={() => setMenuOpen(false)}
                  className="rounded-full px-4 py-3 text-center text-xs uppercase tracking-widest font-extrabold bg-white text-slate-950 transition-all hover:bg-slate-100">
                  Sign Up
                </Link>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  )
}
