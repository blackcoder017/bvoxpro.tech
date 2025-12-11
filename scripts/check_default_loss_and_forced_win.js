const http = require('http');
function post(path, data) {
  const s = typeof data === 'string' ? data : Object.keys(data).map(k=>encodeURIComponent(k)+'='+encodeURIComponent(data[k])).join('&');
  const opts = { hostname: 'localhost', port: 3000, path, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(s) } };
  return new Promise((resolve,reject)=>{
    const req = http.request(opts, res => { let b=''; res.on('data', c=>b+=c); res.on('end', ()=> resolve({status:res.statusCode,body:b})); });
    req.on('error', e => reject(e)); req.write(s); req.end();
  });
}

require('../app-server');
(async()=>{
  await new Promise(r=>setTimeout(r,2500));
  try {
    const user = '1765298563993';
    console.log('Ensure force_trade_win is false');
    await post('/api/admin/set-user-flag', { user_id: user, flag: 'force_trade_win', value: 'false' });

    console.log('Balance BEFORE test');
    let r = await post('/api/wallet/getbalance', { userid: user });
    console.log('BEFORE balance:', r.body);

    console.log('Create short trade (num=5, miaoshu=1)');
    r = await post('/api/trade/buy', { userid: user, username: 'test', fangxiang: 2, miaoshu: 1, biming: 'btc', num: 5, buyprice: 90000, syl: 40, zengjia: 90050, jianshao: 89950 });
    const id1 = JSON.parse(r.body).data;
    console.log('Created', id1);

    await new Promise(r=>setTimeout(r,3000));

    console.log('Call getorderjs for short trade');
    r = await post('/api/trade/getorderjs', { id: id1 });
    console.log('GETORDERJS resp:', r.body);

    console.log('Balance AFTER short trade');
    r = await post('/api/wallet/getbalance', { userid: user });
    console.log('AFTER balance:', r.body);

    // Now create pending trade and force win via admin endpoint
    console.log('Create pending trade (num=5, miaoshu=60)');
    r = await post('/api/trade/buy', { userid: user, username: 'test', fangxiang: 1, miaoshu: 60, biming: 'btc', num: 5, buyprice: 90000, syl: 40, zengjia: 90050, jianshao: 89950 });
    const id2 = JSON.parse(r.body).data;
    console.log('Created pending', id2);

    console.log('Enable force_trade_win via admin');
    r = await post('/api/admin/set-user-flag', { user_id: user, flag: 'force_trade_win', value: 'true' });
    console.log('ADMIN resp:', r.body);

    console.log('Check trade status via getorder (should now be win)');
    r = await post('/api/trade/getorderjs', { id: id2 });
    console.log('GETORDERJS resp for forced trade:', r.body);

    console.log('Final balance:');
    r = await post('/api/wallet/getbalance', { userid: user });
    console.log('FINAL balance:', r.body);

    // Clear flag
    await post('/api/admin/set-user-flag', { user_id: user, flag: 'force_trade_win', value: 'false' });

  } catch (e) { console.error('Test error', e); }
  process.exit(0);
})();