const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

async function main() {
  const orderId = process.argv[2];
  if (!orderId) {
    console.error('Usage: node scripts/apply_reward_now.js <orderId>');
    process.exit(1);
  }

  const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/bvox-finance';
  await mongoose.connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true });
  console.log('Connected to MongoDB', mongoURI);

  // Use a flexible schema for the mining collection
  const Mining = mongoose.model('Mining', new mongoose.Schema({}, { strict: false }), 'minings');

  const mining = await Mining.findById(orderId);
  if (!mining) {
    console.error('Mining order not found:', orderId);
    await mongoose.disconnect();
    process.exit(2);
  }

  // Determine staked amount and daily yield
  const staked = Number(mining.stakedAmount || mining.amount || mining.stake || 0);
  const dailyYield = Number(mining.dailyYield || 0);
  if (!staked || !dailyYield) {
    console.error('Missing staked amount or dailyYield on mining record. staked=', staked, 'dailyYield=', dailyYield);
    await mongoose.disconnect();
    process.exit(3);
  }

  const dailyReward = staked * dailyYield;
  console.log(`Applying reward for order ${orderId}: staked=${staked}, dailyYield=${dailyYield}, dailyReward=${dailyReward}`);

  // Update users.json (legacy file-based balance)
  const usersFile = path.resolve(__dirname, '..', 'users.json');
  let users = [];
  try {
    users = JSON.parse(fs.readFileSync(usersFile, 'utf8')) || [];
  } catch (e) {
    console.error('Failed to read users.json:', e.message);
    await mongoose.disconnect();
    process.exit(4);
  }

  const userId = mining.userId || mining.userid || mining.user || mining.user_id;
  if (!userId) {
    console.error('Mining record missing userId');
    await mongoose.disconnect();
    process.exit(5);
  }

  const uidx = users.findIndex(u => String(u.userid) === String(userId) || String(u.userId) === String(userId));
  if (uidx === -1) {
    console.error('User not found in users.json for userid=', userId);
    await mongoose.disconnect();
    process.exit(6);
  }

  const user = users[uidx];
  if (!user.balances) user.balances = {};
  const prev = Number(user.balances.eth || 0);
  user.balances.eth = prev + dailyReward;
  users[uidx] = user;

  try {
    fs.writeFileSync(usersFile, JSON.stringify(users, null, 2), 'utf8');
    console.log(`Updated users.json: user ${userId} ETH balance ${prev} -> ${user.balances.eth}`);
  } catch (e) {
    console.error('Failed to write users.json:', e.message);
    await mongoose.disconnect();
    process.exit(7);
  }

  // Update mining document
  mining.totalIncome = (Number(mining.totalIncome) || 0) + dailyReward;
  mining.todayIncome = dailyReward;
  mining.lastIncomeAt = new Date();
  await mining.save();
  console.log(`Updated mining record ${orderId}: totalIncome=${mining.totalIncome}, todayIncome=${mining.todayIncome}`);

  await mongoose.disconnect();
  console.log('Done');
}

main().catch(err => { console.error(err); process.exit(99); });
