const http = require('http');
const querystring = require('querystring');

const postData = querystring.stringify({
  userid: '342020',
  username: 'user_342020',
  fangxiang: '1',
  miaoshu: '60',
  biming: 'doge',
  num: '1000',
  buyprice: '0.138663',
  zengjia: '0.13871799204095733',
  jianshao: '0.13864834935278064',
  yanzheng: 'test'
});

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/trade/buy',
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Content-Length': Buffer.byteLength(postData)
  }
};

const req = http.request(options, (res) => {
  console.log('STATUS:', res.statusCode);
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => {
    console.log('BODY:', body);
  });
});

req.on('error', (e) => { console.error('problem with request:', e.message); });
req.write(postData);
req.end();
