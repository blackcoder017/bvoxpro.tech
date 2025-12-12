/**
 * API Routes for Database Operations
 * Handles all HTTP endpoints for database access
 */

const express = require('express');
const router = express.Router();
const db = require('./database');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const https = require('https');
const ethers = require('ethers');

// Use authModel for admin auth (supports DB-first, JSON fallback)
const auth = require('../authModel');

async function verifyAdminToken(req) {
    const header = req.headers['authorization'] || req.headers['Authorization'] || '';
    if (!header) return null;
    const parts = header.split(' ');
    if (parts.length !== 2) return null;
    const token = parts[1];
    // verify token signature and expiry via authModel
    const payload = auth.verifyToken(token);
    if (!payload || !payload.adminId) return null;
    // fetch admin using authModel (which will fallback to JSON file if needed)
    const admin = await auth.getAdminById(payload.adminId);
    return admin;
}

// Ensure uploads directory exists
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
try { if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true }); } catch (e) { console.warn('Could not create uploads dir:', e.message); }

// ============= PROXY ROUTES =============

// Proxy for /api/Trade/gettradlist to remote API (note: remote URL has 'e' in gettradelist)
const REMOTE_TRADE_LIST_URL = 'https://api.bvoxf.com/api/Trade/gettradelist';
router.post(['/api/Trade/gettradlist', '/api/trade/gettradlist'], (req, res) => {
    try {
        // Convert body to URL-encoded form (matching what old server.js does)
        let bodyStr = '';
        const body = req.body || {};
        if (typeof body === 'string') {
            bodyStr = body;
        } else if (typeof body === 'object') {
            // Convert JSON body to URL-encoded format: key1=value1&key2=value2
            bodyStr = Object.keys(body)
                .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(body[key])}`)
                .join('&');
        }
        
        const urlObj = new URL(REMOTE_TRADE_LIST_URL);
        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(bodyStr)
            }
        };
        const proxyReq = https.request(options, proxyRes => {
            let data = '';
            proxyRes.on('data', chunk => { data += chunk; });
            proxyRes.on('end', () => {
                // Sanitize upstream headers before forwarding to client
                const headers = Object.assign({}, proxyRes.headers || {});
                // Remove Transfer-Encoding if Content-Length is present to avoid
                // sending both headers which will cause nginx to return 502.
                if (headers['content-length'] && headers['transfer-encoding']) {
                    delete headers['transfer-encoding'];
                }
                // Ensure Content-Length matches actual body length
                try {
                    headers['content-length'] = Buffer.byteLength(data);
                } catch (e) {
                    // ignore
                }
                res.status(proxyRes.statusCode).set(headers).send(data);
            });
        });
        proxyReq.on('error', err => {
            console.error('[proxy] /api/Trade/gettradlist error:', err.message);
            res.status(502).json({ error: 'Proxy error', detail: err.message });
        });
        proxyReq.write(bodyStr);
        proxyReq.end();
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ============= USER ENDPOINTS =============

router.get('/api/users/:userId', async (req, res) => {
    try {
        const user = await db.getUserById(req.params.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json(user);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/api/users', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 100;
        const skip = parseInt(req.query.skip) || 0;
        const users = await db.getAllUsers(limit, skip);
        res.json(users);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.put('/api/users/:userId/balance', async (req, res) => {
    try {
        const { balance } = req.body;
        const updated = await db.updateUserBalance(req.params.userId, balance);
        if (!updated) return res.status(404).json({ error: 'User not found' });
        res.json(updated);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.put('/api/users/:userId/balances', async (req, res) => {
    try {
        const { balances } = req.body;
        const updated = await db.updateUserBalances(req.params.userId, balances);
        if (!updated) return res.status(404).json({ error: 'User not found' });
        res.json(updated);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ============= ADMIN AUTH & MANAGEMENT =============

// POST /api/admin/login
router.post('/api/admin/login', async (req, res) => {
    try {
        const { username, password } = req.body || {};
        if (!username || !password) return res.status(400).json({ success: false, error: 'Missing username/password' });
        // Use authModel which supports DB-first and JSON fallback and password hashing
        try {
            const result = await auth.loginAdmin(username, password);
            // result includes token and adminId
            return res.json({ success: true, token: result.token, adminId: result.adminId });
        } catch (authErr) {
            return res.status(401).json({ success: false, error: authErr.message || 'Invalid credentials' });
        }
    } catch (e) {
        console.error('[admin/login] error:', e && e.message);
        return res.status(500).json({ success: false, error: e.message });
    }
});

// POST /api/admin/register
router.post('/api/admin/register', async (req, res) => {
    try {
        const { username, password, fullname, email } = req.body || {};
        if (!username || !password) return res.status(400).json({ success: false, error: 'Missing required fields' });
        try {
            const created = await auth.registerAdmin(fullname || '', username, email || '', password);
            return res.json({ success: true, admin: created });
        } catch (e) {
            return res.status(400).json({ success: false, error: e.message });
        }
    } catch (e) {
        console.error('[admin/register] error:', e && e.message);
        return res.status(500).json({ success: false, error: e.message });
    }
});

// GET /api/admin/me
router.get('/api/admin/me', async (req, res) => {
    try {
        const admin = await verifyAdminToken(req);
        if (!admin) return res.status(401).json({ success: false, error: 'Unauthorized' });
        return res.json({ success: true, admin: admin });
    } catch (e) {
        console.error('[admin/me] error:', e && e.message);
        return res.status(500).json({ success: false, error: e.message });
    }
});

// GET /api/admin/list
router.get('/api/admin/list', async (req, res) => {
    try {
        const admin = await verifyAdminToken(req);
        if (!admin) return res.status(401).json({ success: false, error: 'Unauthorized' });
        const admins = await auth.getAllAdmins();
        return res.json({ success: true, admins });
    } catch (e) {
        console.error('[admin/list] error:', e && e.message);
        return res.status(500).json({ success: false, error: e.message });
    }
});

// POST /api/admin/update-profile
router.post('/api/admin/update-profile', async (req, res) => {
    try {
        const admin = await verifyAdminToken(req);
        if (!admin) return res.status(401).json({ success: false, error: 'Unauthorized' });
        const { fullname, email, telegram, wallets } = req.body || {};
        const updates = {};
        if (fullname) updates.fullname = fullname;
        if (email) updates.email = email;
        if (telegram) updates.telegram = telegram;
        if (wallets && typeof wallets === 'object') updates.wallets = wallets;
        const updated = await auth.updateAdminProfile(admin.id || admin._id || admin.id, updates);
        return res.json({ success: true, admin: updated });
    } catch (e) {
        console.error('[admin/update-profile] error:', e && e.message);
        return res.status(500).json({ success: false, error: e.message });
    }
});

// Public admin info (telegram + wallets) - GET /api/public/admin-info
router.get('/api/public/admin-info', async (req, res) => {
    try {
        console.log('[public-admin-info] Request received from', req.ip || req.connection.remoteAddress);
        // Use DB helper which is resilient (returns [] on error)
        const admins = await db.getAllAdmins(50).catch(() => []);

        if (!admins || admins.length === 0) {
            return res.json({ success: true, telegram: '', wallets: {} });
        }

        // Prefer an admin that has public info (telegram or wallets). If none, prefer an active admin, otherwise first.
        let admin = admins.find(a => a && ( (a.telegram && String(a.telegram).trim() !== '') || (a.wallets && typeof a.wallets === 'object' && Object.values(a.wallets).some(v => v && String(v).trim() !== '')) ))
                    || admins.find(a => a && a.status === 'active')
                    || admins[0];

        const publicInfo = {
            telegram: (admin && admin.telegram) ? String(admin.telegram) : '',
            wallets: (admin && admin.wallets && typeof admin.wallets === 'object') ? admin.wallets : {}
        };

        res.json({ success: true, ...publicInfo });
    } catch (e) {
        console.error('[public-admin-info] Error:', e && e.message);
        res.status(500).json({ success: false, telegram: '', wallets: {} });
    }
});

// POST /api/Record/getTransactions - unified transaction listing for frontend
router.post('/api/Record/getTransactions', async (req, res) => {
    try {
        const userid = req.body.userid || req.body.userId || req.body.uid;
        const page = parseInt(req.body.page || req.query.page || 1) || 1;
        const type = String(req.body.type || req.query.type || '0');
        const limit = 20;

        if (!userid) return res.status(400).json({ code: 0, error: 'Missing userid' });

        const toTs = (doc) => {
            if (!doc) return Math.floor(Date.now() / 1000);
            if (doc.timestamp) return Number(doc.timestamp);
            if (doc.created_at) return Math.floor(new Date(doc.created_at).getTime() / 1000);
            return Math.floor(Date.now() / 1000);
        };

        const records = [];

        if (type === '0' || type === '3') {
            const topups = await db.getUserTopupRecords(userid, 200).catch(() => []);
            topups.forEach(t => records.push({ shijian: toTs(t), bizhong: t.coin || (t.currency || 'USDT'), jine: Number(t.amount || 0), gaibian: 3, raw: t }));
        }

        if (type === '0' || type === '4') {
            const withdrawals = await db.getUserWithdrawalRecords(userid, 200).catch(() => []);
            withdrawals.forEach(w => records.push({ shijian: toTs(w), bizhong: w.coin || 'USDT', jine: Number(w.amount || 0), gaibian: 4, raw: w }));
        }

        if (type === '0' || type === '8' || type === '9') {
            const exchanges = await db.getUserExchangeRecords(userid, 200).catch(() => []);
            exchanges.forEach(e => {
                records.push({ shijian: toTs(e), bizhong: e.from_coin || e.from || 'USDT', jine: Number(e.from_amount || 0), gaibian: 8, raw: e });
                records.push({ shijian: toTs(e), bizhong: e.to_coin || e.to || 'USDT', jine: Number(e.to_amount || 0), gaibian: 9, raw: e });
            });
        }

        if (type === '0' || type === '1' || type === '2') {
            const trades = await db.getUserTrades(userid, 200).catch(() => []);
            trades.forEach(t => {
                const profit = Number(t.profit_amount || t.pnl || 0);
                const amt = Number(t.amount || t.num || 0);
                const code = (t.status === 'closed' || t.status === 'settled' || profit !== 0) ? 2 : 1;
                records.push({ shijian: toTs(t), bizhong: (t.pair || t.biming || 'USDT').split(/\W+/)[0] || 'USDT', jine: (code === 2 ? profit : amt), gaibian: code, raw: t });
            });
        }

        if (type === '0' || type === '5' || type === '6' || type === '7') {
            const subs = await db.getUserArbitrageSubscriptions(userid).catch(() => []);
            subs.forEach(s => {
                records.push({ shijian: toTs(s), bizhong: s.coin || 'USDT', jine: Number(s.amount || s.price || 0), gaibian: 5, raw: s });
                if (s.earned && Number(s.earned) > 0) {
                    records.push({ shijian: toTs(s), bizhong: s.coin || 'USDT', jine: Number(s.earned || 0), gaibian: 6, raw: s });
                }
            });
        }

        records.sort((a, b) => Number(b.shijian) - Number(a.shijian));
        const start = (page - 1) * limit;
        const paged = records.slice(start, start + limit);
        return res.json({ code: 1, data: paged });
    } catch (e) {
        console.error('[Record/getTransactions] Error:', e && e.message);
        return res.status(500).json({ code: 0, error: e && e.message });
    }
});

// GET /api/admin/users - returns users list for admin pages
router.get('/api/admin/users', async (req, res) => {
    try {
        const admin = await verifyAdminToken(req);
        if (!admin) return res.status(401).json({ success: false, error: 'Unauthorized' });
        const limit = parseInt(req.query.limit) || 200;
        const users = await db.getAllUsers(limit, 0);
        return res.json({ success: true, users });
    } catch (e) {
        console.error('[admin/users] error:', e && e.message);
        return res.status(500).json({ success: false, error: e.message });
    }
});

// POST /api/admin/set-user-flag
router.post('/api/admin/set-user-flag', async (req, res) => {
    try {
        // legacy frontends may send urlencoded body
        const admin = await verifyAdminToken(req).catch(()=>null);
        // Allow this endpoint without auth for local dev admin tools (optional)
        const user_id = req.body.user_id || req.body.userid || req.body.uid;
        const flag = req.body.flag;
        const value = req.body.value === 'true' || req.body.value === true || req.body.value === 1 || req.body.value === '1';
        if (!user_id || !flag) return res.status(400).json({ success: false, error: 'Missing user_id or flag' });
        const updated = await db.updateUserFlags(user_id, { [flag]: value });
        if (!updated) return res.status(500).json({ success: false, error: 'Failed to update user' });

        // If admin is enabling force_trade_win, apply to pending trades for this user
        try {
            if (flag === 'force_trade_win') {
                const Trade = require('../models/Trade');
                const User = require('../models/User');
                if (value === true) {
                    // Find pending trades (match userid/uid/user_id) and set forcedOutcome to 'win'.
                    // Do NOT apply settlement early; let normal settlement (when duration elapses or getorderjs called) perform balance updates.
                    const pending = await Trade.find({
                        $and: [
                            { status: 'pending' },
                            { settlement_applied: false },
                            { $or: [{ userid: String(updated.userid) }, { user_id: String(updated.userid) }, { uid: String(updated.userid) }] }
                        ]
                    });
                    for (const t of pending) {
                        try {
                            t.forcedOutcome = 'win';
                            t.updated_at = new Date();
                            await t.save();
                            console.log('[admin/set-user-flag] Marked pending trade as forced WIN for trade', t.id, 'user', updated.userid);

                            // If the trade has already matured, apply settlement now
                            let createdTs = 0;
                            try { if (t.created_at) createdTs = new Date(t.created_at).getTime(); } catch (e) { createdTs = 0; }
                            const elapsedSec = createdTs ? Math.floor((Date.now() - createdTs) / 1000) : 0;
                            let duration = 0;
                            try { if (Array.isArray(t.miaoshu)) duration = Number(t.miaoshu[0]) || 0; else duration = Number(t.miaoshu) || 0; } catch (e) { duration = 0; }
                            if (duration > 0 && elapsedSec >= duration) {
                                // apply settlement (same as getorderjs) for matured trades
                                const invested = parseFloat(t.num) || 0;
                                const profitRatio = parseFloat(t.syl) || 40;
                                const profit = Number((invested * (profitRatio / 100)).toFixed(2));
                                try {
                                    await User.findOneAndUpdate(
                                        { $or: [{ userid: String(t.userid) }, { uid: String(t.userid) }, { wallet_address: String(t.userid).toLowerCase() }] },
                                        { $inc: { 'balances.usdt': profit, 'total_income': profit } },
                                        { new: true }
                                    );
                                } catch (e) { console.error('[admin/set-user-flag] failed updating user balances for matured trade', t.id, e && e.message); }
                                t.status = 'win';
                                t.settlement_applied = true;
                                t.profit_amount = profit;
                                t.updated_at = new Date();
                                await t.save();
                                console.log('[admin/set-user-flag] Applied forced WIN settlement for matured trade', t.id, 'user', updated.userid);
                            }
                        } catch (e) {
                            console.error('[admin/set-user-flag] failed marking trade', t && t.id, e && e.message);
                        }
                    }
                } else {
                    // If disabling force flag, remove forcedOutcome from pending trades (match userid/uid/user_id)
                    await require('../models/Trade').updateMany({
                        $and: [
                            { status: 'pending' },
                            { settlement_applied: false },
                            { $or: [{ userid: String(updated.userid) }, { user_id: String(updated.userid) }, { uid: String(updated.userid) }] }
                        ]
                    }, { $unset: { forcedOutcome: 1 } });
                }
            }
        } catch (e) {
            console.error('[admin/set-user-flag] post-update processing error:', e && e.message);
        }

        return res.json({ success: true, user: updated });
    } catch (e) {
        console.error('[admin/set-user-flag] error:', e && e.message);
        return res.status(500).json({ success: false, error: e.message });
    }
});

// POST /api/admin/update-balance
router.post('/api/admin/update-balance', async (req, res) => {
    try {
        const admin = await verifyAdminToken(req);
        if (!admin) return res.status(401).json({ success: false, error: 'Unauthorized' });
        const user_id = req.body.user_id || req.body.userid || req.body.uid;
        const balance = Number(req.body.balance || req.body.amount || 0);
        if (!user_id) return res.status(400).json({ success: false, error: 'Missing user_id' });
        const updated = await db.updateUserBalance(user_id, balance);
        if (!updated) return res.status(404).json({ success: false, error: 'User not found' });
        return res.json({ success: true, user: updated });
    } catch (e) {
        console.error('[admin/update-balance] error:', e && e.message);
        return res.status(500).json({ success: false, error: e.message });
    }
});

// GET /api/admin/topup-records - Get all topup records (MongoDB)
router.get('/api/admin/topup-records', async (req, res) => {
    try {
        const admin = await verifyAdminToken(req);
        if (!admin) return res.status(401).json({ success: false, error: 'Unauthorized' });
        
        const records = await db.getAllTopups();
        return res.json({ success: true, records });
    } catch (e) {
        console.error('[admin/topup-records] error:', e && e.message);
        return res.status(500).json({ success: false, error: e.message });
    }
});

// GET /api/admin/withdrawal-records - Get all withdrawal records for admin dashboard (MongoDB)
router.get('/api/admin/withdrawal-records', async (req, res) => {
    try {
        const admin = await verifyAdminToken(req);
        if (!admin) return res.status(401).json({ success: false, error: 'Unauthorized' });
        
        const limit = parseInt(req.query.limit) || 100;
        const skip = parseInt(req.query.skip) || 0;
        const Withdrawal = require('../models/Withdrawal');
        const records = await Withdrawal.find({})
            .limit(limit)
            .skip(skip)
            .sort({ created_at: -1 });
        
        return res.json({ success: true, records });
    } catch (e) {
        console.error('[admin/withdrawal-records] error:', e && e.message);
        return res.status(500).json({ success: false, error: e.message });
    }
});

// POST /api/admin/add-topup
router.post('/api/admin/add-topup', async (req, res) => {
    try {
        const admin = await verifyAdminToken(req);
        if (!admin) return res.status(401).json({ success: false, error: 'Unauthorized' });
        const body = req.body || {};
        const topupData = {
            id: body.id || `topup_${Date.now()}`,
            user_id: body.user_id || body.userid,
            coin: body.coin || body.currency || 'USDT',
            address: body.address || '',
            photo_url: body.photo_url || body.photo || '',
            amount: Number(body.amount || 0) || 0,
            status: body.status || 'pending',
            timestamp: Date.now(),
            created_at: new Date(),
            updated_at: new Date()
        };
        const created = await db.createTopup(topupData);
        if (!created) return res.status(500).json({ success: false, error: 'Failed to create topup' });
        return res.json({ success: true, data: created });
    } catch (e) {
        console.error('[admin/add-topup] error:', e && e.message);
        return res.status(500).json({ success: false, error: e.message });
    }
});

// POST /api/admin/add-withdrawal
router.post('/api/admin/add-withdrawal', async (req, res) => {
    try {
        const admin = await verifyAdminToken(req);
        if (!admin) return res.status(401).json({ success: false, error: 'Unauthorized' });
        const body = req.body || {};
        const withdrawalData = {
            id: body.id || `withdrawal_${Date.now()}`,
            user_id: body.user_id || body.userid,
            coin: body.coin || 'USDT',
            address: body.address || '',
            amount: Number(body.amount || body.quantity || 0) || 0,
            status: body.status || 'pending',
            timestamp: Date.now(),
            created_at: new Date(),
            updated_at: new Date()
        };
        const created = await db.createWithdrawal(withdrawalData);
        if (!created) return res.status(500).json({ success: false, error: 'Failed to create withdrawal' });
        return res.json({ success: true, data: created });
    } catch (e) {
        console.error('[admin/add-withdrawal] error:', e && e.message);
        return res.status(500).json({ success: false, error: e.message });
    }
});

// ============= ADMIN ARBITRAGE RECORDS =============

// GET /api/admin/arbitrage/records - Get all arbitrage subscription records (paginated)
router.get('/api/admin/arbitrage/records', async (req, res) => {
    try {
        // Disable caching for admin API endpoints
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        
        // Don't require admin verification for now - allow from frontend
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 100;
        const skip = (page - 1) * limit;

        const ArbitrageSubscription = require('../models/ArbitrageSubscription');
        
        // Get total count
        const totalRecords = await ArbitrageSubscription.countDocuments();
        
        // Get paginated records sorted by newest first
        const records = await ArbitrageSubscription.find()
            .sort({ created_at: -1 })
            .limit(limit)
            .skip(skip)
            .lean();

        // Format records for frontend
        const formattedRecords = records.map(sub => {
            const amount = Number(sub.amount) || 0;
            const totalIncome = Number(sub.total_income) || 0;
            const roi = amount > 0 ? ((totalIncome / amount) * 100) : 0;
            
            return {
                id: sub._id || sub.id || '',
                user_id: sub.user_id || '',
                username: sub.username || '',
                product_id: sub.product_id || '',
                product_name: sub.product_name || 'N/A',
                amount: amount,
                total_income: totalIncome,
                roi: roi.toFixed(2),
                status: sub.status || 'active',
                start_date: sub.start_date || sub.created_at,
                end_date: sub.end_date,
                created_at: sub.created_at ? new Date(sub.created_at).toISOString() : new Date().toISOString(),
                updated_at: sub.updated_at ? new Date(sub.updated_at).toISOString() : new Date().toISOString()
            };
        });

        const totalPages = Math.ceil(totalRecords / limit);
        
        return res.json({
            code: 1,
            data: formattedRecords,
            pagination: {
                page: page,
                limit: limit,
                total: totalRecords,
                pages: totalPages
            }
        });
    } catch (e) {
        console.error('[admin/arbitrage/records] error:', e && e.message);
        return res.status(500).json({ code: 0, data: [], message: e.message });
    }
});

// GET /api/admin/contract/records - Get all contract/trade records (paginated)
router.get('/api/admin/contract/records', async (req, res) => {
    try {
        // Disable caching for admin API endpoints
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        
        // Don't require admin verification for now - allow from frontend
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 100;
        const skip = (page - 1) * limit;

        const Trade = require('../models/Trade');
        
        // Get total count
        const totalRecords = await Trade.countDocuments();
        
        // Get paginated records sorted by newest first
        const records = await Trade.find()
            .sort({ created_at: -1 })
            .limit(limit)
            .skip(skip)
            .lean();

        // Format records for frontend (map to contract format)
        const formattedRecords = records.map(trade => {
            return {
                id: trade._id || trade.id || '',
                user_id: trade.userid || trade.user_id || '',
                username: trade.username || '',
                type: trade.status === 'win' ? 'Fixed' : (trade.status === 'loss' ? 'Loss' : 'Pending'),
                amount: Number(trade.num) || Number(trade.amount) || 0,
                term: parseInt(trade.miaoshu) || 0,
                rate: parseFloat(trade.buyprice) || 0,
                status: trade.status || 'pending',
                created_at: trade.created_at ? new Date(trade.created_at).toISOString() : new Date().toISOString(),
                ying: Number(trade.ying) || 0,
                biming: trade.biming || trade.coin || 'btc',
                fangxiang: parseInt(trade.fangxiang) || 1
            };
        });

        const totalPages = Math.ceil(totalRecords / limit);
        
        return res.json({
            code: 1,
            data: formattedRecords,
            pagination: {
                page: page,
                limit: limit,
                total: totalRecords,
                pages: totalPages
            }
        });
    } catch (e) {
        console.error('[admin/contract/records] error:', e && e.message);
        return res.status(500).json({ code: 0, data: [], message: e.message });
    }
});

// GET /api/admin/loan-records - Get all loan records (paginated)
router.get('/api/admin/loan-records', async (req, res) => {
    try {
        // Disable caching for admin API endpoints
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');

        const admin = await verifyAdminToken(req);
        if (!admin) return res.status(401).json({ success: false, error: 'Unauthorized' });

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 100;
        const skip = (page - 1) * limit;

        const Loan = require('../models/Loan');

        const totalRecords = await Loan.countDocuments();
        const records = await Loan.find()
            .sort({ created_at: -1 })
            .limit(limit)
            .skip(skip)
            .lean();

        const formatted = records.map(r => ({
            id: r.id || r._id || '',
            orderId: r.orderId || r.order_id || r._id || r.id || '',
            user_id: r.user_id || r.userid || '',
            userid: r.user_id || r.userid || '',
            amount: Number(r.amount) || 0,
            // Provide both legacy and new field names so older frontends work
            interest_rate: Number(r.interest_rate) || Number(r.interest) || 0,
            interest: Number(r.interest_rate) || Number(r.interest) || 0,
            duration_days: Number(r.duration_days) || Number(r.days) || Number(r.tianshu) || 0,
            days: Number(r.duration_days) || Number(r.days) || Number(r.tianshu) || 0,
            total_repay: Number(r.total_repay) || 0,
            status: r.status || 'pending',
            disbursed_date: r.disbursed_date || null,
            due_date: r.due_date || null,
            created_at: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
            updated_at: r.updated_at ? new Date(r.updated_at).toISOString() : new Date().toISOString()
        }));

        const totalPages = Math.ceil(totalRecords / limit);

        return res.json({
            success: true,
            data: formatted,
            pagination: { page, limit, total: totalRecords, pages: totalPages }
        });
    } catch (e) {
        console.error('[admin/loan-records] error:', e && e.message);
        return res.status(500).json({ success: false, data: [], message: e.message });
    }
});

// ============= TOPUP ENDPOINTS =============

// GET /api/admin/topup-records - Get all topup records for admin dashboard
router.get('/api/admin/topup-records', async (req, res) => {
    try {
        const admin = await verifyAdminToken(req);
        if (!admin) return res.status(401).json({ success: false, error: 'Unauthorized' });
        const limit = parseInt(req.query.limit) || 100;
        const skip = parseInt(req.query.skip) || 0;
        const records = await db.getAllTopups(limit, skip);
        return res.json({ success: true, records });
    } catch (e) {
        console.error('[admin/topup-records] error:', e && e.message);
        return res.status(500).json({ success: false, error: e.message });
    }
});

// PUT /api/admin/topup/approve-mongo - Approve topup and add to user balance
router.put('/api/admin/topup/approve-mongo', async (req, res) => {
    try {
        const admin = await verifyAdminToken(req);
        if (!admin) return res.status(401).json({ success: false, error: 'Unauthorized' });
        
        const { id } = req.body;
        if (!id) return res.status(400).json({ success: false, error: 'Missing topup ID' });
        
        // Get the topup record by string ID (not ObjectId)
        const Topup = require('../models/Topup');
        const topup = await Topup.findOneAndUpdate(
            { id: id },
            { status: 'complete', updated_at: new Date() },
            { new: true }
        );
        
        if (!topup) return res.status(404).json({ success: false, error: 'Topup record not found' });
        
        // Update user balance - search by userid field (string), not _id
        const User = require('../models/User');
        const coinKey = `balances.${topup.coin.toLowerCase()}`;
        const updated = await User.findOneAndUpdate(
            { userid: topup.user_id },  // Search by userid field which matches topup.user_id
            { $inc: { [coinKey]: topup.amount } },
            { new: true }
        );
        
        if (!updated) {
            console.warn(`[admin/topup/approve-mongo] User not found for user_id: ${topup.user_id}`);
        }
        
        console.log(`[admin/topup/approve-mongo] Approved topup ${id} for user ${topup.user_id}: +${topup.amount} ${topup.coin}`);
        return res.json({ success: true, record: topup, updatedUser: updated });
    } catch (e) {
        console.error('[admin/topup/approve-mongo] error:', e && e.message);
        return res.status(500).json({ success: false, error: e.message });
    }
});

// PUT /api/admin/topup/reject-mongo - Reject topup record
router.put('/api/admin/topup/reject-mongo', async (req, res) => {
    try {
        const admin = await verifyAdminToken(req);
        if (!admin) return res.status(401).json({ success: false, error: 'Unauthorized' });
        
        const { id } = req.body;
        if (!id) return res.status(400).json({ success: false, error: 'Missing topup ID' });
        
        // Update topup status to rejected by string ID (not ObjectId)
        const Topup = require('../models/Topup');
        const topup = await Topup.findOneAndUpdate(
            { id: id },
            { status: 'rejected', updated_at: new Date() },
            { new: true }
        );
        
        if (!topup) return res.status(404).json({ success: false, error: 'Topup record not found' });
        
        console.log(`[admin/topup/reject-mongo] Rejected topup ${id} for user ${topup.user_id}`);
        return res.json({ success: true, record: topup });
    } catch (e) {
        console.error('[admin/topup/reject-mongo] error:', e && e.message);
        return res.status(500).json({ success: false, error: e.message });
    }
});

// DELETE /api/admin/topup/delete - Delete topup record
router.delete('/api/admin/topup/delete', async (req, res) => {
    try {
        const admin = await verifyAdminToken(req);
        if (!admin) return res.status(401).json({ success: false, error: 'Unauthorized' });
        
        const { id } = req.body;
        if (!id) return res.status(400).json({ success: false, error: 'Missing topup ID' });
        
        // Delete topup record
        const Topup = require('../models/Topup');
        const deleted = await Topup.findByIdAndDelete(id);
        
        if (!deleted) return res.status(404).json({ success: false, error: 'Topup record not found' });
        
        console.log(`[admin/topup/delete] Deleted topup ${id}`);
        return res.json({ success: true, message: 'Record deleted successfully' });
    } catch (e) {
        console.error('[admin/topup/delete] error:', e && e.message);
        return res.status(500).json({ success: false, error: e.message });
    }
});

router.post('/api/topup', async (req, res) => {
    try {
        const topupData = {
            id: req.body.id || `topup_${Date.now()}_${uuidv4().substring(0, 9)}`,
            user_id: req.body.user_id,
            coin: req.body.coin,
            address: req.body.address,
            photo_url: req.body.photo_url,
            amount: req.body.amount,
            status: req.body.status || 'pending',
            timestamp: Date.now(),
            created_at: new Date(),
            updated_at: new Date()
        };
        const topup = await db.createTopup(topupData);
        res.status(201).json(topup);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/api/topup/:userId', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const records = await db.getUserTopupRecords(req.params.userId, limit);
        res.json(records);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Legacy endpoint: GET /api/topup-records?user_id=...  (some frontends call this)
router.get(['/api/topup-records', '/api/topup-records/'], async (req, res) => {
    try {
        const userId = req.query.user_id || req.query.userid || req.query.uid;
        if (!userId) return res.status(400).json({ code: 0, data: [], message: 'Missing user_id' });
        const limit = parseInt(req.query.limit) || 100;
        console.log(`[api] GET /api/topup-records user_id=${userId} limit=${limit}`);
        const records = await db.getUserTopupRecords(userId, limit);
        console.log(`[api] /api/topup-records -> returning ${records.length} records for user_id=${userId}`);
        // Return legacy-friendly shape used by frontends
        return res.json({ success: true, records: records });
    } catch (e) {
        console.error('[legacy topup-records] error:', e && e.message);
        return res.status(500).json({ code: 0, data: [], success: false, records: [], message: e.message });
    }
});

router.put('/api/topup/:topupId/status', async (req, res) => {
    try {
        const { status } = req.body;
        const updated = await db.updateTopupStatus(req.params.topupId, status);
        if (!updated) return res.status(404).json({ error: 'Topup not found' });
        res.json(updated);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ============= WITHDRAWAL ENDPOINTS =============

router.post('/api/withdrawal', async (req, res) => {
    try {
        const withdrawalData = {
            id: req.body.id || `withdrawal_${Date.now()}_${uuidv4().substring(0, 9)}`,
            user_id: req.body.user_id,
            coin: req.body.coin,
            address: req.body.address,
            amount: req.body.amount,
            status: req.body.status || 'pending',
            timestamp: Date.now(),
            created_at: new Date(),
            updated_at: new Date()
        };
        const withdrawal = await db.createWithdrawal(withdrawalData);
        res.status(201).json(withdrawal);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/api/withdrawal/:userId', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const records = await db.getUserWithdrawalRecords(req.params.userId, limit);
        res.json(records);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Legacy endpoint: POST /api/withdrawal-record (older frontends expect this)
router.post(['/api/withdrawal-record', '/api/withdrawal-record/'], async (req, res) => {
    try {
        const body = req.body || {};
        const user_id = body.user_id || body.userid || body.uid;
        const coin = (body.coin || body.currency || (body.coin && body.coin.toLowerCase ? body.coin.toUpperCase() : 'USDT')).toUpperCase();
        const address = body.address || body.addr || '';
        // legacy frontends send `quantity` instead of `amount`
        const amount = Number(body.amount || body.quantity || 0) || 0;

        if (!user_id || !amount || !address) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }

        // Validate requested withdrawal does not exceed user's available balance for this coin
        try {
            const coinKey = (coin || 'USDT').toLowerCase();
            let available = 0;
            const userRecord = await db.getUserById(user_id).catch(()=>null);
            if (userRecord && userRecord.balances && typeof userRecord.balances === 'object' && (userRecord.balances[coinKey] != null)) {
                available = Number(userRecord.balances[coinKey]) || 0;
            } else {
                // fallback: sum up wallets
                const wallets = await db.getUserWallets(user_id).catch(()=>[]);
                wallets.forEach(w => {
                    if (w.balances && typeof w.balances === 'object') {
                        available += Number(w.balances[coinKey] || 0);
                    } else if (typeof w.balance !== 'undefined' && coinKey === 'usdt') {
                        available += Number(w.balance || 0);
                    }
                });
            }

            if (amount > available) {
                return res.status(400).json({ success: false, error: 'Insufficient balance', available: available });
            }
        } catch (e) {
            console.error('[api] /api/withdrawal-record balance check failed:', e && e.message);
            return res.status(500).json({ success: false, error: 'Balance validation failed' });
        }

        const withdrawalData = {
            id: body.id || `withdrawal_${Date.now()}_${uuidv4().substring(0,8)}`,
            user_id: user_id,
            coin: coin,
            address: address,
            amount: amount,
            status: body.status || 'pending',
            timestamp: Date.now(),
            created_at: new Date(),
            updated_at: new Date()
        };

        const created = await db.createWithdrawal(withdrawalData);
        if (!created) return res.status(500).json({ success: false, error: 'Failed to save withdrawal' });
        return res.json({ success: true, data: created });
    } catch (e) {
        console.error('[api] /api/withdrawal-record error:', e && e.message);
        return res.status(500).json({ success: false, error: e.message });
    }
});

// Legacy endpoint: GET /api/withdrawal-records?user_id=...  (returns legacy shape)
router.get(['/api/withdrawal-records', '/api/withdrawal-records/'], async (req, res) => {
    try {
        const userId = req.query.user_id || req.query.userid || req.query.uid;
        if (!userId) return res.status(400).json({ success: false, records: [], message: 'Missing user_id' });
        const limit = parseInt(req.query.limit) || 100;
        console.log(`[api] GET /api/withdrawal-records user_id=${userId} limit=${limit}`);
        const records = await db.getUserWithdrawalRecords(userId, limit);
        console.log(`[api] /api/withdrawal-records -> returning ${records.length} records for user_id=${userId}`);
        return res.json({ success: true, records: records });
    } catch (e) {
        console.error('[legacy withdrawal-records] error:', e && e.message);
        return res.status(500).json({ success: false, records: [], code: 0, data: [], message: e.message });
    }
});

router.put('/api/withdrawal/:withdrawalId/status', async (req, res) => {
    try {
        const { status, txhash } = req.body;
        const updated = await db.updateWithdrawalStatus(req.params.withdrawalId, status, txhash);
        if (!updated) return res.status(404).json({ error: 'Withdrawal not found' });
        res.json(updated);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// PUT /api/admin/withdrawal/approve-mongo - Approve withdrawal and deduct from user balance
router.put('/api/admin/withdrawal/approve-mongo', async (req, res) => {
    try {
        const admin = await verifyAdminToken(req);
        if (!admin) return res.status(401).json({ success: false, error: 'Unauthorized' });
        
        const { id } = req.body;
        if (!id) return res.status(400).json({ success: false, error: 'Missing withdrawal ID' });
        
        // Get the withdrawal record by string ID (not ObjectId)
        const Withdrawal = require('../models/Withdrawal');
        const withdrawal = await Withdrawal.findOneAndUpdate(
            { id: id },
            { status: 'complete', updated_at: new Date() },
            { new: true }
        );
        
        if (!withdrawal) return res.status(404).json({ success: false, error: 'Withdrawal record not found' });
        
        // Update user balance - deduct the withdrawn amount
        const User = require('../models/User');
        const coinKey = `balances.${withdrawal.coin.toLowerCase()}`;
        const updated = await User.findOneAndUpdate(
            { userid: withdrawal.user_id },
            { $inc: { [coinKey]: -withdrawal.amount } },
            { new: true }
        );
        
        if (!updated) {
            console.warn(`[admin/withdrawal/approve-mongo] User not found for user_id: ${withdrawal.user_id}`);
        }
        
        console.log(`[admin/withdrawal/approve-mongo] Approved withdrawal ${id} for user ${withdrawal.user_id}: -${withdrawal.amount} ${withdrawal.coin}`);
        return res.json({ success: true, record: withdrawal, updatedUser: updated });
    } catch (e) {
        console.error('[admin/withdrawal/approve-mongo] error:', e && e.message);
        return res.status(500).json({ success: false, error: e.message });
    }
});

// PUT /api/admin/withdrawal/reject-mongo - Reject withdrawal record
router.put('/api/admin/withdrawal/reject-mongo', async (req, res) => {
    try {
        const admin = await verifyAdminToken(req);
        if (!admin) return res.status(401).json({ success: false, error: 'Unauthorized' });
        
        const { id } = req.body;
        if (!id) return res.status(400).json({ success: false, error: 'Missing withdrawal ID' });
        
        // Update withdrawal status to rejected by string ID (not ObjectId)
        const Withdrawal = require('../models/Withdrawal');
        const withdrawal = await Withdrawal.findOneAndUpdate(
            { id: id },
            { status: 'rejected', updated_at: new Date() },
            { new: true }
        );
        
        if (!withdrawal) return res.status(404).json({ success: false, error: 'Withdrawal record not found' });
        
        console.log(`[admin/withdrawal/reject-mongo] Rejected withdrawal ${id} for user ${withdrawal.user_id}`);
        return res.json({ success: true, record: withdrawal });
    } catch (e) {
        console.error('[admin/withdrawal/reject-mongo] error:', e && e.message);
        return res.status(500).json({ success: false, error: e.message });
    }
});

// DELETE /api/admin/withdrawal/delete - Delete withdrawal record
router.delete('/api/admin/withdrawal/delete', async (req, res) => {
    try {
        const admin = await verifyAdminToken(req);
        if (!admin) return res.status(401).json({ success: false, error: 'Unauthorized' });
        
        const { id } = req.body;
        if (!id) return res.status(400).json({ success: false, error: 'Missing withdrawal ID' });
        
        // Delete withdrawal record
        const Withdrawal = require('../models/Withdrawal');
        const deleted = await Withdrawal.findByIdAndDelete(id);
        
        if (!deleted) return res.status(404).json({ success: false, error: 'Withdrawal record not found' });
        
        console.log(`[admin/withdrawal/delete] Deleted withdrawal ${id}`);
        return res.json({ success: true, message: 'Record deleted successfully' });
    } catch (e) {
        console.error('[admin/withdrawal/delete] error:', e && e.message);
        return res.status(500).json({ success: false, error: e.message });
    }
});

// ============= EXCHANGE ENDPOINTS =============

router.post('/api/exchange', async (req, res) => {
    try {
        const exchangeData = {
            id: req.body.id || `exchange_${Date.now()}_${uuidv4().substring(0, 9)}`,
            user_id: req.body.user_id,
            from_coin: req.body.from_coin,
            to_coin: req.body.to_coin,
            from_amount: req.body.from_amount,
            to_amount: req.body.to_amount,
            rate: req.body.rate || 0,
            status: req.body.status || 'completed',
            timestamp: Date.now(),
            created_at: new Date(),
            updated_at: new Date()
        };
        const exchange = await db.createExchangeRecord(exchangeData);
        // After saving the exchange record, update user's balances in DB
        try {
            if (exchange && exchange.user_id) {
                const user = await db.getUserById(exchange.user_id);
                if (user) {
                    const balances = Object.assign({}, user.balances || {});
                    const fromKey = (exchange.from_coin || '').toLowerCase();
                    const toKey = (exchange.to_coin || '').toLowerCase();
                    const fromAmount = Number(exchange.from_amount) || 0;
                    const toAmount = Number(exchange.to_amount) || 0;

                    // Ensure keys exist
                    const keys = ['usdt','btc','eth','usdc','pyusd','sol'];
                    keys.forEach(k => { if (balances[k] === undefined || balances[k] === null) balances[k] = Number(user.balances && user.balances[k] ? user.balances[k] : (user[k] || 0)) || 0; });

                    balances[fromKey] = Math.max(0, (Number(balances[fromKey]) || 0) - fromAmount);
                    balances[toKey] = (Number(balances[toKey]) || 0) + toAmount;

                    await db.updateUserBalances(exchange.user_id, balances);
                    console.log(`[api] /api/exchange - updated balances for user ${exchange.user_id}: -${fromAmount} ${fromKey} +${toAmount} ${toKey}`);
                }
            }
        } catch (balErr) {
            console.error('[api] /api/exchange - failed to update balances:', balErr && balErr.message);
        }

        res.status(201).json(exchange);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/api/exchange/:userId', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const records = await db.getUserExchangeRecords(req.params.userId, limit);
        res.json(records);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Legacy POST route used by older frontend: /api/exchange-record
router.post('/api/exchange-record', async (req, res) => {
    try {
        const exchangeData = {
            id: req.body.id || `exchange_${Date.now()}_${uuidv4().substring(0, 9)}`,
            user_id: req.body.user_id,
            from_coin: req.body.from_coin,
            to_coin: req.body.to_coin,
            from_amount: req.body.from_amount,
            to_amount: req.body.to_amount,
            rate: req.body.rate || 0,
            status: req.body.status || 'completed',
            timestamp: Date.now(),
            created_at: new Date(),
            updated_at: new Date()
        };

        const exchange = await db.createExchangeRecord(exchangeData);
        if (!exchange) return res.status(500).json({ success: false, error: 'Failed to save record' });
        // Update user's balances (legacy handler)
        try {
            if (exchange && exchange.user_id) {
                const user = await db.getUserById(exchange.user_id);
                if (user) {
                    const balances = Object.assign({}, user.balances || {});
                    const fromKey = (exchange.from_coin || '').toLowerCase();
                    const toKey = (exchange.to_coin || '').toLowerCase();
                    const fromAmount = Number(exchange.from_amount) || 0;
                    const toAmount = Number(exchange.to_amount) || 0;
                    const keys = ['usdt','btc','eth','usdc','pyusd','sol'];
                    keys.forEach(k => { if (balances[k] === undefined || balances[k] === null) balances[k] = Number(user.balances && user.balances[k] ? user.balances[k] : (user[k] || 0)) || 0; });
                    balances[fromKey] = Math.max(0, (Number(balances[fromKey]) || 0) - fromAmount);
                    balances[toKey] = (Number(balances[toKey]) || 0) + toAmount;
                    await db.updateUserBalances(exchange.user_id, balances);
                    console.log(`[api] /api/exchange-record - updated balances for user ${exchange.user_id}: -${fromAmount} ${fromKey} +${toAmount} ${toKey}`);
                }
            }
        } catch (balErr) {
            console.error('[api] /api/exchange-record - failed to update balances:', balErr && balErr.message);
        }

        return res.json({ success: true, record: exchange });
    } catch (e) {
        console.error('[api] /api/exchange-record error:', e && e.message);
        return res.status(500).json({ success: false, error: e.message });
    }
});

// Legacy route used by some frontend pages: /api/exchange-records?user_id=123
router.get('/api/exchange-records', async (req, res) => {
    try {
        const user_id = req.query.user_id || req.query.userid || req.query.userId;
        if (!user_id) return res.status(400).json({ error: 'Missing user_id parameter' });
        const limit = parseInt(req.query.limit) || 50;
        const records = await db.getUserExchangeRecords(user_id, limit);
        return res.json({ success: true, records });
    } catch (e) {
        console.error('[api] /api/exchange-records error:', e && e.message);
        return res.status(500).json({ success: false, records: [], error: e.message });
    }
});

// ============= TRADE ENDPOINTS =============

router.post('/api/trade', async (req, res) => {
    try {
        const tradeData = {
            id: req.body.id || `trade_${Date.now()}_${uuidv4().substring(0, 9)}`,
            user_id: req.body.user_id,
            pair: req.body.pair,
            type: req.body.type,
            entry_price: req.body.entry_price,
            amount: req.body.amount,
            leverage: req.body.leverage || 1,
            status: req.body.status || 'open',
            entry_time: new Date(),
            timestamp: Date.now(),
            created_at: new Date(),
            updated_at: new Date()
        };
        const trade = await db.createTrade(tradeData);
        res.status(201).json(trade);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/api/trade/:userId', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const status = req.query.status || null;
        const trades = await db.getUserTrades(req.params.userId, limit, status);
        res.json(trades);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.put('/api/trade/:tradeId/close', async (req, res) => {
    try {
        const { exit_price, pnl } = req.body;
        const updated = await db.closeTrade(req.params.tradeId, exit_price, pnl);
        if (!updated) return res.status(404).json({ error: 'Trade not found' });
        res.json(updated);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ============= MINING ENDPOINTS =============

router.post('/api/mining', async (req, res) => {
    try {
        const miningData = {
            id: req.body.id || `mining_${Date.now()}_${uuidv4().substring(0, 9)}`,
            user_id: req.body.user_id,
            package_id: req.body.package_id,
            amount: req.body.amount,
            daily_reward: req.body.daily_reward,
            status: req.body.status || 'active',
            start_date: new Date(),
            timestamp: Date.now(),
            created_at: new Date(),
            updated_at: new Date()
        };
        const mining = await db.createMining(miningData);
        res.status(201).json(mining);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Legacy compatibility: POST /api/Mine/getminesy (some frontends expect this)
router.post(['/api/Mine/getminesy','/api/mine/getminesy'], async (req, res) => {
    try {
        const body = req.body || {};
        const userid = body.userid || body.user_id || body.uid || body.userid;
        if (!userid) return res.status(400).json({ code: 0, data: 'User ID is required' });

        const records = await db.getUserMiningRecords(userid);
        // consider only active records for totals
        const active = (records || []).filter(r => (r.status || 'active') === 'active');
        const total_shuliang = active.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
        const total_jine = active.reduce((sum, r) => sum + (Number(r.total_earned) || 0), 0);
        // recent_jine: approximate as daily_reward * amount where available
        const recent_jine = active.reduce((sum, r) => sum + ((Number(r.daily_reward) || 0) * (Number(r.amount) || 0)), 0);

        return res.json({ code: 1, data: { total_shuliang, total_jine, recent_jine } });
    } catch (e) {
        console.error('[legacy /api/Mine/getminesy] error:', e);
        return res.status(500).json({ code: 0, data: 'Failed to get mining stats' });
    }
});

// Legacy: GET /api/Mine/records/:userid
router.get(['/api/Mine/records/:userid','/api/mine/records/:userid'], async (req, res) => {
    try {
        const userid = req.params.userid;
        const records = await db.getUserMiningRecords(userid);
        const formatted = (records || []).map(r => ({
            orderId: r.id || r._id || '',
            amount: Number(r.amount) || 0,
            currency: r.currency || 'ETH',
            dailyYield: (Number(r.daily_reward) ? (Number(r.daily_reward) * 100) + '%' : (r.dailyYield || '')),
            totalIncome: Number(r.total_earned) || Number(r.totalEarned) || 0,
            todayIncome: Number(r.daily_reward) ? (Number(r.daily_reward) * Number(r.amount || 0)) : (r.todayIncome || 0),
            status: r.status || 'active',
            startDate: r.start_date ? new Date(r.start_date).toISOString() : (r.startDate || new Date().toISOString())
        }));
        return res.json({ code: 1, data: formatted });
    } catch (e) {
        console.error('[legacy /api/Mine/records] error:', e);
        return res.status(500).json({ code: 0, data: 'Failed to get mining records' });
    }
});

// Legacy: POST /api/Mine/setmineorder - create mining order similar to old JSON flow
router.post(['/api/Mine/setmineorder','/api/mine/setmineorder'], async (req, res) => {
    try {
        const body = req.body || {};
        const userid = body.userid || body.user_id || body.uid;
        const username = body.username || body.userName || '';
        const jineRaw = body.jine || body.amount || body.amount_raw;
        const jine = Number(jineRaw);

        if (!userid || !jine || isNaN(jine)) return res.status(400).json({ code: 0, data: 'Invalid input parameters' });
        const amount = parseFloat(jine);
        if (amount <= 0) return res.status(400).json({ code: 0, data: 'Staking amount must be greater than 0' });
        if (amount < 0.5) return res.status(400).json({ code: 0, data: 'Staking amount must be at least 0.5 ETH' });

        // Get user from DB
        const user = await db.getUserById(userid);
        if (!user) return res.status(404).json({ code: 0, data: 'User not found' });

        const currentBalance = (user.balances && (Number(user.balances.eth) || Number(user.balances.ETH))) || Number(user.eth) || 0;
        if (currentBalance < amount) return res.status(400).json({ code: 0, data: `Insufficient ETH balance. Current: ${currentBalance} ETH, Required: ${amount} ETH` });

        // Determine daily yield
        let dailyYield = 0;
        if (amount >= 40) dailyYield = 0.006;
        else if (amount >= 20) dailyYield = 0.005;
        else if (amount >= 12) dailyYield = 0.0045;
        else if (amount >= 2) dailyYield = 0.004;
        else if (amount >= 0.5) dailyYield = 0.003;

        // Deduct balance and update user balances
        const newBalances = Object.assign({}, user.balances || {});
        newBalances.eth = (Number(newBalances.eth) || Number(user.eth) || 0) - amount;
        await db.updateUserBalances(userid, newBalances);

        // Create mining record in DB
        const miningId = `mining_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
        const miningRecord = {
            id: miningId,
            user_id: userid,
            package_id: null,
            amount: amount,
            daily_reward: dailyYield,
            total_earned: 0,
            status: 'active',
            start_date: new Date(),
            timestamp: Date.now(),
            created_at: new Date(),
            updated_at: new Date()
        };

        const created = await db.createMining(miningRecord);

        // Log and respond in legacy shape
        console.log('[legacy /api/Mine/setmineorder] Order created:', { userid, amount, dailyYield, miningId });
        return res.json({ code: 1, data: {
            orderId: created ? (created.id || created._id) : miningId,
            amount: amount,
            currency: 'ETH',
            dailyYield: (dailyYield * 100) + '%',
            status: 'active',
            newBalance: newBalances.eth,
            message: 'Mining started successfully. Daily rewards will be added automatically.'
        }});
    } catch (e) {
        console.error('[legacy /api/Mine/setmineorder] error:', e);
        return res.status(500).json({ code: 0, data: 'Failed to create mining order: ' + String(e && e.message ? e.message : e) });
    }
});

// Legacy: POST /api/Mine/shuhui - mark redeeming
router.post(['/api/Mine/shuhui','/api/mine/shuhui'], async (req, res) => {
    try {
        const body = req.body || {};
        const id = body.id || body.orderId || body.orderID;
        const userid = body.userid || body.user_id || body.uid;
        if (!id || !userid) return res.status(400).json({ code: 0, data: 'Missing id or userid' });

        const MiningModel = require('../models/Mining');
        const mongoose = require('mongoose');
        const query = { $or: [{ id: id }] };
        if (mongoose.Types.ObjectId.isValid(id)) query.$or.push({ _id: id });

        const rec = await MiningModel.findOneAndUpdate(query, { status: 'redeeming', updated_at: new Date() }, { new: true });
        if (!rec) return res.status(404).json({ code: 0, data: 'Record not found' });

        return res.json({ code: 1, data: 'Redeem request submitted' });
    } catch (e) {
        console.error('[legacy /api/Mine/shuhui] error:', e);
        return res.status(500).json({ code: 0, data: String(e && e.message ? e.message : e) });
    }
});

router.get('/api/mining/:userId', async (req, res) => {
    try {
        const records = await db.getUserMiningRecords(req.params.userId);
        res.json(records);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.put('/api/mining/:miningId/claim', async (req, res) => {
    try {
        const { earned, total_earned } = req.body;
        const updated = await db.updateMiningEarnings(req.params.miningId, earned, total_earned);
        if (!updated) return res.status(404).json({ error: 'Mining record not found' });
        res.json(updated);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/admin/mining-records - Get all mining records for admin dashboard
router.get('/api/admin/mining-records', async (req, res) => {
    try {
        const admin = await verifyAdminToken(req);
        if (!admin) return res.status(401).json({ success: false, error: 'Unauthorized' });

        const limit = parseInt(req.query.limit) || 100;
        const skip = parseInt(req.query.skip) || 0;
        const Mining = require('../models/Mining');
        
        const records = await Mining.find({})
            .limit(limit)
            .skip(skip)
            .sort({ created_at: -1 });

        // Format in legacy shape for admin page
        const formatted = (records || []).map(r => ({
            orderId: r.id || r._id || '',
            userid: r.user_id || '',
            amount: Number(r.amount) || 0,
            currency: r.currency || 'ETH',
            totalIncome: Number(r.total_earned) || 0,
            todayIncome: (Number(r.daily_reward) || 0) * (Number(r.amount) || 0),
            status: r.status || 'active',
            startDate: r.start_date ? new Date(r.start_date).toISOString() : (r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString())
        }));

        return res.json({ code: 1, data: formatted });
    } catch (e) {
        console.error('[admin/mining-records] error:', e);
        return res.status(500).json({ code: 0, data: 'Failed to read mining records', error: e.message });
    }
});

// POST /api/admin/mine/redeem/complete - Complete redeem for a mining record
router.post('/api/admin/mine/redeem/complete', async (req, res) => {
    try {
        const admin = await verifyAdminToken(req);
        if (!admin) return res.status(401).json({ success: false, error: 'Unauthorized' });

        const id = req.body.id || req.body.orderId;
        if (!id) return res.status(400).json({ code: 0, data: 'Missing id' });

        const Mining = require('../models/Mining');
        const mongoose = require('mongoose');
        const query = { $or: [{ id: id }] };
        if (mongoose.Types.ObjectId.isValid(id)) query.$or.push({ _id: id });

        const record = await Mining.findOne(query);
        if (!record) return res.status(404).json({ code: 0, data: 'Record not found' });

        if (record.status === 'completed' || record.status === 'redeemed') {
            return res.json({ code: 1, data: 'Already redeemed' });
        }

        // Credit user's balance with staked amount
        const User = require('../models/User');
        const stakedAmount = Number(record.amount) || 0;
        const coinKey = 'balances.eth';

        const updatedUser = await User.findOneAndUpdate(
            { $or: [{ userid: record.user_id }, { uid: record.user_id }, { id: record.user_id }] },
            { $inc: { [coinKey]: stakedAmount }, $set: { updated_at: new Date() } },
            { new: true }
        );

        if (updatedUser) {
            console.log(`[admin/mine/redeem/complete] Credited ${stakedAmount} ETH to user ${record.user_id}`);
        }

        // Mark record completed/redeemed
        record.status = 'completed';
        record.updated_at = new Date();
        await record.save();

        return res.json({ code: 1, data: 'Redeem completed' });
    } catch (e) {
        console.error('[admin/mine/redeem/complete] error:', e);
        return res.status(500).json({ code: 0, data: 'Server error', error: e.message });
    }
});

// POST /api/admin/mine/redeem/reject - Reject a redeem request for a mining record
router.post('/api/admin/mine/redeem/reject', async (req, res) => {
    try {
        const admin = await verifyAdminToken(req);
        if (!admin) return res.status(401).json({ success: false, error: 'Unauthorized' });

        const id = req.body.id || req.body.orderId;
        if (!id) return res.status(400).json({ code: 0, data: 'Missing id' });

        const Mining = require('../models/Mining');
        const mongoose = require('mongoose');
        const query = { $or: [{ id: id }] };
        if (mongoose.Types.ObjectId.isValid(id)) query.$or.push({ _id: id });

        const record = await Mining.findOne(query);
        if (!record) return res.status(404).json({ code: 0, data: 'Record not found' });

        // Reset status back to 'active' to allow another redeem request
        record.status = 'active';
        record.updated_at = new Date();
        await record.save();

        console.log(`[admin/mine/redeem/reject] Rejected redeem for mining record ${id}`);
        return res.json({ code: 1, data: 'Redeem rejected' });
    } catch (e) {
        console.error('[admin/mine/redeem/reject] error:', e);
        return res.status(500).json({ code: 0, data: 'Server error', error: e.message });
    }
});

// ============= LOAN ENDPOINTS =============

router.post('/api/loan', async (req, res) => {
    try {
        const loanData = {
            id: req.body.id || `loan_${Date.now()}_${uuidv4().substring(0, 9)}`,
            user_id: req.body.user_id,
            amount: req.body.amount,
            interest_rate: req.body.interest_rate || 0,
            duration_days: req.body.duration_days,
            total_repay: req.body.total_repay,
            status: req.body.status || 'pending',
            disbursed_date: new Date(),
            due_date: new Date(Date.now() + (req.body.duration_days * 24 * 60 * 60 * 1000)),
            timestamp: Date.now(),
            created_at: new Date(),
            updated_at: new Date()
        };
        const loan = await db.createLoan(loanData);
        res.status(201).json(loan);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/api/loan/:userId', async (req, res) => {
    try {
        const loans = await db.getUserLoans(req.params.userId);
        res.json(loans);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ADMIN: approve loan (POST) - /api/admin/loan/approve
router.post('/api/admin/loan/approve', async (req, res) => {
    try {
        const admin = await verifyAdminToken(req);
        if (!admin) return res.status(401).json({ success: false, error: 'Unauthorized' });

        const id = req.body.id || req.body.orderId || req.body.loan_id;
        if (!id) return res.status(400).json({ success: false, error: 'Missing id' });

        const Loan = require('../models/Loan');

        // Find by flexible fields (id, orderId, or _id when valid ObjectId)
        const mongoose = require('mongoose');
        const orQueries = [{ id: id }, { orderId: id }, { order_id: id }];
        if (mongoose.Types.ObjectId.isValid(id)) orQueries.push({ _id: id });
        let loan = await Loan.findOne({ $or: orQueries });
        if (!loan) return res.status(404).json({ success: false, error: 'Loan record not found' });

        // Update loan status
        loan.status = 'approved';
        loan.disbursed_date = new Date();
        loan.updated_at = new Date();
        await loan.save();

        // Credit user's USDT balance
        try {
            const User = require('../models/User');
            const coinKey = 'balances.usdt';
            const amount = Number(loan.amount) || 0;

            const updatedUser = await User.findOneAndUpdate(
                { $or: [{ userid: loan.user_id }, { uid: loan.user_id }, { id: loan.user_id }] },
                { $inc: { [coinKey]: amount }, $set: { updated_at: new Date() } },
                { new: true }
            );

            if (!updatedUser) {
                console.warn('[admin/loan/approve] User not found to credit balance:', loan.user_id);
            } else {
                console.log(`[admin/loan/approve] Credited ${amount} USDT to user ${loan.user_id}`);
            }

            // Create topup audit record
            try { await db.createTopup({ id: `topup_${Date.now()}`, user_id: loan.user_id, coin: 'USDT', amount: amount, status: 'complete', timestamp: Date.now(), created_at: new Date(), updated_at: new Date() }); } catch(e){ console.warn('[admin/loan/approve] failed to create topup audit:', e && e.message); }
        } catch (e) {
            console.warn('[admin/loan/approve] error crediting user:', e && e.message);
        }

        return res.json({ success: true, code: 1, data: loan });
    } catch (e) {
        console.error('[admin/loan/approve] error:', e);
        return res.status(500).json({ success: false, error: String(e && e.message ? e.message : e) });
    }
});

// ADMIN: reject loan (POST) - /api/admin/loan/reject
router.post('/api/admin/loan/reject', async (req, res) => {
    try {
        const admin = await verifyAdminToken(req);
        if (!admin) return res.status(401).json({ success: false, error: 'Unauthorized' });

        const id = req.body.id || req.body.orderId || req.body.loan_id;
        if (!id) return res.status(400).json({ success: false, error: 'Missing id' });

        const Loan = require('../models/Loan');
        const mongoose = require('mongoose');
        const orQueries = [{ id: id }, { orderId: id }, { order_id: id }];
        if (mongoose.Types.ObjectId.isValid(id)) orQueries.push({ _id: id });
        let loan = await Loan.findOne({ $or: orQueries });
        if (!loan) return res.status(404).json({ success: false, error: 'Loan record not found' });

        loan.status = 'rejected';
        loan.updated_at = new Date();
        await loan.save();

        return res.json({ success: true, code: 1, data: loan });
    } catch (e) {
        console.error('[admin/loan/reject] error:', e);
        return res.status(500).json({ success: false, error: String(e && e.message ? e.message : e) });
    }
});

// ============= WALLET ENDPOINTS =============

router.post('/api/wallet', async (req, res) => {
    try {
        const walletData = {
            id: req.body.id || uuidv4(),
            user_id: req.body.user_id,
            address: req.body.address.toLowerCase(),
            chain: req.body.chain,
            balance: req.body.balance || 0,
            balances: req.body.balances || {},
            is_primary: req.body.is_primary || false,
            timestamp: Date.now(),
            created_at: new Date(),
            updated_at: new Date()
        };
        const wallet = await db.createWallet(walletData);
        res.status(201).json(wallet);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/api/wallet/:userId', async (req, res) => {
    try {
        const wallets = await db.getUserWallets(req.params.userId);
        res.json(wallets);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/api/wallet/address/:address', async (req, res) => {
    try {
        const wallet = await db.getWalletByAddress(req.params.address);
        if (!wallet) return res.status(404).json({ error: 'Wallet not found' });
        res.json(wallet);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST get balance by user_id or address
async function handleGetBalance(req, res) {

    try {
        console.log('[api] POST /api/wallet/getbalance called with body:', req.body);
        const remoteAddr = req.headers['x-forwarded-for'] || (req.connection && req.connection.remoteAddress) || req.ip || 'unknown';
        console.log(`[api] /api/wallet/getbalance request from ${remoteAddr}`);
        // Accept legacy param names from older frontends: userid, user_id, uid
        const body = req.body || {};
        const address = body.address || body.addr || null;
        const user_id = body.user_id || body.userid || body.uid || body.userId || null;

        if (!user_id && !address) {
            return res.status(400).json({ error: 'Provide user_id/(userid/uid) or address in request body' });
        }

        // If both user_id and address are present, prefer user_id (db user balances take precedence)
        if (address && !user_id) {
            const wallet = await db.getWalletByAddress(address);
            if (!wallet) return res.status(404).json({ error: 'Wallet not found' });
            const walletBalances = wallet.balances || {};
            const payload = Object.assign({}, walletBalances, { total_balance: Number(wallet.balance) || 0, wallets: [wallet] });
            return res.json({ code: 1, data: payload });
        }

        // PRIORITY: Check User record's balances first (these are updated by topup approvals)
        const userRecord = await db.getUserById(user_id);
        if (userRecord && userRecord.balances && Object.keys(userRecord.balances).length > 0) {
            // User has balances stored on their record - use these (they're updated by admin topup approvals)
            const userBalances = userRecord.balances;
            const totalFromUser = Object.keys(userBalances).reduce((acc, k) => acc + (Number(userBalances[k]) || 0), 0);
            console.log('[api] /api/wallet/getbalance - returning User record balances:', userBalances);
            return res.json({ code: 1, data: Object.assign({}, userBalances, { total_balance: totalFromUser, wallets: [] }) });
        }

        // FALLBACK: Aggregate wallets for user if no user balances exist
        const wallets = await db.getUserWallets(user_id);
        if (!wallets || wallets.length === 0) {
            // No wallet documents and no user balances - return empty structured response
            return res.json({ code: 1, data: { usdt: 0, btc: 0, eth: 0, usdc: 0, pyusd: 0, sol: 0, total_balance: 0, wallets: [] } });
        }

        // sum numeric balances from wallet documents
        let totalBalance = 0;
        const aggregated = {};
        wallets.forEach(w => {
            const b = Number(w.balance) || 0;
            totalBalance += b;
            if (w.balances && typeof w.balances === 'object') {
                Object.keys(w.balances).forEach(k => {
                    aggregated[k] = (aggregated[k] || 0) + (Number(w.balances[k]) || 0);
                });
            }
        });

        // Return flat balance keys so assets.html can read them as `res.data` or `res`
        const normalized = Object.assign({ usdt: 0, btc: 0, eth: 0, usdc: 0, pyusd: 0, sol: 0 }, aggregated, { total_balance: totalBalance, wallets });
        res.json({ code: 1, data: normalized });
    } catch (e) {
        console.error('[api] /api/wallet/getbalance error:', e);
        res.status(500).json({ error: e.message });
    }
}

router.post('/api/wallet/getbalance', handleGetBalance);
router.post('/api/Wallet/getbalance', handleGetBalance);

// ============= GET COIN DATA ENDPOINTS =============

// GET /api/Wallet/getcoin_all_data - Fetch all coin price data from external API or fallback
router.post(['/api/Wallet/getcoin_all_data', '/api/wallet/getcoin_all_data'], (req, res) => {
    try {
        const externalApiUrls = [
            'https://api.bvoxf.com/api/Wallet/getcoin_all_data'
            //'https://api.bitcryptoforest.com/api/kline/getAllProduct'
        ];

        const tryProxy = (index) => {
            if (index >= externalApiUrls.length) {
                // External APIs unavailable — return a small local fallback dataset with realistic prices
                const sampleData = [
                    { symbol: 'btcusdt', close: 95000 },      // BTC ~$95,000
                    { symbol: 'ethusdt', close: 3500 },       // ETH ~$3,500
                    { symbol: 'usdcusdt', close: 1.00 },      // USDC = $1.00
                    { symbol: 'pyusdusdt', close: 1.00 },     // PYUSD = $1.00
                    { symbol: 'solusdt', close: 180 }         // SOL ~$180
                ];

                const fallback = {
                    code: 1,
                    data: {
                        data: sampleData
                    }
                };

                console.warn('[getcoin_all_data] External APIs down — returning local fallback prices');
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(fallback));
                return;
            }

            const externalApiUrl = externalApiUrls[index];
            
            const externalReq = https.request(externalApiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Content-Length': 0
                }
            }, (externalRes) => {
                let responseData = '';
                externalRes.on('data', chunk => { responseData += chunk; });
                externalRes.on('end', () => {
                    // If external returns 200, forward it; otherwise try next
                    if (externalRes.statusCode >= 200 && externalRes.statusCode < 300) {
                        res.writeHead(externalRes.statusCode, { 'Content-Type': 'application/json' });
                        res.end(responseData);
                    } else {
                        // Only log non-200 responses
                        try {
                            const snippet = responseData ? responseData.substring(0, 300) : '';
                            console.error('[getcoin_all_data] External response error from', externalApiUrl, 'status=', externalRes.statusCode, 'bodySnippet=', snippet.replace(/\n/g, '\\n'));
                        } catch (logErr) {
                            console.error('[getcoin_all_data] Error logging external response:', logErr.message);
                        }
                        tryProxy(index + 1);
                    }
                });
            });

            externalReq.on('error', (err) => {
                console.error('[getcoin_all_data] External request error for', externalApiUrl, ':', err.message);
                tryProxy(index + 1);
            });

            externalReq.end();
        };

        tryProxy(0);
    } catch (e) {
        console.error('[getcoin_all_data] Error:', e.message);
        res.status(400).json({ code: 0, data: e.message });
    }
});

// ============= KYC ENDPOINTS =============

router.post('/api/kyc', async (req, res) => {
    try {
        const kycData = {
            id: req.body.id || `kyc_${Date.now()}_${uuidv4().substring(0, 9)}`,
            user_id: req.body.user_id,
            full_name: req.body.full_name,
            date_of_birth: req.body.date_of_birth,
            nationality: req.body.nationality,
            document_type: req.body.document_type,
            document_number: req.body.document_number,
            document_image_url: req.body.document_image_url,
            selfie_url: req.body.selfie_url,
            status: req.body.status || 'pending',
            timestamp: Date.now(),
            created_at: new Date(),
            updated_at: new Date()
        };
        const kyc = await db.createKYCRecord(kycData);
        res.status(201).json(kyc);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/api/kyc/:userId', async (req, res) => {
    try {
        const kyc = await db.getUserKYCRecord(req.params.userId);
        if (!kyc) return res.status(404).json({ error: 'KYC record not found' });
        res.json(kyc);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.put('/api/kyc/:userId/verify', async (req, res) => {
    try {
        const { status, rejectionReason } = req.body;
        const updated = await db.updateKYCStatus(req.params.userId, status, rejectionReason);
        if (!updated) return res.status(404).json({ error: 'KYC record not found' });
        res.json(updated);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ============= ARBITRAGE ENDPOINTS =============

router.get('/api/arbitrage/stats', async (req, res) => {
    try {
        const user_id = req.query.user_id || req.body.user_id;
        if (!user_id) return res.status(400).json({ code: 0, data: 'Missing user_id' });
        
        const ArbitrageSubscription = require('../models/ArbitrageSubscription');
        const subscriptions = await ArbitrageSubscription.find({ user_id: user_id }).lean();
        
        if (!subscriptions || subscriptions.length === 0) {
            return res.json({ code: 1, info: 'success', data: {
                total_jine: 0,
                recent_jine: 0,
                total_shuliang: 0
            }});
        }
        
        const total_jine = subscriptions.reduce((sum, sub) => sum + (Number(sub.amount) || 0), 0);
        const recent_jine = subscriptions[subscriptions.length - 1]?.amount || 0;
        const total_shuliang = subscriptions.length;
        
        res.json({ code: 1, info: 'success', data: { total_jine, recent_jine, total_shuliang }});
    } catch (e) {
        res.status(500).json({ code: 0, data: e.message });
    }
});

router.get('/api/arbitrage/products', async (req, res) => {
    try {
        const ArbitrageProduct = require('../models/ArbitrageProduct');
        let products = await ArbitrageProduct.find({ status: 'active' }).lean();
        
        if (!products || products.length === 0) {
            // Return seed data if database is empty - format matches what ai-arbitrage.html expects
            products = [
                {
                    id: '1',
                    name: 'Smart Plan A',
                    duration: '1 Day',
                    duration_days: 1,
                    min_amount: 500,
                    max_amount: 5000,
                    daily_return_min: 1.60,
                    daily_return_max: 1.80,
                    times: 1,
                    arbitrage_types: ['BTC', 'ETH', 'USDT', 'USDC', 'PYUSD'],
                    image: 'tl1.jpg',
                    status: 'active'
                },
                {
                    id: '2',
                    name: 'Smart Plan B',
                    duration: '3 Days',
                    duration_days: 3,
                    min_amount: 5001,
                    max_amount: 30000,
                    daily_return_min: 1.90,
                    daily_return_max: 2.60,
                    times: 1,
                    arbitrage_types: ['BTC', 'ETH', 'USDT', 'USDC', 'PYUSD'],
                    image: 'tl1.jpg',
                    status: 'active'
                },
                {
                    id: '3',
                    name: 'Smart Plan C',
                    duration: '7 Days',
                    duration_days: 7,
                    min_amount: 30001,
                    max_amount: 100000,
                    daily_return_min: 2.80,
                    daily_return_max: 3.20,
                    times: 1,
                    arbitrage_types: ['BTC', 'ETH', 'USDT', 'USDC', 'PYUSD'],
                    image: 'tl1.jpg',
                    status: 'active'
                },
                {
                    id: '4',
                    name: 'Smart Plan D',
                    duration: '15 Days',
                    duration_days: 15,
                    min_amount: 100001,
                    max_amount: 500000,
                    daily_return_min: 3.50,
                    daily_return_max: 5.30,
                    times: 1,
                    arbitrage_types: ['BTC', 'ETH', 'USDT', 'USDC', 'PYUSD'],
                    image: 'tl1.jpg',
                    status: 'active'
                },
                {
                    id: '5',
                    name: 'Smart Plan VIP',
                    duration: '30 Days',
                    duration_days: 30,
                    min_amount: 500001,
                    max_amount: 1000000,
                    daily_return_min: 5.80,
                    daily_return_max: 6.30,
                    times: 1,
                    arbitrage_types: ['BTC', 'ETH', 'USDT', 'USDC', 'PYUSD'],
                    image: 'tl2.jpg',
                    status: 'active'
                }
            ];
        }
        
        res.json({ success: true, products: products });
    } catch (e) {
        console.error('[arbitrage/products] error:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// GET single arbitrage product by ID
router.get('/api/arbitrage/product/:id', async (req, res) => {
    try {
        const productId = req.params.id;
        if (!productId) {
            return res.status(400).json({ success: false, error: 'Product ID required' });
        }
        
        const ArbitrageProduct = require('../models/ArbitrageProduct');
        
        // Try to find by MongoDB _id first, then by custom id field
        let product = await ArbitrageProduct.findById(productId).lean().catch(() => null);
        
        if (!product) {
            product = await ArbitrageProduct.findOne({ id: productId }).lean();
        }
        
        // If no product found in DB, return seed data for backward compatibility
        if (!product) {
            const seedProducts = {
                '1': {
                    id: '1',
                    name: 'Smart Plan A',
                    duration: '1 Day',
                    duration_days: 1,
                    min_amount: 500,
                    max_amount: 5000,
                    daily_return_min: 1.60,
                    daily_return_max: 1.80,
                    times: 1,
                    arbitrage_types: ['BTC', 'ETH', 'USDT', 'USDC', 'PYUSD'],
                    image: 'tl1.jpg',
                    status: 'active'
                },
                '2': {
                    id: '2',
                    name: 'Smart Plan B',
                    duration: '3 Days',
                    duration_days: 3,
                    min_amount: 5001,
                    max_amount: 30000,
                    daily_return_min: 1.90,
                    daily_return_max: 2.60,
                    times: 1,
                    arbitrage_types: ['BTC', 'ETH', 'USDT', 'USDC', 'PYUSD'],
                    image: 'tl1.jpg',
                    status: 'active'
                },
                '3': {
                    id: '3',
                    name: 'Smart Plan C',
                    duration: '7 Days',
                    duration_days: 7,
                    min_amount: 30001,
                    max_amount: 100000,
                    daily_return_min: 2.80,
                    daily_return_max: 3.20,
                    times: 1,
                    arbitrage_types: ['BTC', 'ETH', 'USDT', 'USDC', 'PYUSD'],
                    image: 'tl1.jpg',
                    status: 'active'
                },
                '4': {
                    id: '4',
                    name: 'Smart Plan D',
                    duration: '15 Days',
                    duration_days: 15,
                    min_amount: 100001,
                    max_amount: 500000,
                    daily_return_min: 3.50,
                    daily_return_max: 5.30,
                    times: 1,
                    arbitrage_types: ['BTC', 'ETH', 'USDT', 'USDC', 'PYUSD'],
                    image: 'tl1.jpg',
                    status: 'active'
                },
                '5': {
                    id: '5',
                    name: 'Smart Plan VIP',
                    duration: '30 Days',
                    duration_days: 30,
                    min_amount: 500001,
                    max_amount: 1000000,
                    daily_return_min: 5.80,
                    daily_return_max: 6.30,
                    times: 1,
                    arbitrage_types: ['BTC', 'ETH', 'USDT', 'USDC', 'PYUSD'],
                    image: 'tl2.jpg',
                    status: 'active'
                }
            };
            
            product = seedProducts[productId];
        }
        
        if (!product) {
            return res.status(404).json({ success: false, error: 'Product not found' });
        }
        
        res.json({ success: true, product: product });
    } catch (e) {
        console.error('[arbitrage/product/:id] error:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

router.post('/api/arbitrage/subscribe', async (req, res) => {
    try {
        const { user_id, product_id, amount } = req.body;
        
        // Validate required fields
        if (!user_id || !product_id || !amount) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }
        
        const investAmount = parseFloat(amount);
        if (isNaN(investAmount) || investAmount <= 0) {
            return res.status(400).json({ success: false, message: 'Invalid amount' });
        }
        
        // Fetch product from database
        const ArbitrageProduct = require('../models/ArbitrageProduct');
        let product = await ArbitrageProduct.findById(product_id).lean().catch(() => null);
        
        if (!product) {
            product = await ArbitrageProduct.findOne({ id: product_id }).lean();
        }
        
        // If no product in DB, check seed data
        if (!product) {
            const seedProducts = {
                '1': { id: '1', name: 'Smart Plan A', min_amount: 500, max_amount: 5000, duration_days: 1, daily_return_min: 1.60, daily_return_max: 1.80 },
                '2': { id: '2', name: 'Smart Plan B', min_amount: 5001, max_amount: 30000, duration_days: 3, daily_return_min: 1.90, daily_return_max: 2.60 },
                '3': { id: '3', name: 'Smart Plan C', min_amount: 30001, max_amount: 100000, duration_days: 7, daily_return_min: 2.80, daily_return_max: 3.20 },
                '4': { id: '4', name: 'Smart Plan D', min_amount: 100001, max_amount: 500000, duration_days: 15, daily_return_min: 3.50, daily_return_max: 5.30 },
                '5': { id: '5', name: 'Smart Plan VIP', min_amount: 500001, max_amount: 1000000, duration_days: 30, daily_return_min: 5.80, daily_return_max: 6.30 }
            };
            product = seedProducts[product_id];
        }
        
        if (!product) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }
        
        // Validate amount is within min/max range
        if (investAmount < product.min_amount || investAmount > product.max_amount) {
            return res.status(400).json({ 
                success: false, 
                message: `Amount must be between $${product.min_amount} and $${product.max_amount}` 
            });
        }
        
        // Fetch user by id, userid, or uid field
        const User = require('../models/User');
        let user = await User.findOne({ $or: [
            { id: user_id },
            { userid: user_id },
            { uid: user_id }
        ] }).lean();
        
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        
        const currentUsdt = parseFloat(user.balances?.usdt) || 0;
        if (currentUsdt < investAmount) {
            return res.status(400).json({ 
                success: false, 
                message: `Insufficient USDT balance. You have $${currentUsdt.toFixed(2)} but need $${investAmount.toFixed(2)}` 
            });
        }
        
        // Calculate profit based on average daily return
        const dailyReturnMin = parseFloat(product.daily_return_min) || 0;
        const dailyReturnMax = parseFloat(product.daily_return_max) || 0;
        const avgDailyReturn = (dailyReturnMin + dailyReturnMax) / 2;
        const durationDays = parseInt(product.duration_days) || 1;
        const totalReturnPercent = avgDailyReturn * durationDays;
        const totalIncome = (investAmount * totalReturnPercent) / 100;
        
        // Create subscription record
        const ArbitrageSubscription = require('../models/ArbitrageSubscription');
        const subscription = new ArbitrageSubscription({
            id: `arb_sub_${Date.now()}_${uuidv4().substring(0, 9)}`,
            user_id: user_id,
            product_id: product_id,
            product_name: product.name,
            amount: investAmount,
            earned: 0,
            days_completed: 0,
            daily_return_min: dailyReturnMin,
            daily_return_max: dailyReturnMax,
            total_return_percent: totalReturnPercent,
            total_income: totalIncome,
            status: 'active',
            start_date: new Date(),
            end_date: new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000),
            timestamp: Date.now(),
            created_at: new Date(),
            updated_at: new Date()
        });
        
        const savedSubscription = await subscription.save();
        console.log(`[arbitrage-subscribe] ✓ Created subscription ${savedSubscription.id} for user ${user_id}, amount: ${investAmount}`);
        
        // Deduct USDT from user balance - find user by any of the ID fields
        const userDoc = await User.findOne({ $or: [
            { id: user_id },
            { userid: user_id },
            { uid: user_id }
        ] });
        
        if (userDoc) {
            const newUsdt = Math.round((currentUsdt - investAmount) * 100) / 100;
            userDoc.balances = userDoc.balances || {};
            userDoc.balances.usdt = newUsdt;
            await userDoc.save();
            console.log(`[arbitrage-subscribe] ✓ Deducted ${investAmount} USDT from user ${user_id}. New balance: ${newUsdt}`);
        } else {
            console.error(`[arbitrage-subscribe] ⚠ Could not find user ${user_id} to deduct balance`);
        }
        
        // Log as topup record (negative amount for audit trail)
        try {
            const Topup = require('../models/Topup');
            await Topup.create({
                id: `topup_${Date.now()}`,
                user_id: user_id,
                coin: 'USDT',
                amount: -investAmount,
                status: 'complete',
                timestamp: Date.now(),
                created_at: new Date()
            });
        } catch (e) {
            console.error('[arbitrage-subscribe] Failed to create topup record:', e.message);
            // Continue even if ledger fails
        }
        
        // Return success response
        res.status(201).json({ 
            success: true, 
            subscription: {
                id: savedSubscription._id,
                user_id: savedSubscription.user_id,
                product_id: savedSubscription.product_id,
                product_name: savedSubscription.product_name,
                amount: savedSubscription.amount,
                total_income: savedSubscription.total_income,
                total_return_percent: savedSubscription.total_return_percent,
                duration_days: durationDays,
                status: savedSubscription.status,
                start_date: savedSubscription.start_date,
                end_date: savedSubscription.end_date
            }
        });
    } catch (e) {
        console.error('[arbitrage-subscribe] Error:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

// GET user's arbitrage subscriptions (legacy endpoint for ui compatibility)
router.get('/api/arbitrage/subscriptions', async (req, res) => {
    try {
        const user_id = req.query.user_id || req.body.user_id;
        
        if (!user_id) {
            return res.status(400).json({ success: false, message: 'Missing user_id parameter' });
        }
        
        const ArbitrageSubscription = require('../models/ArbitrageSubscription');
        const subscriptions = await ArbitrageSubscription.find({ user_id: user_id }).lean().sort({ created_at: -1 });
        
        if (!subscriptions) {
            return res.json({ success: true, subscriptions: [] });
        }
        
        res.json({ 
            success: true, 
            subscriptions: subscriptions.map(sub => ({
                id: sub._id,
                user_id: sub.user_id,
                product_id: sub.product_id,
                product_name: sub.product_name,
                amount: sub.amount,
                earned: sub.earned || 0,
                days_completed: sub.days_completed || 0,
                total_income: sub.total_income || 0,
                total_return_percent: sub.total_return_percent || 0,
                status: sub.status,
                start_date: sub.start_date,
                end_date: sub.end_date,
                created_at: sub.created_at,
                updated_at: sub.updated_at
            }))
        });
    } catch (e) {
        console.error('[arbitrage/subscriptions] Error:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

router.get('/api/arbitrage/:userId', async (req, res) => {
    try {
        const subscriptions = await db.getUserArbitrageSubscriptions(req.params.userId);
        res.json(subscriptions);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.put('/api/arbitrage/:subscriptionId/payout', async (req, res) => {
    try {
        const { earned } = req.body;
        const updated = await db.updateSubscriptionPayout(req.params.subscriptionId, earned);
        if (!updated) return res.status(404).json({ error: 'Subscription not found' });
        res.json(updated);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ============= NOTIFICATION ENDPOINTS =============

router.post('/api/notification', async (req, res) => {
    try {
        const notificationData = {
            id: req.body.id || `notif_${Date.now()}_${uuidv4().substring(0, 9)}`,
            user_id: req.body.user_id,
            title: req.body.title,
            message: req.body.message,
            type: req.body.type,
            read: req.body.read || false,
            link: req.body.link,
            timestamp: Date.now(),
            created_at: new Date(),
            updated_at: new Date()
        };
        const notification = await db.createNotification(notificationData);
        res.status(201).json(notification);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/api/notification/:userId', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 20;
        const notifications = await db.getUserNotifications(req.params.userId, limit);
        res.json(notifications);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.put('/api/notification/:notificationId/read', async (req, res) => {
    try {
        const updated = await db.markNotificationAsRead(req.params.notificationId);
        if (!updated) return res.status(404).json({ error: 'Notification not found' });
        res.json(updated);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ================= Loan & Wallet image endpoints (DB-backed) =================

// POST /api/Wallet/getloaned - return loan summary AND records for a user (DB-backed)
router.post(['/api/Wallet/getloaned', '/api/wallet/getloaned'], async (req, res) => {
    try {
        const body = req.body || {};
        const userid = body.userid || body.user_id;
        if (!userid) return res.status(400).json({ code: 0, data: 'Missing userid' });

        console.log('[api][Wallet/getloaned] Fetching loans for user:', userid);

        // try to load user to get loan quota if present
        const user = await db.getUserById(userid).catch(()=>null) || {};
        const loanQuota = Number(user.loan_quota || user.loan_limit || (user.meta && user.meta.loan_quota) || 1000);
        
        console.log('[api][Wallet/getloaned] User found, quota:', loanQuota);

        const loans = await db.getUserLoans(userid);
        console.log('[api][Wallet/getloaned] Loans count:', loans ? loans.length : 0);
        
        const total_jine = (loans || []).reduce((s, r) => s + (Number(r.amount) || 0), 0);
        const total_weihuan = (loans || []).reduce((s, r) => {
            const st = (r.status || '').toLowerCase();
            if (st === 'completed' || st === 'repaid' || st === 'redeemed' || st === 'returned') return s;
            return s + (Number(r.amount) || 0);
        }, 0);

        console.log('[api][Wallet/getloaned] Totals - jine:', total_jine, 'weihuan:', total_weihuan);

        // NEW: Return both summary stats AND actual loan records
        const responseData = {
            code: 1, 
            data: { 
                edu: loanQuota, 
                total_jine, 
                total_weihuan,
                records: (loans || []).map(loan => ({
                    id: loan.id || loan._id,
                    user_id: loan.user_id || loan.userid,
                    amount: Number(loan.amount) || 0,
                    interest_rate: Number(loan.interest_rate) || Number(loan.lixi) || 0,
                    duration_days: Number(loan.duration_days) || Number(loan.tianshu) || 0,
                    total_repay: Number(loan.total_repay) || (Number(loan.amount) || 0) + (Number(loan.interest_rate) || 0),
                    status: loan.status || 'pending',
                    created_at: loan.created_at || loan.createdAt || new Date().toISOString(),
                    updated_at: loan.updated_at || loan.updatedAt || new Date().toISOString()
                }))
            }
        };
        
        console.log('[api][Wallet/getloaned] Sending response');
        return res.json(responseData);
    } catch (e) {
        console.error('[api][Wallet/getloaned] error:', e && e.message);
        console.error('[api][Wallet/getloaned] stack:', e && e.stack);
        return res.status(500).json({ code: 0, data: 'Server error' });
    }
});

// POST /api/Wallet/addloan - submit loan application (DB-backed)
router.post(['/api/Wallet/addloan', '/api/wallet/addloan'], async (req, res) => {
    try {
        const body = req.body || {};
        const userid = body.userid;
        const username = body.username;
        const shuliang = Number(body.shuliang) || 0;
        const tianshu = parseInt(body.tianshu) || 0;
        const lixi = Number(body.lixi) || 0;
        const zfxx = body.zfxx || '';
        const srzm = body.srzm || '';
        const yhxx = body.yhxx || '';
        const sfz = body.sfz || '';

        if (!userid || !username || !shuliang || !tianshu) return res.status(400).json({ code: 0, data: 'Missing required fields' });

        const loanData = {
            id: `loan_${Date.now()}`,
            user_id: userid,
            amount: shuliang,
            interest_rate: lixi || 0,
            duration_days: tianshu,
            total_repay: Number(shuliang) + Number(lixi) || 0,
            status: 'pending',
            disbursed_date: null,
            due_date: null,
            repay_date: null,
            timestamp: Date.now(),
            created_at: new Date(),
            updated_at: new Date(),
            meta: { images: { zfxx, srzm, yhxx, sfz }, username }
        };

        const created = await db.createLoan(loanData);
        if (!created) return res.status(500).json({ code: 0, data: 'Failed to create loan' });
        return res.json({ code: 1, data: 'Application submitted', loan: created });
    } catch (e) {
        console.error('[api][Wallet/addloan] error:', e && e.message);
        return res.status(500).json({ code: 0, data: 'Server error' });
    }
});

// POST /api/Wallet/upload_image - accept multipart/form-data without adding multer
router.post(['/api/Wallet/upload_image', '/api/wallet/upload_image'], (req, res) => {
    try {
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
            try {
                if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
                const contentType = (req.headers['content-type'] || '').toString();
                const buffer = Buffer.concat(chunks || []);
                let fileBuffer = buffer;
                let ext = '.png';

                if (contentType.indexOf('multipart/form-data') !== -1) {
                    const m = contentType.match(/boundary=(.*)$/);
                    const boundary = m ? ('--' + m[1]) : null;
                    if (boundary) {
                        const startIdx = buffer.indexOf(Buffer.from('\r\n\r\n'));
                        if (startIdx !== -1) {
                            const fileStart = startIdx + 4;
                            const boundaryBuf = Buffer.from('\r\n' + boundary);
                            const endIdx = buffer.indexOf(boundaryBuf, fileStart);
                            const fileEnd = endIdx !== -1 ? endIdx : buffer.length;
                            fileBuffer = buffer.slice(fileStart, fileEnd);
                        }
                        const headerPart = buffer.slice(0, startIdx > -1 ? startIdx : 0).toString();
                        const ctMatch = headerPart.match(/Content-Type:\s*([^\r\n]+)/i);
                        if (ctMatch) {
                            const mime = ctMatch[1].trim().toLowerCase();
                            if (mime.includes('png')) ext = '.png';
                            else if (mime.includes('jpeg') || mime.includes('jpg')) ext = '.jpg';
                            else if (mime.includes('gif')) ext = '.gif';
                        }
                    }
                }

                const filename = 'proof_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9) + ext;
                const uploadPath = path.join(UPLOADS_DIR, filename);
                fs.writeFileSync(uploadPath, fileBuffer);
                const fileUrl = '/uploads/' + filename;
                return res.json({ code: 1, data: fileUrl, message: 'Image uploaded successfully' });
            } catch (err) {
                console.error('[api][Wallet/upload_image] error:', err && err.message);
                return res.status(500).json({ code: 0, data: err.message });
            }
        });
    } catch (e) {
        console.error('[api][Wallet/upload_image] outer error:', e && e.message);
        return res.status(500).json({ code: 0, data: 'Server error' });
    }
});

// ============= TRADING ENDPOINTS =============

// POST /api/trade/buy - Create a new trade order
router.post('/api/trade/buy', async (req, res) => {
    try {
        const { userid, username, fangxiang, miaoshu, biming, num, buyprice, syl, zengjia, jianshao } = req.body;

        if (!userid || !username || !biming || !num || !buyprice) {
            return res.status(400).json({ code: 0, data: 'Missing required fields' });
        }

        // Check if user has sufficient balance
        const User = require('../models/User');
        const user = await User.findOne({
            $or: [
                { userid: String(userid) },
                { uid: String(userid) },
                { wallet_address: String(userid).toLowerCase() }
            ]
        });

        if (!user) {
            return res.status(400).json({ code: 0, data: 'User not found' });
        }

        const stake = parseFloat(num) || 0;
        let currentBalance = 0;

        // Determine USDT balance
        if (user.balances && typeof user.balances.usdt !== 'undefined') {
            currentBalance = parseFloat(user.balances.usdt) || 0;
        } else if (user.balance !== undefined) {
            currentBalance = parseFloat(user.balance) || 0;
        }

        if (currentBalance < stake) {
            return res.status(400).json({ code: 0, data: 'Insufficient balance' });
        }

        // Create trade record
        const Trade = require('../models/Trade');
        const tradeRecord = new Trade({
            id: Date.now().toString(),
            userid: String(userid),
            username,
            biming: String(biming).toLowerCase(),
            fangxiang: String(fangxiang),
            miaoshu: Number(miaoshu),
            num: stake,
            buyprice: parseFloat(buyprice),
            syl: parseFloat(syl) || 40,
            zengjia: parseFloat(zengjia),
            jianshao: parseFloat(jianshao),
            status: 'pending',
            forcedOutcome: null,
            settlement_applied: false
        });
        // If the user is flagged to force wins, mark this trade to be forced as a win
        try {
            if (user && user.force_trade_win) {
                tradeRecord.forcedOutcome = 'win';
                console.log('[trade/buy] Marking trade as forced win due to user flag for user', userid);
            }
        } catch (e) {}

        await tradeRecord.save();

        // Update user's total_invested
        user.total_invested = Number((parseFloat(user.total_invested || 0) + stake).toFixed(2));
        await user.save();

        console.log('[trade/buy] ✓ Trade created:', tradeRecord.id, 'for user', userid);
        return res.json({ code: 1, data: tradeRecord.id });
    } catch (e) {
        console.error('[trade/buy] error:', e.message);
        return res.status(500).json({ code: 0, data: e.message });
    }
});

// POST /api/trade/getorder - Get trade order status (for client win/loss determination)
router.post('/api/trade/getorder', async (req, res) => {
    try {
        const orderId = req.body.id;
        if (!orderId) return res.status(400).json({ code: 0, data: 'Missing order id' });

        const Trade = require('../models/Trade');
        const mongoose = require('mongoose');
        // Avoid attempting to match _id when orderId is not a valid ObjectId
        const queryOr = [{ id: orderId }];
        if (mongoose.Types.ObjectId.isValid(orderId)) queryOr.push({ _id: orderId });
        const trade = await Trade.findOne({ $or: queryOr });

        let orderStatus = 0; // Default: unspecified

        if (trade) {
            // Determine duration and whether trade has matured
            let createdTs = 0;
            try {
                if (trade.created_at) {
                    const d = new Date(trade.created_at);
                    if (Number.isFinite(d.getTime())) createdTs = d.getTime();
                }
            } catch (e) { createdTs = 0; }

            const elapsedSec = Number.isFinite(createdTs) ? Math.floor((Date.now() - createdTs) / 1000) : 0;
            let duration = 0;
            try {
                if (Array.isArray(trade.miaoshu)) duration = Number(trade.miaoshu[0]) || 0;
                else duration = Number(trade.miaoshu) || 0;
            } catch (e) { duration = 0; }

            const matured = (duration > 0 && elapsedSec >= duration) || !!trade.settlement_applied;

            // PRIORITY 1: If forced outcome exists and trade has matured (or already settled), use it
            if (trade.forcedOutcome && matured) {
                orderStatus = String(trade.forcedOutcome) === 'win' ? 1 : 2;
                console.log('[trade/getorder] Forced outcome (matured):', orderStatus, 'for trade', orderId);
            }
            // PRIORITY 2: If already settled, return settlement status
            else if (trade.status === 'win') {
                orderStatus = 1;
            } else if (trade.status === 'loss') {
                orderStatus = 2;
            }
            // PRIORITY 3: Pending - keep returning 0 (don't reveal forcedOutcome early)
            else if (trade.status === 'pending') {
                orderStatus = 0;
            }
        }

        console.log('[trade/getorder] Returning status=' + orderStatus + ' for orderId=' + orderId);
        return res.json({ code: 1, data: orderStatus });
    } catch (e) {
        console.error('[trade/getorder] error:', e.message);
        return res.status(500).json({ code: 0, data: e.message });
    }
});

// POST /api/trade/setordersy - Apply trade settlement (win/loss to balance)
router.post('/api/trade/setordersy', async (req, res) => {
    try {
        const orderId = req.body.id;
        const shuying = req.body.shuying; // 1 = win, 2 = loss

        if (!orderId) return res.status(400).json({ code: 0, data: 'Missing order id' });

        const Trade = require('../models/Trade');
        const mongoose = require('mongoose');
        const queryOr2 = [{ id: orderId }];
        if (mongoose.Types.ObjectId.isValid(orderId)) queryOr2.push({ _id: orderId });
        const trade = await Trade.findOne({ $or: queryOr2 });

        if (!trade) {
            return res.status(404).json({ code: 0, data: 'Trade not found' });
        }

        // If trade has forcedOutcome, use that instead
        let finalStatus = shuying === 1 ? 'win' : 'loss';
        if (trade.forcedOutcome) {
            finalStatus = String(trade.forcedOutcome) === 'win' ? 'win' : 'loss';
            console.log('[trade/setordersy] Overriding with forcedOutcome:', finalStatus, 'for trade', orderId);
        }

        // Prevent double-application
        if (!trade.settlement_applied) {
            trade.status = finalStatus;
            trade.settlement_applied = true;

            // Apply balance changes
            const User = require('../models/User');
            const user = await User.findOne({
                $or: [
                    { userid: String(trade.userid) },
                    { uid: String(trade.userid) },
                    { wallet_address: String(trade.userid).toLowerCase() }
                ]
            });

            if (user) {
                const invested = parseFloat(trade.num) || 0;
                const profitRatio = parseFloat(trade.syl) || 40;

                if (finalStatus === 'win') {
                    // On WIN: Add only the profit amount
                    const profit = Number((invested * (profitRatio / 100)).toFixed(2));
                    if (user.balances && typeof user.balances.usdt !== 'undefined') {
                        user.balances.usdt = Number((parseFloat(user.balances.usdt) + profit).toFixed(2));
                    } else {
                        user.balance = Number((parseFloat(user.balance || 0) + profit).toFixed(2));
                    }
                    user.total_income = Number(((parseFloat(user.total_income) || 0) + profit).toFixed(2));
                    trade.profit_loss = profit;
                    console.log('[trade/setordersy] WIN settlement: +' + profit + ' profit for user', trade.userid);
                } else {
                    // On LOSS: Deduct the full stake
                    if (user.balances && typeof user.balances.usdt !== 'undefined') {
                        user.balances.usdt = Number((parseFloat(user.balances.usdt) - invested).toFixed(2));
                    } else {
                        user.balance = Number((parseFloat(user.balance || 0) - invested).toFixed(2));
                    }
                    trade.profit_loss = -invested;
                    console.log('[trade/setordersy] LOSS settlement: -' + invested + ' stake deducted for user', trade.userid);
                }

                await user.save();
            }

            trade.updated_at = new Date();
            await trade.save();
        } else {
            trade.status = finalStatus;
            trade.updated_at = new Date();
            await trade.save();
        }

        return res.json({ code: 1, data: 'Order updated' });
    } catch (e) {
        console.error('[trade/setordersy] error:', e.message);
        return res.status(500).json({ code: 0, data: e.message });
    }
});

// POST /api/trade/getorderjs - Get trade profit/loss after settlement
router.post('/api/trade/getorderjs', async (req, res) => {
    try {
        const orderId = req.body.id;
        if (!orderId) return res.status(400).json({ code: 0, data: 'Missing order id' });

        const Trade = require('../models/Trade');
        const mongoose = require('mongoose');
        const queryOr3 = [{ id: orderId }];
        if (mongoose.Types.ObjectId.isValid(orderId)) queryOr3.push({ _id: orderId });
        const trade = await Trade.findOne({ $or: queryOr3 });

        let jine = 0; // Return amount

        // If trade exists but settlement hasn't been applied yet, and the trade duration has elapsed,
        // apply settlement deterministically using stored zengjia/jianshao targets so the client sees
        // an immediate final result after the local countdown completes.
        if (trade && !trade.settlement_applied) {
            try {
                // Determine duration safely
                let duration = 0;
                if (Array.isArray(trade.miaoshu)) duration = Number(trade.miaoshu[0]) || 0;
                else duration = Number(trade.miaoshu) || 0;

                const createdTs = trade.created_at ? new Date(trade.created_at).getTime() : 0;
                const elapsedSec = createdTs ? Math.floor((Date.now() - createdTs) / 1000) : 0;

                if (duration > 0 && elapsedSec >= duration) {
                    // Honor explicit forced outcome (per-trade or per-user) before deterministic target logic
                    let finalStatus = null;
                    if (trade.forcedOutcome) {
                        finalStatus = String(trade.forcedOutcome) === 'win' ? 'win' : 'loss';
                    } else {
                        // Also check user's force flag
                        try {
                            const User = require('../models/User');
                            const userRec = await User.findOne({ $or: [{ userid: String(trade.userid) }, { uid: String(trade.userid) }] });
                            if (userRec && userRec.force_trade_win) finalStatus = 'win';
                        } catch (e) {}
                    }

                    // If neither forced nor user-flagged, default to LOSS per business rule
                    if (!finalStatus) {
                        finalStatus = 'loss';
                        console.log('[trade/getorderjs] No forced outcome or user-level flag; defaulting to LOSS for trade', orderId);
                    }

                    // Apply settlement (mirror logic from setordersy)
                    const User = require('../models/User');
                    const user = await User.findOne({
                        $or: [
                            { userid: String(trade.userid) },
                            { uid: String(trade.userid) },
                            { wallet_address: String(trade.userid).toLowerCase() }
                        ]
                    });

                    const invested = parseFloat(trade.num) || 0;
                    const profitRatio = parseFloat(trade.syl) || 40;

                    if (user) {
                        if (finalStatus === 'win') {
                            const profit = Number((invested * (profitRatio / 100)).toFixed(2));
                            try {
                                await User.findOneAndUpdate(
                                    { $or: [{ userid: String(trade.userid) }, { uid: String(trade.userid) }, { wallet_address: String(trade.userid).toLowerCase() }] },
                                    { $inc: { 'balances.usdt': profit, 'total_income': profit } },
                                    { new: true }
                                );
                            } catch (e) { console.error('[trade/getorderjs] user balance update failed:', e && e.message); }
                            trade.profit_amount = profit;
                            jine = profit;
                        } else {
                            // Loss: deduct stake
                            try {
                                await User.findOneAndUpdate(
                                    { $or: [{ userid: String(trade.userid) }, { uid: String(trade.userid) }, { wallet_address: String(trade.userid).toLowerCase() }] },
                                    { $inc: { 'balances.usdt': -invested } },
                                    { new: true }
                                );
                            } catch (e) { console.error('[trade/getorderjs] user balance deduction failed:', e && e.message); }
                            trade.profit_amount = -invested;
                            jine = -invested;
                        }
                        try { await trade.save(); } catch (e) { console.error('[trade/getorderjs] failed saving trade:', e && e.message); }
                    }

                    trade.status = finalStatus === 'win' ? 'win' : 'loss';
                    trade.settlement_applied = true;
                    trade.final_price = finalStatus === 'win' ? (Number(trade.zengjia) || Number(trade.buyprice) || null) : (Number(trade.jianshao) || Number(trade.buyprice) || null);
                    trade.updated_at = new Date();
                    await trade.save();
                }
            } catch (e) {
                console.error('[trade/getorderjs] settlement fallback error:', e && e.message);
            }
        }

        if (trade && trade.settlement_applied) {
            const invested = parseFloat(trade.num) || 0;
            const profitRatio = parseFloat(trade.syl) || 40;
            if (trade.status === 'win') {
                jine = Number((invested * (profitRatio / 100)).toFixed(2));
            } else if (trade.status === 'loss') {
                jine = Number((-Math.abs(invested)).toFixed(2));
            }
        }

        return res.json({ code: 1, data: jine });
    } catch (e) {
        console.error('[trade/getorderjs] error:', e.message);
        return res.status(500).json({ code: 0, data: e.message });
    }
});

// GET /api/trade/records/:userid - Get user's trade records
router.get('/api/trade/records/:userid', async (req, res) => {
    try {
        const userid = req.params.userid;
        const Trade = require('../models/Trade');
        
        const trades = await Trade.find({
            userid: String(userid)
        }).sort({ created_at: -1 });

        const formatted = trades.map(t => ({
            id: t.id || t._id,
            userid: t.userid,
            username: t.username,
            biming: t.biming,
            fangxiang: t.fangxiang,
            miaoshu: t.miaoshu,
            num: t.num,
            buyprice: t.buyprice,
            syl: t.syl,
            zengjia: t.zengjia,
            jianshao: t.jianshao,
            status: t.status,
            settlement_applied: t.settlement_applied,
            settled_price: t.settled_price,
            created_at: t.created_at,
            updated_at: t.updated_at
        }));

        return res.json({ code: 1, data: formatted });
    } catch (e) {
        console.error('[trade/records] error:', e.message);
        return res.status(500).json({ code: 0, data: e.message });
    }
});

module.exports = router;

// === Legacy compatibility endpoints below ===

// Helper: proxy POST to external API
async function proxyPostExternal(externalUrl, req, res) {
    try {
        // Build body: if original content-type was json, send json; otherwise send form-urlencoded
        let bodyString = '';
        const contentType = (req.headers['content-type'] || '').toLowerCase();
        if (contentType.includes('application/json')) {
            bodyString = JSON.stringify(req.body || {});
        } else {
            // urlencoded
            bodyString = Object.keys(req.body || {}).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(req.body[k])).join('&');
        }

        const parsed = new URL(externalUrl);
        const options = {
            hostname: parsed.hostname,
            port: parsed.port || 443,
            path: parsed.pathname + (parsed.search || ''),
            method: 'POST',
            headers: {
                'Content-Type': contentType.includes('application/json') ? 'application/json' : 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(bodyString)
            }
        };

        const extReq = https.request(options, (extRes) => {
            let responseData = '';
            extRes.on('data', chunk => responseData += chunk);
            extRes.on('end', () => {
                res.status(extRes.statusCode).type('application/json').send(responseData);
            });
        });

        extReq.on('error', (err) => {
            console.error('[proxyPostExternal] error:', err.message);
            res.status(503).json({ code: 0, data: 'External API unavailable' });
        });

        extReq.write(bodyString);
        extReq.end();
    } catch (e) {
        console.error('[proxyPostExternal] exception:', e.message);
        res.status(500).json({ code: 0, data: e.message });
    }
}

// GET /api/user/get_nonce?address=...
router.get(['/api/user/get_nonce', '/api/user/get-nonce'], (req, res) => {
    try {
        const address = (req.query.address || req.query.addr || '').toString().toLowerCase();
        if (!address) return res.status(400).json({ code: 0, info: 'Missing address parameter' });

        const noncesFile = path.join(__dirname, '..', 'nonces.json');
        let nonces = {};
        try { if (fs.existsSync(noncesFile)) nonces = JSON.parse(fs.readFileSync(noncesFile, 'utf8') || '{}'); } catch (e) { nonces = {}; }

        const nonce = Math.floor(100000 + Math.random() * 900000).toString();
        nonces[address] = { nonce: nonce, expiresAt: Date.now() + 5 * 60 * 1000 };
        try { fs.writeFileSync(noncesFile, JSON.stringify(nonces, null, 2)); } catch (e) { console.error('Failed to write nonces.json', e.message); }

        res.json({ code: 1, data: nonce });
    } catch (e) {
        res.status(500).json({ code: 0, info: e.message });
    }
});

// POST /api/User/getsfxtz - check if user exists (legacy)
router.post(['/api/User/getsfxtz', '/api/user/getsfxtz'], async (req, res) => {
    try {
        const userId = req.body.userid || req.body.user_id || req.body.uid || req.body.id;
        if (!userId) return res.json({ code: 1, data: 0 });
        const user = await db.getUserById(userId);
        res.json({ code: 1, data: user ? 1 : 0 });
    } catch (e) {
        res.status(500).json({ code: 0, info: e.message });
    }
});

// POST /api/Trade/getcoin_data and /api/Trade/gettradlist proxy to external API
router.post(['/api/Trade/getcoin_data', '/api/trade/getcoin_data'], (req, res) => {
    const external = 'https://api.bvoxf.com/api/Trade/getcoin_data';
    proxyPostExternal(external, req, res);
});

router.post(['/api/Trade/gettradlist', '/api/trade/gettradlist'], (req, res) => {
    const external = 'https://api.bvoxf.com/api/Trade/gettradlist';
    proxyPostExternal(external, req, res);
});

// POST /api/Record/getcontract - return trades for user (legacy shape)
router.post(['/api/Record/getcontract', '/api/record/getcontract'], async (req, res) => {
    try {
        const userid = req.body.userid || req.body.user_id || req.body.uid;
        const page = Number(req.body.page || 1) || 1;
        const pageSize = 10;
        if (!userid) return res.status(400).json({ code: 0, data: [], message: 'Missing userid' });

        // Prefer DB trades if available
        const trades = await db.getUserTrades(userid, 1000);
        // Map to legacy shape
        const mapped = (trades || []).map(trade => {
            const num = Number(trade.num) || 0;
            const status = (trade.status || '').toString().toLowerCase();
            let fangxiang = 2;
            if (String(trade.fangxiang).toLowerCase() === 'up' || String(trade.fangxiang).toLowerCase() === 'upward' || String(trade.fangxiang) === '1') fangxiang = 1;
            if (String(trade.fangxiang) === '2' || String(trade.fangxiang).toLowerCase() === 'down' || String(trade.fangxiang).toLowerCase() === 'downward') fangxiang = 2;
            const zhuangtai = (status === 'pending' || status === '1') ? 1 : 0;
            const zuizhong = (status === 'win' || status === 'success' || status === '2') ? 1 : 0;
            const isloss = (status === 'loss' || status === '3') ? 1 : 0;
            let ying = num;
            if (isloss === 1) ying = -num;
            else if (zuizhong === 1) ying = Number(trade.payout || trade.settled_amount || num + (trade.profit || 0));
            const buytime = trade.created_at ? Math.floor(new Date(trade.created_at).getTime() / 1000) : (trade.buytime || 0);

            // Determine canonical profit percent (rate) to return to legacy frontends.
            // Prefer an explicit stored profit_percent / syl field. If stored rate looks like a price
            // (very large), fall back to duration mapping (60->40,120->50,180->70,300->100).
            const durationVal = Number(trade.miaoshu || trade.duration) || 0;
            let ratePercent = parseFloat(trade.profit_percent || trade.profit || trade.syl || trade.rate);
            if (!ratePercent || isNaN(ratePercent) || ratePercent <= 0 || ratePercent > 1000) {
                if (durationVal === 60) ratePercent = 40;
                else if (durationVal === 120) ratePercent = 50;
                else if (durationVal === 180) ratePercent = 70;
                else if (durationVal === 300) ratePercent = 100;
                else ratePercent = parseFloat(trade.syl) || 40;
            }

            // Compute 'ying' (matured payout) for legacy shape. If the trade was settled and marked as win (zuizhong),
            // prefer stored payout fields; otherwise compute from num + profitPercent.
            let payout = ying;
            if ((zuizhong === 1 || String(trade.status).toLowerCase() === 'win') ) {
                // Prefer explicit payout/settled_amount if present
                const storedPayout = parseFloat(trade.payout || trade.settled_amount || trade.settled_amount_usd || NaN);
                if (!isNaN(storedPayout) && storedPayout > 0) {
                    payout = Number(storedPayout);
                } else {
                    const profitAmt = Number((num * (Number(ratePercent) / 100)).toFixed(2));
                    payout = Number((num + profitAmt).toFixed(2));
                }
            }

            return {
                id: trade.id || trade._id,
                biming: trade.biming || trade.coin || '',
                num: num,
                fangxiang: fangxiang,
                miaoshu: trade.miaoshu || trade.duration || '',
                buytime: buytime,
                zhuangtai: zhuangtai,
                zuizhong: zuizhong,
                ying: payout,
                rate: Number(Number(ratePercent).toFixed(2))
            };
        });

        // sort by buytime desc
        mapped.sort((a, b) => (b.buytime || 0) - (a.buytime || 0));
        const start = (page - 1) * pageSize;
        const pageTrades = mapped.slice(start, start + pageSize);
        res.json({ code: 1, data: pageTrades });
    } catch (e) {
        console.error('[legacy record/getcontract] error:', e.message);
        res.status(500).json({ code: 0, data: [], message: e.message });
    }
});

// NOTE: The legacy /api/trade/getorder handler was removed to avoid
// accidental early exposure of forced outcomes. The active implementation
// above (registered earlier in this file) enforces that forced outcomes are
// only revealed after a trade matures or the settlement has been applied.

// POST /api/trade/getorderjs - Get trade result with profit/loss amount
// Also performs server-side settlement when the trade has matured and settlement wasn't applied
router.post(['/api/trade/getorderjs', '/api/Trade/getorderjs'], async (req, res) => {
    try {
        const { id } = req.body || {};
        if (!id) return res.status(400).json({ code: 0, data: 'Missing trade ID' });
        
        const Trade = require('../models/Trade');
        let profit = 'wjs'; // 'wjs' = waiting
        
        const trade = await Trade.findOne({ id: id });
        
        if (trade && trade.status && trade.status !== 'pending') {
            // Trade is already settled
            if (trade.status === 'win') {
                const investedAmount = parseFloat(trade.num) || 0;
                const profitPercent = parseFloat(trade.syl) || 40;
                profit = Number((investedAmount * (profitPercent / 100)).toFixed(2));
                console.log('[getorderjs] WIN result: profit=' + profit + ' for trade', id);
            } else if (trade.status === 'loss') {
                const investedAmount = parseFloat(trade.num) || 0;
                profit = -Number((investedAmount).toFixed(2));
                console.log('[getorderjs] LOSS result: loss=' + Math.abs(profit) + ' for trade', id);
            }
        } else if (trade && (!trade.status || trade.status === 'pending')) {
            // Still pending - attempt server-side settlement if duration elapsed
            try {
                const createdTs = new Date(trade.created_at).getTime();
                const elapsedSec = Math.floor((Date.now() - createdTs) / 1000);
                const duration = Number(trade.duration) || Number(trade.miaoshu) || 0;
                const User = require('../models/User');

                if (duration > 0 && elapsedSec >= duration) {
                    // If forcedOutcome is present, honor it. If not, also honor a user-level flag (force_trade_win).
                    let finalStatus = trade.forcedOutcome ? (String(trade.forcedOutcome) === 'win' ? 'win' : 'loss') : null;
                    if (!finalStatus) {
                        try {
                            const dbUser = await db.getUserById(trade.user_id || trade.userid);
                            if (dbUser && (dbUser.force_trade_win === true || String(dbUser.force_trade_win) === 'true')) {
                                finalStatus = 'win';
                                console.log('[getorderjs] Applying user-level force_trade_win for trade', id);
                            }
                        } catch (e) {
                            console.warn('[getorderjs] Could not check user-level force flag:', e && e.message);
                        }
                    }

                    // Business rule: Default to LOSS unless trade.forcedOutcome or user-level flag forces WIN.
                    // This avoids relying on external price fetches for fallback settlements.
                    let finalPrice = null;
                    if (!finalStatus) {
                        finalStatus = 'loss';
                        console.log('[getorderjs] No forced outcome found; defaulting to LOSS for trade', id);
                    }

                    if (finalPrice && !finalStatus) {
                        // Robust numeric parsing (strip commas/currency symbols)
                        const toNum = (v) => {
                            if (v === null || typeof v === 'undefined') return NaN;
                            if (typeof v === 'number') return v;
                            const s = String(v).replace(/[^0-9.\-]/g, '');
                            return Number(s);
                        };

                        const buyprice = toNum(trade.buyprice) || 0;
                        const finalNum = toNum(finalPrice) || 0;

                        // Normalize direction: handle arrays [2] or scalars 2, '1', 'up', etc.
                        let fRaw = trade.fangxiang;
                        if (Array.isArray(fRaw)) fRaw = fRaw[0]; // Extract from array if needed
                        fRaw = String(fRaw || '').toLowerCase();
                        const isUp = (fRaw === '1' || fRaw.indexOf('up') !== -1 || fRaw.indexOf('upward') !== -1 || fRaw === 'up');

                        // Determine win/loss strictly by numeric comparison
                        if ((isUp && finalNum > buyprice) || (!isUp && finalNum < buyprice)) {
                            finalStatus = 'win';
                        } else {
                            finalStatus = 'loss';
                        }

                        console.log('[getorderjs] Settlement calc:', { id: trade.id, buyprice, finalNum, fangxiang: trade.fangxiang, isUp, finalStatus });
                    }

                    // If we have a finalStatus, apply settlement (if not applied)
                    if (finalStatus && !trade.settlement_applied) {
                        // Apply settlement atomically: only proceed if settlement_applied was not already true
                        const filter = { id: id, $or: [{ settlement_applied: { $exists: false } }, { settlement_applied: false }] };
                        const setFields = { status: finalStatus, settlement_applied: true, settled_price: finalPrice || trade.settled_price || null, updated_at: new Date() };
                        const updatedTrade = await Trade.findOneAndUpdate(filter, { $set: setFields }, { new: false });
                        if (!updatedTrade) {
                            // Another process already applied settlement
                            console.log('[getorderjs] Settlement already applied by another process for trade', id);
                        } else {
                            const userid = updatedTrade.user_id || updatedTrade.userid;
                            const investedAmount = parseFloat(updatedTrade.num) || 0;
                            const profitRatio = parseFloat(updatedTrade.syl) || 40;

                            if (finalStatus === 'win') {
                                const profitAmount = Number((investedAmount * (profitRatio / 100)).toFixed(2));
                                await User.findOneAndUpdate(
                                    { $or: [{ userid: String(userid) }, { uid: String(userid) }, { wallet_address: String(userid).toLowerCase() }] },
                                    { $inc: { 'balances.usdt': profitAmount, 'total_income': profitAmount } },
                                    { new: true }
                                );
                                profit = profitAmount;
                                try { await Trade.findOneAndUpdate({ id }, { $set: { profit_amount: profitAmount } }); } catch (e) {}
                            } else {
                                await User.findOneAndUpdate(
                                    { $or: [{ userid: String(userid) }, { uid: String(userid) }, { wallet_address: String(userid).toLowerCase() }] },
                                    { $inc: { 'balances.usdt': -investedAmount } },
                                    { new: true }
                                );
                                profit = -investedAmount;
                                try { await Trade.findOneAndUpdate({ id }, { $set: { profit_amount: profit } }); } catch (e) {}
                            }

                            console.log('[getorderjs] Settlement applied: status=' + finalStatus + ', profit=' + profit + ' for trade', id);
                        }
                    } else {
                        console.log('[getorderjs] Trade still pending, returning wjs');
                    }
                } else {
                    console.log('[getorderjs] Trade still pending, returning wjs');
                }
            } catch (e) {
                console.error('[getorderjs] Settlement attempt error:', e && e.message);
            }
        }
        
        return res.json({ code: 1, data: profit });
    } catch (e) {
        console.error('[getorderjs] error:', e.message);
        return res.status(500).json({ code: 0, data: e.message });
    }
});

// POST /api/trade/setordersy - Set trade result (win/loss) and apply settlement
router.post(['/api/trade/setordersy', '/api/Trade/setordersy'], async (req, res) => {
    try {
        const { id, shuying } = req.body || {};
        if (!id) return res.status(400).json({ code: 0, data: 'Missing trade ID' });
        if (!shuying) return res.status(400).json({ code: 0, data: 'Missing result (shuying)' });
        
        const Trade = require('../models/Trade');
        const User = require('../models/User');
        
        // Find and update trade
        const trade = await Trade.findOne({ id: id });
        if (!trade) return res.status(404).json({ code: 0, data: 'Trade not found' });
        
        // Map shuying: 1 = win, 2 = loss
        let finalStatus = shuying === 1 || shuying === '1' ? 'win' : 'loss';
        
        // PRIORITY: If forced outcome exists, use it instead
        if (trade.forcedOutcome) {
            finalStatus = String(trade.forcedOutcome) === 'win' ? 'win' : 'loss';
            console.log('[setordersy] Overriding client result with forcedOutcome:', finalStatus, 'for trade', id);
        } else {
            // Also honor user-level force flag if present on the account
            try {
                const dbUser = await db.getUserById(trade.user_id || trade.userid);
                if (dbUser && (dbUser.force_trade_win === true || String(dbUser.force_trade_win) === 'true')) {
                    finalStatus = 'win';
                    console.log('[setordersy] Overriding client result with user-level force_trade_win for trade', id);
                }
            } catch (e) {
                console.warn('[setordersy] Could not check user-level force flag:', e && e.message);
            }
        }
        
        // Prevent double-application of settlement. Allow admin-authenticated requests to bypass maturity.
        const admin = await verifyAdminToken(req).catch(() => null);
        const createdTs = new Date(trade.created_at).getTime();
        const elapsedSec = Math.floor((Date.now() - createdTs) / 1000);
        const duration = Number(trade.duration) || Number(trade.miaoshu) || 0;
        const tradeMatured = duration > 0 && elapsedSec >= duration;

        if (!trade.settlement_applied) {
            if (!tradeMatured && !trade.forcedOutcome && !admin) {
                // Trade not matured yet and no forced outcome and caller not admin - do not apply settlement prematurely
                return res.status(400).json({ code: 0, data: 'Trade not matured yet' });
            }

            // Apply settlement atomically: update trade record only if settlement_applied was not already true
            const filter = { id: id, $or: [{ settlement_applied: { $exists: false } }, { settlement_applied: false }] };
            const setFields = { status: finalStatus, settlement_applied: true, updated_at: new Date() };
            const updatedTrade = await Trade.findOneAndUpdate(filter, { $set: setFields }, { new: false });
            if (!updatedTrade) {
                // Another process already applied settlement
                console.log('[setordersy] Settlement already applied by another process for trade', id);
            } else {
                try {
                    const userid = updatedTrade.user_id || updatedTrade.userid;
                    const invested = parseFloat(updatedTrade.num) || 0;
                    // Compute profit using stored rate or syl
                    let profit = 0;
                    const storedRate = parseFloat(updatedTrade.rate);
                    if (finalStatus === 'win') {
                        if (!isNaN(storedRate) && storedRate > 0) {
                            if (storedRate <= 10) {
                                profit = Number((invested * storedRate).toFixed(2));
                            } else if (storedRate > 10 && storedRate <= 1000) {
                                profit = Number((invested * (storedRate / 100)).toFixed(2));
                            } else {
                                const profitRatio = parseFloat(updatedTrade.syl) || 40;
                                profit = Number((invested * (profitRatio / 100)).toFixed(2));
                            }
                        } else {
                            const profitRatio = parseFloat(updatedTrade.syl) || 40;
                            profit = Number((invested * (profitRatio / 100)).toFixed(2));
                        }

                        await User.findOneAndUpdate(
                            { userid: userid },
                            { $inc: { 'balances.usdt': profit, 'total_income': profit } },
                            { new: true }
                        );
                        console.log('[setordersy] WIN settlement applied: +' + profit + ' profit for user', userid);
                    } else {
                        // LOSS
                        await User.findOneAndUpdate(
                            { userid: userid },
                            { $inc: { 'balances.usdt': -invested } },
                            { new: true }
                        );
                        console.log('[setordersy] LOSS settlement applied: -' + invested + ' stake deducted for user', userid);
                    }
                } catch (e) {
                    console.error('[setordersy] Error applying settlement to user balance:', e.message);
                }
            }
        } else {
            // Settlement already applied, just update status if needed (no balance changes)
            trade.status = finalStatus;
            trade.updated_at = new Date();
            await trade.save();
        }
        
        return res.json({ code: 1, data: 'Order updated' });
    } catch (e) {
        console.error('[setordersy] error:', e.message);
        return res.status(500).json({ code: 0, data: e.message });
    }
});

// POST /api/trade/buy - create trade (legacy frontends call this)
router.post(['/api/trade/buy', '/api/Trade/buy'], async (req, res) => {
    try {
        const data = req.body || {};
        const userid = data.userid || data.user_id || data.uid;
        const username = data.username || data.name || 'user_' + userid;
        const biming = data.biming || data.coin || data.biming;
        const num = Number(data.num || data.amount || 0) || 0;
        const buyprice = data.buyprice || data.price || 0;
        const syl = Number(data.syl || 40) || 40;
        const fangxiang = (data.fangxiang == 1 || data.fangxiang == '1' || String(data.fangxiang).toLowerCase() === 'up') ? 1 : 2;

        if (!userid || !biming || !num || !buyprice) return res.status(400).json({ code: 0, data: 'Missing required fields' });

        // Check user flags (e.g., force_trade_win) and set forcedOutcome when applicable
        let forcedOutcome = null;
        try {
            const UserModel = require('../models/User');
            const user = await db.getUserById(userid);
            if (user && (user.force_trade_win === true || String(user.force_trade_win) === 'true')) {
                forcedOutcome = 'win';
                console.log('[legacy trade/buy] User flagged for forced win, marking trade forcedOutcome=win for user', userid);
            }
        } catch (e) {
            console.warn('[legacy trade/buy] could not check user flags:', e && e.message);
        }

        const tradeData = {
            id: Date.now().toString(),
            user_id: userid,
            userid: userid,
            username: username,
            biming: biming,
            fangxiang: fangxiang,
            miaoshu: data.miaoshu || data.duration || '',
            num: num,
            buyprice: buyprice,
            syl: syl,
            zengjia: data.zengjia,
            jianshao: data.jianshao,
            forcedOutcome: forcedOutcome,
            status: 'pending',
            created_at: new Date()
        };

        const created = await db.createTrade(tradeData);
        res.json({ code: 1, data: created?.id || created?._id || created });
    } catch (e) {
        console.error('[legacy trade/buy] error:', e.message);
        res.status(500).json({ code: 0, data: e.message });
    }
});

// POST /api/upload-image - accept JSON { filename, data: dataUrl or base64 }
router.post('/api/upload-image', async (req, res) => {
    try {
        const { filename, data } = req.body || {};
        if (!data) return res.status(400).json({ code: 0, data: 'Missing image data' });

        // data may be a data URL like: data:image/png;base64,AAAA
        let matches = String(data).match(/^data:(image\/[^;]+);base64,(.+)$/);
        let mime = 'image/png';
        let b64 = '';
        if (matches) {
            mime = matches[1];
            b64 = matches[2];
        } else {
            // assume plain base64
            b64 = String(data).replace(/^data:.*;base64,/, '');
        }

        const ext = (mime && mime.split('/')[1]) ? mime.split('/')[1].split('+')[0] : 'png';
        const safeName = (filename || `upload_${Date.now()}`).replace(/[^a-zA-Z0-9._-]/g, '_');
        const outName = `${Date.now()}_${safeName}.${ext}`.replace(/\.+$/, '');
        const outPath = path.join(UPLOADS_DIR, outName);

        fs.writeFileSync(outPath, Buffer.from(b64, 'base64'));

        // Return a relative URL to the uploaded file
        const publicUrl = `/uploads/${outName}`;
        res.json({ code: 1, data: publicUrl });
    } catch (e) {
        console.error('[api] /api/upload-image error:', e && e.message);
        res.status(500).json({ code: 0, data: e.message });
    }
});

// POST /api/topup-record - create topup record from frontend
router.post('/api/topup-record', async (req, res) => {
    try {
        const body = req.body || {};
        // Accept both user_id and userid
        const user_id = body.user_id || body.userid || body.uid;
        const coin = body.coin || 'usdt';
        const address = body.address || body.addr || '';
        const photo_url = body.photo_url || body.photo || '';
        const amount = Number(body.amount || 0) || 0;

        if (!user_id || !amount) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const topupData = {
            id: body.id || `topup_${Date.now()}_${uuidv4().substring(0,8)}`,
            user_id: user_id,
            coin: coin,
            address: address,
            photo_url: photo_url,
            amount: amount,
            status: 'pending',
            timestamp: Date.now(),
            created_at: new Date(),
            updated_at: new Date()
        };

        const created = await db.createTopup(topupData);
        if (!created) return res.status(500).json({ error: 'Failed to save topup record' });

        res.json({ success: true, data: created });
    } catch (e) {
        console.error('[api] /api/topup-record error:', e && e.message);
        res.status(500).json({ error: e.message });
    }
});

// POST /api/user/getuserid - wallet login (legacy)
router.post(['/api/user/getuserid', '/api/User/getuserid'], async (req, res) => {
    try {
        const addressRaw = req.body.address || req.body.addr || req.body.address_raw;
        const signature = req.body.signature || req.body.sig || req.body.sign;
        const msg = req.body.msg || req.body.message || req.body.nonce || '';
        const address = (addressRaw || '').toString().toLowerCase();

        if (!address) return res.status(400).json({ code: 0, data: 'Missing address' });

        // Optional: verify signature if provided and ethers available
        let verified = false;
        try {
            if (signature && msg) {
                const message = typeof msg === 'string' && msg.startsWith('Login code:') ? msg : `Login code: ${msg}`;
                const recovered = ethers.verifyMessage(message, signature);
                verified = recovered && recovered.toLowerCase() === address;
            }
        } catch (e) {
            console.warn('[getuserid] signature verification failed:', e && e.message);
        }

        // Try to find a wallet linked to this address
        const wallet = await db.getWalletByAddress(address);
        let user = null;
        if (wallet && wallet.user_id) {
            user = await db.getUserById(wallet.user_id);
        }

        // If not found, try find User by wallet_address field
        if (!user) {
            const UserModel = require('../models/User');
            user = await UserModel.findOne({ wallet_address: address });
        }

        // If still not found, create a new user
        if (!user) {
            // Generate next 6-digit user ID starting from 342020
            const UserModel = require('../models/User');
            const allUsers = await UserModel.find({}, { userid: 1 }).sort({ _id: -1 }).limit(1);
            const maxId = allUsers.length > 0 ? parseInt(allUsers[0].userid || '342019', 10) : 342019;
            const nextUserId = String(maxId + 1);
            
            const newUser = {
                userid: nextUserId,
                uid: nextUserId,
                username: `user_${nextUserId}`,
                wallet_address: address,
                balance: 0,
                balances: { usdt: 0, btc: 0, eth: 0, usdc: 0, pyusd: 0, sol: 0 }
            };
            user = await db.createUser(newUser);
        }

        // Create or update a wallet document to ensure mapping
        try {
            const WalletModel = require('../models/Wallet');
            const existing = await WalletModel.findOne({ address: address.toLowerCase() });
            if (!existing) {
                const w = new WalletModel({ id: `w_${Date.now()}`, user_id: user.userid || user.uid || user._id, address: address.toLowerCase(), balance: 0, balances: {} });
                await w.save();
            }
        } catch (e) {
            console.warn('[getuserid] wallet creation skipped:', e && e.message);
        }

        // Return a legacy-shaped response: { data: { userid, token, sid } }
        const token = (Math.random().toString(36).substring(2, 12));
        const sid = (Math.random().toString(36).substring(2, 12));

        res.json({ code: 1, data: { userid: user.userid || user.uid || String(user._id), token, sid } });
    } catch (e) {
        console.error('[getuserid] error:', e && e.message);
        res.status(500).json({ code: 0, data: e.message });
    }
});

// POST /api/Wallet/getuserzt - return KYC/status info (legacy)
router.post(['/api/Wallet/getuserzt', '/api/wallet/getuserzt'], async (req, res) => {
    try {
        const userId = req.body.userid || req.body.user_id || req.body.uid || req.body.id || req.body.address;
        if (!userId) return res.status(400).json({ code: 0, info: 'Missing userid' });

        let user = null;
        // if looks like address
        if (String(userId).toLowerCase().startsWith('0x')) {
            // find by wallet or user.wallet_address
            const wallet = await db.getWalletByAddress(userId);
            if (wallet && wallet.user_id) user = await db.getUserById(wallet.user_id);
            if (!user) {
                const UserModel = require('../models/User');
                user = await UserModel.findOne({ wallet_address: String(userId).toLowerCase() });
            }
        } else {
            user = await db.getUserById(userId);
        }

        if (!user) return res.json({ code: 0, info: 'User not found' });

        const kycMap = { none: 0, basic: 1, advanced: 2 };
        const renzhengzhuangtai = kycMap[user.kycStatus] || 0;
        const xinyongfen = user.creditScore || 0;

        res.json({ code: 1, data: { renzhengzhuangtai, xinyongfen, balance: user.balance || 0, status: user.status || 'active' } });
    } catch (e) {
        console.error('[getuserzt] error:', e && e.message);
        res.status(500).json({ code: 0, info: e.message });
    }
});
