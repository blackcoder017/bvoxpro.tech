const http = require('http');
const { ethers } = require('ethers');

const SERVER = 'http://localhost:3000';

async function httpGetJson(path) {
  return new Promise((resolve, reject) => {
    http.get(SERVER + path, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function httpPostJson(path, obj) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(obj);
    const opts = {
      hostname: 'localhost', port: 3000, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    };
    const req = http.request(opts, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => {
        try { resolve({ statusCode: res.statusCode, body: JSON.parse(body) }); } catch (e) { resolve({ statusCode: res.statusCode, body: body }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

(async () => {
  try {
    // Generate ephemeral wallet
    const wallet = ethers.Wallet.createRandom();
    console.log('Using ephemeral wallet:', wallet.address);

    // 1) GET nonce
    const q = await httpGetJson(`/api/user/get_nonce?address=${wallet.address}`);
    console.log('GET nonce response:', q);
    if (!q || q.code !== 1) { console.error('Failed to get nonce'); process.exit(1); }
    const nonce = q.data;
    const message = `Login code: ${nonce}`;

    // 2) Sign message
    const signature = await wallet.signMessage(message);
    console.log('Signature:', signature);

    // 3) POST to getuserid
    const postRes = await httpPostJson('/api/user/getuserid', { address: wallet.address, signature, msg: message });
    console.log('POST /api/user/getuserid ->', postRes.statusCode, postRes.body);
  } catch (e) {
    console.error('Test error:', e && e.message ? e.message : e);
    process.exit(1);
  }
})();
