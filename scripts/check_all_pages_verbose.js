require('../app-server');
const http = require('http');
(async () => {
  await new Promise(r => setTimeout(r, 1500));
  const query = (p) => new Promise((res, rej) => {
    const data = 'userid=1765298563993&page=' + p;
    const opts = { hostname: 'localhost', port: 3000, path: '/api/Record/getcontract', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(data) } };
    const req = http.request(opts, r => { let b = ''; r.on('data', c => b += c); r.on('end', () => res({ status: r.statusCode, body: b })); });
    req.on('error', e => rej(e)); req.write(data); req.end();
  });

  try {
    let page = 1; let total = 0; while (true) {
      const r = await query(page);
      const j = JSON.parse(r.body);
      const arr = j.data || [];
      console.log('page', page, '->', arr.length);
      arr.forEach((rec, idx) => {
        console.log(`  ${page}.${idx+1} id=${rec.id} buytime=${rec.buytime} (${new Date(rec.buytime*1000).toLocaleString()})`);
      });
      if (arr.length === 0) break;
      total += arr.length; page++; if (page > 50) break;
    }
    console.log('total fetched', total);
    process.exit(0);
  } catch (e) {
    console.error('Failed to query pages', e);
    process.exit(1);
  }
})();