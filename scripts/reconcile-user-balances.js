(async function(){
    const { connectDB } = require('../config/db');
    const db = require('../config/database');
    const mongoose = await connectDB();
    if (!mongoose) {
        console.error('No DB connection available. Aborting.');
        process.exit(1);
    }

    const userId = process.argv[2];
    if (!userId) {
        console.error('Usage: node scripts/reconcile-user-balances.js <userId>');
        process.exit(2);
    }

    try {
        console.log('[reconcile] Reconciling balances for user:', userId);
        // Sum topup records by coin
        const topups = await db.getUserTopupRecords(userId, 1000);
        const coinTotals = {};
        for (const t of topups) {
            const coin = (t.coin || 'USDT').toLowerCase();
            coinTotals[coin] = (coinTotals[coin] || 0) + (Number(t.amount) || 0);
        }

        // Normalize keys to expected names
        const normalized = {
            usdt: Number(coinTotals['usdt'] || coinTotals['USDT'] || coinTotals['Usdt'] || 0),
            usdc: Number(coinTotals['usdc'] || 0),
            btc: Number(coinTotals['btc'] || 0),
            eth: Number(coinTotals['eth'] || 0),
            pyusd: Number(coinTotals['pyusd'] || 0),
            sol: Number(coinTotals['sol'] || 0)
        };

        // Also include summed wallet balances (fallback)
        const wallets = await db.getUserWallets(userId);
        for (const w of wallets) {
            if (w.balances && typeof w.balances === 'object') {
                Object.keys(w.balances).forEach(k => {
                    const key = k.toLowerCase();
                    if (normalized[key] === undefined) normalized[key] = 0;
                    normalized[key] = (normalized[key] || 0) + (Number(w.balances[k]) || 0);
                });
            }
        }

        // Compute total_balance
        const total = Object.keys(normalized).reduce((acc,k)=>acc + (Number(normalized[k])||0),0);
        normalized.total_balance = total;

        console.log('[reconcile] Computed balances:', normalized);

        // Update user.balances via db helper
        const updated = await db.updateUserBalances(userId, normalized);
        if (!updated) {
            console.error('[reconcile] Failed to update user balances via db.updateUserBalances');
            process.exit(3);
        }

        console.log('[reconcile] Successfully updated user balances for', userId);
        process.exit(0);
    } catch (e) {
        console.error('[reconcile] Fatal error:', e && e.message);
        process.exit(4);
    }
})();
