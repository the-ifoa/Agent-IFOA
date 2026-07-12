'use strict';

/**
 * Usage:
 *   node scripts/deleteAccount.js
 *   node scripts/deleteAccount.js --email user@example.com
 *   node scripts/deleteAccount.js --email user@example.com --yes   (skip confirmation)
 *
 * Deletes a User account + its linked registration record (Individual /
 * Airlines / AirlinesSubscription) + any pending OTP records for the email.
 * Prompts for typed confirmation before deleting unless --yes is passed.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const readline = require('readline');
const User = require('../models/User');
const Individual = require('../models/Individual');
const Airlines = require('../models/Airlines');
const AirlinesSubscription = require('../models/AirlinesSubscription');
const OTP = require('../models/OTP');

const REGISTRATION_MODELS = { Individual, Airlines, AirlinesSubscription };

const args = process.argv.slice(2);
const get = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };
const skipConfirm = args.includes('--yes');

async function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (ans) => { rl.close(); resolve(ans.trim()); }));
}

async function main() {
  const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!MONGO_URI) {
    console.error('ERROR: MONGO_URI not set in .env');
    process.exit(1);
  }

  let email = get('--email');
  if (!email) email = await prompt('Email of account to delete: ');
  email = email.toLowerCase().trim();
  if (!email) {
    console.error('ERROR: email required');
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI);

  const user = await User.findOne({ $or: [{ email }, { secondaryEmails: email }] });
  if (!user) {
    console.error(`No account found for ${email}`);
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log('\nFound account:');
  console.log(`  _id:      ${user._id}`);
  console.log(`  email:    ${user.email}`);
  console.log(`  role:     ${user.role}`);
  console.log(`  name:     ${[user.firstName, user.lastName].filter(Boolean).join(' ') || '—'}`);
  if (user.registrationModel) {
    console.log(`  linked:   ${user.registrationModel} (${user.registrationId})`);
  }

  if (!skipConfirm) {
    const confirm = await prompt(`\nType the email address again to confirm PERMANENT deletion: `);
    if (confirm.toLowerCase().trim() !== user.email) {
      console.error('Email did not match — aborted, nothing deleted.');
      await mongoose.disconnect();
      process.exit(1);
    }
  }

  if (user.registrationModel && REGISTRATION_MODELS[user.registrationModel] && user.registrationId) {
    const Model = REGISTRATION_MODELS[user.registrationModel];
    const res = await Model.deleteOne({ _id: user.registrationId });
    console.log(`Deleted ${user.registrationModel} record: ${res.deletedCount}`);
  }

  const otpRes = await OTP.deleteMany({ email: user.email });
  console.log(`Deleted OTP records: ${otpRes.deletedCount}`);

  await User.deleteOne({ _id: user._id });
  console.log(`Deleted User: ${user.email}`);

  await mongoose.disconnect();
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
