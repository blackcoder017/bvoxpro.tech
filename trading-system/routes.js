const express = require('express');
const router = express.Router();
const { User, Wallet, Coin, Trade, Transaction } = require('./models');
const priceService = require('./priceService');
const settlementEngine = require('./settlementEngine');

// Middleware: Simple auth (in production use JWT)
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'No authorization token' });
  }
  
  // For demo, use a hardcoded test user
  // In production, verify JWT
  req.userId = token === 'test-token' ? 'test-user-id' : null;
  if (!req.userId) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  
  next();
};

// ============ COIN ENDPOINTS ============

// Get all coins
router.get('/coins', async (req, res) => {
  try {
    const coins = await Coin.find({ enabled: true }).select('symbol name lastPrice decimals');
    res.json({
      success: true,
      data: coins.map(c => ({
        symbol: c.symbol,
        name: c.name,
        lastPrice: c.lastPrice,
        decimals: c.decimals
      }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get price for specific coin
router.get('/coins/:symbol/price', async (req, res) => {
  try {
    const { symbol } = req.params;
    const priceData = await priceService.getPrice(symbol);
    res.json({ success: true, data: priceData });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Simulate price movement (for testing)
router.post('/coins/:symbol/simulate-price', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { iterations = 1 } = req.body;
    const newPrice = await priceService.simulatePriceMovement(symbol, iterations);
    res.json({ success: true, data: { symbol, newPrice } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ TRADE ENDPOINTS ============

// Create a new trade
router.post('/trades', authMiddleware, async (req, res) => {
  try {
    const { coinSymbol, side, type = 'prediction', stake, durationSeconds, odds = 0.9 } = req.body;

    // Validate inputs
    if (!coinSymbol || !side || !stake || !durationSeconds) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (stake <= 0) {
      return res.status(400).json({ error: 'Stake must be positive' });
    }

    if (!['up', 'down'].includes(side)) {
      return res.status(400).json({ error: 'Side must be up or down' });
    }

    // Check wallet balance
    const wallet = await Wallet.findOne({ userId: req.userId });
    if (!wallet || wallet.balance < stake) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    // Get current entry price
    const priceData = await priceService.getPrice(coinSymbol);
    const entryPrice = priceData.price;

    // Deduct stake from wallet atomically
    const updatedWallet = await Wallet.findOneAndUpdate(
      { userId: req.userId },
      {
        $inc: { balance: -stake },
        $set: { updatedAt: new Date() }
      },
      { new: true }
    );

    // Create transaction log
    const transaction = await Transaction.create({
      userId: req.userId,
      type: 'trade-stake',
      amount: -stake,
      balanceBefore: updatedWallet.balance + stake,
      balanceAfter: updatedWallet.balance,
      meta: {
        coinSymbol,
        side,
        entryPrice
      }
    });

    // Create trade document
    const trade = await Trade.create({
      userId: req.userId,
      coinSymbol: coinSymbol.toUpperCase(),
      side,
      type,
      stake,
      odds,
      durationSeconds,
      entryPrice,
      status: 'open'
    });

    console.log(`[Trade] Created trade ${trade._id} for user ${req.userId}: ${coinSymbol} ${side} stake=${stake} duration=${durationSeconds}s`);

    // Schedule settlement
    settlementEngine.scheduleSettlement(trade._id, durationSeconds);

    res.status(201).json({
      success: true,
      data: {
        id: trade._id,
        coinSymbol: trade.coinSymbol,
        side: trade.side,
        stake: trade.stake,
        entryPrice: trade.entryPrice,
        status: trade.status,
        createdAt: trade.createdAt
      }
    });

  } catch (error) {
    console.error('[Trade] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get trade by ID
router.get('/trades/:id', authMiddleware, async (req, res) => {
  try {
    const trade = await Trade.findById(req.params.id);
    
    if (!trade) {
      return res.status(404).json({ error: 'Trade not found' });
    }

    // Check authorization
    if (trade.userId.toString() !== req.userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    res.json({
      success: true,
      data: {
        id: trade._id,
        coinSymbol: trade.coinSymbol,
        side: trade.side,
        type: trade.type,
        stake: trade.stake,
        odds: trade.odds,
        durationSeconds: trade.durationSeconds,
        entryPrice: trade.entryPrice,
        exitPrice: trade.exitPrice,
        status: trade.status,
        result: trade.result,
        payout: trade.payout,
        createdAt: trade.createdAt,
        settledAt: trade.settledAt
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get user's trades
router.get('/trades', authMiddleware, async (req, res) => {
  try {
    const { status, limit = 50 } = req.query;
    
    const query = { userId: req.userId };
    if (status) query.status = status;

    const trades = await Trade.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    res.json({
      success: true,
      data: trades.map(t => ({
        id: t._id,
        coinSymbol: t.coinSymbol,
        side: t.side,
        stake: t.stake,
        status: t.status,
        result: t.result,
        payout: t.payout,
        createdAt: t.createdAt,
        settledAt: t.settledAt
      }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Manually settle a trade (admin/testing)
router.post('/trades/:id/settle', async (req, res) => {
  try {
    const trade = await settlementEngine.settleTrade(req.params.id);
    
    if (!trade) {
      return res.status(404).json({ error: 'Trade not found or already settled' });
    }

    res.json({ success: true, data: trade });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ WALLET ENDPOINTS ============

// Get user wallet
router.get('/user/wallet', authMiddleware, async (req, res) => {
  try {
    let wallet = await Wallet.findOne({ userId: req.userId });
    
    // Create wallet if not exists
    if (!wallet) {
      wallet = await Wallet.create({
        userId: req.userId,
        currency: 'USD',
        balance: 1000 // Default balance for testing
      });
    }

    res.json({
      success: true,
      data: {
        userId: wallet.userId,
        currency: wallet.currency,
        balance: wallet.balance,
        updatedAt: wallet.updatedAt
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get transaction history
router.get('/user/transactions', authMiddleware, async (req, res) => {
  try {
    const transactions = await Transaction.find({ userId: req.userId })
      .sort({ createdAt: -1 })
      .limit(100);

    res.json({ success: true, data: transactions });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add balance (admin testing)
router.post('/user/wallet/add-balance', authMiddleware, async (req, res) => {
  try {
    const { amount } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const wallet = await Wallet.findOneAndUpdate(
      { userId: req.userId },
      {
        $inc: { balance: amount },
        $set: { updatedAt: new Date() }
      },
      { new: true }
    );

    await Transaction.create({
      userId: req.userId,
      type: 'manual-credit',
      amount,
      balanceBefore: wallet.balance - amount,
      balanceAfter: wallet.balance,
      meta: { reason: 'manual-credit' }
    });

    res.json({ success: true, data: { balance: wallet.balance } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
