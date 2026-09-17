import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useDataCache } from '../../context/DataCacheContext'
import DashboardLayout from '../../components/layout/DashboardLayout'
import { Link } from 'react-router-dom'
import axios from 'axios'
import { PlaneTakeoff, ShieldCheck, User, CreditCard, ArrowRight, CheckCircle2, AlertCircle, Clock, FileText, ChevronRight } from 'lucide-react'
import { getAirlineTotal } from '../../utils/airlineTotal'

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api'
const API = axios.create({ baseURL: BASE_URL })

function StatCard({ label, value, icon, accent = 'slate', sub }) {
  const configs = {
    slate:   { iconBg: 'bg-slate-100 text-slate-700' },
    emerald: { iconBg: 'bg-emerald-50 text-emerald-600 border border-emerald-100' },
    amber:   { iconBg: 'bg-amber-50 text-amber-600 border border-amber-100' },
  }
  const c = configs[accent] || configs.slate

  return (
    <div className="group relative rounded-2xl bg-white p-5 border border-slate-200/90 shadow-[0_2px_12px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] hover:border-slate-300 transition-all duration-200">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">{label}</p>
          <p className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight truncate">{value}</p>
          {sub && <p className="text-xs text-slate-500 font-medium mt-1 truncate">{sub}</p>}
        </div>
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm transition-transform duration-200 group-hover:scale-105 ${c.iconBg}`}>
          {icon}
        </div>
      </div>
    </div>
  )
}

function ActionTile({ icon, title, desc, to, href }) {
  const content = (
    <div className="group flex items-center gap-4 rounded-xl border border-slate-100 p-3.5 hover:border-slate-200 hover:bg-slate-50/80 transition-all duration-150">
      <div className="w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center flex-shrink-0 shadow-sm group-hover:bg-slate-800 transition-colors">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-slate-900 group-hover:text-black transition-colors">{title}</p>
        <p className="text-xs text-slate-500 truncate mt-0.5">{desc}</p>
      </div>
      <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-600 group-hover:translate-x-0.5 transition-all flex-shrink-0" />
    </div>
  )

  if (href) return <a href={href} className="block">{content}</a>
  return <Link to={to} className="block">{content}</Link>
}

export default function UserDashboard() {
  const { user, token } = useAuth()
  const { getOrFetch, get } = useDataCache()
  const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || 'User'
  const isAirline = user?.role === 'airline'
  const cacheKey = `sub_${user?.id || user?.email}`
  const cachedSub = get(cacheKey)
  const [sub, setSub] = useState(cachedSub || null)
  const [subLoading, setSubLoading] = useState(!cachedSub)

  useEffect(() => {
    if (!user) { setSubLoading(false); return }
    const headers = { Authorization: `Bearer ${token}` }
    const isAirline = user.role === 'airline'

    const load = async () => {
      try {
        const result = await getOrFetch(cacheKey, async () => {
          const endpointById    = isAirline ? '/airlines'          : '/individuals'
          const endpointByEmail = isAirline ? '/airlines/by-email' : '/individuals/by-email'

          if (user.email) {
            try {
              const r = await API.get(`${endpointByEmail}?email=${encodeURIComponent(user.email)}`, { headers })
              if (r.data?.data) return r.data.data
            } catch { /* fall through */ }
          }

          if (user.registrationId) {
            try {
              const r = await API.get(`${endpointById}/${user.registrationId}`, { headers })
              if (r.data?.data) return r.data.data
            } catch { /* no record */ }
          }

          return null
        })
        setSub(result)
      } catch { /* no sub yet */ }
      finally { setSubLoading(false) }
    }
    load()
  }, [user, token, getOrFetch, cacheKey])

  const getSubStatus = () => {
    if (subLoading) return { label: 'Loading…', accent: 'slate', sub: 'Checking subscription' }
    if (!sub) return { label: 'No Plan', accent: 'slate', sub: 'Register to activate' }
    const onHold = sub.status === 'Inactive'
    const paid   = !onHold && (sub.isPaid === true || sub.paymentStatus === 'paid' || sub.status === 'Active')
    const failed = sub.paymentStatus === 'failed'
    if (onHold) return { label: 'On Hold', accent: 'amber', sub: sub.subscriptionPlan }
    if (paid)   return { label: 'Active', accent: 'emerald', sub: sub.subscriptionPlan }
    if (failed) return { label: 'Inactive', accent: 'slate', sub: sub.subscriptionPlan }
    return { label: 'Pending', accent: 'amber', sub: sub.subscriptionPlan }
  }
  const subStatus = getSubStatus()

  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto space-y-6">

        {/* ── Top Header Card ── */}
        <div className="relative rounded-3xl overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white p-6 sm:p-8 shadow-xl shadow-slate-950/10 border border-slate-800">
          <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                IFOA USA · Portal Overview
              </p>
              <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white flex items-center gap-2">
                Welcome back, {user?.firstName || fullName} <span className="animate-waving-hand">👋</span>
              </h1>
              <p className="text-slate-400 text-sm max-w-xl leading-relaxed">
                Manage your FAA Agent for Service compliance, certificate records, and subscription status seamlessly.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {!subLoading && !sub ? (
                <Link
                  to="/register"
                  className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-xs font-black uppercase tracking-wider text-slate-950 transition-all hover:bg-slate-100 shadow-md shadow-black/20"
                >
                  {isAirline ? <><PlaneTakeoff className="w-4 h-4" /> Airline Registration</> : 'Complete Registration'}
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              ) : (
                <Link
                  to="/dashboard/subscription"
                  className="inline-flex items-center gap-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 px-4 py-2.5 text-xs font-bold text-white transition-all backdrop-blur-sm"
                >
                  <CreditCard className="w-4 h-4 text-slate-300" />
                  View Subscription
                  <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                </Link>
              )}
            </div>
          </div>
        </div>

        {/* ── Metric Stat Cards ── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard
            label="Subscription Status"
            value={subStatus.label}
            accent={subStatus.accent}
            sub={subStatus.sub}
            icon={<ShieldCheck className="w-5 h-5" />}
          />
          <StatCard
            label="Account Type"
            value={user?.role?.charAt(0).toUpperCase() + user?.role?.slice(1)}
            accent="slate"
            sub="Designated role"
            icon={<User className="w-5 h-5" />}
          />
          <StatCard
            label="Plan Details"
            value={sub
              ? sub.subscriptionPlan?.includes('Unlimited') ? 'Unlimited'
                : sub.subscriptionPlan?.includes('Multiple') ? `Multi-Year`
                : '1 Year'
              : 'None'}
            accent={sub ? 'emerald' : 'slate'}
            sub={sub ? `$${isAirline ? getAirlineTotal(sub).toFixed(2) : Number(sub.price ?? sub.totalAmount ?? 0).toFixed(2)} USD` : 'No active plan'}
            icon={<CreditCard className="w-5 h-5" />}
          />
        </div>

        {/* ── Main 2-Column Content ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Account Overview */}
          <div className="rounded-2xl border border-slate-200/90 bg-white shadow-[0_2px_12px_rgba(0,0,0,0.03)] overflow-hidden flex flex-col justify-between">
            <div>
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center text-slate-700">
                    <User className="w-4 h-4" />
                  </div>
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">Account Overview</h3>
                </div>
                <Link
                  to="/dashboard/profile"
                  className="text-xs font-bold text-slate-600 hover:text-black underline underline-offset-4 decoration-slate-300 hover:decoration-black transition-colors"
                >
                  Edit Profile
                </Link>
              </div>

              <div className="p-5 space-y-3">
                {[
                  { label: 'Full Name', value: fullName },
                  { label: 'Primary Email', value: user?.email },
                  { label: 'Account Role', value: user?.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : '—' },
                  ...(isAirline && user?.airlineName ? [{ label: 'Organization', value: user.airlineName }] : []),
                ].map(item => (
                  <div key={item.label} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0 text-sm">
                    <span className="text-xs font-semibold text-slate-400">{item.label}</span>
                    <span className="font-bold text-slate-800 truncate text-right max-w-[65%]">{item.value}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="px-5 py-3.5 bg-slate-50/80 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
              <span>Account ID: <code className="font-mono text-[11px] text-slate-700">{user?.id || '—'}</code></span>
              <Link
                to="/dashboard/settings"
                className="font-bold text-slate-700 hover:text-black underline underline-offset-4 decoration-slate-300 hover:decoration-black transition-colors"
              >
                Security Settings
              </Link>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="rounded-2xl border border-slate-200/90 bg-white shadow-[0_2px_12px_rgba(0,0,0,0.03)] overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center text-slate-700">
                <FileText className="w-4 h-4" />
              </div>
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">Quick Actions</h3>
            </div>

            <div className="p-4 space-y-2.5">
              <ActionTile
                to="/dashboard/profile"
                icon={<User className="w-4 h-4" />}
                title="Edit Profile"
                desc="Update your name, company info, and branding"
              />
              <ActionTile
                to="/dashboard/subscription"
                icon={<CreditCard className="w-4 h-4" />}
                title="View Subscription"
                desc="Access invoices, plans, and FAA certificate records"
              />
              <ActionTile
                href="mailto:agent@theifoa.com"
                icon={<AlertCircle className="w-4 h-4" />}
                title="Contact Support"
                desc="Direct line to the IFOA USA compliance team"
              />
            </div>
          </div>
        </div>

        {/* ── Subscription Status Banner ── */}
        {!subLoading && sub && (() => {
          const onHold = sub.status === 'Inactive'
          const isPaid = !onHold && (sub.isPaid === true || sub.paymentStatus === 'paid' || sub.status === 'Active')
          const isUnlimited = sub.subscriptionPlan === 'Unlimited Plan'
          const daysToExpiry = sub.expirationDate
            ? Math.ceil((new Date(sub.expirationDate) - new Date()) / (1000 * 60 * 60 * 24))
            : null
          const isExpired = isPaid && !isUnlimited && daysToExpiry !== null && daysToExpiry <= 0

          if (isExpired) {
            return (
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-start gap-3.5">
                  <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 border border-amber-100 flex items-center justify-center flex-shrink-0">
                    <AlertCircle className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-sm font-black text-slate-900">Subscription Expired</p>
                    <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                      Plan: <strong className="text-slate-800">{sub.subscriptionPlan}</strong>. Renew your coverage to restore FAA compliance status.
                    </p>
                  </div>
                </div>
                <Link
                  to="/dashboard/subscription"
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-slate-950 hover:bg-slate-800 transition-all shadow-sm flex-shrink-0"
                >
                  Renew Now <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            )
          }

          if (onHold) {
            return (
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm flex items-start gap-3.5">
                <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 border border-amber-100 flex items-center justify-center flex-shrink-0">
                  <Clock className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm font-black text-slate-900">Account Temporarily On Hold</p>
                  <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                    Plan: <strong className="text-slate-800">{sub.subscriptionPlan}</strong>. Your subscription is temporarily suspended. Please contact{' '}
                    <a href="mailto:agent@theifoa.com" className="font-bold text-slate-900 underline underline-offset-4 decoration-slate-300 hover:decoration-black">
                      agent@theifoa.com
                    </a>{' '}
                    to restore active status.
                  </p>
                </div>
              </div>
            )
          }

          return (
            <div className="rounded-2xl border border-emerald-200/80 bg-emerald-50/30 p-5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3.5">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                  isPaid ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'
                }`}>
                  {isPaid ? <CheckCircle2 className="w-5 h-5" /> : <Clock className="w-5 h-5" />}
                </div>
                <div>
                  <p className="text-sm font-black text-slate-900">
                    {isPaid ? 'Your subscription is active' : 'Payment pending confirmation'}
                  </p>
                  <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                    Plan: <strong className="text-slate-800">{sub.subscriptionPlan}</strong>.
                    {isPaid ? ' Your U.S. Agent for Service is active and ready.' : ' Complete payment to activate your compliance coverage.'}
                  </p>
                </div>
              </div>
              <Link
                to="/dashboard/subscription"
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold text-slate-800 hover:text-black border border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50 transition-all shadow-sm flex-shrink-0"
              >
                View Subscription <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
              </Link>
            </div>
          )
        })()}

      </div>
    </DashboardLayout>
  )
}
