#!/usr/bin/env node
/**
 * BVOX Finance - Database Connection Diagnostic
 * Run this to verify MongoDB connection and database setup
 */

require('dotenv').config();
const mongoose = require('mongoose');

const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || null;

console.log('\n╔════════════════════════════════════════╗');
console.log('║   BVOX Finance - Database Diagnostic   ║');
console.log('╚════════════════════════════════════════╝\n');

console.log('📋 Configuration Check:');
console.log(`   MongoDB URI: ${mongoUri ? '✓ Set' : '✗ NOT SET'}`);
if (mongoUri) {
    // Hide password in logs
    const safeUri = mongoUri.replace(/:[^:/@]+@/, ':***@');
    console.log(`   Value: ${safeUri}`);
}
console.log(`   Node Env: ${process.env.NODE_ENV || 'development'}`);
console.log(`   Port: ${process.env.PORT || 3000}\n`);

async function diagnose() {
    try {
        if (!mongoUri) {
            console.error('✗ ERROR: MONGODB_URI not set in .env file');
            console.log('\nFix: Add this to your .env file:');
            console.log('MONGODB_URI=mongodb://127.0.0.1:27017/bvoxpro\n');
            process.exit(1);
        }

        console.log('🔌 Attempting MongoDB Connection...');
        
        await mongoose.connect(mongoUri, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            serverSelectionTimeoutMS: 5000,
        });

        console.log('✅ Successfully connected to MongoDB!\n');

        // Check collections
        console.log('📊 Database Collections:');
        const collections = await mongoose.connection.db.listCollections().toArray();
        if (collections.length === 0) {
            console.log('   (No collections yet - will be created on first use)\n');
        } else {
            collections.forEach(col => {
                console.log(`   • ${col.name}`);
            });
            console.log();
        }

        // Test models
        console.log('🧪 Testing Model Imports:');
        try {
            const User = require('./models/User');
            console.log('   ✓ User model loaded');
            
            const Trade = require('./models/Trade');
            console.log('   ✓ Trade model loaded');
            
            const ArbitrageSubscription = require('./models/ArbitrageSubscription');
            console.log('   ✓ ArbitrageSubscription model loaded');
            
            const count = await User.countDocuments();
            console.log(`   ✓ User collection accessible (${count} users)\n`);
        } catch (e) {
            console.error(`   ✗ Error loading models: ${e.message}\n`);
        }

        console.log('✅ All checks passed! MongoDB is ready.\n');
        console.log('▶️  Now run: npm start (or node app-server.js)\n');
        
        await mongoose.connection.close();
        process.exit(0);

    } catch (e) {
        console.error('\n✗ Connection Failed!\n');
        console.error('Error:', e.message);
        
        if (e.message.includes('ECONNREFUSED')) {
            console.log('\n💡 MongoDB is not running. Start it with:');
            console.log('   Windows: mongod');
            console.log('   Mac: brew services start mongodb-community');
            console.log('   Linux: sudo systemctl start mongod');
        } else if (e.message.includes('connect ENOTFOUND')) {
            console.log('\n💡 Cannot find MongoDB server. Check your MONGODB_URI in .env');
            console.log('   For local development, use:');
            console.log('   MONGODB_URI=mongodb://127.0.0.1:27017/bvoxpro');
        }
        
        console.log('\n');
        process.exit(1);
    }
}

diagnose();
