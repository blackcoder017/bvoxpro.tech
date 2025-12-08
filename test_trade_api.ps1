# Test Trade API Endpoints

Write-Host "Testing Trade API Endpoints..." -ForegroundColor Cyan

# Test 1: POST /api/trade/buy
Write-Host "`n1. Testing POST /api/trade/buy" -ForegroundColor Yellow

$body = @{
    userid = "12345"
    username = "testuser"
    fangxiang = "1"
    miaoshu = "60"
    biming = "btc"
    num = "100"
    buyprice = "90900.36"
    zengjia = "90920"
    jianshao = "90880"
} | ConvertTo-Json

try {
    $response = Invoke-WebRequest -Uri "http://localhost:3001/api/trade/buy" `
        -Method POST `
        -Body $body `
        -ContentType "application/json" `
        -ErrorAction Stop
    
    Write-Host "✓ Success: Status Code $($response.StatusCode)" -ForegroundColor Green
    $responseData = $response.Content | ConvertFrom-Json
    Write-Host "Response: $($responseData | ConvertTo-Json)" -ForegroundColor Green
    $tradeId = $responseData.data
} catch {
    Write-Host "✗ Error: $_" -ForegroundColor Red
    exit
}

# Test 2: POST /api/Trade/gettradlist
Write-Host "`n2. Testing POST /api/Trade/gettradlist" -ForegroundColor Yellow

$body2 = @{
    coinname = "btc"
} | ConvertTo-Json

try {
    $response2 = Invoke-WebRequest -Uri "http://localhost:3001/api/Trade/gettradlist" `
        -Method POST `
        -Body $body2 `
        -ContentType "application/json" `
        -ErrorAction Stop
    
    Write-Host "✓ Success: Status Code $($response2.StatusCode)" -ForegroundColor Green
    $responseData2 = $response2.Content | ConvertFrom-Json
    Write-Host "Trade count: $($responseData2.data.Count)" -ForegroundColor Green
} catch {
    Write-Host "✗ Error: $_" -ForegroundColor Red
}

# Test 3: POST /api/Trade/getcoin_data
Write-Host "`n3. Testing POST /api/Trade/getcoin_data" -ForegroundColor Yellow

try {
    $response3 = Invoke-WebRequest -Uri "http://localhost:3001/api/Trade/getcoin_data" `
        -Method POST `
        -Body $body2 `
        -ContentType "application/json" `
        -ErrorAction Stop
    
    Write-Host "✓ Success: Status Code $($response3.StatusCode)" -ForegroundColor Green
    $responseData3 = $response3.Content | ConvertFrom-Json
    Write-Host "Coin data: $($responseData3.data | ConvertTo-Json)" -ForegroundColor Green
} catch {
    Write-Host "✗ Error: $_" -ForegroundColor Red
}

# Test 4: POST /api/trade/getorder
Write-Host "`n4. Testing POST /api/trade/getorder" -ForegroundColor Yellow

$body4 = @{
    id = $tradeId
} | ConvertTo-Json

try {
    $response4 = Invoke-WebRequest -Uri "http://localhost:3001/api/trade/getorder" `
        -Method POST `
        -Body $body4 `
        -ContentType "application/json" `
        -ErrorAction Stop
    
    Write-Host "✓ Success: Status Code $($response4.StatusCode)" -ForegroundColor Green
    $responseData4 = $response4.Content | ConvertFrom-Json
    Write-Host "Order status: $($responseData4.data)" -ForegroundColor Green
} catch {
    Write-Host "✗ Error: $_" -ForegroundColor Red
}

# Test 5: Check trades_records.json file
Write-Host "`n5. Checking trades_records.json file" -ForegroundColor Yellow

$tradesFile = "c:\Users\Black Coder\Downloads\bvoxfversion2-main\trades_records.json"
if (Test-Path $tradesFile) {
    $trades = Get-Content $tradesFile | ConvertFrom-Json
    Write-Host "✓ File exists with $($trades.Count) records" -ForegroundColor Green
    Write-Host "Latest trade: $(($trades | Select-Object -Last 1) | ConvertTo-Json)" -ForegroundColor Green
} else {
    Write-Host "⚠ File not created yet" -ForegroundColor Yellow
}

Write-Host "`n✓ All tests completed!" -ForegroundColor Cyan
