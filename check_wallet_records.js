#!/usr/bin/env node
/**
 * Wallet Connection Record Checker
 * Checks if wallet connect records are being saved to the database
 */

const fs = require('fs');
const path = require('path');

const WALLET_DB_PATH = path.join(__dirname, 'wallets.json');
const USERS_DB_PATH = path.join(__dirname, 'users.json');

console.log('\n' + '='.repeat(60));
console.log('WALLET CONNECTION RECORD CHECKER');
console.log('='.repeat(60) + '\n');

// Check wallets.json
console.log('📁 Checking wallets.json...');
if (fs.existsSync(WALLET_DB_PATH)) {
    try {
        const walletsData = JSON.parse(fs.readFileSync(WALLET_DB_PATH, 'utf8'));
        console.log('✅ wallets.json exists');
        console.log(`📊 Total wallets connected: ${walletsData.length}\n`);
        
        if (walletsData.length > 0) {
            console.log('Wallet Records:');
            console.log('-'.repeat(60));
            walletsData.forEach((wallet, index) => {
                console.log(`\n${index + 1}. Wallet Entry:`);
                console.log(`   UID: ${wallet.uid}`);
                console.log(`   Address: ${wallet.address}`);
                console.log(`   Chain ID: ${wallet.chainId}`);
                console.log(`   Status: ${wallet.status}`);
                console.log(`   Connected At: ${wallet.connected_at}`);
                console.log(`   Last Login: ${wallet.last_login}`);
            });
        } else {
            console.log('⚠️  No wallet records found in wallets.json');
        }
    } catch (err) {
        console.log('❌ Error reading wallets.json:', err.message);
    }
} else {
    console.log('❌ wallets.json does not exist');
}

console.log('\n' + '-'.repeat(60) + '\n');

// Check users.json
console.log('📁 Checking users.json...');
if (fs.existsSync(USERS_DB_PATH)) {
    try {
        const usersData = JSON.parse(fs.readFileSync(USERS_DB_PATH, 'utf8'));
        console.log('✅ users.json exists');
        console.log(`📊 Total users registered: ${usersData.length}\n`);
        
        if (usersData.length > 0) {
            console.log('User Records:');
            console.log('-'.repeat(60));
            usersData.forEach((user, index) => {
                console.log(`\n${index + 1}. User Entry:`);
                console.log(`   UID: ${user.uid}`);
                console.log(`   Username: ${user.username}`);
                console.log(`   Wallet Address: ${user.wallet_address}`);
                console.log(`   Balance: ${user.balance}`);
                console.log(`   Status: ${user.status}`);
                console.log(`   Created At: ${user.created_at}`);
                console.log(`   Last Login: ${user.last_login}`);
            });
        } else {
            console.log('⚠️  No user records found in users.json');
        }
    } catch (err) {
        console.log('❌ Error reading users.json:', err.message);
    }
} else {
    console.log('❌ users.json does not exist');
}

console.log('\n' + '='.repeat(60));
console.log('SUMMARY');
console.log('='.repeat(60));

const walletsExist = fs.existsSync(WALLET_DB_PATH);
const usersExist = fs.existsSync(USERS_DB_PATH);

try {
    const walletCount = walletsExist ? JSON.parse(fs.readFileSync(WALLET_DB_PATH, 'utf8')).length : 0;
    const userCount = usersExist ? JSON.parse(fs.readFileSync(USERS_DB_PATH, 'utf8')).length : 0;
    
    console.log(`\n✅ wallets.json: ${walletsExist ? `✓ (${walletCount} records)` : '✗ Missing'}`);
    console.log(`✅ users.json: ${usersExist ? `✓ (${userCount} records)` : '✗ Missing'}`);
    
    if (walletCount > 0 && userCount > 0) {
        console.log('\n✅ Database is working correctly!');
        console.log('   Wallet connections are being saved to the database.');
    } else if (walletCount === 0 && userCount === 0) {
        console.log('\n⚠️  No records found yet.');
        console.log('   Complete a wallet connection to create records.');
    } else {
        console.log('\n⚠️  Mismatch detected!');
        console.log('   Wallet count and user count do not match.');
    }
} catch (err) {
    console.log(`\n❌ Error: ${err.message}`);
}

console.log('\n' + '='.repeat(60) + '\n');
