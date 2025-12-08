const { Coin } = require('./models');

// In-memory price data with optional simulation
class PriceService {
  constructor() {
    // Seed prices for demo
    this.seedPrices = {
      'BTC': 91819.22,
      'ETH': 3450.75,
      'DOGE': 0.42
    };
    
    // Price history for simulation
    this.priceHistory = {};
    this.seedPrices = Object.keys(this.seedPrices).forEach(symbol => {
      this.priceHistory[symbol] = [this.seedPrices[symbol]];
    });
  }

  /**
   * Get current price for a coin
   * In production, replace with real API call (e.g., CoinGecko, Binance)
   */
  async getPrice(symbol) {
    symbol = symbol.toUpperCase();
    
    // Fetch from DB or memory
    let coin = await Coin.findOne({ symbol });
    if (!coin) {
      // Create if not exists
      const seedPrice = this.seedPrices[symbol] || 100;
      coin = await Coin.create({
        symbol,
        name: `${symbol} Coin`,
        lastPrice: seedPrice,
        enabled: true
      });
    }
    
    return {
      symbol: coin.symbol,
      price: coin.lastPrice,
      timestamp: new Date(),
      source: 'local-seed'
    };
  }

  /**
   * Simulate price movement (for testing without real feed)
   * Random walk: price moves ±0-5% in random direction
   */
  async simulatePriceMovement(symbol, iterations = 1) {
    symbol = symbol.toUpperCase();
    
    let coin = await Coin.findOne({ symbol });
    if (!coin) return null;

    for (let i = 0; i < iterations; i++) {
      const volatility = 0.02; // 2% max move per step
      const direction = Math.random() < 0.5 ? 1 : -1;
      const changePercent = direction * Math.random() * volatility;
      coin.lastPrice = coin.lastPrice * (1 + changePercent);
      coin.lastPrice = Math.max(0.01, coin.lastPrice); // no negative prices
    }

    await coin.save();
    console.log(`[Price] ${symbol} moved to ${coin.lastPrice.toFixed(2)}`);
    return coin.lastPrice;
  }

  /**
   * Update price from external source
   * Hook for real API integration
   */
  async updatePriceFromExternal(symbol, price) {
    symbol = symbol.toUpperCase();
    const coin = await Coin.findOneAndUpdate(
      { symbol },
      { lastPrice: price, updatedAt: new Date() },
      { new: true }
    );
    return coin;
  }
}

module.exports = new PriceService();
