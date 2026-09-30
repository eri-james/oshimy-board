import express from 'express';
import path from 'path';
import crypto from 'node:crypto';
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
        res.json({ success: true, key, value });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- STATIC ASSETS & SPA ROUTING ---
app.use(express.static(__dirname));

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`OshiMY Server running on http://0.0.0.0:${PORT}`);
});
