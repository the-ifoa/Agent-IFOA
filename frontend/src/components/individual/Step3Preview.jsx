function ReviewSection({ title, rows }) {
  return (
    <section className="rounded-2xl border border-slate-200/80 bg-slate-50/40 p-5 sm:p-6 shadow-xs">
      <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 mb-3">{title}</p>
      <div className="grid gap-2.5 sm:gap-3">
        {rows.map(({ label, value }) => (
          <div
            key={label}
            className="flex flex-col gap-1 rounded-xl border border-slate-200/60 bg-white px-4 py-3 sm:flex-row sm:items-start sm:justify-between shadow-xs"
          >
            <span className="text-xs sm:text-sm font-semibold text-slate-500">{label}</span>
            <span className="text-xs sm:text-sm font-bold text-slate-900 sm:max-w-[62%] sm:text-right break-words">
              {value || <span className="text-slate-400 font-normal">Not provided</span>}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

export default function Step3Preview({ data, onNext, onBack, onEdit }) {
  const sections = [
    {
      title: 'Subscription',
      rows: [
        { label: 'Selected plan', value: data.subscriptionPlan === 'Multiple Years Subscription Plan' ? `Multiple Years Subscription Plan (${data.multiYearCount || 2} Years)` : data.subscriptionPlan },
        { label: 'Total', value: data.price ? `$${data.price.toFixed(2)} USD` : '' },
      ],
    },
    {
      title: 'Personal Information',
      rows: [
        {
          label: 'Full name',
          value: [data.firstName, data.middleName, data.lastName].filter(Boolean).join(' '),
        },
        { label: 'Date of birth', value: data.dateOfBirth },
        { label: 'Email', value: data.email },
        { label: 'Phone', value: data.phone ? `+${data.phone}` : '' },
      ],
    },
    {
      title: 'Address',
      rows: [
        { label: 'Address line 1', value: data.addressLine1 },
        { label: 'City', value: data.city },
        { label: 'State / Province', value: data.state },
        { label: 'Postal code', value: data.postalCode },
        { label: 'Country', value: data.country },
      ],
    },
    {
      title: 'Primary Certificate',
      rows: [
        { label: 'Certificate type', value: data.primaryCertificate },
        { label: 'Status', value: data.primaryAirmanCertificate },
        { label: 'FAA Certificate Number', value: data.faaCertificateNumber },
        { label: 'IACRA / FTN', value: data.iacraTrackingNumber },
      ],
    },
  ]

  if (data.hasSecondaryCertificate) {
    sections.push({
      title: 'Secondary Certificate',
      rows: [
        { label: 'Certificate type', value: data.secondaryCertificate },
        { label: 'FAA certificate number', value: data.secondaryFaaCertificateNumber },
        { label: 'IACRA tracking number', value: data.secondaryIacraTrackingNumber },
      ],
    })
  }

  return (
    <div className="space-y-6 sm:space-y-7">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 sm:px-5 py-2 text-xs uppercase tracking-wider font-bold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 cursor-pointer shadow-xs"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
          Edit
        </button>
      </div>

      <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4.5 sm:p-5 text-xs sm:text-sm leading-relaxed text-amber-900">
        Review each section before continuing. This screen is a final check for your registration details before invoice and submission.
      </div>

      <div className="space-y-5">
        {sections.map((section) => (
          <ReviewSection key={section.title} title={section.title} rows={section.rows} />
        ))}
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
          onClick={onNext}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-full px-8 py-3.5 text-xs uppercase tracking-widest font-extrabold transition-all duration-150 shadow-md active:scale-95 cursor-pointer"
          style={{ background: '#020617', color: '#ffffff' }}
          onMouseEnter={e => e.currentTarget.style.background = '#1e293b'}
          onMouseLeave={e => e.currentTarget.style.background = '#020617'}
        >
          Continue to payment
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.4}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0-5 5m5-5H6" />
          </svg>
        </button>
      </div>
    </div>
  )
}
