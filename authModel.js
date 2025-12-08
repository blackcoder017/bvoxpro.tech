const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Data file path - prefer local `admins.json` in the repo root
const adminsFile = path.join(__dirname, 'admins.json');
const legacyAdminsFile = path.join(__dirname, '..', 'admins.json');

/**
 * Hash password
 */
function hashPassword(password) {
    return crypto.createHash('sha256').update(password + 'BVOX_SALT_2024').digest('hex');
}

/**
 * Generate JWT-like token (simple implementation)
 */
function generateToken(adminId) {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64');
    const payload = Buffer.from(JSON.stringify({
        adminId: adminId,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours
    })).toString('base64');
    const signature = crypto.createHmac('sha256', 'BVOX_SECRET_2024')
        .update(`${header}.${payload}`)
        .digest('base64');
    
    return `${header}.${payload}.${signature}`;
}

/**
 * Verify token
 */
function verifyToken(token) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;

        const [header, payload, signature] = parts;
        const expectedSignature = crypto.createHmac('sha256', 'BVOX_SECRET_2024')
            .update(`${header}.${payload}`)
            .digest('base64');

        if (signature !== expectedSignature) return null;

        const decoded = JSON.parse(Buffer.from(payload, 'base64').toString());
        if (decoded.exp < Math.floor(Date.now() / 1000)) return null; // Token expired

        return decoded;
    } catch (e) {
        return null;
    }
}

/**
 * Get all admins
 */
function getAllAdmins() {
    try {
        let fileToRead = null;

        // Prefer the local admins file; fall back to a legacy parent path if needed
        if (fs.existsSync(adminsFile)) {
            fileToRead = adminsFile;
        } else if (fs.existsSync(legacyAdminsFile)) {
            fileToRead = legacyAdminsFile;
        }

        if (!fileToRead) return [];

        console.log('[authModel] getAllAdmins will read admins file:', fileToRead);

        const data = fs.readFileSync(fileToRead, 'utf8') || '[]';
        let admins = JSON.parse(data);

        console.log('[authModel] getAllAdmins parsed admins count:', Array.isArray(admins) ? admins.length : 0);

        // Normalize admin IDs to Admin-### format if needed
        const needsNormalization = admins.some(a => !/^Admin-\d{3}$/.test(String(a.id)));
        if (needsNormalization) {
            // Sort by created_at (oldest first) to assign stable IDs
            admins.sort((x, y) => {
                const tx = x && x.created_at ? new Date(x.created_at).getTime() : 0;
                const ty = y && y.created_at ? new Date(y.created_at).getTime() : 0;
                return tx - ty;
            });

            for (let i = 0; i < admins.length; i++) {
                admins[i].id = 'Admin-' + String(i + 1).padStart(3, '0');
            }

            // Persist normalized admins to the preferred local file
            try {
                fs.writeFileSync(adminsFile, JSON.stringify(admins, null, 2));
            } catch (e) {
                console.error('[authModel] Failed to write normalized admins file:', e.message);
            }
        }

        console.log('[authModel] getAllAdmins returning admin ids:', (admins || []).map(a => a && a.id).slice(0, 10));
        return admins;
    } catch (e) {
        console.error('Error reading admins:', e);
        return [];
    }
}

/**
 * Generate next admin ID in format Admin-001, Admin-002, ...
 */
function generateNextAdminId() {
    const admins = getAllAdmins();
    let maxNum = 0;
    admins.forEach(a => {
        if (!a || !a.id) return;
        // look for trailing number in the id
        const m = String(a.id).match(/(\d+)$/);
        if (m && m[1]) {
            const n = parseInt(m[1], 10);
            if (Number.isFinite(n) && n > maxNum) maxNum = n;
        }
    });
    const next = maxNum + 1;
    return 'Admin-' + String(next).padStart(3, '0');
}

/**
 * Get admin by username
 */
function getAdminByUsername(username) {
    const admins = getAllAdmins();
    return admins.find(a => a.username === username);
}

/**
 * Get admin by ID
 */
function getAdminById(adminId) {
    const admins = getAllAdmins();
    return admins.find(a => a.id === adminId);
}

/**
 * Register new admin
 */
function registerAdmin(fullname, username, email, password) {
    const admins = getAllAdmins();

    // Check if username already exists
    if (admins.find(a => a.username === username)) {
        throw new Error('Username already exists');
    }

    // Check if email already exists
    if (admins.find(a => a.email === email)) {
        throw new Error('Email already registered');
    }

    const admin = {
        id: generateNextAdminId(),
        fullname: fullname,
        username: username,
        email: email,
        password: hashPassword(password),
        created_at: new Date().toISOString(),
        status: 'active',
        lastLogin: null
    };

    admins.push(admin);
    fs.writeFileSync(adminsFile, JSON.stringify(admins, null, 2));

    return admin;
}

/**
 * Login admin
 */
function loginAdmin(username, password) {
    const admin = getAdminByUsername(username);

    if (!admin) {
        throw new Error('Invalid username or password');
    }

    const hashedPassword = hashPassword(password);
    if (admin.password !== hashedPassword) {
        throw new Error('Invalid username or password');
    }

    if (admin.status !== 'active') {
        throw new Error('Account is not active');
    }

    // Update last login
    const admins = getAllAdmins();
    const adminIndex = admins.findIndex(a => a.id === admin.id);
    admins[adminIndex].lastLogin = new Date().toISOString();
    fs.writeFileSync(adminsFile, JSON.stringify(admins, null, 2));

    // Generate token
    const token = generateToken(admin.id);

    return {
        adminId: admin.id,
        username: admin.username,
        fullname: admin.fullname,
        token: token
    };
}

/**
 * Change password
 */
function changePassword(adminId, oldPassword, newPassword) {
    const admin = getAdminById(adminId);

    if (!admin) {
        throw new Error('Admin not found');
    }

    const oldHashedPassword = hashPassword(oldPassword);
    if (admin.password !== oldHashedPassword) {
        throw new Error('Old password is incorrect');
    }

    const admins = getAllAdmins();
    const adminIndex = admins.findIndex(a => a.id === adminId);
    admins[adminIndex].password = hashPassword(newPassword);
    fs.writeFileSync(adminsFile, JSON.stringify(admins, null, 2));

    return admins[adminIndex];
}

module.exports = {
    registerAdmin,
    loginAdmin,
    getAdminById,
    getAdminByUsername,
    getAllAdmins,
    changePassword,
    generateToken,
    verifyToken,
    hashPassword
};
