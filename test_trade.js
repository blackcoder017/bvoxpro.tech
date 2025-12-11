const http = require('http');

const data = JSON.stringify({
  userid: '342016',
  username: 'testuser',
  fangxiang: '1',
  miaoshu: '60',
  biming: 'btc',
  num: '100',
  buyprice: '90900.36',
  syl: '40',
  zengjia: '91000',
  jianshao: '90800'
});

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/trade/buy',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const req = http.request(options, (res) => {
  let responseData = '';
  res.on('data', (chunk) => {
    responseData += chunk;
  });
  res.on('end', () => {
    console.log('Response:', responseData);
    process.exit(0);
  });
});

req.on('error', (e) => {
  console.error('Error:', e.message);
  process.exit(1);
});

req.write(data);
req.end();
