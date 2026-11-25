#!/usr/bin/env node
/**
 * Change a user's password directly in the DB.
 *
 * Usage:
 *   node scripts/change-password.js <email> <newPassword> [--must-change]
 *
 * Examples:
 *   node scripts/change-password.js vincent@theifoa.com 'NewPass123!'
 *   node scripts/change-password.js vincent@theifoa.com 'NewPass123!' --must-change
 *
 * Reads MONGO_URI from env (loads backend/.env.production if present, else .env).
 */

const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Load env: prefer .env.production, fall back to .env
const prodEnv = path.resolve(__dirname, '../.env.production');
const defEnv = path.resolve(__dirname, '../.env');
require('dotenv').config({ path: fs.existsSync(prodEnv) ? prodEnv : defEnv });

async function main() {
  const [, , email, newPassword, ...flags] = process.argv;

  if (!email || !newPassword) {
    console.error('Usage: node scripts/change-password.js <email> <newPassword> [--must-change]');
    process.exit(1);
  }

  const mustChange = flags.includes('--must-change');
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGO_URI not set in env.');
    process.exit(1);
  }

  await mongoose.connect(uri);

  const hash = await bcrypt.hash(newPassword, 12);

  const res = await mongoose.connection.db.collection('users').updateOne(
    { email },
    { $set: { password: hash, mustChangePassword: mustChange, updatedAt: new Date() } }
  );

  if (res.matchedCount === 0) {
    console.error(`No user found with email: ${email}`);
    process.exitCode = 2;
  } else {
    console.log(`Password updated for ${email}`);
    console.log(`  mustChangePassword = ${mustChange}`);
    console.log(`  new hash = ${hash}`);
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
