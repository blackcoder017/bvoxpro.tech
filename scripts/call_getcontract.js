require('../app-server');
const http = require('http');
(async ()=>{
  await new Promise(r=>setTimeout(r,1500));
  const data = 'userid=1765298563993&page=1';
  const opts = { hostname: 'localhost', port: 3000, path: '/api/Record/getcontract', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(data) } };
  const resp = await new Promise((resolve,reject)=>{ const req = http.request(opts, res=>{ let b=''; res.on('data',c=>b+=c); res.on('end', ()=>resolve({status:res.statusCode, body:b})); }); req.on('error', e=>reject(e)); req.write(data); req.end(); });
  console.log('HTTP', resp.status, resp.body.slice(0,400));
  process.exit(0);
})();