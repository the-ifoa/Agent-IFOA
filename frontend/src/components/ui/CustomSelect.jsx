import { useState, useRef, useEffect, createContext, useContext } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, Check } from 'lucide-react'

const SelectContext = createContext(null)

/**
 * CustomSelect, A modern, accessible dropdown replacing native <select>.
 *
 * Usage 1 (Simple Props):
 * <CustomSelect
 *   value={selectedPlan}
 *   onChange={(val) => setSelectedPlan(val)}
 *   options={[
 *     { value: '1 Year', label: '1 Year Subscription Plan' },
 *     { value: 'Multi Year', label: 'Multiple Years Subscription Plan' },
 *   ]}
 *   placeholder="— Select a Plan —"
 * />
 *
 * Usage 2 (Compound Component):
 * <Select value={val} onValueChange={setVal}>
 *   <SelectTrigger className="...">
 *     <SelectValue placeholder="Select..." />
 *   </SelectTrigger>
 *   <SelectContent>
 *     <SelectItem value="1">Option 1</SelectItem>
 *     <SelectItem value="2">Option 2</SelectItem>
 *   </SelectContent>
 * </Select>
 */

export default function CustomSelect({
  value,
  onChange,
  options = [],
  placeholder = '— Select —',
  disabled = false,
  error = false,
  className = '',
  triggerClassName = '',
  dropdownClassName = '',
  id,
  name,
}) {
  const [open, setOpen] = useState(false)
  const [placement, setPlacement] = useState('bottom') // 'bottom' | 'top'
  const [menuMaxHeight, setMenuMaxHeight] = useState(250)
  const containerRef = useRef(null)

  // Normalize options to [{ value, label, sublabel, disabled }]
  const normalizedOptions = options.map((opt) => {
    if (typeof opt === 'object' && opt !== null) {
      return {
        value: opt.value ?? '',
        label: opt.label ?? opt.value ?? '',
        sublabel: opt.sublabel ?? null,
        disabled: !!opt.disabled,
      }
    }
    return {
      value: String(opt),
      label: String(opt),
      sublabel: null,
      disabled: false,
    }
  })

  const selectedOption = normalizedOptions.find(
    (opt) => String(opt.value) === String(value)
  )

  useEffect(() => {
    if (!open) return

    const updatePosition = () => {
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const spaceBelow = window.innerHeight - rect.bottom
      const spaceAbove = rect.top

      const shouldOpenUp = (spaceBelow < 340 && spaceAbove > spaceBelow) || (spaceBelow < 220 && spaceAbove > 160)

      if (shouldOpenUp) {
        setPlacement('top')
        setMenuMaxHeight(Math.max(140, Math.min(280, spaceAbove - 20)))
      } else {
        setPlacement('bottom')
        setMenuMaxHeight(Math.max(140, Math.min(280, spaceBelow - 20)))
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
  }, [open])

  const handleSelect = (optVal) => {
    if (disabled) return
    onChange?.(optVal)
    // Also trigger synthetic event if needed by parent form handlers
    if (typeof onChange === 'function' && id) {
      const syntheticEvent = { target: { name: name || id, value: optVal, id } }
      // If parent expects event object (e.target.value)
      try {
        if (onChange.length >= 1) {
          // Handled via standard val callback
        }
      } catch { /* no-op */ }
    }
    setOpen(false)
  }

  const isUp = placement === 'top'

  return (
    <div ref={containerRef} className={`relative w-full ${className}`} id={id}>
      {/* Hidden native input for form compatibility */}
      {name && <input type="hidden" name={name} value={value ?? ''} />}

      {/* Trigger Button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((prev) => !prev)}
        className={`w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl border text-sm font-semibold transition-all duration-150 text-left outline-none ${
          disabled
            ? 'opacity-50 cursor-not-allowed bg-slate-100 border-slate-200 text-slate-400'
            : error
            ? 'border-red-300 bg-red-50/30 text-slate-900 focus:border-red-500 focus:ring-4 focus:ring-red-100'
            : open
            ? 'border-slate-900 bg-white ring-4 ring-slate-900/5 text-slate-900'
            : 'border-slate-200 bg-white hover:border-slate-300 text-slate-800'
        } ${triggerClassName}`}
      >
        <span className={`truncate ${!selectedOption ? 'text-slate-400 font-normal' : 'text-slate-900 font-semibold'}`}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown
          className={`w-4 h-4 text-slate-400 flex-shrink-0 transition-transform duration-200 ${
            open ? 'rotate-180 text-slate-900' : ''
          }`}
        />
      </button>

      {/* Dropdown Menu */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: isUp ? 4 : -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: isUp ? 4 : -4, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className={`absolute z-[100] left-0 right-0 ${
              isUp ? 'bottom-[calc(100%+6px)]' : 'top-[calc(100%+6px)]'
            } overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-2xl focus:outline-none ${dropdownClassName}`}
            style={{
              maxHeight: `${menuMaxHeight}px`,
              boxShadow: '0 16px 36px -4px rgba(2, 6, 23, 0.12), 0 6px 12px -2px rgba(2, 6, 23, 0.06)',
            }}
          >
            {normalizedOptions.length === 0 ? (
              <div className="px-4 py-3 text-xs text-slate-400 text-center font-medium">
                No options available
              </div>
            ) : (
              normalizedOptions.map((opt) => {
                const isSelected = String(opt.value) === String(value)
                return (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={opt.disabled}
                    onClick={() => handleSelect(opt.value)}
                    className={`w-full flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-colors text-left ${
                      opt.disabled
                        ? 'opacity-40 cursor-not-allowed text-slate-400'
                        : isSelected
                        ? 'bg-slate-900 text-white font-bold'
                        : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate leading-tight">{opt.label}</p>
                      {opt.sublabel && (
                        <p className={`text-xs mt-0.5 truncate ${isSelected ? 'text-slate-300' : 'text-slate-400'}`}>
                          {opt.sublabel}
                        </p>
                      )}
                    </div>
                    {isSelected && (
                      <Check className="w-4 h-4 text-[#34E06E] flex-shrink-0 ml-2" />
                    )}
                  </button>
                )
              })
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ── Compound Component API ── */

export function Select({ value, onValueChange, children, defaultValue }) {
  const [val, setVal] = useState(value ?? defaultValue ?? '')
  const [open, setOpen] = useState(false)
  const [placement, setPlacement] = useState('bottom')
  const [menuMaxHeight, setMenuMaxHeight] = useState(250)
  const containerRef = useRef(null)

  const currentValue = value !== undefined ? value : val

  const handleValueChange = (newVal) => {
    if (value === undefined) setVal(newVal)
    onValueChange?.(newVal)
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return

    const updatePosition = () => {
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const spaceBelow = window.innerHeight - rect.bottom
      const spaceAbove = rect.top

      const shouldOpenUp = (spaceBelow < 340 && spaceAbove > spaceBelow) || (spaceBelow < 220 && spaceAbove > 160)

      if (shouldOpenUp) {
        setPlacement('top')
        setMenuMaxHeight(Math.max(140, Math.min(280, spaceAbove - 20)))
      } else {
        setPlacement('bottom')
        setMenuMaxHeight(Math.max(140, Math.min(280, spaceBelow - 20)))
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
  }, [open])

  return (
    <SelectContext.Provider
      value={{
        value: currentValue,
        onValueChange: handleValueChange,
        open,
        setOpen,
        placement,
        menuMaxHeight,
      }}
    >
      <div ref={containerRef} className="relative w-full">
        {children}
      </div>
    </SelectContext.Provider>
  )
}

export function SelectTrigger({ className = '', children, disabled }) {
  const { open, setOpen } = useContext(SelectContext)
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => !disabled && setOpen((prev) => !prev)}
      className={`w-full flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-800 transition-all outline-none hover:border-slate-300 ${
        open ? 'border-slate-900 ring-4 ring-slate-900/5' : ''
      } ${className}`}
    >
      {children}
      <ChevronDown
        className={`w-4 h-4 text-slate-400 flex-shrink-0 transition-transform duration-200 ${
          open ? 'rotate-180 text-slate-900' : ''
        }`}
      />
    </button>
  )
}

export function SelectValue({ placeholder = '— Select —' }) {
  const { value } = useContext(SelectContext)
  return (
    <span className={`truncate ${!value ? 'text-slate-400 font-normal' : 'text-slate-900 font-semibold'}`}>
      {value || placeholder}
    </span>
  )
}

export function SelectContent({ className = '', children }) {
  const { open, placement, menuMaxHeight } = useContext(SelectContext)
  const isUp = placement === 'top'
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: isUp ? 4 : -4, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: isUp ? 4 : -4, scale: 0.98 }}
          transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
          className={`absolute z-[100] left-0 right-0 ${
            isUp ? 'bottom-[calc(100%+6px)]' : 'top-[calc(100%+6px)]'
          } overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-2xl focus:outline-none ${className}`}
          style={{
            maxHeight: menuMaxHeight ? `${menuMaxHeight}px` : '260px',
            boxShadow: '0 16px 36px -4px rgba(2, 6, 23, 0.12), 0 6px 12px -2px rgba(2, 6, 23, 0.06)',
          }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function SelectItem({ value, children, className = '', disabled }) {
  const { value: selectedVal, onValueChange } = useContext(SelectContext)
  const isSelected = String(selectedVal) === String(value)

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onValueChange(value)}
      className={`w-full flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-colors text-left ${
        disabled
          ? 'opacity-40 cursor-not-allowed text-slate-400'
          : isSelected
          ? 'bg-slate-900 text-white font-bold'
          : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
      } ${className}`}
    >
      <span className="truncate flex-1">{children}</span>
      {isSelected && <Check className="w-4 h-4 text-[#34E06E] flex-shrink-0 ml-2" />}
    </button>
  )
}
