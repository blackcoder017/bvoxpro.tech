require('../app-server');
const http = require('http');
(async ()=>{
  await new Promise(r=>setTimeout(r,1500));
  const data = 'userid=1765298563993&page=1';
  const opts = { hostname: 'localhost', port: 3000, path: '/api/Record/getcontract', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(data) } };
  try {
    const resp = await new Promise((resolve,reject)=>{ const req = http.request(opts, res=>{ let b=''; res.on('data',c=>b+=c); res.on('end', ()=>resolve({status:res.statusCode, body:b})); }); req.on('error', e=>reject(e)); req.write(data); req.end(); });
    if (resp.status !== 200) {
      console.error('HTTP', resp.status, resp.body);
      process.exit(1);
    }
    const json = JSON.parse(resp.body);
    if (json.code !== 1) {
      console.error('API returned code !=1', json);
      process.exit(1);
    }
    const dataArr = json.data || [];
    console.log('Found', dataArr.length, 'records');
    dataArr.forEach((rec, i)=>{
      const ts = rec.buytime ? Number(rec.buytime) : null;
      const dateStr = ts ? new Date(ts*1000).toLocaleString() : 'N/A';
      console.log(`${i+1}. id=${rec.id} buytime=${rec.buytime} (${dateStr}) invested=${rec.num} ying=${rec.ying} zhuangtai=${rec.zhuangtai}`);
    });
    process.exit(0);
  } catch (e) {
    console.error('Request failed', e);
    process.exit(1);
  }
})();