import { useState, useEffect } from 'react'
import { airlinePricePerCertByRange } from '../../services/pricing'
import LegalCheckboxes from '../legal/LegalModal'
import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import CustomSelect from '../ui/CustomSelect'
import CountrySelect, { COUNTRY_TO_ISO2 } from '../ui/CountrySelect'

import PhoneInputLib from 'react-phone-input-2'
import 'react-phone-input-2/lib/style.css'
const PhoneInput = PhoneInputLib.default || PhoneInputLib

// Prices come from the server (services/pricing.js → GET /api/pricing/config).
// Never reintroduce a local table here: the customer must be shown the same
// per-certificate rate the backend uses to build the PaymentIntent.
const ppcFor = (plan, rangeKey) => airlinePricePerCertByRange(plan, rangeKey)
const priceLabel = (plan, rangeKey) => `$${ppcFor(plan, rangeKey).toFixed(2)}`

const COUNT_OPTIONS = {
  '3 to 5':       [3, 4, 5],
  '5 to 10':      [5, 6, 7, 8, 9, 10],
  'More than 10': Array.from({ length: 90 }, (_, i) => i + 11),
}

const HOLDER_COUNTS = ['3 to 5', '5 to 10', 'More than 10']
const SUBSCRIPTION_PLANS = ['1 Year Subscription Plan', 'Unlimited Plan']

function Field({ label, required, error, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-bold text-gray-600 uppercase tracking-wide">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      {children}
      {error && (
        <span className="flex items-center gap-1 text-red-500 text-xs font-medium">
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          {error}
        </span>
      )}
    </div>
  )
}

// Scroll to the first element with a given id, with a small offset for the sticky header
function scrollToField(id) {
  setTimeout(() => {
    const el = document.getElementById(id)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      // Also try to focus if it's an input/select
      const input = el.querySelector('input,select,button') || el
      if (typeof input.focus === 'function') {
        setTimeout(() => input.focus({ preventScroll: true }), 350)
      }
    }
  }, 50)
}

export default function AirlinesStep1PlanAndDetails({ data, update, onNext }) {
  const { user, token } = useAuth()
  const [errors, setErrors] = useState({})
  const [agreedTerms,   setAgreedTerms]   = useState(false)
  const [agreedPrivacy, setAgreedPrivacy] = useState(false)
  const [termsError,    setTermsError]    = useState(false)
  const [privacyError,  setPrivacyError]  = useState(false)
  const [phoneCountry, setPhoneCountry] = useState(
    (data.country && COUNTRY_TO_ISO2[data.country]) || 'us'
  )

  useEffect(() => {
    if (user?.airlineName && !data.airlineName) {
      update({ airlineName: user.airlineName })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.airlineName])

  useEffect(() => {
    if (data.country) {
      const iso2 = COUNTRY_TO_ISO2[data.country]
      if (iso2) setPhoneCountry(iso2)
    }
  }, [data.country])

  const inputCls = (field) =>
    `w-full px-3.5 py-2.5 border rounded-xl text-sm text-gray-900 bg-white outline-none transition-all duration-150 focus:ring-2 focus:ring-slate-100 placeholder:text-gray-400 ${
      errors[field]
        ? 'border-red-300 focus:border-red-400 bg-red-50/30'
        : 'border-gray-200 focus:border-slate-800 hover:border-gray-300'
    }`

  const holderLabel = data.holderCount
    ? `Agent for Service, ${data.holderCount === '3 to 5' ? 'Up to 5' : data.holderCount === '5 to 10' ? 'Up to 10' : 'More than 10'}`
    : null
  const planLabel = data.subscriptionPlan === '1 Year Subscription Plan'
    ? '1 Year Subscription'
    : data.subscriptionPlan === 'Unlimited Plan'
    ? 'Unlimited Plan'
    : null
  const serviceLabel = data.holderCount && data.subscriptionPlan ? { left: holderLabel, right: planLabel } : null

  const selectedCount = Number(data.holderCountValue || 0)
  const pricePerCertificate = Number(data.pricePerCertificate || 0)
  // For both plans: $price × exact count selected
  const payableTotal = selectedCount > 0 ? (pricePerCertificate * selectedCount) : 0

  const validate = () => {
    const e = {}
    if (!data.holderCount)             e.holderCount      = 'Please select the number of holders'
    if (!data.holderCountValue)        e.holderCountValue  = 'Please select exact count'
    if (!data.subscriptionPlan)        e.subscriptionPlan  = 'Please select a plan'
    if (!data.airlineName?.trim())     e.airlineName       = 'Company name is required'
    if (!data.addressLine1?.trim())    e.addressLine1      = 'Address is required'
    if (!data.country)                 e.country           = 'Country is required'
    if (!data.firstName?.trim())       e.firstName         = 'First name is required'
    if (!data.lastName?.trim())        e.lastName          = 'Last name is required'
    if (!data.email?.trim())           e.email             = 'Email is required'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) e.email = 'Invalid email'
    if (!data.phone || data.phone.length < 7) e.phone = 'Valid phone is required'
    setErrors(e)

    // Scroll to the topmost invalid field
    const fieldOrder = ['holderCount', 'holderCountValue', 'subscriptionPlan', 'airlineName', 'addressLine1', 'country', 'firstName', 'lastName', 'email', 'phone']
    const firstError = fieldOrder.find(k => e[k])
    if (firstError) scrollToField(`al1-field-${firstError}`)

    return Object.keys(e).length === 0
  }

  return (
    <div className="space-y-8">

      {/* ── 1. Number of FAA Certificate Holders ── */}
      <div id="al1-field-holderCount">
        <h3 className="text-sm font-black text-gray-500 uppercase tracking-widest mb-1">
          Number of FAA Certificate Holders to Register
        </h3>
        {errors.holderCount && <p className="text-red-500 text-xs mb-2">{errors.holderCount}</p>}
        <div className="flex flex-wrap gap-3 mt-3">
          {HOLDER_COUNTS.map(count => {
            const active = data.holderCount === count
            return (
              <label key={count}
                className={`flex items-center gap-2 cursor-pointer px-4 py-2.5 rounded-xl border-2 text-sm font-semibold transition-all duration-150 ${active ? 'border-slate-900 bg-slate-50 text-slate-900' : 'border-gray-200 hover:border-slate-400 text-gray-600 bg-white'}`}>
                <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${active ? 'border-slate-900 bg-slate-900' : 'border-gray-300'}`}>
                  {active && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                </span>
                <input type="radio" name="holderCount" value={count} checked={active}
                  onChange={() => {
                    const plan = data.subscriptionPlan || '1 Year Subscription Plan'
                    update({ holderCount: count, holderCountValue: '', pricePerCertificate: ppcFor(plan, count) })
                  }}
                  className="hidden" />
                {count}
              </label>
            )
          })}
        </div>

        {data.holderCount && (
          <div className="mt-3" id="al1-field-holderCountValue">
            <label className="text-xs font-bold text-gray-600 uppercase tracking-wide block mb-1.5">
              Exact Number <span className="text-red-400">*</span>
            </label>
            <div className="w-44">
              <CustomSelect
                value={data.holderCountValue || ''}
                onChange={val => update({ holderCountValue: val })}
                placeholder="— Select —"
                error={!!errors.holderCountValue}
                options={[
                  { value: '', label: '— Select —' },
                  ...(COUNT_OPTIONS[data.holderCount] || []).map(n => ({ value: String(n), label: String(n) }))
                ]}
              />
            </div>
            {errors.holderCountValue && <p className="text-red-500 text-xs mt-1">{errors.holderCountValue}</p>}
          </div>
        )}
      </div>

      {/* ── 2. Subscription Plan ── */}
      <div id="al1-field-subscriptionPlan">
        <h3 className="text-sm font-black text-gray-500 uppercase tracking-widest mb-1">
          Subscription Plan <span className="text-red-400">*</span>
        </h3>
        {errors.subscriptionPlan && <p className="text-red-500 text-xs mb-2">{errors.subscriptionPlan}</p>}
        <div className="mt-3">
          <CustomSelect
            value={data.subscriptionPlan || ''}
            onChange={plan => {
              const price = data.holderCount ? ppcFor(plan, data.holderCount) : null
              update({ subscriptionPlan: plan, pricePerCertificate: price || 0 })
            }}
            placeholder="— Select a plan —"
            error={!!errors.subscriptionPlan}
            options={[
              { value: '', label: '— Select a plan —' },
              ...SUBSCRIPTION_PLANS.map(plan => ({ value: plan, label: plan }))
            ]}
          />
        </div>
        {serviceLabel && (
          <div className="mt-3 px-4 py-3.5 rounded-xl border border-slate-200 bg-slate-50/70">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-semibold text-gray-700">{serviceLabel.left}</p>
              <p className="text-sm font-semibold text-gray-700">{serviceLabel.right}</p>
            </div>
            <p className="text-sm font-bold text-gray-900">
              Price:{' '}
              <span className="text-[#34E06E] font-extrabold text-base">
                {data.holderCount && data.subscriptionPlan ? priceLabel(data.subscriptionPlan, data.holderCount) : '—'}
              </span>
              {data.subscriptionPlan === '1 Year Subscription Plan' && <span className="text-xs text-gray-400 font-normal ml-1.5">per certificate / year</span>}
              {data.subscriptionPlan === 'Unlimited Plan' && <span className="text-xs text-gray-400 font-normal ml-1.5">per certificate / unlimited</span>}
            </p>
            {payableTotal > 0 && (
              <p className="text-sm font-black text-slate-900 mt-1.5">
                Payable Total: <span className="text-[#34E06E] font-black">${payableTotal} USD</span>
                {selectedCount > 0 ? ` (${selectedCount} holder${selectedCount !== 1 ? 's' : ''})` : ''}
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── 3. Company ── */}
      <div id="al1-field-airlineName">
        <h3 className="text-sm font-black text-gray-500 uppercase tracking-widest mb-4">Company</h3>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-bold text-gray-600 uppercase tracking-wide">
            Company / Airline Name <span className="text-red-400">*</span>
          </label>
          <div className={`flex items-center justify-between gap-3 px-3.5 py-2.5 border rounded-xl text-sm bg-gray-50 border-gray-200 ${errors.airlineName ? 'border-red-300 bg-red-50/30' : ''}`}>
            <span className={`font-medium ${data.airlineName ? 'text-gray-900' : 'text-gray-400'}`}>
              {data.airlineName || 'Not set, update in your profile'}
            </span>
            <Link to="/dashboard/profile" className="flex-shrink-0 inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-800 hover:text-black transition-colors whitespace-nowrap">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="m4 20 4.5-1 9-9a2.1 2.1 0 0 0-3-3l-9 9L4 20Z" /></svg>
              Edit in Profile
            </Link>
          </div>
          <p className="text-[10px] text-gray-400 mt-0.5">
            This is set from your account. To change it, visit your{' '}
            <Link to="/dashboard/profile" className="text-slate-800 hover:underline font-semibold">Profile page</Link>.
          </p>
          {errors.airlineName && (
            <span className="flex items-center gap-1 text-red-500 text-xs font-medium">
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
              {errors.airlineName}
            </span>
          )}
        </div>
      </div>

      {/* ── 4. Address ── */}
      <div>
        <h3 className="text-sm font-black text-gray-500 uppercase tracking-widest mb-4">Address <span className="text-red-400">*</span></h3>
        <div className="space-y-4">
          <Field label="Address" required error={errors.addressLine1}>
            <input id="al1-field-addressLine1" type="text" placeholder="Street address" value={data.addressLine1 || ''}
              onChange={e => update({ addressLine1: e.target.value })} className={inputCls('addressLine1')} />
          </Field>
          <Field label="Address Line 2" error={errors.addressLine2}>
            <input type="text" placeholder="Apt, suite, floor, building (optional)" value={data.addressLine2 || ''}
              onChange={e => update({ addressLine2: e.target.value })} className={inputCls('addressLine2')} />
          </Field>
          <div className="grid sm:grid-cols-3 gap-4">
            <Field label="City">
              <input type="text" placeholder="City" value={data.city || ''}
                onChange={e => update({ city: e.target.value })} className={inputCls('city')} />
            </Field>
            <Field label="State / Province">
              <input type="text" placeholder="State" value={data.state || ''}
                onChange={e => update({ state: e.target.value })} className={inputCls('state')} />
            </Field>
            <Field label="Postal Code">
              <input type="text" placeholder="Postal code" value={data.postalCode || ''}
                onChange={e => update({ postalCode: e.target.value })} className={inputCls('postalCode')} />
            </Field>
          </div>
          <div id="al1-field-country">
            <Field label="Country" required error={errors.country}>
              <CountrySelect value={data.country} onChange={val => update({ country: val })} error={errors.country} />
            </Field>
          </div>
        </div>
      </div>

      {/* ── 5. Point of Contact ── */}
      <div>
        <h3 className="text-sm font-black text-gray-500 uppercase tracking-widest mb-4">Point of Contact Information</h3>
        <div className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="First Name" required error={errors.firstName}>
              <input id="al1-field-firstName" type="text" placeholder="First name" value={data.firstName || ''}
                onChange={e => update({ firstName: e.target.value })} className={inputCls('firstName')} />
            </Field>
            <Field label="Last Name" required error={errors.lastName}>
              <input id="al1-field-lastName" type="text" placeholder="Last name" value={data.lastName || ''}
                onChange={e => update({ lastName: e.target.value })} className={inputCls('lastName')} />
            </Field>
          </div>
          <Field label="Middle Name">
            <input type="text" placeholder="Middle name (optional)" value={data.middleName || ''}
              onChange={e => update({ middleName: e.target.value })} className={inputCls('middleName')} />
          </Field>
          <Field label="Date of Birth">
            <input type="date" value={data.dateOfBirth || ''}
              onChange={e => update({ dateOfBirth: e.target.value })} className={inputCls('dateOfBirth')} />
          </Field>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Email" required error={errors.email}>
              <input id="al1-field-email" type="email" placeholder="ops@airline.com" value={data.email || ''}
                onChange={e => update({ email: e.target.value })} className={inputCls('email')} />
            </Field>
            <Field label="Phone" required error={errors.phone}>
              <div id="al1-field-phone">
                <PhoneInput
                  country={phoneCountry}
                  value={data.phone || ''}
                  onChange={(phone, countryData) => {
                    update({ phone })
                    if (countryData?.countryCode) setPhoneCountry(countryData.countryCode)
                  }}
                  enableSearch
                  searchPlaceholder="Search country..."
                  preferredCountries={['us', 'gb', 'ae', 'au', 'ca', 'in']}
                />
              </div>
            </Field>
          </div>
        </div>
      </div>

      {/* ── Legal agreements ── */}
      <LegalCheckboxes
        agreedTerms={agreedTerms}
        agreedPrivacy={agreedPrivacy}
        onChangeTerms={() => { setAgreedTerms(v => !v); setTermsError(false) }}
        onChangePrivacy={() => { setAgreedPrivacy(v => !v); setPrivacyError(false) }}
        termsError={termsError}
        privacyError={privacyError}
      />

      {/* ── Next button ── */}
      <div className="flex justify-end pt-6 border-t border-gray-100">
        <button onClick={() => {
          const te = !agreedTerms
          const pe = !agreedPrivacy
          setTermsError(te)
          setPrivacyError(pe)
          if (te || pe) return
          if (validate()) onNext()
        }}
          className="inline-flex items-center gap-2 px-7 py-3 active:scale-95 text-white font-extrabold text-xs uppercase tracking-widest rounded-full transition-all duration-150 shadow-sm"
          style={{ background: '#020617' }}
          onMouseEnter={e => e.currentTarget.style.background = '#1e293b'}
          onMouseLeave={e => e.currentTarget.style.background = '#020617'}>
          Next
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </button>
      </div>
    </div>
  )
}
