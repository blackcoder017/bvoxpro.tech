#!/usr/bin/env node
/**
 * Manual Mining Settlement Trigger
 * 
 * This script manually processes all overdue mining records
 * and credits rewards to user balances
 * 
 * Usage: node manual-settlement.js
 */

const fs = require('fs');
const path = require('path');

console.log('\n🔄 Starting Manual Mining Settlement...\n');

try {
    const miningFile = path.join(__dirname, 'mining_records.json');
    const usersFile = path.join(__dirname, 'users.json');
    
    if (!fs.existsSync(miningFile)) {
        console.error('❌ mining_records.json not found');
        process.exit(1);
    }
    
    if (!fs.existsSync(usersFile)) {
        console.error('❌ users.json not found');
        process.exit(1);
    }

    let miningRecords = JSON.parse(fs.readFileSync(miningFile, 'utf8')) || [];
    let users = JSON.parse(fs.readFileSync(usersFile, 'utf8')) || [];
    
    console.log(`📊 Found ${miningRecords.length} mining records`);
    console.log(`👥 Found ${users.length} users\n`);

    const now = new Date().getTime();
    let settledCount = 0;
    let totalRewards = 0;

    // Process each active mining record
    miningRecords.forEach((record, idx) => {
        if (record.status !== 'active') {
            console.log(`⏭️  Skipping record ${record.id}: status = ${record.status}`);
            return;
        }

        const startTime = new Date(record.startDate).getTime();
        const hoursElapsed = (now - startTime) / (1000 * 60 * 60);
        const dailyReward = record.stakedAmount * record.dailyYield;
        
        // Check if 24 hours or more have passed
        let lastUpdateTime = startTime;
        if (record.lastIncomeAt) {
            lastUpdateTime = new Date(record.lastIncomeAt).getTime();
        }
        
        const hoursSinceLastUpdate = (now - lastUpdateTime) / (1000 * 60 * 60);
        
        console.log(`\n📝 Record: ${record.id}`);
        console.log(`   Staked: ${record.stakedAmount} ETH`);
        console.log(`   Daily Yield: ${(record.dailyYield * 100).toFixed(2)}%`);
        console.log(`   Daily Reward: ${dailyReward.toFixed(8)} ETH`);
        console.log(`   Hours Elapsed: ${hoursElapsed.toFixed(2)}`);
        console.log(`   Hours Since Last Update: ${hoursSinceLastUpdate.toFixed(2)}`);
        
        // If at least 24 hours have passed
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
                
                settledCount++;
                totalRewards += dailyReward;
                
                console.log(`   ✅ SETTLED`);
                console.log(`   Added to balance: +${dailyReward.toFixed(8)} ETH`);
                console.log(`   New balance: ${user.balances.eth.toFixed(8)} ETH`);
                console.log(`   Total income: ${miningRecords[idx].totalIncome.toFixed(8)} ETH`);
            } else {
                console.log(`   ❌ User ${record.userid} not found in users.json`);
            }
        } else {
            console.log(`   ⏳ Not yet (needs ${(24 - hoursElapsed).toFixed(2)} more hours)`);
        }
    });

    // Save changes if any were made
    if (settledCount > 0) {
        console.log(`\n\n💾 Saving ${settledCount} updated records...`);
        fs.writeFileSync(miningFile, JSON.stringify(miningRecords, null, 2));
        fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
        console.log('✅ Files saved successfully\n');
    } else {
        console.log('\n⏳ No records needed settlement\n');
    }

    console.log(`\n📊 Settlement Summary:`);
    console.log(`   Records Settled: ${settledCount}`);
    console.log(`   Total Rewards: ${totalRewards.toFixed(8)} ETH`);
    console.log(`   Status: ${settledCount > 0 ? '✅ COMPLETE' : '⏳ NO ACTION NEEDED'}\n`);

} catch (error) {
    console.error(`\n❌ Error:`, error.message);
    process.exit(1);
}
