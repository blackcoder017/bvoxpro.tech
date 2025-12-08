const mongoose = require('mongoose');

// User Schema
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true },
  name: { type: String, required: true },
  passwordHash: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

// Wallet Schema
const walletSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  currency: { type: String, default: 'USD' },
  balance: { type: Number, default: 0, min: 0 },
  updatedAt: { type: Date, default: Date.now }
});
walletSchema.index({ userId: 1 });

// Coin Schema
const coinSchema = new mongoose.Schema({
  symbol: { type: String, required: true, unique: true, uppercase: true },
  name: { type: String, required: true },
  decimals: { type: Number, default: 2 },
  enabled: { type: Boolean, default: true },
  lastPrice: { type: Number, default: 0 },
  updatedAt: { type: Date, default: Date.now }
});
coinSchema.index({ symbol: 1 });

// Trade Schema
const tradeSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  coinSymbol: { type: String, required: true },
  side: { type: String, enum: ['up', 'down'], required: true },
  type: { type: String, enum: ['prediction', 'market'], default: 'prediction' },
  stake: { type: Number, required: true, min: 0.01 },
  odds: { type: Number, default: 0.9, min: 0 },
  durationSeconds: { type: Number, required: true, min: 1 },
  entryPrice: { type: Number, required: true },
  exitPrice: { type: Number, default: null },
  status: { type: String, enum: ['open', 'settling', 'settled', 'cancelled'], default: 'open' },
  result: { type: String, enum: ['win', 'lose', 'refund', null], default: null },
  payout: { type: Number, default: 0, min: 0 },
  createdAt: { type: Date, default: Date.now },
  settledAt: { type: Date, default: null }
});
tradeSchema.index({ userId: 1 });
tradeSchema.index({ status: 1 });
tradeSchema.index({ createdAt: -1 });

// Transaction Schema
const transactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['trade-stake', 'payout', 'refund', 'manual-credit'], required: true },
  amount: { type: Number, required: true },
  balanceBefore: { type: Number, required: true },
  balanceAfter: { type: Number, required: true },
  tradeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Trade', default: null },
  meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now }
});
transactionSchema.index({ userId: 1 });
transactionSchema.index({ createdAt: -1 });

// Export Models
module.exports = {
  User: mongoose.model('User', userSchema),
  Wallet: mongoose.model('Wallet', walletSchema),
  Coin: mongoose.model('Coin', coinSchema),
  Trade: mongoose.model('Trade', tradeSchema),
  Transaction: mongoose.model('Transaction', transactionSchema)
};
