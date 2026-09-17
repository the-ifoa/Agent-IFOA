import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, Search, Check } from 'lucide-react'

export const COUNTRIES = [
  'Afghanistan', 'Albania', 'Algeria', 'American Samoa', 'Andorra', 'Angola', 'Anguilla', 'Antarctica', 'Antigua and Barbuda', 'Argentina',
  'Armenia', 'Aruba', 'Australia', 'Austria', 'Azerbaijan', 'Bahamas', 'Bahrain', 'Bangladesh', 'Barbados', 'Belarus', 'Belgium', 'Belize',
  'Benin', 'Bermuda', 'Bhutan', 'Bolivia', 'Bosnia and Herzegovina', 'Botswana', 'Brazil', 'Brunei', 'Bulgaria', 'Burkina Faso', 'Burundi',
  'Cabo Verde', 'Cambodia', 'Cameroon', 'Canada', 'Cayman Islands', 'Central African Republic', 'Chad', 'Chile', 'China', 'Colombia',
  'Comoros', 'Congo', 'Costa Rica', 'Croatia', 'Cuba', 'Cyprus', 'Czech Republic', 'Denmark', 'Dominican Republic', 'Ecuador', 'Egypt',
  'El Salvador', 'Eritrea', 'Estonia', 'Ethiopia', 'Finland', 'France', 'Germany', 'Ghana', 'Greece', 'Guatemala', 'Haiti', 'Honduras',
  'Hong Kong', 'Hungary', 'Iceland', 'India', 'Indonesia', 'Iraq', 'Ireland', 'Israel', 'Italy', 'Jamaica', 'Japan', 'Jordan', 'Kazakhstan',
  'Kenya', 'Korea (Republic of)', 'Kuwait', 'Kyrgyzstan', 'Latvia', 'Lebanon', 'Libya', 'Lithuania', 'Luxembourg', 'Malaysia', 'Maldives',
  'Mali', 'Malta', 'Mexico', 'Moldova', 'Monaco', 'Mongolia', 'Morocco', 'Mozambique', 'Myanmar', 'Nepal', 'Netherlands', 'New Zealand',
  'Nicaragua', 'Nigeria', 'Norway', 'Oman', 'Pakistan', 'Palestine', 'Panama', 'Paraguay', 'Peru', 'Philippines', 'Poland', 'Portugal',
  'Puerto Rico', 'Qatar', 'Romania', 'Russian Federation', 'Rwanda', 'Saudi Arabia', 'Senegal', 'Serbia', 'Singapore', 'Slovakia',
  'Slovenia', 'Somalia', 'South Africa', 'Spain', 'Sri Lanka', 'Sudan', 'Sweden', 'Switzerland', 'Syria', 'Taiwan', 'Tanzania', 'Thailand',
  'Tunisia', 'Türkiye', 'Uganda', 'Ukraine', 'United Arab Emirates', 'United Kingdom', 'United States of America', 'Uruguay',
  'Uzbekistan', 'Venezuela', 'Vietnam', 'Yemen', 'Zambia', 'Zimbabwe',
]

export const COUNTRY_TO_ISO2 = {
  'Afghanistan': 'af', 'Albania': 'al', 'Algeria': 'dz', 'American Samoa': 'as', 'Andorra': 'ad',
  'Angola': 'ao', 'Anguilla': 'ai', 'Antigua and Barbuda': 'ag', 'Argentina': 'ar', 'Armenia': 'am',
  'Aruba': 'aw', 'Australia': 'au', 'Austria': 'at', 'Azerbaijan': 'az', 'Bahamas': 'bs',
  'Bahrain': 'bh', 'Bangladesh': 'bd', 'Barbados': 'bb', 'Belarus': 'by', 'Belgium': 'be',
  'Belize': 'bz', 'Benin': 'bj', 'Bermuda': 'bm', 'Bhutan': 'bt', 'Bolivia': 'bo',
  'Bosnia and Herzegovina': 'ba', 'Botswana': 'bw', 'Brazil': 'br', 'Brunei': 'bn', 'Bulgaria': 'bg',
  'Burkina Faso': 'bf', 'Burundi': 'bi', 'Cabo Verde': 'cv', 'Cambodia': 'kh', 'Cameroon': 'cm',
  'Canada': 'ca', 'Cayman Islands': 'ky', 'Central African Republic': 'cf', 'Chad': 'td', 'Chile': 'cl',
  'China': 'cn', 'Colombia': 'co', 'Comoros': 'km', 'Congo': 'cg', 'Costa Rica': 'cr',
  'Croatia': 'hr', 'Cuba': 'cu', 'Cyprus': 'cy', 'Czech Republic': 'cz', 'Denmark': 'dk',
  'Dominican Republic': 'do', 'Ecuador': 'ec', 'Egypt': 'eg', 'El Salvador': 'sv', 'Eritrea': 'er',
  'Estonia': 'ee', 'Ethiopia': 'et', 'Finland': 'fi', 'France': 'fr', 'Germany': 'de',
  'Ghana': 'gh', 'Greece': 'gr', 'Guatemala': 'gt', 'Haiti': 'ht', 'Honduras': 'hn',
  'Hong Kong': 'hk', 'Hungary': 'hu', 'Iceland': 'is', 'India': 'in', 'Indonesia': 'id',
  'Iraq': 'iq', 'Ireland': 'ie', 'Israel': 'il', 'Italy': 'it', 'Jamaica': 'jm',
  'Japan': 'jp', 'Jordan': 'jo', 'Kazakhstan': 'kz', 'Kenya': 'ke', 'Korea (Republic of)': 'kr',
  'Kuwait': 'kw', 'Kyrgyzstan': 'kg', 'Latvia': 'lv', 'Lebanon': 'lb', 'Libya': 'ly',
  'Lithuania': 'lt', 'Luxembourg': 'lu', 'Malaysia': 'my', 'Maldives': 'mv', 'Mali': 'ml',
  'Malta': 'mt', 'Mexico': 'mx', 'Moldova': 'md', 'Monaco': 'mc', 'Mongolia': 'mn',
  'Morocco': 'ma', 'Mozambique': 'mz', 'Myanmar': 'mm', 'Nepal': 'np', 'Netherlands': 'nl',
  'New Zealand': 'nz', 'Nicaragua': 'ni', 'Nigeria': 'ng', 'Norway': 'no', 'Oman': 'om',
  'Pakistan': 'pk', 'Palestine': 'ps', 'Panama': 'pa', 'Paraguay': 'py', 'Peru': 'pe',
  'Philippines': 'ph', 'Poland': 'pl', 'Portugal': 'pt', 'Puerto Rico': 'pr', 'Qatar': 'qa',
  'Romania': 'ro', 'Russian Federation': 'ru', 'Rwanda': 'rw', 'Saudi Arabia': 'sa', 'Senegal': 'sn',
  'Serbia': 'rs', 'Singapore': 'sg', 'Slovakia': 'sk', 'Slovenia': 'si', 'Somalia': 'so',
  'South Africa': 'za', 'Spain': 'es', 'Sri Lanka': 'lk', 'Sudan': 'sd', 'Sweden': 'se',
  'Switzerland': 'ch', 'Syria': 'sy', 'Taiwan': 'tw', 'Tanzania': 'tz', 'Thailand': 'th',
  'Tunisia': 'tn', 'Türkiye': 'tr', 'Turkey': 'tr', 'Uganda': 'ug', 'Ukraine': 'ua', 'United Arab Emirates': 'ae',
  'United Kingdom': 'gb', 'United States of America': 'us', 'United States': 'us', 'Uruguay': 'uy', 'Uzbekistan': 'uz',
  'Venezuela': 've', 'Vietnam': 'vn', 'Yemen': 'ye', 'Zambia': 'zm', 'Zimbabwe': 'zw',
}

export default function CountrySelect({
  value,
  onChange,
  error = false,
  placeholder = '— Select country —',
  className = '',
  dropUp: explicitDropUp,
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [placement, setPlacement] = useState('bottom') // 'bottom' | 'top'
  const [menuMaxHeight, setMenuMaxHeight] = useState(240)
  const containerRef = useRef(null)
  const inputRef = useRef(null)

  const filtered = COUNTRIES.filter((c) =>
    c.toLowerCase().includes(search.toLowerCase())
  )

  useEffect(() => {
    if (!open) return

    const updatePosition = () => {
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const spaceBelow = window.innerHeight - rect.bottom
      const spaceAbove = rect.top

      if (explicitDropUp !== undefined) {
        const isUp = !!explicitDropUp
        setPlacement(isUp ? 'top' : 'bottom')
        const avail = isUp ? spaceAbove : spaceBelow
        setMenuMaxHeight(Math.max(140, Math.min(260, avail - 20)))
        return
      }

      // If space below is tight (<340px) and top has more room, or below is <220px, open top
      const shouldOpenUp = (spaceBelow < 340 && spaceAbove > spaceBelow) || (spaceBelow < 220 && spaceAbove > 160)

      if (shouldOpenUp) {
        setPlacement('top')
        setMenuMaxHeight(Math.max(140, Math.min(260, spaceAbove - 20)))
      } else {
        setPlacement('bottom')
        setMenuMaxHeight(Math.max(140, Math.min(260, spaceBelow - 20)))
      }
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)

    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, explicitDropUp])

  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  const handleSelect = (country) => {
    onChange?.(country)
    setOpen(false)
    setSearch('')
  }

  const isUp = placement === 'top'
  const selectedIso2 = value ? COUNTRY_TO_ISO2[value] : null

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v)
          setSearch('')
        }}
        className={`w-full flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl border text-sm font-semibold transition-all duration-150 text-left outline-none cursor-pointer ${
          error
            ? 'border-red-300 bg-red-50/30 text-slate-900 focus:border-red-500 focus:ring-4 focus:ring-red-100'
            : open
            ? 'border-slate-900 bg-white ring-4 ring-slate-900/5 text-slate-900'
            : 'border-slate-200 bg-white hover:border-slate-300 text-slate-800'
        }`}
      >
        <span className={`flex items-center gap-2 min-w-0 truncate ${!value ? 'text-slate-400 font-normal' : 'text-slate-900 font-semibold'}`}>
          {selectedIso2 && (
            <img
              src={`https://flagcdn.com/w20/${selectedIso2}.png`}
              alt=""
              className="w-4 h-3 flex-shrink-0 object-cover rounded-[2px]"
            />
          )}
          <span className="truncate">{value || placeholder}</span>
        </span>
        <ChevronDown
          className={`w-4 h-4 text-slate-400 flex-shrink-0 transition-transform duration-200 ${
            open ? 'rotate-180 text-slate-900' : ''
          }`}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: isUp ? 4 : -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: isUp ? 4 : -4, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className={`absolute z-[99999] left-0 right-0 ${
              isUp ? 'bottom-[calc(100%+6px)]' : 'top-[calc(100%+6px)]'
            } rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden`}
            style={{
              boxShadow: '0 20px 40px -4px rgba(2, 6, 23, 0.14), 0 8px 16px -2px rgba(2, 6, 23, 0.08)',
            }}
          >
            <div className="p-2 border-b border-slate-100 bg-white sticky top-0 z-10">
              <div className="relative flex items-center">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none" />
                <input
                  ref={inputRef}
                  type="text"
                  placeholder="Search country..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/5 bg-slate-50 text-slate-900 placeholder:text-slate-400 font-medium transition-all"
                />
              </div>
            </div>

            <div className="overflow-y-auto p-1.5 space-y-0.5" style={{ maxHeight: `${Math.max(120, menuMaxHeight - 60)}px` }}>
              {filtered.length === 0 ? (
                <div className="px-4 py-3 text-xs text-slate-400 text-center font-medium">
                  No countries found
                </div>
              ) : (
                filtered.map((c) => {
                  const isSelected = c === value
                  const iso2 = COUNTRY_TO_ISO2[c]
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => handleSelect(c)}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm text-left transition-all duration-120 select-none cursor-pointer ${
                        isSelected
                          ? 'bg-slate-900 text-white font-semibold'
                          : 'text-slate-700 hover:bg-slate-100 font-medium'
                      }`}
                    >
                      <span className="flex items-center gap-2 min-w-0 truncate">
                        {iso2 ? (
                          <img
                            src={`https://flagcdn.com/w20/${iso2}.png`}
                            alt=""
                            className="w-4 h-3 flex-shrink-0 object-cover rounded-[2px]"
                          />
                        ) : (
                          <span className="w-4 h-3 flex-shrink-0" />
                        )}
                        <span className="truncate">{c}</span>
                      </span>
                      {isSelected && <Check className="w-4 h-4 text-[#34E06E] flex-shrink-0" />}
                    </button>
                  )
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
