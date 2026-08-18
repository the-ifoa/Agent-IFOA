/**
 * supportService.js
 *
 * Shared logic for the human ↔ admin live-chat. Used by BOTH the REST controller
 * (supportController.js) and the Socket.IO handlers (socket/supportSocket.js) so
 * persistence + real-time fan-out never diverge.
 *
 * Real-time fan-out (when an `io` instance is passed):
 *   - support:message       → new message  (to the conversation's user + all admins)
 *   - support:conversation  → updated conversation summary (list reorder + unread badges)
 */
const SupportConversation = require('../models/SupportConversation');
const SupportMessage      = require('../models/SupportMessage');
const User                = require('../models/User');
const Airlines            = require('../models/Airlines');
const { sendAdminSupportMessageNotification } = require('./emailService');

// Minutes to wait before emailing the team again about the same conversation,
// once an alert has actually been sent. Prevents an unattended inbox from being
// paged every time the grace window below expires during a long conversation.
const ADMIN_ALERT_THROTTLE_MIN = Number(process.env.SUPPORT_ALERT_THROTTLE_MINUTES || 10);

// Seconds to wait after a user message before checking whether the admin has
// already seen it. This is what makes the alert conditional on being seen rather
// than firing unconditionally: if an admin has the conversation open, the
// frontend marks it read (support:read) within a second or two of the message
// arriving, so by the time this check runs adminUnread is back to 0 and no email
// goes out. If nobody is watching, adminUnread is still > 0 and the email fires.
const ADMIN_ALERT_GRACE_SEC = Number(process.env.SUPPORT_ALERT_GRACE_SECONDS || 60);

// One pending check per conversation. A burst of messages resets the timer
// (debounce) so a rapid back-and-forth produces one check after things go quiet,
// not one per message.
const pendingAdminAlerts = new Map();

// ── Rooms ───────────────────────────────────────────────────────────────────
const ADMIN_ROOM = 'support:admins';
const userRoom = (userId) => `support:user:${String(userId)}`;

// ── Display name for a conversation, derived from the User account ────────────
function deriveName(userDoc) {
  if (!userDoc) return 'User';
  if (userDoc.role === 'airline') {
    return (userDoc.airlineName || '').trim()
      || [userDoc.firstName, userDoc.lastName].filter(Boolean).join(' ').trim()
      || userDoc.email
      || 'Airline';
  }
  return [userDoc.firstName, userDoc.lastName].filter(Boolean).join(' ').trim()
    || userDoc.email
    || 'Individual';
}

// Trimmed summary used by the admin list + unread badges.
function summarize(conv) {
  return {
    _id:             conv._id,
    user:            conv.user,
    role:            conv.role,
    name:            conv.name,
    email:           conv.email,
    logoUrl:         conv.logoUrl || '',
    lastMessageBody: conv.lastMessageBody,
    lastMessageAt:   conv.lastMessageAt,
    lastSenderRole:  conv.lastSenderRole,
    adminUnread:     conv.adminUnread,
    userUnread:      conv.userUnread,
    updatedAt:       conv.updatedAt,
  };
}

/**
 * Get (or lazily create) the single conversation for an airline/individual user.
 */
async function getOrCreateConversation(userId) {
  let conv = await SupportConversation.findOne({ user: userId });
  if (conv) return conv;

  const userDoc = await User.findById(userId).lean();
  if (!userDoc || userDoc.role === 'admin') {
    throw Object.assign(new Error('Only airline/individual users have a support conversation.'), { status: 400 });
  }
  let logoUrl = '';
  if (userDoc.role === 'airline') {
    const airline = await Airlines.findOne({ email: userDoc.email }).select('logoUrl').lean();
    logoUrl = airline?.logoUrl || '';
  }
  conv = await SupportConversation.create({
    user:    userId,
    role:    userDoc.role,
    name:    deriveName(userDoc),
    email:   userDoc.email || '',
    logoUrl,
  });
  return conv;
}

/**
 * Admin list of conversations, optionally filtered by role, newest activity first.
 */
async function listConversations({ role } = {}) {
  const query = {};
  if (role === 'airline' || role === 'individual') query.role = role;
  const convs = await SupportConversation.find(query)
    .sort({ lastMessageAt: -1, updatedAt: -1 })
    .lean();

  // Back-fill logoUrl for airline convs that predate this field
  const missing = convs.filter(c => c.role === 'airline' && !c.logoUrl && c.email);
  if (missing.length > 0) {
    const emails = [...new Set(missing.map(c => c.email))];
    const airlines = await Airlines.find({ email: { $in: emails } }).select('email logoUrl').lean();
    const logoByEmail = {};
    for (const a of airlines) if (a.logoUrl) logoByEmail[a.email] = a.logoUrl;
    const updates = missing.filter(c => logoByEmail[c.email]);
    // Fire-and-forget saves so the response isn't delayed
    if (updates.length > 0) {
      SupportConversation.bulkWrite(updates.map(c => ({
        updateOne: { filter: { _id: c._id }, update: { $set: { logoUrl: logoByEmail[c.email] } } },
      }))).catch(() => {});
      // Patch the in-memory results so admin sees it immediately
      for (const c of convs) {
        if (c.role === 'airline' && logoByEmail[c.email]) c.logoUrl = logoByEmail[c.email];
      }
    }
  }

  return convs;
}

/**
 * Admin list of EVERY airline/individual user, merged with their conversation
 * (if one exists). Users who have never chatted appear as a synthetic row with
 * `_id: null` so the admin can still see + email them. Sorted by most recent
 * activity, then alphabetically.
 */
async function listAllUsersWithConversations({ role } = {}) {
  const wantRole = role === 'airline' || role === 'individual' ? role : null;

  const userQuery = wantRole ? { role: wantRole } : { role: { $in: ['airline', 'individual'] } };
  const [users, convs] = await Promise.all([
    User.find(userQuery).select('email role firstName lastName airlineName logoUrl').lean(),
    SupportConversation.find(wantRole ? { role: wantRole } : {}).lean(),
  ]);

  const convByUser = new Map(convs.map(c => [String(c.user), c]));

  // Airline logo backfill from the Airlines collection (covers users missing logoUrl)
  const airlineEmails = users.filter(u => u.role === 'airline' && !u.logoUrl && u.email).map(u => u.email);
  const logoByEmail = {};
  if (airlineEmails.length) {
    const airlines = await Airlines.find({ email: { $in: [...new Set(airlineEmails)] } }).select('email logoUrl').lean();
    for (const a of airlines) if (a.logoUrl) logoByEmail[a.email] = a.logoUrl;
  }

  const rows = users.map(u => {
    const conv = convByUser.get(String(u._id));
    const logoUrl = (conv && conv.logoUrl) || u.logoUrl || logoByEmail[u.email] || '';
    if (conv) {
      return { ...summarize(conv), logoUrl, hasConversation: true };
    }
    return {
      _id:             null,
      user:            u._id,
      role:            u.role,
      name:            deriveName(u),
      email:           u.email || '',
      logoUrl,
      lastMessageBody: '',
      lastMessageAt:   null,
      lastSenderRole:  null,
      adminUnread:     0,
      userUnread:      0,
      hasConversation: false,
    };
  });

  rows.sort((a, b) => {
    const ta = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
    const tb = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
    if (tb !== ta) return tb - ta;
    return (a.name || '').localeCompare(b.name || '');
  });

  return rows;
}

/**
 * Messages for a conversation, oldest → newest.
 */
async function getMessages(conversationId, { limit = 500 } = {}) {
  return SupportMessage.find({ conversation: conversationId })
    .sort({ createdAt: 1 })
    .limit(limit)
    .lean();
}

/**
 * Persist a message, update the conversation preview + unread counter, and
 * (if io given) fan out in real time.
 */
async function createMessage({ conversation, senderRole, senderId, senderName, body, io }) {
  const text = String(body || '').trim();
  if (!text) throw Object.assign(new Error('Message body is required.'), { status: 400 });

  const message = await SupportMessage.create({
    conversation: conversation._id,
    senderRole,
    senderId,
    senderName,
    body: text,
  });

  conversation.lastMessageBody = text.slice(0, 200);
  conversation.lastMessageAt   = message.createdAt;
  conversation.lastSenderRole  = senderRole;
  if (senderRole === 'user') conversation.adminUnread += 1;
  else                       conversation.userUnread  += 1;
  await conversation.save();

  if (io) {
    const payload = { conversationId: String(conversation._id), message: message.toObject() };
    io.to(userRoom(conversation.user)).emit('support:message', payload);
    io.to(ADMIN_ROOM).emit('support:message', payload);
    const summary = summarize(conversation);
    io.to(userRoom(conversation.user)).emit('support:conversation', summary);
    io.to(ADMIN_ROOM).emit('support:conversation', summary);
  }

  // Alert the IFOA team when an airline/individual writes in — but only if
  // nobody notices. Scheduling (rather than sending immediately) is what lets us
  // check "did the admin see this" instead of mailing unconditionally on every
  // message. Admin replies never trigger an alert. Fire-and-forget by design: a
  // mail failure must never fail the message itself.
  if (senderRole === 'user') {
    scheduleAdminAlert(conversation._id);
  }

  return { conversation, message };
}

/**
 * Debounce a "check whether the admin has seen this conversation" pass.
 *
 * A burst of messages resets the timer, so only ONE check runs — after the
 * conversation goes quiet for ADMIN_ALERT_GRACE_SEC — rather than one per message.
 */
function scheduleAdminAlert(conversationId) {
  const key = String(conversationId);
  const existing = pendingAdminAlerts.get(key);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    pendingAdminAlerts.delete(key);
    checkAndNotifyAdmin(conversationId).catch((e) =>
      console.warn('[support] Admin alert check failed:', e.message),
    );
  }, ADMIN_ALERT_GRACE_SEC * 1000);
  // unref: a pending alert timer must never keep the Node process alive on its own
  // (e.g. during tests or a graceful shutdown).
  timer.unref?.();
  pendingAdminAlerts.set(key, timer);
}

/**
 * Send the "new support message" alert to the IFOA team — but only if the admin
 * has NOT already seen it, and only if the last alert wasn't too recent.
 *
 * "Seen" = conversation.adminUnread is back to 0. The admin frontend marks a
 * conversation read the moment a message arrives for one it has open
 * (support:read, emitted within ~1s), so if the admin was actually watching,
 * adminUnread will already be 0 by the time this grace-period check runs and no
 * email is sent. If nobody was watching, adminUnread is still > 0 and it fires.
 *
 * ADMIN_ALERT_THROTTLE_MIN then prevents a long-unseen conversation from paging
 * the team again on every subsequent grace-period check.
 */
async function checkAndNotifyAdmin(conversationId) {
  const conversation = await SupportConversation.findById(conversationId);
  if (!conversation) return;

  // Seen — the admin read it during the grace window. No mail needed.
  if (conversation.adminUnread === 0) return;

  const last = conversation.lastAdminNotifiedAt ? new Date(conversation.lastAdminNotifiedAt).getTime() : 0;
  const throttleMs = ADMIN_ALERT_THROTTLE_MIN * 60 * 1000;
  if (last && Date.now() - last < throttleMs) return;

  // Stamp first so two concurrent checks can't both pass the guard above.
  conversation.lastAdminNotifiedAt = new Date();
  await conversation.save();

  await sendAdminSupportMessageNotification({
    name:        conversation.name,
    email:       conversation.email,
    role:        conversation.role,
    body:        conversation.lastMessageBody,
    sentAt:      conversation.lastMessageAt,
    unreadCount: conversation.adminUnread,
  });
}

/** @deprecated kept for any external caller; delegates to the seen-aware check. */
async function notifyAdminOfUserMessage(conversation) {
  return checkAndNotifyAdmin(conversation._id);
}

/**
 * Mark a conversation read for one side and clear its unread counter.
 */
async function markRead({ conversation, readerRole, io }) {
  if (readerRole === 'admin') conversation.adminUnread = 0;
  else                        conversation.userUnread  = 0;
  await conversation.save();

  if (io) {
    const summary = summarize(conversation);
    io.to(userRoom(conversation.user)).emit('support:conversation', summary);
    io.to(ADMIN_ROOM).emit('support:conversation', summary);
  }
  return conversation;
}

module.exports = {
  ADMIN_ROOM,
  userRoom,
  summarize,
  deriveName,
  getOrCreateConversation,
  listConversations,
  listAllUsersWithConversations,
  getMessages,
  createMessage,
  markRead,
  notifyAdminOfUserMessage,
  scheduleAdminAlert,
  checkAndNotifyAdmin,
};
