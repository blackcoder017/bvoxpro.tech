(async function(){
    const { connectDB } = require('../config/db');
    const mongoose = await connectDB();
    if (!mongoose) {
        console.error('No DB connection available. Aborting.');
        process.exit(1);
    }

    const ArbitrageSubscription = require('../models/ArbitrageSubscription');
    const User = require('../models/User');
    const Topup = require('../models/Topup');

    const dryRun = process.argv.includes('--dry');

    try {
        const now = new Date();
        console.log('[script] Searching for due arbitrage subscriptions at', now.toISOString());
        const due = await ArbitrageSubscription.find({ status: 'active', end_date: { $lte: now } });
        if (!due || due.length === 0) {
            console.log('[script] No due arbitrage subscriptions found');
            process.exit(0);
        }

        console.log('[script] Found', due.length, 'due subscriptions');
        for (const sub of due) {
            try {
                console.log('\n[script] Processing sub:', sub._id.toString(), 'user_id:', sub.user_id, 'amount:', sub.amount, 'start:', sub.start_date, 'end:', sub.end_date);
                const amount = Number(sub.amount || 0);
                const durationDays = sub.end_date && sub.start_date ? Math.max(1, Math.round((new Date(sub.end_date) - new Date(sub.start_date)) / (24*60*60*1000))) : (sub.duration_days || 1);
                const dailyReturn = typeof sub.daily_return === 'number' && sub.daily_return>0 ? sub.daily_return : ((Number(sub.daily_return_min||0)+Number(sub.daily_return_max||0))/2);
                const totalReturnPercent = Number((dailyReturn * durationDays).toFixed(4));
                const totalIncome = Number(((amount * totalReturnPercent) / 100).toFixed(4));
                console.log('[script] Computed totalIncome:', totalIncome, 'totalReturnPercent:', totalReturnPercent);

                const user = await User.findOne({ $or: [{ userid: sub.user_id }, { id: sub.user_id }, { uid: sub.user_id }] });
                if (!user) {
                    console.warn('[script] User not found for subscription', sub._id.toString());
                    continue;
                }

                const credit = Number((amount + totalIncome).toFixed(4));
                console.log('[script] Credit (principal + income):', credit);

                if (!dryRun) {
                    user.balances = user.balances || {};
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

                    try { await Topup.create({ id: `topup_${Date.now()}_${Math.random().toString(36).slice(2,8)}`, user_id: sub.user_id, coin: 'USDT', amount: credit, status: 'complete', timestamp: Date.now(), created_at: new Date() }); } catch(e){ console.warn('[script] failed to write topup', e && e.message); }

                    console.log('[script] Settled and credited user', user.userid || user.id || user.uid);
                } else {
                    console.log('[script] DRY RUN - no DB changes applied');
                }

            } catch (innerE) {
                console.error('[script] error processing sub', sub._id && sub._id.toString(), innerE && innerE.message);
            }
        }

        console.log('\n[script] Completed');
        process.exit(0);
    } catch (e) {
        console.error('[script] fatal error:', e && e.message);
        process.exit(1);
    }
})();
