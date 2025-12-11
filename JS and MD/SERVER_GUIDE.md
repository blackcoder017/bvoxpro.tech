# 🚀 BVOX Finance Server Guide

## Quick Start

### Run the Main Server (Recommended)
```bash
npm start
# or
node server.js
```

The server will start on **http://localhost:3000**

---

## Server Files Overview

### 1. **server.js** ✅ (MAIN - Recommended)
- **Size**: 5122 lines
- **Features**: 
  - All features integrated (auth, trading, mining, arbitrage, wallet, KYC, etc.)
  - Direct HTTP server (no external dependencies needed beyond basic ones)
  - Fully tested and production-ready
  - Supports all admin APIs
  - Database integration for all features
  
**How to run:**
```bash
npm start
npm run server
node server.js
```

---

### 2. **app-server.js** (Alternative - Express-based)
- **Size**: 111 lines
- **Features**:
  - Express.js framework
  - Cleaner routing structure
  - Uses `/config/apiRoutes.js` for modular routes
  - Good for development with hot-reload (nodemon)

**How to run:**
```bash
npm run app
node app-server.js
```

---

### 3. **backend-server.js** (Legacy)
- **Size**: 1145 lines
- **Features**:
  - Standalone backend server
  - Can run on separate port (5000 by default)
  - Limited features compared to server.js

**How to run:**
```bash
npm run backend
node backend-server.js
```

---

## Recommended Setup

### ✅ For Production
```bash
npm start
# Runs: node server.js
# Port: 3000
```

### ✅ For Development (with auto-reload)
```bash
npm install -g nodemon  # Install once
npm run dev
# Runs: nodemon server.js
# Automatically restarts when files change
```

---

## Environment Setup

Make sure your `.env` file is configured:

```env
PORT=3000
MONGODB_URI=mongodb://localhost:27017/bvoxpro
NODE_ENV=development
```

---

## What NOT to Do ❌

**Don't run multiple servers at the same time:**
```bash
# ❌ DON'T DO THIS:
node server.js &
node app-server.js &
node backend-server.js &

# They will conflict on the same ports!
```

---

## Troubleshooting

### Port Already in Use
If port 3000 is already in use:
1. Change the port in `.env`: `PORT=3001`
2. Or kill the process using the port:
   ```bash
   # On Windows:
   netstat -ano | findstr :3000
   taskkill /PID <PID> /F
   ```

### Module Not Found
```bash
npm install
```

### Database Connection Error
Make sure MongoDB is running:
```bash
# Check MongoDB status or connection string in .env
```

---

## API Endpoints

Once the server is running, test with:

```bash
# Health check
curl http://localhost:3000/api/health

# List users
curl http://localhost:3000/api/users

# Admin APIs
curl http://localhost:3000/api/admin/contract/records
curl http://localhost:3000/api/admin/arbitrage/records
```

---

## Summary

| Command | Server | Port | Use Case |
|---------|--------|------|----------|
| `npm start` | server.js | 3000 | ✅ Production/Testing |
| `npm run dev` | server.js (nodemon) | 3000 | ✅ Development |
| `npm run app` | app-server.js | 3000 | Alternative |
| `npm run backend` | backend-server.js | 5000 | Legacy/Separate |

**👉 Use `npm start` for everything!**
