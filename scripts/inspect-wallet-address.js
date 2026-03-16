#!/usr/bin/env node
'use strict';

require('dotenv').config();
const { connectDB, mongoose } = require('../config/db');
const User = require('../models/User');
const Wallet = require('../models/Wallet');

function normalizeAddress(v) {
    if (!v) return '';
    if (Array.isArray(v)) v = v[0];
    const raw = String(v).trim().toLowerCase();
    if (!raw) return '';
    const tokens = raw.split(',').map((x) => x.trim()).filter(Boolean);
    if (!tokens.length) return '';
    const unique = [...new Set(tokens)];
    const validEth = unique.find((x) => /^0x[a-f0-9]{40}$/.test(x));
    return validEth || unique[0];
}

async function run() {
    const addressArg = process.argv[2];
    const address = normalizeAddress(addressArg);
    if (!address) {
        throw new Error('Usage: node scripts/inspect-wallet-address.js <wallet-address>');
    }

    await connectDB();
    if (!mongoose || !mongoose.connection || mongoose.connection.readyState !== 1) {
        throw new Error('MongoDB is not connected. Set MONGODB_URI and retry.');
    }

    const users = await User.find({
        $or: [
            { wallet_address: address },
            { wallet_address: `${address},${address}` },
            { wallet_address: { $regex: `^${address}(,${address})*$`, $options: 'i' } },
        ],
    }).lean();

    const wallets = await Wallet.find({
        $or: [
            { address: address },
            { address: `${address},${address}` },
            { address: { $regex: `^${address}(,${address})*$`, $options: 'i' } },
        ],
    }).lean();

    const relatedIds = [...new Set([
        ...users.flatMap((u) => [u.userid, u.uid, u.id, String(u._id)]),
        ...wallets.map((w) => w.user_id),
    ].filter(Boolean).map((x) => String(x)))];

    const usersByIdRefs = relatedIds.length
        ? await User.find({
            $or: [
                { userid: { $in: relatedIds } },
                { uid: { $in: relatedIds } },
                { id: { $in: relatedIds } },
            ],
        }).lean()
        : [];

    console.log(JSON.stringify({
        address,
        users,
        wallets,
        usersByIdRefs,
    }, null, 2));

    await mongoose.connection.close();
}

run().catch(async (err) => {
    console.error(err && err.message ? err.message : err);
    try { await mongoose.connection.close(); } catch (e) {}
    process.exit(1);
});
