const fs = require('fs');
const path = require('path');

const tradesFile = path.join(__dirname, '..', 'trades_records.json');
const usersFile = path.join(__dirname, '..', 'users.json');

function loadJson(fp){
  if(!fs.existsSync(fp)) return null;
  try{ return JSON.parse(fs.readFileSync(fp,'utf8')); }catch(e){ console.error('Error parsing',fp,e.message); return null; }
}

function saveJson(fp,obj){
  fs.writeFileSync(fp, JSON.stringify(obj, null, 2));
}

function sylFromMiaoshu(m){
  const map = {
    '60': 40,
    '120': 50,
    '180': 70,
    '300': 100
  };
  return map[String(m)] || 40;
}

const trades = loadJson(tradesFile) || [];
const users = loadJson(usersFile) || [];

let fixes = 0;
let totalDelta = 0;

trades.forEach(trade => {
  try{
    if(!trade || !trade.id) return;
    if(!trade.settlement_applied) return; // only already settled trades
    if(!trade.userid) return;

    const invested = Number(trade.num) || 0;
    const currentSyl = (typeof trade.syl !== 'undefined') ? parseFloat(trade.syl) : NaN;
    const correctSyl = sylFromMiaoshu(trade.miaoshu || trade.duration || '');

    // only adjust WIN trades where stored syl differs from correctSyl
    const st = (trade.status || '').toString().toLowerCase();
    if(st === 'win'){
      const oldSyl = Number.isFinite(currentSyl) ? currentSyl : 40;
      if(Math.abs(oldSyl - correctSyl) > 0.0001){
        const oldProfit = Number((invested * (oldSyl/100)).toFixed(2));
        const newProfit = Number((invested * (correctSyl/100)).toFixed(2));
        const delta = Number((newProfit - oldProfit).toFixed(2));
        if(delta !== 0){
          // apply delta to user.balance and total_income
          const uid = String(trade.userid);
          const uidx = users.findIndex(u => String(u.userid) === uid || String(u.uid) === uid);
          if(uidx !== -1){
            // prefer balances.usdt if present
            const user = users[uidx];
            if(user.balances && typeof user.balances.usdt !== 'undefined'){
              user.balances.usdt = Number(((parseFloat(user.balances.usdt)||0) + delta).toFixed(2));
            } else {
              user.balance = Number(((parseFloat(user.balance)||0) + delta).toFixed(2));
            }
            user.total_income = Number(((parseFloat(user.total_income)||0) + delta).toFixed(2));

            // update trade record syl and mark migration flag
            trade.syl = correctSyl;
            trade.settlement_fix_applied = true;

            fixes += 1;
            totalDelta += delta;
            console.log(`[migrate] Trade ${trade.id}: oldSyl=${oldSyl} -> correctSyl=${correctSyl}, applied delta=${delta} to user ${uid}`);
          } else {
            // user not found locally; just update trade.syl so future calculations are correct
            trade.syl = correctSyl;
            trade.settlement_fix_applied = true;
            console.log(`[migrate] Trade ${trade.id}: user ${trade.userid} not found locally; syl backfilled to ${correctSyl}`);
            fixes += 1;
          }
        } else {
          // syl differs but profit same due to rounding; still backfill syl
          trade.syl = correctSyl;
          trade.settlement_fix_applied = true;
          fixes += 1;
        }
      } else if(!Number.isFinite(currentSyl)){
        // syl missing but correct = default 40; still backfill
        trade.syl = correctSyl;
        trade.settlement_fix_applied = true;
        fixes += 1;
      }
    } else {
      // for LOSS trades, if syl missing/backfill it but no balance delta required (old flow deducted stake at buy already)
      if(!Number.isFinite(currentSyl)){
        trade.syl = correctSyl;
        trade.settlement_fix_applied = true;
        fixes += 1;
        console.log(`[migrate] Trade ${trade.id}: backfilled syl=${correctSyl} for LOSS trade`);
      }
    }
  }catch(e){ console.error('Error processing trade',trade && trade.id,e.message); }
});

saveJson(tradesFile, trades);
saveJson(usersFile, users);

console.log(`Migration complete. Trades updated: ${fixes}. Total adjustment applied to users: ${totalDelta.toFixed(2)}.`);
if(fixes>0) console.log('Please restart the server to ensure changes take effect.');
