/**
 * Global Configuration File
 * Contains API URLs, constants, and shared settings
 */

// API Configuration
// Default to same-origin `/api` for production deployments.
// When developing locally, keep the localhost backend URL.
const API_CONFIG = {
    // Use localhost backend during local development, otherwise use same-origin
    baseURL: (typeof window !== 'undefined' && window.location && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'))
        ? '/api'
        : '/api',
    timeout: 10000, // API request timeout in ms
};

// WebSocket Configuration for Live Data
const WS_CONFIG = {
    huobi: 'wss://api.huobi.pro/ws', // Huobi real-time price feed
};

// App Constants
const APP_CONFIG = {
    cookieExpiry: 7, // Cookie expiry in days
    appName: 'BVOX Finance',
    version: '2.0',
};

// Supported Cryptocurrencies
const CRYPTOCURRENCIES = {
    BTC: { symbol: 'BTC', name: 'Bitcoin', pair: 'btcusdt' },
    ETH: { symbol: 'ETH', name: 'Ethereum', pair: 'ethusdt' },
    DOGE: { symbol: 'DOGE', name: 'Dogecoin', pair: 'dogeusdt' },
    BCH: { symbol: 'BCH', name: 'Bitcoin Cash', pair: 'bchusdt' },
    LTC: { symbol: 'LTC', name: 'Litecoin', pair: 'ltcusdt' },
    XRP: { symbol: 'XRP', name: 'Ripple', pair: 'xrpusdt' },
    TRX: { symbol: 'TRX', name: 'TRON', pair: 'trxusdt' },
    SOL: { symbol: 'SOL', name: 'Solana', pair: 'solusdt' },
    ADA: { symbol: 'ADA', name: 'Cardano', pair: 'adausdt' },
    BSV: { symbol: 'BSV', name: 'Bitcoin SV', pair: 'bsvusdt' },
    LINK: { symbol: 'LINK', name: 'Chainlink', pair: 'linkusdt' },
};

// API URL Helper Function
const apiurl = API_CONFIG.baseURL;

// Helper: Get cookie value
function getCookie(name) {
    if (typeof Cookies !== 'undefined') {
        return Cookies.get(name);
    }
    return null;
}

// Helper: Set cookie value
function setCookie(name, value, days = 7) {
    if (typeof Cookies !== 'undefined') {
        Cookies.set(name, value, { expires: days });
    }
}

// Helper: Remove cookie
function removeCookie(name) {
    if (typeof Cookies !== 'undefined') {
        Cookies.remove(name);
    }
}

// Helper: Get current user ID from cookie
function getCurrentUserId() {
    return getCookie('userid');
}

// Helper: Check if user is logged in
function isUserLoggedIn() {
    return getCookie('userid') != null;
}

// Helper: Logout user
function logoutUser() {
    removeCookie('userid');
    removeCookie('username');
    removeCookie('ytoken');
    window.location.href = '/';
}

// Language/Translation Helper (placeholder - expand as needed)
// Translation loader & helper implementation
var translations = {};  // global object to store translations
var translationsLoaded = false; // flag indicating translations loaded
var loadingInProgress = false;  // flag indicating loading in progress
var missingTranslationKeys = {};

function loadTranslationsSync() {
    // If already loaded or currently loading, skip
    if (translationsLoaded || loadingInProgress) return;
    loadingInProgress = true;
    try {
        var lang = (typeof Cookies !== 'undefined' && Cookies.get('ylang')) ? Cookies.get('ylang') : 'en';
        var filePath = '/lang/' + lang + '.json';

        if (typeof $ !== 'undefined' && $.ajax) {
            // Use synchronous ajax to ensure translations are available immediately
            $.ajax({
                url: filePath,
                dataType: 'json',
                async: false,
                success: function(json) {
                    translations = json || {};
                    translationsLoaded = true;
                    loadingInProgress = false;
                },
                error: function() {
                    // Try fallback to en.json
                    try {
                        $.ajax({
                            url: '/lang/en.json',
                            dataType: 'json',
                            async: false,
                            success: function(json) {
                                translations = json || {};
                                translationsLoaded = true;
                            },
                            error: function() {
                                console.error('Failed to load translations and fallback to en.json.');
                                translations = {};
                                translationsLoaded = true;
                            }
                        });
                    } catch (innerErr) {
                        console.error('Translation fallback error', innerErr);
                        translations = {};
                        translationsLoaded = true;
                    }
                    loadingInProgress = false;
                }
            });
        } else if (typeof fetch !== 'undefined') {
            // Fallback to fetch (async), try to load en.json synchronously isn't possible
            // We'll load async and mark translationsLoaded when done; until then gy returns the original key
            fetch(filePath)
                .then(function(r) { return r.json(); })
                .then(function(json) { translations = json || {}; translationsLoaded = true; loadingInProgress = false; })
                .catch(function() {
                    return fetch('/lang/en.json');
                })
                .then(function(resp) { if (resp && resp.json) { resp.json().then(function(json) { translations = json || {}; translationsLoaded = true; loadingInProgress = false; }); } })
                .catch(function(err) { console.error('Failed to load translations:', err); translations = {}; translationsLoaded = true; loadingInProgress = false; });
        } else {
            console.warn('No ajax/fetch available to load translations; skipping');
            translations = {};
            translationsLoaded = true;
            loadingInProgress = false;
        }
    } catch (e) {
        console.error('Error during loadTranslationsSync:', e);
        translations = {};
        translationsLoaded = true;
        loadingInProgress = false;
    }
}

function gy(text) {
    if (!translationsLoaded) {
        loadTranslationsSync();
    }
    if (!text || typeof text !== 'string') return text;
    if (translations && Object.prototype.hasOwnProperty.call(translations, text)) {
        return translations[text];
    }
    // Log missing translation to help debug, but avoid spamming console if key isn't a non-ascii short string
    if (text && text.length < 64) {
        if (!missingTranslationKeys[text]) {
            try { console.warn('Translation missing for key: ' + text); } catch (e) {}
            missingTranslationKeys[text] = 1;
        }
    }
    return text;
}
