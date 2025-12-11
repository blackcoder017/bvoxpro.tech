# 🔥 BVOX Finance - Step-by-Step Database Setup

> **Everything is configured. Just follow these steps.**

---

## Step 1: Start MongoDB

### Windows
```bash
# Open CMD or PowerShell as Administrator
mongod
```

Wait for message:
```
[initandlisten] waiting for connections on port 27017
```

### Mac
```bash
brew services start mongodb-community
```

### Linux
```bash
sudo systemctl start mongod
```

### Cloud (MongoDB Atlas)
1. Go to https://www.mongodb.com/cloud/atlas
2. Create free cluster
3. Get connection string
4. Update `.env` file with connection string

---

## Step 2: Verify MongoDB Connection

Open new terminal/CMD window:

```bash
mongosh
```

If you see:
```
mongodb [direct: primary] test>
```

✅ MongoDB is running!

Type `exit` to close.

---

## Step 3: Start BVOX Server

In your project directory:

```bash
npm start
```

**Expected output:**
```
🚀 BVOX Finance Server Started
📡 Server running at http://localhost:3000
📊 API Documentation: http://localhost:3000/api/health

✅ Database: Connected

📝 Available Endpoints:
   GET    /api/users/:userId
   GET    /api/topup/:userId
   POST   /api/topup
   GET    /api/withdrawal/:userId
   ...
```

---

## Step 4: Verify Everything Works

### Open new terminal/CMD:

**Test 1: Health Check**
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

**Test 2: Get Users**
```bash
curl http://localhost:3000/api/users?limit=10&skip=0
```

**Response:**
```json
[]
```
(Empty array if no users, but API works!)

**Test 3: Admin API**
```bash
curl http://localhost:3000/api/admin/arbitrage/records?page=1&limit=100
```

**Response:**
```json
{
  "code": 1,
  "data": [],
  "pagination": {...}
}
```

---

## Step 5: Access Your Application

Open browser and visit:

```
http://localhost:3000
```

You should see the BVOX Finance app!

**Admin Panel:**
```
http://localhost:3000/admin
```

---

## Troubleshooting

### "Cannot connect to MongoDB"

**Check if MongoDB is running:**
```bash
mongosh
```

If you get error, MongoDB is not running. Start it:
```bash
# Windows CMD as Admin:
mongod

# Mac:
brew services start mongodb-community

# Linux:
sudo systemctl start mongod
```

### "404 Not Found" on /api/users

**Check:**
1. Is server running? Look for "Database: Connected" message
2. Is MongoDB running? Try `mongosh`
3. Restart server: Press Ctrl+C, then `npm start`

### "Connection refused" error

**MongoDB not running!** Start it:
```bash
mongod  # Windows
brew services start mongodb-community  # Mac
sudo systemctl start mongod  # Linux
```

### "timeout" error

Check your `.env`:
```env
MONGODB_URI=mongodb://127.0.0.1:27017/bvoxpro
```

If using MongoDB Atlas, make sure connection string is correct.

---

## What's Running Now

```
┌──────────────────────────────────────┐
│   app-server.js (Express Server)     │
│   Port: 3000                         │
├──────────────────────────────────────┤
│   Connected to MongoDB               │
│   All APIs use database              │
│   No JSON files                      │
└──────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────┐
│   MongoDB (bvoxpro database)         │
│                                      │
│  Collections:                        │
│  • users                             │
│  • trades                            │
│  • arbitragesubscriptions            │
│  • mining                            │
│  • topups                            │
│  • withdrawals                       │
│  • loans                             │
│  • kycs                              │
│  • wallets                           │
│  • ... and more                      │
└──────────────────────────────────────┘
```

---

## Commands Cheat Sheet

```bash
# Start MongoDB (Windows as Admin)
mongod

# Connect to MongoDB
mongosh

# Start server
npm start

# Stop server
Ctrl+C

# Run with auto-reload
npm run dev

# Test API
curl http://localhost:3000/api/health

# Check logs
# (visible in terminal where you ran npm start)
```

---

## After Everything Works

### Seed Initial Data (Optional)

To add initial arbitrage products:

```bash
npm run migrate
```

This loads products from JSON into MongoDB.

### Check Database Contents

```bash
mongosh

# Use BVOX database
use bvoxpro

# See all users
db.users.find()

# See all arbitrage subscriptions
db.arbitragesubscriptions.find()

# Exit
exit
```

---

## Remember

✅ **This is the right way:**
```bash
# Terminal 1: Start MongoDB
mongod

# Terminal 2: Start server
npm start

# Terminal 3: Test APIs
curl http://localhost:3000/api/health
```

❌ **Don't do this:**
- Don't run `node server.js` (use npm start)
- Don't use JSON files manually (use database)
- Don't skip MongoDB setup (it must be running)

---

## Success Checklist

- [ ] MongoDB is running (mongosh works)
- [ ] Server started with `npm start`
- [ ] Can access http://localhost:3000
- [ ] `/api/health` returns status: "ok"
- [ ] `/api/users` returns JSON array
- [ ] Admin panel at http://localhost:3000/admin works

If all ✅, you're done!

---

## Need Help?

**Quick fixes:**
1. Check MongoDB: `mongosh`
2. Restart server: Ctrl+C, then `npm start`
3. Clear console: Read latest error message
4. Check `.env`: Correct MONGODB_URI?

**Read documentation:**
- `DATABASE_ONLY.md` - Quick overview
- `MONGODB_SETUP.md` - Detailed setup
- `ARCHITECTURE.md` - How it works

---

## That's It!

You now have a fully database-driven BVOX Finance application using app-server.js and MongoDB.

**Just remember:**
```bash
mongod        # Start MongoDB
npm start     # Start server
```

**Enjoy!** 🚀
