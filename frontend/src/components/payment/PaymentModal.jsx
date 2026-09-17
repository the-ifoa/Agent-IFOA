import { useState, useEffect } from 'react'
import { effectiveMultiYears } from '../../services/pricing'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { loadStripe } from '@stripe/stripe-js'
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js'
import InvoiceModal from './InvoiceModal'

const BACKDROP = { hidden: { opacity: 0 }, visible: { opacity: 1 }, exit: { opacity: 0 } }
const PANEL = {
  hidden: { opacity: 0, y: 16, scale: 0.97 },
  visible: { opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 340, damping: 28 } },
  exit: { opacity: 0, y: 10, scale: 0.98, transition: { duration: 0.16, ease: 'easeIn' } },
}

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY)

const ELEMENTS_APPEARANCE = {
  theme: 'stripe',
  variables: {
    colorPrimary: '#0f172a',
    colorBackground: '#ffffff',
    colorText: '#0f172a',
    colorDanger: '#dc2626',
    fontFamily: 'system-ui, sans-serif',
    spacingUnit: '4px',
    borderRadius: '10px',
  },
  rules: {
    '.Input': { border: '1px solid #e2e8f0', boxShadow: 'none', padding: '10px 14px', background: '#f8fafc', color: '#0f172a' },
    '.Input:focus': { border: '1px solid #0f172a', boxShadow: '0 0 0 2px rgba(15,23,42,0.08)', background: '#ffffff' },
    '.Label': { fontWeight: '700', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#94a3b8' },
    '.Tab': { border: '1px solid #e2e8f0', boxShadow: 'none', borderRadius: '10px', color: '#64748b' },
    '.Tab:hover': { border: '1px solid #cbd5e1', color: '#0f172a', background: '#f8fafc' },
    '.Tab--selected': { border: '2px solid #0f172a', boxShadow: 'none', color: '#0f172a', background: '#ffffff', fontWeight: '700' },
    '.Tab--selected:focus': { boxShadow: '0 0 0 2px rgba(15,23,42,0.12)' },
    '.TabIcon--selected': { fill: '#0f172a' },
    '.TabLabel--selected': { color: '#0f172a', fontWeight: '700' },
    '.PickerItem--selected': { border: '2px solid #0f172a', boxShadow: 'none' },
    '.PickerItem:hover': { border: '1px solid #cbd5e1' },
  },
}

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api'

// ── Payment Success Screen ────────────────────────────────────────────────────
function PaymentSuccessScreen({ amount, invoice, onViewInvoice, onClose }) {
  const [show, setShow] = useState(false)
  useEffect(() => { const t = setTimeout(() => setShow(true), 60); return () => clearTimeout(t) }, [])

  const fmtDate = (d) => d
    ? new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : null
  const fmtAmt = (v) => typeof v === 'number'
    ? `$${v.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
    : null

  const planName = invoice?.subscriptionPlan || null
  const paidAt = fmtDate(invoice?.paidAt || new Date())
  const expiresAt = fmtDate(invoice?.expirationDate)
  const invNum = invoice?.invoiceNumber || null
  const txId = invoice?.paymentId || null
  const displayAmt = invoice?.amount != null
    ? fmtAmt(invoice.amount)
    : amount ? `$${(amount / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : null
  const recipientName = invoice?.isAirline
    ? (invoice?.airlineName || invoice?.name)
    : invoice?.name
  const recipientEmail = invoice?.email

  const rows = [
    invNum && { label: 'Invoice', value: invNum },
    planName && { label: 'Plan', value: planName.replace(' Subscription Plan', '').replace(' Plan', '') },
    paidAt && { label: 'Paid On', value: paidAt },
    expiresAt && { label: 'Expires', value: expiresAt },
    !expiresAt && { label: 'Expires', value: 'Never (Unlimited)' },
    recipientEmail && { label: 'Email', value: recipientEmail },
    txId && { label: 'Transaction', value: txId, mono: true },
  ].filter(Boolean)

  return (
    <div className={`transition-all duration-500 space-y-5 ${show ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'}`}>
      {/* Top success badge and amount */}
      <div className="pt-3 pb-1 text-center">
        <div className="relative inline-flex mb-3.5">
          <div
            className="w-14 h-14 rounded-2xl border-2 flex items-center justify-center shadow-xs"
            style={{
              backgroundColor: '#e8fbf0',
              borderColor: '#34E06E',
              animation: show ? 'pmPopIn 0.4s cubic-bezier(0.34,1.56,0.64,1)' : 'none'
            }}
          >
            <svg
              className="w-7 h-7 text-slate-900"
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
          </div>
        </div>

        <div>
          <div
            className="inline-flex items-center px-3.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider text-slate-900 border mb-2"
            style={{
              backgroundColor: '#e8fbf0',
              borderColor: '#34E06E',
            }}
          >
            Payment Confirmed
          </div>
        </div>

        {displayAmt && (
          <div>
            <div className="inline-block">
              <h3 className="text-3xl sm:text-4xl font-black text-slate-900 tracking-tight tabular-nums">{displayAmt}</h3>
              <div className="w-full h-0.5 rounded-full mt-1.5 mb-1.5" style={{ backgroundColor: '#34E06E' }} />
            </div>
          </div>
        )}

        {recipientName && (
          <p className="text-sm font-bold text-slate-800 mt-1">{recipientName}</p>
        )}
        <p className="text-xs text-slate-500 mt-0.5">A receipt and confirmation invoice have been issued.</p>
      </div>

      {/* Detail rows */}
      {rows.length > 0 && (
        <div className="rounded-2xl border border-slate-200/80 bg-slate-50/60 p-4 divide-y divide-slate-200/60 shadow-2xs">
          {rows.map(({ label, value, mono }) => (
            <div key={label} className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0 gap-3">
              <span className="text-xs font-semibold text-slate-500">{label}</span>
              <span className={`text-right font-bold text-slate-900 ${mono ? 'font-mono text-xs text-slate-600 bg-white border border-slate-200/80 px-2 py-0.5 rounded-md break-all' : 'text-xs truncate max-w-[280px]'}`}>
                {value}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="pt-2 flex flex-col gap-2.5 pb-2">
        <button
          type="button"
          onClick={onViewInvoice}
          className="w-full inline-flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 text-white font-bold px-5 py-3 rounded-xl text-sm transition-all shadow-sm active:scale-[0.99]"
        >
          <svg className="w-4 h-4 text-[#34E06E]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          View &amp; Download Invoice
        </button>
        <button
          type="button"
          onClick={onClose}
          className="w-full inline-flex items-center justify-center gap-2 bg-white hover:bg-slate-50 text-slate-700 font-bold px-5 py-3 rounded-xl text-sm transition-all border border-slate-200 shadow-2xs"
        >
          Close
        </button>
      </div>
      <style>{`
        @keyframes pmPopIn  { 0%{transform:scale(0.5);opacity:0} 100%{transform:scale(1);opacity:1} }
      `}</style>
    </div>
  )
}

// ── Inner checkout form ───────────────────────────────────────────────────────
function CheckoutForm({ registrationId, registrationModel, amount, subscriptionData, purpose, onSuccess, onCancel }) {
  const stripe = useStripe()
  const elements = useElements()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [elementsReady, setElementsReady] = useState(false)
  // phase: 'form' | 'success' | 'invoice'
  const [phase, setPhase] = useState('form')
  const [invoice, setInvoice] = useState(null)

  // Rename Stripe's "US bank account" tab label to "Bank" via DOM patch.
  // Stripe renders tab buttons in the host page DOM (not in an iframe),
  // so we can find and rewrite the text node after the element mounts.
  useEffect(() => {
    if (!elementsReady) return
    const patch = () => {
      document.querySelectorAll('[class*="TabLabel"],[class*="tab-label"],[role="tab"]').forEach(el => {
        el.childNodes.forEach(node => {
          if (node.nodeType === Node.TEXT_NODE && node.textContent.trim() === 'US bank account') {
            node.textContent = 'Bank'
          }
        })
        if (el.textContent.trim() === 'US bank account') el.textContent = 'Bank'
      })
    }
    patch()
    const obs = new MutationObserver(patch)
    obs.observe(document.body, { subtree: true, childList: true, characterData: true })
    return () => obs.disconnect()
  }, [elementsReady])

  const fetchCanonicalInvoice = async (token) => {
    try {
      const res = await fetch(`${BASE_URL}/invoices/by-registration/${registrationId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) return null
      const json = await res.json()
      const docs = Array.isArray(json?.data) ? json.data : []
      return docs.length ? docs[0] : null
    } catch {
      return null
    }
  }

  const invoiceDocToInvoice = (invDoc, fallbackPaymentId) => {
    if (!invDoc) return null
    const lineItem = Array.isArray(invDoc.lineItems) ? invDoc.lineItems[0] : null
    return {
      invoiceNumber: invDoc.invoiceNumber || '—',
      paidAt: invDoc.paidAt || invDoc.issueDate,
      subscriptionPlan: invDoc.subscriptionPlan || '—',
      expirationDate: invDoc.expirationDate || null,
      amount: invDoc.totalAmount ?? invDoc.subtotal ?? 0,
      currency: invDoc.currency || 'USD',
      paymentId: invDoc.stripePaymentIntentId || fallbackPaymentId || '—',
      name: invDoc.recipientName || invDoc.recipientCompany || '',
      email: invDoc.recipientEmail || '',
      phone: invDoc.recipientPhone || '',
      address: [invDoc.recipientAddress1, invDoc.recipientAddress2, invDoc.recipientCountry].filter(Boolean).join(', '),
      isAirline: invDoc.isAirline || registrationModel !== 'Individual',
      airlineName: invDoc.recipientCompany || '',
      pricePerCert: lineItem?.unitPrice ?? null,
      holderCount: lineItem?.quantity ?? null,
      invoiceDraft: invDoc.draft || null,
      _invoiceDocId: invDoc._id,
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!stripe || !elements) return
    setLoading(true)
    setError(null)

    try {
      // confirmPayment handles card, Link, and any other enabled payment method
      const { error: stripeErr, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/dashboard/subscription`,
        },
        redirect: 'if_required',
      })

      if (stripeErr) throw new Error(stripeErr.message)

      if (paymentIntent?.status === 'succeeded') {
        const token = localStorage.getItem('ifoa_token') || ''

        // Notify our backend, creates Payment record + marks subscription Active
        let confirmJson = { success: false }
        try {
          const confirmRes = await fetch(`${BASE_URL}/payments/confirm`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              paymentIntentId: paymentIntent.id,
              registrationId,
              registrationModel,
              purpose: purpose || 'payment',
              userAgent: navigator.userAgent,
            }),
          })
          confirmJson = await confirmRes.json()
        } catch (networkErr) {
          console.warn('[PaymentModal] /payments/confirm network error:', networkErr.message)
        }

        // No client-side fallback when confirm fails: the mark-paid endpoints are
        // admin-only (a customer call always 403s), and the Stripe webhook is the
        // authoritative backup, it records the payment and activates the
        // subscription server-side even if this confirm call never lands.
        if (!confirmJson.success) {
          console.warn('[PaymentModal] /payments/confirm failed, webhook will reconcile:', confirmJson.message)
        }

        // Prefer canonical Invoice doc for accurate holder count / totals
        const canonicalInvoice = await fetchCanonicalInvoice(token)
        const inv = canonicalInvoice
          ? invoiceDocToInvoice(canonicalInvoice, confirmJson.payment?.stripePaymentIntentId || paymentIntent.id)
          : (confirmJson.payment
            ? serverPaymentToInvoice(confirmJson.payment)
            : buildInvoice(subscriptionData, registrationModel, amount, paymentIntent, new Date()))

        setInvoice(inv)
        setPhase('success')
        onSuccess?.(inv, confirmJson.registration)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (phase === 'success') {
    return (
      <PaymentSuccessScreen
        amount={amount}
        invoice={invoice}
        onViewInvoice={() => setPhase('invoice')}
        onClose={onCancel}
      />
    )
  }

  if (phase === 'invoice' && invoice) {
    return (
      <InvoiceModal
        invoice={invoice}
        onClose={() => { setPhase('success'); onCancel?.() }}
      />
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {/* Amount strip */}
      <div className="rounded-2xl px-4 py-3.5 relative overflow-hidden flex items-center justify-between"
        style={{ background: 'linear-gradient(135deg, #020617 0%, #0f172a 60%, #1e293b 100%)' }}>
        <div className="absolute -right-6 -top-6 w-24 h-24 rounded-full bg-white/5 pointer-events-none" />
        <div>
          <p className="text-[9px] font-black uppercase tracking-widest text-[#34E06E] mb-0.5">Amount to Pay</p>
          <p className="text-white font-black text-2xl tracking-tight leading-none">
            ${(amount / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </p>
          {subscriptionData?.subscriptionPlan && (
            <p className="text-white/40 text-[10px] mt-1 font-medium">
              {subscriptionData.subscriptionPlan.replace(' Subscription Plan', '').replace(' Plan', '')}
            </p>
          )}
        </div>
        <div className="flex items-center opacity-50 flex-shrink-0">
          <div className="w-8 h-8 rounded-full bg-[#34E06E]/50" />
          <div className="w-8 h-8 rounded-full bg-emerald-300/30 -ml-4" />
        </div>
      </div>

      {/* Stripe PaymentElement, shows all methods enabled in Stripe Dashboard (card, bank, Link …) */}
      <div className="min-h-[140px]">
        <PaymentElement
          onReady={() => setElementsReady(true)}
          options={{
            layout: { type: 'tabs', defaultCollapsed: false },
            fields: { billingDetails: { name: 'auto', email: 'auto' } },
            terms: { card: 'never', usBankAccount: 'always' },
          }}
        />
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-start gap-2.5">
          <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="9" /><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01" />
          </svg>
          {error}
        </div>
      )}

      <div className="border-t border-slate-100 pt-3 flex gap-3">
        <button type="button" onClick={onCancel} disabled={loading}
          className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-50">
          Cancel
        </button>
        <button type="submit" disabled={loading || !stripe || !elementsReady}
          className="flex-[2] rounded-xl text-white font-extrabold px-4 py-2.5 text-xs uppercase tracking-wider transition-all disabled:opacity-60 flex items-center justify-center gap-2 shadow-sm hover:bg-slate-800"
          style={{ background: '#020617' }}>
          {loading ? (
            <>
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-20" />
                <path fill="currentColor" d="M12 2a10 10 0 0 1 10 10h-4a6 6 0 0 0-6-6V2Z" />
              </svg>
              Processing…
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              Pay ${(amount / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </>
          )}
        </button>
      </div>

      <p className="text-center text-[10px] text-slate-400 font-medium flex items-center justify-center gap-1.5 pb-2">
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
        Secured by Stripe · 256-bit SSL encryption
      </p>
    </form>
  )
}

// ── Utility: build local invoice from subscription + paymentIntent ─────────────
export function buildInvoice(sub, registrationModel, amountCents, paymentIntent, now) {
  const isAirline = registrationModel !== 'Individual'
  const expirationDate = (() => {
    if (!sub?.subscriptionPlan) return null
    const d = new Date(now)
    if (sub.subscriptionPlan === '1 Year Subscription Plan') {
      d.setFullYear(d.getFullYear() + 1)
      return d.toISOString()
    }
    if (sub.subscriptionPlan === 'Multiple Years Subscription Plan') {
      // Recover the term from the amount charged, using the server's per-year
      // rate rather than a copy of it.
      const fromAmount = registrationModel !== 'Individual'
        ? null
        : effectiveMultiYears(sub.subscriptionPlan, amountCents / 100)
      const years = fromAmount || sub.multiYearCount || 3
      d.setFullYear(d.getFullYear() + years)
      return d.toISOString()
    }
    return null
  })()

  return {
    invoiceNumber: sub?.invoiceNumber || paymentIntent?.id?.slice(-8).toUpperCase() || '—',
    paidAt: now instanceof Date ? now.toISOString() : new Date(now).toISOString(),
    subscriptionPlan: sub?.subscriptionPlan || '—',
    expirationDate: expirationDate ? new Date(expirationDate).toISOString() : null,
    amount: amountCents / 100,
    currency: 'USD',
    paymentId: paymentIntent?.id || '—',
    name: isAirline
      ? sub?.airlineName || [sub?.firstName, sub?.lastName].filter(Boolean).join(' ')
      : [sub?.firstName, sub?.lastName].filter(Boolean).join(' '),
    email: sub?.email || sub?.contactEmail || sub?.paymentEmail || '—',
    phone: sub?.phone || sub?.contactPhone || '—',
    address: [sub?.addressLine1, sub?.city, sub?.state, sub?.postalCode, sub?.country].filter(Boolean).join(', '),
    isAirline,
    pricePerCert: sub?.pricePerCertificate || sub?.pricePerCert || null,
    holderCount: sub?.committedCount || sub?.holderCountValue || sub?.certificateHolders?.length || null,
    primaryCertificate: sub?.primaryCertificate || null,
    faaCertificateNumber: sub?.faaCertificateNumber || null,
    iacraTrackingNumber: sub?.iacraTrackingNumber || null,
  }
}

// ── Utility: convert server Payment doc to invoice shape ──────────────────────
export function serverPaymentToInvoice(paymentDoc) {
  if (!paymentDoc) return null
  const snap = paymentDoc.invoiceSnapshot || {}
  const draft = paymentDoc.invoiceDraft || null
  return {
    invoiceNumber: paymentDoc.invoiceNumber || snap.invoiceNumber || '—',
    paidAt: paymentDoc.paidAt || snap.subscriptionDate,
    subscriptionPlan: snap.subscriptionPlan || '—',
    multiYearCount: snap.multiYearCount || null,
    expirationDate: snap.expirationDate || null,
    amount: paymentDoc.amountDollars ?? snap.totalPaid ?? 0,
    currency: paymentDoc.currency || 'USD',
    paymentId: paymentDoc.stripePaymentIntentId || null,
    name: snap.name || '—',
    email: snap.email || '—',
    phone: snap.phone || '',
    address: snap.address || '',
    isAirline: snap.isAirline || false,
    airlineName: snap.airlineName || '',
    pricePerCert: snap.pricePerCert || null,
    holderCount: snap.holderCount || null,
    primaryCertificate: snap.primaryCertificate || null,
    faaCertificateNumber: snap.faaCertificateNumber || null,
    iacraTrackingNumber: snap.iacraTrackingNumber || null,
    invoiceDraft: draft,
    _paymentDocId: paymentDoc._id,
  }
}

// ── Wrapper: fetches clientSecret then mounts Elements ────────────────────────
export default function PaymentModal({
  registrationId, registrationModel, amount, subscriptionData, purpose,
  onClose, onSuccess, newSubscriptionPlan, renewalMultiYearCount,
  renewalExactCount, additionalHolderCount, renewalHoldersToRemove, holderGroupId,
  mergeTarget,
}) {
  const [clientSecret, setClientSecret] = useState(null)
  const [fetchError, setFetchError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [backendAmount, setBackendAmount] = useState(null)
  const [visible, setVisible] = useState(true)
  const handleClose = () => setVisible(false)

  useEffect(() => {
    const prevBodyOverflow = document.body.style.overflow
    const prevHtmlOverflow = document.documentElement.style.overflow
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevBodyOverflow
      document.documentElement.style.overflow = prevHtmlOverflow
    }
  }, [])

  useEffect(() => {
    if (!registrationId || !registrationModel) return
    const create = async () => {
      try {
        const body = {
          registrationId,
          registrationModel,
          purpose: purpose || 'payment',
        }
        if (newSubscriptionPlan) body.newSubscriptionPlan = newSubscriptionPlan
        if (renewalMultiYearCount) body.renewalMultiYearCount = renewalMultiYearCount
        if (renewalExactCount) body.renewalExactCount = renewalExactCount
        if (renewalHoldersToRemove && renewalHoldersToRemove.length)
          body.renewalHoldersToRemove = renewalHoldersToRemove
        if (additionalHolderCount) body.additionalHolderCount = additionalHolderCount
        if (holderGroupId) body.holderGroupId = holderGroupId
        // 'base' | '<groupId>', merge added holders into an existing plan instead of a new group
        if (mergeTarget) body.mergeTarget = mergeTarget

        const res = await fetch(`${BASE_URL}/payments/create-intent`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('ifoa_token') || ''}`,
          },
          body: JSON.stringify(body),
        })
        const json = await res.json()
        if (res.status === 403 && json?.mustChangePassword) {
          window.location.replace('/login')
          return
        }
        if (!res.ok || !json.success) throw new Error(json.message || 'Could not create payment intent')
        setClientSecret(json.clientSecret)
        if (json.amount) setBackendAmount(json.amount)
      } catch (err) {
        setFetchError(err.message)
      } finally {
        setLoading(false)
      }
    }
    create()
  }, [registrationId, registrationModel, newSubscriptionPlan, renewalMultiYearCount, renewalExactCount, additionalHolderCount, mergeTarget])

  return createPortal(
    <AnimatePresence onExitComplete={onClose}>
      {visible && (
        <motion.div
          variants={BACKDROP} initial="hidden" animate="visible" exit="exit"
          className="fixed inset-0 bg-slate-950/75 backdrop-blur-md flex items-center justify-center p-4 sm:p-6" style={{ zIndex: 9999 }}>
          <motion.div
            variants={PANEL} initial="hidden" animate="visible" exit="exit"
            className="w-full max-w-lg sm:max-w-xl rounded-3xl bg-white border border-slate-200/80 flex flex-col overflow-hidden shadow-2xl shadow-slate-950/40"
            style={{ maxHeight: 'min(90vh, 820px)' }}>

            {/* Header */}
            <div className="flex-shrink-0 px-6 py-4 flex items-center justify-between bg-white border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-slate-900 shadow-2xs">
                  <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Secure Checkout</p>
                  <p className="text-slate-900 font-extrabold text-sm leading-tight">Complete Your Subscription</p>
                </div>
              </div>
              <button
                onClick={handleClose}
                aria-label="Close modal"
                className="w-8 h-8 flex items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all shadow-2xs"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              {loading && (
                <div className="flex items-center justify-center py-12 gap-3 text-slate-400">
                  <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-20" />
                    <path fill="currentColor" d="M12 2a10 10 0 0 1 10 10h-4a6 6 0 0 0-6-6V2Z" />
                  </svg>
                  <span className="text-sm">Preparing secure checkout…</span>
                </div>
              )}

              {fetchError && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">
                  <p className="font-bold mb-1">Failed to initialize payment</p>
                  <p>{fetchError}</p>
                  <button onClick={handleClose} className="mt-3 text-xs font-semibold underline">Close</button>
                </div>
              )}

              {clientSecret && (
                <Elements
                  stripe={stripePromise}
                  options={{ clientSecret, appearance: ELEMENTS_APPEARANCE }}
                >
                  <CheckoutForm
                    registrationId={registrationId}
                    registrationModel={registrationModel}
                    amount={backendAmount ?? amount}
                    subscriptionData={subscriptionData}
                    purpose={purpose || 'payment'}
                    onSuccess={onSuccess}
                    onCancel={handleClose}
                  />
                </Elements>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}
