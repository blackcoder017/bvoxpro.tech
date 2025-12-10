# 🎯 BVOX Finance - Database-Only Mode with app-server.js

**Status**: ✅ Configured for MongoDB-only operation

---

## Quick Start

### 1. Ensure MongoDB is Running

**Check MongoDB:**
```bash
mongosh
# If it connects, you're good
```

**If MongoDB is not running:**
- **Windows**: Open CMD as Admin and run `mongod`
- **Mac**: `brew services start mongodb-community`
- **Linux**: `sudo systemctl start mongod`

### 2. Start the Server

```bash
npm start
```

**Expected output:**
```
🚀 BVOX Finance Server Started
📡 Server running at http://localhost:3000
✅ Database: Connected
```

### 3. Test It Works

```bash
curl http://localhost:3000/api/health
```

---

## What Changed

✅ **package.json updated:**
- `npm start` now runs `app-server.js` (MongoDB database-driven)
- `npm run app:dev` runs with auto-reload

✅ **app-server.js improved:**
- Properly connects to MongoDB before starting
- All APIs use database
- No JSON file fallback

✅ **All APIs are database-driven:**
- `/api/users` ← Uses MongoDB
- `/api/trades` ← Uses MongoDB  
- `/api/arbitrage/records` ← Uses MongoDB
- Everything stores/reads from MongoDB

---

## Accessing Your App

| URL | Purpose |
|-----|---------|
| `http://localhost:3000` | Main application |
| `http://localhost:3000/admin` | Admin panel |
| `http://localhost:3000/api/health` | Check database status |
| `http://localhost:3000/api/users` | Get users from MongoDB |

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Cannot connect to MongoDB" | Start MongoDB: `mongod` |
| "/api/users returns 404" | Check if server started properly |
| "timeout on connect" | MongoDB not running or wrong URI in .env |

---

## Configuration

Your `.env` is already set:
```env
MONGODB_URI=mongodb://127.0.0.1:27017/bvoxpro
PORT=3000
NODE_ENV=development
```

To use cloud MongoDB (Atlas):
```env
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/bvoxpro
```

---

## Available Scripts

```bash
npm start              # Run app-server.js (production)
npm run dev            # Run with auto-reload (development)
npm run app            # Same as start
npm run app:dev        # Same as dev with nodemon
npm run server         # Run old server.js (if needed)
npm run diagnose       # Check MongoDB connection
npm run migrate        # Load initial data from JSON to MongoDB
```

---

## All APIs Are Now Database-Driven

No more JSON files! Everything uses MongoDB:

```
Users          → MongoDB users collection
Trading        → MongoDB trades collection
Mining         → MongoDB mining collection
Arbitrage      → MongoDB arbitragesubscriptions collection
Topups         → MongoDB topups collection
Withdrawals    → MongoDB withdrawals collection
Loans          → MongoDB loans collection
KYC            → MongoDB kycs collection
Wallets        → MongoDB wallets collection
```

---

## Remember

✅ **Use this:**
```bash
npm start
# or
node app-server.js
```

❌ **Don't use:**
- `node server.js` (old - doesn't use database properly)
- JSON files (use database instead)
- Multiple servers at once

---

## Next Steps

1. Start MongoDB: `mongod`
2. Run server: `npm start`
3. Open browser: `http://localhost:3000`
4. Check admin: `http://localhost:3000/admin`
5. Read more: `MONGODB_SETUP.md`

**That's it!** Everything is database-driven now. 🚀
