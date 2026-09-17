import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import DashboardLayout from '../../components/layout/DashboardLayout'
import {
  User,
  Mail,
  Shield,
  Lock,
  Key,
  CheckCircle2,
  Copy,
  Check,
  Pencil,
  X,
} from 'lucide-react'

// ── Inline Info Row ────────────────────────────────────────────────────────
function ProfileInfoField({ label, value, icon: Icon, isCopyable, onCopy, copied }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-4 rounded-xl border border-slate-100 bg-slate-50/50 hover:bg-slate-50 transition">
      <div className="flex items-center gap-3">
        {Icon && (
          <div className="w-8 h-8 rounded-lg bg-white border border-slate-200/80 flex items-center justify-center text-slate-500 flex-shrink-0">
            <Icon className="w-4 h-4" />
          </div>
        )}
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{label}</p>
          <p className="text-sm font-bold text-slate-900 mt-0.5 break-all">{value || '—'}</p>
        </div>
      </div>
      {isCopyable && value && (
        <button
          onClick={() => onCopy(value)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition self-start sm:self-auto shadow-2xs"
          title="Copy to clipboard"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-600" />
              <span className="text-emerald-700 font-bold">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5 text-slate-400" />
              <span>Copy ID</span>
            </>
          )}
        </button>
      )}
    </div>
  )
}

// ── Inline Edit Name Modal ───────────────────────────────────────────────────
function EditNameModal({ user, onClose, onSave }) {
  const [firstName, setFirstName] = useState(user?.firstName || '')
  const [lastName, setLastName] = useState(user?.lastName || '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const handleSave = async (e) => {
    e?.preventDefault()
    if (!firstName.trim() && !lastName.trim()) {
      setErr('Please enter at least a first name or last name.')
      return
    }
    setSaving(true)
    setErr('')
    try {
      await onSave(firstName.trim(), lastName.trim())
      onClose()
    } catch (e) {
      setErr(e?.response?.data?.message || 'Failed to update name.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100 bg-slate-50/70">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Edit Profile</p>
            <h3 className="text-lg font-black text-slate-900 mt-0.5">Change Administrator Name</h3>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={handleSave}>
          <div className="px-6 py-5 space-y-4">
            {err && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 font-medium">
                {err}
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500">First Name</label>
              <input
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-900 outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-100 hover:border-slate-300"
                value={firstName}
                onChange={e => setFirstName(e.target.value)}
                placeholder="Enter first name"
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Last Name</label>
              <input
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-900 outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-100 hover:border-slate-300"
                value={lastName}
                onChange={e => setLastName(e.target.value)}
                placeholder="Enter last name"
              />
            </div>
          </div>
          <div className="flex justify-end gap-3 border-t border-slate-100 bg-slate-50/70 px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-xs font-bold text-white transition disabled:opacity-50 hover:bg-slate-800 shadow-sm"
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Inline Change Password Modal ─────────────────────────────────────────────
function ChangePasswordModal({ onClose, onSave }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [success, setSuccess] = useState(false)

  const handleSave = async (e) => {
    e?.preventDefault()
    if (!currentPassword.trim()) {
      setErr('Current password is required.')
      return
    }
    if (newPassword.length < 8) {
      setErr('New password must be at least 8 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setErr('Passwords do not match.')
      return
    }
    setSaving(true)
    setErr('')
    try {
      await onSave(currentPassword, newPassword)
      setSuccess(true)
      setTimeout(onClose, 1500)
    } catch (e) {
      setErr(e?.response?.data?.message || 'Failed to update password.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100 bg-slate-50/70">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Security</p>
            <h3 className="text-lg font-black text-slate-900 mt-0.5">Change Password</h3>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={handleSave}>
          <div className="px-6 py-5 space-y-4">
            {success && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 font-semibold flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                Password updated successfully!
              </div>
            )}
            {err && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 font-medium">
                {err}
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Current Password</label>
              <input
                type="password"
                value={currentPassword}
                onChange={e => setCurrentPassword(e.target.value)}
                placeholder="Enter current password"
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-900 outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-100 hover:border-slate-300"
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500">New Password</label>
              <input
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="Min. 8 characters"
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-900 outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-100 hover:border-slate-300"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Confirm New Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="Re-enter new password"
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-900 outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-100 hover:border-slate-300"
              />
            </div>
          </div>
          <div className="flex justify-end gap-3 border-t border-slate-100 bg-slate-50/70 px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || success}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-xs font-bold text-white transition disabled:opacity-50 hover:bg-slate-800 shadow-sm"
            >
              {saving ? 'Saving…' : 'Update Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function AdminProfilePage() {
  const { user, updateProfile, updateCredentials } = useAuth()
  const [editNameOpen, setEditNameOpen] = useState(false)
  const [passwordModalOpen, setPasswordModalOpen] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [copiedId, setCopiedId] = useState(false)

  const initials = [user?.firstName?.[0], user?.lastName?.[0]].filter(Boolean).join('').toUpperCase() || 'A'
  const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || 'Administrator'

  const handleSaveName = async (firstName, lastName) => {
    await updateProfile(firstName, lastName)
    setSaveSuccess(true)
    setTimeout(() => setSaveSuccess(false), 3000)
  }

  const handleCopyId = (id) => {
    if (!id) return
    navigator.clipboard.writeText(id)
    setCopiedId(true)
    setTimeout(() => setCopiedId(false), 2000)
  }

  return (
    <DashboardLayout>
      {editNameOpen && (
        <EditNameModal
          user={user}
          onClose={() => setEditNameOpen(false)}
          onSave={handleSaveName}
        />
      )}
      {passwordModalOpen && (
        <ChangePasswordModal
          onClose={() => setPasswordModalOpen(false)}
          onSave={(currentPassword, newPassword) => updateCredentials(currentPassword, null, newPassword)}
        />
      )}

      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header Strip */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="inline-block">
              <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">Admin Profile</h1>
              <div className="h-0.5 w-full bg-emerald-500 rounded-full mt-1.5 mb-2" />
            </div>
            <p className="text-slate-500 text-sm">Manage your administrator account credentials and personal information.</p>
          </div>
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => setEditNameOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition shadow-xs"
            >
              <Pencil className="w-3.5 h-3.5 text-slate-500" />
              Edit Name
            </button>
            <button
              onClick={() => setPasswordModalOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-bold text-white hover:bg-slate-800 transition shadow-xs"
            >
              <Key className="w-3.5 h-3.5 text-slate-300" />
              Change Password
            </button>
          </div>
        </div>

        {/* Success toast */}
        {saveSuccess && (
          <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3.5 text-sm text-emerald-800 font-semibold shadow-xs">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            Administrator name updated successfully!
          </div>
        )}

        {/* ── Main Profile Identity Card ── */}
        <div className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-sm flex flex-col sm:flex-row items-center sm:items-center justify-between gap-6 text-center sm:text-left">
          <div className="flex flex-col sm:flex-row items-center gap-5 min-w-0">
            <div className="w-16 h-16 rounded-2xl bg-slate-900 text-white text-2xl font-black flex items-center justify-center flex-shrink-0 shadow-md">
              {initials}
            </div>
            <div className="min-w-0">
              <h2 className="text-xl font-black text-slate-900 truncate">{fullName}</h2>
              <p className="text-slate-500 text-sm font-medium truncate mt-0.5">{user?.email}</p>
              <div className="flex items-center justify-center sm:justify-start gap-2 mt-2">
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 border border-slate-200 px-2.5 py-1 text-xs font-bold text-slate-700">
                  <Shield className="w-3.5 h-3.5 text-slate-500" />
                  System Administrator
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 border border-emerald-200/80 px-2.5 py-1 text-xs font-bold text-emerald-700">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  Active
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Account Details & Security Grid ── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Account Details Card */}
          <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200/90 shadow-sm p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Identity</p>
                <h3 className="text-lg font-black text-slate-900 mt-0.5">Account Details</h3>
              </div>
              <button
                onClick={() => setEditNameOpen(true)}
                className="text-xs font-bold text-slate-700 hover:text-slate-900 hover:underline"
              >
                Edit Details →
              </button>
            </div>

            <div className="space-y-3">
              <ProfileInfoField
                label="First Name"
                value={user?.firstName}
                icon={User}
              />
              <ProfileInfoField
                label="Last Name"
                value={user?.lastName}
                icon={User}
              />
              <ProfileInfoField
                label="Email Address"
                value={user?.email}
                icon={Mail}
              />
              <ProfileInfoField
                label="Account ID"
                value={user?.id}
                icon={Shield}
                isCopyable={true}
                onCopy={handleCopyId}
                copied={copiedId}
              />
            </div>
          </div>

          {/* Security & Access Card */}
          <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200/90 shadow-sm p-6 flex flex-col justify-between space-y-6">
            <div>
              <div className="pb-3 border-b border-slate-100 mb-4">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Authentication</p>
                <h3 className="text-lg font-black text-slate-900 mt-0.5">Security & Access</h3>
              </div>

              <div className="space-y-3.5">
                <div className="p-3.5 rounded-xl border border-slate-100 bg-slate-50/60">
                  <div className="flex items-center gap-2.5 mb-1">
                    <Lock className="w-4 h-4 text-slate-600" />
                    <span className="text-xs font-bold text-slate-800">Password Authentication</span>
                  </div>
                  <p className="text-xs text-slate-500 font-medium">Protected by encrypted password authentication.</p>
                </div>

                <div className="p-3.5 rounded-xl border border-slate-100 bg-slate-50/60">
                  <div className="flex items-center gap-2.5 mb-1">
                    <Shield className="w-4 h-4 text-slate-600" />
                    <span className="text-xs font-bold text-slate-800">Role & Permissions</span>
                  </div>
                  <p className="text-xs text-slate-500 font-medium">Full platform read/write access across pilot directories, airline subscriptions, and invoices.</p>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100">
              <button
                onClick={() => setPasswordModalOpen(true)}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-2.5 px-4 text-xs font-bold text-slate-800 hover:bg-slate-50 hover:border-slate-300 transition shadow-2xs"
              >
                <Key className="w-3.5 h-3.5 text-slate-500" />
                Update Password
              </button>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}
