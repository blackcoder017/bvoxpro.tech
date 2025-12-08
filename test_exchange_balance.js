const http = require('http');

const testData = {
    user_id: '37282',
    from_coin: 'usdt',
    to_coin: 'btc',
    from_amount: 1000,
    to_amount: 0.01053,  // 1000 USDT ≈ 0.01053 BTC at ~95000 rate
    status: 'completed'
};

const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/api/exchange-record',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json'
    }
};

const req = http.request(options, (res) => {
    console.log(`STATUS: ${res.statusCode}`);
    let data = '';
    res.on('data', (chunk) => {
        data += chunk;
    });
    res.on('end', () => {
        console.log('RESPONSE:', data);
    });
});

req.on('error', (e) => {
    console.error(`problem with request: ${e.message}`);
});

console.log('Sending test exchange request...');
console.log('Test Data:', testData);
req.write(JSON.stringify(testData));
req.end();
