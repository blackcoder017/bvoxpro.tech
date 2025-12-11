# ⚡ BVOX Finance - Quick Start Guide

## 🚀 Start the Server (Pick ONE)

### Option 1: Windows PowerShell (Recommended)
```powershell
.\start.ps1
```

### Option 2: Windows Command Prompt
```cmd
start.bat
```
or
```cmd
npm start
```

### Option 3: Any Terminal
```bash
npm start
```

---

## ✅ Verification

After starting, you should see:
```
╔════════════════════════════════════════════╗
║     BVOX Finance Development Server        ║
╚════════════════════════════════════════════╝

🚀 Server running at: http://localhost:3000
```

Then visit: **http://localhost:3000**

---

## 🛑 Stop the Server

Press: **Ctrl + C** in the terminal

---

## 📊 Server Status

Check if server is running:
```bash
curl http://localhost:3000/api/health
```

---

## 🔧 Available Commands

| Command | Purpose |
|---------|---------|
| `npm start` | Run main server |
| `npm run dev` | Run with auto-reload (requires nodemon) |
| `npm run app` | Run alternative Express server |
| `npm run backend` | Run legacy backend server |
| `npm run setup` | Initialize configuration |

---

## ⚠️ Important Notes

❌ **DON'T run multiple servers at the same time**
- They will conflict and cause errors
- Only one server should run on port 3000

✅ **DO use server.js**
- It has all features integrated
- It's fully tested and production-ready
- All admin APIs work with it

---

## 🌐 Access Points

Once server is running:

- **Main App**: http://localhost:3000
- **Admin Panel**: http://localhost:3000/admin
- **API Health**: http://localhost:3000/api/health

---

## 💾 Database Configuration

Make sure `.env` file exists with:
```env
PORT=3000
MONGODB_URI=mongodb://localhost:27017/bvoxpro
```

If database is not running, the app will still work with JSON files.

---

## ❓ Troubleshooting

### Port 3000 is already in use
```bash
# Change port in .env:
PORT=3001
```

### Module not found error
```bash
npm install
```

### Server won't start
1. Check if Node.js is installed: `node --version`
2. Check dependencies: `npm install`
3. Check .env file exists
4. Check port 3000 is free

---

## 🎯 Summary

**From now on, use ONLY `npm start` or `.\start.ps1`**

All features work from this one server:
- ✓ Trading contracts
- ✓ Mining
- ✓ Arbitrage
- ✓ User authentication
- ✓ Admin panel
- ✓ API endpoints
- ✓ Database integration

**That's it! You're ready to go!** 🚀
