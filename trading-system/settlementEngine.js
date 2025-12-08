const { Trade, Wallet, Transaction, Coin } = require('./models');
const priceService = require('./priceService');

class SettlementEngine {
  /**
   * Settle a trade deterministically
   * Fetches exit price and determines win/lose based on entry vs exit
   */
  async settleTrade(tradeId) {
    try {
      // Find the trade atomically - ensure it's open before updating
      const trade = await Trade.findOneAndUpdate(
        { _id: tradeId, status: 'open' },
        { $set: { status: 'settling' } },
        { new: true }
      );

      if (!trade) {
        console.log(`[Settlement] Trade ${tradeId} not found or already settled`);
        return null; // Already settled or not found
      }

      console.log(`[Settlement] Starting settlement for trade ${tradeId}`);

      // Get exit price (could be live or simulated)
      const exitPriceData = await priceService.getPrice(trade.coinSymbol);
      const exitPrice = exitPriceData.price;

      // Determine result based on side and prices
      let result = 'lose';
      if (trade.side === 'up' && exitPrice > trade.entryPrice) {
        result = 'win';
      } else if (trade.side === 'down' && exitPrice < trade.entryPrice) {
        result = 'win';
      } else if (exitPrice === trade.entryPrice) {
        // Tie: treat as refund
        result = 'refund';
      }

      let payout = 0;

      // Calculate payout based on result
      if (result === 'win') {
        // Payout = stake + profit. Profit = stake * odds
        payout = trade.stake * (1 + trade.odds);
        console.log(`[Settlement] Trade ${tradeId} WON. Payout: ${payout}`);
      } else if (result === 'refund') {
        // Refund original stake
        payout = trade.stake;
        console.log(`[Settlement] Trade ${tradeId} TIE - REFUND. Payout: ${payout}`);
      } else {
        // Lose: stake already deducted, no payout
        console.log(`[Settlement] Trade ${tradeId} LOST. Payout: 0`);
      }

      // Update wallet if there's a payout
      if (payout > 0) {
        const wallet = await Wallet.findOneAndUpdate(
          { userId: trade.userId },
          { 
            $inc: { balance: payout },
            $set: { updatedAt: new Date() }
          },
          { new: true }
        );

        // Log transaction
        await Transaction.create({
          userId: trade.userId,
          type: result === 'win' ? 'payout' : 'refund',
          amount: payout,
          balanceBefore: wallet.balance - payout,
          balanceAfter: wallet.balance,
          tradeId: trade._id,
          meta: {
            entryPrice: trade.entryPrice,
            exitPrice: exitPrice,
            side: trade.side,
            result
          }
        });
      }

      // Update trade with settlement details
      const settledTrade = await Trade.findByIdAndUpdate(
        trade._id,
        {
          $set: {
            status: 'settled',
            result,
            payout,
            exitPrice,
            settledAt: new Date()
          }
        },
        { new: true }
      );

      console.log(`[Settlement] Trade ${tradeId} settled: ${result} (entry: ${trade.entryPrice}, exit: ${exitPrice})`);
      return settledTrade;

    } catch (error) {
      console.error(`[Settlement] Error settling trade ${tradeId}:`, error);
      // Reset status on error
      await Trade.findByIdAndUpdate(tradeId, { $set: { status: 'open' } });
      throw error;
    }
  }

  /**
   * Schedule settlement for a trade after durationSeconds
   */
  scheduleSettlement(tradeId, durationSeconds) {
    const delayMs = durationSeconds * 1000;
    console.log(`[Settlement] Scheduled settlement for trade ${tradeId} in ${durationSeconds}s`);
    
    setTimeout(() => {
      this.settleTrade(tradeId).catch(err => {
        console.error(`[Settlement] Failed to settle ${tradeId}:`, err);
      });
    }, delayMs);
  }

  /**
   * Batch settle all open trades that have passed their duration
   * Call this periodically in production (e.g., every 10 seconds)
   */
  async settleDueOpenTrades() {
    const now = new Date();
    
    const dueTrades = await Trade.find({
      status: 'open',
      createdAt: { $lt: new Date(now.getTime() - 60000) } // Older than 60s
    }).limit(100);

    console.log(`[Settlement] Found ${dueTrades.length} trades due for settlement`);

    for (const trade of dueTrades) {
      const ageSeconds = (now - trade.createdAt) / 1000;
      if (ageSeconds >= trade.durationSeconds) {
        await this.settleTrade(trade._id);
      }
    }
  }
}

module.exports = new SettlementEngine();
