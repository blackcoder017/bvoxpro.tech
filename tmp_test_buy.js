const http = require('http');
const querystring = require('querystring');
const postData = querystring.stringify({
  userid: 'tester1',
  username: 'tester1',
  fangxiang: 1,
  miaoshu: 60,
  biming: 'btc',
  num: 2,
  buyprice: 40000,
  zengjia: 40100,
  jianshao: 39900
});

const options = {
  hostname: 'localhost',
  port: 3001,
  path: '/api/trade/buy',
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Content-Length': Buffer.byteLength(postData)
  }
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => { console.log('Response:', res.statusCode, data); });
});

req.on('error', (e) => { console.error('Request error:', e.message); });
req.write(postData);
req.end();
