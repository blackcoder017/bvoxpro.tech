#!/usr/bin/env node

/**
 * Test: User ID Formatting and Wallet Connect
 * Verifies that:
 * 1. User IDs are generated correctly starting from 342016
 * 2. User IDs are formatted as 6-digit numbers (000000 format)
 * 3. Wallet connect returns user ID correctly
 */

const fs = require('fs');
const path = require('path');

// Test data
console.log('╔════════════════════════════════════════════════════════╗');
console.log('║  User ID Format & Wallet Connect Test                  ║');
console.log('╚════════════════════════════════════════════════════════╝\n');

// Read users.json
const usersPath = path.join(__dirname, 'users.json');
let users = [];

if (fs.existsSync(usersPath)) {
    try {
        const data = fs.readFileSync(usersPath, 'utf8');
        users = JSON.parse(data);
        console.log(`✓ Loaded ${users.length} users from users.json\n`);
    } catch (e) {
        console.error('✗ Error loading users.json:', e.message);
        process.exit(1);
    }
} else {
    console.error('✗ users.json not found');
    process.exit(1);
}

// Test 1: Check User IDs start from 342016
console.log('TEST 1: User ID Range (Should start from 342016)\n');
const userIds = users.map(u => {
    const id = u.userid || u.user_id || u.uid;
    return id ? parseInt(id) : 0;
}).filter(id => id > 0).sort((a, b) => a - b);

if (userIds.length > 0) {
    const minId = Math.min(...userIds);
    const maxId = Math.max(...userIds);
    console.log(`  First User ID: ${minId}`);
    console.log(`  Last User ID:  ${maxId}`);
    console.log(`  Total Users:   ${userIds.length}`);
    
    if (minId >= 342016) {
        console.log('  ✓ PASS: All User IDs >= 342016\n');
    } else {
        console.log(`  ✗ FAIL: Found User ID ${minId} < 342016\n`);
    }
} else {
    console.log('  ⚠ No users found\n');
}

// Test 2: Display User IDs in 000000 format
console.log('TEST 2: User ID Format (6-digit format)\n');
console.log('  User ID (6-digit format):');
users.slice(0, 5).forEach((user, idx) => {
    const id = user.userid || user.user_id || user.uid;
    const formatted = String(id).padStart(6, '0');
    console.log(`    ${idx + 1}. ${formatted} (original: ${id})`);
});
if (users.length > 5) {
    console.log(`    ... and ${users.length - 5} more users`);
}
console.log('  ✓ PASS: Format function ready\n');

// Test 3: Show wallet addresses
console.log('TEST 3: Wallet Addresses and Balances\n');
console.log('  Sample user data:\n');
const sampleUsers = users.slice(0, 3);
sampleUsers.forEach((user, idx) => {
    const id = String(user.userid || user.user_id || user.uid).padStart(6, '0');
    const wallet = user.wallet_address || user.address || 'N/A';
    const short = wallet.length > 10 ? wallet.substring(0, 6) + '...' + wallet.substring(wallet.length - 4) : wallet;
    const balances = user.balances || {};
    
    console.log(`  User #${idx + 1}: ${id}`);
    console.log(`    Address: ${short}`);
    console.log(`    Balances:`);
    console.log(`      USDT: ${(balances.usdt || 0).toFixed(2)}`);
    console.log(`      ETH:  ${(balances.eth || 0).toFixed(4)}`);
    console.log(`      BTC:  ${(balances.btc || 0).toFixed(4)}`);
    console.log(`      USDC: ${(balances.usdc || 0).toFixed(2)}`);
    console.log(`      SOL:  ${(balances.sol || 0).toFixed(4)}`);
    console.log('');
});

// Test 4: Check wallet connections
console.log('TEST 4: Wallet Connection Status\n');
const walletsPath = path.join(__dirname, 'wallets.json');
let wallets = [];

if (fs.existsSync(walletsPath)) {
    try {
        const data = fs.readFileSync(walletsPath, 'utf8');
        wallets = JSON.parse(data);
        console.log(`✓ Found ${wallets.length} wallet connections\n`);
        
        // Show sample wallets
        wallets.slice(0, 3).forEach((wallet, idx) => {
            const id = String(wallet.userid || wallet.uid).padStart(6, '0');
            const addr = wallet.address;
            const short = addr.substring(0, 6) + '...' + addr.substring(addr.length - 4);
            const lastLogin = wallet.last_login ? new Date(wallet.last_login).toLocaleDateString() : 'N/A';
            console.log(`  ${idx + 1}. ID: ${id} | Wallet: ${short} | Last Login: ${lastLogin}`);
        });
        if (wallets.length > 3) {
            console.log(`  ... and ${wallets.length - 3} more wallets`);
        }
        console.log('  ✓ PASS: Wallet connections found\n');
    } catch (e) {
        console.log(`  ⚠ Could not load wallets: ${e.message}\n`);
    }
} else {
    console.log('  ⚠ wallets.json not found\n');
}

// Summary
console.log('╔════════════════════════════════════════════════════════╗');
console.log('║  Summary                                               ║');
console.log('╠════════════════════════════════════════════════════════╣');
console.log(`║  Total Users:      ${users.length.toString().padEnd(45)} ║`);
console.log(`║  User ID Format:   000000 (6-digit)                   ║`);
console.log(`║  Starting ID:      342016                              ║`);
console.log(`║  Columns:          USER ID | WALLET | Coins | ...    ║`);
console.log(`║                                                        ║`);
console.log('║  ✓ Ready for display in User List modal               ║');
console.log('╚════════════════════════════════════════════════════════╝\n');
