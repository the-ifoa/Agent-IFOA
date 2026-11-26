const express    = require('express');
const http       = require('http');
const mongoose   = require('mongoose');
const cors       = require('cors');
const dotenv     = require('dotenv');
const path       = require('path');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const { Server } = require('socket.io');

// Separate dev/prod env files: NODE_ENV=production loads .env.production,
// anything else loads .env (dev). Neither file is committed — on a real host
// (Render, etc.) env vars come from its dashboard and this is a no-op if the
// file isn't present.
dotenv.config({
  path: path.resolve(__dirname, process.env.NODE_ENV === 'production' ? '.env.production' : '.env'),
  override: true,
  quiet: true,
});

// ── Fail fast if required env vars are missing ────────────────────────────────
if (!process.env.MONGO_URI)   throw new Error('MONGO_URI env var is required');
if (!process.env.JWT_SECRET)  throw new Error('JWT_SECRET env var is required');

const app = express();

// ── Security headers (helmet) ─────────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // allow /assets images from frontend
}));

// ── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    // Requests with NO Origin header are server-to-server (Stripe webhooks,
    // health checks, curl). CORS only protects browsers — browsers always send
    // an Origin on cross-site requests — so blocking no-origin requests adds no
    // security and breaks the Stripe webhook in production.
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

// ── Rate limiting ─────────────────────────────────────────────────────────────
// Strict limit on auth endpoints to slow brute-force attacks
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 20 : 200, // stricter in prod, relaxed locally
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' },
});

// General API limit — generous enough for normal use.
// Stripe webhook is exempt: Stripe controls its own retry cadence and a burst of
// retried events must never be throttled (dropped events = unconfirmed payments).
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' },
  skip: (req) => req.path === '/payments/webhook',
});

app.use('/api/auth', authLimiter);
app.use('/api',      apiLimiter);

// ── Serve backend assets (logo, etc.) publicly ───────────────────────────────
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// ── Stripe webhook needs raw body — must be registered BEFORE express.json() ──
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));

// ── JSON body parser ──────────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
// Express 5 leaves req.body undefined when a request has no parsable body
// (Express 4 gave {}). Many handlers destructure req.body on body-less
// PATCH/POST/DELETE calls, so restore the old default.
app.use((req, _res, next) => { if (req.body === undefined) req.body = {}; next(); });

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/pricing',       require('./routes/pricingRoutes'));
app.use('/api/auth',          require('./routes/authRoutes'));
app.use('/api/individuals',   require('./routes/individualRoutes'));
app.use('/api/airlines',      require('./routes/airlinesRoutes'));
app.use('/api/payments',      require('./routes/paymentRoutes'));
app.use('/api/notifications', require('./routes/notificationsRoutes'));
app.use('/api/chat',          require('./routes/chatRoutes'));
app.use('/api/support',       require('./routes/supportRoutes'));
app.use('/api/register',      require('./routes/registerRoute'));
app.use('/api/invoices',      require('./routes/invoiceRoutes'));

// Health check
app.get('/', (_req, res) => res.json({ message: 'Agent for Service API is running' }));

// ── Global error handler ──────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[GlobalError]', err.message, err.stack);
  const status = err.status || err.statusCode || 500;
  // Never leak stack traces to clients in production
  const message = process.env.NODE_ENV === 'production' && status === 500
    ? 'Internal server error'
    : (err.message || 'Internal server error');
  res.status(status).json({ success: false, message });
});

// ── HTTP server + Socket.IO (real-time support chat) ──────────────────────────
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  },
});
// Expose io to controllers via req.app.get('io') for real-time fan-out.
app.set('io', io);
require('./socket/supportSocket').initSupportSocket(io);

// ── Database + Server ─────────────────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 })
  .then(() => {
    console.log('MongoDB connected');

    // ── Invoice store: one-time repair on boot ────────────────────────────────
    // 1. Materialise any invoice number that still exists only as a legacy
    //    Payment/Renewal/registration reference into a real Invoice document, so
    //    every reader can query one collection and see identical data.
    // 2. Rebuild the per-year sequence allocator from what the database actually
    //    holds, recovering gaps (deleted invoices) for reuse.
    // Both are idempotent and cheap; failure is logged but never blocks startup.
    (async () => {
      try {
        const invoiceStore = require('./services/invoiceStore');
        const { reconcileInvoiceSequences } = require('./services/invoiceNumberService');
        // dedupe: false — the boot path is additive only. Collapsing duplicate
        // invoices deletes documents, so it stays an explicit operator action:
        //   node scripts/reconcileInvoices.js
        const backfill = await invoiceStore.backfillLegacyInvoices({ dedupe: false });
        // Clears mirror pointers left dangling by an interrupted flow, which would
        // otherwise keep their invoice numbers permanently out of circulation.
        const stale    = await invoiceStore.clearStaleMirrors();
        const counter  = await reconcileInvoiceSequences();
        console.log(
          `[invoices] backfilled ${backfill.created} legacy invoice(s), ` +
          `left ${backfill.skippedHidden} previously-deleted alone, ` +
          `cleared ${stale.cleared} stale pointer(s); ` +
          `sequence high-water ${counter.sequence}, ${counter.released.length} number(s) free for reuse`,
        );
      } catch (e) {
        console.error('[invoices] boot reconcile failed:', e.message);
      }
    })();

    const { startSubscriptionReminderCron } = require('./cron/subscriptionReminder');
    startSubscriptionReminderCron();
    const PORT = process.env.PORT || 5000;
    server.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });
