# BVOX Finance - Database Integration Guide

## Overview

This project has been successfully migrated from JSON file storage to MongoDB. All pages and features are now connected to a robust database backend with a comprehensive REST API.

## 📦 What's New

### New Files Created

1. **Database Models** (`/models/`)
   - `User.js` - User data schema
   - `Admin.js` - Admin accounts
   - `Topup.js` - Deposit records
   - `Withdrawal.js` - Withdrawal records
   - `ExchangeRecord.js` - Coin exchange transactions
   - `Trade.js` - Trading records
   - `Mining.js` - Mining operations
   - `Loan.js` - Loan records
   - `Wallet.js` - User wallets
   - `KYC.js` - Identity verification
   - `ArbitrageProduct.js` - AI arbitrage products
   - `ArbitrageSubscription.js` - Arbitrage subscriptions
   - `Notification.js` - User notifications
   - `Session.js` - User sessions
   - `Nonce.js` - Wallet signature nonces

2. **Configuration Files** (`/config/`)
   - `db.js` - MongoDB connection setup
   - `database.js` - Database utility functions
   - `apiRoutes.js` - Express API endpoints

3. **Server**
   - `app-server.js` - Express.js server with API routes
   - `js/api-client.js` - Frontend JavaScript client library

4. **Migration & Documentation**
   - `scripts/migrate-json-to-db.js` - Data migration script
   - `database-integration.html` - Testing & integration examples
   - `DATABASE_SETUP.md` - This guide

## 🚀 Getting Started

### Prerequisites

- Node.js >= 14.0.0
- MongoDB (local or cloud like MongoDB Atlas)
- npm >= 6.0.0

### Step 1: Install Dependencies

```bash
npm install
```

This installs:
- express - Web server
- mongoose - MongoDB ORM
- cors - Cross-origin requests
- dotenv - Environment variables
- Other required packages

### Step 2: Set Up Environment Variables

Create a `.env` file in the root directory:

```env
# MongoDB Connection
MONGODB_URI=mongodb://localhost:27017/bvoxpro
# OR for MongoDB Atlas:
#  MONGODB_URI=mongodb+srv://blackcoder:Mka%402016@cluster.mongodb.net/bvoxpro?retryWrites=true&w=majority


# Server
PORT=3000
NODE_ENV=development
```

### Step 3: Migrate JSON Data to Database (First Time Only)

Run the migration script to import your existing JSON data:

```bash
node scripts/migrate-json-to-db.js
```

Output example:
```
📦 Connecting to MongoDB...
✅ Connected to MongoDB

📥 Starting migration process...

🔄 Migrating users...
✅ Migrated 48 users
🔄 Migrating admins...
✅ Migrated 2 admins
🔄 Migrating topup records...
✅ Migrated 150 topup records
...
✅ Migration completed successfully!
```

### Step 4: Start the Server

```bash
node app-server.js
```

The server will start and display:
```
🚀 BVOX Finance Server Started
📡 Server running at http://localhost:5000
✅ Database: Connected
```

### Step 5: Test the Integration

Open your browser and visit:
```
http://localhost:3000/database-integration.html
```

This page provides interactive testing for all API endpoints.

## 📡 API Documentation

### User Endpoints

```javascript
// Get user by ID
GET /api/users/:userId
Response: { userid, username, email, balance, balances, ... }

// Get all users (paginated)
GET /api/users?limit=100&skip=0
Response: [{ user1 }, { user2 }, ...]

// Update user balance
PUT /api/users/:userId/balance
Body: { balance: 1500 }

// Update user balances (multiple currencies)
PUT /api/users/:userId/balances
Body: { balances: { usdt: 1000, btc: 0.5, ... } }
```

### Topup Endpoints

```javascript
// Create topup record
POST /api/topup
Body: { user_id, coin, address, amount, photo_url }

// Get user's topup records
GET /api/topup/:userId?limit=50

// Update topup status
PUT /api/topup/:topupId/status
Body: { status: "pending|complete|rejected" }
```

### Withdrawal Endpoints

```javascript
// Create withdrawal
POST /api/withdrawal
Body: { user_id, coin, address, amount }

// Get withdrawal records
GET /api/withdrawal/:userId?limit=50

// Update withdrawal status
PUT /api/withdrawal/:withdrawalId/status
Body: { status: "pending|complete|failed", txhash: "0x..." }
```

### Trading Endpoints

```javascript
// Create trade
POST /api/trade
Body: { user_id, pair, type, entry_price, amount, leverage }

// Get user trades
GET /api/trade/:userId?limit=50&status=open

// Close trade
PUT /api/trade/:tradeId/close
Body: { exit_price, pnl }
```

### Mining Endpoints

```javascript
// Start mining
POST /api/mining
Body: { user_id, package_id, amount, daily_reward }

// Get mining records
GET /api/mining/:userId

// Claim mining rewards
PUT /api/mining/:miningId/claim
Body: { earned, total_earned }
```

### Loan Endpoints

```javascript
// Create loan
POST /api/loan
Body: { user_id, amount, interest_rate, duration_days, total_repay }

// Get loans
GET /api/loan/:userId
```

### Wallet Endpoints

```javascript
// Add wallet
POST /api/wallet
Body: { user_id, address, chain, balance, balances, is_primary }

// Get user wallets
GET /api/wallet/:userId

// Get wallet by address
GET /api/wallet/address/:address
```

### KYC Endpoints

```javascript
// Submit KYC
POST /api/kyc
Body: { user_id, full_name, date_of_birth, document_type, ... }

// Get KYC status
GET /api/kyc/:userId

// Verify KYC
PUT /api/kyc/:userId/verify
Body: { status: "verified|rejected", rejectionReason: "..." }
```

### Arbitrage Endpoints

```javascript
// Get products
GET /api/arbitrage/products?limit=20

// Subscribe to arbitrage
POST /api/arbitrage/subscribe
Body: { user_id, product_id, amount, daily_return, total_return }

// Get subscriptions
GET /api/arbitrage/:userId

// Claim payout
PUT /api/arbitrage/:subscriptionId/payout
Body: { earned }
```

### Notification Endpoints

```javascript
// Create notification
POST /api/notification
Body: { user_id, title, message, type, link }

// Get notifications
GET /api/notification/:userId?limit=20

// Mark as read
PUT /api/notification/:notificationId/read
```

## 💻 Frontend Integration

### 1. Include API Client in HTML

```html
<!DOCTYPE html>
<html>
<head>
    <script src="/js/api-client.js"></script>
</head>
<body>
    <script>
        // API is now available globally
        const user = await API.users.getById('userId123');
    </script>
</body>
</html>
```

### 2. Using API Functions

```javascript
// Get user
const user = await API.users.getById('123');
console.log(user.balance);

// Update balance
await API.users.updateBalance('123', 5000);

// Create topup
const topup = await API.topup.create({
    user_id: '123',
    coin: 'BTC',
    address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
    amount: 0.5,
    photo_url: '/uploads/proof.png'
});

// Get topup records
const records = await API.topup.getRecords('123');

// Update topup status
await API.topup.updateStatus(topup.id, 'complete');

// Create trade
const trade = await API.trade.create({
    user_id: '123',
    pair: 'BTC/USDT',
    type: 'long',
    entry_price: 45000,
    amount: 0.1,
    leverage: 2
});

// Get mining records
const mining = await API.mining.getRecords('123');

// Claim mining rewards
await API.mining.claimRewards(miningId, earnedAmount, totalEarned);

// Create wallet
await API.wallet.create({
    user_id: '123',
    address: '0x742d35Cc6634C0532925a3b844Bc9e7595f42bE',
    chain: 'ethereum'
});

// Get user wallets
const wallets = await API.wallet.getByUserId('123');

// Submit KYC
await API.kyc.submit({
    user_id: '123',
    full_name: 'John Doe',
    date_of_birth: '1990-01-15',
    nationality: 'US',
    document_type: 'passport',
    document_number: 'AB12345678',
    document_image_url: '/uploads/passport.jpg',
    selfie_url: '/uploads/selfie.jpg'
});

// Subscribe to arbitrage
const sub = await API.arbitrage.subscribe({
    user_id: '123',
    product_id: 'prod_1',
    amount: 1000,
    daily_return: 1.5,
    total_return: 45
});

// Send notification
await API.notification.create({
    user_id: '123',
    title: 'Payment Received',
    message: 'Your topup has been approved',
    type: 'success'
});
```

## 🔍 API Client Methods

All available methods in `API` object:

```javascript
API.users.getById(userId)
API.users.getAll(limit, skip)
API.users.updateBalance(userId, balance)
API.users.updateBalances(userId, balances)

API.topup.create(data)
API.topup.getRecords(userId, limit)
API.topup.updateStatus(topupId, status)

API.withdrawal.create(data)
API.withdrawal.getRecords(userId, limit)
API.withdrawal.updateStatus(withdrawalId, status, txhash)

API.exchange.create(data)
API.exchange.getRecords(userId, limit)

API.trade.create(data)
API.trade.getRecords(userId, limit, status)
API.trade.close(tradeId, exitPrice, pnl)

API.mining.create(data)
API.mining.getRecords(userId)
API.mining.claimRewards(miningId, earned, totalEarned)

API.loan.create(data)
API.loan.getRecords(userId)

API.wallet.create(data)
API.wallet.getByUserId(userId)
API.wallet.getByAddress(address)

API.kyc.submit(data)
API.kyc.getStatus(userId)
API.kyc.verify(userId, status, rejectionReason)

API.arbitrage.getProducts(limit)
API.arbitrage.subscribe(data)
API.arbitrage.getSubscriptions(userId)
API.arbitrage.claimPayout(subscriptionId, earned)

API.notification.create(data)
API.notification.get(userId, limit)
API.notification.markAsRead(notificationId)
```

## 🗄️ Database Schema

### User
- `userid` - Unique user ID
- `username` - Username
- `email` - Email address
- `password` - Hashed password
- `balance` - Primary balance
- `balances` - Multi-currency balances (USDT, BTC, ETH, etc.)
- `wallet_address` - Primary wallet address
- `total_invested` - Total amount invested
- `total_income` - Total income earned
- `kycStatus` - KYC verification status
- `force_trade_win` - Admin override for trades

### Topup
- `user_id` - Reference to user
- `coin` - Cryptocurrency type
- `address` - Deposit address
- `amount` - Deposit amount
- `status` - pending, complete, rejected
- `photo_url` - Proof of payment

### Withdrawal
- `user_id` - Reference to user
- `coin` - Cryptocurrency
- `address` - Withdrawal address
- `amount` - Withdrawal amount
- `status` - pending, complete, failed
- `txhash` - Transaction hash

### Trade
- `user_id` - Reference to user
- `pair` - Trading pair (BTC/USDT)
- `type` - buy, sell, long, short
- `entry_price` - Entry price
- `exit_price` - Exit price
- `amount` - Trade amount
- `leverage` - Leverage multiplier
- `pnl` - Profit/Loss
- `status` - open, closed, cancelled

### Mining
- `user_id` - Reference to user
- `amount` - Investment amount
- `daily_reward` - Daily reward percentage
- `total_earned` - Total earned so far
- `status` - active, completed, cancelled
- `last_claim` - Last claim timestamp

### Wallet
- `user_id` - Reference to user
- `address` - Wallet address
- `chain` - Blockchain (ethereum, polygon, bsc, etc.)
- `balance` - Current balance
- `balances` - Token balances
- `is_primary` - Is primary wallet
- `last_synced` - Last sync timestamp

### KYC
- `user_id` - Reference to user
- `full_name` - User's full name
- `date_of_birth` - DOB
- `document_type` - passport, license, etc.
- `document_number` - Document ID
- `status` - pending, verified, rejected

### ArbitrageSubscription
- `user_id` - Reference to user
- `product_id` - Product reference
- `amount` - Investment amount
- `daily_return` - Daily return percentage
- `earned` - Amount earned so far
- `days_completed` - Days completed
- `status` - active, completed, cancelled

## ⚙️ Configuration

### MongoDB Connection

Local MongoDB:
```env
MONGODB_URI=mongodb://localhost:27017/bvox_finance
```

MongoDB Atlas (Cloud):
```env
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/bvox_finance?retryWrites=true&w=majority
```

### Server Settings

```env
PORT=3000
NODE_ENV=development|production
```

## 🔒 Security Notes

1. **Never commit `.env`** - Keep sensitive data private
2. **Use HTTPS in production** - Encrypt data in transit
3. **Hash passwords** - Use bcrypt for password hashing
4. **Validate inputs** - Sanitize all user inputs
5. **Use JWT tokens** - Implement authentication
6. **Rate limiting** - Prevent API abuse
7. **CORS configuration** - Only allow trusted origins

## 🛠️ Troubleshooting

### "Cannot connect to MongoDB"
```bash
# Check MongoDB is running
mongod --version

# Verify connection string in .env
# Make sure MONGODB_URI is correct
```

### "Module not found" errors
```bash
# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

### API returns 404
```bash
# Make sure app-server.js is running
# Check that endpoint path matches documentation
# Verify request method (GET, POST, PUT)
```

### Migration script fails
```bash
# Check JSON file paths are correct
# Verify MongoDB connection works
# Check for duplicate IDs in source data
```

## 📊 Monitoring & Logs

The server logs all database operations:
```
[db] Connected to MongoDB
🔄 Migrating users...
✅ Migrated 48 users
```

Monitor logs during operation to ensure everything is working properly.

## 📁 File Structure

```
/config
  ├── db.js              # MongoDB connection
  ├── database.js        # Database utilities
  └── apiRoutes.js       # API endpoints

/models
  ├── User.js
  ├── Admin.js
  ├── Topup.js
  ├── Withdrawal.js
  ├── Trade.js
  ├── Mining.js
  ├── Loan.js
  ├── Wallet.js
  ├── KYC.js
  ├── ArbitrageProduct.js
  ├── ArbitrageSubscription.js
  ├── Notification.js
  ├── Session.js
  └── Nonce.js

/scripts
  └── migrate-json-to-db.js  # Data migration

/js
  └── api-client.js          # Frontend API client

app-server.js                # Express server
database-integration.html    # Testing page
```

## 🚀 Production Deployment

### Using PM2

```bash
npm install -g pm2

# Start server
pm2 start app-server.js --name "bvox-finance"

# Monitor
pm2 monit

# Logs
pm2 logs bvox-finance

# Restart on reboot
pm2 startup
pm2 save
```

### Using Docker

```dockerfile
FROM node:16
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["node", "app-server.js"]
```

Build and run:
```bash
docker build -t bvox-finance .
docker run -e MONGODB_URI=mongodb://... -p 3000:3000 bvox-finance
```

## 📞 Support

For issues or questions:
1. Check the troubleshooting section
2. Review API documentation
3. Test endpoints using `/database-integration.html`
4. Check server logs for errors

## 📄 License

MIT License - See LICENSE file for details
