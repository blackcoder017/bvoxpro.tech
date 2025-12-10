const mongoose = require('mongoose');

const arbitrageSubscriptionSchema = new mongoose.Schema({
  id: { type: String, index: true },
  user_id: { type: String, required: true, index: true },
  product_id: { type: String, required: true },
  product_name: { type: String },
  amount: { type: Number, required: true },
  daily_return: { type: Number },
  daily_return_min: { type: Number },
  daily_return_max: { type: Number },
  total_return: { type: Number },
  total_return_percent: { type: Number },
  total_income: { type: Number, default: 0 },
  earned: { type: Number, default: 0 },
  days_completed: { type: Number, default: 0 },
  status: { type: String, default: 'active', enum: ['active', 'completed', 'cancelled'] },
  start_date: { type: Date },
  end_date: { type: Date },
  last_payout: { type: Date },
  timestamp: { type: Number },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.models.ArbitrageSubscription || mongoose.model('ArbitrageSubscription', arbitrageSubscriptionSchema);
