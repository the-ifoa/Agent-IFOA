import { Link } from 'react-router-dom'
import { individualPrice } from '../services/pricing'

const usd = (n) => `$${Number(n).toFixed(2)}`
import { motion } from 'framer-motion'
import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import Navbar from '../components/Navbar'
import Footer from '../components/layout/footer'
import { PlaneTakeoff, Zap, Lock, Monitor, MapPin, User, Check, ArrowRight } from 'lucide-react'

// ── Theme Tokens ──────────────────────────────────────────────────────────────
const C = {
  // Brand & Accent Color: strictly rgb(52, 224, 110) / #34E06E
  accent:      '#34E06E',
  accentHover: '#34E06E',
  accentDark:  '#34E06E',
  glow:        'rgba(52, 224, 110, 0.40)',
  
  // Neutral & Surface Colors
  midnight:    '#020617', // Primary Deep Dark (Deep Aviation Midnight)
  midnightAlt: '#000021',
  white:       '#FFFFFF',
  offWhite:    '#F8F9FA', // Slate 50
  containerLow:'#F1F5F9', // Slate 100
  
  // Text Palette
  textMain:    '#020617',
  textMuted:   '#475569',
  textSub:     '#64748B',
  
  // Borders
  borderLight: 'rgba(2, 6, 23, 0.08)',
  borderSlate: '#E2E8F0',
  borderDark:  'rgba(255, 255, 255, 0.10)',
}

// Plan cards
const makePlans = () => [
  {
    name: 'Turboprop Plan',
    subtitle: '1 Year Subscription',
    price: usd(individualPrice('1 Year Subscription Plan')),
    features: ['Dedicated U.S. Mailing Address', 'FAA Compliance Guaranteed', 'Real-Time Notification', 'Document Scanning & Forwarding', 'Yearly Payment', 'Unlimited Certificates'],
    cta: 'Subscribe Now',
    to: '/register',
    img: 'https://theifoa.com/wp-content/uploads/2025/05/ATR-72-1.jpg',
  },
  {
    name: 'Jet Plan',
    subtitle: 'Up to 5 Years Subscription',
    price: usd(individualPrice('Multiple Years Subscription Plan', 2) / 2),
    features: ['20% Discount Yearly', 'Dedicated U.S. Mailing Address', 'FAA Compliance Guaranteed', 'Real-Time Notification', 'Document Scanning & Forwarding', 'One Payment for the Period', 'Unlimited Certificates'],
    cta: 'Subscribe Now',
    to: '/register',
    img: 'https://theifoa.com/wp-content/uploads/2025/05/Airbus-A321-Neo-e1746283955634.jpg',
    imgFallback: 'https://images.unsplash.com/photo-1464037866556-6812c9d1c72e?w=600&q=80&auto=format&fit=crop&crop=center',
  },
  {
    name: 'VIP Plan',
    subtitle: 'Unlimited Subscription',
    price: usd(individualPrice('Unlimited Plan')),
    bestValue: true,
    features: ['The Most Economic Flat Rate', 'Dedicated U.S. Mailing Address', 'FAA Compliance Guaranteed', 'Real-Time Notification', 'Document Scanning & Forwarding', 'One Time Lifetime Payment', 'Unlimited Certificates'],
    cta: 'Subscribe Now',
    to: '/register',
    img: 'https://theifoa.com/wp-content/uploads/2025/05/Global-8000-e1746283913613.jpg',
  },
  {
    name: 'Airlines Plan',
    subtitle: 'Choose Subscription Duration',
    price: 'Tailored Price',
    isAirlines: true,
    features: ['Volume Discount', 'Dedicated U.S. Mailing Address', 'FAA Compliance Guaranteed', 'Real-Time Notification', 'Document Scanning & Forwarding', 'Credit Card or Wire payment', 'Unlimited Certificates'],
    cta: 'Subscribe Now',
    to: '/register',
    img: 'https://theifoa.com/wp-content/uploads/2025/05/Airlines-1980x1050-1.jpg',
  },
]

const HOW_STEPS = [
  {
    num: 1,
    title: 'Create Your Account',
    desc: 'Create your account and get instant access to your secure dashboard, where you can track FAA correspondence with your dedicated U.S. address.',
  },
  {
    num: 2,
    title: 'Assign Your Agent',
    desc: 'Designate IFOA USA as your U.S. Registered Agent on the FAA website and use your dedicated U.S. address to keep records current.',
  },
  {
    num: 3,
    title: 'Receive & Manage Mail',
    desc: 'FAA correspondence sent to your assigned U.S. address is scanned and forwarded to your dashboard or email with real-time updates.',
  },
  {
    num: 4,
    title: 'Stay FAA Compliant',
    desc: 'Choose how your FAA mail is handled, including secure shredding or physical forwarding for critical documents such as certificates.',
  },
]

function PlanCard({ plan, index }) {
  const [imgLoaded, setImgLoaded] = useState(false)
  const handleImgError = (e) => {
    const el = e.target
    if (plan.imgFallback && el.src !== plan.imgFallback) {
      el.src = plan.imgFallback
    } else {
      el.style.display = 'none'
      setImgLoaded(true) // stop showing the skeleton — nothing left to load
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay: index * 0.08, duration: 0.5 }}
      className="relative flex flex-col rounded-3xl overflow-hidden hover:-translate-y-1.5 transition-all duration-300"
      style={{
        background: C.white,
        border: plan.bestValue ? `2px solid ${C.midnight}` : `1px solid ${C.borderLight}`,
        boxShadow: plan.bestValue ? '0 12px 36px rgba(2,6,23,0.12)' : '0 2px 12px rgba(2,6,23,0.04)',
      }}
    >
      {plan.bestValue && (
        <div className="absolute top-4 right-4 z-10 text-[#020617] text-[10px] font-mono font-bold uppercase tracking-widest px-3 py-1 rounded-full shadow-sm" style={{ background: C.accent }}>
          Best Value
        </div>
      )}
      <div className="relative h-52 overflow-hidden flex items-center justify-center" style={{ background: C.offWhite }}>
        <svg viewBox="0 0 200 120" className="absolute inset-0 w-full h-full opacity-20" xmlns="http://www.w3.org/2000/svg">
          <path d="M20 60 L100 20 L180 60 L140 60 L130 90 L100 80 L70 90 L60 60 Z" fill="#34E06E" />
          <path d="M100 20 L110 60 L90 60 Z" fill="#34E06E" />
          <circle cx="100" cy="60" r="6" fill="#34E06E" />
          <path d="M60 60 L20 70 L20 60 Z" fill="#34E06E" />
          <path d="M140 60 L180 70 L180 60 Z" fill="#34E06E" />
        </svg>
        <svg viewBox="0 0 240 140" className="absolute w-3/4 h-3/4 opacity-10" xmlns="http://www.w3.org/2000/svg">
          <text x="50%" y="55%" dominantBaseline="middle" textAnchor="middle" fontSize="80" fill="#34E06E">✈</text>
        </svg>
        <img
          src={plan.img}
          alt={plan.name}
          className={`absolute inset-0 w-full h-full object-contain p-3 transition-opacity duration-300 ${imgLoaded ? 'opacity-100' : 'opacity-0'}`}
          loading="lazy"
          decoding="async"
          onLoad={() => setImgLoaded(true)}
          onError={handleImgError}
        />
        {/* Skeleton sits above the decorative plane graphic so nothing bleeds
            through while the real photo loads, then fades out cleanly. */}
        <div
          className={`absolute inset-0 ifoa-skeleton transition-opacity duration-300 pointer-events-none ${imgLoaded ? 'opacity-0' : 'opacity-100'}`}
        />
      </div>

      <div className="flex flex-col flex-1 p-6 sm:p-7">
        <h3 className="font-heading text-lg sm:text-xl md:text-2xl leading-snug font-bold mb-1" style={{ color: C.textMain }}>
          {plan.name}
        </h3>
        <p className="font-heading text-2xl sm:text-3xl font-extrabold mb-1" style={{ color: C.textMain }}>
          {plan.price}
        </p>
        <p className="text-xs sm:text-sm font-medium mb-4" style={{ color: C.textMuted }}>
          {plan.subtitle}
        </p>

        {plan.bestValue && (
          <p className="text-xs rounded-xl px-3 py-2 mb-4 font-medium" style={{ color: C.textMain, background: C.containerLow, border: `1px solid ${C.borderLight}` }}>
            Pay once, covered for life, no renewals!
          </p>
        )}

        <ul className="space-y-2.5 mb-7 flex-1">
          {plan.features.map(f => (
            <li key={f} className="text-sm leading-relaxed flex items-start gap-2.5" style={{ color: C.textMuted }}>
              <span className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: '#e8fbf0' }}>
                <Check className="w-2.5 h-2.5 text-[#34E06E] stroke-[3]" />
              </span>
              <span>{f}</span>
            </li>
          ))}
        </ul>

        <Link
          to={plan.to}
          className="block text-center py-3.5 px-6 rounded-full text-xs sm:text-sm uppercase tracking-widest font-extrabold transition-all duration-200"
          style={{ background: C.midnight, color: C.white }}
          onMouseEnter={e => {
            e.currentTarget.style.background = '#0f172a'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = C.midnight
          }}
        >
          {plan.cta}
        </Link>
      </div>
    </motion.div>
  )
}

import { CosmicParallaxBg } from '../components/ui/parallax-cosmic-background'

/* ── Wave Animation Text Component (Matching TMS Hero) ── */
function WaveText({ text, className = '', colorClass = '', baseDelay = 0, letterStagger = 0.035 }) {
  const words = text.split(' ')
  return (
    <span className={`inline-flex flex-wrap justify-center ${className}`}>
      {words.map((word, wordIndex) => {
        const charOffset = words.slice(0, wordIndex).reduce((sum, w) => sum + w.length, 0)
        return (
          <span key={wordIndex} className="inline-flex overflow-hidden pt-1 pb-3 sm:pb-5 -mb-3 sm:-mb-5 mr-[0.22em] last:mr-0">
            {word.split('').map((char, charIndex) => {
              const overallIndex = charOffset + charIndex
              const delay = baseDelay + overallIndex * letterStagger
              return (
                <motion.span
                  key={charIndex}
                  initial={{ y: '110%', opacity: 0, scale: 0.85 }}
                  animate={{ y: '0%', opacity: 1, scale: 1 }}
                  transition={{
                    duration: 0.55,
                    delay: delay,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                  className={`inline-block origin-bottom ${colorClass}`}
                >
                  {char}
                </motion.span>
              )
            })}
          </span>
        )
      })}
    </span>
  )
}

export default function Home() {
  const { user } = useAuth()

  return (
    <div className="min-h-screen font-sans" style={{ background: C.white }}>
      <Navbar />

      {/* ── Hero (Matching TMS Hero Section) ── */}
      <section data-hero className="relative min-h-[calc(100vh-72px)] w-full flex flex-col items-center justify-center overflow-hidden">
        <CosmicParallaxBg className="min-h-[calc(100vh-72px)] w-full flex flex-col items-center justify-center py-20 px-4 sm:px-6">
          <div className="max-w-4xl mx-auto flex flex-col items-center justify-center text-center">

            {/* Heading, Letter-by-letter fluid wave animation */}
            <h1 className="text-4xl sm:text-6xl md:text-7xl lg:text-[5.25rem] font-black leading-[1.06] tracking-tight">
              <WaveText
                text="Your U.S. Agent"
                className="block"
                colorClass="text-white"
                baseDelay={0.08}
                letterStagger={0.035}
              />
              <WaveText
                text="for Service"
                className="flex flex-wrap justify-center gap-x-3 sm:gap-x-5 mt-1 sm:mt-2"
                colorClass="text-white"
                baseDelay={0.38}
                letterStagger={0.03}
              />
            </h1>

            {/* Sub-heading */}
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.65, delay: 0.72, ease: [0.215, 0.61, 0.355, 1] }}
              className="mt-6 text-base sm:text-lg md:text-xl text-white/90 font-medium max-w-2xl mx-auto leading-relaxed tracking-tight text-center"
            >
              <span className="block">FAA compliance for international aviators with a dedicated U.S. address, secure mail handling, and real-time updates.</span>
              <span className="block mt-1.5 text-white/70 font-normal">Simple, fast, and professional.</span>
            </motion.p>

            {/* CTA */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.65, delay: 0.9, ease: [0.215, 0.61, 0.355, 1] }}
              className="mt-9 flex items-center justify-center gap-4"
            >
              {user ? (
                <Link
                  to={user.role === 'admin' ? '/admin' : '/dashboard'}
                  className="liquid-btn group gap-2.5 rounded-2xl text-sm font-black shadow-xl cursor-pointer"
                >
                  <span>Open Dashboard</span>
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform flex-shrink-0" />
                </Link>
              ) : (
                <Link
                  to="/register"
                  className="liquid-btn group gap-2.5 rounded-2xl text-sm font-black shadow-xl cursor-pointer"
                >
                  <span>{`Get Started, ${usd(individualPrice('1 Year Subscription Plan'))}/yr`}</span>
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform flex-shrink-0" />
                </Link>
              )}
            </motion.div>
          </div>
        </CosmicParallaxBg>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section id="how-it-works" className="py-20 lg:py-24 px-4 sm:px-6 lg:px-8" style={{ background: C.offWhite, borderTop: `1px solid ${C.borderLight}` }}>
        <div className="max-w-7xl mx-auto">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5 }} className="mb-14 text-center">
            <p className="text-[10px] sm:text-xs uppercase tracking-widest font-mono font-bold mb-2" style={{ color: '#34E06E' }}>
              Step by Step Process
            </p>
            <h2 className="font-heading text-2xl sm:text-3xl md:text-4xl leading-tight font-bold mb-3" style={{ color: C.textMain }}>
              HOW TO APPOINT YOUR FAA AGENT FOR SERVICE
            </h2>
            <p className="text-sm sm:text-base leading-relaxed font-normal" style={{ color: C.textSub }}>
              Fast, digital, reliable &amp; safe
            </p>
          </motion.div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {HOW_STEPS.map((s, i) => (
              <motion.div
                key={s.num}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1, duration: 0.45 }}
                whileHover={{ y: -6 }}
                className="group relative rounded-3xl p-7 flex flex-col min-h-[310px]"
                style={{
                  background: C.white,
                  border: `1px solid ${C.borderLight}`,
                  boxShadow: '0 2px 14px rgba(2,6,23,0.03)',
                }}
              >
                <div
                  className="absolute top-0 left-0 right-0 h-[3px] rounded-t-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                  style={{ background: '#34E06E' }}
                />
                <p className="font-heading text-5xl font-black leading-none mb-5" style={{ color: '#34E06E' }}>
                  {String(s.num).padStart(2, '0')}
                </p>
                <h3 className="font-heading text-lg sm:text-xl md:text-2xl leading-snug font-bold mb-3" style={{ color: C.textMain }}>
                  {s.title}
                </h3>
                <p className="text-sm sm:text-base leading-relaxed font-normal" style={{ color: C.textMuted }}>
                  {s.desc}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SUBSCRIPTION PLANS ── */}
      <section id="pricing" className="py-20 lg:py-24 px-4 sm:px-6 lg:px-8" style={{ background: C.white, borderTop: `1px solid ${C.borderLight}` }}>
        <div className="max-w-7xl mx-auto">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5 }} className="mb-14 text-center">
            <p className="text-[10px] sm:text-xs uppercase tracking-widest font-mono font-bold mb-2" style={{ color: '#34E06E' }}>
              Transparent Pricing
            </p>
            <h2 className="font-heading text-2xl sm:text-3xl md:text-4xl leading-tight font-bold mb-3" style={{ color: C.textMain }}>
              Subscription Plans
            </h2>
            <p className="text-sm sm:text-base leading-relaxed font-normal" style={{ color: C.textSub }}>
              Simple, transparent pricing, no hidden fees
            </p>
          </motion.div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {makePlans().map((plan, i) => (
              <PlanCard key={plan.name} plan={plan} index={i} />
            ))}
          </div>
        </div>
      </section>

      <Footer />
    </div>
  )
}
