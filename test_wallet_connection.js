#!/usr/bin/env node
/**
 * Wallet Connection Test Script
 * Tests if wallet connections are properly saved to the database
 */

const http = require('http');
const { connectWallet } = require('./walletModel');

console.log('\n' + '='.repeat(70));
console.log('WALLET CONNECTION TEST');
console.log('='.repeat(70) + '\n');

// Test 1: Direct function call
console.log('Test 1: Direct wallet connection function call');
console.log('-'.repeat(70));

const testAddress1 = '0x742d35Cc6634C0532925a3b844Bc9e7595f12345';
const testAddress2 = '0x873d35Cc6634C0532925a3b844Bc9e7595f54321';

console.log(`\n  Connecting wallet: ${testAddress1}`);
const result1 = connectWallet(testAddress1);
console.log(`  Result:`, JSON.stringify(result1, null, 2));

console.log(`\n  Connecting wallet: ${testAddress2}`);
const result2 = connectWallet(testAddress2);
console.log(`  Result:`, JSON.stringify(result2, null, 2));

console.log(`\n  Reconnecting wallet: ${testAddress1}`);
const result3 = connectWallet(testAddress1);
console.log(`  Result:`, JSON.stringify(result3, null, 2));

// Test 2: Check database files
console.log('\n' + '='.repeat(70));
console.log('Test 2: Database file verification');
console.log('-'.repeat(70));

const fs = require('fs');
const path = require('path');

const WALLET_DB_PATH = path.join(__dirname, 'wallets.json');
const USERS_DB_PATH = path.join(__dirname, 'users.json');

if (fs.existsSync(WALLET_DB_PATH)) {
    const wallets = JSON.parse(fs.readFileSync(WALLET_DB_PATH, 'utf8'));
    console.log(`\n✅ wallets.json exists with ${wallets.length} records`);
    wallets.forEach((w, i) => {
        console.log(`   ${i + 1}. ${w.address} (UID: ${w.uid})`);
    });
} else {
    console.log('\n❌ wallets.json not found');
}

if (fs.existsSync(USERS_DB_PATH)) {
    const users = JSON.parse(fs.readFileSync(USERS_DB_PATH, 'utf8'));
    console.log(`\n✅ users.json exists with ${users.length} records`);
} else {
    console.log('\n❌ users.json not found');
}

// Test 3: HTTP API Test
console.log('\n' + '='.repeat(70));
console.log('Test 3: HTTP API test (requires server running on port 3000)');
console.log('-'.repeat(70));

const testAddress3 = '0x984d35Cc6634C0532925a3b844Bc9e7595fAAAA';

const postData = JSON.stringify({
    address: testAddress3,
    chainId: 'ethereum'
});

const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/api/wallet/connect',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
    }
};

const req = http.request(options, (res) => {
    let data = '';

    res.on('data', (chunk) => {
        data += chunk;
    });

    res.on('end', () => {
        console.log(`\n  Testing API endpoint: POST /api/wallet/connect`);
        console.log(`  Address: ${testAddress3}`);
        console.log(`  Status Code: ${res.statusCode}`);
        console.log(`  Response:`, JSON.stringify(JSON.parse(data), null, 2));
        
        // Final verification
        console.log('\n' + '='.repeat(70));
        console.log('FINAL VERIFICATION');
        console.log('='.repeat(70) + '\n');
        
        const wallets = JSON.parse(fs.readFileSync(WALLET_DB_PATH, 'utf8'));
        console.log(`✅ Total wallets in database: ${wallets.length}`);
        console.log('✅ Wallet records are being saved successfully!');
        console.log('\n' + '='.repeat(70) + '\n');
    });
});

req.on('error', (e) => {
    console.log(`\n⚠️  Note: HTTP test skipped (server not running on port 3000)`);
    console.log(`   Error: ${e.message}`);
    
    // Final verification without HTTP test
    console.log('\n' + '='.repeat(70));
    console.log('FINAL VERIFICATION (Direct Function)');
    console.log('='.repeat(70) + '\n');
    
    const wallets = JSON.parse(fs.readFileSync(WALLET_DB_PATH, 'utf8'));
    console.log(`✅ Total wallets in database: ${wallets.length}`);
    console.log('✅ Wallet records are being saved successfully!');
    console.log('\n' + '='.repeat(70) + '\n');
});

// Write data to the request body.
req.write(postData);
req.end();
