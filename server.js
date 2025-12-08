// NOTE: The file uses a single `http.createServer` routing approach below.
// The legacy Express-style `app.post` usage was removed and the same
// functionality is implemented inside the server routing further down.
/**
 * Simple Development Server for BVOX Finance
 * Serves static files and handles CORS
 * 
 * Usage: node server.js
 */

const http = require('http');
const { registerUser } = require('./userModel');
const { saveTopupRecord, getUserTopupRecords } = require('./topupRecordModel');
const { saveWithdrawalRecord, getUserWithdrawalRecords } = require('./withdrawalRecordModel');
const { saveExchangeRecord, getUserExchangeRecords } = require('./exchangeRecordModel');
const { getAllUsers, getUserById, updateUserBalance, getUserStats, addTopupRecord, addWithdrawalRecord, deleteTransaction, setUserFlag } = require('./adminModel');
const { registerAdmin, loginAdmin, getAdminById, getAllAdmins, verifyToken } = require('./authModel');
const { getAllArbitrageProducts, getArbitrageProductById, createArbitrageSubscription, getUserArbitrageSubscriptions, getUserArbitrageStats } = require('./arbitrageModel');
const { settleArbitrageSubscriptions } = require('./arbitrageModel');
const { connectWallet, verifyWallet, getWalletByUID, getUserByUID, getWalletByAddress } = require('./walletModel');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const url = require('url');
const path = require('path');

// MIME types
const mimeTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.wav': 'audio/wav',
    '.mp4': 'video/mp4',
    '.woff': 'application/font-woff',
    '.ttf': 'application/font-ttf',
    '.eot': 'application/vnd.ms-fontobject',
    '.otf': 'application/font-otf',
    '.wasm': 'application/wasm'
};

// Robust body parser used by legacy endpoints: accepts JSON or x-www-form-urlencoded
const querystring = require('querystring');

function parseBodyString(body) {
    if (!body || typeof body !== 'string') return {};
    // Some frontends append extra query fragments after JSON like '}&...'; strip at first '}&'
    let clean = body;
    if (body.indexOf('}&') !== -1) {
        clean = body.substring(0, body.indexOf('}&') + 1);
    }

    // Trim whitespace
    clean = clean.trim();

    // Try JSON first
    try {
        if (clean.startsWith('{') || clean.startsWith('[')) {
            return JSON.parse(clean);
        }
    } catch (e) {
        // fallthrough to urlencoded parse
    }

    // If not JSON, attempt to parse as urlencoded form data
    try {
        // jQuery sends application/x-www-form-urlencoded by default
        return querystring.parse(clean);
    } catch (e) {
        // Fallback: return raw body
        return { raw: body };
    }
}

// Helpers for nonce/session/flag files
const NONCES_FILE = path.join(__dirname, 'nonces.json');
const SESSIONS_FILE = path.join(__dirname, 'sessions.json');
const FLAG_SYNC_FILE = path.join(__dirname, 'flag_sync.json');

function readJsonFileSafe(fp) {
    try {
        if (!fs.existsSync(fp)) return {};
        const data = fs.readFileSync(fp, 'utf8');
        return JSON.parse(data || '{}');
    } catch (e) {
        return {};
    }
}

function writeJsonFileSafe(fp, obj) {
    try {
        fs.writeFileSync(fp, JSON.stringify(obj, null, 2));
        return true;
    } catch (e) {
        console.error('[writeJsonFileSafe] error writing', fp, e.message);
        return false;
    }
}

// Notification helpers
function readNotificationsFile() {
    const notiFile = path.join(__dirname, 'notifications.json');
    try {
        if (!fs.existsSync(notiFile)) return [];
        const raw = fs.readFileSync(notiFile, 'utf8') || '[]';
        return JSON.parse(raw);
    } catch (e) {
        console.error('[readNotificationsFile] parse error', e && e.message ? e.message : e);
        return [];
    }
}

function writeNotificationsFile(arr) {
    const notiFile = path.join(__dirname, 'notifications.json');
    try {
        fs.writeFileSync(notiFile, JSON.stringify(arr, null, 2));
        return true;
    } catch (e) {
        console.error('[writeNotificationsFile] write error', e && e.message ? e.message : e);
        return false;
    }
}

function addNotification({ userid = null, biaoti, neirong, shijian = Math.floor(Date.now()/1000), sfyidu = 0 }) {
    const arr = readNotificationsFile();
    const item = { id: uuidv4(), userid, biaoti, neirong, shijian, sfyidu: sfyidu ? 1 : 0 };
    arr.push(item);
    writeNotificationsFile(arr);
    try { broadcastNotification && broadcastNotification(item); } catch (e) {}
    return item;
}

function markNotificationRead(id, userid) {
    const arr = readNotificationsFile();
    let changed = false;
    for (let i = 0; i < arr.length; i++) {
        const n = arr[i];
        if (String(n.id) === String(id)) {
            // If userid provided, enforce match
            if (userid && n.userid && String(n.userid) !== String(userid)) continue;
            if (!n.sfyidu || n.sfyidu === 0) {
                n.sfyidu = 1;
                changed = true;
            }
        }
    }
    if (changed) writeNotificationsFile(arr);
    return changed;
}

// Server-Sent Events (SSE) clients for real-time notifications
const sseClients = [];

function broadcastNotification(item) {
    try {
        const payload = JSON.stringify(item);
        for (let i = sseClients.length - 1; i >= 0; i--) {
            const client = sseClients[i];
            try {
                // If notification is user-scoped, only send to matching clients
                if (item.userid && client.userid && String(item.userid) !== String(client.userid)) continue;
                client.res.write(`event: new_noti\n`);
                client.res.write(`data: ${payload}\n\n`);
            } catch (e) {
                // If a client write fails, remove it
                try { sseClients.splice(i, 1); } catch (e2) {}
            }
        }
    } catch (e) { console.error('[broadcastNotification] error', e && e.message ? e.message : e); }
}

// Server configuration
const HOST = '0.0.0.0';
const PORT = process.env.PORT || 3000;

// Create HTTP server
const server = http.createServer((req, res) => {
        const parsedUrl = url.parse(req.url, true);
        let pathname = parsedUrl.pathname;
        const pLower = (pathname || '').toLowerCase();

        // Log incoming requests for easier debugging
        try {
            const remote = req.socket && (req.socket.remoteAddress || req.socket.remoteFamily) || req.connection && req.connection.remoteAddress || '-';
            console.log(`[http] ${new Date().toISOString()} ${req.method} ${pathname} from ${remote} origin=${req.headers.origin || '-'} host=${req.headers.host || '-'} `);
        } catch (e) { /* ignore logging errors */ }

        // Add CORS headers FIRST - before any other response
        const origin = req.headers.origin || '*';
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-ID');
        res.setHeader('Access-Control-Allow-Credentials', 'true');

        // Handle preflight requests
        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }

        // Lightweight background settlement trigger: run a quick non-blocking settlement
        // This allows the server to pick up matured subscriptions shortly after startup.
        if (!server._settlementScheduled) {
            server._settlementScheduled = true;
            try {
                // Run once immediately
                setImmediate(() => {
                    try { settleArbitrageSubscriptions(); } catch (e) { console.error('settlement error', e); }
                    try { settleDueMiningRewards(); } catch (e) { console.error('mining settlement error', e); }
                });
                // Schedule periodic settlement every 60 seconds
                setInterval(() => {
                    try { settleArbitrageSubscriptions(); } catch (e) { console.error('settlement error', e); }
                    try { settleDueMiningRewards(); } catch (e) { console.error('mining settlement error', e); }
                }, 60 * 1000);
            } catch (e) {
                console.error('Failed to schedule settlement worker:', e);
            }
        }

        // Handle user registration (wallet connect)
        if (pathname === '/api/register' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    // Extract fields from request
                    const address = data.address;
                    const session = data.session || uuidv4();
                    const token = data.token || uuidv4();
                    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
                    const user_agent = req.headers['user-agent'] || '';
                    if (!address) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Missing address' }));
                        return;
                    }
                    const user = registerUser({ address, session, token, ip, user_agent });
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, user }));
                } catch (e) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Invalid request', details: e.message }));
                }
            });
            return;
        }

    // Handle top-up record save (POST)
    if (pathname === '/api/topup-record' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                // Remove any query parameters appended by jQuery beforeSend
                // e.g., "&yanzheng=...", "&token=...", "&address=...", "&sid=..."
                let jsonBody = body;
                if (body.includes('}&')) {
                    // JSON ends at the first '}', extract it
                    jsonBody = body.substring(0, body.indexOf('}&') + 1);
                }
                
                console.error('[topup-record] Raw body:', body.substring(0, 200));
                console.error('[topup-record] Cleaned body:', jsonBody.substring(0, 200));
                
                const data = JSON.parse(jsonBody);
                console.error('[topup-record] ✓ Parsed:', JSON.stringify(data).substring(0, 100));
                const { user_id, coin, address, photo_url, amount } = data;
                
                if (!user_id || !coin || !address || !photo_url || !amount) {
                    console.error('[topup-record] ✗ Missing field');
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Missing required fields' }));
                    return;
                }
                
                console.error('[topup-record] ✓ Saving record...');
                const record = saveTopupRecord({ user_id, coin, address, photo_url, amount });
                console.error('[topup-record] ✓ Saved:', record.id);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, record }));
            } catch (e) {
                console.error('[topup-record] ✗ Error:', e.message);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: e.message }));
            }
        });
        return;
    }

    // Get user's top-up records (GET)
    if (pathname === '/api/topup-records' && req.method === 'GET') {
        const queryParams = url.parse(req.url, true).query;
        const user_id = queryParams.user_id;
        if (!user_id) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing user_id parameter' }));
            return;
        }
        const records = getUserTopupRecords(user_id);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, records }));
        return;
    }

    // Handle withdrawal record save (POST)
    if (pathname === '/api/withdrawal-record' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                // Remove any query parameters appended by jQuery beforeSend
                let jsonBody = body;
                if (body.includes('}&')) {
                    jsonBody = body.substring(0, body.indexOf('}&') + 1);
                }
                
                console.error('[withdrawal-record] Raw body:', body.substring(0, 200));
                console.error('[withdrawal-record] Cleaned body:', jsonBody.substring(0, 200));
                
                const data = JSON.parse(jsonBody);
                console.error('[withdrawal-record] ✓ Parsed:', JSON.stringify(data).substring(0, 100));
                const { user_id, coin, address, quantity } = data;
                
                if (!user_id || !coin || !address || !quantity) {
                    console.error('[withdrawal-record] ✗ Missing field');
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Missing required fields' }));
                    return;
                }
                
                console.error('[withdrawal-record] ✓ Saving record...');
                const record = saveWithdrawalRecord({ user_id, coin, address, quantity, status: 'pending' });
                console.error('[withdrawal-record] ✓ Saved:', record.id);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, record }));
            } catch (e) {
                console.error('[withdrawal-record] ✗ Error:', e.message);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: e.message }));
            }
        });
        return;
    }

    // Get user's withdrawal records (GET)
    if (pathname === '/api/withdrawal-records' && req.method === 'GET') {
        const queryParams = url.parse(req.url, true).query;
        const user_id = queryParams.user_id;
        if (!user_id) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing user_id parameter' }));
            return;
        }
        const records = getUserWithdrawalRecords(user_id);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, records }));
        return;
    }

    // Handle exchange record save (POST)
    if (pathname === '/api/exchange-record' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                // Remove any query parameters appended by jQuery beforeSend
                let jsonBody = body;
                if (body.includes('}&')) {
                    jsonBody = body.substring(0, body.indexOf('}&') + 1);
                }
                
                console.error('[exchange-record] Raw body:', body.substring(0, 200));
                console.error('[exchange-record] Cleaned body:', jsonBody.substring(0, 200));
                
                const data = JSON.parse(jsonBody);
                console.error('[exchange-record] ✓ Parsed:', JSON.stringify(data).substring(0, 100));
                const { user_id, from_coin, to_coin, from_amount, to_amount, status } = data;
                
                if (!user_id || !from_coin || !to_coin || !from_amount || !to_amount) {
                    console.error('[exchange-record] ✗ Missing field');
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Missing required fields' }));
                    return;
                }
                
                console.error('[exchange-record] ✓ Saving record...');
                const record = saveExchangeRecord({ user_id, from_coin, to_coin, from_amount, to_amount, status: status || 'completed' });
                console.error('[exchange-record] ✓ Saved:', record.id);
                
                // Update user balances for exchange
                try {
                    const usersPath = path.join(__dirname, 'users.json');
                    let users = [];
                    if (fs.existsSync(usersPath)) {
                        users = JSON.parse(fs.readFileSync(usersPath));
                    }

                    const userIndex = users.findIndex(u => u.userid === user_id || u.uid === user_id);
                    if (userIndex !== -1) {
                        const user = users[userIndex];
                        const fromCoin = from_coin.toLowerCase();
                        const toCoin = to_coin.toLowerCase();
                        const fromAmount = parseFloat(from_amount) || 0;
                        const toAmount = parseFloat(to_amount) || 0;

                        // Initialize balances object if it doesn't exist
                        if (!user.balances) {
                            user.balances = {};
                        }

                        // Deduct from "from_coin" balance
                        user.balances[fromCoin] = Math.max(0, (user.balances[fromCoin] || 0) - fromAmount);
                        
                        // Add to "to_coin" balance
                        user.balances[toCoin] = (user.balances[toCoin] || 0) + toAmount;

                        console.log(`[EXCHANGE] Updated user ${user_id} balance: -${fromAmount} ${fromCoin.toUpperCase()} = ${user.balances[fromCoin]}, +${toAmount} ${toCoin.toUpperCase()} = ${user.balances[toCoin]}`);

                        // Save updated users
                        fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));
                        // Notify user about exchange completion
                        try {
                            addNotification({ userid: user_id, biaoti: 'Exchange Completed', neirong: `You exchanged ${fromAmount} ${fromCoin.toUpperCase()} → ${toAmount} ${toCoin.toUpperCase()}.`, sfyidu: 0 });
                        } catch (e) { /* best-effort only */ }
                    } else {
                        console.warn(`[EXCHANGE] User not found for balance update: ${user_id}`);
                        try { addNotification({ userid: user_id, biaoti: 'Exchange Completed', neirong: `Your exchange record ${record.id} has been saved.`, sfyidu: 0 }); } catch(e){}
                    }
                } catch (balanceErr) {
                    console.error('[EXCHANGE] Failed to update user balance:', balanceErr);
                    // Don't fail the exchange if balance update fails
                }
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, record }));
            } catch (e) {
                console.error('[exchange-record] ✗ Error:', e.message);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: e.message }));
            }
        });
        return;
    }

    // Get user's exchange records (GET)
    if (pathname === '/api/exchange-records' && req.method === 'GET') {
        const queryParams = url.parse(req.url, true).query;
        const user_id = queryParams.user_id;
        if (!user_id) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing user_id parameter' }));
            return;
        }
        const records = getUserExchangeRecords(user_id);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, records }));
        return;
    }

    // ========== MINING API ENDPOINTS ==========

    // Get mining statistics (POST) - /api/Mine/getminesy
    if ((pathname === '/api/Mine/getminesy' || pathname === '/api/mine/getminesy') && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                // Clean body if needed
                let jsonBody = body;
                if (body.includes('}&')) {
                    jsonBody = body.substring(0, body.indexOf('}&') + 1);
                }
                
                const data = JSON.parse(jsonBody);
                const { userid, username } = data;

                if (!userid) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: 0, data: 'User ID is required' }));
                    return;
                }

                // Read mining records from JSON file
                const miningFile = path.join(__dirname, 'mining_records.json');
                let miningRecords = [];
                if (fs.existsSync(miningFile)) {
                    try {
                        miningRecords = JSON.parse(fs.readFileSync(miningFile, 'utf8')) || [];
                    } catch (e) {
                        miningRecords = [];
                    }
                }

                // Get active mining records for user
                const userMiningRecords = miningRecords.filter(m => m.userid === userid && m.status === 'active');

                if (userMiningRecords.length === 0) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        code: 1,
                        data: {
                            total_shuliang: 0,
                            total_jine: 0,
                            recent_jine: 0,
                        }
                    }));
                    return;
                }

                // Calculate totals
                const total_shuliang = userMiningRecords.reduce((sum, m) => sum + (m.stakedAmount || 0), 0);
                const total_jine = userMiningRecords.reduce((sum, m) => sum + (m.totalIncome || 0), 0);
                const recent_jine = userMiningRecords.reduce((sum, m) => sum + (m.todayIncome || 0), 0);

                console.log(`[MINING] Stats for user ${userid}:`, { total_shuliang, total_jine, recent_jine });

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    code: 1,
                    data: {
                        total_shuliang: total_shuliang,
                        total_jine: total_jine,
                        recent_jine: recent_jine,
                    }
                }));
            } catch (e) {
                console.error('[MINING getminesy] Error:', e.message);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: 0, data: 'Failed to get mining stats' }));
            }
        });
        return;
    }

    // Get mining records for a user (GET) - /api/Mine/records/:userid
    if ((pathname.startsWith('/api/Mine/records/') || pathname.startsWith('/api/mine/records/')) && req.method === 'GET') {
        try {
            const parts = pathname.split('/');
            const userid = parts.pop() || parts.pop();
            const miningFile = path.join(__dirname, 'mining_records.json');
            let miningRecords = [];
            if (fs.existsSync(miningFile)) {
                try { miningRecords = JSON.parse(fs.readFileSync(miningFile, 'utf8')) || []; } catch (e) { miningRecords = []; }
            }

            const records = miningRecords.filter(m => m.userid === userid);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ code: 1, data: records.map(r => ({
                orderId: r.id || r.orderId,
                amount: r.stakedAmount || r.amount || 0,
                currency: r.currency || 'ETH',
                dailyYield: typeof r.dailyYield === 'number' ? (r.dailyYield * 100) + '%' : (r.dailyYield || ''),
                totalIncome: r.totalIncome || 0,
                todayIncome: r.todayIncome || 0,
                status: r.status || 'active',
                startDate: r.startDate || r.createdAt || new Date().toISOString()
            })) }));
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ code: 0, data: 'Failed to read mining records' }));
        }
        return;
    }

    // ADMIN: get all mining records (GET) - /api/admin/mining-records
    if (pathname === '/api/admin/mining-records' && req.method === 'GET') {
        try {
            const miningFile = path.join(__dirname, 'mining_records.json');
            let miningRecords = [];
            if (fs.existsSync(miningFile)) {
                try { miningRecords = JSON.parse(fs.readFileSync(miningFile, 'utf8')) || []; } catch (e) { miningRecords = []; }
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ code: 1, data: miningRecords.map(r => ({
                orderId: r.id || r.orderId,
                userid: r.userid,
                amount: r.stakedAmount || r.amount || 0,
                currency: r.currency || 'ETH',
                totalIncome: r.totalIncome || 0,
                todayIncome: r.todayIncome || 0,
                status: r.status || 'active',
                startDate: r.startDate || r.createdAt || new Date().toISOString()
            })) }));
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ code: 0, data: 'Failed to read mining records' }));
        }
        return;
    }

    // ADMIN: complete redeem (POST) - /api/admin/mine/redeem/complete
    if (pathname === '/api/admin/mine/redeem/complete' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                let jsonBody = body;
                if (body && body.includes('}&')) jsonBody = body.substring(0, body.indexOf('}&') + 1);
                const data = JSON.parse(jsonBody || '{}');
                const id = data.id || data.orderId;
                if (!id) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: 0, data: 'Missing id' })); return;
                }

                const miningFile = path.join(__dirname, 'mining_records.json');
                let miningRecords = [];
                if (fs.existsSync(miningFile)) {
                    try { miningRecords = JSON.parse(fs.readFileSync(miningFile, 'utf8')) || []; } catch (e) { miningRecords = []; }
                }

                const idx = miningRecords.findIndex(m => (m.id === id || m.orderId === id));
                if (idx === -1) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: 0, data: 'Record not found' })); return;
                }

                const record = miningRecords[idx];
                if (record.status === 'redeemed') {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: 1, data: 'Already redeemed' })); return;
                }

                // Credit user's balance
                const usersFile = path.join(__dirname, 'users.json');
                let users = [];
                if (fs.existsSync(usersFile)) {
                    try { users = JSON.parse(fs.readFileSync(usersFile, 'utf8')) || []; } catch (e) { users = []; }
                }

                const userIndex = users.findIndex(u => u.userid === record.userid || u.uid === record.userid);
                if (userIndex !== -1) {
                    users[userIndex].balances = users[userIndex].balances || {};
                    users[userIndex].balances.eth = (users[userIndex].balances.eth || 0) + (record.stakedAmount || record.amount || 0);
                    fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
                }

                // Mark record redeemed
                miningRecords[idx].status = 'redeemed';
                miningRecords[idx].redeemedAt = new Date().toISOString();
                fs.writeFileSync(miningFile, JSON.stringify(miningRecords, null, 2));

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: 1, data: 'Redeem completed' }));
            } catch (err) {
                console.error('[admin redeem complete] Error:', err);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: 0, data: 'Server error' }));
            }
        });
        return;
    }

    // Create mining order (POST) - /api/Mine/setmineorder
    if ((pathname === '/api/Mine/setmineorder' || pathname === '/api/mine/setmineorder') && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                // Clean body if needed
                let jsonBody = body;
                if (body.includes('}&')) {
                    jsonBody = body.substring(0, body.indexOf('}&') + 1);
                }
                
                const data = JSON.parse(jsonBody);
                const { userid, username, jine } = data;

                if (!userid || !jine || isNaN(jine)) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: 0, data: 'Invalid input parameters' }));
                    return;
                }

                const amount = parseFloat(jine);

                // Validate staking amount
                if (amount <= 0) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: 0, data: 'Staking amount must be greater than 0' }));
                    return;
                }

                // Check minimum
                if (amount < 0.5) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: 0, data: 'Staking amount must be at least 0.5 ETH' }));
                    return;
                }

                // Get user from JSON
                const usersFile = path.join(__dirname, 'users.json');
                let users = [];
                if (fs.existsSync(usersFile)) {
                    users = JSON.parse(fs.readFileSync(usersFile, 'utf8')) || [];
                }

                const userIndex = users.findIndex(u => u.userid === userid || u.uid === userid);
                if (userIndex === -1) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: 0, data: 'User not found' }));
                    return;
                }

                const user = users[userIndex];
                const currentBalance = user.balances?.eth || 0;

                // Check if user has sufficient balance
                if (currentBalance < amount) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: 0, data: `Insufficient ETH balance. Current: ${currentBalance} ETH, Required: ${amount} ETH` }));
                    return;
                }

                // Determine daily yield
                let dailyYield = 0;
                if (amount >= 40) dailyYield = 0.006;
                else if (amount >= 20) dailyYield = 0.005;
                else if (amount >= 12) dailyYield = 0.0045;
                else if (amount >= 2) dailyYield = 0.004;
                else if (amount >= 0.5) dailyYield = 0.003;

                // Deduct balance
                const newBalance = currentBalance - amount;
                user.balances = user.balances || {};
                user.balances.eth = newBalance;

                // Save updated users
                fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));

                // Create mining record
                const miningFile = path.join(__dirname, 'mining_records.json');
                let miningRecords = [];
                if (fs.existsSync(miningFile)) {
                    try {
                        miningRecords = JSON.parse(fs.readFileSync(miningFile, 'utf8')) || [];
                    } catch (e) {
                        miningRecords = [];
                    }
                }

                const miningRecord = {
                    id: uuidv4(),
                    userid: userid,
                    username: username || user.username || `User_${userid}`,
                    stakedAmount: amount,
                    currency: 'ETH',
                    dailyYield: dailyYield,
                    totalIncome: 0,
                    todayIncome: 0,
                    status: 'active',
                    startDate: new Date().toISOString(),
                    activationDate: new Date().toISOString(),
                };

                miningRecords.push(miningRecord);
                fs.writeFileSync(miningFile, JSON.stringify(miningRecords, null, 2));

                console.log('[MINING] Order created:', {
                    userid,
                    amount,
                    dailyYield: (dailyYield * 100) + '%',
                    newBalance
                });

                // Schedule auto-rewards (every 24 hours)
                scheduleRewards(userid, amount, dailyYield, miningRecord.id);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    code: 1,
                    data: {
                        orderId: miningRecord.id,
                        amount: amount,
                        currency: 'ETH',
                        dailyYield: (dailyYield * 100) + '%',
                        status: 'active',
                        newBalance: newBalance,
                        message: 'Mining started successfully. Daily rewards will be added automatically.'
                    }
                }));
            } catch (e) {
                console.error('[MINING setmineorder] Error:', e.message);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: 0, data: 'Failed to create mining order: ' + e.message }));
            }
        });
        return;
    }

    // Redeem / start redeeming a mining order (POST) - /api/Mine/shuhui
    if ((pathname === '/api/Mine/shuhui' || pathname === '/api/mine/shuhui') && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                let jsonBody = body;
                if (body.includes('}&')) jsonBody = body.substring(0, body.indexOf('}&') + 1);
                // Accept JSON or form-encoded
                let data;
                try { data = JSON.parse(jsonBody); } catch (e) {
                    data = {};
                    jsonBody.split('&').forEach(pair => {
                        if (!pair) return;
                        const parts = pair.split('=');
                        data[decodeURIComponent(parts[0] || '')] = decodeURIComponent((parts[1] || '').replace(/\+/g, ' '));
                    });
                }

                const id = data.id || data.orderId || data.orderID;
                const userid = data.userid;

                if (!id || !userid) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: 0, data: 'Missing id or userid' }));
                    return;
                }

                const miningFile = path.join(__dirname, 'mining_records.json');
                let miningRecords = [];
                if (fs.existsSync(miningFile)) {
                    try { miningRecords = JSON.parse(fs.readFileSync(miningFile, 'utf8')) || []; } catch (e) { miningRecords = []; }
                }

                const idx = miningRecords.findIndex(m => (m.id === id || m.orderId === id) && (m.userid === userid || m.userId === userid));
                if (idx === -1) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: 0, data: 'Record not found' }));
                    return;
                }

                // Mark as redeeming
                miningRecords[idx].status = 'redeeming';
                miningRecords[idx].updatedAt = new Date().toISOString();
                fs.writeFileSync(miningFile, JSON.stringify(miningRecords, null, 2));

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: 1, data: 'Redeem request submitted' }));
            } catch (err) {
                console.error('[MINING shuhui] Error:', err.message);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: 0, data: err.message }));
            }
        });
        return;
    }

    // ========== MINING SETTLEMENT FUNCTION ==========
    /**
     * Settle due mining rewards - processes mining records that are older than 24 hours
     * This runs periodically to catch any missed rewards after server restarts
     */
    function settleDueMiningRewards() {
        try {
            const miningFile = path.join(__dirname, 'mining_records.json');
            const usersFile = path.join(__dirname, 'users.json');
            
            if (!fs.existsSync(miningFile) || !fs.existsSync(usersFile)) {
                return;
            }

            let miningRecords = [];
            let users = [];
            
            try {
                miningRecords = JSON.parse(fs.readFileSync(miningFile, 'utf8')) || [];
                users = JSON.parse(fs.readFileSync(usersFile, 'utf8')) || [];
            } catch (e) {
                console.error('[MINING SETTLEMENT] Error reading files:', e.message);
                return;
            }

            const now = new Date().getTime();
            let changed = false;

            // Process each active mining record
            miningRecords.forEach((record, idx) => {
                if (record.status !== 'active') return;

                const startTime = new Date(record.startDate).getTime();
                const hoursElapsed = (now - startTime) / (1000 * 60 * 60);
                const dailyReward = record.stakedAmount * record.dailyYield;
                
                // Check if 24 hours or more have passed since last income update
                let lastUpdateTime = startTime;
                if (record.lastIncomeAt) {
                    lastUpdateTime = new Date(record.lastIncomeAt).getTime();
                }
                
                const hoursSinceLastUpdate = (now - lastUpdateTime) / (1000 * 60 * 60);
                
                // If at least 24 hours have passed since start or last update
                if (hoursElapsed >= 24 || hoursSinceLastUpdate >= 24) {
                    const userIndex = users.findIndex(u => u.userid === record.userid || u.uid === record.userid);
                    
                    if (userIndex !== -1) {
                        const user = users[userIndex];
                        user.balances = user.balances || {};
                        const currentBalance = user.balances.eth || 0;
                        user.balances.eth = currentBalance + dailyReward;
                        
                        // Update mining record
                        miningRecords[idx].totalIncome = (miningRecords[idx].totalIncome || 0) + dailyReward;
                        miningRecords[idx].todayIncome = dailyReward;
                        miningRecords[idx].lastIncomeAt = new Date().toISOString();
                        
                        changed = true;
                        
                        console.log(`[MINING SETTLEMENT] Settled reward for user ${record.userid}:`, {
                            reward: dailyReward.toFixed(8),
                            newBalance: user.balances.eth.toFixed(8),
                            orderId: record.id
                        });
                    }
                }
            });

            // Save if changes were made
            if (changed) {
                fs.writeFileSync(miningFile, JSON.stringify(miningRecords, null, 2));
                fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
                console.log('[MINING SETTLEMENT] Updates saved to files');
            }
        } catch (error) {
            console.error('[MINING SETTLEMENT] Error:', error.message);
        }
    }

    // Schedule rewards function
    function scheduleRewards(userid, stakedAmount, dailyYield, miningId) {
        const dailyReward = stakedAmount * dailyYield;
        
        console.log(`[MINING SCHEDULER] Started for user ${userid}:`, {
            stakedAmount,
            dailyYield: (dailyYield * 100) + '%',
            dailyReward: dailyReward.toFixed(8) + ' ETH'
        });

        // Set interval to add rewards every 24 hours
        const rewardInterval = setInterval(() => {
            try {
                // Read current user data
                const usersFile = path.join(__dirname, 'users.json');
                let users = [];
                if (fs.existsSync(usersFile)) {
                    users = JSON.parse(fs.readFileSync(usersFile, 'utf8')) || [];
                }

                const userIndex = users.findIndex(u => u.userid === userid || u.uid === userid);
                if (userIndex === -1) {
                    console.log(`[MINING SCHEDULER] User ${userid} not found, stopping rewards`);
                    clearInterval(rewardInterval);
                    return;
                }

                const user = users[userIndex];
                const currentBalance = user.balances?.eth || 0;
                const newBalance = currentBalance + dailyReward;

                user.balances = user.balances || {};
                user.balances.eth = newBalance;

                // Save updated users
                fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));

                // Update mining record
                const miningFile = path.join(__dirname, 'mining_records.json');
                let miningRecords = [];
                if (fs.existsSync(miningFile)) {
                    try {
                        miningRecords = JSON.parse(fs.readFileSync(miningFile, 'utf8')) || [];
                    } catch (e) {
                        miningRecords = [];
                    }
                }

                const miningIndex = miningRecords.findIndex(m => m.id === miningId);
                if (miningIndex !== -1) {
                    miningRecords[miningIndex].totalIncome = (miningRecords[miningIndex].totalIncome || 0) + dailyReward;
                    miningRecords[miningIndex].todayIncome = dailyReward;
                    miningRecords[miningIndex].lastIncomeAt = new Date().toISOString();
                    fs.writeFileSync(miningFile, JSON.stringify(miningRecords, null, 2));
                }

                console.log(`[MINING REWARD] Added ${dailyReward.toFixed(8)} ETH to user ${userid}`, {
                    newBalance: newBalance.toFixed(8) + ' ETH'
                });
            } catch (error) {
                console.error(`[MINING SCHEDULER] Error for user ${userid}:`, error.message);
            }
        }, 24 * 60 * 60 * 1000); // Every 24 hours
    }

    // WALLET API ENDPOINTS
    
    // Get wallet balance (GET) - accept ?userid= for browser/direct requests
    if ((pathname === '/api/Wallet/getbalance' || pathname === '/api/wallet/getbalance') && req.method === 'GET') {
        try {
            const queryParams = url.parse(req.url, true).query;
            const userid = queryParams.userid || queryParams.user_id;

            if (!userid) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: 0, error: 'Missing userid parameter', success: false }));
                return;
            }

            const user = getUserById(userid);
            if (!user) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: 0, error: 'User not found', success: false }));
                return;
            }

            // Return balance data from user.balances object (or fallback to direct properties)
            const balances = user.balances || {};
            const balanceData = {
                code: 1,
                success: true,
                data: {
                    usdt: balances.usdt || user.usdt || 0,
                    btc: balances.btc || user.btc || 0,
                    eth: balances.eth || user.eth || 0,
                    usdc: balances.usdc || user.usdc || 0,
                    pyusd: balances.pyusd || user.pyusd || 0,
                    sol: balances.sol || user.sol || 0
                }
            };

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(balanceData));
        } catch (e) {
            console.error('[wallet-getbalance-GET] Error:', e.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ code: 0, error: e.message, success: false }));
        }
        return;
    }

    // Get wallet balance (POST) - Compatible with original API format
    if ((pathname === '/api/Wallet/getbalance' || pathname === '/api/wallet/getbalance') && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                let jsonBody = body;
                if (body.includes('}&')) {
                    jsonBody = body.substring(0, body.indexOf('}&') + 1);
                }

                // Try to parse JSON first, fall back to urlencoded (jQuery default)
                let data;
                try {
                    data = JSON.parse(jsonBody);
                } catch (parseErr) {
                    data = {};
                    // parse x-www-form-urlencoded like: userid=123&foo=bar
                    jsonBody.split('&').forEach(pair => {
                        if (!pair) return;
                        const parts = pair.split('=');
                        const key = decodeURIComponent(parts[0] || '').trim();
                        const val = decodeURIComponent((parts[1] || '').replace(/\+/g, ' ')).trim();
                        if (key) data[key] = val;
                    });
                }
                const userid = data.userid || data.user_id;
                
                if (!userid) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: 0, error: 'Missing userid parameter', success: false }));
                    return;
                }
                
                // Get user from database
                const user = getUserById(userid);
                
                if (!user) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: 0, error: 'User not found', success: false }));
                    return;
                }
                
                // Return balance data from user.balances object (or fallback to direct properties)
                const balances = user.balances || {};
                const balanceData = {
                    code: 1,
                    success: true,
                    data: {
                        usdt: balances.usdt || user.usdt || 0,
                        btc: balances.btc || user.btc || 0,
                        eth: balances.eth || user.eth || 0,
                        usdc: balances.usdc || user.usdc || 0,
                        pyusd: balances.pyusd || user.pyusd || 0,
                        sol: balances.sol || user.sol || 0
                    }
                };
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(balanceData));
            } catch (e) {
                console.error('[wallet-getbalance] Error:', e.message);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: 0, error: e.message, success: false }));
            }
        });
        return;
    }

    // Get all transactions for financial records page: /api/Record/getTransactions
    if ((pathname === '/api/Record/getTransactions' || pathname === '/api/record/getTransactions') && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                let data = {};
                if (body && body.includes('{')) {
                    try { data = JSON.parse(body); } catch (e) { /* fallthrough */ }
                }
                if (Object.keys(data).length === 0) {
                    body.split('&').forEach(pair => {
                        if (!pair) return;
                        const parts = pair.split('=');
                        const key = decodeURIComponent(parts[0] || '').trim();
                        const val = decodeURIComponent((parts[1] || '').replace(/\+/g, ' ')).trim();
                        if (key) data[key] = val;
                    });
                }

                const userid = data.userid || data.user_id || data.uid;
                const type = parseInt(data.type || '0');
                const page = Number(data.page || 1) || 1;
                const pageSize = 10;

                if (!userid) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: 0, data: [], message: 'Missing userid' }));
                    return;
                }

                // Collect all transactions from different sources
                let allTransactions = [];

                // 1. Topup records
                if (type === 0 || type === 3) {
                    try {
                        const topupPath = path.join(__dirname, 'topup_records.json');
                        if (fs.existsSync(topupPath)) {
                            const topupData = JSON.parse(fs.readFileSync(topupPath, 'utf8')) || [];
                            topupData.forEach(r => {
                                if (String(r.user_id) === String(userid) || String(r.userid) === String(userid)) {
                                    allTransactions.push({
                                        gaibian: 3,
                                        bizhong: r.coin || 'USDT',
                                        jine: r.amount || r.quantity || 0,
                                        shijian: Math.floor(new Date(r.timestamp || r.created_at || Date.now()).getTime() / 1000)
                                    });
                                }
                            });
                        }
                    } catch (e) { /* skip */ }
                }

                // 2. Withdrawal records
                if (type === 0 || type === 4) {
                    try {
                        const withdrawPath = path.join(__dirname, 'withdrawal_records.json');
                        if (fs.existsSync(withdrawPath)) {
                            const withdrawData = JSON.parse(fs.readFileSync(withdrawPath, 'utf8')) || [];
                            withdrawData.forEach(r => {
                                if (String(r.user_id) === String(userid) || String(r.userid) === String(userid)) {
                                    allTransactions.push({
                                        gaibian: 4,
                                        bizhong: r.coin || 'USDT',
                                        jine: r.amount || r.quantity || 0,
                                        shijian: Math.floor(new Date(r.timestamp || r.created_at || Date.now()).getTime() / 1000)
                                    });
                                }
                            });
                        }
                    } catch (e) { /* skip */ }
                }

                // 3. Exchange records
                if (type === 0 || type === 8 || type === 9) {
                    try {
                        const exchangePath = path.join(__dirname, 'exchange_records.json');
                        if (fs.existsSync(exchangePath)) {
                            const exchangeData = JSON.parse(fs.readFileSync(exchangePath, 'utf8')) || [];
                            exchangeData.forEach(r => {
                                if (String(r.user_id) === String(userid) || String(r.userid) === String(userid)) {
                                    // Both out (8) and in (9) from same exchange record
                                    allTransactions.push({
                                        gaibian: 8,  // Cash out
                                        bizhong: r.from_coin || 'USDT',
                                        jine: r.from_amount || r.quantity || 0,
                                        shijian: Math.floor(new Date(r.timestamp || r.created_at || Date.now()).getTime() / 1000)
                                    });
                                    allTransactions.push({
                                        gaibian: 9,  // Cash in
                                        bizhong: r.to_coin || 'USDT',
                                        jine: r.to_amount || r.received || 0,
                                        shijian: Math.floor(new Date(r.timestamp || r.created_at || Date.now()).getTime() / 1000)
                                    });
                                }
                            });
                        }
                    } catch (e) { /* skip */ }
                }

                // 4. Arbitrage subscriptions (records 5, 6, 7)
                if (type === 0 || type === 5 || type === 6 || type === 7) {
                    try {
                        const arbiPath = path.join(__dirname, 'arbitrage_subscriptions.json');
                        if (fs.existsSync(arbiPath)) {
                            const arbiData = JSON.parse(fs.readFileSync(arbiPath, 'utf8')) || [];
                            arbiData.forEach(r => {
                                if (String(r.userId) === String(userid)) {
                                    // Purchase (5)
                                    allTransactions.push({
                                        gaibian: 5,
                                        bizhong: 'USDT',
                                        jine: r.amount || 0,
                                        shijian: r.subscriptionDate || Math.floor(Date.now() / 1000)
                                    });
                                    // Income (6) if settled and won
                                    if (r.settled && r.won) {
                                        allTransactions.push({
                                            gaibian: 6,
                                            bizhong: 'USDT',
                                            jine: r.income || 0,
                                            shijian: Math.floor(new Date(r.maturityDate * 1000).getTime() / 1000)
                                        });
                                    }
                                    // Refund (7) if settled and lost
                                    if (r.settled && !r.won) {
                                        allTransactions.push({
                                            gaibian: 7,
                                            bizhong: 'USDT',
                                            jine: r.amount || 0,
                                            shijian: Math.floor(new Date(r.maturityDate * 1000).getTime() / 1000)
                                        });
                                    }
                                }
                            });
                        }
                    } catch (e) { /* skip */ }
                }

                // Sort by time descending
                allTransactions.sort((a, b) => b.shijian - a.shijian);

                // Paginate
                const startIdx = (page - 1) * pageSize;
                const endIdx = startIdx + pageSize;
                const paginatedTransactions = allTransactions.slice(startIdx, endIdx);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: 1, data: paginatedTransactions }));
            } catch (e) {
                console.error('[/Record/getTransactions] Error:', e);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: 0, data: [], message: 'Server error' }));
            }
        });
        return;
    }

    // Legacy alias: some pages call /api/Record/getloan — rewrite to Wallet/getloaned
    if ((pathname === '/api/Record/getloan' || pathname === '/api/record/getloan') && req.method === 'POST') {
        pathname = '/api/Wallet/getloaned';
    }

    // Legacy alias / compatibility: some pages call /api/Record/getcontract to retrieve contract/trade records
    if ((pathname === '/api/Record/getcontract' || pathname === '/api/record/getcontract') && req.method === 'POST') {
        // Handle directly here: read trades_records.json and return user-specific contracts (paged)
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                // parse urlencoded or json
                let data = {};
                if (body && body.includes('{')) {
                    try { data = JSON.parse(body); } catch (e) { /* fallthrough */ }
                }
                if (Object.keys(data).length === 0) {
                    body.split('&').forEach(pair => {
                        if (!pair) return;
                        const parts = pair.split('=');
                        const key = decodeURIComponent(parts[0] || '').trim();
                        const val = decodeURIComponent((parts[1] || '').replace(/\+/g, ' ')).trim();
                        if (key) data[key] = val;
                    });
                }

                const userid = data.userid || data.user_id || data.uid;
                const page = Number(data.page || 1) || 1;
                const pageSize = 10;

                if (!userid) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: 0, data: [], message: 'Missing userid' }));
                    return;
                }

                const tradesFilePath = path.join(__dirname, 'trades_records.json');
                let trades = [];
                if (fs.existsSync(tradesFilePath)) {
                    try { trades = JSON.parse(fs.readFileSync(tradesFilePath, 'utf8')) || []; } catch (e) { trades = []; }
                }

                // Filter by user id
                let userTrades = trades.filter(t => String(t.userid) === String(userid) || String(t.user_id) === String(userid));

                // Sort newest first
                userTrades.sort((a, b) => {
                    const ta = a && a.created_at ? new Date(a.created_at).getTime() : 0;
                    const tb = b && b.created_at ? new Date(b.created_at).getTime() : 0;
                    return tb - ta;
                });

                // paging
                const start = (page - 1) * pageSize;
                const pageTrades = userTrades.slice(start, start + pageSize).map(trade => {
                    const num = Number(trade.num) || 0;
                    const status = (trade.status || '').toString().toLowerCase();
                    // fangxiang: normalize to 1 (up) or 2 (down)
                    let fangxiang = 2;
                    if (String(trade.fangxiang).toLowerCase() === 'up' || String(trade.fangxiang).toLowerCase() === 'upward' || String(trade.fangxiang) === '1') fangxiang = 1;
                    if (String(trade.fangxiang) === '2' || String(trade.fangxiang).toLowerCase() === 'down' || String(trade.fangxiang).toLowerCase() === 'downward') fangxiang = 2;

                    // determine zhuangtai (1 = pending/unsettled)
                    const zhuangtai = (status === 'pending' || status === '1') ? 1 : 0;
                    // determine zuizhong (1 = settled / win, 2 = settled / loss)
                    const zuizhong = (status === 'win' || status === 'success' || status === '2') ? 1 : 0;
                    const isloss = (status === 'loss' || status === '3') ? 1 : 0;

                    // compute payout (ying)
                    // For LOSS: ying = -num (negative amount for display in red)
                    // For WIN: ying = num + profit
                    // For PENDING: ying = num (no change)
                    let ying = num;
                    if (isloss === 1) {
                        // Loss: show negative amount
                        ying = -num;
                    } else if (zuizhong === 1) {
                        // Win: use recorded fields if available
                        if (trade.payout) ying = Number(trade.payout);
                        else if (trade.settled_amount) ying = Number(trade.settled_amount);
                        else if (trade.profit) ying = Number(num) + Number(trade.profit);
                        else {
                            // approximate using a default profit ratio (40%) to match server settlement logic
                            const profit = Number((num * 0.4).toFixed(2));
                            ying = Number((num + profit).toFixed(2));
                        }
                    }

                    // buytime: convert created_at to unix timestamp seconds
                    let buytime = 0;
                    if (trade.created_at) {
                        const d = new Date(trade.created_at).getTime();
                        if (Number.isFinite(d)) buytime = Math.floor(d / 1000);
                    } else if (trade.buytime) {
                        buytime = Number(trade.buytime);
                    }

                    return {
                        id: trade.id,
                        biming: trade.biming || trade.coin || '',
                        num: num,
                        fangxiang: fangxiang,
                        miaoshu: trade.miaoshu || trade.duration || '',
                        buytime: buytime,
                        zhuangtai: zhuangtai,
                        zuizhong: zuizhong,
                        ying: ying
                    };
                });

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: 1, data: pageTrades }));
            } catch (e) {
                console.error('[record-getcontract] Error:', e.message);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: 0, data: [], message: e.message }));
            }
        });
        return;
    }

    // Admin endpoint: get ALL users' contract records (paginated) - /api/admin/contract/records
    if ((pathname === '/api/admin/contract/records' || pathname === '/api/admin/contract/all') && req.method === 'GET') {
        try {
            const tradesFilePath = path.join(__dirname, 'trades_records.json');
            let trades = [];
            if (fs.existsSync(tradesFilePath)) {
                try { trades = JSON.parse(fs.readFileSync(tradesFilePath, 'utf8')) || []; } catch (e) { trades = []; }
            }

            // Get query parameters for pagination
            const urlParts = url.parse(req.url, true);
            const page = Number(urlParts.query.page || 1) || 1;
            const pageSize = Number(urlParts.query.limit || 20) || 20;

            // Sort by created_at descending (newest first)
            let sortedTrades = [...trades].sort((a, b) => {
                const ta = a && a.created_at ? new Date(a.created_at).getTime() : 0;
                const tb = b && b.created_at ? new Date(b.created_at).getTime() : 0;
                return tb - ta;
            });

            // Paginate
            const start = (page - 1) * pageSize;
            const pageTrades = sortedTrades.slice(start, start + pageSize).map(trade => {
                const num = Number(trade.num) || 0;
                const status = (trade.status || '').toString().toLowerCase();
                let fangxiang = 2;
                if (String(trade.fangxiang).toLowerCase() === 'up' || String(trade.fangxiang).toLowerCase() === 'upward' || String(trade.fangxiang) === '1') fangxiang = 1;
                if (String(trade.fangxiang) === '2' || String(trade.fangxiang).toLowerCase() === 'down' || String(trade.fangxiang).toLowerCase() === 'downward') fangxiang = 2;
                const zhuangtai = (status === 'pending' || status === '1') ? 1 : 0;
                const zuizhong = (status === 'win' || status === 'success' || status === '2') ? 1 : 0;
                const isloss = (status === 'loss' || status === '3') ? 1 : 0;
                let ying = num;
                if (isloss === 1) {
                    ying = -num;
                } else if (zuizhong === 1) {
                    if (trade.payout) ying = Number(trade.payout);
                    else if (trade.settled_amount) ying = Number(trade.settled_amount);
                    else if (trade.profit) ying = Number(num) + Number(trade.profit);
                    else {
                        const profit = Number((num * 0.4).toFixed(2));
                        ying = Number((num + profit).toFixed(2));
                    }
                }
                let buytime = 0;
                if (trade.created_at) {
                    const d = new Date(trade.created_at).getTime();
                    if (Number.isFinite(d)) buytime = Math.floor(d / 1000);
                } else if (trade.buytime) {
                    buytime = Number(trade.buytime);
                }
                return {
                    id: trade.id,
                    userid: trade.userid || trade.user_id || '',
                    username: trade.username || '',
                    biming: trade.biming || trade.coin || '',
                    num: num,
                    fangxiang: fangxiang,
                    miaoshu: trade.miaoshu || trade.duration || '',
                    buytime: buytime,
                    status: status,
                    zhuangtai: zhuangtai,
                    zuizhong: zuizhong,
                    isloss: isloss,
                    ying: ying,
                    buyprice: trade.buyprice || '0',
                    created_at: trade.created_at,
                    updated_at: trade.updated_at
                };
            });
            const totalRecords = sortedTrades.length;
            const totalPages = Math.ceil(totalRecords / pageSize);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
                code: 1, 
                data: pageTrades,
                pagination: { page: page, limit: pageSize, total: totalRecords, pages: totalPages }
            }));
        } catch (e) {
            console.error('[admin-contract] Error:', e.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ code: 0, data: [], message: e.message }));
        }
        return;
    }

    // Loan: get loan summary for user (POST) - /api/Wallet/getloaned
    if ((pathname === '/api/Wallet/getloaned' || pathname === '/api/wallet/getloaned') && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                // parse urlencoded or json
                let data = {};
                if (body && body.includes('{')) {
                    try { data = JSON.parse(body); } catch (e) { /* fallthrough */ }
                }
                if (Object.keys(data).length === 0) {
                    body.split('&').forEach(pair => {
                        if (!pair) return;
                        const parts = pair.split('=');
                        const key = decodeURIComponent(parts[0] || '').trim();
                        const val = decodeURIComponent((parts[1] || '').replace(/\+/g, ' ')).trim();
                        if (key) data[key] = val;
                    });
                }

                const userid = data.userid || data.user_id;
                if (!userid) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: 0, data: 'Missing userid' }));
                    return;
                }

                // Load user loan quota from users.json (fallback default)
                const usersFile = path.join(__dirname, 'users.json');
                let users = [];
                if (fs.existsSync(usersFile)) {
                    try { users = JSON.parse(fs.readFileSync(usersFile, 'utf8')) || []; } catch (e) { users = []; }
                }
                const user = users.find(u => u.userid === userid || u.uid === userid) || {};
                const loanQuota = Number(user.loan_quota || user.loan_limit || 1000);

                // Load loan records
                const loansFile = path.join(__dirname, 'loans_records.json');
                let loans = [];
                if (fs.existsSync(loansFile)) {
                    try { loans = JSON.parse(fs.readFileSync(loansFile, 'utf8')) || []; } catch (e) { loans = []; }
                }

                const userLoans = loans.filter(l => String(l.userid) === String(userid));
                const total_jine = userLoans.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
                const total_weihuan = userLoans.reduce((s, r) => {
                    const st = (r.status || '').toLowerCase();
                    if (st === 'repaid' || st === 'redeemed' || st === 'returned') return s; // exclude repaid
                    return s + (parseFloat(r.amount) || 0);
                }, 0);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: 1, data: { edu: loanQuota, total_jine: total_jine, total_weihuan: total_weihuan } }));
            } catch (err) {
                console.error('[getloaned] Error:', err.message);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: 0, data: 'Server error' }));
            }
        });
        return;
    }

    // Loan: submit loan application (POST) - /api/Wallet/addloan
    if ((pathname === '/api/Wallet/addloan' || pathname === '/api/wallet/addloan') && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                let data = {};
                if (body && body.includes('{')) {
                    try { data = JSON.parse(body); } catch (e) { /* ignore */ }
                }
                if (Object.keys(data).length === 0) {
                    body.split('&').forEach(pair => {
                        if (!pair) return;
                        const parts = pair.split('=');
                        const key = decodeURIComponent(parts[0] || '').trim();
                        const val = decodeURIComponent((parts[1] || '').replace(/\+/g, ' ')).trim();
                        if (key) data[key] = val;
                    });
                }

                const userid = data.userid;
                const username = data.username;
                const shuliang = parseFloat(data.shuliang) || 0;
                const tianshu = parseInt(data.tianshu) || 0;
                const lixi = parseFloat(data.lixi) || 0;
                const zfxx = data.zfxx || '';
                const srzm = data.srzm || '';
                const yhxx = data.yhxx || '';
                const sfz = data.sfz || '';

                if (!userid || !username || !shuliang || !tianshu) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: 0, data: 'Missing required fields' }));
                    return;
                }

                const loansFile = path.join(__dirname, 'loans_records.json');
                let loans = [];
                if (fs.existsSync(loansFile)) {
                    try { loans = JSON.parse(fs.readFileSync(loansFile, 'utf8')) || []; } catch (e) { loans = []; }
                }

                const record = {
                    id: uuidv4(),
                    orderId: uuidv4(),
                    userid: userid,
                    username: username,
                    amount: shuliang,
                    days: tianshu,
                    interest: lixi,
                    images: { zfxx, srzm, yhxx, sfz },
                    status: 'pending',
                    created_at: new Date().toISOString()
                };

                loans.push(record);
                fs.writeFileSync(loansFile, JSON.stringify(loans, null, 2));

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: 1, data: 'Application submitted' }));
            } catch (err) {
                console.error('[addloan] Error:', err.message);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: 0, data: 'Server error' }));
            }
        });
        return;
    }

    // Wallet image upload alias - /api/Wallet/upload_image
    if ((pathname === '/api/Wallet/upload_image' || pathname === '/api/wallet/upload_image') && req.method === 'POST') {
        let chunks = [];
        req.on('data', chunk => { chunks.push(chunk); });
        req.on('end', () => {
            try {
                const uploadsDir = path.join(__dirname, 'uploads');
                if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

                const contentType = (req.headers['content-type'] || '').toString();
                const buffer = Buffer.concat(chunks || []);

                let fileBuffer = buffer;
                let ext = '.png';

                if (contentType.indexOf('multipart/form-data') !== -1) {
                    // Parse multipart form-data to extract file bytes
                    const m = contentType.match(/boundary=(.*)$/);
                    const boundary = m ? ('--' + m[1]) : null;
                    if (boundary) {
                        const boundaryBuf = Buffer.from('\r\n' + boundary);
                        const startIdx = buffer.indexOf(Buffer.from('\r\n\r\n'));
                        if (startIdx !== -1) {
                            const fileStart = startIdx + 4;
                            const endIdx = buffer.indexOf(boundaryBuf, fileStart);
                            const fileEnd = endIdx !== -1 ? endIdx : buffer.length;
                            fileBuffer = buffer.slice(fileStart, fileEnd);
                        }
                        // attempt to sniff MIME type from header preamble
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
                const uploadPath = path.join(uploadsDir, filename);
                fs.writeFileSync(uploadPath, fileBuffer);
                const fileUrl = '/uploads/' + filename;
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: 1, data: fileUrl, message: 'Image uploaded successfully' }));
            } catch (err) {
                console.error('[wallet-upload-image] Error:', err.message, err);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: 0, data: err.message }));
            }
        });
        return;
    }

    // ADMIN AUTHENTICATION ENDPOINTS

    // Admin Login
    if (pathname === '/api/admin/login' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                let jsonBody = body;
                if (body.includes('}&')) {
                    jsonBody = body.substring(0, body.indexOf('}&') + 1);
                }

                const data = JSON.parse(jsonBody);
                const { username, password } = data;

                if (!username || !password) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Username and password required' }));
                    return;
                }

                const result = loginAdmin(username, password);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, ...result }));
            } catch (e) {
                console.error('[admin-login] Error:', e.message);
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: e.message }));
            }
        });
        return;
    }

    // Admin Register
    if (pathname === '/api/admin/register' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                let jsonBody = body;
                if (body.includes('}&')) {
                    jsonBody = body.substring(0, body.indexOf('}&') + 1);
                }

                const data = JSON.parse(jsonBody);
                const { fullname, username, email, password } = data;

                if (!fullname || !username || !email || !password) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'All fields required' }));
                    return;
                }

                const admin = registerAdmin(fullname, username, email, password);
                res.writeHead(201, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: 'Admin registered successfully', admin: { id: admin.id, username: admin.username, email: admin.email } }));
            } catch (e) {
                console.error('[admin-register] Error:', e.message);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: e.message }));
            }
        });
        return;
    }

    // ADMIN API ENDPOINTS
    
    // Get current admin info (requires valid token) - GET /api/admin/me
    if (pathname === '/api/admin/me' && req.method === 'GET') {
        try {
            const authHeader = req.headers['authorization'] || '';
            const token = authHeader.replace('Bearer ', '') || url.parse(req.url, true).query.token;
            
            if (!token) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'No token provided' }));
                return;
            }
            
            const decoded = verifyToken(token);
            if (!decoded || !decoded.adminId) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid or expired token' }));
                return;
            }
            
            const admin = getAdminById(decoded.adminId);
            if (!admin) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Admin not found' }));
                return;
            }
            
            // Return admin info without password
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                admin: {
                    id: admin.id,
                    fullname: admin.fullname,
                    username: admin.username,
                    email: admin.email,
                    status: admin.status,
                    created_at: admin.created_at,
                    lastLogin: admin.lastLogin
                }
            }));
        } catch (e) {
            console.error('[admin-me] Error:', e.message);
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Authentication failed' }));
        }
        return;
    }

    // Get all admin accounts (requires valid token) - GET /api/admin/list
    if (pathname === '/api/admin/list' && req.method === 'GET') {
        try {
            const authHeader = req.headers['authorization'] || '';
            const token = authHeader.replace('Bearer ', '') || url.parse(req.url, true).query.token;
            
            if (!token) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'No token provided' }));
                return;
            }
            
            const decoded = verifyToken(token);
            if (!decoded || !decoded.adminId) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid or expired token' }));
                return;
            }
            
            const admins = getAllAdmins();
            // Return admin list without passwords
            const safeAdmins = admins.map(a => ({
                id: a.id,
                fullname: a.fullname,
                username: a.username,
                email: a.email,
                status: a.status,
                created_at: a.created_at,
                lastLogin: a.lastLogin
            }));
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, admins: safeAdmins }));
        } catch (e) {
            console.error('[admin-list] Error:', e.message);
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Authentication failed' }));
        }
        return;
    }
    
    // Get all users (admin)
    if (pathname === '/api/admin/users' && req.method === 'GET') {
        const users = getAllUsers();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, users }));
        return;
    }

    // Get user details and stats (admin)
    if (pathname === '/api/admin/user-stats' && req.method === 'GET') {
        const queryParams = url.parse(req.url, true).query;
        const userId = queryParams.user_id;
        
        if (!userId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing user_id parameter' }));
            return;
        }

        const user = getUserById(userId);
        const stats = getUserStats(userId);

        if (!user) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'User not found' }));
            return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, user, stats }));
        return;
    }

    // Update user balance (admin)
    if (pathname === '/api/admin/update-balance' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                let jsonBody = body;
                if (body.includes('}&')) {
                    jsonBody = body.substring(0, body.indexOf('}&') + 1);
                }

                const data = JSON.parse(jsonBody);
                const { user_id, coin, amount } = data;

                if (!user_id || !coin || amount === undefined) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Missing required fields' }));
                    return;
                }

                const updatedUser = updateUserBalance(user_id, coin, amount);

                if (!updatedUser) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'User not found' }));
                    return;
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, user: updatedUser }));
            } catch (e) {
                console.error('[admin-update-balance] Error:', e.message);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: e.message }));
            }
        });
        return;
    }

    // Add topup record for user (admin)
    if (pathname === '/api/admin/add-topup' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                let jsonBody = body;
                if (body.includes('}&')) {
                    jsonBody = body.substring(0, body.indexOf('}&') + 1);
                }

                const data = JSON.parse(jsonBody);
                const { user_id, coin, amount } = data;

                if (!user_id || !coin || !amount) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Missing required fields' }));
                    return;
                }

                const record = addTopupRecord(user_id, coin, amount);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, record }));
            } catch (e) {
                console.error('[admin-add-topup] Error:', e.message);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: e.message }));
            }
        });
        return;
    }

            // Approve top-up: update status and add to user balance (admin)
            if (pathname === '/api/admin/approve-topup' && req.method === 'POST') {
                let body = '';
                req.on('data', chunk => { body += chunk; });
                req.on('end', () => {
                    try {
                        // Handle legacy jQuery body format
                        if (body.includes('}&')) body = body.substring(0, body.indexOf('}&') + 1);
                        const data = JSON.parse(body);
                        const { topupId, amount } = data;
                        if (!topupId || !amount) {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: false, error: 'Missing topupId or amount' }));
                            return;
                        }

                        const topupRecordsPath = './topup_records.json';
                        const usersPath = './users.json';
                        let topupRecords = [];
                        let users = [];
                        if (fs.existsSync(topupRecordsPath)) {
                            topupRecords = JSON.parse(fs.readFileSync(topupRecordsPath));
                        }
                        if (fs.existsSync(usersPath)) {
                            users = JSON.parse(fs.readFileSync(usersPath));
                        }

                        const topup = topupRecords.find(r => r.id === topupId);
                        if (!topup) {
                            res.writeHead(404, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: false, error: 'Topup record not found' }));
                            return;
                        }
                        if (topup.status === 'complete') {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: false, error: 'Already completed' }));
                            return;
                        }

                        // Mark complete and update user balance
                        topup.status = 'complete';
                        const user = users.find(u => u.id === topup.user_id);
                        if (!user) {
                            res.writeHead(404, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: false, error: 'User not found' }));
                            return;
                        }

                        user.balance = (parseFloat(user.balance) || 0) + parseFloat(amount);

                        fs.writeFileSync(topupRecordsPath, JSON.stringify(topupRecords, null, 2));
                        fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));

                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, newBalance: user.balance }));
                    } catch (err) {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, error: err.message }));
                    }
                });
                return;
            }

    // Admin Topup Approval - PUT /api/admin/topup/approve
    if (pathname === '/api/admin/topup/approve' && req.method === 'PUT') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                // Clean legacy jQuery appended params if present, then parse
                let jsonBody = body;
                if (body && body.includes('}&')) jsonBody = body.substring(0, body.indexOf('}&') + 1);
                const data = JSON.parse(jsonBody);
                const { id } = data;
                
                if (!id) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: 0, info: 'Missing record ID' }));
                    return;
                }

                const topupRecordsPath = path.join(__dirname, 'topup_records.json');
                let topupRecords = [];
                
                if (fs.existsSync(topupRecordsPath)) {
                    topupRecords = JSON.parse(fs.readFileSync(topupRecordsPath));
                }

                const recordIndex = topupRecords.findIndex(r => r.id === id);
                if (recordIndex === -1) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: 0, info: 'Record not found' }));
                    return;
                }

                const record = topupRecords[recordIndex];
                
                // Only approve if pending
                if (record.status !== 'pending') {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: 0, info: 'Record is not pending' }));
                    return;
                }

                // Update the record
                record.status = 'complete';
                record.updated_at = new Date().toISOString();
                topupRecords[recordIndex] = record;

                // Save to JSON file
                fs.writeFileSync(topupRecordsPath, JSON.stringify(topupRecords, null, 2));

                // Update user balance in users.json
                try {
                    const usersPath = path.join(__dirname, 'users.json');
                    let users = [];
                    if (fs.existsSync(usersPath)) {
                        users = JSON.parse(fs.readFileSync(usersPath));
                    }

                    const userIndex = users.findIndex(u => u.userid === record.user_id || u.uid === record.user_id);
                    if (userIndex !== -1) {
                        const user = users[userIndex];
                        const coin = (record.coin || 'usdt').toLowerCase();
                        const amount = parseFloat(record.amount) || 0;

                        // Initialize balances object if it doesn't exist
                        if (!user.balances) {
                            user.balances = {};
                        }

                        // Add to user's coin balance
                        user.balances[coin] = (user.balances[coin] || 0) + amount;

                        console.log(`[ADMIN] Updated user ${record.user_id} balance: +${amount} ${coin} = ${user.balances[coin]}`);

                        // Save updated users
                        fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));
                        // Notify user about topup approval
                        try {
                            addNotification({ userid: record.user_id, biaoti: 'Topup Approved', neirong: `Your deposit of ${record.amount} ${record.coin || 'USDT'} has been approved.`, sfyidu: 0 });
                        } catch (e) { /* best-effort only */ }
                    } else {
                        console.warn(`[ADMIN] User not found for topup approval: ${record.user_id}`);
                        try { addNotification({ userid: record.user_id, biaoti: 'Topup Approved', neirong: `Your deposit record ${record.id} has been marked approved.`, sfyidu: 0 }); } catch(e){}
                    }
                } catch (balanceErr) {
                    console.error('[ADMIN] Failed to update user balance:', balanceErr);
                    // Don't fail the topup approval if balance update fails
                }

                console.log(`[ADMIN] Approved topup record: ${id}`);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    code: 1,
                    info: 'Record approved successfully and balance updated',
                    data: record
                }));
            } catch (err) {
                console.error('[ADMIN] Approval error:', err);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: 0, info: 'Server error: ' + err.message }));
            }
        });
        return;
    }

    // Admin Topup Rejection - PUT /api/admin/topup/reject
    if (pathname === '/api/admin/topup/reject' && req.method === 'PUT') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                // Clean legacy jQuery appended params if present, then parse
                let jsonBody = body;
                if (body && body.includes('}&')) jsonBody = body.substring(0, body.indexOf('}&') + 1);
                const data = JSON.parse(jsonBody);
                const { id, reason } = data;
                
                if (!id) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: 0, info: 'Missing record ID' }));
                    return;
                }

                const topupRecordsPath = path.join(__dirname, 'topup_records.json');
                let topupRecords = [];
                
                if (fs.existsSync(topupRecordsPath)) {
                    topupRecords = JSON.parse(fs.readFileSync(topupRecordsPath));
                }

                const recordIndex = topupRecords.findIndex(r => r.id === id);
                if (recordIndex === -1) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: 0, info: 'Record not found' }));
                    return;
                }

                const record = topupRecords[recordIndex];
                
                // Only reject if pending
                if (record.status !== 'pending') {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: 0, info: 'Record is not pending' }));
                    return;
                }

                // Update the record
                record.status = 'rejected';
                record.rejection_reason = reason || 'No reason provided';
                record.updated_at = new Date().toISOString();
                topupRecords[recordIndex] = record;

                // Save to JSON file
                fs.writeFileSync(topupRecordsPath, JSON.stringify(topupRecords, null, 2));
                // Notify user about topup rejection
                try {
                    const rec = topupRecords[recordIndex];
                    addNotification({ userid: rec.user_id, biaoti: 'Topup Rejected', neirong: `Your deposit request ${rec.id} was rejected.`, sfyidu: 0 });
                } catch (e) { /* best-effort only */ }

                console.log(`[ADMIN] Rejected topup record: ${id}`);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    code: 1,
                    info: 'Record rejected successfully',
                    data: record
                }));
            } catch (err) {
                console.error('[ADMIN] Rejection error:', err);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: 0, info: 'Server error: ' + err.message }));
            }
        });
        return;
    }

    // ADMIN: get all loan records (GET) - /api/admin/loan-records
    if (pathname === '/api/admin/loan-records' && req.method === 'GET') {
        try {
            const loansFile = path.join(__dirname, 'loans_records.json');
            let loans = [];
            if (fs.existsSync(loansFile)) {
                try { loans = JSON.parse(fs.readFileSync(loansFile, 'utf8')) || []; } catch (e) { loans = []; }
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ code: 1, data: loans }));
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ code: 0, data: 'Failed to read loan records' }));
        }
        return;
    }

    // ADMIN: approve loan (POST) - /api/admin/loan/approve
    if (pathname === '/api/admin/loan/approve' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                if (body && body.includes('}&')) body = body.substring(0, body.indexOf('}&') + 1);
                const data = JSON.parse(body || '{}');
                const id = data.id || data.orderId;
                if (!id) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ code: 0, data: 'Missing id' })); return; }

                const loansFile = path.join(__dirname, 'loans_records.json');
                let loans = [];
                if (fs.existsSync(loansFile)) {
                    try { loans = JSON.parse(fs.readFileSync(loansFile, 'utf8')) || []; } catch (e) { loans = []; }
                }

                const idx = loans.findIndex(l => (l.id === id || l.orderId === id));
                if (idx === -1) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ code: 0, data: 'Record not found' })); return; }

                loans[idx].status = 'approved';
                loans[idx].updated_at = new Date().toISOString();
                fs.writeFileSync(loansFile, JSON.stringify(loans, null, 2));

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: 1, data: 'Loan approved' }));
            } catch (err) {
                console.error('[admin loan approve] Error:', err);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: 0, data: 'Server error' }));
            }
        });
        return;
    }

    // ADMIN: reject loan (POST) - /api/admin/loan/reject
    if (pathname === '/api/admin/loan/reject' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                if (body && body.includes('}&')) body = body.substring(0, body.indexOf('}&') + 1);
                const data = JSON.parse(body || '{}');
                const id = data.id || data.orderId;
                if (!id) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ code: 0, data: 'Missing id' })); return; }

                const loansFile = path.join(__dirname, 'loans_records.json');
                let loans = [];
                if (fs.existsSync(loansFile)) {
                    try { loans = JSON.parse(fs.readFileSync(loansFile, 'utf8')) || []; } catch (e) { loans = []; }
                }

                const idx = loans.findIndex(l => (l.id === id || l.orderId === id));
                if (idx === -1) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ code: 0, data: 'Record not found' })); return; }

                loans[idx].status = 'rejected';
                loans[idx].updated_at = new Date().toISOString();
                fs.writeFileSync(loansFile, JSON.stringify(loans, null, 2));

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: 1, data: 'Loan rejected' }));
            } catch (err) {
                console.error('[admin loan reject] Error:', err);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: 0, data: 'Server error' }));
            }
        });
        return;
    }

    // ADMIN: approve KYC (POST) - /api/admin/kyc/approve
    if (pathname === '/api/admin/kyc/approve' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                if (body && body.includes('}&')) body = body.substring(0, body.indexOf('}&') + 1);
                const data = JSON.parse(body || '{}');
                const { id, reviewer } = data;
                if (!id) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ code: 0, data: 'Missing id' })); return; }

                const kycPath = path.join(__dirname, 'kyc_records.json');
                let kyc = [];
                if (fs.existsSync(kycPath)) {
                    try { kyc = JSON.parse(fs.readFileSync(kycPath, 'utf8')) || []; } catch (e) { kyc = []; }
                }

                const idx = kyc.findIndex(r => r.id === id);
                if (idx === -1) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ code: 0, data: 'KYC record not found' })); return; }

                kyc[idx].status = 'approved';
                kyc[idx].reviewed_at = new Date().toISOString();
                kyc[idx].reviewed_by = reviewer || 'admin';
                fs.writeFileSync(kycPath, JSON.stringify(kyc, null, 2));

                // Update user's kycStatus in users.json
                const usersPath = path.join(__dirname, 'users.json');
                if (fs.existsSync(usersPath)) {
                    try {
                        const users = JSON.parse(fs.readFileSync(usersPath, 'utf8')) || [];
                        const userIdx = users.findIndex(u => u.userid == kyc[idx].userid || u.uid == kyc[idx].userid);
                        if (userIdx !== -1) {
                            // Set kycStatus depending on stage
                            if (!users[userIdx].kycStatus) users[userIdx].kycStatus = 'none';
                            if (kyc[idx].stage == 1) users[userIdx].kycStatus = 'basic';
                            if (kyc[idx].stage == 2) users[userIdx].kycStatus = 'advanced';
                            users[userIdx].verified = true;
                            fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));
                        }
                    } catch (e) {
                        console.error('[admin kyc approve] failed to update users.json', e);
                    }

                            // Notify the user about KYC approval
                            try {
                                const targetUserId = kyc[idx].userid;
                                addNotification({ userid: targetUserId, biaoti: 'KYC Approved', neirong: `Your KYC (stage ${kyc[idx].stage}) has been approved.`, sfyidu: 0 });
                            } catch (e) { /* best-effort only */ }
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: 1, data: 'KYC approved' }));
            } catch (err) {
                console.error('[admin kyc approve] Error:', err);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: 0, data: 'Server error' }));
            }
        });
        return;
    }

    // ADMIN: reject KYC (POST) - /api/admin/kyc/reject
    if (pathname === '/api/admin/kyc/reject' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                if (body && body.includes('}&')) body = body.substring(0, body.indexOf('}&') + 1);
                const data = JSON.parse(body || '{}');
                const { id, reviewer, reason } = data;
                if (!id) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ code: 0, data: 'Missing id' })); return; }

                const kycPath = path.join(__dirname, 'kyc_records.json');
                let kyc = [];
                if (fs.existsSync(kycPath)) {
                    try { kyc = JSON.parse(fs.readFileSync(kycPath, 'utf8')) || []; } catch (e) { kyc = []; }
                }

                const idx = kyc.findIndex(r => r.id === id);
                if (idx === -1) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ code: 0, data: 'KYC record not found' })); return; }

                kyc[idx].status = 'rejected';
                kyc[idx].reviewed_at = new Date().toISOString();
                kyc[idx].reviewed_by = reviewer || 'admin';
                kyc[idx].reject_reason = reason || null;
                fs.writeFileSync(kycPath, JSON.stringify(kyc, null, 2));

                // Optionally update users.json to reflect rejection
                const usersPath = path.join(__dirname, 'users.json');
                if (fs.existsSync(usersPath)) {
                    try {
                        const users = JSON.parse(fs.readFileSync(usersPath, 'utf8')) || [];
                        const userIdx = users.findIndex(u => u.userid == kyc[idx].userid || u.uid == kyc[idx].userid);
                        if (userIdx !== -1) {
                            // Reset kycStatus so user can resubmit after rejection
                            users[userIdx].kycStatus = 'none';
                            users[userIdx].verified = false;
                            fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));
                        }
                    } catch (e) {
                        console.error('[admin kyc reject] failed to update users.json', e);
                    }

                            // Notify the user about KYC rejection
                            try {
                                const targetUserId = kyc[idx].userid;
                                const reasonText = kyc[idx].reject_reason || '';
                                addNotification({ userid: targetUserId, biaoti: 'KYC Rejected', neirong: `Your KYC was rejected. ${reasonText}`, sfyidu: 0 });
                            } catch (e) { /* best-effort only */ }
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: 1, data: 'KYC rejected' }));
            } catch (err) {
                console.error('[admin kyc reject] Error:', err);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: 0, data: 'Server error' }));
            }
        });
        return;
    }

    // Admin Withdrawal Approval - PUT or POST /api/admin/withdrawal/complete
    if (pathname === '/api/admin/withdrawal/complete' && (req.method === 'PUT' || req.method === 'POST')) {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                // Handle legacy jQuery body fragments and parse JSON
                let jsonBody = body;
                if (body && body.includes('}&')) jsonBody = body.substring(0, body.indexOf('}&') + 1);
                const data = JSON.parse(jsonBody);
                const { id } = data;
                
                if (!id) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: 0, info: 'Missing record ID' }));
                    return;
                }

                const withdrawalRecordsPath = path.join(__dirname, 'withdrawals_records.json');
                let withdrawalRecords = [];
                
                if (fs.existsSync(withdrawalRecordsPath)) {
                    withdrawalRecords = JSON.parse(fs.readFileSync(withdrawalRecordsPath));
                }

                const recordIndex = withdrawalRecords.findIndex(r => r.id === id);
                if (recordIndex === -1) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: 0, info: 'Record not found' }));
                    return;
                }

                const record = withdrawalRecords[recordIndex];
                
                // Only complete if pending
                if (record.status !== 'pending') {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: 0, info: 'Record is not pending' }));
                    return;
                }

                // Update the record - use 'complete' to match topup wording
                record.status = 'complete';
                record.updated_at = new Date().toISOString();
                withdrawalRecords[recordIndex] = record;

                // Save to JSON file
                fs.writeFileSync(withdrawalRecordsPath, JSON.stringify(withdrawalRecords, null, 2));

                // For withdrawals, we DEDUCT from user balance
                try {
                    const usersPath = path.join(__dirname, 'users.json');
                    let users = [];
                    if (fs.existsSync(usersPath)) {
                        users = JSON.parse(fs.readFileSync(usersPath));
                    }

                    const userIndex = users.findIndex(u => u.userid === record.user_id || u.uid === record.user_id);
                    if (userIndex !== -1) {
                        const user = users[userIndex];
                        const coin = (record.coin || 'btc').toLowerCase();
                        const quantity = parseFloat(record.quantity) || 0;

                        // Initialize balances object if it doesn't exist
                        if (!user.balances) {
                            user.balances = {};
                        }

                        // Subtract from user's coin balance
                        user.balances[coin] = Math.max(0, (user.balances[coin] || 0) - quantity);

                        console.log(`[ADMIN] Updated user ${record.user_id} balance for withdrawal: -${quantity} ${coin} = ${user.balances[coin]}`);

                        // Save updated users
                        fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));
                        // Notify user about withdrawal completion
                        try {
                            addNotification({ userid: record.user_id, biaoti: 'Withdrawal Completed', neirong: `Your withdrawal of ${record.quantity} ${record.coin || ''} has been completed.`, sfyidu: 0 });
                        } catch (e) { /* best-effort only */ }
                    } else {
                        console.warn(`[ADMIN] User not found for withdrawal completion: ${record.user_id}`);
                        try { addNotification({ userid: record.user_id, biaoti: 'Withdrawal Completed', neirong: `Your withdrawal record ${record.id} has been marked completed.`, sfyidu: 0 }); } catch(e){}
                    }
                } catch (balanceErr) {
                    console.error('[ADMIN] Failed to update user balance for withdrawal:', balanceErr);
                    // Don't fail the withdrawal completion if balance update fails
                }

                console.log(`[ADMIN] Completed withdrawal record: ${id}`);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    code: 1,
                    info: 'Record completed successfully and balance updated',
                    data: record
                }));
            } catch (err) {
                console.error('[ADMIN] Completion error:', err);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: 0, info: 'Server error: ' + err.message }));
            }
        });
        return;
    }

    // Admin Withdrawal Rejection - PUT or POST /api/admin/withdrawal/reject
    if (pathname === '/api/admin/withdrawal/reject' && (req.method === 'PUT' || req.method === 'POST')) {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                // Handle legacy jQuery body fragments and parse JSON
                let jsonBody = body;
                if (body && body.includes('}&')) jsonBody = body.substring(0, body.indexOf('}&') + 1);
                const data = JSON.parse(jsonBody);
                const { id, reason } = data;
                
                if (!id) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: 0, info: 'Missing record ID' }));
                    return;
                }

                const withdrawalRecordsPath = path.join(__dirname, 'withdrawals_records.json');
                let withdrawalRecords = [];
                
                if (fs.existsSync(withdrawalRecordsPath)) {
                    withdrawalRecords = JSON.parse(fs.readFileSync(withdrawalRecordsPath));
                }

                const recordIndex = withdrawalRecords.findIndex(r => r.id === id);
                if (recordIndex === -1) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: 0, info: 'Record not found' }));
                    return;
                }

                const record = withdrawalRecords[recordIndex];
                
                // Only reject if pending
                if (record.status !== 'pending') {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: 0, info: 'Record is not pending' }));
                    return;
                }

                // Update the record
                record.status = 'rejected';
                record.rejection_reason = reason || 'No reason provided';
                record.updated_at = new Date().toISOString();
                withdrawalRecords[recordIndex] = record;

                // Save to JSON file
                fs.writeFileSync(withdrawalRecordsPath, JSON.stringify(withdrawalRecords, null, 2));
                // Notify user about withdrawal rejection
                try {
                    const rec = withdrawalRecords[recordIndex];
                    addNotification({ userid: rec.user_id, biaoti: 'Withdrawal Rejected', neirong: `Your withdrawal request ${rec.id} was rejected.`, sfyidu: 0 });
                } catch (e) { /* best-effort only */ }

                console.log(`[ADMIN] Rejected withdrawal record: ${id}`);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    code: 1,
                    info: 'Record rejected successfully',
                    data: record
                }));
            } catch (err) {
                console.error('[ADMIN] Rejection error:', err);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: 0, info: 'Server error: ' + err.message }));
            }
        });
        return;
    }

    // Add withdrawal record for user (admin)
    if (pathname === '/api/admin/add-withdrawal' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                let jsonBody = body;
                if (body.includes('}&')) {
                    jsonBody = body.substring(0, body.indexOf('}&') + 1);
                }

                const data = JSON.parse(jsonBody);
                const { user_id, coin, address, quantity } = data;

                if (!user_id || !coin || !address || !quantity) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Missing required fields' }));
                    return;
                }

                const record = addWithdrawalRecord(user_id, coin, address, quantity);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, record }));
            } catch (e) {
                console.error('[admin-add-withdrawal] Error:', e.message);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: e.message }));
            }
        });
        return;
    }

    // Delete transaction (admin)
    if (pathname === '/api/admin/delete-transaction' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                let jsonBody = body;
                if (body.includes('}&')) {
                    jsonBody = body.substring(0, body.indexOf('}&') + 1);
                }

                const data = JSON.parse(jsonBody);
                const { transaction_type, transaction_id } = data;

                if (!transaction_type || !transaction_id) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Missing required fields' }));
                    return;
                }

                const success = deleteTransaction(transaction_type, transaction_id);

                if (!success) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Transaction not found' }));
                    return;
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: 'Transaction deleted' }));
            } catch (e) {
                console.error('[admin-delete] Error:', e.message);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: e.message }));
            }
        });
        return;
    }

    // ARBITRAGE API ENDPOINTS

    // Get all arbitrage products
    if (pathname === '/api/arbitrage/products' && req.method === 'GET') {
        const products = getAllArbitrageProducts();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, products }));
        return;
    }

    // Get arbitrage product by ID
    if (pathname.match(/^\/api\/arbitrage\/product\/[\w-]+$/)) {
        const productId = pathname.split('/').pop();
        const product = getArbitrageProductById(productId);

        if (!product) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Product not found' }));
            return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, product }));
        return;
    }

    // Create arbitrage subscription
    if (pathname === '/api/arbitrage/subscribe' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                let jsonBody = body;
                if (body.includes('}&')) {
                    jsonBody = body.substring(0, body.indexOf('}&') + 1);
                }

                const data = JSON.parse(jsonBody);
                const { user_id, product_id, amount } = data;

                if (!user_id || !product_id || !amount) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Missing required fields' }));
                    return;
                }

                const subscription = createArbitrageSubscription(user_id, product_id, amount);

                res.writeHead(201, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, subscription }));
            } catch (e) {
                console.error('[arbitrage-subscribe] Error:', e.message);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: e.message }));
            }
        });
        return;
    }

    // Get user arbitrage subscriptions
    if (pathname === '/api/arbitrage/subscriptions' && req.method === 'GET') {
        const queryParams = parsedUrl.query || {};
        const userId = queryParams.user_id || queryParams.userId;

        if (!userId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing user_id parameter' }));
            return;
        }

        const subscriptions = getUserArbitrageSubscriptions(userId);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, subscriptions }));
        return;
    }

    // Get user arbitrage statistics
    if (pathname === '/api/arbitrage/stats' && req.method === 'GET') {
        const queryParams = parsedUrl.query || {};
        const userId = queryParams.user_id || queryParams.userId;

        if (!userId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing user_id parameter' }));
            return;
        }

        const stats = getUserArbitrageStats(userId);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, stats }));
        return;
    }

    // TRADE API ENDPOINTS

    // Trade/Buy endpoint - create a new trade order
    if (pathname === '/api/trade/buy' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                console.log('[trade-buy] Content-Type header:', req.headers['content-type']);
                console.log('[trade-buy] Raw body snippet:', body && body.substring(0, 200));
                const data = parseBodyString(body);
                console.log('[trade-buy] Parsed body object:', data);
                const { userid, username, fangxiang, miaoshu, biming, num, buyprice, syl, zengjia, jianshao } = data;

                if (!userid || !username || !biming || !num || !buyprice) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: 0, data: 'Missing required fields' }));
                    return;
                }

                // Create trade record
                const tradeRecord = {
                    id: Date.now().toString(),
                    userid,
                    username,
                    biming,
                    fangxiang: fangxiang == 1 ? 'upward' : 'downward',
                    miaoshu,
                    num,
                    buyprice,
                    syl: parseFloat(syl) || 40,
                    zengjia,
                    jianshao,
                    status: 'pending',
                    // optional forced outcome (set if user's account is flagged by admin)
                    forcedOutcome: null,
                    settlement_applied: false,
                    created_at: new Date().toISOString()
                };

                // Save to trades records file
                const tradesFilePath = path.join(__dirname, 'trades_records.json');
                let tradesData = [];
                if (fs.existsSync(tradesFilePath)) {
                    const fileContent = fs.readFileSync(tradesFilePath, 'utf-8');
                    try {
                        tradesData = JSON.parse(fileContent);
                    } catch (e) {
                        tradesData = [];
                    }
                }

                // Before persisting, attempt to deduct stake from user's balance
                const usersFile = path.join(__dirname, 'users.json');
                let users = [];
                if (fs.existsSync(usersFile)) {
                    try { users = JSON.parse(fs.readFileSync(usersFile, 'utf8')); } catch (e) { users = []; }
                }

                let userIndex = users.findIndex(u => String(u.userid) === String(userid) || String(u.uid) === String(userid));
                if (userIndex === -1) {
                    // No local user record - attempt to proceed but warn (fallback)
                    console.error('[trade-buy] ⚠ User not found in users.json:', userid);
                    // Try additional lookups: if the incoming userid looks like a wallet address
                    const maybeAddress = String(userid || '').toLowerCase();
                    if (maybeAddress.startsWith('0x')) {
                        const foundByAddr = users.findIndex(u => (u.wallet_address || '').toLowerCase() === maybeAddress);
                        if (foundByAddr !== -1) {
                            userIndex = foundByAddr; // eslint-disable-line no-param-reassign
                        }
                    }
                    // If still not found, consult flag_sync.json for any admin-set flags for this id
                    if (userIndex === -1) {
                        const flagSync = readJsonFileSafe(FLAG_SYNC_FILE) || {};
                        const flags = flagSync[String(userid)] || flagSync[String(userid).toLowerCase()];
                        if (flags && (flags.force_trade_win === true || flags.force_trade_win === 'true')) {
                            // we'll set forcedOutcome below using a placeholder user object
                            console.error('[trade-buy] ⚠ Found force_trade_win in flag_sync for', userid);
                            // create a temporary user object for flag check
                            users.push({ userid: userid, force_trade_win: flags.force_trade_win });
                            userIndex = users.length - 1;
                        }
                    }
                } else {
                    const user = users[userIndex];
                    // Determine available USDT balance from common fields
                    let currentBalance = 0;
                    // legacy single balance
                    if (typeof user.balance !== 'undefined' && user.balance !== null) {
                        currentBalance = parseFloat(user.balance) || 0;
                    }
                    // modern balances object (prefer balances.usdt)
                    if (user.balances && (typeof user.balances.usdt !== 'undefined')) {
                        // prefer balances.usdt as the true USDT wallet
                        currentBalance = parseFloat(user.balances.usdt) || currentBalance;
                    } else if (user.balances) {
                        // fallback: maybe USDT stored under lowercase keys or other coin name
                        const kb = Object.keys(user.balances || {});
                        const usdtKey = kb.find(k => k.toLowerCase() === 'usdt');
                        if (usdtKey) currentBalance = parseFloat(user.balances[usdtKey]) || currentBalance;
                    }

                    const stake = parseFloat(num) || 0;
                    if (currentBalance < stake) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ code: 0, data: 'Insufficient balance' }));
                        return;
                    }

                    // DO NOT deduct stake at trade creation
                    // Balance will only be adjusted at settlement:
                    // - On LOSS: stake will be deducted
                    // - On WIN: profit will be added (not the full payout)
                    
                    user.total_invested = Number((parseFloat(user.total_invested || 0) + stake).toFixed(2));
                    users[userIndex] = user;
                    try { fs.writeFileSync(usersFile, JSON.stringify(users, null, 2)); } catch (e) { console.error('[trade-buy] Error writing users.json:', e.message); }
                }

                // If user account is flagged to always win, mark forcedOutcome on the trade
                if (userIndex !== -1) {
                    const user = users[userIndex];
                    if (user.force_trade_win === true || user.force_trade_win === 'true') {
                        tradeRecord.forcedOutcome = 'win';
                    }
                }

                tradesData.push(tradeRecord);
                fs.writeFileSync(tradesFilePath, JSON.stringify(tradesData, null, 2));

                console.error('[trade-buy] ✓ Trade record saved:', tradeRecord.id);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: 1, data: tradeRecord.id }));
            } catch (e) {
                console.error('[trade-buy] ✗ Error:', e.message);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: 0, data: e.message }));
            }
        });
        return;
    }

    // Get trade list - proxy to external API
    if (pathname === '/api/Trade/gettradlist' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                // Forward request to external API (use canonical external 'gettradelist')
                const externalApiUrl = 'https://api.bvoxf.com/api/Trade/gettradelist';
                console.log('[gettradlist] Incoming body:', body);
                const https = require('https');
                const externalReq = https.request(externalApiUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Content-Length': Buffer.byteLength(body)
                    }
                }, (externalRes) => {
                    let responseData = '';
                    externalRes.on('data', chunk => { responseData += chunk; });
                    externalRes.on('end', () => {
                        console.log('[gettradlist] External response status:', externalRes.statusCode, 'length:', responseData.length);
                        res.writeHead(externalRes.statusCode, { 'Content-Type': 'application/json' });
                        res.end(responseData);
                    });
                });

                externalReq.on('error', (err) => {
                    console.error('[gettradlist] External API error:', err.message);
                    res.writeHead(503, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: 0, data: 'External API unavailable' }));
                });

                externalReq.write(body);
                externalReq.end();
            } catch (e) {
                console.error('[gettradlist] Error:', e.message);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: 0, data: e.message }));
            }
        });
        return;
    }

    // Alias old/traditional endpoint name that includes an 'e' -> /api/Trade/gettradelist
    if (pathname === '/api/Trade/gettradelist' && req.method === 'POST') {
        // Proxy behaviour is identical to /api/Trade/gettradlist
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
                try {
                const externalApiUrl = 'https://api.bvoxf.com/api/Trade/gettradelist';
                console.log('[gettradelist alias] Incoming body:', body);
                const https = require('https');
                const externalReq = https.request(externalApiUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Content-Length': Buffer.byteLength(body)
                    }
                }, (externalRes) => {
                    let responseData = '';
                    externalRes.on('data', chunk => { responseData += chunk; });
                    externalRes.on('end', () => {
                        console.log('[gettradelist alias] External response status:', externalRes.statusCode, 'length:', responseData.length);
                        res.writeHead(externalRes.statusCode, { 'Content-Type': 'application/json' });
                        res.end(responseData);
                    });
                });

                externalReq.on('error', (err) => {
                    console.error('[gettradelist alias] External API error:', err.message);
                    res.writeHead(503, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: 0, data: 'External API unavailable' }));
                });

                externalReq.write(body);
                externalReq.end();
            } catch (e) {
                console.error('[gettradelist alias] Error:', e.message);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: 0, data: e.message }));
            }
        });
        return;
    }

    // Get coin data - proxy to external API
    if (pathname === '/api/Trade/getcoin_data' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                // Forward request to external API
                const externalApiUrl = 'https://api.bvoxf.com/api/Trade/getcoin_data';
                console.log('[getcoin_data] Incoming body:', body);
                const https = require('https');
                const externalReq = https.request(externalApiUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Content-Length': Buffer.byteLength(body)
                    }
                }, (externalRes) => {
                    let responseData = '';
                    externalRes.on('data', chunk => { responseData += chunk; });
                    externalRes.on('end', () => {
                        console.log('[getcoin_data] External response status:', externalRes.statusCode, 'length:', responseData.length);
                        res.writeHead(externalRes.statusCode, { 'Content-Type': 'application/json' });
                        res.end(responseData);
                    });
                });

                externalReq.on('error', (err) => {
                    console.error('[getcoin_data] External API error:', err.message);
                    res.writeHead(503, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: 0, data: 'External API unavailable' }));
                });

                externalReq.write(body);
                externalReq.end();
            } catch (e) {
                console.error('[getcoin_data] Error:', e.message);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: 0, data: e.message }));
            }
        });
        return;
    }

    // Get all coin data used by frontend (Wallet/getcoin_all_data)
    if ((pathname === '/api/Wallet/getcoin_all_data' || pathname === '/api/wallet/getcoin_all_data') && (req.method === 'POST' || req.method === 'GET')) {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                // Use the new external endpoint for coin price data
                const externalApiUrls = [
                    'https://api.bitcryptoforest.com/api/kline/getAllProduct'
                ];

                const https = require('https');

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
                    // Only log errors and fallbacks, not routine proxy requests
                    const externalReq = https.request(externalApiUrl, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded',
                            'Content-Length': Buffer.byteLength(body)
                        }
                    }, (externalRes) => {
                        let responseData = '';
                        externalRes.on('data', chunk => { responseData += chunk; });
                        externalRes.on('end', () => {
                            // Log external response status and a truncated body for diagnostics


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

                    externalReq.write(body);
                    externalReq.end();
                };

                tryProxy(0);
            } catch (e) {
                console.error('[getcoin_all_data] Error:', e.message);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: 0, data: e.message }));
            }
        });
        return;
    }

    // Get order status
    if (pathname === '/api/trade/getorder' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const data = parseBodyString(body);
                const orderId = data.id;

                // Get trade record from file
                const tradesFilePath = path.join(__dirname, 'trades_records.json');
                let orderStatus = 0; // Default: unspecified
                
                if (fs.existsSync(tradesFilePath)) {
                    const fileContent = fs.readFileSync(tradesFilePath, 'utf-8');
                    const tradesData = JSON.parse(fileContent);
                    const trade = tradesData.find(t => t.id === orderId);
                    
                    // PRIORITY 1: If admin/flagged forced outcome present on trade, respect it FIRST (client will call setordersy)
                    if (trade && trade.forcedOutcome) {
                        if (String(trade.forcedOutcome) === 'win') {
                            orderStatus = 1;
                            console.error('[getorder] ✓ Forced WIN for trade', orderId);
                        }
                        else if (String(trade.forcedOutcome) === 'loss') {
                            orderStatus = 2;
                            console.error('[getorder] ✓ Forced LOSS for trade', orderId);
                        }
                    }
                    // PRIORITY 2: If trade exists and already settled, map status
                    else if (trade && trade.status) {
                        if (trade.status === 'win') orderStatus = 1;
                        else if (trade.status === 'loss') orderStatus = 2;
                    }

                    // If still unspecified, but expiry time passed, attempt server-side settlement
                    if (trade && (!trade.status || trade.status === 'pending')) {
                        try {
                            const createdTs = new Date(trade.created_at).getTime();
                            const elapsedSec = Math.floor((Date.now() - createdTs) / 1000);
                            const duration = Number(trade.miaoshu) || 0;
                            if (duration > 0 && elapsedSec >= duration) {
                                // Time expired, attempt to fetch final price and settle SYNCHRONOUSLY
                                const coin = (trade.biming || '').toString().toUpperCase();
                                const symbol = coin ? (coin + 'USDT') : null;
                                if (symbol) {
                                    try {
                                        const https = require('https');
                                        const http = require('http');
                                        let settleResult = null;
                                        let settled = false;
                                        
                                        // Use synchronous-style https.get with timeout
                                        const url = `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`;
                                        
                                        // Create a wrapper to handle the async call more reliably
                                        const settleTradeFromBinance = (callback) => {
                                            const timeoutHandle = setTimeout(() => {
                                                callback(null); // timeout - just return null
                                            }, 2000); // 2 second timeout
                                            
                                            https.get(url, (binRes) => {
                                                clearTimeout(timeoutHandle);
                                                let buf = '';
                                                binRes.on('data', c => buf += c);
                                                binRes.on('end', () => {
                                                    try {
                                                        const parsed = JSON.parse(buf);
                                                        callback(parsed);
                                                    } catch (e) {
                                                        callback(null);
                                                    }
                                                });
                                            }).on('error', () => {
                                                clearTimeout(timeoutHandle);
                                                callback(null);
                                            });
                                        };
                                        
                                        // For now, return 0 and let getorderjs (the profit endpoint) handle the settlement
                                        // This maintains backward compatibility while getorderjs handles real settlement
                                        console.log('[getorder] Trade expired, returning status 0 for client-side settlement check');
                                    } catch (e) {
                                        console.error('[getorder] Settlement error:', e.message);
                                    }
                                }
                            }
                        } catch (e) {}
                    }
                }

                console.log('[getorder] Returning status=' + orderStatus + ' for orderId=' + orderId);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: 1, data: orderStatus }));
            } catch (e) {
                console.error('[getorder] Error:', e.message);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: 0, data: e.message }));
            }
        });
        return;
    }

    // Set order result (win/loss)
    if (pathname === '/api/trade/setordersy' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const data = parseBodyString(body);
                const orderId = data.id;
                const shuying = data.shuying; // 1 = win, 2 = loss

                // Update trade record
                const tradesFilePath = path.join(__dirname, 'trades_records.json');
                if (fs.existsSync(tradesFilePath)) {
                    const fileContent = fs.readFileSync(tradesFilePath, 'utf-8');
                    let tradesData = JSON.parse(fileContent);
                    
                    const trade = tradesData.find(t => t.id === orderId);
                    if (trade) {
                        // If trade has forcedOutcome, use that instead of shuying from client
                        let finalStatus = shuying === 1 ? 'win' : 'loss';
                        if (trade.forcedOutcome) {
                            finalStatus = String(trade.forcedOutcome) === 'win' ? 'win' : 'loss';
                            console.error('[setordersy] ⚠ Overriding client result with forcedOutcome:', finalStatus, 'for trade', orderId);
                        }

                        // prevent double-application
                        // If already applied, just update status/time if forcedOutcome changed
                        if (trade.settlement_applied) {
                            trade.status = finalStatus;
                            trade.updated_at = new Date().toISOString();
                            fs.writeFileSync(tradesFilePath, JSON.stringify(tradesData, null, 2));
                        } else {
                            trade.status = finalStatus;
                            trade.updated_at = new Date().toISOString();

                            // Apply balance changes to user record
                            try {
                                const usersFile = path.join(__dirname, 'users.json');
                                let users = [];
                                if (fs.existsSync(usersFile)) {
                                    try { users = JSON.parse(fs.readFileSync(usersFile, 'utf8')); } catch (e) { users = []; }
                                }

                                const uid = String(trade.userid);
                                const uidx = users.findIndex(u => String(u.userid) === uid || String(u.uid) === uid);
                                if (uidx !== -1) {
                                    const user = users[uidx];
                                    const invested = parseFloat(trade.num) || 0;
                                    const profitRatio = parseFloat(trade.syl) || 40; // Use stored profit ratio from trade
                                    let settlementMessage = '';

                                    // Helper to apply a delta (positive or negative) to the user's USDT balance
                                    function applyUsdtDelta(u, delta) {
                                        // Prefer structured balances.usdt
                                        if (u.balances && typeof u.balances.usdt !== 'undefined') {
                                            u.balances.usdt = Number(((parseFloat(u.balances.usdt) || 0) + delta).toFixed(2));
                                            return;
                                        }
                                        // Fallback: case-insensitive key search
                                        if (u.balances) {
                                            const kb = Object.keys(u.balances || {});
                                            const usdtKey = kb.find(k => k.toLowerCase() === 'usdt');
                                            if (usdtKey) {
                                                u.balances[usdtKey] = Number(((parseFloat(u.balances[usdtKey]) || 0) + delta).toFixed(2));
                                                return;
                                            }
                                        }
                                        // Last fallback: legacy `balance` field
                                        u.balance = Number(((parseFloat(u.balance) || 0) + delta).toFixed(2));
                                    }

                                    if (finalStatus === 'win') {
                                        // On WIN: Add only the profit amount (not the full payout)
                                        const profit = Number((invested * (profitRatio / 100)).toFixed(2));
                                        applyUsdtDelta(user, profit);
                                        user.total_income = Number(((parseFloat(user.total_income) || 0) + profit).toFixed(2));
                                        console.error('[setordersy] ✓ WIN settlement applied: +' + profit + ' profit for user', uid);
                                        settlementMessage = `Your trade ${trade.id} settled as WIN. You received ${profit} profit.`;
                                    } else {
                                        // On LOSS: Deduct the full stake/invested amount
                                        applyUsdtDelta(user, -invested);
                                        console.error('[setordersy] ✓ LOSS settlement applied: -' + invested + ' stake deducted for user', uid);
                                        settlementMessage = `Your trade ${trade.id} settled as LOSS. Stake of ${invested} has been deducted.`;
                                    }

                                    users[uidx] = user;
                                    try { fs.writeFileSync(usersFile, JSON.stringify(users, null, 2)); } catch (e) { console.error('[setordersy] Error writing users.json:', e.message); }
                                } else {
                                    console.error('[setordersy] User not found for settlement:', trade.userid);
                                }
                            } catch (e) {
                                console.error('[setordersy] Error applying settlement to user balance:', e.message);
                            }

                            // mark settlement applied so it isn't reapplied
                            trade.settlement_applied = true;
                            fs.writeFileSync(tradesFilePath, JSON.stringify(tradesData, null, 2));
                            // Notify the user about trade settlement
                            try {
                                if (trade && trade.userid) {
                                    const msg = settlementMessage || (`Your trade ${trade.id} has been settled: ${trade.status}`);
                                    addNotification({ userid: trade.userid, biaoti: 'Trade Settled', neirong: msg, sfyidu: 0 });
                                }
                            } catch (e) { /* best-effort only */ }
                        }
                    }
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: 1, data: 'Order updated' }));
            } catch (e) {
                console.error('[setordersy] Error:', e.message);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: 0, data: e.message }));
            }
        });
        return;
    }

    // Get order result/profit
    if (pathname === '/api/trade/getorderjs' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const data = parseBodyString(body);
                const orderId = data.id;

                // Get trade record from file
                const tradesFilePath = path.join(__dirname, 'trades_records.json');
                let profit = 'wjs'; // 'wjs' = waiting, default
                
                if (fs.existsSync(tradesFilePath)) {
                    const fileContent = fs.readFileSync(tradesFilePath, 'utf-8');
                    const tradesData = JSON.parse(fileContent);
                    const trade = tradesData.find(t => t.id === orderId);
                    
                    if (trade && trade.status && trade.status !== 'pending') {
                        if (trade.status === 'win') {
                            // Calculate profit using stored profit ratio from trade
                            const investedAmount = parseFloat(trade.num) || 0;
                            const profitPercent = parseFloat(trade.syl) || 40; // Use stored profit ratio from trade
                            profit = (investedAmount * (profitPercent / 100)).toFixed(2);
                        } else if (trade.status === 'loss') {
                            profit = '-' + parseFloat(trade.num).toFixed(2);
                        }
                    } else if (trade && (!trade.status || trade.status === 'pending')) {
                        // If still pending, attempt server-side settlement using Binance price
                        try {
                            const createdTs = new Date(trade.created_at).getTime();
                            const elapsedSec = Math.floor((Date.now() - createdTs) / 1000);
                            const duration = Number(trade.miaoshu) || 0;
                            if (duration > 0 && elapsedSec >= duration) {
                                // Time expired, fetch final price and settle
                                const coin = (trade.biming || '').toString().toUpperCase();
                                const symbol = coin ? (coin + 'USDT') : null;
                                if (symbol) {
                                    const https = require('https');
                                    const binUrl = `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`;
                                    const binReq = https.get(binUrl, binRes => {
                                        let buf = '';
                                        binRes.on('data', c => buf += c);
                                        binRes.on('end', () => {
                                            try {
                                                const parsed = JSON.parse(buf);
                                                const finalPrice = Number(parsed.price || parsed.P || parsed.p || 0);
                                                const buyprice = Number(trade.buyprice) || 0;
                                                if (Number.isFinite(finalPrice) && finalPrice > 0) {
                                                    // Determine win/loss based on direction and price
                                                    if ((trade.fangxiang === 'upward' && finalPrice > buyprice) || 
                                                        (trade.fangxiang === '1' && finalPrice > buyprice)) {
                                                        trade.status = 'win';
                                                    } else if ((trade.fangxiang === 'downward' && finalPrice < buyprice) || 
                                                               (trade.fangxiang === '2' && finalPrice < buyprice)) {
                                                        trade.status = 'win';
                                                    } else {
                                                        trade.status = 'loss';
                                                    }
                                                    trade.settled_price = finalPrice;
                                                    trade.updated_at = new Date().toISOString();

                                                    // Apply settlement to user's balance immediately (so server-side settlement matches setordersy)
                                                    try {
                                                        const usersFile = path.join(__dirname, 'users.json');
                                                        let users = [];
                                                        if (fs.existsSync(usersFile)) {
                                                            try { users = JSON.parse(fs.readFileSync(usersFile, 'utf8')) || []; } catch (e) { users = []; }
                                                        }

                                                        const uid = String(trade.userid);
                                                        const uidx = users.findIndex(u => String(u.userid) === uid || String(u.uid) === uid);
                                                        if (uidx !== -1 && !trade.settlement_applied) {
                                                            const user = users[uidx];
                                                            const investedAmount = parseFloat(trade.num) || 0;
                                                            const profitRatio = parseFloat(trade.syl) || 40;

                                                            function applyUsdtDelta(u, delta) {
                                                                if (u.balances && typeof u.balances.usdt !== 'undefined') {
                                                                    u.balances.usdt = Number(((parseFloat(u.balances.usdt) || 0) + delta).toFixed(2));
                                                                    return;
                                                                }
                                                                if (u.balances) {
                                                                    const kb = Object.keys(u.balances || {});
                                                                    const usdtKey = kb.find(k => k.toLowerCase() === 'usdt');
                                                                    if (usdtKey) {
                                                                        u.balances[usdtKey] = Number(((parseFloat(u.balances[usdtKey]) || 0) + delta).toFixed(2));
                                                                        return;
                                                                    }
                                                                }
                                                                u.balance = Number(((parseFloat(u.balance) || 0) + delta).toFixed(2));
                                                            }

                                                            if (trade.status === 'win') {
                                                                const profit = Number((investedAmount * (profitRatio / 100)).toFixed(2));
                                                                applyUsdtDelta(user, profit);
                                                                user.total_income = Number(((parseFloat(user.total_income) || 0) + profit).toFixed(2));
                                                            } else {
                                                                applyUsdtDelta(user, -investedAmount);
                                                            }

                                                            users[uidx] = user;
                                                            try { fs.writeFileSync(usersFile, JSON.stringify(users, null, 2)); } catch (e) { console.error('[getorderjs] Error writing users.json:', e.message); }
                                                            // mark settlement applied so it isn't reapplied later
                                                            trade.settlement_applied = true;
                                                        }
                                                    } catch (e) {
                                                        console.error('[getorderjs] Error applying settlement to user balance:', e && e.message ? e.message : e);
                                                    }

                                                    // Persist settled trade
                                                    fs.writeFileSync(tradesFilePath, JSON.stringify(tradesData, null, 2));
                                                    // Calculate profit for response
                                                    if (trade.status === 'win') {
                                                        const profitRatio = parseFloat(trade.syl) || 40; // Use stored profit ratio from trade
                                                        const investedAmount = parseFloat(trade.num) || 0;
                                                        profit = (investedAmount * (profitRatio / 100)).toFixed(2);
                                                    } else {
                                                        profit = '-' + parseFloat(trade.num).toFixed(2);
                                                    }
                                                }
                                            } catch (e) {}
                                        });
                                    });
                                    binReq.on('error', () => {});
                                }
                            }
                        } catch (e) {}
                    }
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: 1, data: profit }));
            } catch (e) {
                console.error('[getorderjs] Error:', e.message);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: 0, data: e.message }));
            }
        });
        return;
    }

    // Wallet API endpoints - connect / verify / me
    if (pathname === '/api/wallet/connect' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const data = JSON.parse(body || '{}');
                const address = data.address;
                const chainId = data.chainId || 'ethereum';

                if (!address) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'Missing wallet address' }));
                    return;
                }

                const result = connectWallet(address, chainId);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(result));
            } catch (e) {
                console.error('[wallet-connect] Error:', e.message);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: e.message }));
            }
        });
        return;
    }

    if (pathname.match(/^\/api\/wallet\/verify/) && req.method === 'GET') {
        const queryParams = url.parse(req.url, true).query;
        const address = queryParams.address;
        if (!address) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Missing address parameter' }));
            return;
        }

        const result = verifyWallet(address);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
        return;
    }

    if (pathname.match(/^\/api\/wallet\/me/) && req.method === 'GET') {
        const queryParams = url.parse(req.url, true).query;
        const uid = queryParams.uid;
        if (!uid) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Missing uid parameter' }));
            return;
        }

        const user = getUserByUID(uid);
        const wallet = getWalletByUID(uid);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, user, wallet }));
        return;
    }

    // Handle image upload for top-up proof
    if (pathname === '/api/upload-image' && req.method === 'POST') {
        let chunks = [];
        
        req.on('data', chunk => {
            chunks.push(chunk);
        });
        
        req.on('end', () => {
            try {
                const buffer = Buffer.concat(chunks);
                // Generate a simple filename based on timestamp and random
                const filename = 'proof_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9) + '.png';
                const uploadPath = path.join(__dirname, 'uploads', filename);
                
                // Create uploads directory if it doesn't exist
                const uploadsDir = path.join(__dirname, 'uploads');
                if (!fs.existsSync(uploadsDir)) {
                    fs.mkdirSync(uploadsDir, { recursive: true });
                }
                
                // Save file to disk
                fs.writeFileSync(uploadPath, buffer);
                
                // Return just the filename/path
                const fileUrl = '/uploads/' + filename;
                
                console.error('[upload] Saved file:', filename, 'Size:', buffer.length, 'bytes');
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    code: 1, 
                    data: fileUrl,
                    message: 'Image uploaded successfully'
                }));
            } catch (e) {
                console.error('[upload] Error:', e.message);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: 0, data: e.message }));
            }
        });
        return;
    }

    // Handle uploads directory - serve uploaded files
    if (pathname.startsWith('/uploads/')) {
        const filename = path.basename(pathname);
        const uploadPath = path.join(__dirname, 'uploads', filename);
        
        // Security: ensure the file is in the uploads directory
        if (!uploadPath.startsWith(path.join(__dirname, 'uploads'))) {
            res.writeHead(403, { 'Content-Type': 'text/plain' });
            res.end('Forbidden');
            return;
        }
        
        if (fs.existsSync(uploadPath)) {
            const data = fs.readFileSync(uploadPath);
            res.setHeader('Cache-Control', 'public, max-age=3600');
            res.writeHead(200, { 'Content-Type': 'image/png' });
            res.end(data);
        } else {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('File not found');
        }
        return;
    }

    // Handle Cloudflare RUM (Real User Monitoring) - suppress these requests locally
    if (pathname && pathname.startsWith('/cdn-cgi/')) {
        if (req.method === 'POST') {
            // Silently accept analytics data
            res.writeHead(204);
            res.end();
            return;
        }
    }

    // Admin: set arbitrary user flag (e.g., force_trade_win)
    if (pathname === '/api/admin/set-user-flag' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                // log raw and parsed body for debugging
                console.error('[set-user-flag] Raw body:', typeof body === 'string' ? body.substring(0, 1000) : body);
                let data = parseBodyString(body);
                console.error('[set-user-flag] Parsed body:', JSON.stringify(data).substring(0,1000));

                const user_id = data.user_id || data.userid || data.uid || data.userId || data.uid;
                const flag = data.flag || data.key || data.field;
                let value = data.value;

                // Accept string booleans
                if (typeof value === 'string') {
                    if (value === 'true') value = true;
                    else if (value === 'false') value = false;
                }

                if (!user_id || !flag) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'Missing required fields', received: data }));
                    return;
                }

                const updated = setUserFlag(user_id, flag, value);
                if (!updated) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'User not found' }));
                    return;
                }

                // Persist flag to flag_sync.json for fallback lookup by trade-buy
                try {
                    const flagSync = readJsonFileSafe(FLAG_SYNC_FILE) || {};
                    flagSync[String(user_id)] = flagSync[String(user_id)] || {};
                    flagSync[String(user_id)][flag] = value;
                    writeJsonFileSafe(FLAG_SYNC_FILE, flagSync);
                } catch (e) {
                    console.error('[set-user-flag] flag_sync write failed', e.message);
                }

                // Attempt to notify modern backend (best-effort) if available
                try {
                    const http = require('http');
                    const postData = JSON.stringify({ user_id: user_id, flag: flag, value: value });
                    const opts = {
                        hostname: 'localhost',
                        port: 5000,
                        path: '/admin/set-user-flag',
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
                    };
                    const req2 = http.request(opts, (res2) => {
                        res2.on('data', () => {});
                        res2.on('end', () => {});
                    });
                    req2.on('error', (err) => { /* ignore */ });
                    req2.write(postData);
                    req2.end();
                } catch (e) { /* ignore */ }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, user: updated }));
            } catch (e) {
                console.error('[set-user-flag] Error:', e.message);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: e.message }));
            }
        });
        return;
    }

    // Admin: Fix trades with forcedOutcome that have wrong status
    if (pathname === '/api/admin/fix-forced-trades' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const data = parseBodyString(body || '');
                const user_id = data.user_id || data.userid || data.uid;

                const tradesFilePath = path.join(__dirname, 'trades_records.json');
                const usersFile = path.join(__dirname, 'users.json');
                let tradesData = [];
                let users = [];

                if (fs.existsSync(tradesFilePath)) {
                    tradesData = JSON.parse(fs.readFileSync(tradesFilePath, 'utf-8'));
                }
                if (fs.existsSync(usersFile)) {
                    users = JSON.parse(fs.readFileSync(usersFile, 'utf-8'));
                }

                let fixed = [];
                let errors = [];

                // Filter trades for this user or all if no user_id provided
                let trades = user_id ? tradesData.filter(t => String(t.userid) === String(user_id)) : tradesData;

                for (let trade of trades) {
                    if (trade.forcedOutcome && trade.settlement_applied) {
                        const expectedStatus = String(trade.forcedOutcome) === 'win' ? 'win' : 'loss';
                        if (trade.status !== expectedStatus) {
                            console.error('[fix-forced-trades] Fixing trade', trade.id, 'from', trade.status, 'to', expectedStatus);
                            
                            const oldStatus = trade.status;
                            trade.status = expectedStatus;
                            
                            // If changing from loss to win, need to refund the profit
                            if (oldStatus === 'loss' && expectedStatus === 'win') {
                                const uidx = users.findIndex(u => String(u.userid) === String(trade.userid) || String(u.uid) === String(trade.userid));
                                if (uidx !== -1) {
                                    const user = users[uidx];
                                    const invested = parseFloat(trade.num) || 0;
                                    const profitRatio = parseFloat(trade.syl) || 40; // Use stored profit ratio from trade
                                    const profit = Number((invested * (profitRatio / 100)).toFixed(2));
                                    const payout = Number((invested + profit).toFixed(2));
                                    user.balance = Number(((parseFloat(user.balance) || 0) + payout).toFixed(2));
                                    user.total_income = Number(((parseFloat(user.total_income) || 0) + profit).toFixed(2));
                                    users[uidx] = user;
                                    fixed.push({
                                        trade_id: trade.id,
                                        userid: trade.userid,
                                        fix: 'loss->win',
                                        profit_added: profit
                                    });
                                } else {
                                    errors.push({trade_id: trade.id, error: 'User not found'});
                                }
                            }
                        }
                    }
                }

                // Persist changes
                if (fixed.length > 0) {
                    fs.writeFileSync(tradesFilePath, JSON.stringify(tradesData, null, 2));
                    fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    success: true, 
                    fixed_count: fixed.length,
                    fixed_trades: fixed,
                    errors: errors
                }));
            } catch (e) {
                console.error('[fix-forced-trades] Error:', e.message);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: e.message }));
            }
        });
        return;
    }

    // Lightweight compatibility endpoints for legacy frontend requests
    // POST /api/Wallet/getuserzt - return KYC/status info from users.json
    if (pathname === '/api/Wallet/getuserzt' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const data = parseBodyString(body || '');
                const userId = data.userid || data.user_id || data.uid || data.id;

                // Load users.json
                const usersFile = path.join(__dirname, 'users.json');
                let users = [];
                if (fs.existsSync(usersFile)) {
                    try { users = JSON.parse(fs.readFileSync(usersFile, 'utf8')); } catch (e) { users = []; }
                }

                // If userid looks like an address, match wallet_address
                let user = null;
                if (userId && String(userId).toLowerCase().startsWith('0x')) {
                    user = users.find(u => (u.wallet_address || '').toLowerCase() === String(userId).toLowerCase());
                } else {
                    user = users.find(u => String(u.userid) === String(userId) || String(u.uid) === String(userId));
                }

                if (!user) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: 0, info: 'User not found' }));
                    return;
                }

                const kycMap = { none: 0, basic: 1, advanced: 2 };
                const renzhengzhuangtai = kycMap[user.kycStatus] || 0;
                const xinyongfen = user.creditScore || 0;

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: 1, data: { renzhengzhuangtai, xinyongfen, balance: user.balance || 0, status: user.status || 'active' } }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: 0, info: e.message }));
            }
        });
        return;
    }

    // POST /api/User/getsfxtz - notification/status quick check (legacy)
    if (pathname === '/api/User/getsfxtz' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const data = parseBodyString(body || '');
                const userId = data.userid || data.user_id || data.uid || data.id;

                // Best-effort: if user exists, return data:1 (show dot), else 0
                const usersFile = path.join(__dirname, 'users.json');
                let users = [];
                if (fs.existsSync(usersFile)) {
                    try { users = JSON.parse(fs.readFileSync(usersFile, 'utf8')); } catch (e) { users = []; }
                }

                const userExists = !!users.find(u => String(u.userid) === String(userId) || String(u.uid) === String(userId));
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: 1, data: userExists ? 1 : 0 }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: 0, info: e.message }));
            }
        });
        return;
    }

    // GET /api/user/get_nonce?address=0x...
    if ((pLower === '/api/user/get_nonce' || pLower === '/api/user/get-nonce') && req.method === 'GET') {
        try {
            const queryParams = parsedUrl.query || {};
            const address = (queryParams.address || queryParams.addr || '').toString().toLowerCase();
            if (!address) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: 0, info: 'Missing address parameter' }));
                return;
            }

            // Simple nonce generation: 6-digit random number
            const nonce = Math.floor(100000 + Math.random() * 900000).toString();

            // Persist nonce with expiry (5 minutes)
            const nonces = readJsonFileSafe(NONCES_FILE) || {};
            nonces[address] = { nonce: nonce, expiresAt: Date.now() + 5 * 60 * 1000 };
            writeJsonFileSafe(NONCES_FILE, nonces);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ code: 1, data: nonce }));
        } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ code: 0, info: e.message }));
        }
        return;
    }

    // POST /api/user/getuserid - legacy wallet login: address + signature + msg
    // Be permissive: match trailing slashes or minor path variations
    if ((pLower.startsWith('/api/user/getuserid') || pLower === '/api/user/getuserid2') && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                console.error('[getuserid] Hit handler, pLower=', pLower, 'method=', req.method);
                const data = parseBodyString(body || '');
                console.error('[getuserid] Parsed body preview:', JSON.stringify(data).substring(0,1000));
                // Normalize fields: some clients (jQuery) may send repeated keys resulting in arrays
                let addressRaw = data.address || data.addr || '';
                if (Array.isArray(addressRaw)) {
                    console.error('[getuserid] address was array, taking first element');
                    addressRaw = addressRaw[0];
                }
                const address = String(addressRaw || '').toLowerCase();
                let signatureRaw = data.signature || data.sig || '';
                if (Array.isArray(signatureRaw)) signatureRaw = signatureRaw[0];
                const signature = signatureRaw;
                let msgRaw = data.msg || data.message || data.nonce || '';
                if (Array.isArray(msgRaw)) msgRaw = msgRaw[0];
                const msg = msgRaw;

                if (!address) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: 0, info: 'Missing address' }));
                    return;
                }

                // Verify signature against stored nonce
                const nonces = readJsonFileSafe(NONCES_FILE) || {};
                const entry = nonces[address];
                if (!entry || !entry.nonce) {
                    console.error('[getuserid] No nonce entry for address', address, 'nonces=', Object.keys(readJsonFileSafe(NONCES_FILE) || {}));
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: 0, info: 'Nonce expired or not found' }));
                    return;
                }
                if (Number(entry.expiresAt || 0) < Date.now()) {
                    console.error('[getuserid] Nonce expired for address', address, 'expiresAt=', entry.expiresAt, 'now=', Date.now());
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: 0, info: 'Nonce expired or not found' }));
                    return;
                }

                const expectedMessage = `Login code: ${entry.nonce}`;
                // verify signature using ethers
                let ethers;
                try { ethers = require('ethers'); } catch (e) { ethers = null; }
                if (!ethers) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: 0, info: 'ethers library not available' }));
                    return;
                }

                let recovered;
                try {
                    recovered = ethers.verifyMessage(expectedMessage, signature);
                } catch (e) {
                    console.error('[getuserid] verifyMessage error:', e && e.message ? e.message : e);
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: 0, info: 'Invalid signature' }));
                    return;
                }

                if (!recovered || recovered.toLowerCase() !== address.toLowerCase()) {
                    console.error('[getuserid] Recovered address mismatch:', recovered, 'expected=', address);
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: 0, info: 'Signature does not match address' }));
                    return;
                }

                // Remove nonce (single-use)
                delete nonces[address];
                writeJsonFileSafe(NONCES_FILE, nonces);

                // Load users.json
                const usersFile = path.join(__dirname, 'users.json');
                let users = [];
                if (fs.existsSync(usersFile)) {
                    try { users = JSON.parse(fs.readFileSync(usersFile, 'utf8')); } catch (e) { users = []; }
                }

                // Find existing user by wallet_address
                let user = users.find(u => (u.wallet_address || '').toLowerCase() === address);

                // If not found, create a new legacy numeric userid (increment from max)
                if (!user) {
                    const maxId = users.reduce((max, u) => {
                        const id = parseInt(u.userid || u.uid || '0', 10) || 0;
                        return Math.max(max, id);
                    }, 342015);
                    const nextId = String(maxId + 1);
                    user = {
                        userid: nextId,
                        uid: nextId,
                        wallet_address: address,
                        username: `user_${nextId}`,
                        email: null,
                        balance: 0,
                        total_invested: 0,
                        total_income: 0,
                        balances: { usdt: 0, btc: 0, eth: 0, usdc: 0, pyusd: 0, sol: 0 },
                        created_at: new Date().toISOString(),
                        last_login: new Date().toISOString(),
                        status: 'active',
                        kycStatus: 'none'
                    };
                    users.push(user);
                    try { fs.writeFileSync(usersFile, JSON.stringify(users, null, 2)); } catch (e) { console.error('[getuserid] write users.json error', e.message); }
                } else {
                    // update last_login
                    user.last_login = new Date().toISOString();
                    try { fs.writeFileSync(usersFile, JSON.stringify(users, null, 2)); } catch (e) { /* ignore */ }
                }

                // Generate token and sid and persist session
                const token = require('crypto').randomBytes(16).toString('hex');
                const sid = require('crypto').randomBytes(8).toString('hex');
                const sessions = readJsonFileSafe(SESSIONS_FILE) || {};
                sessions[token] = { userid: user.userid, address: address, sid: sid, createdAt: Date.now(), expiresAt: Date.now() + 30 * 24 * 3600 * 1000 };
                writeJsonFileSafe(SESSIONS_FILE, sessions);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: 1, data: { userid: user.userid, token: token, sid: sid } }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: 0, info: e.message }));
            }
        });
        return;
    }

    // Default to index.html for root
    if (pathname === '/') {
        pathname = '/index.html';
    }

    // Handle requests for /js/ files - redirect to /Bvox_files/
    if (pathname.startsWith('/js/')) {
        const filename = pathname.split('/').pop();
        const alternatives = [
            path.join(__dirname, 'Bvox_files', filename + '.download'),
            path.join(__dirname, 'Bvox_files', filename),
            path.join(__dirname, 'js', filename),
            path.join(__dirname, filename)
        ];

        // Try to find the file from alternatives
        for (const alt of alternatives) {
            if (fs.existsSync(alt)) {
                pathname = alt.replace(__dirname, '');
                break;
            }
        }
    }

    // Build file path
    let filePath = path.join(__dirname, pathname);

    // Resolve potential directory traversal attacks
    filePath = path.normalize(filePath);
    if (!filePath.startsWith(__dirname)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden: Path traversal detected');
        return;
    }

    // Check if file exists
    fs.stat(filePath, (err, stats) => {
        if (err) {
            if (err.code === 'ENOENT') {
                // Attempt alternate lookups before returning 404:
                // 1) If request is /img/..., look for that file inside any "*_files" directory
                // 2) If request is top-level like /kline.html, try to find that file inside any "*_files" directory
                try {
                    const tryFindInFilesDirs = () => {
                        const baseName = path.basename(pathname);
                        const relImgPath = pathname.replace(/^\/img\//, '');
                        const entries = fs.readdirSync(__dirname, { withFileTypes: true });
                        for (const e of entries) {
                            if (e.isDirectory() && e.name.endsWith('_files')) {
                                // 1) If the request was /img/..., try the relative path inside this _files dir
                                const candidate1 = path.join(__dirname, e.name, relImgPath);
                                if (fs.existsSync(candidate1)) return candidate1;

                                // 2) Try the basename inside the _files dir (e.g., /kline.html -> contract_files/kline.html)
                                const candidate2 = path.join(__dirname, e.name, baseName);
                                if (fs.existsSync(candidate2)) return candidate2;
                            }
                        }
                        // Also try a central 'img' folder if it exists
                        const centralImg = path.join(__dirname, 'img', pathname.replace(/^\/img\//, ''));
                        if (fs.existsSync(centralImg)) return centralImg;
                        return null;
                    };

                    const alt = tryFindInFilesDirs();
                    // KYC Stage 1: user identity submission - /User/setuserrz1
                    if (pathname === '/User/setuserrz1' && req.method === 'POST') {
                        let body = '';
                        req.on('data', chunk => { body += chunk; });
                        req.on('end', () => {
                                try {
                                    let data;
                                    try {
                                        let jsonBody = body;
                                        if (body && body.includes('}&')) jsonBody = body.substring(0, body.indexOf('}&') + 1);
                                        data = JSON.parse(jsonBody || '{}');
                                    } catch (parseErr) {
                                        // Fallback for form-encoded bodies
                                        data = {};
                                        const params = new URLSearchParams(body);
                                        for (const [k, v] of params.entries()) data[k] = v;
                                    }
                                    const { userid, username, name, type, idnum, zpqian, zphou } = data;
                                if (!userid || !username || !name || !type || !idnum || !zpqian || !zphou) {
                                    res.writeHead(400, { 'Content-Type': 'application/json' });
                                    res.end(JSON.stringify({ code: 0, info: 'Missing parameters' }));
                                    return;
                                }

                                const kycPath = path.join(__dirname, 'kyc_records.json');
                                let kyc = [];
                                if (fs.existsSync(kycPath)) {
                                    try { kyc = JSON.parse(fs.readFileSync(kycPath, 'utf8')) || []; } catch (e) { kyc = []; }
                                }

                                const record = {
                                    id: uuidv4(),
                                    userid,
                                    username,
                                    stage: 1,
                                    status: 'pending',
                                    data: { name, type, idnum, zpqian, zphou },
                                    submitted_at: new Date().toISOString(),
                                    reviewed_at: null,
                                    reviewed_by: null
                                };

                                kyc.push(record);
                                fs.writeFileSync(kycPath, JSON.stringify(kyc, null, 2));

                                res.writeHead(200, { 'Content-Type': 'application/json' });
                                res.end(JSON.stringify({ code: 1, info: 'KYC stage 1 submitted', data: record }));
                            } catch (err) {
                                console.error('[User setuserrz1] Error:', err);
                                res.writeHead(500, { 'Content-Type': 'application/json' });
                                res.end(JSON.stringify({ code: 0, info: 'Server error' }));
                            }
                        });
                        return;
                    }

                    // KYC Stage 2: address proof submission - /User/setuserrz2
                    if (pathname === '/User/setuserrz2' && req.method === 'POST') {
                        let body = '';
                        req.on('data', chunk => { body += chunk; });
                        req.on('end', () => {
                                try {
                                    let data;
                                    try {
                                        let jsonBody = body;
                                        if (body && body.includes('}&')) jsonBody = body.substring(0, body.indexOf('}&') + 1);
                                        data = JSON.parse(jsonBody || '{}');
                                    } catch (parseErr) {
                                        data = {};
                                        const params = new URLSearchParams(body);
                                        for (const [k, v] of params.entries()) data[k] = v;
                                    }
                                    const { userid, username, zphou } = data;
                                if (!userid || !username || !zphou) {
                                    res.writeHead(400, { 'Content-Type': 'application/json' });
                                    res.end(JSON.stringify({ code: 0, info: 'Missing parameters' }));
                                    return;
                                }

                                const kycPath = path.join(__dirname, 'kyc_records.json');
                                let kyc = [];
                                if (fs.existsSync(kycPath)) {
                                    try { kyc = JSON.parse(fs.readFileSync(kycPath, 'utf8')) || []; } catch (e) { kyc = []; }
                                }

                                const record = {
                                    id: uuidv4(),
                                    userid,
                                    username,
                                    stage: 2,
                                    status: 'pending',
                                    data: { zphou },
                                    submitted_at: new Date().toISOString(),
                                    reviewed_at: null,
                                    reviewed_by: null
                                };

                                kyc.push(record);
                                fs.writeFileSync(kycPath, JSON.stringify(kyc, null, 2));

                                res.writeHead(200, { 'Content-Type': 'application/json' });
                                res.end(JSON.stringify({ code: 1, info: 'KYC stage 2 submitted', data: record }));
                            } catch (err) {
                                console.error('[User setuserrz2] Error:', err);
                                res.writeHead(500, { 'Content-Type': 'application/json' });
                                res.end(JSON.stringify({ code: 0, info: 'Server error' }));
                            }
                        });
                        return;
                    }
                    // API-prefixed handlers so frontend using `apiurl = .../api` works
                    if (pathname === '/api/User/setuserrz1' && req.method === 'POST') {
                        let body = '';
                        req.on('data', chunk => { body += chunk; });
                        req.on('end', () => {
                            try {
                                let data;
                                try {
                                    let jsonBody = body;
                                    if (body && body.includes('}&')) jsonBody = body.substring(0, body.indexOf('}&') + 1);
                                    data = JSON.parse(jsonBody || '{}');
                                } catch (parseErr) {
                                    data = {};
                                    const params = new URLSearchParams(body);
                                    for (const [k, v] of params.entries()) data[k] = v;
                                }
                                const { userid, username, name, type, idnum, zpqian, zphou } = data;
                                if (!userid || !username || !name || !type || !idnum || !zpqian || !zphou) {
                                    res.writeHead(400, { 'Content-Type': 'application/json' });
                                    res.end(JSON.stringify({ code: 0, info: 'Missing parameters' }));
                                    return;
                                }

                                const kycPath = path.join(__dirname, 'kyc_records.json');
                                let kyc = [];
                                if (fs.existsSync(kycPath)) {
                                    try { kyc = JSON.parse(fs.readFileSync(kycPath, 'utf8')) || []; } catch (e) { kyc = []; }
                                }

                                const record = {
                                    id: uuidv4(), userid, username, stage: 1, status: 'pending',
                                    data: { name, type, idnum, zpqian, zphou },
                                    submitted_at: new Date().toISOString(), reviewed_at: null, reviewed_by: null
                                };

                                kyc.push(record);
                                fs.writeFileSync(kycPath, JSON.stringify(kyc, null, 2));

                                res.writeHead(200, { 'Content-Type': 'application/json' });
                                res.end(JSON.stringify({ code: 1, info: 'KYC stage 1 submitted', data: record }));
                            } catch (err) {
                                console.error('[api User setuserrz1] Error:', err);
                                res.writeHead(500, { 'Content-Type': 'application/json' });
                                res.end(JSON.stringify({ code: 0, info: 'Server error' }));
                            }
                        });
                        return;
                    }

                    if (pathname === '/api/User/setuserrz2' && req.method === 'POST') {
                        let body = '';
                        req.on('data', chunk => { body += chunk; });
                        req.on('end', () => {
                            try {
                                let data;
                                try {
                                    let jsonBody = body;
                                    if (body && body.includes('}&')) jsonBody = body.substring(0, body.indexOf('}&') + 1);
                                    data = JSON.parse(jsonBody || '{}');
                                } catch (parseErr) {
                                    data = {};
                                    const params = new URLSearchParams(body);
                                    for (const [k, v] of params.entries()) data[k] = v;
                                }
                                const { userid, username, zphou } = data;
                                if (!userid || !username || !zphou) {
                                    res.writeHead(400, { 'Content-Type': 'application/json' });
                                    res.end(JSON.stringify({ code: 0, info: 'Missing parameters' }));
                                    return;
                                }

                                const kycPath = path.join(__dirname, 'kyc_records.json');
                                let kyc = [];
                                if (fs.existsSync(kycPath)) {
                                    try { kyc = JSON.parse(fs.readFileSync(kycPath, 'utf8')) || []; } catch (e) { kyc = []; }
                                }

                                const record = {
                                    id: uuidv4(), userid, username, stage: 2, status: 'pending',
                                    data: { zphou }, submitted_at: new Date().toISOString(), reviewed_at: null, reviewed_by: null
                                };

                                kyc.push(record);
                                fs.writeFileSync(kycPath, JSON.stringify(kyc, null, 2));

                                res.writeHead(200, { 'Content-Type': 'application/json' });
                                res.end(JSON.stringify({ code: 1, info: 'KYC stage 2 submitted', data: record }));
                            } catch (err) {
                                console.error('[api User setuserrz2] Error:', err);
                                res.writeHead(500, { 'Content-Type': 'application/json' });
                                res.end(JSON.stringify({ code: 0, info: 'Server error' }));
                            }
                        });
                        return;
                    }

                    // KYC status check - returns numeric status expected by frontend
                    if (pathname === '/api/User/getrzzt1' && req.method === 'POST') {
                        let body = '';
                        req.on('data', chunk => { body += chunk; });
                        req.on('end', () => {
                                try {
                                    let data;
                                    try {
                                        let jsonBody = body;
                                        if (body && body.includes('}&')) jsonBody = body.substring(0, body.indexOf('}&') + 1);
                                        data = JSON.parse(jsonBody || '{}');
                                    } catch (parseErr) {
                                        data = {};
                                        const params = new URLSearchParams(body);
                                        for (const [k, v] of params.entries()) data[k] = v;
                                    }
                                    const { userid } = data;
                                if (!userid) {
                                    res.writeHead(400, { 'Content-Type': 'application/json' });
                                    res.end(JSON.stringify({ code: 0, info: 'Missing userid' }));
                                    return;
                                }

                                const kycPath = path.join(__dirname, 'kyc_records.json');
                                let kyc = [];
                                if (fs.existsSync(kycPath)) {
                                    try { kyc = JSON.parse(fs.readFileSync(kycPath, 'utf8')) || []; } catch (e) { kyc = []; }
                                }

                                // find latest stage1 and stage2 for this user
                                const userRecords = kyc.filter(r => r.userid == userid);
                                const stage1 = userRecords.filter(r => r.stage == 1).sort((a,b)=> new Date(b.submitted_at)-new Date(a.submitted_at))[0];
                                const stage2 = userRecords.filter(r => r.stage == 2).sort((a,b)=> new Date(b.submitted_at)-new Date(a.submitted_at))[0];

                                let status = 0; // default: not applied
                                if (!stage1) status = 0;
                                else if (stage1.status === 'pending') status = 1;
                                else if (stage1.status === 'rejected') status = 3;
                                else if (stage1.status === 'approved') {
                                    if (!stage2) status = 2;
                                    else if (stage2.status === 'pending') status = 4;
                                    else if (stage2.status === 'approved') status = 5;
                                    else if (stage2.status === 'rejected') status = 6;
                                }

                                res.writeHead(200, { 'Content-Type': 'application/json' });
                                res.end(JSON.stringify({ code: 1, data: status }));
                            } catch (err) {
                                console.error('[api User getrzzt1] Error:', err);
                                res.writeHead(500, { 'Content-Type': 'application/json' });
                                res.end(JSON.stringify({ code: 0, info: 'Server error' }));
                            }
                        });
                        return;
                    }

                    // KYC status check for advanced page - returns object expected by kyc2.html
                    if (pathname === '/api/User/getrzzt2' && req.method === 'POST') {
                        let body = '';
                        req.on('data', chunk => { body += chunk; });
                        req.on('end', () => {
                            try {
                                let data;
                                try {
                                    let jsonBody = body;
                                    if (body && body.includes('}&')) jsonBody = body.substring(0, body.indexOf('}&') + 1);
                                    data = JSON.parse(jsonBody || '{}');
                                } catch (parseErr) {
                                    data = {};
                                    const params = new URLSearchParams(body);
                                    for (const [k, v] of params.entries()) data[k] = v;
                                }

                                const { userid } = data;
                                if (!userid) {
                                    res.writeHead(400, { 'Content-Type': 'application/json' });
                                    res.end(JSON.stringify({ code: 0, info: 'Missing userid' }));
                                    return;
                                }

                                const kycPath = path.join(__dirname, 'kyc_records.json');
                                let kyc = [];
                                if (fs.existsSync(kycPath)) {
                                    try { kyc = JSON.parse(fs.readFileSync(kycPath, 'utf8')) || []; } catch (e) { kyc = []; }
                                }

                                // find latest stage1 and stage2 for this user
                                const userRecords = kyc.filter(r => r.userid == userid);
                                const stage1 = userRecords.filter(r => r.stage == 1).sort((a,b)=> new Date(b.submitted_at)-new Date(a.submitted_at))[0];
                                const stage2 = userRecords.filter(r => r.stage == 2).sort((a,b)=> new Date(b.submitted_at)-new Date(a.submitted_at))[0];

                                // renzhengzhuangtai: 0 = primary not completed/approved, 1 = primary approved
                                const renzhengzhuangtai = (stage1 && stage1.status === 'approved') ? 1 : 0;

                                let status = 0; // default: not applied / no stage1
                                if (!stage1) status = 0;
                                else if (stage1.status === 'pending') status = 1;
                                else if (stage1.status === 'rejected') status = 3;
                                else if (stage1.status === 'approved') {
                                    if (!stage2) status = 2;
                                    else if (stage2.status === 'pending') status = 4;
                                    else if (stage2.status === 'approved') status = 5;
                                    else if (stage2.status === 'rejected') status = 6;
                                }

                                res.writeHead(200, { 'Content-Type': 'application/json' });
                                res.end(JSON.stringify({ code: 1, data: { renzhengzhuangtai: renzhengzhuangtai, sfsqrz: status } }));
                            } catch (err) {
                                console.error('[api User getrzzt2] Error:', err);
                                res.writeHead(500, { 'Content-Type': 'application/json' });
                                res.end(JSON.stringify({ code: 0, info: 'Server error' }));
                            }
                        });
                        return;
                    }
                    // Server-Sent Events (SSE) stream for notifications
                    if ((pathname === '/User/notifyStream' || pathname === '/api/User/notifyStream') && req.method === 'GET') {
                        try {
                            // Prepare SSE response
                            res.writeHead(200, {
                                'Content-Type': 'text/event-stream',
                                'Cache-Control': 'no-cache',
                                'Connection': 'keep-alive'
                            });
                            res.write('\n');

                            const userid = parsedUrl.query && (parsedUrl.query.userid || parsedUrl.query.user_id || '') || '';
                            const client = { id: uuidv4(), userid: userid || null, res };
                            sseClients.push(client);

                            // Send initial batch (most recent 10)
                            try {
                                const allNotices = readNotificationsFile();
                                let filtered = allNotices;
                                if (userid) {
                                    const hasUserScoped = allNotices.some(n => n.userid !== undefined && n.userid !== null);
                                    if (hasUserScoped) filtered = allNotices.filter(n => String(n.userid) === String(userid));
                                }
                                filtered.sort((a,b) => (b.shijian||0) - (a.shijian||0));
                                const initData = filtered.slice(0,10).map(n => ({ id: n.id, biaoti: n.biaoti, neirong: n.neirong, shijian: n.shijian, sfyidu: n.sfyidu }));
                                res.write(`event: init\n`);
                                res.write(`data: ${JSON.stringify(initData)}\n\n`);
                            } catch (e) { /* ignore init errors */ }

                            // Remove client on close
                            req.on('close', () => {
                                for (let i = 0; i < sseClients.length; i++) {
                                    if (sseClients[i].id === client.id) { sseClients.splice(i, 1); break; }
                                }
                            });
                        } catch (e) {
                            console.error('[notifyStream] error', e && e.message ? e.message : e);
                        }
                        return;
                    }

                    // Notifications endpoint used by notify.html
                    if ((pathname === '/User/getNotify' || pathname === '/api/User/getNotify') && req.method === 'POST') {
                        let body = '';
                        req.on('data', chunk => { body += chunk; });
                        req.on('end', () => {
                            try {
                                // Parse body (JSON or urlencoded)
                                let data = parseBodyString(body || '');
                                const userid = data.userid || data.user_id || data.uid || '';
                                let page = parseInt(data.page || 1, 10) || 1;
                                if (page < 1) page = 1;
                                const pageSize = 10;

                                // Load notifications from file if present
                                const notiFile = path.join(__dirname, 'notifications.json');
                                let allNotices = [];
                                if (fs.existsSync(notiFile)) {
                                    try { allNotices = JSON.parse(fs.readFileSync(notiFile, 'utf8')) || []; } catch (e) { allNotices = []; }
                                } else {
                                    // Provide sample notices when none exist
                                    const nowSec = Math.floor(Date.now() / 1000);
                                    allNotices = [];
                                    for (let i = 0; i < 8; i++) {
                                        allNotices.push({
                                            id: uuidv4(),
                                            biaoti: `System Notice ${i+1}`,
                                            neirong: `This is a sample notification message #${i+1}`,
                                            shijian: nowSec - i * 3600,
                                            sfyidu: i % 2 === 0 ? 0 : 1
                                        });
                                    }
                                }

                                // If notices have userid property, filter by userid; otherwise return global notices
                                let filtered = allNotices;
                                if (userid) {
                                    const hasUserScoped = allNotices.some(n => n.userid !== undefined && n.userid !== null);
                                    if (hasUserScoped) {
                                        filtered = allNotices.filter(n => String(n.userid) === String(userid));
                                    }
                                }

                                // Sort by time desc
                                filtered.sort((a,b) => (b.shijian || 0) - (a.shijian || 0));

                                // Paginate
                                const start = (page - 1) * pageSize;
                                const pageData = filtered.slice(start, start + pageSize).map(n => ({ id: n.id, biaoti: n.biaoti, neirong: n.neirong, shijian: n.shijian, sfyidu: (n.sfyidu===0?0:1) }));

                                res.writeHead(200, { 'Content-Type': 'application/json' });
                                res.end(JSON.stringify({ code: 1, data: pageData }));
                            } catch (err) {
                                console.error('[getNotify] Error:', err && err.message ? err.message : err);
                                res.writeHead(500, { 'Content-Type': 'application/json' });
                                res.end(JSON.stringify({ code: 0, info: 'Server error' }));
                            }
                        });
                        return;
                    }
                    // Mark notification as read
                    if ((pathname === '/User/markNotifyRead' || pathname === '/api/User/markNotifyRead') && req.method === 'POST') {
                        let body = '';
                        req.on('data', chunk => { body += chunk; });
                        req.on('end', () => {
                            try {
                                const data = parseBodyString(body || '');
                                const id = data.id || data.notify_id || data.nid;
                                const userid = data.userid || data.user_id || data.uid || '';
                                if (!id) {
                                    res.writeHead(400, { 'Content-Type': 'application/json' });
                                    res.end(JSON.stringify({ code: 0, info: 'Missing id' }));
                                    return;
                                }
                                const ok = markNotificationRead(id, userid);
                                res.writeHead(200, { 'Content-Type': 'application/json' });
                                res.end(JSON.stringify({ code: 1, data: { updated: ok ? 1 : 0 } }));
                            } catch (err) {
                                console.error('[markNotifyRead] error', err && err.message ? err.message : err);
                                res.writeHead(500, { 'Content-Type': 'application/json' });
                                res.end(JSON.stringify({ code: 0, info: 'Server error' }));
                            }
                        });
                        return;
                    }

                    // Dev/admin helper: push a notification (for testing)
                    if ((pathname === '/User/pushNotify' || pathname === '/api/User/pushNotify') && req.method === 'POST') {
                        let body = '';
                        req.on('data', chunk => { body += chunk; });
                        req.on('end', () => {
                            try {
                                const data = parseBodyString(body || '');
                                const userid = data.userid || data.user_id || null;
                                const biaoti = data.biaoti || data.title || 'Notification';
                                const neirong = data.neirong || data.content || data.msg || '';
                                const item = addNotification({ userid, biaoti, neirong });
                                res.writeHead(200, { 'Content-Type': 'application/json' });
                                res.end(JSON.stringify({ code: 1, data: item }));
                            } catch (err) {
                                console.error('[pushNotify] error', err && err.message ? err.message : err);
                                res.writeHead(500, { 'Content-Type': 'application/json' });
                                res.end(JSON.stringify({ code: 0, info: 'Server error' }));
                            }
                        });
                        return;
                    }
                    if (alt) {
                        const ext = path.extname(alt).toLowerCase();
                        const contentType = mimeTypes[ext] || 'application/octet-stream';
                        const data = fs.readFileSync(alt);
                        if (ext !== '.html') {
                            res.setHeader('Cache-Control', 'public, max-age=3600');
                        } else {
                            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
                        }
                        res.writeHead(200, { 'Content-Type': contentType });
                        res.end(data);
                        return;
                    }
                } catch (e) {
                    // fall through to 404 render
                }

                // File not found (after alternate lookups)
                res.writeHead(404, { 'Content-Type': 'text/html' });
                res.end(`
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>404 - File Not Found</title>
                        <style>
                            body { font-family: Arial, sans-serif; margin: 50px; }
                            h1 { color: #d32f2f; }
                            p { font-size: 16px; }
                        </style>
                    </head>
                    <body>
                        <h1>404 - File Not Found</h1>
                        <p>The requested file: <code>${pathname}</code> could not be found.</p>
                        <p>Search attempted in per-page <code>*_files</code> folders.</p>
                        <p><a href="/">Go back to home</a></p>
                    </body>
                    </html>
                `);
            } else {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end(`Server Error: ${err.code}`);
            }
            return;
        }

        // Handle directories
        if (stats.isDirectory()) {
            // Try to serve index.html from the directory
            filePath = path.join(filePath, 'index.html');
            fs.readFile(filePath, (err, data) => {
                if (err) {
                    res.writeHead(404, { 'Content-Type': 'text/plain' });
                    res.end('404 - Not Found');
                } else {
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end(data);
                }
            });
            return;
        }

        // Get file extension
        const ext = path.extname(filePath).toLowerCase();
        const contentType = mimeTypes[ext] || 'application/octet-stream';

        // Read and serve the file
        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Server Error');
                return;
            }

            // Use file stats (mtime/size) to provide conditional responses
            try {
                const mtime = stats && stats.mtime ? new Date(stats.mtime) : null;
                const size = stats && typeof stats.size === 'number' ? stats.size : (data ? data.length : 0);
                const etag = `"${size}-${mtime ? mtime.getTime() : Date.now()}"`;
                if (mtime) res.setHeader('Last-Modified', mtime.toUTCString());
                res.setHeader('ETag', etag);

                // Honor conditional requests to return 304 when not modified
                const ifNoneMatch = req.headers['if-none-match'];
                const ifModifiedSince = req.headers['if-modified-since'];
                if (ifNoneMatch && String(ifNoneMatch) === etag) {
                    res.writeHead(304);
                    res.end();
                    return;
                }
                if (ifModifiedSince && mtime) {
                    const ims = new Date(ifModifiedSince).getTime();
                    if (!isNaN(ims) && mtime.getTime() <= ims) {
                        res.writeHead(304);
                        res.end();
                        return;
                    }
                }
            } catch (e) {
                // ignore header generation errors and continue to serve file
            }

            // Add caching headers for static assets
            // Do not cache JSON files or HTML files to ensure admin and page changes are visible
            const longLivedExts = ['.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.woff', '.ttf', '.otf', '.wasm'];
            if (ext === '.json') {
                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            } else if (ext === '.html') {
                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            } else if (longLivedExts.includes(ext)) {
                // These assets are safe to cache for a long time when they are fingerprinted.
                // Use one year + immutable to allow aggressive browser caching.
                res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            } else {
                // Default short cache for other static files
                res.setHeader('Cache-Control', 'public, max-age=86400');
            }

            res.writeHead(200, { 'Content-Type': contentType });
            res.end(data);
        });
    });
});
    

// Start server
server.listen(PORT, HOST, () => {
        console.log(`
╔════════════════════════════════════════════╗
║     BVOX Finance Development Server        ║
╚════════════════════════════════════════════╝

🚀 Server running at: http://${HOST}:${PORT}
📁 Root directory: ${__dirname}

Available features:
    ✓ Static file serving
    ✓ CORS enabled
    ✓ Hot reload compatible
    ✓ Development debugging

Open your browser at: http://${HOST}:${PORT}

Press Ctrl+C to stop the server
`);
});

// Handle server errors
server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`✗ Port ${PORT} is already in use.`);
        console.log(`Try: node server.js --port ${PORT + 1}`);
    } else {
        console.error(`✗ Server error: ${err.message}`);
    }
    process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('\n⚠ SIGTERM signal received: closing HTTP server');
    server.close(() => {
        console.log('✓ HTTP server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('\n⚠ SIGINT signal received: closing HTTP server');
    server.close(() => {
        console.log('✓ HTTP server closed');
        process.exit(0);
    });
});
