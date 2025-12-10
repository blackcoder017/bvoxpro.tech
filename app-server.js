/**
 * Express Server Configuration for BVOX Finance
 * Uses MongoDB for data persistence
 * This is the recommended way to run the application
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

// Initialize MongoDB connection
const { connectDB, mongoose } = require('./config/db');

// Import API routes
const apiRoutes = require('./config/apiRoutes');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Serve static files
app.use(express.static(path.join(__dirname, '/')));

// API Routes
app.use('/', apiRoutes);

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date(),
        database: mongoose ? 'connected' : 'disconnected'
    });
});

// 404 handler
app.use((req, res) => {
    if (!req.path.startsWith('/api/')) {
        // Serve index.html for non-API routes (SPA fallback)
        res.sendFile(path.join(__dirname, 'index.html'));
    } else {
        res.status(404).json({ error: 'Not Found' });
    }
});

// Error handler
app.use((err, req, res, next) => {
    console.error('[Error]', err);
    res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});

// Connect to database and start server
async function start() {
    try {
        // Connect to database first
        const db = await connectDB();
        if (!db) {
            console.warn('⚠️  Connected without database - falling back to JSON');
        } else {
            console.log('✅ Database connection established');
        }
        
        // Warn if DB exists but arbitrage products are missing
        try {
            const ArbitrageProduct = require('./models/ArbitrageProduct');
            const count = await ArbitrageProduct.countDocuments();
            if (count === 0) {
                console.warn('\n⚠️  No arbitrage products found in the database.');
                console.warn('   To seed default products from JSON, run: node scripts/migrate-json-to-db.js\n');
            }
        } catch (e) {
            console.warn('[seed-check] Could not verify arbitrage products:', e.message);
        }
        
        app.listen(PORT, () => {
            console.log(`\n🚀 BVOX Finance Server Started`);
            console.log(`📡 Server running at http://localhost:${PORT}`);
            console.log(`📊 API Documentation: http://localhost:${PORT}/api/health`);
            console.log(`\n✅ Database: Connected`);
            console.log(`\n📝 Available Endpoints:`);
            console.log(`   GET    /api/users/:userId`);
            console.log(`   GET    /api/topup/:userId`);
            console.log(`   POST   /api/topup`);
            console.log(`   GET    /api/withdrawal/:userId`);
            console.log(`   POST   /api/withdrawal`);
            console.log(`   GET    /api/exchange/:userId`);
            console.log(`   POST   /api/exchange`);
            console.log(`   GET    /api/trade/:userId`);
            console.log(`   POST   /api/trade`);
            console.log(`   GET    /api/mining/:userId`);
            console.log(`   POST   /api/mining`);
            console.log(`   GET    /api/loan/:userId`);
            console.log(`   POST   /api/loan`);
            console.log(`   GET    /api/wallet/:userId`);
            console.log(`   POST   /api/wallet`);
            console.log(`   GET    /api/kyc/:userId`);
            console.log(`   POST   /api/kyc`);
            console.log(`   GET    /api/arbitrage/products`);
            console.log(`   POST   /api/arbitrage/subscribe`);
            console.log(`   GET    /api/arbitrage/:userId`);
            console.log(`   GET    /api/notification/:userId`);
            console.log(`   POST   /api/notification`);
            console.log();
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error.message);
        process.exit(1);
    }
}

start();
