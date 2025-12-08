# Trading System MVP

A complete prediction trading platform with real-time settlement. Users can predict coin price movements, place trades, and get settled with win/lose logic.

## Features

✅ **Market Grid** - Browse available coins with real-time prices
✅ **Prediction Trading** - Predict if price will go UP or DOWN
✅ **Real-time Settlement** - Trades automatically settle after duration
✅ **Win/Lose Logic** - Deterministic price comparison for outcomes
✅ **Wallet Management** - Instant balance updates
✅ **Trade History** - Full trade history with results and payouts
✅ **MongoDB Storage** - All trades and wallets persisted

## Tech Stack

- **Backend**: Node.js + Express.js
- **Database**: MongoDB + Mongoose
- **Frontend**: Vanilla HTML/CSS/JavaScript (AJAX)

## Installation

### Prerequisites

- Node.js 14+ (https://nodejs.org)
- MongoDB 4.4+ (https://www.mongodb.com/try/download/community)

### Setup

1. **Install dependencies**
   ```bash
   cd trading-system
   npm install
   ```

2. **Start MongoDB** (if not already running)
   ```bash
   mongod
   ```

3. **Start the server**
   ```bash
   npm start
   ```

4. **Open in browser**
   ```
   http://localhost:3001
   ```

### Default Test User

- **Email**: test@example.com
- **Starting Balance**: $5,000
- **API Token**: `test-token`

## How It Works

### User Flow

```
1. User clicks a coin
   ↓
2. Opens trade modal with options
   ↓
3. Selects: Direction (UP/DOWN), Duration, Stake Amount
   ↓
4. Clicks "Place Trade"
   ↓
5. Backend deducts stake from wallet immediately
   ↓
6. Creates trade record with status "open"
   ↓
7. Schedules settlement after duration seconds
   ↓
8. At settlement time:
   - Fetches current price
   - Compares with entry price
   - Determines WIN or LOSE
   - Credits payout to wallet if WIN
   ↓
9. Trade status updates to "settled"
   ↓
10. User sees result and updated balance
```

### Settlement Logic

**WIN Conditions**:
- Predicted UP: `exitPrice > entryPrice`
- Predicted DOWN: `exitPrice < entryPrice`

**Payout Formula**:
- On WIN: `payout = stake × (1 + odds)` → credited to wallet
- On LOSE: No payout (stake already deducted)
- On TIE: Refund original stake

**Example**:
- Stake: $100
- Odds: 0.9 (90%)
- Profit on WIN: $100 × 0.9 = $90
- Total credited: $100 + $90 = $190

## API Reference

### Authentication

All endpoints require:
```
Authorization: Bearer test-token
Content-Type: application/json
```

### Key Endpoints

**GET /api/coins** - Get all coins
**GET /api/coins/:symbol/price** - Get coin price
**POST /api/trades** - Create new trade
**GET /api/trades/:id** - Get trade status
**GET /api/trades** - Get user trades
**GET /api/user/wallet** - Get wallet balance
**POST /api/user/wallet/add-balance** - Add balance (testing)

See documentation files for full API reference.

## Database Models

- **Users** - User accounts and auth
- **Wallets** - Balance and currency per user
- **Coins** - Available coins with current prices
- **Trades** - All trades with entry/exit prices and results
- **Transactions** - Transaction log for audit trail

## Quick Test

1. Open http://localhost:3001
2. Click BTC coin
3. Enter: UP direction, 60 second duration, $50 stake
4. Click "Place Trade"
5. Balance drops to $4,950
6. Wait 60 seconds
7. Trade settles with WIN/LOSE result
8. Balance updates with payout if won

## File Structure

```
trading-system/
├── server.js                 # Express server and setup
├── models.js                 # Mongoose schemas
├── routes.js                 # API endpoints
├── priceService.js           # Price management
├── settlementEngine.js       # Win/lose logic
├── package.json              # Dependencies
├── public/
│   └── index.html            # Frontend UI
└── README.md                 # This file
```

## Environment Variables

```bash
PORT=3001                    # Server port (default: 3001)
MONGO_URI=mongodb://localhost:27017/trading-system  # MongoDB connection
```

## Troubleshooting

**MongoDB connection error?**
- Start MongoDB: `mongod`
- Or use MongoDB Atlas: set `MONGO_URI=mongodb+srv://...`

**Port 3001 already in use?**
- Change port: `set PORT=3002 && npm start`

**Trades not settling?**
- Check server logs for errors
- Manually settle: POST `/api/trades/:id/settle`

## Production Checklist

- [ ] Use JWT authentication instead of hardcoded token
- [ ] Hash passwords with bcrypt
- [ ] Enable HTTPS
- [ ] Add rate limiting
- [ ] Use MongoDB transactions
- [ ] Add input validation
- [ ] Implement CORS properly
- [ ] Add audit logging
- [ ] Set up monitoring and alerts
- [ ] Use job queue for settlements

## License

MIT
