# ✅ BVOX Finance - MongoDB + app-server.js Setup

## Problem
- Previous: Using JSON files
- Now: **Want MongoDB database only** with `app-server.js`

---

## Prerequisites

### 1. MongoDB Must Be Running

**Check if MongoDB is running:**
```bash
# Windows
netstat -ano | findstr :27017
# If you see output, MongoDB is running

# Or try to connect
mongosh
# If it connects, you're good
```

**If MongoDB is NOT running, start it:**

**Option A: Windows (if installed locally)**
```bash
# Open CMD as Administrator
mongod
```

**Option B: MongoDB Atlas (Cloud - Recommended)**
1. Create account at https://www.mongodb.com/cloud/atlas
2. Create a cluster
3. Get connection string
4. Update `.env`:
```env
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/bvoxpro?retryWrites=true&w=majority
```

---

## Setup Steps

### Step 1: Update `.env` file

Make sure your `.env` has:
```env
MONGODB_URI=mongodb://127.0.0.1:27017/bvoxpro
PORT=3000
NODE_ENV=development
```

**For MongoDB Atlas (Cloud):**
```env
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/bvoxpro?retryWrites=true&w=majority
```

### Step 2: Install Dependencies

```bash
npm install
```

### Step 3: Start app-server.js

```bash
npm start
# or
node app-server.js
```

**Expected output:**
```
🚀 BVOX Finance Server Started
📡 Server running at http://localhost:3000
✅ Database: Connected
```

---

## Verify Everything Works

### 1. Check Health Endpoint
```bash
curl http://localhost:3000/api/health
```

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-12-10T...",
  "database": "connected"
}
```

### 2. List Users
```bash
curl http://localhost:3000/api/users?limit=10&skip=0
```

**Should return** an array of users (empty if no users yet)

### 3. Test Admin APIs
```bash
curl http://localhost:3000/api/admin/contract/records?page=1&limit=100
curl http://localhost:3000/api/admin/arbitrage/records?page=1&limit=100
```

---

## Troubleshooting

### Issue: "Cannot find module './database'"
**Solution:**
```bash
npm install
```

### Issue: "ECONNREFUSED" or "connect ETIMEDOUT"
**MongoDB is not running!**

```bash
# Check if MongoDB is running
mongosh

# If error, start MongoDB:
mongod  # Windows CMD as Administrator
```

### Issue: "404 Not Found" on /api/users
**Check:**
1. Is server running? `npm start`
2. Is MongoDB connected? Check console output
3. Try: `curl http://localhost:3000/api/health`

### Issue: Database connection timeout
**Try:**
1. Check MongoDB URI in `.env`
2. If using Atlas, check IP whitelist
3. Restart server: Press Ctrl+C, then `npm start`

---

## What Changed

### Before ❌
- Using multiple server files
- JSON files for data storage
- `/api/users` returns 404

### Now ✅
- Using **app-server.js ONLY**
- **MongoDB for all data**
- All APIs working with database

---

## API Endpoints (All Database-Driven)

```bash
# Users
GET    /api/users
GET    /api/users/:userId

# Trading/Contracts  
GET    /api/trade/:userId
POST   /api/trade
GET    /api/admin/contract/records

# Arbitrage
GET    /api/arbitrage/products
POST   /api/arbitrage/subscribe
GET    /api/admin/arbitrage/records

# Mining
GET    /api/mining/:userId
POST   /api/mining/submit

# Other
GET    /api/wallet/:userId
GET    /api/kyc/:userId
POST   /api/topup
POST   /api/withdrawal
GET    /api/health
```

All endpoints now read/write from MongoDB!

---

## Database Collections

After first use, MongoDB will have these collections:
- `users` - User accounts
- `trades` - Contract trades
- `arbitragesubscriptions` - Arbitrage subscriptions
- `topups` - Topup records
- `withdrawals` - Withdrawal records
- `mining` - Mining records
- `loans` - Loan records
- `wallets` - Wallet connections
- `kycs` - KYC records
- And more...

---

## Development vs Production

### Development (Local)
```bash
# Use local MongoDB
MONGODB_URI=mongodb://127.0.0.1:27017/bvoxpro
npm start
```

### Production (Cloud)
```bash
# Use MongoDB Atlas
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/bvoxpro?retryWrites=true&w=majority
npm start
```

---

## Seeding Initial Data

To add initial products/data:
```bash
node scripts/migrate-json-to-db.js
```

This will:
- Load products from `arbitrage_products.json`
- Store them in MongoDB
- No more JSON file dependencies

---

## Check Database Contents

### Using MongoDB CLI
```bash
mongosh

# Show databases
show dbs

# Use database
use bvoxpro

# Show collections
show collections

# View users
db.users.find().pretty()

# View arbitrage subscriptions
db.arbitragesubscriptions.find().pretty()
```

---

## Remember

✅ **DO THIS:**
```bash
npm start
# or
node app-server.js
```

❌ **DON'T DO:**
- Don't use `node server.js` (old server)
- Don't use JSON files manually
- Don't run multiple servers

---

## Quick Start Checklist

- [ ] MongoDB is running (check: mongosh)
- [ ] .env has MONGODB_URI set
- [ ] Run: `npm install`
- [ ] Run: `npm start`
- [ ] Check: `curl http://localhost:3000/api/health`
- [ ] Check: `curl http://localhost:3000/api/users`

If all pass ✅, you're ready!

---

**Status**: ✅ app-server.js is database-only ready!

Just ensure MongoDB is running and you're good to go.
