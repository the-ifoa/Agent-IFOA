import { useState } from 'react'
import { individualPrice } from '../../services/pricing'
import LegalCheckboxes from '../legal/LegalModal'
import CustomSelect from '../ui/CustomSelect'
import CountrySelect, { COUNTRY_TO_ISO2 } from '../ui/CountrySelect'
import PhoneInputLib from 'react-phone-input-2'
import 'react-phone-input-2/lib/style.css'

const PhoneInput = PhoneInputLib.default || PhoneInputLib

function Field({ label, required, error, helper, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400 flex items-center gap-1">
        {label}
        {required && <span className="text-red-400">*</span>}
      </label>
      {children}
      {helper && !error && <p className="text-xs text-slate-400 mt-0.5">{helper}</p>}
      {error && (
        <p className="flex items-center gap-1.5 text-xs font-semibold text-red-500 mt-0.5">
          <svg className="w-3 h-3 shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          {error}
        </p>
      )}
    </div>
  )
}

const sectionClass = 'rounded-2xl border border-gray-100 bg-white p-6 shadow-sm ring-1 ring-gray-100/50'

export default function Step1PersonalInfo({ data, update, onNext }) {
  const [errors, setErrors] = useState({})
  const [phoneCountry, setPhoneCountry] = useState(COUNTRY_TO_ISO2[data.country] || 'us')
  const [agreedTerms,   setAgreedTerms]   = useState(false)
  const [agreedPrivacy, setAgreedPrivacy] = useState(false)
  const [termsError,    setTermsError]    = useState(false)
  const [privacyError,  setPrivacyError]  = useState(false)

  const validate = () => {
    const nextErrors = {}

    if (!data.subscriptionPlan) nextErrors.subscriptionPlan = 'Select a subscription plan.'
    if (!data.firstName.trim()) nextErrors.firstName = 'First name is required.'
    if (!data.lastName.trim()) nextErrors.lastName = 'Last name is required.'

    if (!data.phone || data.phone.length < 7) nextErrors.phone = 'Enter a valid phone number.'
    if (!data.email.trim()) nextErrors.email = 'Email is required.'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) nextErrors.email = 'Enter a valid email address.'

    setErrors(nextErrors)

    // Scroll to first invalid field
    const firstKey = Object.keys(nextErrors)[0]
    if (firstKey) {
      setTimeout(() => {
        const el = document.getElementById(`field-${firstKey}`)
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 50)
    }

    return Object.keys(nextErrors).length === 0
  }

  const inputCls = (field) =>
    `w-full rounded-xl border px-3.5 py-2.5 text-sm text-slate-900 outline-none transition-all duration-150 placeholder:text-slate-400 hover:border-slate-300 ${
      errors[field]
        ? 'border-red-300 bg-red-50/40 focus:border-red-400 focus:ring-3 focus:ring-red-100'
        : 'border-slate-200 bg-white focus:border-slate-800 focus:ring-2 focus:ring-slate-100'
    }`

  return (
    <div className="space-y-6">
      <section className={sectionClass}>
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-800 mb-1">Service Plan</p>
            <h3 className="text-lg font-bold text-slate-900">Select your registration term</h3>
          </div>
          <span className="rounded-full bg-white border border-slate-200 px-3 py-1 text-xs font-bold text-slate-600">USD</span>
        </div>

        <Field label="Subscription Plan" required error={errors.subscriptionPlan}>
          <CustomSelect
            id="field-subscriptionPlan"
            value={data.subscriptionPlan || ''}
            onChange={(val) => {
              update({ subscriptionPlan: val, price: individualPrice(val, data.multiYearCount) })
            }}
            options={[
              { value: '1 Year Subscription Plan', label: '1 Year Subscription Plan' },
              { value: 'Multiple Years Subscription Plan', label: 'Multiple Years Subscription Plan' },
              { value: 'Unlimited Plan', label: 'Unlimited Plan' },
            ]}
            placeholder="— Select a Plan —"
            error={!!errors.subscriptionPlan}
          />
        </Field>

        {data.subscriptionPlan && (
          <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50/70 p-5">
            {data.subscriptionPlan === '1 Year Subscription Plan' && (
              <p className="text-sm font-bold text-slate-800">Agent for Service - Individual - 1 year</p>
            )}

            {data.subscriptionPlan === 'Multiple Years Subscription Plan' && (
              <div className="space-y-4">
                <p className="text-sm font-bold text-slate-800">Agent for Service - Individual - Up to 5 Years Subscription</p>
                <div className="flex items-center gap-4">
                  <label className="text-sm font-medium text-slate-600 flex-shrink-0">Select Duration:</label>
                  <div className="w-44">
                    <CustomSelect
                      value={String(data.multiYearCount || 2)}
                      onChange={(val) => {
                        const yrs = parseInt(val)
                        update({ multiYearCount: yrs, price: individualPrice('Multiple Years Subscription Plan', yrs) })
                      }}
                      options={[2, 3, 4, 5].map((y) => ({ value: String(y), label: `${y} Years` }))}
                    />
                  </div>
                </div>
              </div>
            )}

            {data.subscriptionPlan === 'Unlimited Plan' && (
              <p className="text-sm font-bold text-slate-800">Agent for Service - Individual - Unlimited</p>
            )}
            <div className="mt-5 flex items-end justify-between border-t border-slate-200 pt-4">
              <div>
                <span className="block text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500">Total Price</span>
                {data.subscriptionPlan === 'Multiple Years Subscription Plan' && (
                  <span className="text-xs font-semibold text-slate-600 mt-1 block">
                    (${individualPrice('Multiple Years Subscription Plan', 2) / 2}.00 / year)
                  </span>
                )}
              </div>
              <span className="text-3xl font-black text-slate-900">
                {data.subscriptionPlan
                  ? `$${individualPrice(data.subscriptionPlan, data.multiYearCount).toFixed(2)}`
                  : '$0.00'}
              </span>
            </div>
          </div>
        )}
      </section>

      <section className={sectionClass}>
        <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-800 mb-1">Personal Details</p>
        <h3 className="text-lg font-bold text-slate-900 mb-5">Tell us who the registration is for.</h3>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First Name" required error={errors.firstName}>
            <input
              id="field-firstName"
              type="text"
              placeholder="First name"
              value={data.firstName}
              onChange={(e) => update({ firstName: e.target.value })}
              className={inputCls('firstName')}
            />
          </Field>

          <Field label="Last Name" required error={errors.lastName}>
            <input
              id="field-lastName"
              type="text"
              placeholder="Last name"
              value={data.lastName}
              onChange={(e) => update({ lastName: e.target.value })}
              className={inputCls('lastName')}
            />
          </Field>

          <Field label="Middle Name" helper="Optional">
            <input
              type="text"
              placeholder="Middle name"
              value={data.middleName}
              onChange={(e) => update({ middleName: e.target.value })}
              className={inputCls('middleName')}
            />
          </Field>

          <Field label="Date of Birth" error={errors.dateOfBirth}>
            <input
              id="field-dateOfBirth"
              type="date"
              value={data.dateOfBirth}
              onChange={(e) => update({ dateOfBirth: e.target.value })}
              className={inputCls('dateOfBirth')}
            />
          </Field>
        </div>
      </section>

      <section className={sectionClass}>
        <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-800 mb-1">Address</p>
        <h3 className="text-lg font-bold text-slate-900 mb-5">Add your mailing address.</h3>

        <div className="space-y-4">
          <Field label="Address Line 1">
            <input
              type="text"
              placeholder="Street address"
              value={data.addressLine1}
              onChange={(e) => update({ addressLine1: e.target.value })}
              className={inputCls('addressLine1')}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="City">
              <input
                type="text"
                placeholder="City"
                value={data.city}
                onChange={(e) => update({ city: e.target.value })}
                className={inputCls('city')}
              />
            </Field>

            <Field label="State / Province">
              <input
                type="text"
                placeholder="State or province"
                value={data.state}
                onChange={(e) => update({ state: e.target.value })}
                className={inputCls('state')}
              />
            </Field>

            <Field label="Postal Code">
              <input
                type="text"
                placeholder="Postal code"
                value={data.postalCode}
                onChange={(e) => update({ postalCode: e.target.value })}
                className={inputCls('postalCode')}
              />
            </Field>
          </div>

          <Field label="Country" error={errors.country}>
            <CountrySelect
              value={data.country}
              onChange={(val) => {
                update({ country: val })
                const iso2 = COUNTRY_TO_ISO2[val]
                if (iso2) setPhoneCountry(iso2)
              }}
              error={errors.country}
            />
          </Field>
        </div>
      </section>

      <section className={sectionClass}>
        <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-800 mb-1">Contact</p>
        <h3 className="text-lg font-bold text-slate-900 mb-5">Where should updates and payment communication go?</h3>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Phone Number" required error={errors.phone}>
            <div id="field-phone">
              <PhoneInput
                country={phoneCountry}
                value={data.phone}
                onChange={(phone, countryData) => {
                  update({ phone })
                  if (countryData?.countryCode) setPhoneCountry(countryData.countryCode)
                }}
                inputClass={errors.phone ? 'error-field' : ''}
                enableSearch
                searchPlaceholder="Search country..."
                preferredCountries={['us', 'gb', 'ae', 'au', 'ca', 'in']}
              />
            </div>
          </Field>

          <Field label="Email Address" required error={errors.email}>
            <input
              id="field-email"
              type="email"
              placeholder="name@example.com"
              value={data.email}
              onChange={(e) => update({ email: e.target.value })}
              className={inputCls('email')}
            />
          </Field>
        </div>
      </section>

      <LegalCheckboxes
        agreedTerms={agreedTerms}
        agreedPrivacy={agreedPrivacy}
        onChangeTerms={() => { setAgreedTerms(v => !v); setTermsError(false) }}
        onChangePrivacy={() => { setAgreedPrivacy(v => !v); setPrivacyError(false) }}
        termsError={termsError}
        privacyError={privacyError}
      />

      <div className="flex justify-end border-t border-slate-100 pt-4">
        <button
          onClick={() => {
            const te = !agreedTerms
            const pe = !agreedPrivacy
            setTermsError(te)
            setPrivacyError(pe)
            if (te || pe) return
            if (validate()) onNext()
          }}
          className="inline-flex items-center gap-2 rounded-full px-7 py-3 text-xs uppercase tracking-widest font-extrabold transition-all duration-150 shadow-sm active:scale-95"
          style={{ background: '#020617', color: '#ffffff' }}
          onMouseEnter={e => e.currentTarget.style.background = '#1e293b'}
          onMouseLeave={e => e.currentTarget.style.background = '#020617'}
        >
          Continue to certificates
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0-5 5m5-5H6" />
          </svg>
        </button>
      </div>
    </div>
  )
}

