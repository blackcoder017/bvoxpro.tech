/**
 * Database Backup & Telegram Sender
 * -----------------------------------
 * Exports every MongoDB collection + local JSON data files to a timestamped ZIP,
 * then sends the ZIP to a Telegram chat via Bot API.
 *
 * Required env vars:
 *   TELEGRAM_BOT_TOKEN  – Bot token from @BotFather
 *   TELEGRAM_CHAT_ID    – Target chat / group / channel ID
 *   MONGODB_URI         – (optional if already set elsewhere)
 *
 * Usage:
 *   node scripts/db-backup-telegram.js          # run once manually
 *   (or) integrated into app-server.js via cron  # automatic nightly
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const dns = require('dns');
const archiver = require('archiver');
const mongoose = require('mongoose');

/** Pre-resolve api.telegram.org to avoid DNS issues when mongoose holds the event loop */
let _resolvedTelegramIP = null;
async function resolveTelegramHost() {
    if (_resolvedTelegramIP) return _resolvedTelegramIP;
    return new Promise((resolve) => {
        dns.resolve4('api.telegram.org', (err, addrs) => {
            if (!err && addrs && addrs.length) {
                _resolvedTelegramIP = addrs[0];
                resolve(_resolvedTelegramIP);
            } else {
                resolve(null); // fallback to hostname
            }
        });
    });
}

// ───── Configuration ─────
const ROOT = path.resolve(__dirname, '..');
const BACKUP_DIR = path.join(ROOT, 'backups');
function getMongoUri() { return process.env.MONGODB_URI || process.env.MONGO_URI || process.env.MONGODBURL || 'mongodb://127.0.0.1:27017/bvoxpro'; }
function getBotToken() { return process.env.TELEGRAM_BOT_TOKEN; }
function getChatId() { return process.env.TELEGRAM_CHAT_ID; }

// JSON data files to include in backup (relative to project root)
const JSON_DATA_FILES = [
    'wallets.json',
    'users.json',
    'nonces.json',
    'admins.json',
    'topup-records.json',
    'withdrawal-records.json',
    'exchange-records.json',
    'mining-records.json',
    'loan-records.json',
    'trade-records.json',
    'contract-records.json',
    'kyc-records.json',
    'arbitrage-products.json',
    'arbitrage-subscriptions.json',
    'notifications.json',
];

// ───── Helpers ─────

/** Myanmar-locale timestamp for filenames */
function mmtTimestamp() {
    const now = new Date();
    // Myanmar is UTC+6:30
    const mmt = new Date(now.getTime() + (6 * 60 + 30) * 60 * 1000);
    return mmt.toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

/** Ensure directory exists */
function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * Export all MongoDB collections to JSON files inside `outDir`.
 * Returns array of { name, path, count }.
 */
async function exportMongoCollections(outDir) {
    const results = [];

    // Make sure we're connected
    if (mongoose.connection.readyState !== 1) {
        console.log('[backup] Connecting to MongoDB …');
        try {
            await mongoose.connect(getMongoUri(), {
                useNewUrlParser: true,
                useUnifiedTopology: true,
                serverSelectionTimeoutMS: 10000,
            });
            console.log('[backup] MongoDB connected');
        } catch (e) {
            console.warn('[backup] MongoDB not available:', e.message);
            return results; // empty – we'll still backup JSON files
        }
    }

    const db = mongoose.connection.db;
    const collections = await db.listCollections().toArray();

    for (const col of collections) {
        try {
            const docs = await db.collection(col.name).find({}).toArray();
            const outPath = path.join(outDir, `${col.name}.json`);
            fs.writeFileSync(outPath, JSON.stringify(docs, null, 2), 'utf8');
            results.push({ name: col.name, path: outPath, count: docs.length });
            console.log(`  ✔ ${col.name}  (${docs.length} docs)`);
        } catch (e) {
            console.warn(`  ✖ ${col.name}: ${e.message}`);
        }
    }
    return results;
}

/**
 * Copy local JSON data files into `outDir`.
 */
function copyJsonDataFiles(outDir) {
    const copied = [];
    for (const file of JSON_DATA_FILES) {
        const src = path.join(ROOT, file);
        if (fs.existsSync(src)) {
            const dest = path.join(outDir, 'json-files', file);
            ensureDir(path.dirname(dest));
            fs.copyFileSync(src, dest);
            copied.push(file);
        }
    }
    if (copied.length) console.log(`  ✔ Copied ${copied.length} JSON data files`);
    return copied;
}

/**
 * Create a ZIP archive from `sourceDir` → `zipPath`.
 * Returns a promise that resolves when the ZIP is done.
 */
function createZip(sourceDir, zipPath) {
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        output.on('close', () => resolve(archive.pointer()));
        archive.on('error', reject);

        archive.pipe(output);
        archive.directory(sourceDir, false);
        archive.finalize();
    });
}

/**
 * Send a file to Telegram via sendDocument.
 * Uses multipart/form-data over HTTPS.
 */
function sendTelegramFile(filePath, caption) {
    return new Promise(async (resolve, reject) => {
      try {
        const BOT_TOKEN = getBotToken();
        const CHAT_ID = getChatId();
        if (!BOT_TOKEN || !CHAT_ID) {
            return reject(new Error('TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set'));
        }

        const fileName = path.basename(filePath);
        const fileData = fs.readFileSync(filePath);
        const boundary = '----BackupBoundary' + Date.now();

        // Build multipart body
        const parts = [];

        // chat_id field
        parts.push(
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="chat_id"\r\n\r\n` +
            `${CHAT_ID}\r\n`
        );

        // caption field
        if (caption) {
            parts.push(
                `--${boundary}\r\n` +
                `Content-Disposition: form-data; name="caption"\r\n\r\n` +
                `${caption}\r\n`
            );
        }

        // document file
        const fileHeader =
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="document"; filename="${fileName}"\r\n` +
            `Content-Type: application/zip\r\n\r\n`;
        const fileFooter = `\r\n--${boundary}--\r\n`;

        const headerBuf = Buffer.from(fileHeader, 'utf8');
        const footerBuf = Buffer.from(fileFooter, 'utf8');
        const textParts = Buffer.from(parts.join(''), 'utf8');

        const body = Buffer.concat([textParts, headerBuf, fileData, footerBuf]);

        // Pre-resolve hostname to avoid DNS issues
        const ip = await resolveTelegramHost();
        const options = {
            hostname: ip || 'api.telegram.org',
            port: 443,
            path: `/bot${BOT_TOKEN}/sendDocument`,
            method: 'POST',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': body.length,
                ...(ip ? { 'Host': 'api.telegram.org' } : {}),
            },
            servername: 'api.telegram.org', // for TLS SNI
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.ok) {
                        resolve(json);
                    } else {
                        reject(new Error(`Telegram API error: ${json.description || data}`));
                    }
                } catch (e) {
                    reject(new Error(`Telegram response parse error: ${data}`));
                }
            });
        });

        req.on('error', reject);
        req.write(body);
        req.end();
      } catch (e) { reject(e); }
    });
}

/**
 * Send a simple text message to Telegram.
 */
function sendTelegramMessage(text) {
    return new Promise(async (resolve, reject) => {
      try {
        const BOT_TOKEN = getBotToken();
        const CHAT_ID = getChatId();
        if (!BOT_TOKEN || !CHAT_ID) return reject(new Error('Telegram not configured'));

        const payload = JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML' });

        const ip = await resolveTelegramHost();
        const options = {
            hostname: ip || 'api.telegram.org',
            port: 443,
            path: `/bot${BOT_TOKEN}/sendMessage`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
                ...(ip ? { 'Host': 'api.telegram.org' } : {}),
            },
            servername: 'api.telegram.org',
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch { resolve(data); }
            });
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
      } catch (e) { reject(e); }
    });
}

// ───── Main backup routine ─────

async function runBackup() {
    const ts = mmtTimestamp();
    const backupName = `bvox-backup-${ts}`;
    const tmpDir = path.join(BACKUP_DIR, backupName);
    const zipPath = path.join(BACKUP_DIR, `${backupName}.zip`);

    console.log(`\n═══════════════════════════════════════════`);
    console.log(`  BVOX Database Backup — ${ts} (MMT)`);
    console.log(`═══════════════════════════════════════════\n`);

    ensureDir(tmpDir);

    // 1. Export MongoDB collections
    console.log('[1/4] Exporting MongoDB collections …');
    const mongoResults = await exportMongoCollections(tmpDir);

    // 2. Copy JSON data files
    console.log('[2/4] Copying JSON data files …');
    const jsonFiles = copyJsonDataFiles(tmpDir);

    // 3. Create ZIP
    console.log('[3/4] Creating ZIP archive …');
    const zipSize = await createZip(tmpDir, zipPath);
    const sizeMB = (zipSize / (1024 * 1024)).toFixed(2);
    console.log(`  ✔ ${zipPath} (${sizeMB} MB)`);

    // 4. Send to Telegram
    console.log('[4/4] Sending to Telegram …');
    const caption =
        `🗄 BVOX Backup — ${ts} (MMT)\n` +
        `📦 ${mongoResults.length} collections, ${jsonFiles.length} JSON files\n` +
        `💾 ${sizeMB} MB`;

    if (!getBotToken() || !getChatId()) {
        console.warn('  ⚠ TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set – skipping Telegram send');
        console.log('  ℹ ZIP saved locally at:', zipPath);
    } else {
        // Telegram file size limit = 50 MB for bots
        if (zipSize > 50 * 1024 * 1024) {
            console.warn('  ⚠ ZIP exceeds 50 MB Telegram limit – sending notification only');
            await sendTelegramMessage(`⚠️ Backup too large to send (${sizeMB} MB)\n${caption}`);
        } else {
            try {
                await sendTelegramFile(zipPath, caption);
                console.log('  ✔ Sent to Telegram successfully');
            } catch (e) {
                console.error('  ✖ Telegram send failed:', e.message);
                // Try sending error notification
                try { await sendTelegramMessage(`❌ Backup file send failed: ${e.message}\n\nBackup saved locally.`); } catch {}
            }
        }
    }

    // 5. Clean up temp directory (keep the ZIP)
    fs.rmSync(tmpDir, { recursive: true, force: true });

    // 6. Clean up old backups (keep last 7 days)
    cleanOldBackups(7);

    console.log('\n✅ Backup complete\n');
    return zipPath;
}

/**
 * Delete backup ZIPs older than `keepDays` days.
 */
function cleanOldBackups(keepDays) {
    try {
        const files = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('bvox-backup-') && f.endsWith('.zip'));
        const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
        let removed = 0;
        for (const f of files) {
            const fp = path.join(BACKUP_DIR, f);
            const stat = fs.statSync(fp);
            if (stat.mtimeMs < cutoff) {
                fs.unlinkSync(fp);
                removed++;
            }
        }
        if (removed) console.log(`  🗑 Removed ${removed} old backup(s)`);
    } catch {}
}

// ───── Export & standalone execution ─────

module.exports = { runBackup, sendTelegramMessage, sendTelegramFile };

// If run directly: node scripts/db-backup-telegram.js
if (require.main === module) {
    require('dotenv').config({ path: path.join(ROOT, '.env') });
    // Re-read after dotenv
    Object.defineProperty(module.exports, '_BOT_TOKEN', { get: () => process.env.TELEGRAM_BOT_TOKEN });

    runBackup()
        .then(() => {
            // Disconnect mongoose if we connected
            if (mongoose.connection.readyState === 1) mongoose.disconnect();
            process.exit(0);
        })
        .catch(err => {
            console.error('Backup failed:', err);
            if (mongoose.connection.readyState === 1) mongoose.disconnect();
            process.exit(1);
        });
}
