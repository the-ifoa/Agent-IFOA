#!/usr/bin/env node
/**
 * verifyEmailLinks.js
 *
 * Renders the REAL email templates (MJML included) and inspects what they produce:
 * that every dashboard link is built from FRONTEND_URL rather than a hardcoded
 * host, that subject lines agree with their bodies, and that admin alerts go to
 * the configured recipient list.
 *
 * nodemailer is intercepted; nothing is transmitted. Needs no database.
 *
 * Usage:  node scripts/verifyEmailLinks.js
 */
process.env.FRONTEND_URL = 'https://agent.theifoa.com';
process.env.ADMIN_NOTIFY_EMAIL = 'ops@example.com';
process.env.SMTP_HOST = 'smtp.example.com';
process.env.SMTP_PORT = '587';
process.env.SMTP_USER = 'u';
process.env.SMTP_PASS = 'p';

// Intercept nodemailer so sendMail() captures instead of transmitting.
const nodemailer = require('nodemailer');
const captured = [];
nodemailer.createTransport = () => ({
  sendMail: async (opts) => { captured.push(opts); return { messageId: 'stub' }; },
  verify:   async () => true,
});

const email = require('../services/emailService');

let pass = 0, fail = 0;
const ok = (c, l, e='') => { if (c) { pass++; console.log(`  PASS  ${l}`); } else { fail++; console.log(`  FAIL  ${l} ${e}`); } };
const H = (t) => console.log(`\n${'─'.repeat(76)}\n${t}\n${'─'.repeat(76)}`);

const linksIn = (html) => [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1]);

(async () => {
  const airlineDoc = {
    _id: 'a1', airlineName: 'Test Air', firstName: 'Al', lastName: 'Pilot',
    email: 'air@ex.com', subscriptionPlan: '1 Year Subscription Plan',
    committedCount: 4, pricePerCertificate: 60, expirationDate: new Date(),
    subscriptionDate: new Date(), wireRequestPurpose: 'convert-unlimited',
    wirePaymentRequestedAt: new Date(),
    wireRequestDetails: { baseCount: 4, unlimitedPpc: 265, unlimitedTotal: 1060, amount: 940, oldPlanLabel: '1 Year' },
  };

  H('1. Admin payment notification — dashboard link');
  captured.length = 0;
  await email.sendAdminPaymentNotification(airlineDoc, {
    registrationModel: 'Airlines', purpose: 'payment', amountDollars: 240,
    invoiceNumber: 'Invoice US-1-26', paymentMethod: 'wire', paidAt: new Date(),
  });
  ok(captured.length === 1, 'email produced');
  let links = linksIn(captured[0].html);
  ok(!links.some(l => /localhost/.test(l)), 'no localhost link', links.filter(l=>/localhost/.test(l)).join(','));
  ok(links.some(l => l.startsWith('https://agent.theifoa.com/admin')), 'admin link uses FRONTEND_URL',
     links.filter(l => /theifoa\.com\/admin/.test(l)).join(','));
  console.log(`     subject: ${captured[0].subject}`);

  H('2. Wire request notification — convert-unlimited branch');
  captured.length = 0;
  await email.sendWireRequestAdminNotification(airlineDoc);
  ok(captured.length === 1, 'email produced');
  const wireHtml = captured[0].html;
  ok(!/localhost/.test(wireHtml), 'no localhost anywhere in the body');
  ok(/Convert to Unlimited/.test(wireHtml), 'labelled "Convert to Unlimited" (not "Initial Registration")');
  ok(/Unused-Time Credit/.test(wireHtml), 'shows the unused-time credit row');
  ok(/\$940\.00/.test(wireHtml), 'shows the net amount requested ($940)');
  ok(/\$1,?060\.00/.test(wireHtml), 'shows the Unlimited total ($1060)');
  ok(/\[Convert to Unlimited\]/.test(captured[0].subject),
     'SUBJECT also says Convert to Unlimited (not "[Initial]")', captured[0].subject);
  ok(String(captured[0].to).includes('ops@example.com'),
     'wire alert goes to ADMIN_NOTIFY_EMAIL like every other admin alert', String(captured[0].to));
  console.log(`     subject: ${captured[0].subject}`);
  console.log(`     to: ${captured[0].to}`);

  H('3. Support message alert — support console link');
  captured.length = 0;
  await email.sendAdminSupportMessageNotification({
    name: 'Test Air', email: 'air@ex.com', role: 'airline',
    body: 'Hello, I need help', sentAt: new Date(), unreadCount: 2,
  });
  ok(captured.length === 1, 'email produced');
  links = linksIn(captured[0].html);
  ok(!links.some(l => /localhost/.test(l)), 'no localhost link');
  ok(links.some(l => l === 'https://agent.theifoa.com/admin/support'), 'links to /admin/support via FRONTEND_URL',
     links.join(','));
  console.log(`     subject: ${captured[0].subject}`);

  H('4. Expiry reminder — customer subscription link');
  captured.length = 0;
  await email.sendExpiryReminder({
    airlineName: 'Test Air', email: 'air@ex.com', firstName: 'Al', lastName: 'P',
    subscriptionPlan: '1 Year Subscription Plan', expirationDate: new Date(), committedCount: 4,
  }, true, 30);
  ok(captured.length === 1, 'email produced');
  links = linksIn(captured[0].html);
  ok(!links.some(l => /localhost/.test(l)), 'no localhost link');
  ok(links.some(l => l === 'https://agent.theifoa.com/dashboard/subscription'),
     'links to /dashboard/subscription via FRONTEND_URL', links.join(','));

  H('5. FRONTEND_URL is genuinely honoured (change it, links change)');
  process.env.FRONTEND_URL = 'https://staging.example.org';
  captured.length = 0;
  await email.sendAdminSupportMessageNotification({
    name: 'X', email: 'x@ex.com', role: 'individual', body: 'hi', sentAt: new Date(), unreadCount: 1,
  });
  links = linksIn(captured[0].html);
  ok(links.some(l => l === 'https://staging.example.org/admin/support'),
     'link follows the new FRONTEND_URL at send time', links.join(','));

  console.log(`\n${'='.repeat(76)}\n  ${pass} passed, ${fail} failed\n${'='.repeat(76)}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
