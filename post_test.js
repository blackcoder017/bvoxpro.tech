const http = require('http');

const data = JSON.stringify({
  address: '0x0fe540d4A96E378C9Fe68C5FaA8Fcf75803f03d6',
  signature: '0x00',
  msg: 'test'
});

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/user/getuserid',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  }
};

const req = http.request(options, (res) => {
  console.log('STATUS:', res.statusCode);
  let body = '';
  res.setEncoding('utf8');
  res.on('data', (chunk) => { body += chunk; });
  res.on('end', () => {
    console.log('BODY:', body);
  });
});

req.on('error', (e) => { console.error('problem with request:', e.message); });
req.write(data);
req.end();
