/**
 * AdminSupportPage.jsx , /admin/support
 *
 * Admin live-chat console. Left: conversation list with Individuals / Airlines
 * tabs (each row shows the name, last message, time + unread badge). Right: the
 * selected conversation thread with a reply composer. Real-time via Socket.IO.
 */
import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Search,
  Mail,
  Trash2,
  Pencil,
  Send,
  MessageSquare,
  ChevronLeft,
  X
} from 'lucide-react'
import { getSocket } from '../../services/socket'
import {
  getSupportConversations,
  getSupportConversation,
  getSupportConversationByUser,
  sendSupportReply,
  markSupportConvRead,
  editSupportMessage,
  deleteSupportMessage,
  deleteSupportConversation,
  sendSupportEmail,
  sendSupportBulkEmail,
} from '../../services/api'

const DEFAULT_EMAIL_SUBJECT = 'New message from IFOA USA Support'
const DEFAULT_EMAIL_BODY    = 'You have a new message from the IFOA USA support team. Please log in to your dashboard to view it.'

const fmtTime = (d) => {
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return ''
  const now = new Date()
  const sameDay = dt.toDateString() === now.toDateString()
  return sameDay
    ? dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const fmtDateSep = (d) => {
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return ''
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today - 86400000)
  const msgDay = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate())
  if (msgDay.getTime() === today.getTime()) return 'Today'
  if (msgDay.getTime() === yesterday.getTime()) return 'Yesterday'
  return dt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

const dayKey = (d) => {
  const dt = new Date(d)
  return Number.isNaN(dt.getTime()) ? 'unknown' : `${dt.getFullYear()}-${dt.getMonth()}-${dt.getDate()}`
}

const initials = (name) =>
  (name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?'

function Avatar({ name, logoUrl, size = 'md' }) {
  const sz = size === 'sm' ? 'w-9 h-9 text-xs' : 'w-10 h-10 text-xs'
  if (logoUrl) {
    return (
      <div className={`${sz} rounded-xl flex-shrink-0 bg-white border border-slate-200 overflow-hidden shadow-2xs`}>
        <img src={logoUrl} alt={name} className="w-full h-full object-contain p-0.5" />
      </div>
    )
  }
  return (
    <div className={`${sz} rounded-xl flex-shrink-0 flex items-center justify-center text-white font-black bg-slate-900 border border-slate-800 shadow-2xs`}>
      {initials(name)}
    </div>
  )
}

export default function AdminSupportPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [tab, setTab] = useState('all') // 'all' | 'individual' | 'airline'
  const [conversations, setConversations] = useState([])
  const [search, setSearch] = useState('')
  const [activeId, setActiveId] = useState(null)
  const [messages, setMessages] = useState([])
  const [loadingList, setLoadingList] = useState(true)
  const [loadingThread, setLoadingThread] = useState(false)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [userTyping, setUserTyping] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editText, setEditText] = useState('')
  const [confirmDeleteConv, setConfirmDeleteConv] = useState(false)
  // Custom email composer
  const [emailOpen, setEmailOpen] = useState(false)
  const [emailSubject, setEmailSubject] = useState(DEFAULT_EMAIL_SUBJECT)
  const [emailBody, setEmailBody] = useState(DEFAULT_EMAIL_BODY)
  const [emailSending, setEmailSending] = useState(false)
  const [emailStatus, setEmailStatus] = useState(null) // { ok: bool, msg: string }
  const [emailMode, setEmailMode] = useState('single') // 'single' | 'bulk'
  // List-selection for bulk email (set of conversation ids)
  const [selected, setSelected] = useState(() => new Set())
  const scrollRef = useRef(null)
  const activeIdRef = useRef(null)
  const typingTimer = useRef(null)

  useEffect(() => { activeIdRef.current = activeId }, [activeId])

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    })
  }, [])

  // Upsert a conversation summary into the list, matched by user (one
  // conversation per user). Merges into the synthetic "no chat yet" row if
  // present. Keeps newest-activity first, then alphabetical.
  const upsertConversation = useCallback((summary) => {
    setConversations(prev => {
      const idx = prev.findIndex(c => String(c.user) === String(summary.user))
      const next = idx === -1 ? [summary, ...prev] : prev.map((c, i) => (i === idx ? { ...c, ...summary } : c))
      return next.sort((a, b) => {
        const ta = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0
        const tb = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0
        if (tb !== ta) return tb - ta
        return (a.name || '').localeCompare(b.name || '')
      })
    })
  }, [])

  // ── Notification permission ───────────────────────────────────────────────────
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }, [])

  // ── Load list ────────────────────────────────────────────────────────────────
  useEffect(() => {
    let active = true
    setLoadingList(true)
    getSupportConversations()
      .then(res => { if (active) setConversations(res.data?.data || []) })
      .catch(() => { })
      .finally(() => { if (active) setLoadingList(false) })
    return () => { active = false }
  }, [])

  // ── Auto-open conversation from ?conv= URL param (notification click) ────────
  useEffect(() => {
    const convId = searchParams.get('conv')
    if (!convId || loadingList || conversations.length === 0) return
    const found = conversations.find(c => String(c._id) === convId)
    if (!found) return
    setTab(found.role)
    openConversation(found)
    setSearchParams({}, { replace: true })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, loadingList, conversations])

  // ── Socket wiring ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const socket = getSocket()
    if (!socket) return

    const onMessage = ({ conversationId, message }) => {
      if (String(conversationId) === String(activeIdRef.current)) {
        setMessages(prev => (prev.some(m => m._id === message._id) ? prev : [...prev, message]))
        if (message.senderRole === 'user') {
          setUserTyping(false)
          markSupportConvRead(conversationId).catch(() => { })
          socket.emit('support:read', { conversationId })
        }
      }
    }
    const onConversation = (summary) => {
      upsertConversation(summary)
      if (summary.lastSenderRole === 'user' && Notification.permission === 'granted') {
        new Notification(`New message, ${summary.name || 'User'}`, {
          body: summary.lastMessageBody?.trim().slice(0, 100) || 'New message',
          icon: '/favicon.ico',
          tag: `support-${summary._id}`,
        })
      }
    }
    const onTyping = ({ conversationId, from, typing }) => {
      if (from === 'user' && String(conversationId) === String(activeIdRef.current)) setUserTyping(typing)
    }

    const onMessageEdited = ({ message }) => {
      setMessages(prev => prev.map(m => m._id === message._id ? { ...m, body: message.body, edited: true, editedAt: message.editedAt } : m))
    }
    const onMessageDeleted = ({ messageId }) => {
      setMessages(prev => prev.filter(m => m._id !== messageId))
    }
    const onMessagesCleared = ({ conversationId }) => {
      if (String(conversationId) === String(activeIdRef.current)) setMessages([])
    }
    const onConversationDeleted = ({ conversationId }) => {
      // Revert the row to an empty (synthetic) state so the user stays listed.
      setConversations(prev => prev.map(c => (
        String(c._id) === String(conversationId)
          ? { ...c, _id: null, lastMessageBody: '', lastMessageAt: null, lastSenderRole: null, adminUnread: 0, userUnread: 0, hasConversation: false }
          : c
      )))
      if (String(conversationId) === String(activeIdRef.current)) {
        setActiveId(null)
        setMessages([])
      }
    }

    socket.on('support:message', onMessage)
    socket.on('support:conversation', onConversation)
    socket.on('support:typing', onTyping)
    socket.on('support:message-edited', onMessageEdited)
    socket.on('support:message-deleted', onMessageDeleted)
    socket.on('support:messages-cleared', onMessagesCleared)
    socket.on('support:conversation-deleted', onConversationDeleted)
    return () => {
      socket.off('support:message', onMessage)
      socket.off('support:conversation', onConversation)
      socket.off('support:typing', onTyping)
      socket.off('support:message-edited', onMessageEdited)
      socket.off('support:message-deleted', onMessageDeleted)
      socket.off('support:messages-cleared', onMessagesCleared)
      socket.off('support:conversation-deleted', onConversationDeleted)
    }
  }, [upsertConversation])

  // ── Open a conversation ───────────────────────────────────────────────────────
  // Accepts a list row. Rows without a conversation yet (`_id === null`) are
  // lazily created server-side via the by-user endpoint.
  const openConversation = useCallback((row) => {
    if (!row) return
    setLoadingThread(true)
    setUserTyping(false)

    const apply = (convId, messages) => {
      setActiveId(convId)
      setMessages(messages || [])
      setConversations(prev => prev.map(c => (String(c.user) === String(row.user) ? { ...c, adminUnread: 0 } : c)))
      scrollToBottom()
      getSocket()?.emit('support:read', { conversationId: convId })
    }

    if (row._id) {
      setActiveId(row._id)
      getSupportConversation(row._id)
        .then(res => apply(row._id, res.data?.data?.messages))
        .catch(() => { })
        .finally(() => setLoadingThread(false))
    } else {
      getSupportConversationByUser(row.user)
        .then(res => {
          const conv = res.data?.data?.conversation
          if (conv) {
            upsertConversation(conv)
            apply(conv._id, res.data?.data?.messages)
          }
        })
        .catch(() => { })
        .finally(() => setLoadingThread(false))
    }
  }, [scrollToBottom, upsertConversation])

  useEffect(() => { scrollToBottom() }, [messages, userTyping, scrollToBottom])

  const emitTyping = (typing) => {
    if (!activeId) return
    getSocket()?.emit('support:typing', { conversationId: activeId, typing })
  }

  const handleChange = (e) => {
    setText(e.target.value)
    emitTyping(true)
    clearTimeout(typingTimer.current)
    typingTimer.current = setTimeout(() => emitTyping(false), 1500)
  }

  const send = async () => {
    const body = text.trim()
    if (!body || !activeId || sending) return
    setSending(true)
    setText('')
    emitTyping(false)
    const socket = getSocket()
    try {
      if (socket && socket.connected) {
        await new Promise((resolve, reject) => {
          socket.timeout(6000).emit('support:send', { conversationId: activeId, body }, (err, resp) => {
            if (err) return reject(err)
            if (!resp?.ok) return reject(new Error(resp?.error || 'Send failed'))
            resolve(resp)
          })
        })
      } else {
        const res = await sendSupportReply(activeId, body)
        setMessages(prev => [...prev, res.data.data])
      }
    } catch {
      try {
        const res = await sendSupportReply(activeId, body)
        setMessages(prev => (prev.some(m => m._id === res.data.data._id) ? prev : [...prev, res.data.data]))
      } catch {
        setText(body)
      }
    } finally {
      setSending(false)
    }
  }

  const deleteMsg = async (msgId) => {
    if (!activeId) return
    setMessages(prev => prev.filter(m => m._id !== msgId))
    try {
      await deleteSupportMessage(activeId, msgId)
    } catch {
      // If failed, reload messages
      getSupportConversation(activeId).then(res => setMessages(res.data?.data?.messages || [])).catch(() => {})
    }
  }

  const saveEdit = async (msgId) => {
    const body = editText.trim()
    if (!body || !activeId) return
    setEditingId(null)
    setEditText('')
    try {
      const res = await editSupportMessage(activeId, msgId, body)
      const updated = res.data.data
      setMessages(prev => prev.map(m => m._id === msgId ? { ...m, body: updated.body, edited: true, editedAt: updated.editedAt } : m))
    } catch { /* revert silently */ }
  }

  const deleteConv = async () => {
    setConfirmDeleteConv(false)
    if (!activeId) return
    const id = activeId
    setActiveId(null)
    setMessages([])
    // Revert the row to an empty (synthetic) state so the user stays listed.
    setConversations(prev => prev.map(c => (
      String(c._id) === String(id)
        ? { ...c, _id: null, lastMessageBody: '', lastMessageAt: null, lastSenderRole: null, adminUnread: 0, userUnread: 0, hasConversation: false }
        : c
    )))
    try {
      await deleteSupportConversation(id)
    } catch {
      getSupportConversations().then(res => setConversations(res.data?.data || [])).catch(() => {})
    }
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  // Open the composer for the active conversation with the default template.
  const openEmail = () => {
    setEmailMode('single')
    setEmailSubject(DEFAULT_EMAIL_SUBJECT)
    setEmailBody(DEFAULT_EMAIL_BODY)
    setEmailStatus(null)
    setEmailOpen(true)
  }

  // Open the composer for the users checked in the list.
  const openBulkEmail = () => {
    if (selected.size === 0) return
    setEmailMode('bulk')
    setEmailSubject(DEFAULT_EMAIL_SUBJECT)
    setEmailBody(DEFAULT_EMAIL_BODY)
    setEmailStatus(null)
    setEmailOpen(true)
  }

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }
  const clearSelected = () => setSelected(new Set())

  const sendEmail = async () => {
    const body = emailBody.trim()
    if (!body || emailSending) return
    const subject = emailSubject.trim() || DEFAULT_EMAIL_SUBJECT
    setEmailSending(true)
    setEmailStatus(null)
    try {
      if (emailMode === 'bulk') {
        const ids = [...selected]
        if (!ids.length) { setEmailSending(false); return }
        const res = await sendSupportBulkEmail({ userIds: ids, subject, body })
        const { sent = [], failed = [] } = res.data?.data || {}
        setEmailStatus({
          ok: failed.length === 0,
          msg: failed.length === 0
            ? `Email sent to ${sent.length} user${sent.length !== 1 ? 's' : ''}.`
            : `Sent ${sent.length}, failed ${failed.length}.`,
        })
        if (failed.length === 0) {
          clearSelected()
          setTimeout(() => setEmailOpen(false), 1200)
        }
      } else {
        if (!activeId) { setEmailSending(false); return }
        await sendSupportEmail(activeId, { subject, body })
        setEmailStatus({ ok: true, msg: `Email sent to ${activeConv?.email || 'user'}.` })
        setTimeout(() => setEmailOpen(false), 1200)
      }
    } catch (err) {
      setEmailStatus({ ok: false, msg: err?.response?.data?.message || 'Failed to send email.' })
    } finally {
      setEmailSending(false)
    }
  }

  const counts = useMemo(() => {
    const c = { all: 0, individual: 0, airline: 0 }
    for (const conv of conversations) {
      if (conv.adminUnread > 0) {
        c.all += 1
        c[conv.role] = (c[conv.role] || 0) + 1
      }
    }
    return c
  }, [conversations])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return conversations
      .filter(c => tab === 'all' || c.role === tab)
      .filter(c => !q || `${c.name} ${c.email}`.toLowerCase().includes(q))
  }, [conversations, tab, search])

  const activeConv = conversations.find(c => String(c._id) === String(activeId))

  const selectedEmails = useMemo(
    () => conversations.filter(c => selected.has(c.user)).map(c => c.email).filter(Boolean),
    [conversations, selected]
  )

  const TabBtn = ({ id, label }) => (
    <button
      onClick={() => setTab(id)}
      className={`relative flex-1 px-3 py-2 text-xs font-bold rounded-lg transition ${
        tab === id
          ? 'bg-white text-slate-900 shadow-2xs'
          : 'text-slate-500 hover:text-slate-900'
      }`}
    >
      {label}
      {counts[id] > 0 && (
        <span className="ml-1.5 inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full bg-slate-900 text-white text-[9px] font-bold">
          {counts[id] > 9 ? '9+' : counts[id]}
        </span>
      )}
    </button>
  )

  return (
    <div className="flex flex-col h-[calc(100vh-116px)] sm:h-[calc(100vh-156px)] overflow-hidden">
      <div className="mb-4 flex-shrink-0">
        <div className="inline-block">
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">Support</h1>
          <div className="h-0.5 w-full bg-emerald-500 rounded-full mt-1.5 mb-2" />
        </div>
        <p className="text-sm font-medium text-slate-500">Live chat with airlines and individuals.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] xl:grid-cols-[360px_1fr] gap-4 flex-1 min-h-0">
        {/* ── List column ── */}
        <div className={`flex flex-col rounded-2xl border border-slate-200/90 bg-white overflow-hidden shadow-sm ${activeId ? 'hidden lg:flex' : 'flex'}`}>
          <div className="p-3.5 border-b border-slate-100 space-y-3">
            <div className="flex gap-1 bg-slate-100/80 rounded-xl p-1">
              <TabBtn id="all" label="All" />
              <TabBtn id="individual" label="Individuals" />
              <TabBtn id="airline" label="Airlines" />
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by name or email…"
                className="w-full rounded-xl border border-slate-200 bg-slate-50/50 pl-9 pr-3 py-2 text-sm outline-none focus:border-slate-900 focus:bg-white focus:ring-2 focus:ring-slate-100 transition h-[38px]"
              />
            </div>
          </div>
          {selected.size > 0 && (
            <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 bg-slate-900 text-white">
              <span className="text-xs font-bold">{selected.size} selected</span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={openBulkEmail}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-white text-slate-900 hover:bg-slate-100 transition shadow-2xs"
                >
                  <Mail className="w-3.5 h-3.5" />
                  Send mail
                </button>
                <button onClick={clearSelected} className="px-2 py-1.5 text-xs font-semibold text-white/70 hover:text-white transition">Clear</button>
              </div>
            </div>
          )}
          <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
            {loadingList && (
              <div className="flex justify-center py-12"><div className="w-6 h-6 rounded-full border-2 border-slate-200 border-t-slate-800 animate-spin" /></div>
            )}
            {!loadingList && filtered.length === 0 && (
              <p className="text-center text-sm text-slate-400 py-12">No users found.</p>
            )}
            {filtered.map(c => {
              const active = c._id && String(c._id) === String(activeId)
              const checked = selected.has(c.user)
              return (
                <div
                  key={c.user}
                  className={`flex items-center border-b border-slate-100/80 transition ${
                    active ? 'bg-slate-100/90' : checked ? 'bg-emerald-50/50' : 'hover:bg-slate-50/70'
                  }`}
                >
                  <label
                    className="pl-3.5 pr-1 self-stretch flex items-center cursor-pointer"
                    title="Select for email"
                    onClick={e => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSelect(c.user)}
                      className="w-4 h-4 rounded border-slate-300 accent-slate-900 cursor-pointer"
                    />
                  </label>
                  <button
                    onClick={() => openConversation(c)}
                    className="flex-1 min-w-0 text-left pl-2.5 pr-3.5 py-3 flex items-center gap-3"
                  >
                    <Avatar name={c.name} logoUrl={c.logoUrl} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <p className="text-sm font-bold text-slate-900 truncate">{c.name || 'Unknown'}</p>
                        <span className="text-[11px] font-medium text-slate-400 flex-shrink-0">{fmtTime(c.lastMessageAt)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs text-slate-500 truncate flex-1 min-w-0">
                          {c.lastSenderRole === 'admin' && <span className="font-semibold text-slate-700">You: </span>}
                          {c.lastMessageBody || 'No messages yet'}
                        </p>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {tab === 'all' && (
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                              c.role === 'airline'
                                ? 'bg-slate-100 text-slate-700 border border-slate-200/80'
                                : 'bg-emerald-50 text-emerald-700 border border-emerald-200/60'
                            }`}>
                              {c.role === 'airline' ? 'Airline' : 'Individual'}
                            </span>
                          )}
                          {c.adminUnread > 0 && (
                            <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-slate-900 text-white text-[10px] leading-[18px] font-bold text-center">
                              {c.adminUnread > 9 ? '9+' : c.adminUnread}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                </div>
              )
            })}
          </div>
        </div>

        {/* ── Thread column ── */}
        <div className={`relative flex-col rounded-2xl border border-slate-200/90 bg-white overflow-hidden shadow-sm ${activeId ? 'flex' : 'hidden lg:flex'}`}>
          {!activeConv ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
              <div className="w-12 h-12 rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center mb-3">
                <MessageSquare className="w-6 h-6 text-slate-400" />
              </div>
              <p className="text-sm font-bold text-slate-900">Select a conversation</p>
              <p className="text-xs text-slate-500 mt-1">Choose someone from the list to start replying.</p>
            </div>
          ) : (
            <>
              {/* Thread header */}
              <div className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-200/80 bg-white">
                <button onClick={() => setActiveId(null)} className="lg:hidden w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center flex-shrink-0">
                  <ChevronLeft className="w-4 h-4 text-slate-600" />
                </button>
                <Avatar name={activeConv.name} logoUrl={activeConv.logoUrl} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-slate-900 truncate">{activeConv.name}</p>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                      activeConv.role === 'airline'
                        ? 'bg-slate-100 text-slate-700 border border-slate-200/80'
                        : 'bg-emerald-50 text-emerald-700 border border-emerald-200/60'
                    }`}>
                      {activeConv.role === 'airline' ? 'Airline' : 'Individual'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 truncate mt-0.5">{activeConv.email || 'No email'}</p>
                </div>
                {/* Send custom email to this user */}
                <button
                  onClick={() => openEmail()}
                  className="inline-flex items-center justify-center w-8 h-8 rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition shadow-2xs"
                  title="Send email to user"
                >
                  <Mail className="w-3.5 h-3.5" />
                </button>
                {/* Delete entire conversation */}
                <button
                  onClick={() => setConfirmDeleteConv(true)}
                  className="inline-flex items-center justify-center w-8 h-8 rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition shadow-2xs"
                  title="Delete conversation"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Confirm delete conversation modal */}
              {confirmDeleteConv && (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/30 p-4">
                  <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full border border-slate-200">
                    <p className="text-base font-bold text-slate-900 mb-1">Delete conversation?</p>
                    <p className="text-xs text-slate-500 mb-5 leading-relaxed">Permanently removes this conversation and all messages for both admin and the user. Cannot be undone.</p>
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => setConfirmDeleteConv(false)} className="px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 border border-slate-200 rounded-xl transition">Cancel</button>
                      <button onClick={deleteConv} className="px-4 py-2 text-xs font-bold bg-red-600 hover:bg-red-700 text-white rounded-xl transition shadow-sm">Delete</button>
                    </div>
                  </div>
                </div>
              )}

              {/* Messages */}
              <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-slate-50/60" style={{ scrollbarWidth: 'thin' }}>
                {loadingThread && (
                  <div className="flex justify-center py-8"><div className="w-6 h-6 rounded-full border-2 border-slate-200 border-t-slate-800 animate-spin" /></div>
                )}
                {!loadingThread && messages.map((m, i) => {
                  const mine = m.senderRole === 'admin'
                  const isEditing = editingId === m._id
                  const showSep = i === 0 || dayKey(m.createdAt) !== dayKey(messages[i - 1].createdAt)
                  return (
                    <div key={m._id}>
                    {showSep && (
                      <div className="flex items-center gap-3 my-3">
                        <div className="flex-1 h-px bg-slate-200" />
                        <span className="text-[11px] font-semibold text-slate-400 px-2 uppercase tracking-wider">{fmtDateSep(m.createdAt)}</span>
                        <div className="flex-1 h-px bg-slate-200" />
                      </div>
                    )}
                    <div className={`flex group items-end gap-1.5 ${mine ? 'justify-end' : 'justify-start'}`}>
                      {/* User message action: delete only */}
                      {!mine && !isEditing && (
                        <button
                          onClick={() => deleteMsg(m._id)}
                          className="opacity-0 group-hover:opacity-100 transition w-7 h-7 rounded-lg border border-slate-200 bg-white hover:bg-red-50 hover:text-red-500 hover:border-red-200 flex items-center justify-center flex-shrink-0 mb-1 shadow-2xs"
                          title="Delete message"
                        >
                          <Trash2 className="w-3 h-3 text-slate-400 hover:text-red-500" />
                        </button>
                      )}
                      {mine && !isEditing && (
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition mb-1">
                          <button
                            onClick={() => { setEditingId(m._id); setEditText(m.body) }}
                            className="w-7 h-7 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 flex items-center justify-center flex-shrink-0 shadow-2xs"
                            title="Edit message"
                          >
                            <Pencil className="w-3 h-3 text-slate-500" />
                          </button>
                          <button
                            onClick={() => deleteMsg(m._id)}
                            className="w-7 h-7 rounded-lg border border-slate-200 bg-white hover:bg-red-50 hover:border-red-200 flex items-center justify-center flex-shrink-0 shadow-2xs"
                            title="Delete message"
                          >
                            <Trash2 className="w-3 h-3 text-slate-400 hover:text-red-500" />
                          </button>
                        </div>
                      )}
                      <div className={`max-w-[72%] sm:max-w-[65%] rounded-2xl px-4 py-2.5 text-sm leading-snug shadow-2xs ${
                        mine ? 'bg-slate-900 text-white rounded-br-sm' : 'bg-white text-slate-800 border border-slate-200/90 rounded-bl-sm'
                      }`}>
                        {isEditing ? (
                          <div className="space-y-2 min-w-[200px]">
                            <textarea
                              value={editText}
                              onChange={e => setEditText(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(m._id) } if (e.key === 'Escape') { setEditingId(null) } }}
                              rows={2}
                              autoFocus
                              className="w-full resize-none rounded-lg bg-white/10 border border-white/20 text-white placeholder-white/40 px-2.5 py-1.5 text-sm outline-none"
                            />
                            <div className="flex gap-1.5 justify-end">
                              <button onClick={() => setEditingId(null)} className="px-2.5 py-1 text-[11px] font-semibold rounded text-white/60 hover:text-white transition">Cancel</button>
                              <button onClick={() => saveEdit(m._id)} className="px-2.5 py-1 text-[11px] font-bold rounded bg-white/20 hover:bg-white/30 text-white transition">Save</button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <p className="whitespace-pre-wrap break-words">{m.body?.trim().replace(/\n{3,}/g, '\n\n')}</p>
                            <p className={`text-[10px] mt-1.5 flex items-center gap-1 ${mine ? 'text-slate-400' : 'text-slate-400'}`}>
                              {fmtTime(m.createdAt)}
                              {m.edited && <span className="italic">(edited)</span>}
                            </p>
                          </>
                        )}
                      </div>
                    </div>
                    </div>
                  )
                })}
                {userTyping && (
                  <div className="flex justify-start">
                    <div className="bg-white border border-slate-200 rounded-2xl rounded-bl-sm px-3.5 py-2.5 shadow-2xs">
                      <div className="flex gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Composer */}
              <div className="border-t border-slate-200/80 p-3 bg-white">
                <div className="flex items-end gap-2">
                  <textarea
                    value={text}
                    onChange={handleChange}
                    onKeyDown={onKeyDown}
                    rows={1}
                    placeholder="Type your reply…"
                    className="flex-1 resize-none max-h-28 sm:max-h-32 rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-slate-900 focus:bg-white focus:ring-2 focus:ring-slate-100 transition"
                  />
                  <button
                    onClick={send}
                    disabled={!text.trim() || sending}
                    className="w-10 h-10 flex-shrink-0 rounded-xl bg-slate-900 text-white flex items-center justify-center transition hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed shadow-sm"
                    title="Send message"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Email composer modal (page-level, works for single + bulk) */}
      {emailOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md border border-slate-200">
            <div className="flex items-start justify-between mb-4">
              <div className="min-w-0">
                <p className="text-base font-black text-slate-900">Send Email</p>
                {emailMode === 'bulk' ? (
                  <p className="text-xs text-slate-500 mt-0.5">To: <span className="font-semibold text-slate-700">{selectedEmails.length} recipient{selectedEmails.length !== 1 ? 's' : ''}</span>{selectedEmails.length > 0 && <span className="block text-[11px] text-slate-400 truncate mt-0.5">{selectedEmails.join(', ')}</span>}</p>
                ) : (
                  <p className="text-xs text-slate-500 mt-0.5 truncate">To: <span className="font-semibold text-slate-700">{activeConv?.email || '—'}</span></p>
                )}
              </div>
              <button onClick={() => setEmailOpen(false)} className="w-8 h-8 rounded-xl border border-slate-200 hover:bg-slate-50 flex items-center justify-center text-slate-400 hover:text-slate-700 transition">
                <X className="w-4 h-4" />
              </button>
            </div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">Subject</label>
            <input
              value={emailSubject}
              onChange={e => setEmailSubject(e.target.value)}
              placeholder="Subject"
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-100 transition mb-3.5"
            />
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">Message</label>
            <textarea
              value={emailBody}
              onChange={e => setEmailBody(e.target.value)}
              rows={6}
              placeholder="Write your message…"
              className="w-full resize-none rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-100 transition"
            />
            {emailStatus && (
              <p className={`text-xs mt-2 font-semibold ${emailStatus.ok ? 'text-emerald-600' : 'text-red-500'}`}>{emailStatus.msg}</p>
            )}
            <div className="flex gap-2 justify-end mt-5">
              <button onClick={() => setEmailOpen(false)} className="px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 border border-slate-200 rounded-xl transition">Cancel</button>
              <button
                onClick={sendEmail}
                disabled={!emailBody.trim() || emailSending}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-bold bg-slate-900 hover:bg-slate-800 text-white rounded-xl transition disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
              >
                {emailSending ? 'Sending…' : 'Send Email'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
