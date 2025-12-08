/**
 * Backend Server with Wallet Authentication
 * Handles user authentication, database, and API endpoints
 * 
 * Setup:
 * 1. npm install express cors dotenv ethers mongoose
 * 2. Create .env file with database credentials
 * 3. Run: node backend-server.js
 */

const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const ethers = require('ethers');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.BACKEND_PORT || 5000;

// ========== JSON FILE UTILITIES ==========

const usersFile = path.join(__dirname, 'users.json');

function readUsersFile() {
    try {
        const data = fs.readFileSync(usersFile, 'utf8');
        return JSON.parse(data) || [];
    } catch (error) {
        console.error('Error reading users.json:', error);
        return [];
    }
}

function writeUsersFile(data) {
    try {
        fs.writeFileSync(usersFile, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error('Error writing users.json:', error);
        return false;
    }
}

function getUserByUserId(userid) {
    const users = readUsersFile();
    return users.find(u => u.userid == userid);
}

function updateUserBalance(userid, coin, newBalance) {
    const users = readUsersFile();
    const userIndex = users.findIndex(u => u.userid == userid);
    
    if (userIndex !== -1) {
        if (!users[userIndex].balances) {
            users[userIndex].balances = {};
        }
        users[userIndex].balances[coin.toLowerCase()] = newBalance;
        writeUsersFile(users);
        return true;
    }
    return false;
}

// Middleware - CORS configuration for development
const corsOptions = {
    origin: ['http://localhost:3000', 'http://localhost:5000', 'http://127.0.0.1:3000', 'http://127.0.0.1:5000'],
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.use(express.json());

// ========== DATABASE SETUP ==========

// MongoDB Connection
const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/bvox-finance';

mongoose.connect(mongoURI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
    .then(() => console.log('✓ MongoDB connected'))
    .catch(err => console.error('✗ MongoDB error:', err));

// User Schema
const userSchema = new mongoose.Schema({
    userId: {
        type: String,
        unique: true,
        required: true,
    },
    address: {
        type: String,
        unique: true,
        required: true,
        lowercase: true,
    },
    username: String,
    email: String,
    balance: { type: Number, default: 0 },
    creditScore: { type: Number, default: 600 },
    kycStatus: {
        type: String,
        enum: ['none', 'basic', 'advanced'],
        default: 'none',
    },
    status: {
        type: String,
        enum: ['active', 'suspended', 'banned'],
        default: 'active',
    },
    transactions: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Transaction',
        },
    ],
    createdAt: { type: Date, default: Date.now },
    lastLogin: Date,
});

// Create index for userId for faster queries
userSchema.index({ userId: 1 });

const User = mongoose.model('User', userSchema);

// Transaction Schema
const transactionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    type: {
        type: String,
        enum: ['mining', 'trading', 'loan', 'arbitrage', 'transfer'],
        required: true,
    },
    amount: { type: Number, required: true },
    currency: String,
    status: {
        type: String,
        enum: ['pending', 'completed', 'failed'],
        default: 'pending',
    },
    txHash: String,
    description: String,
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
});

const Transaction = mongoose.model('Transaction', transactionSchema);

// Session Schema
const sessionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    address: String,
    token: String,
    signature: String,
    expiresAt: Date,
    createdAt: { type: Date, default: Date.now },
});

const Session = mongoose.model('Session', sessionSchema);

// Device Session Schema - Track wallet → User ID mapping with device info
const deviceSessionSchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true,
        index: true,
    },
    address: {
        type: String,
        required: true,
        lowercase: true,
        index: true,
    },
    sessionToken: String,
    ipAddress: String,
    userAgent: String,
    walletType: {
        type: String,
        enum: ['metamask', 'walletconnect', 'coinbase', 'other'],
        default: 'metamask',
    },
    isActive: { type: Boolean, default: true },
    lastActivityAt: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) }, // 30 days
});

// TTL index to auto-delete expired sessions
deviceSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const DeviceSession = mongoose.model('DeviceSession', deviceSessionSchema);

// Mining Schema - Track ETH staking orders
const miningSchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true,
        index: true,
    },
    username: String,
    stakedAmount: {
        type: Number,
        required: true,
    },
    currency: {
        type: String,
        default: 'ETH',
    },
    dailyYield: {
        type: Number,
        required: true,
    },
    totalIncome: {
        type: Number,
        default: 0,
    },
    todayIncome: {
        type: Number,
        default: 0,
    },
    status: {
        type: String,
        enum: ['pending', 'active', 'completed', 'redeemed'],
        default: 'pending',
    },
    startDate: {
        type: Date,
        default: Date.now,
    },
    activationDate: Date,
    redemptionDate: Date,
    lastIncomeAt: Date,
    createdAt: {
        type: Date,
        default: Date.now,
    },
    updatedAt: {
        type: Date,
        default: Date.now,
    },
});

const Mining = mongoose.model('Mining', miningSchema);

// ========== AUTHENTICATION ==========

/**
 * Generate unique user ID (5-6 digit format)
 */
function generateUserId() {
    // Format: YYMMDD + 5 random digits
    // Example: 250130-37283
    const date = new Date();
    const year = date.getFullYear().toString().slice(-2);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const random = Math.floor(Math.random() * 90000) + 10000;
    return `${year}${month}${day}-${random}`;
}

/**
 * Verify wallet signature
 */
function verifySignature(message, signature, address) {
    try {
        const recoveredAddress = ethers.verifyMessage(message, signature);
        return recoveredAddress.toLowerCase() === address.toLowerCase();
    } catch (error) {
        console.error('Signature verification error:', error);
        return false;
    }
}

/**
 * Generate JWT token (simple implementation)
 */
function generateToken() {
    return require('crypto').randomBytes(32).toString('hex');
}

// ========== API ENDPOINTS ==========

/**
 * POST /auth/login-wallet
 * Authenticate user with wallet signature
 */
app.post('/auth/login-wallet', async (req, res) => {
    try {
        const { address, signature, message } = req.body;

        if (!address || !signature || !message) {
            return res.json({
                code: 0,
                info: 'Missing required parameters',
            });
        }

        // Verify signature
        if (!verifySignature(message, signature, address)) {
            return res.json({
                code: 0,
                info: 'Invalid signature',
            });
        }

        // Find or create user
        let user = await User.findOne({ address: address.toLowerCase() });

        if (!user) {
            user = await User.create({
                address: address.toLowerCase(),
                username: `User_${address.substring(2, 8)}`,
            });
        }

        // Update last login
        user.lastLogin = new Date();
        await user.save();

        // Create session
        const token = generateToken();
        const session = await Session.create({
            userId: user._id,
            address: address.toLowerCase(),
            token: token,
            signature: signature,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        });

        res.json({
            code: 1,
            info: 'Login successful',
            data: {
                userid: user._id,
                username: user.username,
                address: user.address,
                token: token,
                kycStatus: user.kycStatus,
                creditScore: user.creditScore,
            },
        });
    } catch (error) {
        console.error('Login error:', error);
        res.json({
            code: 0,
            info: 'Login failed',
        });
    }
});

/**
 * POST /auth/logout
 * Logout user
 */
app.post('/auth/logout', async (req, res) => {
    try {
        const { token } = req.body;
        await Session.deleteOne({ token });

        res.json({
            code: 1,
            info: 'Logout successful',
        });
    } catch (error) {
        res.json({
            code: 0,
            info: 'Logout failed',
        });
    }
});

/**
 * GET /user/profile
 * Get user profile
 */
app.get('/user/profile', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.json({
                code: 0,
                info: 'No token provided',
            });
        }

        const session = await Session.findOne({ token });
        if (!session) {
            return res.json({
                code: 0,
                info: 'Invalid token',
            });
        }

        const user = await User.findById(session.userId);
        res.json({
            code: 1,
            data: {
                userid: user._id,
                address: user.address,
                username: user.username,
                email: user.email,
                balance: user.balance,
                creditScore: user.creditScore,
                kycStatus: user.kycStatus,
                status: user.status,
                createdAt: user.createdAt,
            },
        });
    } catch (error) {
        res.json({
            code: 0,
            info: 'Failed to get profile',
        });
    }
});

/**
 * GET /user/transactions
 * Get user transactions
 */
app.get('/user/transactions', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        const session = await Session.findOne({ token });

        if (!session) {
            return res.json({
                code: 0,
                info: 'Unauthorized',
            });
        }

        const transactions = await Transaction.find({
            userId: session.userId,
        }).sort({ createdAt: -1 });

        res.json({
            code: 1,
            data: transactions,
        });
    } catch (error) {
        res.json({
            code: 0,
            info: 'Failed to get transactions',
        });
    }
});

/**
 * POST /transaction/create
 * Create new transaction
 */
app.post('/transaction/create', async (req, res) => {
    try {
        const { token, type, amount, currency, description } = req.body;

        const session = await Session.findOne({ token });
        if (!session) {
            return res.json({
                code: 0,
                info: 'Unauthorized',
            });
        }

        const transaction = await Transaction.create({
            userId: session.userId,
            type,
            amount,
            currency,
            description,
            status: 'pending',
        });

        res.json({
            code: 1,
            info: 'Transaction created',
            data: transaction,
        });
    } catch (error) {
        res.json({
            code: 0,
            info: 'Failed to create transaction',
        });
    }
});

/**
 * POST /wallet/getuserzt
 * Get user status and KYC info
 */
app.post('/wallet/getuserzt', async (req, res) => {
    try {
        const { userid } = req.body;

        const user = await User.findById(userid);
        if (!user) {
            return res.json({
                code: 0,
                info: 'User not found',
            });
        }

        // Map KYC status to number
        const kycMap = { none: 0, basic: 1, advanced: 2 };

        res.json({
            code: 1,
            data: {
                renzhengzhuangtai: kycMap[user.kycStatus],
                xinyongfen: user.creditScore,
                balance: user.balance,
                status: user.status,
            },
        });
    } catch (error) {
        res.json({
            code: 0,
            info: 'Failed to get user status',
        });
    }
});

/**
 * POST /kyc/submit
 * Submit KYC information
 */
app.post('/kyc/submit', async (req, res) => {
    try {
        const { userid, kycData } = req.body;

        const user = await User.findById(userid);
        if (!user) {
            return res.json({
                code: 0,
                info: 'User not found',
            });
        }

        // Store KYC data (in production, use secure storage)
        user.kycStatus = 'basic'; // Mark as submitted
        await user.save();

        res.json({
            code: 1,
            info: 'KYC submitted successfully',
            data: {
                status: user.kycStatus,
            },
        });
    } catch (error) {
        res.json({
            code: 0,
            info: 'Failed to submit KYC',
        });
    }
});

/**
 * POST /wallet/get-or-create-user
 * Get existing user ID or create new user with ID
 * Used for wallet connection on frontend
 */
app.post('/wallet/get-or-create-user', async (req, res) => {
    try {
        const { address, walletType, userAgent, ipAddress } = req.body;

        if (!address) {
            return res.json({
                code: 0,
                message: 'Address is required',
            });
        }

        const lowerAddress = address.toLowerCase();

        // Check if user already exists with this address
        let user = await User.findOne({ address: lowerAddress });
        let isNewUser = false;

        if (!user) {
            // Create new user with generated ID
            const userId = generateUserId();
            
            user = await User.create({
                userId: userId,
                address: lowerAddress,
                username: `User_${address.substring(2, 8)}`,
                lastLogin: new Date(),
            });

            isNewUser = true;
            console.log('✓ New user created:', userId, 'Address:', lowerAddress);
        } else {
            // Update last login
            user.lastLogin = new Date();
            await user.save();
            console.log('✓ Existing user accessed:', user.userId, 'Address:', lowerAddress);
        }

        // Create device session record
        const sessionToken = generateToken();
        await DeviceSession.create({
            userId: user.userId,
            address: lowerAddress,
            sessionToken: sessionToken,
            ipAddress: ipAddress || 'unknown',
            userAgent: userAgent || 'unknown',
            walletType: walletType || 'metamask',
            isActive: true,
        });

        console.log('✓ Device session created for user:', user.userId);

        res.json({
            code: 1,
            message: isNewUser ? 'User created successfully' : 'User found',
            data: {
                userId: user.userId,
                address: user.address,
                isNew: isNewUser,
                sessionToken: sessionToken,
            },
        });
    } catch (error) {
        console.error('Error in get-or-create-user:', error);
        res.json({
            code: 0,
            message: 'Failed to process wallet connection',
            error: error.message,
        });
    }
});

/**
 * POST /wallet/save-session
 * Save session data to backend
 */
app.post('/wallet/save-session', async (req, res) => {
    try {
        const { userId, address, walletType, connectedAt } = req.body;

        if (!userId || !address) {
            return res.json({
                code: 0,
                message: 'Missing required fields',
            });
        }

        // Update device session
        await DeviceSession.updateOne(
            { userId: userId, address: address.toLowerCase() },
            {
                $set: {
                    walletType: walletType,
                    lastActivityAt: new Date(),
                    isActive: true,
                }
            }
        );

        res.json({
            code: 1,
            message: 'Session saved successfully',
        });
    } catch (error) {
        console.error('Error saving session:', error);
        res.json({
            code: 0,
            message: 'Failed to save session',
        });
    }
});

/**
 * POST /wallet/get-user-by-address
 * Get user ID by wallet address (for auto-login)
 */
app.post('/wallet/get-user-by-address', async (req, res) => {
    try {
        const { address } = req.body;

        if (!address) {
            return res.json({
                code: 0,
                message: 'Address is required',
            });
        }

        const user = await User.findOne({ address: address.toLowerCase() });

        if (!user) {
            return res.json({
                code: 0,
                message: 'User not found',
            });
        }

        // Update last activity
        await DeviceSession.updateMany(
            { address: address.toLowerCase() },
            { lastActivityAt: new Date() }
        );

        res.json({
            code: 1,
            message: 'User found',
            data: {
                userId: user.userId,
                address: user.address,
                username: user.username,
                kycStatus: user.kycStatus,
                creditScore: user.creditScore,
            },
        });
    } catch (error) {
        console.error('Error getting user by address:', error);
        res.json({
            code: 0,
            message: 'Failed to get user',
        });
    }
});

/**
 * GET /wallet/user/:userId/devices
 * Get all devices/sessions for a user ID
 */
app.get('/wallet/user/:userId/devices', async (req, res) => {
    try {
        const { userId } = req.params;

        const devices = await DeviceSession.find({ userId: userId }).sort({ createdAt: -1 });

        res.json({
            code: 1,
            data: devices.map(d => ({
                address: d.address,
                ipAddress: d.ipAddress,
                userAgent: d.userAgent,
                walletType: d.walletType,
                isActive: d.isActive,
                lastActivityAt: d.lastActivityAt,
                createdAt: d.createdAt,
            })),
        });
    } catch (error) {
        console.error('Error getting user devices:', error);
        res.json({
            code: 0,
            message: 'Failed to get user devices',
        });
    }
});

/**
 * POST /api/Mine/getminesy
 * Get mining stats for user (total income, today income, staked amount)
 */
app.post('/api/Mine/getminesy', async (req, res) => {
    try {
        const { userid, username } = req.body;

        if (!userid) {
            return res.json({
                code: 0,
                data: 'User ID is required',
            });
        }

        // Get all active mining records for this user
        const miningRecords = await Mining.find({
            userId: userid,
            status: { $in: ['pending', 'active'] }
        });

        if (!miningRecords || miningRecords.length === 0) {
            return res.json({
                code: 1,
                data: {
                    total_shuliang: 0,
                    total_jine: 0,
                    recent_jine: 0,
                },
            });
        }

        // Calculate total staked amount
        const total_shuliang = miningRecords.reduce((sum, record) => sum + record.stakedAmount, 0);
        
        // Calculate total income
        const total_jine = miningRecords.reduce((sum, record) => sum + (record.totalIncome || 0), 0);
        
        // Calculate today's income
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const recent_jine = miningRecords.reduce((sum, record) => {
            if (record.lastIncomeAt && new Date(record.lastIncomeAt) >= today) {
                return sum + (record.todayIncome || 0);
            }
            return sum;
        }, 0);

        res.json({
            code: 1,
            data: {
                total_shuliang: total_shuliang,
                total_jine: total_jine,
                recent_jine: recent_jine,
            },
        });
    } catch (error) {
        console.error('Error getting mining stats:', error);
        res.json({
            code: 0,
            data: 'Failed to get mining statistics',
        });
    }
});

/**
 * POST /api/Mine/setmineorder
 * Create new mining order (staking ETH) with balance deduction and auto-rewards
 */
app.post('/api/Mine/setmineorder', async (req, res) => {
    try {
        const { userid, username, jine } = req.body;

        // Validate input
        if (!userid || !jine || isNaN(jine)) {
            return res.json({
                code: 0,
                data: 'Invalid input parameters',
            });
        }

        const amount = parseFloat(jine);

        // Validate staking amount
        if (amount <= 0) {
            return res.json({
                code: 0,
                data: 'Staking amount must be greater than 0',
            });
        }

        // Get user from JSON file to check balance
        const user = getUserByUserId(userid);
        if (!user) {
            return res.json({
                code: 0,
                data: 'User not found',
            });
        }

        const currentBalance = user.balances?.eth || 0;

        // Check if user has sufficient ETH balance
        if (currentBalance < amount) {
            return res.json({
                code: 0,
                data: `Insufficient ETH balance. Current: ${currentBalance} ETH, Required: ${amount} ETH`,
            });
        }

        // Determine daily yield percentage based on amount
        let dailyYield = 0;
        if (amount >= 0.5 && amount < 2.0) {
            dailyYield = 0.003; // 0.3%
        } else if (amount >= 2.0 && amount < 12.0) {
            dailyYield = 0.004; // 0.4%
        } else if (amount >= 12.0 && amount < 20.0) {
            dailyYield = 0.0045; // 0.45%
        } else if (amount >= 20.0 && amount < 40.0) {
            dailyYield = 0.005; // 0.5%
        } else if (amount >= 40.0) {
            dailyYield = 0.006; // 0.6%
        } else {
            return res.json({
                code: 0,
                data: 'Staking amount must be at least 0.5 ETH',
            });
        }

        // Deduct staked amount from user's ETH balance
        const newBalance = currentBalance - amount;
        updateUserBalance(userid, 'eth', newBalance);

        // Create new mining record in MongoDB
        const miningOrder = await Mining.create({
            userId: userid,
            username: username || user.username || `User_${userid}`,
            stakedAmount: amount,
            currency: 'ETH',
            dailyYield: dailyYield,
            totalIncome: 0,
            todayIncome: 0,
            status: 'active', // Immediately active
            startDate: new Date(),
            activationDate: new Date(),
        });

        console.log('✓ Mining order created:', {
            userId: userid,
            amount: amount,
            dailyYield: (dailyYield * 100) + '%',
            orderId: miningOrder._id,
            newBalance: newBalance,
        });

        // Schedule automatic daily rewards for 24 hours
        scheduleRewards(userid, amount, dailyYield, miningOrder._id);

        res.json({
            code: 1,
            data: {
                orderId: miningOrder._id,
                amount: miningOrder.stakedAmount,
                currency: miningOrder.currency,
                dailyYield: (miningOrder.dailyYield * 100) + '%',
                status: miningOrder.status,
                newBalance: newBalance,
                message: 'Mining started successfully. Daily rewards will be added automatically.',
            },
        });
    } catch (error) {
        console.error('Error creating mining order:', error);
        res.json({
            code: 0,
            data: 'Failed to create mining order: ' + error.message,
        });
    }
});

/**
 * Schedule automatic daily rewards for mining
 * Adds reward to user's ETH balance every 24 hours
 */
function scheduleRewards(userid, stakedAmount, dailyYield, orderId, initialDelayMs) {
    const dailyReward = stakedAmount * dailyYield;

    console.log(`⏱️ Scheduling rewards for user ${userid} (order ${orderId}):`, {
        stakedAmount: stakedAmount,
        dailyYield: (dailyYield * 100) + '%',
        dailyReward: dailyReward.toFixed(8) + ' ETH',
        initialDelayMs: initialDelayMs || '(24h default)'
    });

    // Core reward application logic
    async function applyReward() {
        try {
            const user = getUserByUserId(userid);
            if (!user) {
                console.log(`⚠️ User ${userid} not found, skipping reward for order ${orderId}`);
                return false;
            }

            const mining = await Mining.findById(orderId);
            if (!mining || mining.status !== 'active') {
                console.log(`⚠️ Mining order ${orderId} no longer active, stopping rewards`);
                return false;
            }

            const currentBalance = user.balances?.eth || 0;
            const newBalance = currentBalance + dailyReward;

            updateUserBalance(userid, 'eth', newBalance);

            mining.totalIncome = (mining.totalIncome || 0) + dailyReward;
            mining.todayIncome = dailyReward;
            mining.lastIncomeAt = new Date();
            await mining.save();

            console.log(`✅ Reward added for user ${userid} (order ${orderId}):`, {
                dailyReward: dailyReward.toFixed(8) + ' ETH',
                newBalance: newBalance.toFixed(8) + ' ETH',
                totalIncome: mining.totalIncome.toFixed(8) + ' ETH',
                timestamp: new Date(),
            });

            return true;
        } catch (error) {
            console.error(`Error adding reward for user ${userid} (order ${orderId}):`, error);
            return false;
        }
    }

    // We use setTimeout for the initial delay (so we can resume cadence correctly), then setInterval every 24h
    const ONE_DAY = 24 * 60 * 60 * 1000;
    let intervalId = null;

    const startInterval = () => {
        if (intervalId) return;
        intervalId = setInterval(async () => {
            const ok = await applyReward();
            if (!ok && intervalId) {
                clearInterval(intervalId);
                intervalId = null;
            }
        }, ONE_DAY);
    };

    if (typeof initialDelayMs === 'number' && initialDelayMs > 0) {
        // Schedule first reward after initialDelayMs, then start regular interval
        setTimeout(async () => {
            const ok = await applyReward();
            if (ok) startInterval();
        }, initialDelayMs);
        console.log(`⏱️ Next payout for order ${orderId} scheduled in ${Math.round(initialDelayMs/1000)}s`);
    } else {
        // Default behavior: start interval which will run every 24h (first run in ~24h)
        startInterval();
        console.log(`⏱️ Reward interval started for order ${orderId}, first payout in ~24 hours`);
    }
}

// Resume schedules for active mining orders on server startup
async function resumeMiningSchedules() {
    try {
        const active = await Mining.find({ status: 'active' });
        if (!active || active.length === 0) {
            console.log('No active mining orders to resume scheduling for.');
            return;
        }

        const ONE_DAY = 24 * 60 * 60 * 1000;
        active.forEach(rec => {
            const last = rec.lastIncomeAt ? new Date(rec.lastIncomeAt).getTime()
                        : (rec.activationDate ? new Date(rec.activationDate).getTime() : (rec.startDate ? new Date(rec.startDate).getTime() : (rec.createdAt ? new Date(rec.createdAt).getTime() : Date.now())));
            const now = Date.now();
            const elapsed = now - last;
            // If elapsed >= ONE_DAY, schedule immediate run (0 delay). Otherwise compute remaining time until next payout.
            const nextDelay = elapsed >= ONE_DAY ? 0 : (ONE_DAY - (elapsed % ONE_DAY));

            console.log(`Resuming schedule for order ${rec._id}, user ${rec.userId} — next payout in ${Math.round(nextDelay/1000)}s`);
            scheduleRewards(rec.userId, rec.stakedAmount || rec.amount || 0, (rec.dailyYield || 0), rec._id, nextDelay);
        });
    } catch (error) {
        console.error('Error resuming mining schedules:', error);
    }
}

/**
 * GET /api/Mine/records/:userid
 * Get all mining records for a user
 */
app.get('/api/Mine/records/:userid', async (req, res) => {
    try {
        const { userid } = req.params;

        const records = await Mining.find({ userId: userid }).sort({ createdAt: -1 });

        res.json({
            code: 1,
            data: records.map(record => ({
                orderId: record._id,
                amount: record.stakedAmount,
                currency: record.currency,
                dailyYield: (record.dailyYield * 100) + '%',
                totalIncome: record.totalIncome,
                todayIncome: record.todayIncome,
                status: record.status,
                startDate: record.startDate,
                activationDate: record.activationDate,
            })),
        });
    } catch (error) {
        console.error('Error getting mining records:', error);
        res.json({
            code: 0,
            data: 'Failed to get mining records',
        });
    }
});

/**
 * Health check
 */
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date(),
    });
});

// ========== ERROR HANDLING ==========

app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.json({
        code: 0,
        info: 'Server error',
    });
});

// ========== START SERVER ==========

app.listen(PORT, () => {
    // Resume any active mining schedules when the server starts
    resumeMiningSchedules().catch(err => console.error('Failed to resume mining schedules at startup:', err));

    console.log(`
╔════════════════════════════════════════╗
║   BVOX Finance Backend Server          ║
╚════════════════════════════════════════╝

🚀 Server running at: http://localhost:${PORT}
📊 Database: ${mongoURI}

Available endpoints:
  POST   /auth/login-wallet              - Wallet authentication
  POST   /auth/logout                    - User logout
  GET    /user/profile                   - Get user profile
  GET    /user/transactions              - Get transactions
  POST   /transaction/create             - Create transaction
  POST   /wallet/getuserzt               - Get user status
  POST   /wallet/get-or-create-user      - Get/create user with ID ⭐ NEW
  POST   /wallet/save-session            - Save session data ⭐ NEW
  POST   /wallet/get-user-by-address     - Get user by wallet address ⭐ NEW
  GET    /wallet/user/:userId/devices    - Get user devices ⭐ NEW
  POST   /kyc/submit                     - Submit KYC
  GET    /health                         - Health check

Press Ctrl+C to stop the server
    `);
});

module.exports = app;
