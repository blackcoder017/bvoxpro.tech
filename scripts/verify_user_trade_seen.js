require('../app-server');
const http = require('http');
const userId = process.argv[2] || '1765298563993';
const matchAmount = process.argv[3] ? Number(process.argv[3]) : null;
(async ()=>{
  await new Promise(r=>setTimeout(r,1500));
  const queryPage = (p)=>new Promise((resolve,reject)=>{
    const data = `userid=${encodeURIComponent(userId)}&page=${p}`;
    const opts = { hostname: 'localhost', port: 3000, path: '/api/Record/getcontract', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(data) } };
    const req = http.request(opts, res=>{ let b=''; res.on('data', c=>b+=c); res.on('end', ()=>resolve({status: res.statusCode, body: b})); });
    req.on('error', e=>reject(e)); req.write(data); req.end();
  });
  try {
    let page = 1; let found=false; while(true){
      const r = await queryPage(page);
      if (r.status !== 200) { console.error('HTTP', r.status); process.exit(1); }
      const json = JSON.parse(r.body);
      const arr = json.data || [];
      for (const rec of arr) {
        if (!matchAmount || Number(rec.num)===matchAmount) {
          console.log('FOUND on page', page, 'id=', rec.id, 'num=', rec.num, 'buytime=', rec.buytime);
          found = true; break;
        }
      }
      if (found) break;
      if (arr.length === 0) break;
      page += 1;
      if (page>50) break;
    }
    if (!found) console.log('NOT FOUND for user', userId, matchAmount?('amount='+matchAmount):'');
    process.exit(found?0:2);
  } catch (e) {
    console.error('Failed', e);
    process.exit(1);
  }
})();