const http = require('http');

// Test the /api/Record/getcontract endpoint
const postData = 'userid=37282&page=1';

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/Record/getcontract',
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Content-Length': Buffer.byteLength(postData)
  }
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    try {
      const response = JSON.parse(data);
      console.log('API Response Code:', response.code);
      console.log('Number of records:', response.data.length);
      console.log('\nFirst 3 records:');
      response.data.slice(0, 3).forEach((record, i) => {
        console.log(`\nRecord ${i + 1}:`);
        console.log(`  BTC, Amount: ${record.num}, Payout (ying): ${record.ying}`);
        console.log(`  Status (zhuangtai): ${record.zhuangtai}, Win/Loss (zuizhong): ${record.zuizhong}`);
        console.log(`  Expected: Loss status should have negative ying value`);
        console.log(`  Actual ying value: ${record.ying}`);
        if (record.ying < 0) {
          console.log(`  ✓ CORRECT: Negative value for loss`);
        } else {
          console.log(`  ✗ WRONG: Should be negative for loss`);
        }
      });
    } catch (e) {
      console.error('Error parsing response:', e.message);
      console.log('Raw response:', data);
    }
    process.exit(0);
  });
});

req.on('error', (e) => {
  console.error(`Problem with request: ${e.message}`);
  process.exit(1);
});

req.write(postData);
req.end();
