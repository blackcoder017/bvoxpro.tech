# 🔥 BVOX Finance - Start Server NOW

> Copy & paste any command below to start the server

---

## Option 1: PowerShell (Windows) ⭐ EASIEST
```powershell
.\start.ps1
```

---

## Option 2: Command Prompt (Windows)
```cmd
npm start
```

or

```cmd
start.bat
```

---

## Option 3: Any Terminal (Mac/Linux/Windows)
```bash
npm start
```

---

## Option 4: Direct Node Command
```bash
node server.js
```

---

## Option 5: With Auto-Reload (For Development)
First install nodemon globally (one time only):
```bash
npm install -g nodemon
```

Then use:
```bash
npm run dev
```

---

## After Starting Server

### 1. Check if Running
Open browser and visit:
```
http://localhost:3000
```

You should see the main application load.

### 2. Test API
```
http://localhost:3000/api/health
```

Should return:
```json
{"status":"ok","timestamp":"..."}
```

### 3. Access Admin Panel
```
http://localhost:3000/admin
```

---

## To Stop Server

Press these keys together:
```
Ctrl + C
```

The terminal will show:
```
^C
[Server stopped]
```

---

## If Server Won't Start

### Step 1: Install Dependencies
```bash
npm install
```

### Step 2: Try Again
```bash
npm start
```

### Step 3: If Still Fails
```bash
node server.js
```

This will show the actual error message.

---

## Expected Output

When server starts successfully, you'll see:

```
╔════════════════════════════════════════════╗
║     BVOX Finance Development Server        ║
╚════════════════════════════════════════════╝

🚀 Server running at: http://localhost:3000
📁 Root directory: C:\Users\black\Desktop\Project

Available features:
    ✓ Static file serving
    ✓ CORS enabled
    ✓ Hot reload compatible
    ✓ Development debugging

Open your browser at: http://localhost:3000
```

---

## Common Issues & Fixes

### Issue: Port 3000 is already in use
```bash
# Edit .env and change:
PORT=3001
```

Then start again.

### Issue: npm command not found
- Install Node.js from https://nodejs.org/
- Restart your terminal
- Try again

### Issue: Permission denied on start.ps1
```powershell
# In PowerShell, run once:
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# Then try:
.\start.ps1
```

### Issue: Module not found
```bash
npm install
npm start
```

---

## Browser Access URLs

| Page | URL |
|------|-----|
| Main Home | http://localhost:3000 |
| Admin Panel | http://localhost:3000/admin |
| Contract Trading | http://localhost:3000/contract.html |
| AI Arbitrage | http://localhost:3000/ai-arbitrage.html |
| Mining | http://localhost:3000/mining.html |
| KYC | http://localhost:3000/kyc1.html |
| Wallet | http://localhost:3000/wallet.html |
| API Health | http://localhost:3000/api/health |

---

## Admin API Testing

Test the new admin endpoints:

```bash
# Contract records
curl http://localhost:3000/api/admin/contract/records?page=1&limit=100

# Arbitrage records (NEW)
curl http://localhost:3000/api/admin/arbitrage/records?page=1&limit=100
```

---

## That's It!

Really, that's all you need to do.

**Just run:**
```bash
npm start
```

**Done!** 🎉

---

**Remember:** 
- You only need ONE command
- Server runs on port 3000
- All features included
- Database optional
- No configuration needed

---

**Happy coding!** 🚀
