# Hybrid API Configuration - Updated

## Architecture

The system now uses a **hybrid approach**:

### 🌍 External API (Price Data)
- **Purpose**: Get real-time market data
- **Endpoints**: 
  - `/api/Trade/gettradlist` → proxies to `https://api.bvoxf.com/api/Trade/gettradlist`
  - `/api/Trade/getcoin_data` → proxies to `https://api.bvoxf.com/api/Trade/getcoin_data`
- **Why**: Live price data is critical for accurate trading
- **Transparent**: Client points to localhost, server handles proxy to external API

### 💾 Local API (Trade Operations)
- **Purpose**: Create and manage trades locally
- **Endpoints**:
  - `POST /api/trade/buy` - Create trade order (local storage)
  - `POST /api/trade/getorder` - Check order status (local)
  - `POST /api/trade/setordersy` - Update order result (local)
  - `POST /api/trade/getorderjs` - Get profit calculation (local)
- **Storage**: `trades_records.json`
- **Benefits**: No external dependency, fast, reliable

## Data Flow

```
Browser (contract.html)
    ↓
/api/...
    ├── /Trade/gettradlist → [PROXY] → https://api.bvoxf.com/api/Trade/gettradlist
    ├── /Trade/getcoin_data → [PROXY] → https://api.bvoxf.com/api/Trade/getcoin_data
    ├── /trade/buy → [LOCAL] → trades_records.json
    ├── /trade/getorder → [LOCAL] → trades_records.json
    ├── /trade/setordersy → [LOCAL] → trades_records.json
    └── /trade/getorderjs → [LOCAL] → trades_records.json
```

## Configuration

All `config.js.download` files point to:
```javascript
const apiurl = window.location.origin + '/api';
```

This works seamlessly because:
1. Price/trade list calls are automatically proxied to external API
2. Trade operations use local storage
3. No client-side code changes needed

## Files Modified

### server.js
- Added 6 trade API endpoints
- 2 endpoints with HTTPS proxy to external API
- 4 endpoints with local JSON storage

### config.js.download (27 files)
- Updated to use `/api` (already done)

### trades_records.json
- Auto-created on first trade
- Stores all local trade data

## Testing

### Test Price Data (External API)
```powershell
$body = @{ coinname = "btc" } | ConvertTo-Json
Invoke-WebRequest -Uri "/api/Trade/getcoin_data" `
  -Method POST -Body $body -ContentType "application/json"
```

### Test Trade Creation (Local API)
```powershell
$body = @{
    userid = "user123"
    username = "testuser"
    fangxiang = "1"
    miaoshu = "60"
    biming = "btc"
    num = "100"
    buyprice = "90900.36"
    zengjia = "90920"
    jianshao = "90880"
} | ConvertTo-Json

Invoke-WebRequest -Uri "/api/trade/buy" `
  -Method POST -Body $body -ContentType "application/json"
```

## Server Status

✅ Running on `http://localhost:3000`
✅ CORS enabled for browser requests
✅ Hybrid API working (proxy + local)
✅ Trade records saved to `trades_records.json`

## Next Steps

1. Test contract page: `http://localhost:3000/contract.html?market=btc`
2. Place a trade order
3. Check that:
   - Prices update from external API (real-time)
   - Trade saved to local `trades_records.json`
   - Status tracking works locally

## Advantages

✅ **Real-time Prices** - Use live market data from external API
✅ **Local Trades** - All trade data saved locally
✅ **No Breaking Changes** - Client code stays the same
✅ **Flexible** - Easy to switch data sources
✅ **Fast** - Local operations are instant
✅ **Transparent** - Client sees only localhost URL

