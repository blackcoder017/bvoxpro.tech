const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const WALLET_DB_PATH = path.join(__dirname, 'wallets.json');
const USERS_DB_PATH = path.join(__dirname, 'users.json');

// Initialize wallet database
function initializeWalletDB() {
    if (!fs.existsSync(WALLET_DB_PATH)) {
        fs.writeFileSync(WALLET_DB_PATH, JSON.stringify([], null, 2));
    }
}

// Initialize users database
function initializeUsersDB() {
    if (!fs.existsSync(USERS_DB_PATH)) {
        fs.writeFileSync(USERS_DB_PATH, JSON.stringify([], null, 2));
    }
}

// Read wallet database
function readWalletDB() {
    try {
        const data = fs.readFileSync(WALLET_DB_PATH, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        return [];
    }
}

// Read users database
function readUsersDB() {
    try {
        const data = fs.readFileSync(USERS_DB_PATH, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        return [];
    }
}

// Write wallet database
function writeWalletDB(data) {
    fs.writeFileSync(WALLET_DB_PATH, JSON.stringify(data, null, 2));
}

// Write users database
function writeUsersDB(data) {
    fs.writeFileSync(USERS_DB_PATH, JSON.stringify(data, null, 2));
}

// Generate next 6-digit user ID starting from 342016
function generateNextUserId() {
    const wallets = readWalletDB();
    const users = readUsersDB();
    
    // Get all numeric IDs from both wallets and users
    const allIds = [];
    
    wallets.forEach(w => {
        const id = w.userid || w.uid;
        // Only count numeric IDs, skip UUIDs
        if (id && !isNaN(id) && typeof id === 'string' && /^\d+$/.test(id)) {
            allIds.push(parseInt(id));
        }
    });
    
    users.forEach(u => {
        const id = u.userid || u.uid;
        // Only count numeric IDs, skip UUIDs
        if (id && !isNaN(id) && typeof id === 'string' && /^\d+$/.test(id)) {
            allIds.push(parseInt(id));
        }
    });
    
    // Find max ID or start from 342015, then add 1
    const maxId = allIds.length > 0 ? Math.max(...allIds) : 342015;
    return String(maxId + 1);
}

// Connect or register wallet
function connectWallet(walletAddress, chainId = 'ethereum') {
    initializeWalletDB();
    initializeUsersDB();

    const walletAddress_lower = walletAddress.toLowerCase();
    const wallets = readWalletDB();
    
    // Check if wallet already exists
    const existingWallet = wallets.find(w => w.address.toLowerCase() === walletAddress_lower);
    
    if (existingWallet) {
        // Existing wallet - return existing UID
        return {
            success: true,
            isNew: false,
            uid: existingWallet.userid || existingWallet.uid,
            message: 'Wallet connected successfully',
            wallet: existingWallet
        };
    } else {
        // New wallet - create new numeric ID starting from 342016
        const newUID = generateNextUserId();
        const newWallet = {
            userid: newUID,
            uid: newUID,
            address: walletAddress_lower,
            chainId: chainId,
            connected_at: new Date().toISOString(),
            last_login: new Date().toISOString(),
            status: 'active'
        };

        // Add wallet to database
        wallets.push(newWallet);
        writeWalletDB(wallets);

        // Create new user account
        const newUser = {
            userid: newUID,
            uid: newUID,
            wallet_address: walletAddress_lower,
            username: `user_${newUID}`,
            email: null,
            balance: 0,
            total_invested: 0,
            total_income: 0,
            balances: {
                usdt: 0,
                btc: 0,
                eth: 0,
                usdc: 0,
                pyusd: 0,
                sol: 0
            },
            created_at: new Date().toISOString(),
            last_login: new Date().toISOString(),
            status: 'active'
        };

        const users = readUsersDB();
        users.push(newUser);
        writeUsersDB(users);

        return {
            success: true,
            isNew: true,
            uid: newUID,
            message: 'New wallet registered successfully',
            wallet: newWallet,
            user: newUser
        };
    }
}

// Verify wallet connection
function verifyWallet(walletAddress) {
    initializeWalletDB();
    const walletAddress_lower = walletAddress.toLowerCase();
    const wallets = readWalletDB();
    
    const wallet = wallets.find(w => w.address.toLowerCase() === walletAddress_lower);
    
    if (wallet) {
        // Update last login
        wallet.last_login = new Date().toISOString();
        writeWalletDB(wallets);
        
        return {
            success: true,
            uid: wallet.uid,
            wallet: wallet
        };
    }
    
    return {
        success: false,
        message: 'Wallet not found'
    };
}

// Get wallet by UID
function getWalletByUID(uid) {
    initializeWalletDB();
    const wallets = readWalletDB();
    
    const wallet = wallets.find(w => w.uid === uid);
    return wallet || null;
}

// Get user by UID
function getUserByUID(uid) {
    initializeUsersDB();
    const users = readUsersDB();
    
    const user = users.find(u => u.uid === uid);
    return user || null;
}

// Get wallet by address
function getWalletByAddress(walletAddress) {
    initializeWalletDB();
    const walletAddress_lower = walletAddress.toLowerCase();
    const wallets = readWalletDB();
    
    const wallet = wallets.find(w => w.address.toLowerCase() === walletAddress_lower);
    return wallet || null;
}

module.exports = {
    initializeWalletDB,
    initializeUsersDB,
    connectWallet,
    verifyWallet,
    getWalletByUID,
    getUserByUID,
    getWalletByAddress
};
