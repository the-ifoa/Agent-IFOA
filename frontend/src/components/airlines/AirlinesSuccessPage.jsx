import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import Footer from '../layout/footer'

const STEPS = [
  {
    title: 'Watch for the invoice',
    desc: 'A confirmation and invoice will be sent to the email address provided during registration.',
  },
  {
    title: 'Complete payment',
    desc: 'Once payment is received, the service team will proceed with activating your registration.',
  },
  {
    title: 'Receive confirmation',
    desc: 'A follow-up confirmation will be sent once your Airlines account is fully activated.',
  },
]

export default function AirlinesSuccessPage({ airlineName }) {
  useEffect(() => {
    // Clear any scroll-lock leaked by a payment/modal overlay so the full page
    // (including the action buttons below) is reachable.
    document.body.style.overflow = ''
    document.documentElement.style.overflow = ''
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [])

  return (
    <>
      <div className="min-h-screen bg-slate-50/70 px-4 py-12 sm:py-16">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
          className="mx-auto max-w-2xl"
        >
          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
            {/* Header */}
            <div className="border-b border-slate-100 bg-white px-6 py-8 sm:px-8 sm:py-10 text-center">
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.1, type: 'spring', stiffness: 260, damping: 20 }}
                className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#34E06E] text-slate-950"
              >
                <svg className="h-7 w-7 text-slate-950" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </motion.div>

              <p className="mt-4 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Registration Submitted</p>
              <h1 className="mt-2 text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
                Thank you{airlineName ? `, ${airlineName}` : ''}.
              </h1>
              <p className="mx-auto mt-2 max-w-md text-xs sm:text-sm leading-relaxed text-slate-500">
                Your Airlines Agent for Service application has been received and is being processed.
              </p>
            </div>

            {/* Body */}
            <div className="p-6 sm:p-8 space-y-6">
              {/* Steps list */}
              <div className="space-y-3">
                {STEPS.map((step, index) => (
                  <motion.div
                    key={step.title}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.12 + index * 0.08 }}
                    className="flex items-start gap-4 rounded-2xl border border-slate-200/80 bg-slate-50/50 p-4 sm:p-4.5 transition-colors hover:bg-slate-50 hover:border-slate-300"
                  >
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-900 text-[11px] font-bold text-white flex-shrink-0 mt-0.5">
                      0{index + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-bold text-slate-900">{step.title}</h3>
                      <p className="mt-0.5 text-xs sm:text-sm leading-relaxed text-slate-500">{step.desc}</p>
                    </div>
                  </motion.div>
                ))}
              </div>

              {/* Questions bar */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-xs text-slate-500 text-center">
                Questions? Send an email to{' '}
                <a href="mailto:agent@theifoa.com" className="font-semibold text-slate-900 underline underline-offset-2 hover:text-slate-700">
                  agent@theifoa.com
                </a>
              </div>

              {/* Action Buttons */}
              <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                <Link
                  to="/dashboard/subscription"
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-xs font-bold uppercase tracking-wider text-white bg-slate-900 transition-colors hover:bg-slate-800 shadow-sm"
                >
                  <svg className="h-4 w-4 text-[#34E06E]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                    <rect x="2" y="5" width="20" height="14" rx="2" /><path strokeLinecap="round" strokeLinejoin="round" d="M2 10h20" />
                  </svg>
                  View Subscription
                </Link>
                <Link
                  to="/dashboard"
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-3 text-xs font-bold uppercase tracking-wider text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-900"
                >
                  <svg className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                  </svg>
                  Dashboard
                </Link>
                <Link
                  to="/"
                  className="inline-flex items-center justify-center rounded-xl px-4 py-3 text-xs font-semibold text-slate-400 transition-colors hover:text-slate-700"
                >
                  Home
                </Link>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
      <Footer />
    </>
  )
}
