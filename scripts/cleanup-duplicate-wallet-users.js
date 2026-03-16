#!/usr/bin/env node
'use strict';

/**
 * One-time cleanup for duplicate user accounts sharing the same wallet address.
 *
 * Default mode is DRY-RUN (no writes).
 * Use --apply to execute writes.
 *
 * Examples:
 *   node scripts/cleanup-duplicate-wallet-users.js
 *   node scripts/cleanup-duplicate-wallet-users.js --apply
 *   node scripts/cleanup-duplicate-wallet-users.js --address 0xcd25...0b2c --apply
 *   node scripts/cleanup-duplicate-wallet-users.js --address 0xcd25...0b2c --keep-userid 1000005 --apply
 *   node scripts/cleanup-duplicate-wallet-users.js --apply --delete-duplicates
 */

require('dotenv').config();

const { connectDB, mongoose } = require('../config/db');

const User = require('../models/User');
const Wallet = require('../models/Wallet');
const Topup = require('../models/Topup');
const Withdrawal = require('../models/Withdrawal');
const ExchangeRecord = require('../models/ExchangeRecord');
const Trade = require('../models/Trade');
const Mining = require('../models/Mining');
const Loan = require('../models/Loan');
const KYC = require('../models/KYC');
const ArbitrageSubscription = require('../models/ArbitrageSubscription');
const Notification = require('../models/Notification');
const Session = require('../models/Session');

const args = parseArgs(process.argv.slice(2));
const DRY_RUN = !args.apply;

function parseArgs(argv) {
    const out = {
        apply: false,
        address: null,
        keepUserid: null,
        deleteDuplicates: false,
    };

    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--apply') out.apply = true;
        else if (a === '--delete-duplicates') out.deleteDuplicates = true;
        else if (a === '--address') out.address = String(argv[++i] || '').toLowerCase();
        else if (a === '--keep-userid') out.keepUserid = String(argv[++i] || '').trim();
    }
    return out;
}

function normalizeAddress(v) {
    if (!v) return '';
    if (Array.isArray(v)) v = v[0];

    const raw = String(v).trim().toLowerCase();
    if (!raw) return '';

    // Repair malformed payloads like "0xabc...,0xabc..." by taking canonical token.
    const tokens = raw.split(',').map((x) => x.trim()).filter(Boolean);
    if (!tokens.length) return '';

    const unique = [...new Set(tokens)];
    const validEth = unique.find((x) => /^0x[a-f0-9]{40}$/.test(x));
    return validEth || unique[0];
}

function asId(v) {
    if (v === null || v === undefined) return '';
    return String(v).trim();
}

function numericOrInf(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

function idsFromUser(user) {
    const ids = new Set();
    [user.userid, user.uid, user.id, user._id].forEach((x) => {
        const s = asId(x);
        if (s) ids.add(s);
    });
    return [...ids];
}

function addBalances(a, b) {
    const out = { ...(a || {}) };
    const src = b || {};
    Object.keys(src).forEach((k) => {
        const left = Number(out[k] || 0);
        const right = Number(src[k] || 0);
        out[k] = round8(left + right);
    });
    return out;
}

function round8(n) {
    return Math.round((Number(n) || 0) * 1e8) / 1e8;
}

function chooseCanonical(users, keepUserid) {
    if (!users.length) return null;

    if (keepUserid) {
        const hit = users.find((u) => {
            const ids = idsFromUser(u);
            return ids.includes(keepUserid);
        });
        if (hit) return hit;
    }

    const sorted = [...users].sort((a, b) => {
        const tA = new Date(a.createdAt || a.created_at || 0).getTime() || Number.POSITIVE_INFINITY;
        const tB = new Date(b.createdAt || b.created_at || 0).getTime() || Number.POSITIVE_INFINITY;
        if (tA !== tB) return tA - tB;

        const nA = numericOrInf(a.userid || a.uid || a.id);
        const nB = numericOrInf(b.userid || b.uid || b.id);
        if (nA !== nB) return nA - nB;

        return String(a._id).localeCompare(String(b._id));
    });

    return sorted[0];
}

async function updateManyByIds(model, field, oldIds, newId) {
    const idList = [...new Set(oldIds.map(asId).filter(Boolean))];
    if (!idList.length) return 0;

    const query = { [field]: { $in: idList } };
    const update = { $set: { [field]: newId } };

    if (DRY_RUN) {
        return model.countDocuments(query);
    }

    const res = await model.updateMany(query, update);
    return res.modifiedCount || 0;
}

async function run() {
    await connectDB();
    if (!mongoose || !mongoose.connection || mongoose.connection.readyState !== 1) {
        throw new Error('MongoDB is not connected. Set MONGODB_URI and retry.');
    }

    const targetAddress = normalizeAddress(args.address);

    const userFilter = targetAddress
        ? {
            $or: [
                { wallet_address: targetAddress },
                { wallet_address: `${targetAddress},${targetAddress}` },
                { wallet_address: { $regex: `^${targetAddress}(,${targetAddress})*$`, $options: 'i' } }
            ]
        }
        : { wallet_address: { $exists: true, $ne: null, $ne: '' } };

    const walletFilter = targetAddress
        ? {
            $or: [
                { address: targetAddress },
                { address: `${targetAddress},${targetAddress}` },
                { address: { $regex: `^${targetAddress}(,${targetAddress})*$`, $options: 'i' } }
            ]
        }
        : { address: { $exists: true, $ne: null, $ne: '' } };

    const users = await User.find(userFilter).lean();
    const wallets = await Wallet.find(walletFilter).lean();

    const usersByMongoId = new Map(users.map((u) => [String(u._id), u]));
    const usersByAnyId = new Map();
    users.forEach((u) => {
        idsFromUser(u).forEach((id) => usersByAnyId.set(id, u));
    });

    const groups = new Map();

    // Group by user.wallet_address
    users.forEach((u) => {
        const addr = normalizeAddress(u.wallet_address);
        if (!addr) return;
        if (!groups.has(addr)) groups.set(addr, new Map());
        groups.get(addr).set(String(u._id), u);
    });

    // Ensure wallet.user_id owners are included in the same address group.
    for (const w of wallets) {
        const addr = normalizeAddress(w.address);
        if (!addr) continue;
        if (!groups.has(addr)) groups.set(addr, new Map());

        const owner = usersByAnyId.get(asId(w.user_id)) || usersByMongoId.get(asId(w.user_id));
        if (owner) {
            groups.get(addr).set(String(owner._id), owner);
        }
    }

    const plans = [];
    for (const [address, map] of groups.entries()) {
        const accountList = [...map.values()];

        // Need cleanup if more than one account OR wallet mapping points to different id.
        const wallet = wallets.find((w) => normalizeAddress(w.address) === address) || null;
        const canonical = chooseCanonical(accountList, args.keepUserid);
        if (!canonical) continue;

        const canonicalIds = idsFromUser(canonical);
        const walletMismatch = wallet && !canonicalIds.includes(asId(wallet.user_id));

        if (accountList.length <= 1 && !walletMismatch) {
            continue;
        }

        const duplicates = accountList.filter((u) => String(u._id) !== String(canonical._id));
        plans.push({
            address,
            canonical,
            duplicates,
            wallet,
        });
    }

    if (!plans.length) {
        console.log('No duplicate wallet-account groups found.');
        await mongoose.connection.close();
        return;
    }

    console.log(`Mode: ${DRY_RUN ? 'DRY-RUN (no changes)' : 'APPLY (writes enabled)'}`);
    console.log(`Target groups: ${plans.length}`);

    let totalRefUpdates = 0;
    let totalUsersUpdated = 0;
    let totalUsersDeleted = 0;

    for (const plan of plans) {
        const canonical = plan.canonical;
        const canonicalUserId = asId(canonical.userid || canonical.uid || canonical.id || canonical._id);

        const oldIds = new Set();
        plan.duplicates.forEach((u) => idsFromUser(u).forEach((x) => oldIds.add(x)));

        // Merge account-level balances and totals into canonical user.
        let mergedBalance = Number(canonical.balance || 0);
        let mergedTotalInvested = Number(canonical.total_invested || 0);
        let mergedTotalIncome = Number(canonical.total_income || 0);
        let mergedBalances = { ...(canonical.balances || {}) };
        let mergedMeta = { ...(canonical.meta || {}) };
        let mergedKycStatus = canonical.kycStatus || 'none';
        let mergedForceTradeWin = !!canonical.force_trade_win;
        let mergedEmail = canonical.email || null;

        plan.duplicates.forEach((u) => {
            mergedBalance += Number(u.balance || 0);
            mergedTotalInvested += Number(u.total_invested || 0);
            mergedTotalIncome += Number(u.total_income || 0);
            mergedBalances = addBalances(mergedBalances, u.balances || {});
            mergedMeta = { ...(u.meta || {}), ...mergedMeta };
            if (!mergedEmail && u.email) mergedEmail = u.email;
            if (!mergedForceTradeWin && u.force_trade_win) mergedForceTradeWin = true;
            if (mergedKycStatus === 'none' && u.kycStatus && u.kycStatus !== 'none') {
                mergedKycStatus = u.kycStatus;
            }
        });

        const mergeSet = {
            balance: round8(mergedBalance),
            total_invested: round8(mergedTotalInvested),
            total_income: round8(mergedTotalIncome),
            balances: mergedBalances,
            wallet_address: plan.address,
            meta: {
                ...mergedMeta,
                merged_duplicate_cleanup_at: new Date().toISOString(),
            },
            force_trade_win: mergedForceTradeWin,
            kycStatus: mergedKycStatus,
        };
        if (mergedEmail) mergeSet.email = mergedEmail;

        console.log('\n------------------------------------------------------------');
        console.log(`Address: ${plan.address}`);
        console.log(`Keep user: ${canonicalUserId} (mongoId=${canonical._id})`);
        console.log(`Merge users: ${plan.duplicates.map((u) => asId(u.userid || u.uid || u.id || u._id)).join(', ') || '(none)'}`);

        if (!DRY_RUN) {
            await User.updateOne({ _id: canonical._id }, { $set: mergeSet });
            totalUsersUpdated += 1;
        }

        // Remap all related collections from duplicate IDs -> canonical ID.
        const remapSpecs = [
            { model: Wallet, field: 'user_id' },
            { model: Topup, field: 'user_id' },
            { model: Withdrawal, field: 'user_id' },
            { model: ExchangeRecord, field: 'user_id' },
            { model: Mining, field: 'user_id' },
            { model: Loan, field: 'user_id' },
            { model: KYC, field: 'user_id' },
            { model: ArbitrageSubscription, field: 'user_id' },
            { model: Notification, field: 'user_id' },
            { model: Trade, field: 'user_id' },
            { model: Trade, field: 'userid' },
            { model: Session, field: 'userId' },
        ];

        for (const spec of remapSpecs) {
            const changed = await updateManyByIds(spec.model, spec.field, [...oldIds], canonicalUserId);
            if (changed > 0) {
                console.log(`  ${spec.model.modelName}.${spec.field}: ${changed}`);
                totalRefUpdates += Number(changed || 0);
            }
        }

        // Ensure wallet record for this address points to canonical user.
        if (plan.wallet) {
            if (DRY_RUN) {
                if (asId(plan.wallet.user_id) !== canonicalUserId) {
                    console.log('  Wallet.user_id remap: 1');
                    totalRefUpdates += 1;
                }
            } else {
                await Wallet.updateOne(
                    { _id: plan.wallet._id },
                    { $set: { user_id: canonicalUserId, address: plan.address, updated_at: new Date() } }
                );
            }
        }

        if (plan.duplicates.length) {
            const dupMongoIds = plan.duplicates.map((u) => u._id);
            if (DRY_RUN) {
                const count = await User.countDocuments({ _id: { $in: dupMongoIds } });
                if (args.deleteDuplicates) {
                    console.log(`  Duplicate users to delete: ${count}`);
                    totalUsersDeleted += count;
                } else {
                    console.log(`  Duplicate users to archive: ${count}`);
                    totalUsersUpdated += count;
                }
            } else if (args.deleteDuplicates) {
                const delRes = await User.deleteMany({ _id: { $in: dupMongoIds } });
                totalUsersDeleted += delRes.deletedCount || 0;
            } else {
                const archiveRes = await User.updateMany(
                    { _id: { $in: dupMongoIds } },
                    {
                        $set: {
                            status: 'merged',
                            wallet_address: null,
                            meta: {
                                merged_into: canonicalUserId,
                                merged_at: new Date().toISOString(),
                            },
                        },
                    }
                );
                totalUsersUpdated += archiveRes.modifiedCount || 0;
            }
        }
    }

    console.log('\n================ Cleanup Summary ================');
    console.log(`Mode: ${DRY_RUN ? 'DRY-RUN' : 'APPLY'}`);
    console.log(`Groups processed: ${plans.length}`);
    console.log(`User docs updated: ${totalUsersUpdated}`);
    console.log(`Reference remaps: ${totalRefUpdates}`);
    console.log(`User docs deleted: ${totalUsersDeleted}`);
    console.log('=================================================\n');

    await mongoose.connection.close();
}

run().catch(async (err) => {
    console.error('Cleanup failed:', err && err.message ? err.message : err);
    try {
        if (mongoose && mongoose.connection) await mongoose.connection.close();
    } catch (e) {
        // ignore close errors
    }
    process.exit(1);
});
