import { useAuth } from '../../context/AuthContext'

export default function Footer() {
  const { user } = useAuth()

  return (
    <footer style={{ background: '#020617', color: '#64748B' }} className="py-6 px-4 sm:px-6 lg:px-8 text-center border-t border-white/10">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
        <p className="text-xs font-normal">© {new Date().getFullYear()} IFOA USA Corp. All rights reserved.</p>
        <p className="font-mono text-[10px] uppercase tracking-widest font-bold text-slate-500">14 CFR Part 3 FAA Registered Agent</p>
      </div>
    </footer>
  )
}
