const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const { User, Wallet, Coin } = require('./models');
const routes = require('./routes');
const settlementEngine = require('./settlementEngine');

const app = express();
const PORT = process.env.PORT || 3001;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/trading-system';

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============ DATABASE SETUP ============

async function connectDB() {
  try {
    await mongoose.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✓ MongoDB connected');
    await seedDatabase();
  } catch (error) {
    console.error('✗ MongoDB connection error:', error);
    process.exit(1);
  }
}

async function seedDatabase() {
  // Check if coins exist
  const coinCount = await Coin.countDocuments();
  if (coinCount === 0) {
    console.log('[Seed] Creating coins...');
    await Coin.create([
      { symbol: 'BTC', name: 'Bitcoin', lastPrice: 91819.22, decimals: 2 },
      { symbol: 'ETH', name: 'Ethereum', lastPrice: 3450.75, decimals: 2 },
      { symbol: 'DOGE', name: 'Dogecoin', lastPrice: 0.42, decimals: 4 }
    ]);
    console.log('[Seed] Coins created');
  }

  // Check if test user exists
  const testUser = await User.findOne({ email: 'test@example.com' });
  if (!testUser) {
    console.log('[Seed] Creating test user...');
    const user = await User.create({
      email: 'test@example.com',
      name: 'Test User',
      passwordHash: 'hashed-password' // In real app, use bcrypt
    });

    // Create wallet with starting balance
    await Wallet.create({
      userId: user._id,
      currency: 'USD',
      balance: 5000
    });

    console.log('[Seed] Test user created with $5000 balance');
    console.log(`[Seed] Use token: "test-token" for API auth`);
    console.log(`[Seed] User ID: ${user._id}`);
  }
}

// ============ ROUTES ============

// API routes
app.use('/api', routes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Trading System API is running' });
});

// Serve index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============ SETTLEMENT WORKER ============

let settlementWorker;

function startSettlementWorker() {
  // Run settlement check every 10 seconds
  settlementWorker = setInterval(async () => {
    try {
      await settlementEngine.settleDueOpenTrades();
    } catch (error) {
      console.error('[Worker] Settlement error:', error);
    }
  }, 10000);
  
  console.log('✓ Settlement worker started (checks every 10s)');
}

function stopSettlementWorker() {
  if (settlementWorker) {
    clearInterval(settlementWorker);
    console.log('✓ Settlement worker stopped');
  }
}

// ============ SERVER START ============

async function startServer() {
  try {
    await connectDB();
    
    app.listen(PORT, () => {
      console.log(`\n╔════════════════════════════════════════════╗`);
      console.log(`║     Trading System Server                  ║`);
      console.log(`╚════════════════════════════════════════════╝\n`);
      console.log(`🚀 Server running on http://localhost:${PORT}`);
      console.log(`📊 MongoDB: ${MONGO_URI}`);
      console.log(`\n📋 Quick Start:`);
      console.log(`   1. Open http://localhost:${PORT}`);
      console.log(`   2. API token: "test-token"`);
      console.log(`   3. Starting balance: $5000`);
      console.log(`\n`);
    });

    startSettlementWorker();

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n⚠ Shutting down...');
  stopSettlementWorker();
  mongoose.connection.close(() => {
    console.log('✓ MongoDB disconnected');
    process.exit(0);
  });
});

startServer();

module.exports = app;
