/**
 * walletAutoConnect.js
 * Attempt to auto-connect a wallet (MetaMask / injected) and call backend
 * to get-or-create a user. On success it stores the user ID and redirects
 * back to the original page (returnUrl query param).
 */

(function () {
    'use strict';

    function q(name) {
        name = name.replace(/[\[]/, '\\[').replace(/[\]]/, '\\]');
        const results = new RegExp('[\\?&]' + name + '=([^&#]*)').exec(location.search);
        return results === null ? null : decodeURIComponent(results[1].replace(/\+/g, ' '));
    }

    const returnUrl = q('returnUrl') || '/';
    const statusEl = document.getElementById('status');
    const retryBtn = document.getElementById('retry');

    retryBtn.addEventListener('click', () => {
        attemptConnect();
    });

    async function attemptConnect() {
        setStatus('Starting connect...');

        // Determine API base
        const base = (typeof apiurl !== 'undefined') ? apiurl : (window.WALLET_AUTH_CONFIG && window.WALLET_AUTH_CONFIG.apiUrl) || 'http://localhost:5000';

        try {
            if (!window.ethereum) {
                setStatus('No injected wallet found. Open this page inside your wallet app.');
                return;
            }

            // Request accounts (this will prompt the wallet in most mobile wallets)
            setStatus('Requesting account access from wallet...');
            let accounts = [];
            try {
                accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
            } catch (err) {
                // Fallback: try eth_accounts (may be silent)
                try {
                    accounts = await window.ethereum.request({ method: 'eth_accounts' });
                } catch (e2) {
                    throw err;
                }
            }

            if (!accounts || accounts.length === 0) {
                setStatus('No accounts returned. Please approve connection in your wallet and retry.');
                return;
            }

            const address = accounts[0];
            setStatus('Connected: ' + address + '\nChecking server for user...');

            // Call backend get-or-create endpoint to create or retrieve user
            const endpoint = base.replace(/\/$/, '') + '/wallet/get-or-create-user';

            const resp = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    address: address,
                    walletType: (window.ethereum && window.ethereum.isMetaMask) ? 'metamask' : 'injected',
                    userAgent: navigator.userAgent
                })
            });

            const result = await resp.json();
            if (result && result.code === 1 && result.data && result.data.userId) {
                const uid = String(result.data.userId);
                // Save user ID / address in multiple storages (consistent with walletAuth.js)
                try { Cookies.set('walletUserId', uid, { expires: 365 }); } catch (e) {}
                try { Cookies.set('userid', uid, { expires: 365 }); } catch (e) {}
                try { Cookies.set('walletAddress', address, { expires: 7 }); } catch (e) {}
                try { localStorage.setItem('walletUserId', uid); } catch (e) {}
                try { sessionStorage.setItem('walletUserId', uid); } catch (e) {}

                setStatus('Success! Logged in as ' + uid + '. Redirecting...');
                setTimeout(() => {
                    location.href = returnUrl;
                }, 800);
                return;
            }

            // If backend returned failure, show message
            setStatus('Server did not return a user: ' + (result && result.message ? result.message : 'unknown'));

        } catch (error) {
            console.error('Auto-connect error', error);
            setStatus('Error during auto-connect: ' + (error && error.message ? error.message : String(error)));
        }
    }

    function setStatus(txt) {
        if (!statusEl) return;
        statusEl.textContent = txt;
    }

    // Start immediately
    document.addEventListener('DOMContentLoaded', function () {
        attemptConnect();
    });

})();
