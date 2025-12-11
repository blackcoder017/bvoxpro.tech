require('../app-server');
const db = require('../config/database');
(async ()=>{
  await new Promise(r=>setTimeout(r,1500));
  try {
    const trades = await db.getUserTrades('1765298563993', 50);
    console.log('Found', trades.length, 'trades');
    trades.slice(0,10).forEach(t=>console.log({id:t.id, user_id:t.user_id, status:t.status, num:t.num, created_at:t.created_at}));
  } catch (e) { console.error('Error getting trades:', e.message); }
  process.exit(0);
})();