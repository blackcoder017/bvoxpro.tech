/**
 * Wallet Authentication System with User ID Management
 * Generates unique user IDs and tracks wallet addresses
 * Persists user identification across sessions
 */

class WalletAuthSystem {
    constructor() {
        this.userId = this.getUserId();
        this.walletAddress = null;
        this.sessionData = {};
        this.init();
    }

    /**
     * Initialize WalletAuthSystem.
     * This method is deliberately small — it triggers any startup actions
     * such as showing wallet-connect prompts if the user is not signed in.
     */
    init() {
        try {
            this.setupWalletConnectTrigger();
        } catch (err) {
            // Don't let initialization errors block page scripts
            console.warn('WalletAuthSystem.init() error:', err);
        }
    }

    /**
     * Detect common mobile in-app wallet browsers (Trust Wallet, MetaMask Mobile, Coinbase Wallet)
     */
    isInAppBrowser() {
        const ua = (navigator.userAgent || '').toLowerCase();
        // check for known wallet app identifiers
        if (/trust|metamask|walletconnect|coinbasewallet|coinbase|imtoken|imtoken\/|wallet/i.test(ua)) {
            // prefer mobile UAs
            if (/mobile|android|iphone|ipad/.test(ua)) return true;
        }
        return false;
    }

    /**
     * Setup wallet connect trigger on all pages
     * Shows wallet modal if user not connected
     */
    setupWalletConnectTrigger() {
        // Check if user is connected
        const userId = this.getUserId();
        
        if (!userId && typeof languageManager !== 'undefined') {
            console.log('🔗 Wallet connection required');
            this.showWalletConnectPrompt();
        }
    }

    /**
     * Show wallet connect prompt on page
     */
    showWalletConnectPrompt() {
        // Check if already showing
        if (document.getElementById('wallet-auth-modal')) {
            return;
        }

        const modal = document.createElement('div');
                // call init if defined later; initialize minimal state here
                if (typeof this.init === 'function') {
                    this.init();
                }
        modal.innerHTML = `
            // Note: Web3Modal connect hook is attached after the class definition
            // to avoid syntax errors caused by placing IIFEs inside class bodies.
                            font-weight: bold;
                            margin: 10px;
                            width: 100%;
                        ">
                            🦊 <span data-translate="连接MetaMask">Connect MetaMask</span>
                        </button>
                        
                        <button id="connect-walletconnect-btn" style="
                            background: linear-gradient(135deg, #3b99fc 0%, #0052ff 100%);
                            color: white;
                            border: none;
                            padding: 12px 30px;
                            border-radius: 8px;
                            cursor: pointer;
                            font-size: 16px;
                            font-weight: bold;
                            margin: 10px;
                            width: 100%;
                        ">
                            📱 <span data-translate="连接WalletConnect">Connect WalletConnect</span>
                        </button>
                    </div>

                    <p style="font-size: 12px; color: #666; margin-top: 20px;" data-translate="您的钱包信息将被加密保存">
                        Your wallet information will be securely stored
                    </p>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Setup button handlers
        document.getElementById('connect-metamask-btn').addEventListener('click', () => {
            this.connectMetaMask();
        });

        document.getElementById('connect-walletconnect-btn').addEventListener('click', () => {
            this.connectWalletConnect();
        });

        // Translate text if language manager available
        if (typeof languageManager !== 'undefined') {
            setTimeout(() => languageManager.applyLanguage(languageManager.currentLang), 100);
        }
    }

    /**
     * Connect MetaMask wallet
     */
    async connectMetaMask() {
        try {
            if (!window.ethereum) {
                alert('MetaMask not installed. Please install it first.');
                return;
            }

            // Request account access
            const accounts = await window.ethereum.request({
                method: 'eth_requestAccounts'
            });

            if (accounts && accounts.length > 0) {
                await this.handleWalletConnected(accounts[0], 'metamask');
            }
        } catch (error) {
            console.error('MetaMask connection error:', error);
            alert('Failed to connect MetaMask');
        }
    }

    /**
     * Connect WalletConnect
     */
    async connectWalletConnect() {
        try {
            // Placeholder for WalletConnect integration
            console.log('WalletConnect connection initiated');
            alert('WalletConnect integration coming soon');
        } catch (error) {
            console.error('WalletConnect connection error:', error);
        }
    }

    /**
     * Handle wallet connected - create or retrieve user ID
     */
    async handleWalletConnected(address, walletType) {
        try {
            console.log('🔗 Wallet Connected:', address);
            this.walletAddress = address;

            // Check if address already has an ID
            const response = await fetch(`${apiurl}/wallet/get-or-create-user`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    address: address,
                    walletType: walletType,
                    userAgent: navigator.userAgent,
                    ipAddress: await this.getUserIP(),
                })
            });

            const data = await response.json();

            if (data.code === 1) {
                // User created or retrieved
                const userId = data.data.userId;
                const isNewUser = data.data.isNew;

                // Save user ID
                this.setUserId(userId);

                // Set walletAddress cookie for auth-check.js
                Cookies.set('walletAddress', address, { expires: 7 });
                console.log('✓ Wallet address cookie set:', address);

                // Save session data
                this.saveSessionData({
                    userId: userId,
                    address: address,
                    walletType: walletType,
                    connectedAt: new Date().toISOString(),
                });

                // Show success message
                this.showSuccessMessage(userId, isNewUser);

                // Close modal and reload
                const modal = document.getElementById('wallet-auth-modal');
                if (modal) modal.remove();

                // Reload page after 2 seconds
                setTimeout(() => {
                    location.reload();
                }, 2000);
            } else {
                alert('Error: ' + data.message);
            }
        } catch (error) {
            console.error('Error handling wallet connection:', error);
            alert('Error connecting wallet: ' + error.message);
        }
    }

    /**
     * Show success message with generated user ID
     */
    showSuccessMessage(userId, isNewUser) {
        const message = document.createElement('div');
        message.innerHTML = `
            <div style="
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: white;
                padding: 40px;
                border-radius: 15px;
                text-align: center;
                z-index: 10000;
                box-shadow: 0 10px 40px rgba(0,0,0,0.3);
            ">
                <h2>${isNewUser ? '✨ New Account Created!' : '✓ Welcome Back!'}</h2>
                <p style="font-size: 18px; margin: 20px 0;">
                    <strong>Your User ID:</strong> <span style="color: #667eea; font-size: 24px; font-weight: bold;">${userId}</span>
                </p>
                <p style="color: #666; margin-top: 15px;">
                    ${isNewUser 
                        ? 'Your account has been created with this ID. Use it to identify your account.' 
                        : 'Your account has been identified.'}
                </p>
                <p style="color: #999; font-size: 12px; margin-top: 20px;">
                    This ID will be saved for future logins with this wallet address.
                </p>
            </div>
        `;

        document.body.appendChild(message);
    }

    /**
     * Get user IP address
     */
    async getUserIP() {
        try {
            const response = await fetch('https://api.ipify.org?format=json');
            const data = await response.json();
            return data.ip;
        } catch (error) {
            console.warn('Could not fetch IP address');
            return 'unknown';
        }
    }

    /**
     * Generate unique user ID
     */
    generateUserId() {
        // Format: 5 random digits (10000-99999)
        return Math.floor(Math.random() * 90000) + 10000;
    }

    /**
     * Set user ID in storage
     */
    setUserId(userId) {
        // Save in multiple places for redundancy
        Cookies.set('walletUserId', userId, { expires: 365 });
        // Also set legacy cookie key used across pages (`userid`) so existing pages find the ID
        try {
            Cookies.set('userid', String(userId), { expires: 365 });
        } catch (e) {
            // ignore if Cookies not available
        }
        localStorage.setItem('walletUserId', userId);
        sessionStorage.setItem('walletUserId', userId);
        console.log('✓ User ID saved:', userId);
    }

    /**
     * Get user ID from storage
     */
    getUserId() {
        // Try to get from different sources
        let userId = Cookies.get('walletUserId');
        if (!userId) userId = localStorage.getItem('walletUserId');
        if (!userId) userId = sessionStorage.getItem('walletUserId');
        return userId;
    }

    /**
     * Save session data to backend
     */
    async saveSessionData(data) {
        try {
            await fetch(`${apiurl}/wallet/save-session`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data)
            });
        } catch (error) {
            console.error('Error saving session data:', error);
        }
    }

    /**
     * Check if wallet is connected
     */
    isConnected() {
        return !!this.getUserId();
    }

    /**
     * Get current user ID
     */
    getCurrentUserId() {
        return this.getUserId();
    }

    /**
     * Get current wallet address
     */
    async getCurrentWalletAddress() {
        if (!window.ethereum) return null;
        try {
            const accounts = await window.ethereum.request({
                method: 'eth_accounts'
            });
            return accounts[0] || null;
        } catch (error) {
            return null;
        }
    }

    /**
     * Logout user
     */
    logout() {
        Cookies.remove('walletUserId');
        localStorage.removeItem('walletUserId');
        sessionStorage.removeItem('walletUserId');
        this.walletAddress = null;
        console.log('✓ User logged out');
        location.reload();
    }

    /**
     * Get session info
     */
    getSessionInfo() {
        return {
            userId: this.getUserId(),
            walletAddress: this.walletAddress,
            userAgent: navigator.userAgent,
            sessionData: this.sessionData,
        };
    }
}

// Initialize globally on page load
let walletAuthSystem;
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
        walletAuthSystem = new WalletAuthSystem();
    });
} else {
    walletAuthSystem = new WalletAuthSystem();
}

// --- Web3Modal connect hook (moved outside class) ---
(function attachWeb3ModalConnectHook() {
    try {
        const W = window.Web3Modal && window.Web3Modal.default;
        if (!W || W.__connectHookApplied) return;

        const origConnect = W.prototype.connect;
        if (typeof origConnect !== 'function') return;

        W.prototype.connect = async function patchedConnect() {
            const provider = await origConnect.apply(this, arguments);

            // best-effort: try to obtain the first account/address
            (async () => {
                try {
                    let address = null;
                    // common fields from providers
                    if (provider.accounts && provider.accounts.length) {
                        address = provider.accounts[0];
                    } else if (provider.selectedAddress) {
                        address = provider.selectedAddress;
                    } else if (provider.address) {
                        address = provider.address;
                    } else if (provider.wc && provider.wc.accounts && provider.wc.accounts.length) {
                        address = provider.wc.accounts[0];
                    } else if (typeof provider.request === 'function') {
                        try {
                            const accs = await provider.request({ method: 'eth_accounts' });
                            if (accs && accs.length) address = accs[0];
                        } catch (e) {
                            // ignore
                        }
                    }

                    if (address) {
                        // POST to backend endpoint to create/get user (non-blocking)
                        try {
                            await fetch('/wallet/get-or-create-user', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    address: address,
                                    walletType: 'walletconnect',
                                    userAgent: navigator.userAgent,
                                }),
                            });
                        } catch (e) {
                            // swallow network errors - we don't want to break the connect flow
                            console.warn('web3connect-hook: failed to notify backend', e);
                        }
                    }
                } catch (err) {
                    // safe-guard: do not throw
                    console.warn('web3connect-hook error', err);
                }
            })();

            return provider;
        };

        W.__connectHookApplied = true;
        console.log('web3connect-hook: applied Web3Modal connect hook');
    } catch (err) {
        console.warn('web3connect-hook: could not attach hook', err);
    }
})();
