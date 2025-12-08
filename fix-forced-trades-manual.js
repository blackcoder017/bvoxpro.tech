// Script to fix forced trades
const fs = require('fs');
const path = require('path');

const tradesFilePath = path.join(__dirname, 'trades_records.json');
const usersFile = path.join(__dirname, 'users.json');

let tradesData = JSON.parse(fs.readFileSync(tradesFilePath, 'utf8'));
let users = JSON.parse(fs.readFileSync(usersFile, 'utf8'));

const userId = '342020';
let fixedCount = 0;
let totalProfitAdded = 0;

// Find all trades for this user with forcedOutcome = "win" but status = "loss"
for (let trade of tradesData) {
    if (String(trade.userid) === userId && trade.forcedOutcome === 'win' && trade.status === 'loss') {
        console.log(`Fixing trade ${trade.id}: ${trade.fangxiang} ${trade.biming}, stake=${trade.num}`);
        
        // Calculate profit
        const invested = parseFloat(trade.num) || 0;
        const profitRatio = parseFloat(trade.zengjia) || 40;
        const profit = Number((invested * (profitRatio / 100)).toFixed(2));
        const payout = Number((invested + profit).toFixed(2));
        
        // Update trade status
        trade.status = 'win';
        trade.updated_at = new Date().toISOString();
        
        // Update user balance
        const uidx = users.findIndex(u => String(u.userid) === userId || String(u.uid) === userId);
        if (uidx !== -1) {
            users[uidx].balance = Number(((parseFloat(users[uidx].balance) || 0) + payout).toFixed(2));
            users[uidx].balances.usdt = Number(((parseFloat(users[uidx].balances.usdt) || 0) + payout).toFixed(2));
            users[uidx].total_income = Number(((parseFloat(users[uidx].total_income) || 0) + profit).toFixed(2));
            
            console.log(`  Added profit: +${profit}, total payout: ${payout}`);
            fixedCount++;
            totalProfitAdded += profit;
        }
    }
}

if (fixedCount > 0) {
    fs.writeFileSync(tradesFilePath, JSON.stringify(tradesData, null, 2));
    fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
    console.log(`\n✓ Fixed ${fixedCount} trades`);
    console.log(`✓ Total profit added: ${totalProfitAdded}`);
    console.log(`✓ User new USDT balance: ${users.find(u => String(u.userid) === userId).balances.usdt}`);
} else {
    console.log('No trades to fix');
}
