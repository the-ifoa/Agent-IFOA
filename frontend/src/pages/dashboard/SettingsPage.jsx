import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import DashboardLayout from '../../components/layout/DashboardLayout'
import { useAuth } from '../../context/AuthContext'
import OtpTimer from '../../components/OtpTimer'
import { Shield, KeyRound, Mail, Lock, Eye, EyeOff, CheckCircle2, AlertCircle, Trash2, Plus, ArrowRight, Check } from 'lucide-react'

/* ── ConfirmPasswordModal ─────────────────────────────────────────────────── */
function ConfirmPasswordModal({ title, onConfirm, onClose }) {
  const [pwd, setPwd] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  const handleConfirm = async () => {
    if (!pwd) { setErr('Password is required.'); return }
    setLoading(true); setErr('')
    try {
      await onConfirm(pwd)
      onClose()
    } catch (e) {
      setErr(e?.response?.data?.message || 'Incorrect password.')
    } finally {
      setLoading(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm bg-white rounded-3xl border border-slate-200 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100 bg-slate-50/70">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-red-600">Security Check</p>
            <h3 className="text-base font-black text-slate-900">{title}</h3>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full border border-slate-200 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition">✕</button>
        </div>
        <div className="px-6 py-5 space-y-3">
          {err && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700">{err}</div>}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Current Password</label>
            <input
              type="password"
              value={pwd}
              onChange={e => setPwd(e.target.value)}
              placeholder="Enter your password"
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/5 hover:border-slate-300"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2.5 px-6 py-4 border-t border-slate-100 bg-slate-50/70">
          <button onClick={onClose} disabled={loading} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-100 transition disabled:opacity-50">
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl bg-red-600 hover:bg-red-700 px-4 py-2.5 text-xs font-bold text-white transition disabled:opacity-50 shadow-sm"
          >
            {loading && <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-20" /><path fill="currentColor" d="M12 2a10 10 0 0 1 10 10h-4a6 6 0 0 0-6-6V2Z" /></svg>}
            Confirm Removal
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

function Field({ label, children, error, helper }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{label}</label>
      {children}
      {helper && !error && <p className="text-xs text-slate-400">{helper}</p>}
      {error && (
        <p className="flex items-center gap-1.5 text-xs font-semibold text-red-500">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          {error}
        </p>
      )}
    </div>
  )
}

const inputCls = (hasError) =>
  `w-full rounded-xl border px-4 py-2.5 text-sm font-semibold text-slate-900 outline-none transition ${
    hasError
      ? 'border-red-300 bg-red-50/30 focus:border-red-500 focus:ring-2 focus:ring-red-100'
      : 'border-slate-200 bg-white focus:border-slate-900 focus:ring-2 focus:ring-slate-900/5 hover:border-slate-300'
  }`

export default function SettingsPage() {
  const { user, updateCredentials, addSecondaryEmail, removeSecondaryEmail, sendSecondaryEmailOtp, verifyOtpAndAddSecondary } = useAuth()

  // Secondary email state (airline only)
  const [secEmail, setSecEmail]           = useState('')
  const [secAdding, setSecAdding]         = useState(false)
  const [secStep, setSecStep]             = useState('pwd')  // 'pwd' | 'otp'
  const [secPwd, setSecPwd]               = useState('')
  const [secError, setSecError]           = useState('')
  const [secSuccess, setSecSuccess]       = useState('')
  const [removeTarget, setRemoveTarget]   = useState(null)

  const [currentPwd, setCurrentPwd]       = useState('')
  const [newEmail, setNewEmail]           = useState('')
  const [newPwd, setNewPwd]               = useState('')
  const [confirmPwd, setConfirmPwd]       = useState('')
  const [errors, setErrors]               = useState({})
  const [saving, setSaving]               = useState(false)
  const [success, setSuccess]             = useState('')
  const [showCurrentPwd, setShowCurrentPwd] = useState(false)
  const [showNewPwd, setShowNewPwd]       = useState(false)
  const [showConfirmPwd, setShowConfirmPwd] = useState(false)


  const initials = [user?.firstName?.[0], user?.lastName?.[0]].filter(Boolean).join('').toUpperCase() || user?.email?.[0]?.toUpperCase() || '?'
  const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || 'User'

  const handleAddSecondaryEmail = async (password) => {
    if (!secEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(secEmail)) {
      setSecError('Enter a valid email address.'); return
    }
    setSecError('')
    setSecPwd(password)
    await sendSecondaryEmailOtp(secEmail.trim())
    setSecStep('otp')
  }

  const handleVerifySecondaryOtp = async (code) => {
    await verifyOtpAndAddSecondary(secEmail.trim(), code, secPwd)
    setSecEmail('')
    setSecPwd('')
    setSecAdding(false)
    setSecStep('pwd')
    setSecSuccess('Secondary email verified and added.')
    setTimeout(() => setSecSuccess(''), 4000)
  }

  const validate = () => {
    const e = {}
    if (!currentPwd) e.currentPwd = 'Current password is required.'
    if (!newEmail && !newPwd) e.general = 'Enter a new email or a new password (or both).'
    if (newEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) e.newEmail = 'Enter a valid email address.'
    if (newEmail && newEmail.toLowerCase() === user?.email?.toLowerCase()) e.newEmail = 'New email must be different from current email.'
    if (newPwd && newPwd.length < 8) e.newPwd = 'Password must be at least 8 characters.'
    if (newPwd && confirmPwd !== newPwd) e.confirmPwd = 'Passwords do not match.'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleSave = async () => {
    if (!validate()) return
    setSaving(true)
    setSuccess('')
    setErrors({})
    try {
      await updateCredentials(currentPwd, newEmail.trim() || undefined, newPwd || undefined)
      setSuccess('Your credentials have been updated successfully.')
      setCurrentPwd(''); setNewEmail(''); setNewPwd(''); setConfirmPwd('')
    } catch (err) {
      const msg = err?.response?.data?.message || 'Failed to update credentials.'
      setErrors({ general: msg })
    } finally {
      setSaving(false)
    }
  }

  return (
    <DashboardLayout>
      {removeTarget && (
        <ConfirmPasswordModal
          title={`Remove ${removeTarget}?`}
          onClose={() => setRemoveTarget(null)}
          onConfirm={async (pwd) => {
            await removeSecondaryEmail(pwd, removeTarget)
            setRemoveTarget(null)
          }}
        />
      )}
      <div className="max-w-3xl space-y-6">

        {/* ── Page Header ── */}
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">Security & Settings</h1>
          <p className="text-slate-500 text-sm mt-1">Manage your login credentials, multi-factor authentication, and authorized emails.</p>
        </div>

        {/* ── Current Account Hero Card ── */}
        <div className="rounded-3xl border border-slate-200/90 bg-white p-5 sm:p-6 shadow-[0_2px_12px_rgba(0,0,0,0.03)] flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-950 text-white text-lg font-black flex items-center justify-center flex-shrink-0 shadow-md shadow-slate-950/10 border border-slate-800">
              {initials}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-base font-black text-slate-900 truncate">{fullName}</p>
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  · {user?.role}
                </span>
              </div>
              <p className="text-xs text-slate-500 truncate mt-0.5">{user?.email}</p>
            </div>
          </div>

          <div className="hidden sm:flex items-center gap-1.5 text-xs font-bold text-slate-600">
            <CheckCircle2 className="w-4 h-4 text-slate-800" />
            Verified Account
          </div>
        </div>

        {/* ── Update Credentials Form Card ── */}
        <div className="rounded-3xl border border-slate-200/90 bg-white shadow-[0_2px_12px_rgba(0,0,0,0.03)] overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center text-slate-700">
              <KeyRound className="w-4 h-4" />
            </div>
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">Update Account Credentials</h3>
          </div>

          <div className="p-6 space-y-5">
            {/* Feedback Alerts */}
            {success && (
              <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                <p className="text-xs font-bold text-emerald-700">{success}</p>
              </div>
            )}
            {errors.general && (
              <div className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3.5">
                <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                <p className="text-xs font-bold text-red-600">{errors.general}</p>
              </div>
            )}

            {/* Current Password Field */}
            <div className="p-4 rounded-2xl bg-slate-50/70 border border-slate-100 space-y-2">
              <Field label="Current Password (Required for any changes) *" error={errors.currentPwd}>
                <div className="relative">
                  <input
                    type={showCurrentPwd ? 'text' : 'password'}
                    name="settings-current-password"
                    autoComplete="off"
                    placeholder="Enter your current password"
                    value={currentPwd}
                    onChange={e => setCurrentPwd(e.target.value)}
                    className={inputCls(!!errors.currentPwd) + ' pr-11'}
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPwd(v => !v)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 transition-colors"
                  >
                    {showCurrentPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </Field>
            </div>

            {/* New Credentials Section */}
            <div className="pt-2 space-y-4">
              <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">What would you like to update?</p>

              <Field label="New Email Address" error={errors.newEmail} helper="Leave blank to keep your current email">
                <div className="relative">
                  <input
                    type="email"
                    name="settings-new-email"
                    autoComplete="off"
                    placeholder="Enter new email address"
                    value={newEmail}
                    onChange={e => setNewEmail(e.target.value)}
                    className={inputCls(!!errors.newEmail)}
                  />
                </div>
              </Field>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="New Password" error={errors.newPwd} helper="Min 8 characters, leave blank to keep current">
                  <div className="relative">
                    <input
                      type={showNewPwd ? 'text' : 'password'}
                      name="settings-new-password"
                      autoComplete="new-password"
                      placeholder="New password"
                      value={newPwd}
                      onChange={e => setNewPwd(e.target.value)}
                      className={inputCls(!!errors.newPwd) + ' pr-11'}
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPwd(v => !v)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 transition-colors"
                    >
                      {showNewPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </Field>

                {newPwd ? (
                  <Field label="Confirm New Password" error={errors.confirmPwd}>
                    <div className="relative">
                      <input
                        type={showConfirmPwd ? 'text' : 'password'}
                        name="settings-confirm-new-password"
                        autoComplete="new-password"
                        placeholder="Confirm new password"
                        value={confirmPwd}
                        onChange={e => setConfirmPwd(e.target.value)}
                        className={inputCls(!!errors.confirmPwd) + ' pr-11'}
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPwd(v => !v)}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 transition-colors"
                      >
                        {showConfirmPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </Field>
                ) : (
                  <div className="hidden sm:block" />
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50/70">
            <p className="text-xs text-slate-400 text-center sm:text-left">
              Need assistance?{' '}
              <a href="mailto:agent@theifoa.com" className="text-slate-800 underline underline-offset-4 decoration-slate-300 hover:decoration-black font-bold">Contact support</a>
            </p>
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-xs font-bold text-white transition disabled:opacity-50 w-full sm:w-auto hover:bg-slate-800 shadow-sm bg-slate-950"
            >
              {saving ? (
                <>
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-20" /><path fill="currentColor" d="M12 2a10 10 0 0 1 10 10h-4a6 6 0 0 0-6-6V2Z" /></svg>
                  Processing…
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  Save Changes
                </>
              )}
            </button>
          </div>
        </div>

        {/* ── Secondary Emails (Airline accounts) ── */}
        {user?.role === 'airline' && (
          <div className="rounded-3xl border border-slate-200/90 bg-white shadow-[0_2px_12px_rgba(0,0,0,0.03)] overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center text-slate-700">
                  <Mail className="w-4 h-4" />
                </div>
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">Secondary Login Emails</h3>
              </div>
              <span className="text-[11px] font-bold text-slate-400">
                {(user?.secondaryEmails || []).length} registered
              </span>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-xs text-slate-500 leading-relaxed">
                Add secondary emails to allow designated staff members to sign into this airline account with the same password.
              </p>

              {secSuccess && (
                <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-700">
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                  {secSuccess}
                </div>
              )}
              {secError && (
                <div className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-600">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  {secError}
                </div>
              )}

              {/* Email list */}
              {(user?.secondaryEmails || []).length > 0 ? (
                <div className="space-y-2">
                  {user.secondaryEmails.map((email) => (
                    <div key={email} className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50/70 px-4 py-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-slate-600 flex-shrink-0">
                          <Mail className="w-4 h-4 text-slate-500" />
                        </div>
                        <p className="text-xs font-bold text-slate-800 truncate">{email}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setRemoveTarget(email)}
                        className="w-8 h-8 rounded-xl border border-slate-200 bg-white text-slate-400 hover:border-red-300 hover:text-red-500 transition flex items-center justify-center flex-shrink-0 shadow-sm"
                        title="Remove email"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400 italic py-1">No secondary emails added yet.</p>
              )}

              {/* Add email form */}
              <div className="border-t border-slate-100 pt-4 space-y-3">
                <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">Add New Authorized Email</p>
                <div className="flex gap-2">
                  <input
                    type="email"
                    value={secEmail}
                    onChange={e => { setSecEmail(e.target.value); setSecError('') }}
                    placeholder="teammate@company.com"
                    className="flex-1 min-w-0 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/5 hover:border-slate-300"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!secEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(secEmail)) {
                        setSecError('Enter a valid email address.'); return
                      }
                      setRemoveTarget(null)
                      setSecStep('pwd')
                      setSecAdding(true)
                    }}
                    disabled={secAdding}
                    className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-xs font-bold text-white transition disabled:opacity-50 flex-shrink-0 bg-slate-950 hover:bg-slate-800 shadow-sm"
                  >
                    <Plus className="w-4 h-4" />
                    Add Email
                  </button>
                </div>

                {secAdding && secStep === 'pwd' && (
                  <AddSecondaryConfirm
                    email={secEmail}
                    onConfirm={async (pwd) => { await handleAddSecondaryEmail(pwd) }}
                    onCancel={() => { setSecAdding(false); setSecStep('pwd') }}
                  />
                )}
                {secAdding && secStep === 'otp' && (
                  <AddSecondaryOtp
                    email={secEmail}
                    onVerify={handleVerifySecondaryOtp}
                    onResend={() => sendSecondaryEmailOtp(secEmail.trim())}
                    onCancel={() => { setSecAdding(false); setSecStep('pwd'); setSecPwd('') }}
                  />
                )}
              </div>
            </div>
          </div>
        )}

      </div>
    </DashboardLayout>
  )
}

/* ── Inline password confirm for adding secondary email ───────────────────── */
function AddSecondaryConfirm({ email, onConfirm, onCancel }) {
  const [pwd, setPwd]         = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [err, setErr]         = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async () => {
    if (!pwd) { setErr('Password is required.'); return }
    setLoading(true); setErr('')
    try {
      await onConfirm(pwd)
    } catch (e) {
      setErr(e?.response?.data?.message || 'Failed.')
      setLoading(false)
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 space-y-3">
      <div>
        <p className="text-xs font-bold text-slate-800">Confirm password to add <span className="font-black text-black">{email}</span></p>
        <p className="text-[11px] text-slate-500 mt-0.5">A verification OTP will then be sent to {email}.</p>
      </div>
      {err && <p className="text-xs font-semibold text-red-600">{err}</p>}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type={showPwd ? 'text' : 'password'}
            value={pwd}
            onChange={e => setPwd(e.target.value)}
            placeholder="Your current password"
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 pr-9 text-xs font-semibold text-slate-900 outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/5"
          />
          <button
            type="button"
            onClick={() => setShowPwd(v => !v)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
          >
            {showPwd ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
        </div>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-white transition disabled:opacity-50 flex-shrink-0 bg-slate-950 hover:bg-slate-800 shadow-sm"
        >
          {loading ? 'Sending…' : 'Send Code'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 transition disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

/* ── Inline OTP entry for verifying secondary email ─────────────────────────── */
function AddSecondaryOtp({ email, onVerify, onResend, onCancel }) {
  const [digits, setDigits] = useState(['', '', '', '', '', ''])
  const [err, setErr]       = useState('')
  const [loading, setLoading] = useState(false)
  const [resending, setResending] = useState(false)
  const [resent, setResent] = useState(false)
  const [timerKey, setTimerKey] = useState(0)
  const inputRefs = useRef([])

  const code = digits.join('')

  const handleDigit = (i, val) => {
    if (!/^\d?$/.test(val)) return
    const next = [...digits]; next[i] = val; setDigits(next)
    if (val && i < 5) inputRefs.current[i + 1]?.focus()
  }

  const handleKeyDown = (i, e) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) inputRefs.current[i - 1]?.focus()
    if (e.key === 'ArrowLeft' && i > 0) inputRefs.current[i - 1]?.focus()
    if (e.key === 'ArrowRight' && i < 5) inputRefs.current[i + 1]?.focus()
  }

  const handlePaste = (e) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (!pasted) return; e.preventDefault()
    setDigits(pasted.split('').concat(Array(6).fill('')).slice(0, 6))
    inputRefs.current[Math.min(pasted.length, 5)]?.focus()
  }

  const handleSubmit = async () => {
    if (code.length < 6) { setErr('Enter the full 6-digit code.'); return }
    setLoading(true); setErr('')
    try {
      await onVerify(code)
    } catch (e) {
      setErr(e?.response?.data?.message || 'Invalid or expired code.')
      setDigits(['', '', '', '', '', ''])
      inputRefs.current[0]?.focus()
      setLoading(false)
    }
  }

  const handleResend = async () => {
    setResending(true); setErr(''); setResent(false)
    try {
      await onResend()
      setResent(true)
      setTimerKey(k => k + 1)
      setDigits(['', '', '', '', '', ''])
      inputRefs.current[0]?.focus()
      setTimeout(() => setResent(false), 4000)
    } catch (e) {
      setErr(e?.response?.data?.message || 'Failed to resend.')
    } finally {
      setResending(false)
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-slate-800">Code sent to <span className="font-black text-black">{email}</span></p>
        <OtpTimer resetKey={timerKey} />
      </div>
      {err && <p className="text-xs font-semibold text-red-600">{err}</p>}
      {resent && <p className="text-xs font-semibold text-emerald-600">New code sent!</p>}

      <div className="flex gap-1.5 justify-start py-1" onPaste={handlePaste}>
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
            className="w-10 h-11 text-center text-base font-black rounded-xl border-2 outline-none transition"
            style={{
              borderColor: d ? '#020617' : '#e2e8f0',
              background: d ? '#f8fafc' : '#ffffff',
              color: '#020617',
            }}
            onFocus={e => { e.target.style.borderColor = '#020617'; e.target.style.boxShadow = '0 0 0 2px rgba(2,6,23,0.08)' }}
            onBlur={e => { if (!d) { e.target.style.borderColor = '#e2e8f0'; e.target.style.boxShadow = 'none' } }}
          />
        ))}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={loading || code.length < 6}
          className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-white transition disabled:opacity-50 flex-shrink-0 bg-slate-950 hover:bg-slate-800 shadow-sm"
        >
          {loading ? 'Verifying…' : 'Verify & Add'}
        </button>
        <button
          type="button"
          onClick={handleResend}
          disabled={resending || loading}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 transition disabled:opacity-50"
        >
          {resending ? 'Sending…' : 'Resend'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 transition disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
