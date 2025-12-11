const db = require('../config/db');
const User = require('../models/User');

(async () => {
  try {
    await db.connectDB();
    const userData = {
      userid: '1000001',
      uid: '1000001',
      username: 'test_user_1000001',
      balance: 1000,
      balances: { usdt: 1000 },
      wallet_address: '0xtestaddress',
      total_invested: 0,
      total_income: 0,
      role: 'user',
      status: 'active'
    };

    const existing = await User.findOne({ userid: userData.userid });
    if (existing) {
      console.log('User already exists:', existing.userid);
      process.exit(0);
    }

    const u = new User(userData);
    await u.save();
    console.log('Created test user:', u.userid);
    process.exit(0);
  } catch (e) {
    console.error('Error creating test user:', e && e.message);
    process.exit(1);
  }
})();