/**
 * Express Server Configuration for BVOX Finance
 * Uses MongoDB for data persistence
 * This is the recommended way to run the application
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

// Initialize MongoDB connection
const { connectDB, mongoose } = require('./config/db');

// Import API routes
const apiRoutes = require('./config/apiRoutes');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Serve static files
app.use(express.static(path.join(__dirname, '/')));

// API Routes
app.use('/', apiRoutes);

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date(),
        database: mongoose ? 'connected' : 'disconnected'
    });
});

// 404 handler
app.use((req, res) => {
    if (!req.path.startsWith('/api/')) {
        // Serve index.html for non-API routes (SPA fallback)
        res.sendFile(path.join(__dirname, 'index.html'));
    } else {
        res.status(404).json({ error: 'Not Found' });
    }
});

// Error handler
app.use((err, req, res, next) => {
    console.error('[Error]', err);
    res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});

// Connect to database and start server
async function start() {
    try {
        // Connect to database first
        const db = await connectDB();
        if (!db) {
            console.warn('⚠️  Connected without database - falling back to JSON');
        } else {
            console.log('✅ Database connection established');
        }
        
        // Warn if DB exists but arbitrage products are missing
        try {
            const ArbitrageProduct = require('./models/ArbitrageProduct');
            const count = await ArbitrageProduct.countDocuments();
            if (count === 0) {
                console.warn('\n⚠️  No arbitrage products found in the database.');
                console.warn('   To seed default products from JSON, run: node scripts/migrate-json-to-db.js\n');
            }
        } catch (e) {
            console.warn('[seed-check] Could not verify arbitrage products:', e.message);
        }
        
        app.listen(PORT, () => {
            console.log(`\n🚀 BVOX Finance Server Started`);
            console.log(`📡 Server running at http://localhost:${PORT}`);
            console.log(`📊 API Documentation: http://localhost:${PORT}/api/health`);
            console.log(`\n✅ Database: Connected`);
            console.log(`\n📝 Available Endpoints:`);
            console.log(`   GET    /api/users/:userId`);
            console.log(`   GET    /api/topup/:userId`);
            console.log(`   POST   /api/topup`);
            console.log(`   GET    /api/withdrawal/:userId`);
            console.log(`   POST   /api/withdrawal`);
            console.log(`   GET    /api/exchange/:userId`);
            console.log(`   POST   /api/exchange`);
            console.log(`   GET    /api/trade/:userId`);
            console.log(`   POST   /api/trade`);
            console.log(`   GET    /api/mining/:userId`);
            console.log(`   POST   /api/mining`);
            console.log(`   GET    /api/loan/:userId`);
            console.log(`   POST   /api/loan`);
            console.log(`   GET    /api/wallet/:userId`);
            console.log(`   POST   /api/wallet`);
            console.log(`   GET    /api/kyc/:userId`);
            console.log(`   POST   /api/kyc`);
            console.log(`   GET    /api/arbitrage/products`);
            console.log(`   POST   /api/arbitrage/subscribe`);
            console.log(`   GET    /api/arbitrage/:userId`);
            console.log(`   GET    /api/notification/:userId`);
            console.log(`   POST   /api/notification`);
            console.log();
        });
        // Auto-settle mining rewards worker
        const ENABLE_AUTO_MINING_SETTLE = process.env.ENABLE_AUTO_MINING_SETTLE !== 'false';
        if (ENABLE_AUTO_MINING_SETTLE) {
            const settleIntervalMs = Number(process.env.MINING_SETTLE_INTERVAL_MS) || (60 * 60 * 1000); // default hourly
            console.log(`[auto-settle] Mining auto-settle enabled. Interval: ${settleIntervalMs}ms`);

            const mongoose = require('mongoose');
            const Mining = require('./models/Mining');
            const User = require('./models/User');

            async function settleDueMiningOnce() {
                try {
                    const now = new Date();
                    const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
                    const dueRecords = await Mining.find({ status: 'active', $or: [ { last_claim: { $exists: false } }, { last_claim: { $lte: cutoff } }, { last_claim: null } ] }).lean();
                    if (!dueRecords || dueRecords.length === 0) return console.log('[auto-settle] No due mining records found');
                    console.log(`[auto-settle] Found ${dueRecords.length} due mining records`);

                    let processed = 0;
                    for (const m of dueRecords) {
                        try {
                            const staked = Number(m.amount || m.stakedAmount || 0);
                            const dailyRate = Number(m.daily_reward || m.dailyYield || 0);
                            if (!staked || !dailyRate) continue;
                            const reward = Number(staked * dailyRate);
                            const userId = m.user_id || m.userid || m.user || m.userId;
                            if (!userId) continue;

                            const user = await User.findOneAndUpdate(
                                { $or: [{ userid: userId }, { uid: userId }, { id: userId }] },
                                { $inc: { ['balances.eth']: reward }, $set: { updated_at: new Date() } },
                                { new: true }
                            );
                            if (!user) {
                                console.warn('[auto-settle] User not found for mining record', m._id || m.id);
                                continue;
                            }

                            await Mining.updateOne({ _id: m._id }, { $inc: { total_earned: reward }, $set: { last_claim: new Date(), updated_at: new Date() } });
                            processed++;
                        } catch (innerE) {
                            console.warn('[auto-settle] error processing record', m._id || m.id, innerE && innerE.message);
                        }
                    }
                    console.log(`[auto-settle] Completed. Processed ${processed}/${dueRecords.length}`);
                } catch (e) {
                    console.error('[auto-settle] failed:', e && e.message);
                }
            }

            // Run once on startup (defer a few seconds to let app settle)
            setTimeout(() => { settleDueMiningOnce(); }, 5000);

            // Schedule periodic runs
            setInterval(() => { settleDueMiningOnce(); }, settleIntervalMs);
            // Note: arbitrage auto-settle is run independently (see below)
        }

        // Arbitrage auto-settle worker (independent from mining flag)
        const ENABLE_AUTO_ARB_SETTLE = process.env.ENABLE_AUTO_ARB_SETTLE !== 'false';
        if (ENABLE_AUTO_ARB_SETTLE) {
            const arbSettleIntervalMs = Number(process.env.ARB_SETTLE_INTERVAL_MS) || Number(process.env.MINING_SETTLE_INTERVAL_MS) || (60 * 60 * 1000);
            console.log(`[auto-settle] Arbitrage auto-settle enabled. Interval: ${arbSettleIntervalMs}ms`);
            const ArbitrageSubscription = require('./models/ArbitrageSubscription');
            const User = require('./models/User');
            const Topup = require('./models/Topup');

            async function settleDueArbitrageOnce() {
                try {
                    const now = new Date();
                    const due = await ArbitrageSubscription.find({ status: 'active', end_date: { $lte: now } });
                    if (!due || due.length === 0) return console.log('[auto-settle] No due arbitrage subscriptions');
                    console.log(`[auto-settle] Found ${due.length} due arbitrage subscriptions`);
                    let count = 0;
                    for (const sub of due) {
                        try {
                            const amount = Number(sub.amount || 0);
                            const durationDays = sub.end_date && sub.start_date ? Math.max(1, Math.round((new Date(sub.end_date) - new Date(sub.start_date)) / (24*60*60*1000))) : (sub.duration_days || 1);
                            const dailyReturn = typeof sub.daily_return === 'number' && sub.daily_return>0 ? sub.daily_return : ((Number(sub.daily_return_min||0)+Number(sub.daily_return_max||0))/2);
                            const totalReturnPercent = Number((dailyReturn * durationDays).toFixed(4));
                            const totalIncome = Number(((amount * totalReturnPercent) / 100).toFixed(4));

                            const user = await User.findOne({ $or: [{ userid: sub.user_id }, { id: sub.user_id }, { uid: sub.user_id }] });
                            if (!user) { console.warn('[auto-settle] user not found for sub', sub._id); continue; }
                            user.balances = user.balances || {};
                            const credit = Number((amount + totalIncome).toFixed(4));
                            user.balances.usdt = Math.round(((Number(user.balances.usdt||0) + credit)) * 100) / 100;
                            user.markModified('balances');
                            await user.save();

                            sub.status = 'completed';
                            sub.earned = totalIncome;
                            sub.days_completed = durationDays;
                            sub.total_income = totalIncome;
                            sub.total_return_percent = totalReturnPercent;
                            sub.updated_at = new Date();
                            await sub.save();

                            try { await Topup.create({ id: `topup_${Date.now()}_${Math.random().toString(36).slice(2,8)}`, user_id: sub.user_id, coin: 'USDT', amount: credit, status: 'complete', timestamp: Date.now(), created_at: new Date() }); } catch(e){console.warn('[auto-settle] topup error', e && e.message)}
                            count++;
                        } catch (innerE) { console.error('[auto-settle] error processing sub', sub._id, innerE && innerE.message); }
                    }
                    console.log(`[auto-settle] Completed arbitrage settle. Processed ${count}/${due.length}`);
                } catch (e) { console.error('[auto-settle] arbitrage failed:', e && e.message); }
            }

            setTimeout(() => { settleDueArbitrageOnce(); }, 8000);
            setInterval(() => { settleDueArbitrageOnce(); }, arbSettleIntervalMs);
        }
    } catch (error) {
        console.error('❌ Failed to start server:', error.message);
        process.exit(1);
    }
}

start();
