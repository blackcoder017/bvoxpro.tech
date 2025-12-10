const mongoose = require('mongoose');

const tradeSchema = new mongoose.Schema({
  id: { type: String, index: true },
  user_id: { type: String, index: true },
  userid: { type: String },
  username: { type: String },
  biming: { type: String },
  fangxiang: { type: mongoose.Schema.Types.Mixed }, // Accept number or string, normalized at runtime
  miaoshu: { type: [Number, String] },
  num: { type: Number },
  buyprice: { type: Number },
  syl: { type: Number },
  zengjia: { type: Number },
  jianshao: { type: Number },
  
  // Modern fields (optional)
  pair: { type: String },
  type: { type: String, enum: ['buy', 'sell', 'long', 'short'] },
  entry_price: { type: Number },
  exit_price: { type: Number },
  amount: { type: Number },
  leverage: { type: Number, default: 1 },
  pnl: { type: Number, default: 0 },
  entry_time: { type: Date },
  exit_time: { type: Date },
  timestamp: { type: Number },
  
  // Trade status
  status: { type: String, default: 'pending' },
  forcedOutcome: { type: String },
  settlement_applied: { type: Boolean, default: false },
  
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.models.Trade || mongoose.model('Trade', tradeSchema);
