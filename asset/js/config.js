// ==========================================
// CONFIG.JS - Setup & State (Cloudflare D1 / REST Architecture)
// Zero Firebase keys required!
// ==========================================

const API_BASE = '/api';

// 1. BOARD DEFINITIONS
const BOARDS = {
    // === SFW (Surface) ===
    'myvt':  { title: '/myvt/ - MY VTuber',             type: 'sfw' },
    'vt':    { title: '/vt/ - SEA & Global VTuber',     type: 'sfw' },
    'vg':    { title: '/vg/ - Video Games',             type: 'sfw' },
    'amg':   { title: '/amg/ - Anime & Manga',          type: 'sfw' },
    'ca':    { title: '/ca/ - Cosplay & Art',           type: 'sfw' },
    'tech':  { title: '/tech/ - Tech Stuff',            type: 'sfw' },
    'mamak': { title: '/mamak/ - MY Stuff & Off-topic', type: 'sfw' },
    'rqr':   { title: '/rqr/ - Board Request & Report', type: 'sfw' },

    // === NSFW (Hidden / Black Boards) ===
    'myvth': { title: '/myvth/ - MY VTuber Ecchi & H',  type: 'nsfw' },
    'vth':   { title: '/vth/ - Vtuber Ecchi & H',       type: 'nsfw' },
    'hm':    { title: '/hm/ - H Media',                 type: 'nsfw' },
    'hg':    { title: '/hg/ - H Games',                 type: 'nsfw' }
};

// 2. GLOBAL ROUTE & APP STATE
const urlParams = new URLSearchParams(window.location.search);
let currentBoard = urlParams.get('b'); 
let currentThreadId = null;
let currentUser = null;
let authToken = localStorage.getItem('myvt_token') || null;
let autoUpdateTimer = null;
let isAutoUpdateEnabled = true;

const ARCHIVE_TIME_MS = 3 * 24 * 60 * 60 * 1000; // 3 Days

// In-memory cache for ETags to support HTTP 304 Not Modified caching across polling
const etagCache = new Map();

// Helper: API fetch wrapper with Auth header, ETag caching, signal support, and 304 Not Modified handling
async function apiFetch(endpoint, options = {}) {
    const isGet = !options.method || options.method === 'GET';
    const fetchOptions = { ...options };
    const headers = options.headers ? { ...options.headers } : {};
    if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
    }
    if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
        fetchOptions.body = JSON.stringify(options.body);
    }
    // For GET requests, attach stored ETag if available
    if (isGet && etagCache.has(endpoint)) {
        headers['If-None-Match'] = etagCache.get(endpoint).etag;
    }
    fetchOptions.headers = headers;

    const response = await fetch(API_BASE + endpoint, fetchOptions);

    // Sync notification and watchlist count from response headers if present
    const unreadHeader = response.headers.get('x-unread-notifications');
    if (unreadHeader !== null) {
        const unread = parseInt(unreadHeader, 10);
        const badge = document.getElementById('replyBadge');
        if (badge) {
            if (unread > 0) {
                badge.innerText = unread;
                badge.style.display = 'inline';
            } else {
                badge.style.display = 'none';
            }
        }
    }
    const watchHeader = response.headers.get('x-watchlist-count');
    if (watchHeader !== null) {
        const badge = document.getElementById('watchlistBadge');
        if (badge) badge.innerText = `(${watchHeader})`;
    }

    // 304 Not Modified: return cached data with notModified flag
    if (response.status === 304) {
        const cached = etagCache.get(endpoint);
        return cached ? { ...cached.data, notModified: true } : { notModified: true };
    }

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    const data = await response.json();

    // Also sync perks from JSON body user_sync if present
    if (data && data.user_sync) {
        if (data.user_sync.unread_notifications !== undefined) {
            const unread = data.user_sync.unread_notifications;
            const badge = document.getElementById('replyBadge');
            if (badge) {
                if (unread > 0) {
                    badge.innerText = unread;
                    badge.style.display = 'inline';
                } else {
                    badge.style.display = 'none';
                }
            }
        }
        if (data.user_sync.watchlist_count !== undefined) {
            const wBadge = document.getElementById('watchlistBadge');
            if (wBadge) wBadge.innerText = `(${data.user_sync.watchlist_count})`;
        }
    }

    const etag = response.headers.get('ETag');
    if (isGet && etag) {
        etagCache.set(endpoint, { etag, data });
    } else if (!isGet) {
        // Invalidate GET cache on mutation (POST/PUT/DELETE)
        etagCache.clear();
    }
    return data;
}
