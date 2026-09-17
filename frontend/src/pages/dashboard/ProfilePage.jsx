import { useEffect, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../../context/AuthContext'
import { useDataCache } from '../../context/DataCacheContext'
import DashboardLayout from '../../components/layout/DashboardLayout'
import axios from 'axios'
import { EditSubscriptionFormModal } from './SubscriptionPage'
import { User, Mail, Shield, PlaneTakeoff, Key, Copy, Check, Pencil, FileText, Image as ImageIcon, Sparkles } from 'lucide-react'

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api'
const API = axios.create({ baseURL: BASE_URL })

/* ── EditProfileModal ─────────────────────────────────────────────────────── */
function EditProfileModal({ user, isAirline, onClose, onSaveName, onSaveAirlineName }) {
  const [firstName, setFirstName]     = useState(user?.firstName || '')
  const [lastName, setLastName]       = useState(user?.lastName  || '')
  const [airlineName, setAirlineName] = useState(user?.airlineName || '')
  const [saving, setSaving]           = useState(false)
  const [err, setErr]                 = useState('')

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setErr('')
    try {
      if (firstName.trim() !== (user?.firstName || '') || lastName.trim() !== (user?.lastName || '')) {
        await onSaveName({ firstName: firstName.trim(), lastName: lastName.trim() })
      }
      if (isAirline && airlineName.trim() !== (user?.airlineName || '')) {
        await onSaveAirlineName(airlineName.trim())
      }
      onClose()
    } catch (e) {
      setErr(e?.response?.data?.message || 'Failed to update profile.')
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm transition-opacity" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md bg-white rounded-3xl border border-slate-200 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100 bg-slate-50/70">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Account</p>
            <h3 className="text-lg font-black text-slate-900">Edit Profile Details</h3>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full border border-slate-200 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition">✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="px-6 py-5 space-y-4">
            {err && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700">{err}</div>}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400">First Name</label>
              <input type="text" value={firstName} onChange={e => setFirstName(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-800 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/5 transition hover:border-slate-300" />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Last Name</label>
              <input type="text" value={lastName} onChange={e => setLastName(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-800 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/5 transition hover:border-slate-300" />
            </div>
            {isAirline && (
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Airline / Company Name</label>
                <input type="text" value={airlineName} onChange={e => setAirlineName(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-800 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/5 transition hover:border-slate-300" />
              </div>
            )}
          </div>
          <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/70 flex justify-end gap-2.5">
            <button type="button" onClick={onClose} disabled={saving} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-100 transition disabled:opacity-50">Cancel</button>
            <button type="submit" disabled={saving}
              className="rounded-xl text-white px-5 py-2.5 text-xs font-bold transition disabled:opacity-50 hover:bg-slate-800 shadow-sm bg-slate-950">
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  )
}

/* ── LogoUploadModal ──────────────────────────────────────────────────────── */
function LogoUploadModal({ currentLogoUrl, registrationId, token, onClose, onSuccess }) {
  const fileRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [err, setErr]             = useState('')

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  const handleFile = async (file) => {
    if (!file) return
    if (!file.type.startsWith('image/')) { setErr('Only image files accepted.'); return }
    if (file.size > 2 * 1024 * 1024) { setErr('Image must be under 2 MB.'); return }
    setErr(''); setUploading(true)
    try {
      const fd = new FormData()
      fd.append('logo', file)
      const res = await fetch(`${BASE_URL}/airlines/${registrationId}/logo`, {
        method: 'PATCH',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.message || 'Upload failed.')
      onSuccess(json.url)
      onClose()
    } catch (e) {
      setErr(e.message || 'Upload failed.')
    } finally {
      setUploading(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm bg-white rounded-3xl border border-slate-200 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100 bg-slate-50/70">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Branding</p>
            <h3 className="text-base font-black text-slate-900">Upload Company Logo</h3>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full border border-slate-200 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition">✕</button>
        </div>
        <div className="px-6 py-6 space-y-4 text-center">
          {currentLogoUrl && (
            <div className="flex justify-center mb-2">
              <div className="w-24 h-24 rounded-2xl border border-slate-200 p-2 bg-slate-50 flex items-center justify-center shadow-inner">
                <img src={currentLogoUrl} alt="Current logo" className="max-w-full max-h-full object-contain" />
              </div>
            </div>
          )}
          {err && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700 text-left">{err}</div>}
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => handleFile(e.target.files[0])} />
          
          <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
            className="w-full border-2 border-dashed border-slate-200 hover:border-slate-400 rounded-2xl p-6 flex flex-col items-center justify-center gap-2 bg-slate-50/50 hover:bg-slate-50 transition-all cursor-pointer group">
            <div className="w-12 h-12 rounded-2xl bg-white border border-slate-200 flex items-center justify-center text-slate-600 group-hover:scale-105 transition-transform shadow-sm">
              <ImageIcon className="w-5 h-5 text-slate-700" />
            </div>
            <p className="text-sm font-bold text-slate-800 mt-1">
              {uploading ? 'Uploading…' : 'Select an image file'}
            </p>
            <p className="text-[11px] text-slate-400">PNG, JPG, or WebP up to 2 MB</p>
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

/* ── ProfilePage ──────────────────────────────────────────────────────────── */
export default function ProfilePage() {
  const { user, token, updateProfile, updateAirlineName } = useAuth()
  const { getOrFetch, get } = useDataCache()
  const cacheKey = `subs_${user?.id || user?.email}`
  const cachedSubs = get(cacheKey)
  const [sub, setSub]                       = useState(cachedSubs?.[0] || null)
  const [editOpen, setEditOpen]             = useState(false)
  const [infoEditOpen, setInfoEditOpen]     = useState(false)
  const [logoModalOpen, setLogoModalOpen]   = useState(false)
  const [currentLogoUrl, setCurrentLogoUrl] = useState(cachedSubs?.[0]?.logoUrl || '')
  const [copiedId, setCopiedId]             = useState(false)

  const initials = [user?.firstName?.[0], user?.lastName?.[0]].filter(Boolean).join('').toUpperCase() || user?.email?.[0]?.toUpperCase() || '?'
  const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || 'User'
  const isAirline = user?.role === 'airline'

  useEffect(() => {
    if (!user) return
    const headers = { Authorization: `Bearer ${token}` }
    const base = isAirline ? 'airlines' : 'individuals'

    const load = async () => {
      try {
        const merged = await getOrFetch(cacheKey, async () => {
          const emailSubs = user.email
            ? await API.get(`/${base}/by-email?email=${encodeURIComponent(user.email)}`, { headers })
                .then(r => r.data.all || (r.data.data ? [r.data.data] : []))
                .catch(() => [])
            : []
          const seen = new Set(emailSubs.map(s => s._id?.toString()).filter(Boolean))
          const remainingIds = [
            ...(user.subscriptionIds || []),
            ...(user.registrationId ? [user.registrationId] : []),
          ].map(id => id?.toString()).filter(Boolean).filter(id => !seen.has(id))
          const idSubs = remainingIds.length
            ? await Promise.allSettled(remainingIds.map(id => API.get(`/${base}/${id}`, { headers })))
                .then(rs => rs.filter(r => r.status === 'fulfilled' && r.value?.data?.data).map(r => r.value.data.data))
            : []
          return [...emailSubs, ...idSubs]
            .filter(Boolean)
            .filter((item, i, arr) => arr.findIndex(x => x._id?.toString() === item._id?.toString()) === i)
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        })
        const first = merged?.[0] || null
        setSub(first)
        if (first?.logoUrl) setCurrentLogoUrl(first.logoUrl)
      } catch {
        setSub(null)
      }
    }
    load()
  }, [user, token, isAirline, getOrFetch, cacheKey])

  const copyAccountId = () => {
    if (!user?.id) return
    navigator.clipboard.writeText(user.id)
    setCopiedId(true)
    setTimeout(() => setCopiedId(false), 2000)
  }

  return (
    <DashboardLayout>
      {editOpen && (
        <EditProfileModal user={user} isAirline={isAirline} onClose={() => setEditOpen(false)}
          onSaveName={updateProfile} onSaveAirlineName={updateAirlineName} />
      )}
      {infoEditOpen && sub?._id && (
        <EditSubscriptionFormModal
          sub={sub}
          role={user?.role}
          onClose={() => setInfoEditOpen(false)}
          onSaved={(updated) => { setSub(updated); setInfoEditOpen(false) }}
        />
      )}
      {logoModalOpen && sub?._id && (
        <LogoUploadModal
          currentLogoUrl={currentLogoUrl}
          registrationId={sub._id}
          token={token}
          onClose={() => setLogoModalOpen(false)}
          onSuccess={(url) => setCurrentLogoUrl(url)}
        />
      )}

      <div className="max-w-4xl mx-auto space-y-6">

        {/* ── Page Header ── */}
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">Account Profile</h1>
          <p className="text-slate-500 text-sm mt-1">Manage your identity, personal details, and account configuration.</p>
        </div>

        {/* ── Profile Hero Card ── */}
        <div className="rounded-3xl border border-slate-200/90 bg-white p-6 sm:p-8 shadow-[0_2px_12px_rgba(0,0,0,0.03)]">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="flex items-center gap-5 min-w-0">
              {isAirline && currentLogoUrl ? (
                <div
                  className="relative group cursor-pointer w-20 h-20 rounded-2xl border-2 border-slate-100 bg-white flex items-center justify-center p-2 shadow-sm overflow-hidden flex-shrink-0"
                  onClick={() => setLogoModalOpen(true)}
                  title="Click to change logo"
                >
                  <img src={currentLogoUrl} alt="Company logo" className="max-w-full max-h-full object-contain" />
                  <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px] opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                    <Pencil className="w-4 h-4" />
                  </div>
                </div>
              ) : (
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-950 text-white text-2xl font-black flex items-center justify-center flex-shrink-0 shadow-md shadow-slate-900/10 border border-slate-800">
                  {initials}
                </div>
              )}

              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-xl sm:text-2xl font-black text-slate-900 truncate tracking-tight">{fullName}</h2>
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                    · {user?.role}
                  </span>
                </div>
                <p className="text-sm text-slate-500 truncate">{user?.email}</p>
                {isAirline && user?.airlineName && (
                  <p className="text-xs font-semibold text-slate-700 flex items-center gap-1 mt-0.5">
                    <PlaneTakeoff className="w-3.5 h-3.5 text-slate-400" /> {user.airlineName}
                  </p>
                )}
              </div>
            </div>

            {/* Actions toolbar */}
            <div className="flex flex-wrap sm:flex-nowrap gap-2.5 flex-shrink-0">
              <button
                onClick={() => setEditOpen(true)}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50 px-4 py-2.5 text-xs font-bold text-slate-800 transition-all shadow-sm"
              >
                <Pencil className="w-3.5 h-3.5 text-slate-500" />
                Edit Profile
              </button>

              {sub?._id && (
                <button
                  onClick={() => setInfoEditOpen(true)}
                  className="inline-flex items-center gap-2 rounded-xl bg-slate-950 hover:bg-slate-800 px-4 py-2.5 text-xs font-bold text-white transition-all shadow-sm"
                >
                  <FileText className="w-3.5 h-3.5 text-slate-300" />
                  Edit Filing Details
                </button>
              )}

              {isAirline && (
                <button
                  onClick={() => setLogoModalOpen(true)}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50 px-4 py-2.5 text-xs font-bold text-slate-800 transition-all shadow-sm"
                >
                  <ImageIcon className="w-3.5 h-3.5 text-slate-500" />
                  {currentLogoUrl ? 'Change Logo' : 'Upload Logo'}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── Account Details Card ── */}
        <div className="rounded-3xl border border-slate-200/90 bg-white shadow-[0_2px_12px_rgba(0,0,0,0.03)] overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <User className="w-4 h-4 text-slate-500" />
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">Account Details & Metadata</h3>
            </div>
            <span className="text-[11px] font-bold text-slate-400">Verified Credentials</span>
          </div>

          <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="space-y-1 p-3.5 rounded-2xl bg-slate-50/70 border border-slate-100">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <User className="w-3 h-3 text-slate-400" /> First Name
              </p>
              <p className="text-sm font-bold text-slate-900">{user?.firstName || '—'}</p>
            </div>

            <div className="space-y-1 p-3.5 rounded-2xl bg-slate-50/70 border border-slate-100">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <User className="w-3 h-3 text-slate-400" /> Last Name
              </p>
              <p className="text-sm font-bold text-slate-900">{user?.lastName || '—'}</p>
            </div>

            <div className="space-y-1 p-3.5 rounded-2xl bg-slate-50/70 border border-slate-100">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Mail className="w-3 h-3 text-slate-400" /> Primary Email Address
              </p>
              <p className="text-sm font-bold text-slate-900 break-all">{user?.email || '—'}</p>
            </div>

            <div className="space-y-1 p-3.5 rounded-2xl bg-slate-50/70 border border-slate-100">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Shield className="w-3 h-3 text-slate-400" /> System Account Role
              </p>
              <p className="text-sm font-bold text-slate-900 capitalize">{user?.role || '—'}</p>
            </div>

            {isAirline && (
              <div className="space-y-1 p-3.5 rounded-2xl bg-slate-50/70 border border-slate-100 sm:col-span-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <PlaneTakeoff className="w-3 h-3 text-slate-400" /> Airline / Company Organization
                </p>
                <p className="text-sm font-bold text-slate-900">{user?.airlineName || '—'}</p>
              </div>
            )}

            <div className="space-y-1 p-3.5 rounded-2xl bg-slate-50/70 border border-slate-100 sm:col-span-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <Key className="w-3 h-3 text-slate-400" /> Unique Account ID
                </p>
                <button
                  type="button"
                  onClick={copyAccountId}
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 hover:text-black transition-colors"
                >
                  {copiedId ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                  {copiedId ? 'Copied' : 'Copy ID'}
                </button>
              </div>
              <p className="font-mono text-xs text-slate-700 break-all">{user?.id || '—'}</p>
            </div>
          </div>
        </div>

      </div>
    </DashboardLayout>
  )
}
