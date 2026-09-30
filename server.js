import express from 'express';
import path from 'path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'url';
import { db, hashPassword, verifyPassword, hashIp, generateId } from './server/db.js';
import { 
    calculateLevel, 
    getRank, 
    awardUserXP, 
    drawRandomOmikuji, 
    getTodayDateStr, 
    XP_RULES, 
    ALLOWED_OSHI_BADGES 
} from './server/gamification.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || process.env.APP_PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Board definitions
const BOARDS = {
    'myvt':  { title: '/myvt/ - MY VTuber',             type: 'sfw' },
    'vt':    { title: '/vt/ - SEA & Global VTuber',     type: 'sfw' },
    'vg':    { title: '/vg/ - Video Games',             type: 'sfw' },
    'amg':   { title: '/amg/ - Anime & Manga',          type: 'sfw' },
    'ca':    { title: '/ca/ - Cosplay & Art',           type: 'sfw' },
    'tech':  { title: '/tech/ - Tech Stuff',            type: 'sfw' },
    'mamak': { title: '/mamak/ - MY Stuff & Off-topic', type: 'sfw' },
    'rqr':   { title: '/rqr/ - Board Request & Report', type: 'sfw' },
    'myvth': { title: '/myvth/ - MY VTuber Ecchi & H',  type: 'nsfw' },
    'vth':   { title: '/vth/ - Vtuber Ecchi & H',       type: 'nsfw' },
    'hm':    { title: '/hm/ - H Media',                 type: 'nsfw' },
    'hg':    { title: '/hg/ - H Games',                 type: 'nsfw' }
};

const ARCHIVE_TIME_MS = 3 * 24 * 60 * 60 * 1000; // 3 Days

// Auth Middleware: extract user from Bearer token
function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        try {
            const session = db.prepare(`
                SELECT s.token, s.user_id, s.role, s.username, s.display_title
                FROM sessions s
                WHERE s.token = ?
            `).get(token);
            if (session) {
                req.user = session;
            }
        } catch (err) {
            console.error('Session lookup error:', err);
        }
    }
    next();
}

app.use(authMiddleware);

// Helper: Calculate lightweight user perks sync data (unread notifs & watchlist count)
function getUserSyncData(userId) {
    if (!userId) return null;
    try {
        const notifRow = db.prepare(`
            SELECT COUNT(*) as unread_count
            FROM replies r
            JOIN threads t ON t.id = r.thread_id
            WHERE (r.user_id IS NULL OR r.user_id != ?)
              AND (
                t.user_id = ?
                OR EXISTS (
                    SELECT 1 FROM replies my_r
                    WHERE my_r.user_id = ? AND r.comment LIKE '%' || my_r.id || '%'
                )
              )
        `).get(userId, userId, userId);

        const watchRow = db.prepare(`
            SELECT COUNT(*) as watch_count
            FROM watchlist
            WHERE user_id = ?
        `).get(userId);

        return {
            unread_notifications: notifRow ? notifRow.unread_count : 0,
            watchlist_count: watchRow ? watchRow.watch_count : 0
        };
    } catch (e) {
        return null;
    }
}

// --- API ROUTES ---

// In-memory cache for Pixiv artwork details
const pixivArtworkCache = new Map();

// Pixiv Image Reverse Proxy to bypass Pixiv CDN hotlink protection
app.get('/api/proxy/pixiv', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl || typeof targetUrl !== 'string') {
        return res.status(400).send('Missing url parameter');
    }

    let parsedUrl;
    try {
        parsedUrl = new URL(targetUrl);
    } catch (_) {
        return res.status(400).send('Invalid url format');
    }

    // SSRF protection: only allow pximg.net domains
    const hostname = parsedUrl.hostname.toLowerCase();
    if (hostname !== 'pximg.net' && !hostname.endsWith('.pximg.net')) {
        return res.status(403).send('Only pximg.net domains are supported');
    }

    try {
        let upstreamResp = await fetch(targetUrl, {
            headers: {
                'Referer': 'https://www.pixiv.net/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
            }
        });

        // If upstream Pixiv blocks or rate limits, fallback seamlessly to community proxy helper i.pixiv.re
        if (!upstreamResp.ok) {
            const helperUrl = targetUrl.replace(/^https?:\/\/[a-zA-Z0-9-]+\.pximg\.net\//i, 'https://i.pixiv.re/');
            try {
                const helperResp = await fetch(helperUrl);
                if (helperResp.ok) {
                    upstreamResp = helperResp;
                }
            } catch (_) {}
        }

        if (!upstreamResp.ok) {
            return res.status(upstreamResp.status).send(`Upstream Pixiv error: ${upstreamResp.status}`);
        }

        const contentType = upstreamResp.headers.get('content-type') || 'image/jpeg';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
        res.setHeader('Access-Control-Allow-Origin', '*');

        const contentLength = upstreamResp.headers.get('content-length');
        if (contentLength) {
            res.setHeader('Content-Length', contentLength);
        }

        if (upstreamResp.body) {
            const stream = Readable.fromWeb(upstreamResp.body);
            stream.pipe(res);
        } else {
            const arrayBuffer = await upstreamResp.arrayBuffer();
            res.send(Buffer.from(arrayBuffer));
        }
    } catch (err) {
        console.error('Pixiv proxy error, trying helper fallback:', err);
        // Fallback to helper on network errors
        try {
            const helperUrl = targetUrl.replace(/^https?:\/\/[a-zA-Z0-9-]+\.pximg\.net\//i, 'https://i.pixiv.re/');
            const helperResp = await fetch(helperUrl);
            if (helperResp.ok) {
                res.setHeader('Content-Type', helperResp.headers.get('content-type') || 'image/jpeg');
                res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
                res.setHeader('Access-Control-Allow-Origin', '*');
                const stream = Readable.fromWeb(helperResp.body);
                return stream.pipe(res);
            }
        } catch (_) {}
        res.status(502).send('Error proxying Pixiv image');
    }
});

// Pixiv Artwork Metadata resolver with robust fallback to pixiv.re helper
app.get('/api/pixiv/artwork', async (req, res) => {
    const illustId = req.query.id;
    if (!illustId || !/^\d+$/.test(String(illustId).trim())) {
        return res.status(400).json({ error: 'Invalid or missing Pixiv illustration id' });
    }

    const cleanId = String(illustId).trim();
    if (pixivArtworkCache.has(cleanId)) {
        return res.json({ success: true, artwork: pixivArtworkCache.get(cleanId) });
    }

    try {
        let body = null;
        let isR18 = false;
        let title = `Artwork #${cleanId}`;
        let author = 'Pixiv Artist';
        let authorId = '';
        let pageCount = 1;
        let imageUrl = '';

        // 1. Attempt official Pixiv AJAX metadata fetch
        try {
            const resp = await fetch(`https://www.pixiv.net/ajax/illust/${cleanId}`, {
                headers: {
                    'Referer': `https://www.pixiv.net/artworks/${cleanId}`,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
                }
            });

            if (resp.ok) {
                const data = await resp.json();
                if (!data.error && data.body) {
                    body = data.body;
                    title = body.title || title;
                    author = body.userName || author;
                    authorId = body.userId || '';
                    pageCount = body.pageCount || 1;
                    isR18 = (body.xRestrict === 1 || body.xRestrict === 2);
                    imageUrl = body.urls?.regular || body.urls?.small || body.urls?.original || '';

                    // For R-18 works where Pixiv masks public urls, reconstruct from timestamp
                    if (!imageUrl) {
                        const userIllust = body.userIllusts?.[cleanId] || 
                            (body.noLoginData?.zengoIdWorks || []).find(w => String(w.id) === String(cleanId));
                        const dt = userIllust?.createDate || body.createDate;
                        if (dt) {
                            const m = dt.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
                            if (m) {
                                const [_, y, mo, d, h, mi, s] = m;
                                imageUrl = `https://i.pximg.net/img-master/img/${y}/${mo}/${d}/${h}/${mi}/${s}/${cleanId}_p0_master1200.jpg`;
                            }
                        }
                    }
                }
            }
        } catch (fetchErr) {
            console.warn(`Pixiv official AJAX error for #${cleanId}:`, fetchErr.message);
        }

        // 2. If Pixiv blocked, masked, or returned private/not found, use pixiv.re community proxy helper
        if (!imageUrl) {
            try {
                const helperCheck = await fetch(`https://pixiv.re/${cleanId}.jpg`, { method: 'HEAD' });
                if (helperCheck.ok) {
                    imageUrl = `https://pixiv.re/${cleanId}.jpg`;
                }
            } catch (_) {}
        }

        // 3. Fallback proxyUrl and build pages list
        let proxyUrl = '';
        if (imageUrl) {
            if (imageUrl.includes('pixiv.re')) {
                // pixiv.re already has CORS and CDN caching enabled
                proxyUrl = imageUrl;
            } else {
                proxyUrl = `/api/proxy/pixiv?url=${encodeURIComponent(imageUrl)}`;
            }
        }

        // If we still found no media at all, return 404
        if (!imageUrl) {
            return res.status(404).json({ error: 'Artwork not found or completely removed from Pixiv' });
        }

        // Construct full pages array for carousel
        const pages = [];
        for (let p = 0; p < pageCount; p++) {
            let pageImg = '';
            if (imageUrl.includes('pixiv.re')) {
                pageImg = p === 0 ? `https://pixiv.re/${cleanId}.jpg` : `https://pixiv.re/${cleanId}-${p + 1}.jpg`;
            } else if (imageUrl.includes('_p0_')) {
                pageImg = imageUrl.replace('_p0_', `_p${p}_`);
            } else {
                pageImg = p === 0 ? imageUrl : `https://pixiv.re/${cleanId}-${p + 1}.jpg`;
            }

            const pageProxy = pageImg.includes('pixiv.re')
                ? pageImg
                : `/api/proxy/pixiv?url=${encodeURIComponent(pageImg)}`;
            const pageHelper = `https://pixiv.re/${cleanId}-${p + 1}.jpg`;

            pages.push({
                pageIndex: p,
                displayUrl: pageProxy,
                helperUrl: pageHelper,
                originalUrl: pageImg
            });
        }

        const artwork = {
            id: cleanId,
            title,
            author,
            authorId,
            pageCount,
            isR18,
            imageUrl,
            proxyUrl,
            pages,
            artworkUrl: `https://www.pixiv.net/artworks/${cleanId}`
        };

        pixivArtworkCache.set(cleanId, artwork);
        if (pixivArtworkCache.size > 500) {
            const firstKey = pixivArtworkCache.keys().next().value;
            pixivArtworkCache.delete(firstKey);
        }

        res.json({ success: true, artwork });
    } catch (err) {
        console.error('Pixiv artwork lookup error:', err);
        res.status(500).json({ error: 'Failed to fetch Pixiv artwork data' });
    }
});

// 1. Boards List & Stats
app.get('/api/boards', (req, res) => {
    try {
        const stats = db.prepare(`
            SELECT board, COUNT(*) as thread_count, MAX(bumped_at) as last_activity
            FROM threads
            GROUP BY board
        `).all();

        const statMap = {};
        for (const s of stats) {
            statMap[s.board] = s;
        }

        const result = {};
        for (const [key, data] of Object.entries(BOARDS)) {
            result[key] = {
                ...data,
                thread_count: statMap[key]?.thread_count || 0,
                last_activity: statMap[key]?.last_activity || 0
            };
        }
        res.json({ success: true, boards: result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. Thread List for a Board
app.get('/api/threads', (req, res) => {
    const board = req.query.b;
    const isArchive = req.query.view === 'archive';

    if (!board || !BOARDS[board]) {
        return res.status(400).json({ error: 'Invalid board parameter' });
    }

    try {
        const now = Date.now();
        const cutoff = now - ARCHIVE_TIME_MS;

        // HTTP Caching & 304 Not Modified check using fast index lookup
        let metaQuery = 'SELECT MAX(bumped_at) as max_bump, COUNT(*) as count FROM threads WHERE board = ?';
        if (isArchive) {
            metaQuery += ` AND bumped_at < ${cutoff}`;
        }
        const meta = db.prepare(metaQuery).get(board);
        const maxBump = meta?.max_bump || 0;
        const count = meta?.count || 0;
        const etag = `W/"th-${board}-${isArchive ? 'arch' : 'act'}-${count}-${maxBump}"`;

        res.set('ETag', etag);
        res.set('Cache-Control', 'no-cache');

        if (req.headers['if-none-match'] === etag) {
            return res.status(304).end();
        }

        let query = `
            SELECT t.*, 
                (SELECT COUNT(*) FROM replies r WHERE r.thread_id = t.id) as reply_count
            FROM threads t
            WHERE t.board = ?
        `;

        if (isArchive) {
            query += ` AND t.bumped_at < ${cutoff} ORDER BY t.bumped_at DESC LIMIT 100`;
        } else {
            // Active view (or all if board has few threads)
            query += ` ORDER BY t.is_pinned DESC, t.bumped_at DESC LIMIT 50`;
        }

        const threads = db.prepare(query).all(board);

        // Fix N+1 query loop: Fetch 3 preview replies for ALL threads in a single query using window function
        if (threads.length > 0) {
            const threadIds = threads.map(t => t.id);
            const placeholders = threadIds.map(() => '?').join(',');
            const previewReplies = db.prepare(`
                WITH ranked_replies AS (
                    SELECT r.*,
                           ROW_NUMBER() OVER (PARTITION BY r.thread_id ORDER BY r.created_at DESC) as rn
                    FROM replies r
                    WHERE r.thread_id IN (${placeholders})
                )
                SELECT * FROM ranked_replies
                WHERE rn <= 3
                ORDER BY created_at ASC
            `).all(...threadIds);

            const replyMap = new Map();
            for (const r of previewReplies) {
                if (!replyMap.has(r.thread_id)) {
                    replyMap.set(r.thread_id, []);
                }
                replyMap.get(r.thread_id).push(r);
            }

            for (const th of threads) {
                th.preview_replies = replyMap.get(th.id) || [];
            }
        }

        const responseData = { success: true, threads };
        if (req.user) {
            const sync = getUserSyncData(req.user.user_id);
            if (sync) {
                res.set('Access-Control-Expose-Headers', 'ETag, X-Unread-Notifications, X-Watchlist-Count');
                res.set('X-Unread-Notifications', String(sync.unread_notifications));
                res.set('X-Watchlist-Count', String(sync.watchlist_count));
                responseData.user_sync = sync;
            }
        }

        res.json(responseData);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3. Single Thread with all replies (or delta updates since timestamp)
app.get('/api/thread', (req, res) => {
    const threadId = req.query.id;
    if (!threadId) {
        return res.status(400).json({ error: 'Missing thread id' });
    }

    try {
        const thread = db.prepare('SELECT * FROM threads WHERE id = ?').get(threadId);
        if (!thread) {
            return res.status(404).json({ error: 'Thread not found' });
        }

        const since = req.query.since ? parseInt(req.query.since, 10) : 0;

        // HTTP Caching & 304 Not Modified based on thread bumped_at, lock/pin status, and optional since param
        const etag = `W/"tr-${thread.id}-${thread.bumped_at}-${thread.is_pinned}-${thread.is_locked}${since > 0 ? '-s' + since : ''}"`;
        res.set('ETag', etag);
        res.set('Cache-Control', 'no-cache');

        if (req.headers['if-none-match'] === etag) {
            return res.status(304).end();
        }

        let replies;
        if (since > 0) {
            replies = db.prepare(`
                SELECT * FROM replies 
                WHERE thread_id = ? AND created_at > ?
                ORDER BY created_at ASC
            `).all(threadId, since);
        } else {
            replies = db.prepare(`
                SELECT * FROM replies 
                WHERE thread_id = ? 
                ORDER BY created_at ASC
            `).all(threadId);
        }

        const totalReplies = db.prepare('SELECT COUNT(*) as count FROM replies WHERE thread_id = ?').get(threadId)?.count || replies.length;

        const responseData = { 
            success: true, 
            thread, 
            replies,
            is_delta: since > 0,
            total_replies: totalReplies
        };

        if (req.user) {
            const sync = getUserSyncData(req.user.user_id);
            if (sync) {
                res.set('Access-Control-Expose-Headers', 'ETag, X-Unread-Notifications, X-Watchlist-Count');
                res.set('X-Unread-Notifications', String(sync.unread_notifications));
                res.set('X-Watchlist-Count', String(sync.watchlist_count));
                responseData.user_sync = sync;
            }
        }

        res.json(responseData);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 4. Create New Thread
app.post('/api/threads', (req, res) => {
    const { board, name, subject, comment, media_url } = req.body;

    if (!board || !BOARDS[board]) {
        return res.status(400).json({ error: 'Invalid board' });
    }
    if (!comment || !comment.trim()) {
        return res.status(400).json({ error: 'Comment is required' });
    }

    try {
        const id = generateId();
        const now = Date.now();
        const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
        const ipHash = hashIp(clientIp);

        const posterName = (name && name.trim()) ? name.trim() : 'Anonymous';
        const posterSubject = (subject && subject.trim()) ? subject.trim() : '';
        const posterMedia = (media_url && media_url.trim()) ? media_url.trim() : '';

        const userId = req.user ? req.user.user_id : null;
        const role = req.user ? req.user.role : null;
        const displayTitle = req.user ? req.user.display_title : null;

        db.prepare(`
            INSERT INTO threads (id, board, name, subject, comment, media_url, ip_hash, user_id, role, display_title, created_at, bumped_at, is_pinned, is_locked)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
        `).run(id, board, posterName, posterSubject, comment.trim(), posterMedia, ipHash, userId, role, displayTitle, now, now);

        const created = db.prepare('SELECT * FROM threads WHERE id = ?').get(id);

        if (userId) {
            awardUserXP(db, userId, XP_RULES.THREAD_CREATION);
        }

        res.json({ success: true, thread: created });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 5. Create Reply
app.post('/api/replies', (req, res) => {
    const { thread_id, board, name, comment, media_url } = req.body;

    if (!thread_id) {
        return res.status(400).json({ error: 'Missing thread_id' });
    }
    if (!comment || !comment.trim()) {
        return res.status(400).json({ error: 'Comment is required' });
    }

    try {
        const thread = db.prepare('SELECT * FROM threads WHERE id = ?').get(thread_id);
        if (!thread) {
            return res.status(404).json({ error: 'Thread not found' });
        }
        if (thread.is_locked) {
            return res.status(403).json({ error: 'Thread is locked.' });
        }

        const id = generateId();
        const now = Date.now();
        const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
        const ipHash = hashIp(clientIp);

        const posterName = (name && name.trim()) ? name.trim() : 'Anonymous';
        const posterMedia = (media_url && media_url.trim()) ? media_url.trim() : '';

        const userId = req.user ? req.user.user_id : null;
        const role = req.user ? req.user.role : null;
        const displayTitle = req.user ? req.user.display_title : null;

        db.prepare(`
            INSERT INTO replies (id, thread_id, board, name, comment, media_url, ip_hash, user_id, role, display_title, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, thread_id, thread.board, posterName, comment.trim(), posterMedia, ipHash, userId, role, displayTitle, now);

        // Bump thread activity
        db.prepare('UPDATE threads SET bumped_at = ? WHERE id = ?').run(now, thread_id);

        const created = db.prepare('SELECT * FROM replies WHERE id = ?').get(id);

        if (userId) {
            awardUserXP(db, userId, XP_RULES.REPLY_CREATION);
        }

        res.json({ success: true, reply: created });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 6. User Registration
app.post('/api/auth/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !username.trim() || !password || password.length < 4) {
        return res.status(400).json({ error: 'Username and password (min 4 chars) required.' });
    }

    const cleanUser = username.trim();
    try {
        const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(cleanUser);
        if (existing) {
            return res.status(409).json({ error: 'Username already taken.' });
        }

        const id = 'u_' + Date.now().toString(36);
        const passHash = hashPassword(password);
        const now = Date.now();

        // Check if this is the first registered user
        const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
        const role = userCount === 0 ? 'admin' : 'user';
        const title = role === 'admin' ? 'Admin 🛡️' : null;

        db.prepare(`
            INSERT INTO users (id, username, password_hash, role, display_title, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(id, cleanUser, passHash, role, title, now);

        const token = crypto.randomBytes(32).toString('hex');
        db.prepare(`
            INSERT INTO sessions (token, user_id, role, username, display_title, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(token, id, role, cleanUser, title, now);

        res.json({
            success: true,
            token,
            user: { id, username: cleanUser, role, display_title: title }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 7. User Login
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required.' });
    }

    try {
        const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim());
        if (!user || !verifyPassword(password, user.password_hash)) {
            return res.status(401).json({ error: 'Invalid username or password.' });
        }

        const token = crypto.randomBytes(32).toString('hex');
        const now = Date.now();
        db.prepare(`
            INSERT INTO sessions (token, user_id, role, username, display_title, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(token, user.id, user.role, user.username, user.display_title, now);

        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                username: user.username,
                role: user.role,
                display_title: user.display_title
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 8. Auth Status / Session check
app.get('/api/auth/me', (req, res) => {
    if (req.user) {
        res.json({ success: true, user: req.user });
    } else {
        res.json({ success: true, user: null });
    }
});

// 9. Logout
app.post('/api/auth/logout', (req, res) => {
    if (req.user) {
        db.prepare('DELETE FROM sessions WHERE token = ?').run(req.user.token);
    }
    res.json({ success: true });
});

// 9b. User Perks: Cross-device (You) posts
app.get('/api/user/my-posts', (req, res) => {
    if (!req.user) return res.json({ success: true, post_ids: [] });
    try {
        const threadIds = db.prepare('SELECT id FROM threads WHERE user_id = ?').all(req.user.user_id).map(r => r.id);
        const replyIds = db.prepare('SELECT id FROM replies WHERE user_id = ?').all(req.user.user_id).map(r => r.id);
        res.json({ success: true, post_ids: [...threadIds, ...replyIds] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 9c. User Perks: Reply Counter / Notifications
app.get('/api/user/notifications', (req, res) => {
    if (!req.user) return res.json({ success: true, notifications: [] });
    try {
        const uid = req.user.user_id;
        const notifications = db.prepare(`
            SELECT r.id, r.thread_id, r.board, r.name, r.comment, r.created_at, t.subject
            FROM replies r
            JOIN threads t ON t.id = r.thread_id
            WHERE (r.user_id IS NULL OR r.user_id != ?)
              AND (
                t.user_id = ?
                OR EXISTS (
                    SELECT 1 FROM replies my_r
                    WHERE my_r.user_id = ? AND r.comment LIKE '%' || my_r.id || '%'
                )
              )
            ORDER BY r.created_at DESC LIMIT 30
        `).all(uid, uid, uid);
        res.json({ success: true, notifications });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 9d. User Perks: Watchlist
app.get('/api/user/watchlist', (req, res) => {
    if (!req.user) return res.json({ success: true, watchlist: [] });
    try {
        const watchlist = db.prepare(`
            SELECT t.id, t.board, t.subject, t.name, t.comment, t.media_url, t.bumped_at, t.created_at,
                   (SELECT COUNT(*) FROM replies r WHERE r.thread_id = t.id) as reply_count
            FROM watchlist w
            JOIN threads t ON t.id = w.thread_id
            WHERE w.user_id = ?
            ORDER BY t.bumped_at DESC
        `).all(req.user.user_id);
        res.json({ success: true, watchlist });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/user/watchlist/toggle', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Login required to watch threads.' });
    const { thread_id } = req.body;
    if (!thread_id) return res.status(400).json({ error: 'Missing thread_id' });
    try {
        const existing = db.prepare('SELECT 1 FROM watchlist WHERE user_id = ? AND thread_id = ?').get(req.user.user_id, thread_id);
        if (existing) {
            db.prepare('DELETE FROM watchlist WHERE user_id = ? AND thread_id = ?').run(req.user.user_id, thread_id);
            return res.json({ success: true, watched: false });
        } else {
            db.prepare('INSERT INTO watchlist (user_id, thread_id, created_at) VALUES (?, ?, ?)').run(req.user.user_id, thread_id, Date.now());
            return res.json({ success: true, watched: true });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 9e. Gamification: User Profile Stats (XP, Level, Rank, Streak, Oshi Badge)
app.get('/api/user/profile', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized: login required' });
    try {
        const user = db.prepare(`
            SELECT id, username, role, display_title, xp, level, streak, last_active_date, last_omikuji_date, oshi_badge 
            FROM users WHERE id = ?
        `).get(req.user.user_id);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const level = calculateLevel(user.xp || 0);
        const rank = getRank(level);
        const today = getTodayDateStr();
        const canDrawOmikuji = user.last_omikuji_date !== today;

        res.json({
            success: true,
            user: {
                id: user.id,
                username: user.username,
                role: user.role,
                display_title: user.display_title,
                xp: user.xp || 0,
                level,
                rankTitle: rank.title,
                rankBadge: rank.badge,
                streak: user.streak || 0,
                oshi_badge: user.oshi_badge || null,
                can_draw_omikuji: canDrawOmikuji,
                last_omikuji_date: user.last_omikuji_date
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 9f. Gamification: Daily Oshi Omikuji Draw
app.post('/api/user/omikuji', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized: login required' });
    try {
        const user = db.prepare('SELECT id, xp, level, streak, last_active_date, last_omikuji_date FROM users WHERE id = ?').get(req.user.user_id);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const today = getTodayDateStr();
        if (user.last_omikuji_date === today) {
            return res.status(400).json({ error: 'Already drawn today' });
        }

        // Calculate consecutive daily streak
        let newStreak = 1;
        if (user.last_active_date) {
            const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
            if (user.last_active_date === yesterday) {
                newStreak = (user.streak || 0) + 1;
            } else if (user.last_active_date === today) {
                newStreak = user.streak || 1;
            }
        }

        const fortune = drawRandomOmikuji();
        const streakBonus = (newStreak > 1) ? XP_RULES.DAILY_STREAK : 0;
        const xpAwarded = XP_RULES.OMIKUJI_DRAW + streakBonus;
        const newXp = (user.xp || 0) + xpAwarded;
        const newLevel = calculateLevel(newXp);

        db.prepare(`
            UPDATE users 
            SET xp = ?, level = ?, streak = ?, last_active_date = ?, last_omikuji_date = ?
            WHERE id = ?
        `).run(newXp, newLevel, newStreak, today, today, user.id);

        const rank = getRank(newLevel);
        res.json({
            success: true,
            fortune,
            xp_awarded: xpAwarded,
            total_xp: newXp,
            level: newLevel,
            rankTitle: rank.title,
            rankBadge: rank.badge,
            streak: newStreak
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 9g. Gamification: Update Custom Oshi Badge
app.post('/api/user/badge', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized: login required' });
    const { badge } = req.body;
    if (badge && !ALLOWED_OSHI_BADGES.includes(badge)) {
        return res.status(400).json({ error: 'Invalid oshi badge option' });
    }
    try {
        db.prepare('UPDATE users SET oshi_badge = ? WHERE id = ?').run(badge || null, req.user.user_id);
        res.json({ success: true, oshi_badge: badge || null });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 10. Admin: Delete Thread or Reply
app.post('/api/admin/delete', (req, res) => {
    if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'mod')) {
        return res.status(403).json({ error: 'Unauthorized: Admin or Mod privileges required.' });
    }

    const { type, id } = req.body;
    if (!type || !id) return res.status(400).json({ error: 'Missing type or id' });

    try {
        if (type === 'thread') {
            db.prepare('DELETE FROM threads WHERE id = ?').run(id);
            res.json({ success: true, message: 'Thread deleted.' });
        } else if (type === 'reply') {
            db.prepare('DELETE FROM replies WHERE id = ?').run(id);
            res.json({ success: true, message: 'Reply deleted.' });
        } else {
            res.status(400).json({ error: 'Invalid delete target type' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 11. Admin: Pin Thread
app.post('/api/admin/pin', (req, res) => {
    if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'mod')) {
        return res.status(403).json({ error: 'Unauthorized.' });
    }

    const { thread_id } = req.body;
    try {
        const thread = db.prepare('SELECT is_pinned FROM threads WHERE id = ?').get(thread_id);
        if (!thread) return res.status(404).json({ error: 'Thread not found' });

        const newPinned = thread.is_pinned ? 0 : 1;
        db.prepare('UPDATE threads SET is_pinned = ? WHERE id = ?').run(newPinned, thread_id);
        res.json({ success: true, is_pinned: newPinned });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 12. Admin: Lock Thread
app.post('/api/admin/lock', (req, res) => {
    if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'mod')) {
        return res.status(403).json({ error: 'Unauthorized.' });
    }

    const { thread_id } = req.body;
    try {
        const thread = db.prepare('SELECT is_locked FROM threads WHERE id = ?').get(thread_id);
        if (!thread) return res.status(404).json({ error: 'Thread not found' });

        const newLocked = thread.is_locked ? 0 : 1;
        db.prepare('UPDATE threads SET is_locked = ? WHERE id = ?').run(newLocked, thread_id);
        res.json({ success: true, is_locked: newLocked });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 13. Admin: Set User Role / Badges (e.g. Verified Talent ⭐)
app.post('/api/admin/update-role', (req, res) => {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Unauthorized: Admin privileges required.' });
    }

    const { username, role, display_title } = req.body;
    if (!username || !role) return res.status(400).json({ error: 'Missing username or role' });

    try {
        const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username.trim());
        if (!user) return res.status(404).json({ error: 'User not found' });

        db.prepare('UPDATE users SET role = ?, display_title = ? WHERE id = ?')
          .run(role, display_title || null, user.id);

        res.json({ success: true, message: `Updated ${username} to role ${role}` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 14. Site Settings (e.g. Banner Image)
app.get('/api/settings', (req, res) => {
    try {
        const rows = db.prepare('SELECT key, value FROM site_settings').all();
        const settings = {};
        for (const r of rows) settings[r.key] = r.value;
        res.json({ success: true, settings });
    } catch (err) {
        res.json({ success: true, settings: {} });
    }
});

app.post('/api/admin/settings', (req, res) => {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Unauthorized: Admin privileges required.' });
    }

    const { key, value } = req.body;
    if (!key) return res.status(400).json({ error: 'Missing setting key' });

    try {
        db.prepare('INSERT INTO site_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?')
          .run(key, value || '', value || '');

        // If banner_url is updated, also synchronize index.html on disk for static deployments
        if (key === 'banner_url' && value && value.trim()) {
            try {
                const indexPath = path.join(__dirname, 'index.html');
                if (fs.existsSync(indexPath)) {
                    let indexHtml = fs.readFileSync(indexPath, 'utf8');
                    const cleanUrl = value.trim();
                    indexHtml = indexHtml
                        .replace(/<meta property="og:image" content="[^"]*">/g, `<meta property="og:image" content="${cleanUrl}">`)
                        .replace(/<meta name="twitter:image" content="[^"]*">/g, `<meta name="twitter:image" content="${cleanUrl}">`);
                    fs.writeFileSync(indexPath, indexHtml, 'utf8');
                }
            } catch (fsErr) {
                console.warn('Could not sync banner to index.html:', fsErr.message);
            }
        }

        res.json({ success: true, key, value });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Helper sanitizers for dynamic SSR SEO injection
function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeJson(str) {
    if (!str) return '';
    return String(str).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '');
}

const SFW_BOARDS = {
    'myvt':  { title: '/myvt/ - MY VTuber', description: 'Malaysian Virtual YouTuber discussions, streams, talents, and community banter.' },
    'vt':    { title: '/vt/ - SEA & Global VTuber', description: 'Southeast Asian and international VTuber discussion, talents, and agency updates.' },
    'vg':    { title: '/vg/ - Video Games', description: 'Video games, gacha, co-op lobbies, gameplay clips, and gamer discussion.' },
    'amg':   { title: '/amg/ - Anime & Manga', description: 'Anime, manga, light novels, season watchalongs, and otaku culture.' },
    'ca':    { title: '/ca/ - Cosplay & Art', description: 'Cosplay photography, illustrations, artwork showcases, and craft discussion.' },
    'tech':  { title: '/tech/ - Tech Stuff', description: 'Hardware, software, gadgets, PC building, streaming gear, and tech topics.' },
    'mamak': { title: '/mamak/ - MY Stuff & Off-topic', description: 'Malaysian daily life, mamak session banter, food, and general off-topic lounge.' },
    'rqr':   { title: '/rqr/ - Board Request & Report', description: 'Feedback, board requests, bug reports, and suggestions for OshiMY.' }
};

// --- SEARCH ENGINE OPTIMIZATION (SEO) ENDPOINTS ---
app.get('/robots.txt', (req, res) => {
    const origin = `${req.protocol}://${req.get('host')}`;
    const robots = `User-agent: *
Allow: /
Disallow: /api/admin/
Disallow: /api/auth/

# Dynamic XML Sitemap
Sitemap: ${origin}/sitemap.xml
`;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(robots);
});

app.get('/sitemap.xml', (req, res) => {
    const origin = `${req.protocol}://${req.get('host')}`;
    const boardKeys = Object.keys(SFW_BOARDS);

    let threadUrlsXml = '';
    try {
        const placeholders = boardKeys.map(() => '?').join(',');
        const threads = db.prepare(
            `SELECT id, board, bumped_at, created_at FROM threads WHERE board IN (${placeholders}) ORDER BY bumped_at DESC LIMIT 300`
        ).all(...boardKeys);

        if (threads && threads.length > 0) {
            threadUrlsXml = threads.map(t => {
                const lastmod = new Date(t.bumped_at || t.created_at || Date.now()).toISOString();
                return `  <url>\n    <loc>${origin}/?b=${t.board}&amp;t=${t.id}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.7</priority>\n  </url>`;
            }).join('\n');
        }
    } catch (e) {
        console.error('Error generating sitemap threads:', e);
    }

    const boardUrlsXml = boardKeys.map(b => `  <url>\n    <loc>${origin}/?b=${b}</loc>\n    <changefreq>hourly</changefreq>\n    <priority>0.8</priority>\n  </url>`).join('\n');

    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${origin}/</loc>
    <changefreq>hourly</changefreq>
    <priority>1.0</priority>
  </url>
${boardUrlsXml}
${threadUrlsXml ? '\n' + threadUrlsXml : ''}
</urlset>`.trim();

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(sitemap);
});

// --- STATIC ASSETS & DYNAMIC SSR METADATA ROUTING ---
// Disable default index.html serving in express.static so root requests hit our dynamic SSR handler
app.use(express.static(__dirname, { index: false }));

app.get('*', (req, res) => {
    // If request path is an API route, return 404 JSON
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'API route not found' });
    }

    try {
        const indexPath = path.join(__dirname, 'index.html');
        let html = fs.readFileSync(indexPath, 'utf8');
        const origin = `${req.protocol}://${req.get('host')}`;

        // Get default or custom site banner
        let currentBanner = 'https://images.unsplash.com/photo-1578632767115-351597cf2477?auto=format&fit=crop&w=1200&h=300&q=80';
        try {
            const row = db.prepare('SELECT value FROM site_settings WHERE key = ?').get('banner_url');
            if (row && row.value && row.value.trim()) {
                currentBanner = row.value.trim();
            }
        } catch (_) {}

        // Check if a specific thread is requested via query or path
        let threadId = req.query.t || req.query.thread;
        if (!threadId) {
            const threadMatch = req.path.match(/^\/(?:boards\/[^\/]+\/thread|thread|t)\/([a-zA-Z0-9_\-]+)/);
            if (threadMatch) threadId = threadMatch[1];
        }

        if (threadId) {
            try {
                const thread = db.prepare('SELECT id, board, subject, comment, media_url, created_at, reply_count FROM threads WHERE id = ?').get(threadId);
                if (thread) {
                    const replyId = req.query.r || req.query.reply;
                    let reply = null;
                    if (replyId) {
                        try {
                            reply = db.prepare('SELECT id, thread_id, board, name, comment, media_url, created_at FROM replies WHERE id = ? AND thread_id = ?').get(replyId, threadId);
                        } catch (_) {}
                    }

                    let pageTitle, pageDesc, embedMedia, canonicalUrl;

                    if (reply) {
                        // Embed specific reply!
                        const cleanReplyComment = (reply.comment || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 180);
                        const cleanSubject = thread.subject && thread.subject.trim() ? `${thread.subject.trim()} - ` : '';
                        pageTitle = `Reply >>${reply.id.substring(1, 9)} - ${cleanSubject}/${thread.board}/ | OshiMY`;
                        pageDesc = cleanReplyComment || `Reply by ${reply.name || 'Anonymous'} in /${thread.board}/ thread #${thread.id.substring(1, 9)}`;
                        // If reply has its own media, use it; otherwise fallback to thread OP media or banner
                        embedMedia = (reply.media_url && !reply.media_url.endsWith('.mp3'))
                            ? reply.media_url 
                            : ((thread.media_url && !thread.media_url.endsWith('.mp3')) ? thread.media_url : currentBanner);
                        canonicalUrl = `${origin}/?b=${thread.board}&t=${thread.id}&r=${reply.id}`;
                    } else {
                        // Standard Thread Embed
                        const cleanComment = (thread.comment || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 180);
                        const subjectTitle = thread.subject && thread.subject.trim() 
                            ? `${thread.subject.trim()} - ` 
                            : (cleanComment ? `${cleanComment.slice(0, 40)}... - ` : '');
                        pageTitle = `${subjectTitle}/${thread.board}/ | OshiMY`;
                        pageDesc = cleanComment || `Thread on /${thread.board}/ - OshiMY Malaysian VTuber & Otaku Imageboard`;
                        embedMedia = (thread.media_url && !thread.media_url.endsWith('.mp3')) ? thread.media_url : currentBanner;
                        canonicalUrl = `${origin}/?b=${thread.board}&t=${thread.id}`;
                    }

                    // Replace SEO tags
                    html = html
                        .replace(/<title>.*?<\/title>/, `<title>${escapeHtml(pageTitle)}</title>`)
                        .replace(/<meta name="description" content=".*?">/, `<meta name="description" content="${escapeAttr(pageDesc)}">`)
                        .replace(/<meta property="og:title" content=".*?">/, `<meta property="og:title" content="${escapeAttr(pageTitle)}">`)
                        .replace(/<meta property="og:description" content=".*?">/, `<meta property="og:description" content="${escapeAttr(pageDesc)}">`)
                        .replace(/<meta property="og:image" content=".*?">/, `<meta property="og:image" content="${escapeAttr(embedMedia)}">`)
                        .replace(/<meta property="og:url" content=".*?">/, `<meta property="og:url" content="${escapeAttr(canonicalUrl)}">`)
                        .replace(/<meta name="twitter:title" content=".*?">/, `<meta name="twitter:title" content="${escapeAttr(pageTitle)}">`)
                        .replace(/<meta name="twitter:description" content=".*?">/, `<meta name="twitter:description" content="${escapeAttr(pageDesc)}">`)
                        .replace(/<meta name="twitter:image" content=".*?">/, `<meta name="twitter:image" content="${escapeAttr(embedMedia)}">`)
                        .replace(/<link rel="canonical" href=".*?">/, `<link rel="canonical" href="${escapeAttr(canonicalUrl)}">`);

                    // Add DiscussionForumPosting / Comment Schema.org LD-JSON
                    const jsonLdType = reply ? "Comment" : "DiscussionForumPosting";
                    const jsonLdBody = reply ? (reply.comment || '') : (thread.comment || '');
                    const jsonLdTitle = reply ? `Reply to #${thread.id.substring(1, 9)}` : (thread.subject || ('Thread #' + thread.id));
                    const threadJsonLd = `
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "${jsonLdType}",
      "headline": "${escapeJson(jsonLdTitle)}",
      "text": "${escapeJson(jsonLdBody.slice(0, 300))}",
      "image": "${escapeJson(embedMedia)}",
      "datePublished": "${new Date((reply ? reply.created_at : thread.created_at) || Date.now()).toISOString()}",
      "url": "${escapeJson(canonicalUrl)}",
      "publisher": {
        "@type": "Organization",
        "name": "OshiMY",
        "url": "${origin}/"
      }
    }
    </script>`;
                    html = html.replace('</head>', `${threadJsonLd}\n</head>`);

                    res.setHeader('Content-Type', 'text/html; charset=utf-8');
                    return res.send(html);
                }
            } catch (threadErr) {
                console.warn('Could not render SSR thread/reply meta:', threadErr.message);
            }
        }

        // Check if a specific board is requested
        const boardKey = req.query.b;
        if (boardKey && SFW_BOARDS[boardKey]) {
            const b = SFW_BOARDS[boardKey];
            const pageTitle = `${b.title} | OshiMY`;
            const pageDesc = `${b.description} Participate in anonymous discussions on /${boardKey}/ at OshiMY.`;
            const canonicalUrl = `${origin}/?b=${boardKey}`;

            html = html
                .replace(/<title>.*?<\/title>/, `<title>${escapeHtml(pageTitle)}</title>`)
                .replace(/<meta name="description" content=".*?">/, `<meta name="description" content="${escapeAttr(pageDesc)}">`)
                .replace(/<meta property="og:title" content=".*?">/, `<meta property="og:title" content="${escapeAttr(pageTitle)}">`)
                .replace(/<meta property="og:description" content=".*?">/, `<meta property="og:description" content="${escapeAttr(pageDesc)}">`)
                .replace(/<meta property="og:image" content=".*?">/, `<meta property="og:image" content="${escapeAttr(currentBanner)}">`)
                .replace(/<meta property="og:url" content=".*?">/, `<meta property="og:url" content="${escapeAttr(canonicalUrl)}">`)
                .replace(/<meta name="twitter:title" content=".*?">/, `<meta name="twitter:title" content="${escapeAttr(pageTitle)}">`)
                .replace(/<meta name="twitter:description" content=".*?">/, `<meta name="twitter:description" content="${escapeAttr(pageDesc)}">`)
                .replace(/<meta name="twitter:image" content=".*?">/, `<meta name="twitter:image" content="${escapeAttr(currentBanner)}">`)
                .replace(/<link rel="canonical" href=".*?">/, `<link rel="canonical" href="${escapeAttr(canonicalUrl)}">`);

            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            return res.send(html);
        }

        // Default Homepage
        html = html
            .replace(/<meta property="og:image" content="[^"]*">/g, `<meta property="og:image" content="${escapeAttr(currentBanner)}">`)
            .replace(/<meta name="twitter:image" content="[^"]*">/g, `<meta name="twitter:image" content="${escapeAttr(currentBanner)}">`);

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch (err) {
        console.error('Error rendering dynamic page metadata:', err);
        res.sendFile(path.join(__dirname, 'index.html'));
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`OshiMY Server running on http://0.0.0.0:${PORT}`);
});
