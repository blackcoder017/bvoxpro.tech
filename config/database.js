/**
 * Database Utility Functions
 * Provides helper functions for database operations
 */

const User = require('../models/User');
const Admin = require('../models/Admin');
const Topup = require('../models/Topup');
const Withdrawal = require('../models/Withdrawal');
const ExchangeRecord = require('../models/ExchangeRecord');
const Trade = require('../models/Trade');
const Mining = require('../models/Mining');
const Loan = require('../models/Loan');
const Wallet = require('../models/Wallet');
const KYC = require('../models/KYC');
const ArbitrageProduct = require('../models/ArbitrageProduct');
const ArbitrageSubscription = require('../models/ArbitrageSubscription');
const Notification = require('../models/Notification');

// User functions
async function getUserById(userId) {
    try {
        console.log(`[DB] Searching for user with ID: ${userId} (type: ${typeof userId})`);
        
        // Try numeric search first
        const numericId = parseInt(userId, 10);
        const queries = [
            { userid: userId },
            { uid: userId }
        ];
        
        // Add numeric queries if applicable
        if (!isNaN(numericId)) {
            queries.push({ userid: numericId });
            queries.push({ uid: numericId });
        }
        
        const user = await User.findOne({ $or: queries });
        console.log(`[DB] User search result:`, user ? 'Found' : 'Not found');
        return user;
    } catch (e) {
        console.error('Error getting user:', e);
        return null;
    }
}

async function getAllUsers(limit = 100, skip = 0) {
    try {
        return await User.find().limit(limit).skip(skip).sort({ created_at: -1 });
    } catch (e) {
        console.error('Error getting users:', e);
        return [];
    }
}

async function updateUserBalance(userId, newBalance) {
    try {
        return await User.findOneAndUpdate(
            { $or: [{ userid: userId }, { uid: userId }] },
            { balance: newBalance, updated_at: new Date() },
            { new: true }
        );
    } catch (e) {
        console.error('Error updating user balance:', e);
        return null;
    }
}

async function updateUserBalances(userId, balances) {
    try {
        return await User.findOneAndUpdate(
            { $or: [{ userid: userId }, { uid: userId }] },
            { balances, updated_at: new Date() },
            { new: true }
        );
    } catch (e) {
        console.error('Error updating user balances:', e);
        return null;
    }
}

// Topup functions
async function createTopup(topupData) {
    try {
        const topup = new Topup(topupData);
        return await topup.save();
    } catch (e) {
        console.error('Error creating topup:', e);
        return null;
    }
}

async function getUserTopupRecords(userId, limit = 50) {
    try {
        // Be flexible with userId types: some records may have string or numeric representations.
        const idStr = String(userId);
        const idNum = parseInt(userId, 10);
        const queries = [ { user_id: idStr } ];
        if (!isNaN(idNum)) queries.push({ user_id: String(idNum) });
        // Also allow case-insensitive exact match or regex contains as a last resort
        queries.push({ user_id: { $regex: `^${idStr}$`, $options: 'i' } });
        // Perform the query using $or
        const results = await Topup.find({ $or: queries }).limit(limit).sort({ created_at: -1 });
        console.log(`[DB] getUserTopupRecords for userId=${userId} -> found ${results.length} records`);
        return results;
    } catch (e) {
        console.error('Error getting topup records:', e);
        return [];
    }
}

async function updateTopupStatus(topupId, status) {
    try {
        return await Topup.findOneAndUpdate(
            { id: topupId },
            { status, updated_at: new Date() },
            { new: true }
        );
    } catch (e) {
        console.error('Error updating topup status:', e);
        return null;
    }
}

async function getAllTopups(limit = 100, skip = 0) {
    try {
        const results = await Topup.find({})
            .limit(limit)
            .skip(skip)
            .sort({ created_at: -1 });
        console.log(`[DB] getAllTopups -> found ${results.length} records`);
        return results;
    } catch (e) {
        console.error('Error getting all topup records:', e);
        return [];
    }
}

// Withdrawal functions
async function createWithdrawal(withdrawalData) {
    try {
        const withdrawal = new Withdrawal(withdrawalData);
        return await withdrawal.save();
    } catch (e) {
        console.error('Error creating withdrawal:', e);
        return null;
    }
}

async function getUserWithdrawalRecords(userId, limit = 50) {
    try {
        return await Withdrawal.find({ user_id: userId }).limit(limit).sort({ created_at: -1 });
    } catch (e) {
        console.error('Error getting withdrawal records:', e);
        return [];
    }
}

async function updateWithdrawalStatus(withdrawalId, status, txhash = null) {
    try {
        const update = { status, updated_at: new Date() };
        if (txhash) update.txhash = txhash;
        return await Withdrawal.findOneAndUpdate(
            { id: withdrawalId },
            update,
            { new: true }
        );
    } catch (e) {
        console.error('Error updating withdrawal status:', e);
        return null;
    }
}

// Exchange functions
async function createExchangeRecord(exchangeData) {
    try {
        const exchange = new ExchangeRecord(exchangeData);
        return await exchange.save();
    } catch (e) {
        console.error('Error creating exchange record:', e);
        return null;
    }
}

async function getUserExchangeRecords(userId, limit = 50) {
    try {
        return await ExchangeRecord.find({ user_id: userId }).limit(limit).sort({ created_at: -1 });
    } catch (e) {
        console.error('Error getting exchange records:', e);
        return [];
    }
}

// Trade functions
async function createTrade(tradeData) {
    try {
        const trade = new Trade(tradeData);
        return await trade.save();
    } catch (e) {
        console.error('Error creating trade:', e);
        return null;
    }
}

async function getUserTrades(userId, limit = 50, status = null) {
    try {
        const query = { user_id: userId };
        if (status) query.status = status;
        return await Trade.find(query).limit(limit).sort({ created_at: -1 });
    } catch (e) {
        console.error('Error getting trades:', e);
        return [];
    }
}

async function closeTrade(tradeId, exitPrice, pnl) {
    try {
        return await Trade.findOneAndUpdate(
            { id: tradeId },
            { 
                exit_price: exitPrice, 
                pnl: pnl, 
                status: 'closed', 
                exit_time: new Date(),
                updated_at: new Date() 
            },
            { new: true }
        );
    } catch (e) {
        console.error('Error closing trade:', e);
        return null;
    }
}

// Mining functions
async function createMining(miningData) {
    try {
        const mining = new Mining(miningData);
        return await mining.save();
    } catch (e) {
        console.error('Error creating mining record:', e);
        return null;
    }
}

async function getUserMiningRecords(userId) {
    try {
        return await Mining.find({ user_id: userId }).sort({ created_at: -1 });
    } catch (e) {
        console.error('Error getting mining records:', e);
        return [];
    }
}

async function updateMiningEarnings(miningId, newEarned, newTotalEarned) {
    try {
        return await Mining.findOneAndUpdate(
            { id: miningId },
            { 
                earned: newEarned,
                total_earned: newTotalEarned, 
                last_claim: new Date(),
                updated_at: new Date() 
            },
            { new: true }
        );
    } catch (e) {
        console.error('Error updating mining earnings:', e);
        return null;
    }
}

// Loan functions
async function createLoan(loanData) {
    try {
        const loan = new Loan(loanData);
        return await loan.save();
    } catch (e) {
        console.error('Error creating loan:', e);
        return null;
    }
}

async function getUserLoans(userId) {
    try {
        return await Loan.find({ user_id: userId }).sort({ created_at: -1 });
    } catch (e) {
        console.error('Error getting loans:', e);
        return [];
    }
}

// Wallet functions
async function createWallet(walletData) {
    try {
        const wallet = new Wallet(walletData);
        return await wallet.save();
    } catch (e) {
        console.error('Error creating wallet:', e);
        return null;
    }
}

async function getWalletByAddress(address) {
    try {
        return await Wallet.findOne({ address: address.toLowerCase() });
    } catch (e) {
        console.error('Error getting wallet:', e);
        return null;
    }
}

async function getUserWallets(userId) {
    try {
        return await Wallet.find({ user_id: userId });
    } catch (e) {
        console.error('Error getting user wallets:', e);
        return [];
    }
}

async function updateWalletBalance(walletId, balance, balances) {
    try {
        return await Wallet.findOneAndUpdate(
            { id: walletId },
            { balance, balances, last_synced: new Date(), updated_at: new Date() },
            { new: true }
        );
    } catch (e) {
        console.error('Error updating wallet balance:', e);
        return null;
    }
}

// KYC functions
async function createKYCRecord(kycData) {
    try {
        const kyc = new KYC(kycData);
        return await kyc.save();
    } catch (e) {
        console.error('Error creating KYC record:', e);
        return null;
    }
}

async function getUserKYCRecord(userId) {
    try {
        return await KYC.findOne({ user_id: userId });
    } catch (e) {
        console.error('Error getting KYC record:', e);
        return null;
    }
}

async function updateKYCStatus(userId, status, rejectionReason = null) {
    try {
        const update = { status, verification_date: new Date(), updated_at: new Date() };
        if (rejectionReason) update.rejection_reason = rejectionReason;
        return await KYC.findOneAndUpdate(
            { user_id: userId },
            update,
            { new: true }
        );
    } catch (e) {
        console.error('Error updating KYC status:', e);
        return null;
    }
}

// Arbitrage functions
async function getAllArbitrageProducts(limit = 20) {
    try {
        return await ArbitrageProduct.find({ status: 'active' }).limit(limit);
    } catch (e) {
        console.error('Error getting arbitrage products:', e);
        return [];
    }
}

async function getArbitrageProductById(productId) {
    try {
        // Try to find by the `id` field which is often a string like '1',
        // fall back to _id if the provided value is a valid ObjectId.
        const mongoose = require('mongoose');
        const queries = [{ id: productId }];
        if (mongoose.Types.ObjectId.isValid(String(productId))) {
            queries.push({ _id: productId });
        }
        const product = await ArbitrageProduct.findOne({ $or: queries });
        return product;
    } catch (e) {
        console.error('Error getting arbitrage product by id:', e);
        return null;
    }
}

async function createArbitrageSubscription(subscriptionData) {
    try {
        const subscription = new ArbitrageSubscription(subscriptionData);
        return await subscription.save();
    } catch (e) {
        console.error('Error creating arbitrage subscription:', e);
        return null;
    }
}

async function getUserArbitrageSubscriptions(userId) {
    try {
        return await ArbitrageSubscription.find({ user_id: userId }).sort({ created_at: -1 });
    } catch (e) {
        console.error('Error getting arbitrage subscriptions:', e);
        return [];
    }
}

async function updateSubscriptionPayout(subscriptionId, earnedAmount) {
    try {
        const subscription = await ArbitrageSubscription.findOne({ id: subscriptionId });
        if (!subscription) return null;
        
        const newEarned = (subscription.earned || 0) + earnedAmount;
        const newDaysCompleted = (subscription.days_completed || 0) + 1;
        
        return await ArbitrageSubscription.findOneAndUpdate(
            { id: subscriptionId },
            { 
                earned: newEarned,
                days_completed: newDaysCompleted,
                last_payout: new Date(),
                updated_at: new Date()
            },
            { new: true }
        );
    } catch (e) {
        console.error('Error updating subscription payout:', e);
        return null;
    }
}

// Notification functions
async function createNotification(notificationData) {
    try {
        const notification = new Notification(notificationData);
        return await notification.save();
    } catch (e) {
        console.error('Error creating notification:', e);
        return null;
    }
}

// Create a user (used by legacy wallet login)
async function createUser(userData) {
    try {
        const User = require('../models/User');
        const u = new User(userData);
        return await u.save();
    } catch (e) {
        console.error('Error creating user:', e);
        return null;
    }
}

async function getUserNotifications(userId, limit = 20) {
    try {
        return await Notification.find({ user_id: userId }).limit(limit).sort({ created_at: -1 });
    } catch (e) {
        console.error('Error getting notifications:', e);
        return [];
    }
}

async function markNotificationAsRead(notificationId) {
    try {
        return await Notification.findOneAndUpdate(
            { id: notificationId },
            { read: true, updated_at: new Date() },
            { new: true }
        );
    } catch (e) {
        console.error('Error marking notification as read:', e);
        return null;
    }
}

// Admin functions
async function getAdminByUsername(username) {
    try {
        return await Admin.findOne({ username });
    } catch (e) {
        console.error('Error getting admin:', e);
        return null;
    }
}

async function getAllAdmins(limit = 50) {
    try {
        return await Admin.find().limit(limit).sort({ created_at: -1 });
    } catch (e) {
        console.error('Error getting admins:', e);
        return [];
    }
}

async function getAdminById(adminId) {
    try {
        // Try matching the `id` field first. Only include `_id` if the provided
        // value looks like a valid Mongo ObjectId to avoid Mongoose cast errors.
        const mongoose = require('mongoose');
        const orClauses = [ { id: adminId } ];
        if (mongoose.Types.ObjectId.isValid(String(adminId))) {
            orClauses.push({ _id: adminId });
        }
        const admin = await Admin.findOne({ $or: orClauses });
        return admin;
    } catch (e) {
        console.error('Error getting admin by id:', e);
        return null;
    }
}

// Set arbitrary flags on a user record (e.g., force_trade_win)
async function updateUserFlags(userId, flags) {
    try {
        const update = Object.assign({}, flags, { updated_at: new Date() });
        return await User.findOneAndUpdate(
            { $or: [{ userid: userId }, { uid: userId }] },
            update,
            { new: true }
        );
    } catch (e) {
        console.error('Error updating user flags:', e);
        return null;
    }
}

module.exports = {
    // Users
    getUserById,
    getAllUsers,
    updateUserBalance,
    updateUserBalances,
    // Topups
    createTopup,
    getUserTopupRecords,
    updateTopupStatus,
    getAllTopups,
    // Withdrawals
    createWithdrawal,
    getUserWithdrawalRecords,
    updateWithdrawalStatus,
    // Exchange
    createExchangeRecord,
    getUserExchangeRecords,
    // Trades
    createTrade,
    getUserTrades,
    closeTrade,
    // Mining
    createMining,
    getUserMiningRecords,
    updateMiningEarnings,
    // Loans
    createLoan,
    getUserLoans,
    // Wallets
    createWallet,
    getWalletByAddress,
    getUserWallets,
    updateWalletBalance,
    // KYC
    createKYCRecord,
    getUserKYCRecord,
    updateKYCStatus,
    // Arbitrage
    getAllArbitrageProducts,
    getArbitrageProductById,
    createArbitrageSubscription,
    getUserArbitrageSubscriptions,
    updateSubscriptionPayout,
    // Notifications
    createNotification,
    getUserNotifications,
    markNotificationAsRead,
    // Admin
    getAdminByUsername,
    getAllAdmins,
    getAdminById,
    updateUserFlags,
    // helper
    createUser
};
