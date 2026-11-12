import { useState } from 'react'
import CustomSelect from '../ui/CustomSelect'

const PRIMARY_TYPES = [
  'Part 61 - Pilot',
  'Part 61 - Flight or Ground Instructor',
  'Part 65 - Aircraft Dispatcher',
  'Part 107 - Remote Pilot',
]

const SECONDARY_TYPES = [
  'Part 61 - Pilot',
  'Part 61 - Flight or Ground Instructor',
  'Part 65 - Aircraft Dispatcher',
  'Part 107 - Remote Pilot',
]

function Field({ label, required, error, helper, children }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-bold uppercase tracking-[0.16em] text-slate-600 flex items-center gap-1">
          {label}
          {required && <span className="text-red-500 font-bold">*</span>}
        </label>
        {helper && !error && (
          <span className="text-xs text-slate-400 font-medium">{helper}</span>
        )}
      </div>
      {children}
      {error && (
        <p className="flex items-center gap-1.5 text-xs font-semibold text-red-500 mt-1">
          <svg className="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          {error}
        </p>
      )}
    </div>
  )
}

const sectionClass = 'rounded-2xl border border-slate-200/80 bg-slate-50/40 p-5 sm:p-7 shadow-xs'

export default function Step2Certificates({ data, update, onNext, onBack }) {
  const [errors, setErrors] = useState({})

  const validate = () => {
    const nextErrors = {}

    if (!data.primaryCertificate) nextErrors.primaryCertificate = 'Select the primary certificate type.'
    if (!data.primaryAirmanCertificate) nextErrors.primaryAirmanCertificate = 'Select the certificate status.'
    if (data.hasSecondaryCertificate && !data.secondaryCertificate) {
      nextErrors.secondaryCertificate = 'Select the secondary certificate type.'
    }

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
    `w-full rounded-xl border px-3.5 py-2.5 sm:py-3 text-sm text-slate-900 outline-none transition-all duration-150 placeholder:text-slate-400 hover:border-slate-300 ${
      errors[field]
        ? 'border-red-300 bg-red-50 focus:border-red-400 focus:ring-2 focus:ring-red-100'
        : 'border-slate-200 bg-white focus:border-slate-800 focus:ring-2 focus:ring-slate-100'
    }`

  return (
    <div className="space-y-6 sm:space-y-7">
      <section className={sectionClass}>
        <div className="mb-5 sm:mb-6">
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 mb-1">Primary Certificate</p>
          <h3 className="text-lg sm:text-xl font-bold text-slate-900">Enter the primary FAA certificate details.</h3>
        </div>

        <div className="space-y-5">
          <Field label="Certificate Type" required error={errors.primaryCertificate}>
            <CustomSelect
              id="field-primaryCertificate"
              value={data.primaryCertificate || ''}
              onChange={(val) => update({ primaryCertificate: val })}
              options={PRIMARY_TYPES.map((item) => ({ value: item, label: item }))}
              placeholder="Select certificate type"
              error={!!errors.primaryCertificate}
            />
          </Field>

          <Field
            label="Certificate Status"
            required
            error={errors.primaryAirmanCertificate}
          >
            <div id="field-primaryAirmanCertificate" className="grid gap-3.5 sm:grid-cols-2 mt-1">
              {['EXISTING', 'NEW'].map((value) => {
                const selected = data.primaryAirmanCertificate === value

                return (
                  <label
                    key={value}
                    className={`cursor-pointer rounded-2xl border p-4 sm:p-5 transition-all ${
                      selected
                        ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                        : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 text-slate-900'
                    }`}
                  >
                    <input
                      type="radio"
                      name="primaryAirmanCertificate"
                      value={value}
                      checked={selected}
                      onChange={() => update({ primaryAirmanCertificate: value })}
                      className="sr-only"
                    />
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className={`text-sm font-bold ${selected ? 'text-white' : 'text-slate-900'}`}>
                          {value === 'EXISTING' ? 'Existing Certificate' : 'New Certificate'}
                        </p>
                        <p className={`mt-1 text-xs leading-relaxed ${selected ? 'text-slate-300' : 'text-slate-500'}`}>
                          {value === 'EXISTING'
                            ? 'You already have an FAA certificate number.'
                            : 'You are currently in the application process.'}
                        </p>
                      </div>
                      <span
                        className={`flex h-6 w-6 items-center justify-center rounded-full border flex-shrink-0 mt-0.5 ${
                          selected ? 'border-white bg-white text-slate-900' : 'border-slate-300 bg-slate-100 text-transparent'
                        }`}
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      </span>
                    </div>
                  </label>
                )
              })}
            </div>
          </Field>

          <div className="grid gap-4.5 sm:gap-5 sm:grid-cols-2 pt-1">
            <Field label="FAA Certificate Number">
              <input
                type="text"
                placeholder="e.g. 2443157"
                value={data.faaCertificateNumber || ''}
                onChange={(e) => update({ faaCertificateNumber: e.target.value })}
                className={inputCls('faaCertificateNumber')}
              />
            </Field>
            <Field label="IACRA / FTN Tracking Number" helper="Optional">
              <input
                type="text"
                placeholder="Enter your IACRA or FTN number"
                value={data.iacraTrackingNumber}
                onChange={(e) => update({ iacraTrackingNumber: e.target.value })}
                className={inputCls('iacraTrackingNumber')}
              />
            </Field>
          </div>
        </div>
      </section>

      <section className={sectionClass}>
        <div className="mb-5 sm:mb-6">
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 mb-1">Additional Certificate</p>
          <h3 className="text-lg sm:text-xl font-bold text-slate-900">Add a secondary FAA certificate if you hold one.</h3>
        </div>

        <label className="flex cursor-pointer items-start gap-3.5 rounded-2xl border border-slate-200 bg-white p-4.5 sm:p-5 transition-colors hover:border-slate-300 hover:bg-slate-50 shadow-xs">
          <input
            type="checkbox"
            checked={data.hasSecondaryCertificate}
            onChange={(e) => update({ hasSecondaryCertificate: e.target.checked })}
            className="mt-1 h-4 w-4 accent-slate-800 rounded"
          />
          <div>
            <p className="text-sm font-bold text-slate-900">I hold an additional FAA certificate.</p>
            <p className="mt-0.5 text-xs text-slate-500 leading-relaxed">
              Enable this only if you need the registration to include another certificate profile.
            </p>
          </div>
        </label>

        {data.hasSecondaryCertificate && (
          <div className="mt-5 space-y-4.5 rounded-2xl border border-slate-200 bg-white p-4.5 sm:p-6 shadow-xs">
            <Field label="Secondary Certificate Type" required error={errors.secondaryCertificate}>
              <CustomSelect
                id="field-secondaryCertificate"
                value={data.secondaryCertificate || ''}
                onChange={(val) => update({ secondaryCertificate: val })}
                options={SECONDARY_TYPES.map((item) => ({ value: item, label: item }))}
                placeholder="Select certificate type"
                error={!!errors.secondaryCertificate}
              />
            </Field>

            <div className="grid gap-4.5 sm:gap-5 sm:grid-cols-2">
              <Field label="Secondary FAA Certificate Number">
                <input
                  type="text"
                  placeholder="Certificate number"
                  value={data.secondaryFaaCertificateNumber}
                  onChange={(e) => update({ secondaryFaaCertificateNumber: e.target.value })}
                  className={inputCls('secondaryFaaCertificateNumber')}
                />
              </Field>

              <Field label="Secondary IACRA Tracking Number">
                <input
                  type="text"
                  placeholder="Tracking number"
                  value={data.secondaryIacraTrackingNumber}
                  onChange={(e) => update({ secondaryIacraTrackingNumber: e.target.value })}
                  className={inputCls('secondaryIacraTrackingNumber')}
                />
              </Field>
            </div>
          </div>
        )}
      </section>

      <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4.5 sm:p-5 text-xs sm:text-sm leading-relaxed text-slate-600">
        💡 If you already have an FAA certificate number, you can confirm it on your certificate documents or IACRA records before proceeding.
      </div>

      <div className="flex flex-col sm:flex-row justify-between gap-3 border-t border-slate-200/80 pt-6 mt-6">
        <button
          type="button"
          onClick={onBack}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-full border border-slate-200 px-6 py-3.5 text-xs uppercase tracking-wider font-bold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 cursor-pointer"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.4}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11 17l-5-5m0 0 5-5m-5 5h12" />
          </svg>
          Back
        </button>

        <button
          type="button"
          onClick={() => {
            if (validate()) onNext()
          }}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-full px-8 py-3.5 text-xs uppercase tracking-widest font-extrabold transition-all duration-150 shadow-md active:scale-95 cursor-pointer"
          style={{ background: '#020617', color: '#ffffff' }}
          onMouseEnter={e => e.currentTarget.style.background = '#1e293b'}
          onMouseLeave={e => e.currentTarget.style.background = '#020617'}
        >
          Continue to review
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.4}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0-5 5m5-5H6" />
          </svg>
        </button>
      </div>
    </div>
  )
}
