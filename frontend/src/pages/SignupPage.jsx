import { useState, useRef, useCallback } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import logo from '../assets/IFOA_USA_white.png'
import { Lock, ShieldCheck, MapPin, Check } from 'lucide-react'
import OtpTimer from '../components/OtpTimer'

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api'

const EyeOn = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
  </svg>
)

const EyeOff = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
  </svg>
)

const roles = [
  { value: 'individual', label: 'Individual Pilot / Dispatcher', desc: 'Part 61/65 certificate holders' },
  { value: 'airline', label: 'Airline / Operator', desc: 'Companies with 3+ certificate holders' },
]

// ── OTP Verification Modal ────────────────────────────────────────────────────
function OtpModal({ email, onVerify, onResend, onCancel }) {
  const [digits, setDigits] = useState(['', '', '', '', '', ''])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [resending, setResending] = useState(false)
  const [resent, setResent] = useState(false)
  const [timerKey, setTimerKey] = useState(0)
  const inputRefs = useRef([])

  const code = digits.join('')

  const handleDigit = (i, val) => {
    if (!/^\d?$/.test(val)) return
    const next = [...digits]
    next[i] = val
    setDigits(next)
    if (val && i < 5) inputRefs.current[i + 1]?.focus()
  }

  const handleKeyDown = (i, e) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) {
      inputRefs.current[i - 1]?.focus()
    }
    if (e.key === 'ArrowLeft' && i > 0) inputRefs.current[i - 1]?.focus()
    if (e.key === 'ArrowRight' && i < 5) inputRefs.current[i + 1]?.focus()
  }

  const handlePaste = (e) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (!pasted) return
    e.preventDefault()
    const next = pasted.split('').concat(Array(6).fill('')).slice(0, 6)
    setDigits(next)
    const lastFilled = Math.min(pasted.length, 5)
    inputRefs.current[lastFilled]?.focus()
  }

  const handleVerify = async () => {
    if (code.length < 6) { setError('Enter the full 6-digit code.'); return }
    setLoading(true); setError('')
    try {
      await onVerify(code)
    } catch (e) {
      setError(e?.response?.data?.message || 'Invalid or expired code. Try again.')
      setDigits(['', '', '', '', '', ''])
      inputRefs.current[0]?.focus()
    } finally {
      setLoading(false)
    }
  }

  const handleResend = async () => {
    setResending(true); setError(''); setResent(false)
    try {
      await onResend()
      setResent(true)
      setTimerKey(k => k + 1)
      setDigits(['', '', '', '', '', ''])
      inputRefs.current[0]?.focus()
      setTimeout(() => setResent(false), 4000)
    } catch (e) {
      setError(e?.response?.data?.message || 'Failed to resend. Try again.')
    } finally {
      setResending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ duration: 0.22 }}
        className="w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden"
        style={{ border: '1px solid #e2e8f0' }}
      >
        <div className="px-6 pt-6 pb-5 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center flex-shrink-0">
              <svg className="w-4.5 h-4.5 text-slate-600" style={{ width: '1.1rem', height: '1.1rem' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
              </svg>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Email Verification</p>
              <h2 className="text-sm font-black text-slate-900 leading-tight">Verify Your Email</h2>
            </div>
          </div>
        </div>
        <div className="px-6 py-6">

          <p className="text-sm text-slate-600 mb-1">We sent a 6-digit code to</p>
          <p className="text-sm font-bold text-slate-900 truncate">{email}</p>
          <div className="mt-1 mb-4"><OtpTimer resetKey={timerKey} /></div>

          {error && (
            <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-600">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="9" /><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01" /></svg>
              {error}
            </div>
          )}
          {resent && (
            <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
              New code sent!
            </div>
          )}

          <div className="flex gap-2 justify-center mb-5" onPaste={handlePaste}>
            {digits.map((d, i) => (
              <input
                key={i}
                ref={el => inputRefs.current[i] = el}
                type="text"
                inputMode="numeric"
                maxLength={1}
                value={d}
                onChange={e => handleDigit(i, e.target.value)}
                onKeyDown={e => handleKeyDown(i, e)}
                className="w-11 h-12 text-center text-lg font-black rounded-xl border-2 outline-none transition"
                style={{
                  borderColor: d ? '#34E06E' : '#e2e8f0',
                  background: d ? '#e8fbf0' : '#f8fafc',
                  color: '#020617',
                }}
                onFocus={e => { e.target.style.borderColor = '#34E06E'; e.target.style.boxShadow = '0 0 0 3px rgba(52,224,110,0.25)' }}
                onBlur={e => { if (!d) { e.target.style.borderColor = '#e2e8f0'; e.target.style.boxShadow = 'none' } }}
              />
            ))}
          </div>

          <button
            onClick={handleVerify}
            disabled={loading || code.length < 6}
            className="w-full rounded-xl py-3 text-sm font-extrabold transition-all duration-150 flex items-center justify-center gap-2 mb-3 bg-slate-900 hover:bg-slate-800 text-white shadow-sm active:scale-[0.99] disabled:opacity-50 cursor-pointer"
          >
            {loading ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} className="opacity-20" />
                  <path fill="currentColor" d="M12 2a10 10 0 0 1 10 10h-4a6 6 0 0 0-6-6V2Z" />
                </svg>
                Verifying…
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                </svg>
                Verify & Create Account
              </>
            )}
          </button>

          <div className="flex items-center justify-between text-xs text-slate-500">
            <button onClick={handleResend} disabled={resending} className="hover:text-[#020617] font-semibold transition-colors disabled:opacity-50">
              {resending ? 'Sending…' : 'Resend code'}
            </button>
            <button onClick={onCancel} className="hover:text-slate-800 transition-colors">
              Change email
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  )
}

// Dev bypass — set VITE_SKIP_OTP=true in frontend/.env to skip the OTP modal
// entirely (must match backend SKIP_OTP). Never true in prod.
const SKIP_OTP = String(import.meta.env.VITE_SKIP_OTP).toLowerCase() === 'true'

export default function SignupPage() {
  const { sendOtp, verifyOtpAndSignup } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = location.state?.from?.pathname

  const [role, setRole] = useState('individual')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [airlineName, setAirlineName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [showConfirmPw, setShowConfirmPw] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showOtp, setShowOtp] = useState(false)
  const [logoUrl, setLogoUrl] = useState('')
  const [logoUploading, setLogoUploading] = useState(false)
  const [logoErr, setLogoErr] = useState('')
  const logoFileRef = useRef(null)

  const handleLogoFile = useCallback(async (file) => {
    if (!file) return
    if (!file.type.startsWith('image/')) { setLogoErr('Only image files accepted.'); return }
    if (file.size > 2 * 1024 * 1024) { setLogoErr('Image must be under 2 MB.'); return }
    setLogoErr('')
    setLogoUploading(true)
    try {
      const fd = new FormData()
      fd.append('logo', file)
      const res = await fetch(`${BASE_URL}/airlines/upload-logo`, { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok) throw new Error(json.message || 'Upload failed.')
      setLogoUrl(json.url)
    } catch (e) {
      setLogoErr(e.message || 'Upload failed.')
    } finally {
      setLogoUploading(false)
    }
  }, [])

  const inputStyle = {
    borderColor: '#e2e8f0',
    background: '#f8fafc',
    color: '#0f172a',
  }
  const focusStyle = (e) => { e.target.style.borderColor = '#34E06E'; e.target.style.boxShadow = '0 0 0 3px rgba(52,224,110,0.25)' }
  const blurStyle = (e) => { e.target.style.borderColor = '#e2e8f0'; e.target.style.boxShadow = 'none' }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (role === 'airline' && !airlineName.trim()) { setError('Airline / company name is required.'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (password !== confirmPw) { setError('Passwords do not match.'); return }
    setLoading(true)
    try {
      await sendOtp(email.trim().toLowerCase(), 'signup')
      if (SKIP_OTP) {
        // Dev bypass — backend accepts any code when SKIP_OTP=true.
        await handleVerify('000000')
      } else {
        setShowOtp(true)
      }
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to send verification code. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleVerify = async (code) => {
    const user = await verifyOtpAndSignup(email.trim().toLowerCase(), code, {
      password, role, firstName, lastName,
      airlineName: role === 'airline' ? airlineName.trim() : undefined,
      logoUrl: role === 'airline' ? logoUrl : undefined,
    })
    setShowOtp(false)
    if (from && from !== '/signup' && from !== '/login') {
      navigate(from, { replace: true })
    } else {
      navigate(user.role === 'admin' ? '/admin' : '/dashboard', { replace: true })
    }
  }

  const handleResend = async () => {
    await sendOtp(email.trim().toLowerCase(), 'signup')
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-8 sm:py-12 bg-slate-50/70 relative overflow-hidden">

      <AnimatePresence>
        {showOtp && (
          <OtpModal
            email={email}
            onVerify={handleVerify}
            onResend={handleResend}
            onCancel={() => setShowOtp(false)}
          />
        )}
      </AnimatePresence>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-full max-w-[620px] z-10"
      >
        {/* Card */}
        <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8">
          {/* Header with logo */}
          <div className="text-center mb-5">
            <Link to="/" className="inline-block transition-transform hover:scale-[1.02] active:scale-[0.98]">
              <img src={logo} alt="IFOA USA" className="h-9 sm:h-10 w-auto mx-auto object-contain" />
            </Link>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight mt-3">Create your account</h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">Join thousands of pilots and operators using IFOA USA.</p>
          </div>

          {error && (
            <div className="mb-4 flex items-center gap-3 rounded-xl border border-red-200 bg-red-50/80 px-4 py-3 text-xs sm:text-sm font-semibold text-red-600">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <circle cx="12" cy="12" r="9" /><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01" />
              </svg>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3.5">
            {/* Role selector */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Account Type</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {roles.map(r => {
                  const isSelected = role === r.value
                  return (
                    <button
                      key={r.value}
                      type="button"
                      onClick={() => setRole(r.value)}
                      className={`rounded-xl p-3 text-left transition-all border cursor-pointer ${
                        isSelected
                          ? 'border-slate-900 bg-slate-900 text-white shadow-sm ring-2 ring-slate-900/10'
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 text-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <p className={`text-xs font-bold leading-tight ${isSelected ? 'text-white' : 'text-slate-900'}`}>{r.label}</p>
                        {isSelected && <Check className="w-4 h-4 text-[#34E06E] flex-shrink-0 ml-1.5" strokeWidth={2.5} />}
                      </div>
                      <p className={`text-[10px] mt-1 font-medium leading-normal ${isSelected ? 'text-slate-300' : 'text-slate-400'}`}>{r.desc}</p>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Airline Name + Logo */}
            {role === 'airline' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 items-start">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                    Airline / Company Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={airlineName}
                    onChange={e => setAirlineName(e.target.value)}
                    placeholder="e.g. Skyline Airways Inc."
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 sm:py-2.5 text-sm font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 placeholder:font-normal hover:border-slate-300 focus:border-slate-900 focus:ring-4 focus:ring-slate-900/5"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                    Company Logo <span className="font-normal normal-case text-slate-400">(optional)</span>
                  </label>
                  <div className="flex items-center gap-2.5 h-[42px]">
                    {logoUrl ? (
                      <img src={logoUrl} alt="Company logo" className="w-10 h-10 rounded-xl object-contain flex-shrink-0 border border-slate-200 bg-slate-50 p-0.5" />
                    ) : (
                      <div className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center border-2 border-dashed border-slate-200 bg-slate-50">
                        <svg className="w-4 h-4 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
                        </svg>
                      </div>
                    )}
                    <div className="flex flex-col gap-0.5">
                      <input ref={logoFileRef} type="file" accept="image/*" className="hidden" onChange={e => handleLogoFile(e.target.files[0])} />
                      <button type="button" onClick={() => logoFileRef.current?.click()} disabled={logoUploading}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 transition disabled:opacity-50">
                        {logoUploading ? (
                          <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} opacity="0.2" /><path fill="currentColor" d="M12 2a10 10 0 0 1 10 10h-4a6 6 0 0 0-6-6V2Z" /></svg>
                        ) : (
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" /></svg>
                        )}
                        {logoUploading ? 'Uploading…' : logoUrl ? 'Change' : 'Upload'}
                      </button>
                      {logoErr && <p className="text-xs text-red-500">{logoErr}</p>}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Name */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">First Name</label>
                <input
                  type="text"
                  required
                  value={firstName}
                  onChange={e => setFirstName(e.target.value)}
                  placeholder="John"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 sm:py-3 text-sm font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 placeholder:font-normal hover:border-slate-300 focus:border-slate-900 focus:ring-4 focus:ring-slate-900/5"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Last Name</label>
                <input
                  type="text"
                  required
                  value={lastName}
                  onChange={e => setLastName(e.target.value)}
                  placeholder="Doe"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 sm:py-3 text-sm font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 placeholder:font-normal hover:border-slate-300 focus:border-slate-900 focus:ring-4 focus:ring-slate-900/5"
                />
              </div>
            </div>

            {/* Email */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Email Address</label>
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 sm:py-3 text-sm font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 placeholder:font-normal hover:border-slate-300 focus:border-slate-900 focus:ring-4 focus:ring-slate-900/5"
              />
            </div>

            {/* Password + Confirm */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Password</label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Min. 8 chars"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 sm:py-3 pr-10 text-sm font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 placeholder:font-normal hover:border-slate-300 focus:border-slate-900 focus:ring-4 focus:ring-slate-900/5"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(v => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 transition-colors"
                  >
                    {showPw ? <EyeOff /> : <EyeOn />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Confirm</label>
                <div className="relative">
                  <input
                    type={showConfirmPw ? 'text' : 'password'}
                    required
                    value={confirmPw}
                    onChange={e => setConfirmPw(e.target.value)}
                    placeholder="Repeat password"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 sm:py-3 pr-10 text-sm font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 placeholder:font-normal hover:border-slate-300 focus:border-slate-900 focus:ring-4 focus:ring-slate-900/5"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPw(v => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 transition-colors"
                  >
                    {showConfirmPw ? <EyeOff /> : <EyeOn />}
                  </button>
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl py-3 sm:py-3.5 text-sm font-extrabold transition-all duration-150 flex items-center justify-center gap-2 mt-2 bg-slate-900 hover:bg-slate-800 text-white shadow-sm active:scale-[0.99] disabled:opacity-50 cursor-pointer"
            >
              {loading ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-20" />
                    <path fill="currentColor" d="M12 2a10 10 0 0 1 10 10h-4a6 6 0 0 0-6-6V2Z" />
                  </svg>
                  Sending code…
                </>
              ) : 'Send Verification Code'}
            </button>
          </form>

          {/* Footer switcher */}
          <div className="mt-6 pt-5 border-t border-slate-100 flex flex-col items-center gap-3 text-center">
            <p className="text-xs sm:text-sm text-slate-500">
              Have an account?{' '}
              <Link to="/login" className="font-bold text-slate-900 underline decoration-[#34E06E] decoration-2 underline-offset-4 hover:opacity-80 transition-opacity">
                Sign in
              </Link>
            </p>
            <Link to="/" className="text-xs font-semibold text-slate-400 hover:text-slate-700 transition-colors">
              ← Back to home
            </Link>
          </div>
        </div>

        {/* Trust badges */}
        <div className="mt-6 flex items-center justify-center gap-4 text-[11px] font-semibold text-slate-400">
          <span className="flex items-center gap-1.5"><Lock className="w-3.5 h-3.5 text-slate-400" /> Secure</span>
          <span className="text-slate-300">·</span>
          <span className="flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5 text-slate-400" /> FAA Compliant</span>
          <span className="text-slate-300">·</span>
          <span className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5 text-slate-400" /> U.S. Office</span>
        </div>
      </motion.div>
    </div>
  )
}
