#!/usr/bin/env node
/**
 * verifyProfileSettings.js
 *
 * Profile + Security & Settings audit. Mounts the REAL auth routes and auth
 * middleware on an ephemeral Express server and drives them over HTTP, against
 * a throw-away database (dropped at start and end).
 *
 *   auth gate      : no token / bad token / mustChangePassword gating
 *   update-profile : happy paths, partial updates, trimming, unicode,
 *                    every malformed-type input (the original 500), length cap,
 *                    mass-assignment attempts, deleted account
 *   airline name   : airline only, validation, trimming
 *   credentials    : password + email change, collisions, secondary promotion,
 *                    invalid formats, wrong password, login before/after
 *   secondary email: add / remove (direct + OTP flow), conflicts, normalising,
 *                    OTP wrong / reused / expired, login via secondary
 *   credential OTP : send + verify flow, wrong / reused / expired code
 *   robustness     : malformed JSON, nothing ever answers 500
 *
 * Usage:  node scripts/verifyProfileSettings.js
 */
process.env.JWT_SECRET = 'x'.repeat(24);
process.env.SKIP_OTP = 'false';            // exercise the real OTP checks
const TEST_URI = process.env.TEST_MONGO_URI || 'mongodb://127.0.0.1:27017/ifoa_profile_test';
require('dotenv').config();
// SAFETY: never run against real data — this script drops the database it uses.
if (process.env.MONGO_URI && process.env.MONGO_URI.trim() === TEST_URI.trim()) {
  console.error('Refusing to run: the scratch database matches MONGO_URI.');
  process.exit(2);
}

const emailService = require('../services/emailService');
for (const fn of Object.keys(emailService)) {
  if (typeof emailService[fn] === 'function' && /^send/.test(fn)) emailService[fn] = async () => {};
}

const express  = require('express');
const mongoose = require('mongoose');
const jwt      = require('jsonwebtoken');
const User     = require('../models/User');
const OTP      = require('../models/OTP');

let pass = 0, fail = 0;
const failures = [];
const ok = (c, l, e = '') => {
  if (c) { pass++; console.log(`  PASS  ${l}`); }
  else   { fail++; failures.push(l); console.log(`  FAIL  ${l} ${e}`); }
};
const H = (t) => console.log(`\n${'─'.repeat(76)}\n${t}\n${'─'.repeat(76)}`);

let BASE;
let saw500 = [];
async function call(method, path, { token, body, raw } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${BASE}${path}`, {
    method, headers,
    body: raw !== undefined ? raw : (body === undefined ? undefined : JSON.stringify(body)),
  });
  let json = null;
  try { json = await r.json(); } catch { /* empty */ }
  if (r.status >= 500) saw500.push(`${method} ${path} ${JSON.stringify(body ?? raw)}`);
  return { status: r.status, body: json };
}
const put  = (p, o) => call('PUT', p, o);
const post = (p, o) => call('POST', p, o);
const del  = (p, o) => call('DELETE', p, o);

const PW = 'Password123!';
async function mkUser(fields) {
  const u = new User({ password: PW, firstName: 'Orig', lastName: 'Name', ...fields });
  await u.save();
  return u;
}
const tokenFor = (u, extra = {}) => jwt.sign(
  { id: u._id, email: u.email, role: u.role, mustChangePassword: false, ...extra },
  process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
const fresh = (id) => User.findById(id).lean();
const latestOtp = (email, purpose) => OTP.findOne({ email, purpose, used: false }).sort({ createdAt: -1 }).lean();

(async () => {
  await mongoose.connect(TEST_URI);
  await mongoose.connection.db.dropDatabase();
  await User.init(); await OTP.init();

  const app = express();
  app.use(express.json());
  app.use('/api/auth', require('../routes/authRoutes'));
  // same shape as server.js global handler
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => res.status(err.status || err.statusCode || 500).json({ message: err.message }));
  const server = app.listen(0);
  BASE = `http://127.0.0.1:${server.address().port}/api/auth`;

  const indiv   = await mkUser({ email: 'indiv@test.com',   role: 'individual' });
  const airline = await mkUser({ email: 'air@test.com',     role: 'airline', airlineName: 'Old Air', secondaryEmails: ['alias@test.com'] });
  const other   = await mkUser({ email: 'other@test.com',   role: 'airline', secondaryEmails: ['taken2@test.com'] });
  const admin   = await mkUser({ email: 'admin@test.com',   role: 'admin' });
  const tI = tokenFor(indiv), tA = tokenFor(airline), tAd = tokenFor(admin);

  // ───────────────────────────────────────────────────────────────────────────
  H('Auth gate');
  ok((await put('/update-profile', { body: { firstName: 'X' } })).status === 401, 'no token -> 401');
  ok((await put('/update-profile', { token: 'garbage', body: { firstName: 'X' } })).status === 401, 'malformed token -> 401');
  const wrongSecret = jwt.sign({ id: indiv._id, role: 'individual' }, 'y'.repeat(24), { algorithm: 'HS256' });
  ok((await put('/update-profile', { token: wrongSecret, body: { firstName: 'X' } })).status === 401, 'token signed with wrong secret -> 401');
  const expired = jwt.sign({ id: indiv._id, role: 'individual', exp: Math.floor(Date.now() / 1000) - 10 }, process.env.JWT_SECRET, { algorithm: 'HS256' });
  ok((await put('/update-profile', { token: expired, body: { firstName: 'X' } })).status === 401, 'expired token -> 401');
  const tMust = tokenFor(indiv, { mustChangePassword: true });
  ok((await put('/update-profile', { token: tMust, body: { firstName: 'X' } })).status === 403, 'mustChangePassword: update-profile blocked (403)');
  ok((await put('/update-credentials', { token: tMust, body: {} })).status === 400, 'mustChangePassword: update-credentials still reachable');
  ok((await fresh(indiv._id)).firstName === 'Orig', 'blocked requests changed nothing');

  // ───────────────────────────────────────────────────────────────────────────
  H('update-profile — happy paths');
  let r = await put('/update-profile', { token: tI, body: { firstName: 'Nairs', lastName: 'Nair' } });
  ok(r.status === 200, 'both names -> 200', JSON.stringify(r.body));
  let db = await fresh(indiv._id);
  ok(db.firstName === 'Nairs' && db.lastName === 'Nair', 'DB updated with both names');
  ok(r.body?.user?.firstName === 'Nairs' && r.body?.user?.lastName === 'Nair', 'response user reflects new names');
  ok(r.body?.user && !('password' in r.body.user), 'response never leaks password hash');
  const dec = jwt.verify(r.body.token, process.env.JWT_SECRET);
  ok(String(dec.id) === String(indiv._id) && dec.role === 'individual', 'fresh token issued for same user/role');

  r = await put('/update-profile', { token: tI, body: { firstName: 'OnlyFirst' } });
  db = await fresh(indiv._id);
  ok(r.status === 200 && db.firstName === 'OnlyFirst' && db.lastName === 'Nair', 'only firstName -> lastName untouched');
  r = await put('/update-profile', { token: tI, body: { lastName: 'OnlyLast' } });
  db = await fresh(indiv._id);
  ok(r.status === 200 && db.firstName === 'OnlyFirst' && db.lastName === 'OnlyLast', 'only lastName -> firstName untouched');
  r = await put('/update-profile', { token: tI, body: { firstName: '  Padded  ', lastName: '\tTabbed\n' } });
  db = await fresh(indiv._id);
  ok(r.status === 200 && db.firstName === 'Padded' && db.lastName === 'Tabbed', 'surrounding whitespace trimmed');
  r = await put('/update-profile', { token: tI, body: { firstName: 'José', lastName: "O'Brien-Nair 李" } });
  db = await fresh(indiv._id);
  ok(r.status === 200 && db.firstName === 'José' && db.lastName === "O'Brien-Nair 李", 'unicode / apostrophe / hyphen preserved');
  r = await put('/update-profile', { token: tI, body: { firstName: 'Keep', lastName: '' } });
  db = await fresh(indiv._id);
  ok(r.status === 200 && db.firstName === 'Keep' && db.lastName === '', 'clearing last name allowed when first name given');
  r = await put('/update-profile', { token: tI, body: { firstName: 'Keep', lastName: 'Same' } });
  r = await put('/update-profile', { token: tI, body: { firstName: 'Keep', lastName: 'Same' } });
  ok(r.status === 200, 'saving unchanged values is idempotent');
  r = await put('/update-profile', { token: tI, body: { firstName: 'A'.repeat(100) } });
  ok(r.status === 200, 'name at 100-char limit accepted');
  r = await put('/update-profile', { token: tA, body: { firstName: 'Air', lastName: 'Person' } });
  ok(r.status === 200 && (await fresh(airline._id)).firstName === 'Air', 'airline account can update names');
  r = await put('/update-profile', { token: tAd, body: { firstName: 'Ad', lastName: 'Min' } });
  ok(r.status === 200 && (await fresh(admin._id)).lastName === 'Min', 'admin account can update names');

  H('update-profile — rejected input (never 500)');
  await put('/update-profile', { token: tI, body: { firstName: 'Stable', lastName: 'Stable' } });
  const badProfile = [
    [{},                                                     'empty body'],
    [{ firstName: '', lastName: '' },                        'both empty strings'],
    [{ firstName: '   ', lastName: '\t' },                   'whitespace only'],
    [{ firstName: { firstName: 'A', lastName: 'B' } },       'object as firstName (original bug)'],
    [{ firstName: 'A', lastName: { x: 1 } },                 'object as lastName'],
    [{ firstName: 123 },                                     'number firstName'],
    [{ firstName: ['A'] },                                   'array firstName'],
    [{ firstName: true },                                    'boolean firstName'],
    [{ firstName: null, lastName: null },                    'nulls'],
    [{ firstName: 'A'.repeat(101) },                         '101-char firstName'],
    [{ firstName: 'Ok', lastName: 'B'.repeat(500) },         '500-char lastName'],
  ];
  for (const [body, label] of badProfile) {
    r = await put('/update-profile', { token: tI, body });
    ok(r.status === 400 && typeof r.body?.message === 'string', `${label} -> 400`, `got ${r.status}`);
  }
  db = await fresh(indiv._id);
  ok(db.firstName === 'Stable' && db.lastName === 'Stable', 'rejected requests left names unchanged');

  H('update-profile — mass assignment');
  r = await put('/update-profile', { token: tI, body: {
    firstName: 'Mass', role: 'admin', email: 'hijack@test.com', password: 'x', mustChangePassword: true,
    airlineName: 'X', secondaryEmails: ['a@b.co'], registrationId: new mongoose.Types.ObjectId() } });
  db = await fresh(indiv._id);
  ok(r.status === 200 && db.firstName === 'Mass', 'request with extra fields still updates name');
  ok(db.role === 'individual' && db.email === 'indiv@test.com' && !db.mustChangePassword &&
     !db.airlineName && (db.secondaryEmails || []).length === 0 && !db.registrationId,
     'role/email/password/flags/registration NOT changeable via update-profile');
  ok(await (await User.findById(indiv._id)).comparePassword(PW), 'password unchanged');

  H('update-profile — account gone');
  const ghost = await mkUser({ email: 'ghost@test.com', role: 'individual' });
  const tG = tokenFor(ghost);
  await User.deleteOne({ _id: ghost._id });
  ok((await put('/update-profile', { token: tG, body: { firstName: 'X' } })).status === 404, 'deleted account -> 404');
  ok((await User.countDocuments({ email: 'ghost@test.com' })) === 0, 'no account re-created');

  // ───────────────────────────────────────────────────────────────────────────
  H('update-airline-name');
  r = await put('/update-airline-name', { token: tA, body: { airlineName: '  New Air  ' } });
  ok(r.status === 200 && (await fresh(airline._id)).airlineName === 'New Air' && r.body.user.airlineName === 'New Air', 'airline renames company (trimmed)');
  ok((await put('/update-airline-name', { token: tI, body: { airlineName: 'X' } })).status === 403, 'individual -> 403');
  ok((await put('/update-airline-name', { token: tAd, body: { airlineName: 'X' } })).status === 403, 'admin -> 403');
  for (const [body, label] of [[{}, 'missing'], [{ airlineName: '' }, 'empty'], [{ airlineName: '   ' }, 'whitespace'],
    [{ airlineName: { a: 1 } }, 'object'], [{ airlineName: 5 }, 'number'], [{ airlineName: 'Z'.repeat(201) }, '201 chars']]) {
    r = await put('/update-airline-name', { token: tA, body });
    ok(r.status === 400, `airline name ${label} -> 400`, `got ${r.status}`);
  }
  ok((await fresh(airline._id)).airlineName === 'New Air', 'rejected airline-name requests left value unchanged');
  ok((await put('/update-airline-name', { token: tG, body: { airlineName: 'X' } })).status === 404, 'deleted account -> 404');

  // ───────────────────────────────────────────────────────────────────────────
  H('update-credentials (direct)');
  const cred = await mkUser({ email: 'cred@test.com', role: 'individual', secondaryEmails: ['credalias@test.com'] });
  const tC = tokenFor(cred);
  const badCred = [
    [{},                                                            400, 'no current password'],
    [{ currentPassword: 'wrong', newPassword: 'NewPass123' },       401, 'wrong current password'],
    [{ currentPassword: PW },                                       400, 'nothing to change'],
    [{ currentPassword: { $ne: 1 }, newPassword: 'NewPass123' },    400, 'object currentPassword (injection shape)'],
    [{ currentPassword: 12345678, newPassword: 'NewPass123' },      400, 'number currentPassword'],
    [{ currentPassword: PW, newPassword: 'short' },                 400, 'new password < 8 chars'],
    [{ currentPassword: PW, newPassword: 12345678 },                400, 'number newPassword'],
    [{ currentPassword: PW, newPassword: ['a'.repeat(9)] },         400, 'array newPassword'],
    [{ currentPassword: PW, newEmail: 'not-an-email' },             400, 'invalid email format'],
    [{ currentPassword: PW, newEmail: 'a b@test.com' },             400, 'email with space'],
    [{ currentPassword: PW, newEmail: { a: 1 } },                   400, 'object newEmail'],
    [{ currentPassword: PW, newEmail: 'OTHER@test.com' },           409, 'email taken by other primary (case-insensitive)'],
    [{ currentPassword: PW, newEmail: 'taken2@test.com' },          409, "email taken as other account's secondary"],
  ];
  for (const [body, code, label] of badCred) {
    r = await put('/update-credentials', { token: tC, body });
    ok(r.status === code, `${label} -> ${code}`, `got ${r.status} ${JSON.stringify(r.body)}`);
  }
  db = await fresh(cred._id);
  ok(db.email === 'cred@test.com' && await (await User.findById(cred._id)).comparePassword(PW), 'rejected requests changed nothing');

  r = await put('/update-credentials', { token: tC, body: { currentPassword: PW, newEmail: 'cred@test.com' } });
  ok(r.status === 200 && (await fresh(cred._id)).email === 'cred@test.com', 'same email as current -> 200, no change');

  r = await put('/update-credentials', { token: tC, body: { currentPassword: PW, newPassword: 'NewPass123' } });
  ok(r.status === 200, 'password change -> 200', JSON.stringify(r.body));
  ok((await post('/login', { body: { email: 'cred@test.com', password: PW } })).status === 401, 'old password no longer logs in');
  ok((await post('/login', { body: { email: 'cred@test.com', password: 'NewPass123' } })).status === 200, 'new password logs in');
  ok((await put('/update-credentials', { token: tC, body: { currentPassword: PW, newPassword: 'Another123' } })).status === 401,
     'old password rejected as currentPassword afterwards');

  r = await put('/update-credentials', { token: tC, body: { currentPassword: 'NewPass123', newEmail: '  Cred.New@Test.COM ' } });
  db = await fresh(cred._id);
  ok(r.status === 200 && db.email === 'cred.new@test.com' && r.body.user.email === 'cred.new@test.com', 'email change normalised (trim + lowercase)');
  ok(jwt.verify(r.body.token, process.env.JWT_SECRET).email === 'cred.new@test.com', 'new token carries new email');
  ok((await post('/login', { body: { email: 'cred@test.com', password: 'NewPass123' } })).status === 401, 'old email no longer logs in');
  ok((await post('/login', { body: { email: 'CRED.NEW@test.com ', password: 'NewPass123' } })).status === 200, 'new email logs in (case/space-insensitive)');

  r = await put('/update-credentials', { token: tC, body: { currentPassword: 'NewPass123', newEmail: 'credalias@test.com' } });
  db = await fresh(cred._id);
  ok(r.status === 200 && db.email === 'credalias@test.com' && !db.secondaryEmails.includes('credalias@test.com'),
     'promoting own secondary email to primary removes it from secondaries');

  r = await put('/update-credentials', { token: tC, body: { currentPassword: 'NewPass123', newEmail: 'both@test.com', newPassword: 'BothPass123' } });
  ok(r.status === 200 && (await post('/login', { body: { email: 'both@test.com', password: 'BothPass123' } })).status === 200,
     'email + password changed together');

  const must = await mkUser({ email: 'must@test.com', role: 'individual', mustChangePassword: true });
  r = await put('/update-credentials', { token: tokenFor(must, { mustChangePassword: true }), body: { currentPassword: PW, newPassword: 'Fresh12345' } });
  ok(r.status === 200 && (await fresh(must._id)).mustChangePassword === false && r.body.user.mustChangePassword === false,
     'forced password change clears mustChangePassword');
  ok(jwt.verify(r.body.token, process.env.JWT_SECRET).mustChangePassword === false, 'new token no longer gated');
  ok((await put('/update-credentials', { token: tG, body: { currentPassword: PW, newPassword: 'NewPass123' } })).status === 404, 'deleted account -> 404');

  // ───────────────────────────────────────────────────────────────────────────
  H('Secondary emails (direct add / remove)');
  const badAdd = [
    [tI, { currentPassword: PW, secondaryEmail: 'x@test.com' },       403, 'individual cannot add'],
    [tA, { secondaryEmail: 'x@test.com' },                            400, 'missing password'],
    [tA, { currentPassword: PW, secondaryEmail: 'bad' },              400, 'invalid email'],
    [tA, { currentPassword: PW, secondaryEmail: { a: 1 } },           400, 'object email'],
    [tA, { currentPassword: { a: 1 }, secondaryEmail: 'x@test.com' }, 400, 'object password'],
    [tA, { currentPassword: 'wrong', secondaryEmail: 'x@test.com' },  401, 'wrong password'],
    [tA, { currentPassword: PW, secondaryEmail: 'AIR@test.com' },     400, 'own primary (case-insensitive)'],
    [tA, { currentPassword: PW, secondaryEmail: 'alias@test.com' },   409, 'already own secondary'],
    [tA, { currentPassword: PW, secondaryEmail: 'other@test.com' },   409, "other account's primary"],
    [tA, { currentPassword: PW, secondaryEmail: 'taken2@test.com' },  409, "other account's secondary"],
  ];
  for (const [tok, body, code, label] of badAdd) {
    r = await post('/add-secondary-email', { token: tok, body });
    ok(r.status === code, `add: ${label} -> ${code}`, `got ${r.status}`);
  }
  r = await post('/add-secondary-email', { token: tA, body: { currentPassword: PW, secondaryEmail: ' Ops@Test.com ' } });
  db = await fresh(airline._id);
  ok(r.status === 200 && db.secondaryEmails.includes('ops@test.com'), 'add: valid -> stored normalised');
  ok((await post('/login', { body: { email: 'ops@test.com', password: PW } })).status === 200, 'login via new secondary email works');
  ok((await post('/add-secondary-email', { token: tA, body: { currentPassword: PW, secondaryEmail: 'ops@test.com' } })).status === 409, 'add: duplicate -> 409');

  const badRemove = [
    [tI, { currentPassword: PW, secondaryEmail: 'ops@test.com' },     403, 'individual cannot remove'],
    [tA, { currentPassword: PW },                                     400, 'missing email'],
    [tA, { secondaryEmail: 'ops@test.com' },                          400, 'missing password'],
    [tA, { currentPassword: PW, secondaryEmail: { a: 1 } },           400, 'object email'],
    [tA, { currentPassword: 'wrong', secondaryEmail: 'ops@test.com' },401, 'wrong password'],
    [tA, { currentPassword: PW, secondaryEmail: 'nope@test.com' },    404, 'not on account'],
    [tA, { currentPassword: PW, secondaryEmail: 'taken2@test.com' },  404, "other account's secondary"],
  ];
  for (const [tok, body, code, label] of badRemove) {
    r = await del('/remove-secondary-email', { token: tok, body });
    ok(r.status === code, `remove: ${label} -> ${code}`, `got ${r.status}`);
  }
  ok((await fresh(other._id)).secondaryEmails.includes('taken2@test.com'), "other account's secondary untouched");
  r = await del('/remove-secondary-email', { token: tA, body: { currentPassword: PW, secondaryEmail: 'OPS@test.com' } });
  ok(r.status === 200 && !(await fresh(airline._id)).secondaryEmails.includes('ops@test.com'), 'remove: valid (case-insensitive) -> removed');
  ok((await post('/login', { body: { email: 'ops@test.com', password: PW } })).status === 401, 'removed secondary can no longer log in');

  // ───────────────────────────────────────────────────────────────────────────
  H('Secondary emails (OTP flow — what the Settings page uses)');
  ok((await post('/send-secondary-email-otp', { token: tI, body: { secondaryEmail: 'n@test.com' } })).status === 403, 'send: individual -> 403');
  ok((await post('/send-secondary-email-otp', { token: tA, body: { secondaryEmail: 'bad' } })).status === 400, 'send: invalid email -> 400');
  ok((await post('/send-secondary-email-otp', { token: tA, body: { secondaryEmail: { a: 1 } } })).status === 400, 'send: object email -> 400');
  ok((await post('/send-secondary-email-otp', { token: tA, body: { secondaryEmail: 'air@test.com' } })).status === 400, 'send: own primary -> 400');
  ok((await post('/send-secondary-email-otp', { token: tA, body: { secondaryEmail: 'alias@test.com' } })).status === 409, 'send: own secondary -> 409');
  ok((await post('/send-secondary-email-otp', { token: tA, body: { secondaryEmail: 'other@test.com' } })).status === 409, 'send: taken -> 409');

  r = await post('/send-secondary-email-otp', { token: tA, body: { secondaryEmail: 'New@Test.com' } });
  let otp = await latestOtp('new@test.com', 'secondary-email');
  ok(r.status === 200 && otp && /^\d{6}$/.test(otp.code), 'send: valid -> 6-digit code stored');
  const wrongCode = otp.code === '000000' ? '111111' : '000000';
  ok((await post('/verify-secondary-email', { token: tA, body: { secondaryEmail: 'new@test.com', code: otp.code } })).status === 400, 'verify: missing password -> 400');
  ok((await post('/verify-secondary-email', { token: tA, body: { secondaryEmail: 'new@test.com', code: wrongCode, currentPassword: PW } })).status === 400, 'verify: wrong code -> 400');
  ok((await post('/verify-secondary-email', { token: tA, body: { secondaryEmail: 'new@test.com', code: otp.code, currentPassword: 'wrong' } })).status === 401, 'verify: wrong password -> 401');
  ok((await post('/verify-secondary-email', { token: tA, body: { secondaryEmail: { a: 1 }, code: otp.code, currentPassword: PW } })).status === 400, 'verify: object email -> 400');
  ok((await post('/verify-secondary-email', { token: tA, body: { secondaryEmail: 'new@test.com', code: { $ne: 'x' }, currentPassword: PW } })).status === 400, 'verify: object code (injection shape) -> 400');
  ok(!(await fresh(airline._id)).secondaryEmails.includes('new@test.com'), 'failed verifications did not add email');
  r = await post('/verify-secondary-email', { token: tA, body: { secondaryEmail: 'new@test.com', code: ` ${otp.code.slice(0, 3)} ${otp.code.slice(3)} `, currentPassword: PW } });
  ok(r.status === 200 && (await fresh(airline._id)).secondaryEmails.includes('new@test.com'), 'verify: correct code (with spaces) -> added');
  ok(r.body?.user?.secondaryEmails?.includes('new@test.com'), 'verify: response user lists new secondary');
  ok((await OTP.findById(otp._id)).used === true, 'OTP marked used');
  r = await post('/verify-secondary-email', { token: tA, body: { secondaryEmail: 'new@test.com', code: otp.code, currentPassword: PW } });
  ok(r.status === 400 || r.status === 409, 'verify: reused code rejected', `got ${r.status}`);

  await post('/send-secondary-email-otp', { token: tA, body: { secondaryEmail: 'late@test.com' } });
  otp = await latestOtp('late@test.com', 'secondary-email');
  await OTP.updateOne({ _id: otp._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  ok((await post('/verify-secondary-email', { token: tA, body: { secondaryEmail: 'late@test.com', code: otp.code, currentPassword: PW } })).status === 400, 'verify: expired code -> 400');

  await post('/send-secondary-email-otp', { token: tA, body: { secondaryEmail: 'resend@test.com' } });
  const first = await latestOtp('resend@test.com', 'secondary-email');
  await post('/send-secondary-email-otp', { token: tA, body: { secondaryEmail: 'resend@test.com' } });
  const second = await latestOtp('resend@test.com', 'secondary-email');
  ok((await OTP.countDocuments({ email: 'resend@test.com', used: false })) === 1, 'resend invalidates previous code');
  if (first.code !== second.code) {
    ok((await post('/verify-secondary-email', { token: tA, body: { secondaryEmail: 'resend@test.com', code: first.code, currentPassword: PW } })).status === 400, 'old code after resend -> 400');
  }

  await post('/send-secondary-email-otp', { token: tA, body: { secondaryEmail: 'race@test.com' } });
  otp = await latestOtp('race@test.com', 'secondary-email');
  await User.updateOne({ _id: other._id }, { $addToSet: { secondaryEmails: 'race@test.com' } });
  ok((await post('/verify-secondary-email', { token: tA, body: { secondaryEmail: 'race@test.com', code: otp.code, currentPassword: PW } })).status === 409,
     'verify: email claimed by another account after code sent -> 409');

  // ───────────────────────────────────────────────────────────────────────────
  H('Credential change via OTP');
  const oc = await mkUser({ email: 'otpcred@test.com', role: 'airline' });
  const tO = tokenFor(oc);
  ok((await post('/send-credential-change-otp', { token: tO, body: {} })).status === 400, 'send: missing password -> 400');
  ok((await post('/send-credential-change-otp', { token: tO, body: { currentPassword: { a: 1 } } })).status === 400, 'send: object password -> 400');
  ok((await post('/send-credential-change-otp', { token: tO, body: { currentPassword: 'wrong' } })).status === 401, 'send: wrong password -> 401');
  r = await post('/send-credential-change-otp', { token: tO, body: { currentPassword: PW } });
  otp = await latestOtp('otpcred@test.com', 'credential-change');
  ok(r.status === 200 && otp, 'send: valid -> code stored for current email');
  const V = '/verify-otp-and-update-credentials';
  const badV = [
    [{ currentPassword: PW, newPassword: 'OtpPass123' },                          400, 'missing otp'],
    [{ currentPassword: PW, otp: otp.code },                                       400, 'nothing to change'],
    [{ currentPassword: 'wrong', otp: otp.code, newPassword: 'OtpPass123' },       401, 'wrong password'],
    [{ currentPassword: PW, otp: wrongCode, newPassword: 'OtpPass123' },           400, 'wrong code'],
    [{ currentPassword: PW, otp: { $ne: 1 }, newPassword: 'OtpPass123' },          400, 'object otp'],
    [{ currentPassword: PW, otp: otp.code, newPassword: 'short' },                 400, 'short password'],
    [{ currentPassword: PW, otp: otp.code, newPassword: 12345678 },                400, 'number password'],
    [{ currentPassword: PW, otp: otp.code, newEmail: 'bad' },                      400, 'invalid email'],
    [{ currentPassword: PW, otp: otp.code, newEmail: 'other@test.com' },           409, 'taken email'],
  ];
  for (const [body, code, label] of badV) {
    r = await post(V, { token: tO, body });
    ok(r.status === code, `verify: ${label} -> ${code}`, `got ${r.status}`);
  }
  ok((await OTP.findById(otp._id)).used === false, 'rejected attempts did not burn the code');
  r = await post(V, { token: tO, body: { currentPassword: PW, otp: otp.code, newEmail: 'otpnew@test.com', newPassword: 'OtpPass123' } });
  ok(r.status === 200 && (await post('/login', { body: { email: 'otpnew@test.com', password: 'OtpPass123' } })).status === 200, 'verify: valid -> email + password changed');
  ok((await post(V, { token: tO, body: { currentPassword: 'OtpPass123', otp: otp.code, newPassword: 'Again12345' } })).status === 400, 'verify: reused code -> 400');
  await post('/send-credential-change-otp', { token: tO, body: { currentPassword: 'OtpPass123' } });
  otp = await latestOtp('otpnew@test.com', 'credential-change');
  await OTP.updateOne({ _id: otp._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  ok((await post(V, { token: tO, body: { currentPassword: 'OtpPass123', otp: otp.code, newPassword: 'Again12345' } })).status === 400, 'verify: expired code -> 400');

  // ───────────────────────────────────────────────────────────────────────────
  H('Login + robustness');
  ok((await post('/login', { body: { email: { $ne: 1 }, password: PW } })).status === 400, 'login: object email -> 400 (no 500 / no injection)');
  ok((await post('/login', { body: { email: 'air@test.com', password: { $ne: 1 } } })).status === 400, 'login: object password -> 400');
  ok((await post('/login', { body: { email: 'nobody@test.com', password: PW } })).status === 401, 'login: unknown email -> 401');
  r = await call('PUT', '/update-profile', { token: tI, raw: '{"firstName": "broken' });
  ok(r.status === 400, 'malformed JSON body -> 400', `got ${r.status}`);
  r = await call('PUT', '/update-profile', { token: tI, raw: '"just a string"' });
  ok(r.status === 400, 'non-object JSON body -> 400', `got ${r.status}`);
  const concurrent = await Promise.all(['A1', 'B2', 'C3', 'D4', 'E5'].map(n =>
    put('/update-profile', { token: tI, body: { firstName: n, lastName: n } })));
  db = await fresh(indiv._id);
  ok(concurrent.every(x => x.status === 200) && db.firstName === db.lastName, 'concurrent saves all succeed, final state consistent');

  ok(saw500.length === 0, 'no request in the whole run returned 5xx', '\n        ' + saw500.join('\n        '));

  // ───────────────────────────────────────────────────────────────────────────
  server.close();
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
  console.log(`\n${'═'.repeat(76)}\n${pass} passed, ${fail} failed`);
  if (fail) console.log('Failed:\n  - ' + failures.join('\n  - '));
  process.exit(fail ? 1 : 0);
})().catch(async (e) => {
  console.error('CRASH', e);
  try { await mongoose.connection.db.dropDatabase(); await mongoose.disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
