/**
 * Database Restore from Backup ZIP
 * ----------------------------------
 * Imports all MongoDB collections from a backup ZIP file.
 * 
 * Usage:
 *   node scripts/db-restore.js                         # uses latest backup
 *   node scripts/db-restore.js backups/bvox-backup-2026-03-02T23-59-46.zip
 *
 * What it restores:
 *   - All MongoDB collections (users, wallets, trades, topups, withdrawals, etc.)
 *   - JSON fallback files (wallets.json, users.json, nonces.json)
 *
 * Steps for new VPS:
 *   1. git clone / git pull your repo
 *   2. npm install
 *   3. Set MONGODB_URI in .env (or use local MongoDB)
 *   4. node scripts/db-restore.js <backup-file.zip>
 *   5. npm run dev
 */

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const ROOT = path.resolve(__dirname, '..');
const BACKUP_DIR = path.join(ROOT, 'backups');
const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.MONGODBURL || 'mongodb://127.0.0.1:27017/bvoxpro';

// ───── Find backup file ─────

function findBackupFile() {
    const arg = process.argv[2];
    if (arg) {
        const p = path.resolve(arg);
        if (!fs.existsSync(p)) { console.error(`File not found: ${p}`); process.exit(1); }
        return p;
    }
    // Find latest in backups/
    if (!fs.existsSync(BACKUP_DIR)) { console.error('No backups/ directory found'); process.exit(1); }
    const zips = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('bvox-backup-') && f.endsWith('.zip')).sort();
    if (!zips.length) { console.error('No backup files found in backups/'); process.exit(1); }
    return path.join(BACKUP_DIR, zips[zips.length - 1]);
}

// ───── Extract ZIP ─────

function extractZip(zipPath, outDir) {
    // Use built-in Node.js zlib + manual zip parsing won't work easily,
    // so we use a lightweight approach with the archiver's counterpart
    const AdmZip = (() => {
        try { return require('adm-zip'); } catch { return null; }
    })();

    if (AdmZip) {
        const zip = new AdmZip(zipPath);
        zip.extractAllTo(outDir, true);
        return;
    }

    // Fallback: use PowerShell / unzip / tar on the system
    const { execSync } = require('child_process');
    if (process.platform === 'win32') {
        execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${outDir}' -Force"`, { stdio: 'inherit' });
    } else {
        execSync(`unzip -o "${zipPath}" -d "${outDir}"`, { stdio: 'inherit' });
    }
}

// ───── Restore ─────

async function restore() {
    const zipPath = findBackupFile();
    console.log(`\n═══════════════════════════════════════════`);
    console.log(`  BVOX Database Restore`);
    console.log(`═══════════════════════════════════════════`);
    console.log(`  Source: ${path.basename(zipPath)}\n`);

    // 1. Extract to temp directory
    const tmpDir = path.join(BACKUP_DIR, '_restore_tmp_' + Date.now());
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    console.log('[1/4] Extracting backup …');
    extractZip(zipPath, tmpDir);

    // List extracted files
    const allFiles = fs.readdirSync(tmpDir);
    const jsonFiles = allFiles.filter(f => f.endsWith('.json'));
    console.log(`  ✔ Extracted ${allFiles.length} items (${jsonFiles.length} collection files)\n`);

    // 2. Connect to MongoDB
    console.log('[2/4] Connecting to MongoDB …');
    try {
        await mongoose.connect(MONGO_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            serverSelectionTimeoutMS: 10000,
        });
        console.log(`  ✔ Connected to ${MONGO_URI.replace(/\/\/([^:]+):[^@]+@/, '//$1:***@')}\n`);
    } catch (e) {
        console.error(`  ✖ Cannot connect to MongoDB: ${e.message}`);
        console.error(`  → Make sure MongoDB is running and MONGODB_URI is set in .env`);
        fs.rmSync(tmpDir, { recursive: true, force: true });
        process.exit(1);
    }

    const db = mongoose.connection.db;

    // 3. Import collections
    console.log('[3/4] Importing collections …');
    let imported = 0;
    let totalDocs = 0;
    const skipped = [];

    for (const file of jsonFiles) {
        const colName = path.basename(file, '.json');
        const filePath = path.join(tmpDir, file);

        try {
            const raw = fs.readFileSync(filePath, 'utf8');
            const docs = JSON.parse(raw);

            if (!Array.isArray(docs)) {
                skipped.push(`${colName} (not an array)`);
                continue;
            }
            if (docs.length === 0) {
                console.log(`  ⊘ ${colName}  (empty – skipped)`);
                continue;
            }

            // Convert _id strings back to ObjectId where possible
            const cleanDocs = docs.map(doc => {
                const d = { ...doc };
                if (d._id && typeof d._id === 'string' && /^[0-9a-f]{24}$/i.test(d._id)) {
                    d._id = new mongoose.Types.ObjectId(d._id);
                } else if (d._id && typeof d._id === 'object' && d._id.$oid) {
                    d._id = new mongoose.Types.ObjectId(d._id.$oid);
                }
                // Convert date strings back
                for (const key of Object.keys(d)) {
                    if (typeof d[key] === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(d[key])) {
                        const dt = new Date(d[key]);
                        if (!isNaN(dt.getTime())) d[key] = dt;
                    }
                }
                return d;
            });

            // Drop existing collection and re-import
            try { await db.collection(colName).drop(); } catch {}
            await db.collection(colName).insertMany(cleanDocs, { ordered: false });

            imported++;
            totalDocs += cleanDocs.length;
            console.log(`  ✔ ${colName}  (${cleanDocs.length} docs)`);
        } catch (e) {
            console.warn(`  ✖ ${colName}: ${e.message}`);
        }
    }

    // 4. Restore JSON fallback files
    console.log('\n[4/4] Restoring JSON data files …');
    const jsonDataDir = path.join(tmpDir, 'json-files');
    let jsonRestored = 0;
    if (fs.existsSync(jsonDataDir)) {
        const dataFiles = fs.readdirSync(jsonDataDir).filter(f => f.endsWith('.json'));
        for (const file of dataFiles) {
            const src = path.join(jsonDataDir, file);
            const dest = path.join(ROOT, file);
            try {
                // Backup existing file before overwriting
                if (fs.existsSync(dest)) {
                    fs.copyFileSync(dest, dest + '.pre-restore.bak');
                }
                fs.copyFileSync(src, dest);
                jsonRestored++;
                console.log(`  ✔ ${file}`);
            } catch (e) {
                console.warn(`  ✖ ${file}: ${e.message}`);
            }
        }
    } else {
        console.log('  ⊘ No json-files/ directory in backup');
    }

    // Clean up
    fs.rmSync(tmpDir, { recursive: true, force: true });

    // Summary
    console.log(`\n═══════════════════════════════════════════`);
    console.log(`  Restore Complete`);
    console.log(`═══════════════════════════════════════════`);
    console.log(`  MongoDB: ${imported} collections, ${totalDocs} documents`);
    console.log(`  JSON files: ${jsonRestored} restored`);
    if (skipped.length) console.log(`  Skipped: ${skipped.join(', ')}`);
    console.log(`\n  ✅ Your database is ready. Run: npm run dev\n`);
}

// ───── Run ─────

restore()
    .then(() => {
        if (mongoose.connection.readyState === 1) mongoose.disconnect();
        process.exit(0);
    })
    .catch(err => {
        console.error('\n❌ Restore failed:', err.message);
        if (mongoose.connection.readyState === 1) mongoose.disconnect();
        process.exit(1);
    });
