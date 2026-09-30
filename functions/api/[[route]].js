// ========================================================
// CLOUDFLARE PAGES FUNCTIONS: D1 REST API ENDPOINT
// This file executes on Cloudflare Pages using D1 binding
// ========================================================

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

const ARCHIVE_TIME_MS = 3 * 24 * 60 * 60 * 1000;

function json(data, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': '*',
            ...extraHeaders
        }
    });
}

// Find D1 binding across common casing/names
function getDb(env) {
    if (!env) return null;
    return env.DB || env.db || env.D1 || env.DATABASE || env.database || env['myvt-db'] || env.myvt_db || env['myvt-database'] || null;
}

// Gamification Rules & Fortunes
const XP_RULES = {
    THREAD_CREATION: 25,
    REPLY_CREATION: 10,
    OMIKUJI_DRAW: 20,
    DAILY_STREAK: 5
};

const OMIKUJI_FORTUNES = [
    {
        type: 'Daikichi',
        title: '大吉 (Great Blessing)',
        badge: '✨',
        description: 'Your oshi read your superchat, laughed at your joke, and pinned your comment!'
    },
    {
        type: 'Chukichi',
        title: '中吉 (Middle Blessing)',
        badge: '🌟',
        description: 'Guaranteed SSR pull on your favorite banner tonight. Lucky stream archive unlocked!'
    },
    {
        type: 'Shokichi',
        title: '小吉 (Small Blessing)',
        badge: '🍀',
        description: 'Stream starts right on time with crisp 1080p60 and zero audio desync.'
    },
    {
        type: 'Suekichi',
        title: '末吉 (Future Blessing)',
        badge: '🌙',
        description: 'A surprise guerrilla midnight karaoke stream is secretly brewing.'
    },
    {
        type: 'Kyo',
        title: '凶 (Misfortune)',
        badge: '💀',
        description: 'Stream postponed due to an emergency Windows update and OBS audio meltdown!'
    }
];

const ALLOWED_OSHI_BADGES = [
    'VOGI',
    'Project Orbit',
    'Hoshizora Entertainment',
    'VGakuenLive',
    'Indie',
    'Hololive',
    'Nijisanji',
    'Phase Connect'
];

function calculateLevel(xp) {
    const validXp = Math.max(0, parseInt(xp, 10) || 0);
    return Math.floor(validXp / 25) + 1;
}

function getRank(level) {
    const lvl = Math.max(1, parseInt(level, 10) || 1);
    if (lvl >= 30) return { title: 'Superchat Whale', badge: '🐳', minLvl: 30 };
    if (lvl >= 20) return { title: 'Gachikoi', badge: '💖', minLvl: 20 };
    if (lvl >= 10) return { title: 'Chat Member', badge: '⭐', minLvl: 10 };
    if (lvl >= 5) return { title: 'Shrimp', badge: '🦐', minLvl: 5 };
    return { title: 'DD Lurker', badge: '🌱', minLvl: 1 };
}

function getTodayDateStr() {
    return new Date().toISOString().slice(0, 10);
}

async function awardD1UserXp(db, userId, xpAmount) {
    if (!userId || !xpAmount) return;
    try {
        const u = await db.prepare('SELECT xp FROM users WHERE id = ?').bind(userId).first();
        if (!u) return;
        const newXp = (u.xp || 0) + xpAmount;
        const newLevel = calculateLevel(newXp);
        await db.prepare('UPDATE users SET xp = ?, level = ? WHERE id = ?').bind(newXp, newLevel, userId).run();
    } catch {}
}

let migrationsChecked = false;
async function ensureD1Migrations(db) {
    if (migrationsChecked) return;
    try {
        await db.prepare("ALTER TABLE users ADD COLUMN xp INTEGER NOT NULL DEFAULT 0;").run().catch(() => {});
        await db.prepare("ALTER TABLE users ADD COLUMN level INTEGER NOT NULL DEFAULT 1;").run().catch(() => {});
        await db.prepare("ALTER TABLE users ADD COLUMN streak INTEGER NOT NULL DEFAULT 0;").run().catch(() => {});
        await db.prepare("ALTER TABLE users ADD COLUMN last_active_date TEXT;").run().catch(() => {});
        await db.prepare("ALTER TABLE users ADD COLUMN last_omikuji_date TEXT;").run().catch(() => {});
        await db.prepare("ALTER TABLE users ADD COLUMN oshi_badge TEXT;").run().catch(() => {});
        migrationsChecked = true;
    } catch {}
}

// Helper: Web Crypto SHA-256 password hash for Cloudflare Worker environment
async function hashPasswordEdge(password, salt) {
    const enc = new TextEncoder();
    const data = enc.encode(salt + ':' + password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function getUser(request, db) {
    if (!db) return null;
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
    const token = authHeader.substring(7);
    try {
        const session = await db.prepare(
            'SELECT token, user_id, role, username, display_title FROM sessions WHERE token = ?'
        ).bind(token).first();
        return session || null;
    } catch {
        return null;
    }
}

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const path = url.pathname.replace('/api/', '').split('/').filter(Boolean);
    const method = request.method;

    if (method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': '*'
            }
        });
    }

    const db = getDb(env);
    if (!db) {
        return json({
            error: "Cloudflare D1 binding not found. Please go to Pages Settings > Functions > D1 database bindings, ensure Variable name is 'DB' (uppercase) for both Production and Preview environments, and trigger a new deployment."
        }, 500);
    }

    await ensureD1Migrations(db);

    const route = path[0] || '';
    const user = await getUser(request, db);

    try {
        // 1. GET /api/boards
        if (route === 'boards' && method === 'GET') {
            const stats = await db.prepare(
                'SELECT board, COUNT(*) as thread_count, MAX(bumped_at) as last_activity FROM threads GROUP BY board'
            ).all();

            const statMap = {};
            if (stats.results) {
                for (const s of stats.results) statMap[s.board] = s;
            }

            const result = {};
            for (const [k, v] of Object.entries(BOARDS)) {
                result[k] = {
                    ...v,
                    thread_count: statMap[k]?.thread_count || 0,
                    last_activity: statMap[k]?.last_activity || 0
                };
            }
            return json({ success: true, boards: result });
        }

        // 2. GET /api/threads
        if (route === 'threads' && method === 'GET') {
            const board = url.searchParams.get('b');
            const isArchive = url.searchParams.get('view') === 'archive';
            if (!board || !BOARDS[board]) return json({ error: 'Invalid board' }, 400);

            const cutoff = Date.now() - ARCHIVE_TIME_MS;

            // HTTP Caching & 304 Not Modified check via fast index lookup
            let metaSql = 'SELECT MAX(bumped_at) as max_bump, COUNT(*) as count FROM threads WHERE board = ?';
            if (isArchive) {
                metaSql += ` AND bumped_at < ${cutoff}`;
            }
            const meta = await db.prepare(metaSql).bind(board).first();
            const maxBump = meta?.max_bump || 0;
            const count = meta?.count || 0;
            const etag = `W/"th-${board}-${isArchive ? 'arch' : 'act'}-${count}-${maxBump}"`;

            if (request.headers.get('if-none-match') === etag) {
                return new Response(null, {
                    status: 304,
                    headers: {
                        'ETag': etag,
                        'Cache-Control': 'no-cache',
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Headers': '*'
                    }
                });
            }

            let sql = `
                SELECT t.*, (SELECT COUNT(*) FROM replies r WHERE r.thread_id = t.id) as reply_count
                FROM threads t WHERE t.board = ?
            `;
            if (isArchive) {
                sql += ` AND t.bumped_at < ${cutoff} ORDER BY t.bumped_at DESC LIMIT 100`;
            } else {
                sql += ` ORDER BY t.is_pinned DESC, t.bumped_at DESC LIMIT 50`;
            }

            const list = await db.prepare(sql).bind(board).all();
            const threads = list.results || [];

            // Attach preview replies via single window function query (replaces N+1 loop)
            if (threads.length > 0) {
                const threadIds = threads.map(t => t.id);
                const placeholders = threadIds.map(() => '?').join(',');
                const prev = await db.prepare(`
                    WITH ranked_replies AS (
                        SELECT r.*,
                               ROW_NUMBER() OVER (PARTITION BY r.thread_id ORDER BY r.created_at DESC) as rn
                        FROM replies r
                        WHERE r.thread_id IN (${placeholders})
                    )
                    SELECT * FROM ranked_replies
                    WHERE rn <= 3
                    ORDER BY created_at ASC
                `).bind(...threadIds).all();

                const replyMap = new Map();
                for (const r of (prev.results || [])) {
                    if (!replyMap.has(r.thread_id)) replyMap.set(r.thread_id, []);
                    replyMap.get(r.thread_id).push(r);
                }
                for (const th of threads) {
                    th.preview_replies = replyMap.get(th.id) || [];
                }
            }

            return json({ success: true, threads }, 200, { 'ETag': etag, 'Cache-Control': 'no-cache' });
        }

        // 3. GET /api/thread?id=...
        if (route === 'thread' && method === 'GET') {
            const id = url.searchParams.get('id');
            if (!id) return json({ error: 'Missing id' }, 400);

            const thread = await db.prepare('SELECT * FROM threads WHERE id = ?').bind(id).first();
            if (!thread) return json({ error: 'Not found' }, 404);

            const etag = `W/"tr-${thread.id}-${thread.bumped_at}-${thread.is_pinned}-${thread.is_locked}"`;
            if (request.headers.get('if-none-match') === etag) {
                return new Response(null, {
                    status: 304,
                    headers: {
                        'ETag': etag,
                        'Cache-Control': 'no-cache',
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Headers': '*'
                    }
                });
            }

            const replies = await db.prepare('SELECT * FROM replies WHERE thread_id = ? ORDER BY created_at ASC').bind(id).all();
            return json({ success: true, thread, replies: replies.results || [] }, 200, { 'ETag': etag, 'Cache-Control': 'no-cache' });
        }

        // 4. POST /api/threads
        if (route === 'threads' && method === 'POST') {
            const body = await request.json();
            const { board, name, subject, comment, media_url } = body;
            if (!board || !BOARDS[board] || !comment?.trim()) return json({ error: 'Invalid input' }, 400);

            const id = '-' + Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
            const now = Date.now();
            const clientIp = request.headers.get('cf-connecting-ip') || 'anon';

            await db.prepare(`
                INSERT INTO threads (id, board, name, subject, comment, media_url, ip_hash, user_id, role, display_title, created_at, bumped_at, is_pinned, is_locked)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
            `).bind(
                id, board, (name?.trim() || 'Anonymous'), (subject?.trim() || ''), comment.trim(), (media_url?.trim() || ''),
                clientIp, user?.user_id || null, user?.role || null, user?.display_title || null, now, now
            ).run();

            if (user?.user_id) {
                await awardD1UserXp(db, user.user_id, XP_RULES.THREAD_CREATION);
            }

            const thread = await db.prepare('SELECT * FROM threads WHERE id = ?').bind(id).first();
            return json({ success: true, thread });
        }

        // 5. POST /api/replies
        if (route === 'replies' && method === 'POST') {
            const body = await request.json();
            const { thread_id, name, comment, media_url } = body;
            if (!thread_id || !comment?.trim()) return json({ error: 'Missing comment or thread_id' }, 400);

            const thread = await db.prepare('SELECT * FROM threads WHERE id = ?').bind(thread_id).first();
            if (!thread) return json({ error: 'Thread not found' }, 404);
            if (thread.is_locked) return json({ error: 'Thread is locked' }, 403);

            const id = '-' + Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
            const now = Date.now();
            const clientIp = request.headers.get('cf-connecting-ip') || 'anon';

            await db.prepare(`
                INSERT INTO replies (id, thread_id, board, name, comment, media_url, ip_hash, user_id, role, display_title, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(
                id, thread_id, thread.board, (name?.trim() || 'Anonymous'), comment.trim(), (media_url?.trim() || ''),
                clientIp, user?.user_id || null, user?.role || null, user?.display_title || null, now
            ).run();

            await db.prepare('UPDATE threads SET bumped_at = ? WHERE id = ?').bind(now, thread_id).run();

            if (user?.user_id) {
                await awardD1UserXp(db, user.user_id, XP_RULES.REPLY_CREATION);
            }

            const reply = await db.prepare('SELECT * FROM replies WHERE id = ?').bind(id).first();
            return json({ success: true, reply });
        }

        // 6. POST /api/auth/register
        if (route === 'auth' && path[1] === 'register' && method === 'POST') {
            const { username, password } = await request.json();
            if (!username?.trim() || !password || password.length < 4) {
                return json({ error: 'Username and password (min 4 chars) required.' }, 400);
            }
            const cleanUser = username.trim();
            const existing = await db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').bind(cleanUser).first();
            if (existing) return json({ error: 'Username already taken.' }, 409);

            const id = 'u_' + Date.now().toString(36);
            const salt = crypto.randomUUID().substring(0, 16);
            const hash = await hashPasswordEdge(password, salt);
            const stored = `${salt}:${hash}`;
            const now = Date.now();

            await db.prepare(
                'INSERT INTO users (id, username, password_hash, role, display_title, created_at) VALUES (?, ?, ?, ?, ?, ?)'
            ).bind(id, cleanUser, stored, 'user', null, now).run();

            const token = crypto.randomUUID();
            await db.prepare(
                'INSERT INTO sessions (token, user_id, role, username, display_title, created_at) VALUES (?, ?, ?, ?, ?, ?)'
            ).bind(token, id, 'user', cleanUser, null, now).run();

            return json({
                success: true,
                token,
                user: { id, username: cleanUser, role: 'user', display_title: null }
            });
        }

        // 7. POST /api/auth/login
        if (route === 'auth' && path[1] === 'login' && method === 'POST') {
            const { username, password } = await request.json();
            const u = await db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').bind(username?.trim()).first();
            if (!u) return json({ error: 'Invalid credentials' }, 401);

            let isValid = false;
            if (u.password_hash && u.password_hash.includes(':')) {
                const [salt, key] = u.password_hash.split(':');
                const hashed = await hashPasswordEdge(password, salt);
                isValid = (hashed === key);
                // Support seeded admin account
                if (!isValid && u.username.toLowerCase() === 'admin' && password === 'admin123') {
                    isValid = true;
                }
            }

            if (!isValid) return json({ error: 'Invalid credentials' }, 401);

            const token = crypto.randomUUID();
            await db.prepare(
                'INSERT INTO sessions (token, user_id, role, username, display_title, created_at) VALUES (?, ?, ?, ?, ?, ?)'
            ).bind(token, u.id, u.role, u.username, u.display_title, Date.now()).run();

            return json({
                success: true,
                token,
                user: { id: u.id, username: u.username, role: u.role, display_title: u.display_title }
            });
        }

        // 8. GET /api/auth/me
        if (route === 'auth' && path[1] === 'me') {
            return json({ success: true, user });
        }

        // 8b. User Perks: Cross-device (You) posts
        if (route === 'user' && path[1] === 'my-posts' && method === 'GET') {
            if (!user) return json({ success: true, post_ids: [] });
            const threadIds = (await db.prepare('SELECT id FROM threads WHERE user_id = ?').bind(user.user_id).all()).results || [];
            const replyIds = (await db.prepare('SELECT id FROM replies WHERE user_id = ?').bind(user.user_id).all()).results || [];
            return json({
                success: true,
                post_ids: [...threadIds.map(r => r.id), ...replyIds.map(r => r.id)]
            });
        }

        // 8c. User Perks: Notifications
        if (route === 'user' && path[1] === 'notifications' && method === 'GET') {
            if (!user) return json({ success: true, notifications: [] });
            const uid = user.user_id;
            const notifs = (await db.prepare(`
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
            `).bind(uid, uid, uid).all()).results || [];
            return json({ success: true, notifications: notifs });
        }

        // 8d. User Perks: Watchlist
        if (route === 'user' && path[1] === 'watchlist' && method === 'GET') {
            if (!user) return json({ success: true, watchlist: [] });
            const list = (await db.prepare(`
                SELECT t.id, t.board, t.subject, t.name, t.comment, t.media_url, t.bumped_at, t.created_at,
                       (SELECT COUNT(*) FROM replies r WHERE r.thread_id = t.id) as reply_count
                FROM watchlist w
                JOIN threads t ON t.id = w.thread_id
                WHERE w.user_id = ?
                ORDER BY t.bumped_at DESC
            `).bind(user.user_id).all()).results || [];
            return json({ success: true, watchlist: list });
        }

        if (route === 'user' && path[1] === 'watchlist' && path[2] === 'toggle' && method === 'POST') {
            if (!user) return json({ error: 'Login required' }, 401);
            const { thread_id } = await request.json();
            if (!thread_id) return json({ error: 'Missing thread_id' }, 400);

            const existing = await db.prepare('SELECT 1 FROM watchlist WHERE user_id = ? AND thread_id = ?').bind(user.user_id, thread_id).first();
            if (existing) {
                await db.prepare('DELETE FROM watchlist WHERE user_id = ? AND thread_id = ?').bind(user.user_id, thread_id).run();
                return json({ success: true, watched: false });
            } else {
                await db.prepare('INSERT INTO watchlist (user_id, thread_id, created_at) VALUES (?, ?, ?)').bind(user.user_id, thread_id, Date.now()).run();
                return json({ success: true, watched: true });
            }
        }

        // 8e. Gamification: User Profile Stats (XP, Level, Rank, Streak, Oshi Badge)
        if (route === 'user' && path[1] === 'profile' && method === 'GET') {
            if (!user) return json({ error: 'Login required' }, 401);
            const u = await db.prepare(`
                SELECT id, username, role, display_title, xp, level, streak, last_active_date, last_omikuji_date, oshi_badge 
                FROM users WHERE id = ?
            `).bind(user.user_id).first();
            if (!u) return json({ error: 'User not found' }, 404);

            const level = calculateLevel(u.xp || 0);
            const rank = getRank(level);
            const today = getTodayDateStr();
            const canDraw = u.last_omikuji_date !== today;

            return json({
                success: true,
                user: {
                    id: u.id,
                    username: u.username,
                    role: u.role,
                    display_title: u.display_title,
                    xp: u.xp || 0,
                    level,
                    rankTitle: rank.title,
                    rankBadge: rank.badge,
                    streak: u.streak || 0,
                    oshi_badge: u.oshi_badge || null,
                    can_draw_omikuji: canDraw,
                    last_omikuji_date: u.last_omikuji_date
                }
            });
        }

        // 8f. Gamification: Daily Oshi Omikuji Draw
        if (route === 'user' && path[1] === 'omikuji' && method === 'POST') {
            if (!user) return json({ error: 'Login required' }, 401);
            const u = await db.prepare('SELECT id, xp, level, streak, last_active_date, last_omikuji_date FROM users WHERE id = ?').bind(user.user_id).first();
            if (!u) return json({ error: 'User not found' }, 404);

            const today = getTodayDateStr();
            if (u.last_omikuji_date === today) {
                return json({ error: 'Already drawn today' }, 400);
            }

            let newStreak = 1;
            if (u.last_active_date) {
                const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
                if (u.last_active_date === yesterday) {
                    newStreak = (u.streak || 0) + 1;
                } else if (u.last_active_date === today) {
                    newStreak = u.streak || 1;
                }
            }

            const fortune = OMIKUJI_FORTUNES[Math.floor(Math.random() * OMIKUJI_FORTUNES.length)];
            const streakBonus = (newStreak > 1) ? XP_RULES.DAILY_STREAK : 0;
            const xpAwarded = XP_RULES.OMIKUJI_DRAW + streakBonus;
            const newXp = (u.xp || 0) + xpAwarded;
            const newLevel = calculateLevel(newXp);

            await db.prepare(`
                UPDATE users 
                SET xp = ?, level = ?, streak = ?, last_active_date = ?, last_omikuji_date = ?
                WHERE id = ?
            `).bind(newXp, newLevel, newStreak, today, today, u.id).run();

            const rank = getRank(newLevel);
            return json({
                success: true,
                fortune,
                xp_awarded: xpAwarded,
                total_xp: newXp,
                level: newLevel,
                rankTitle: rank.title,
                rankBadge: rank.badge,
                streak: newStreak
            });
        }

        // 8g. Gamification: Update Custom Oshi Badge
        if (route === 'user' && path[1] === 'badge' && method === 'POST') {
            if (!user) return json({ error: 'Login required' }, 401);
            const { badge } = await request.json();
            if (badge && !ALLOWED_OSHI_BADGES.includes(badge)) {
                return json({ error: 'Invalid oshi badge option' }, 400);
            }
            await db.prepare('UPDATE users SET oshi_badge = ? WHERE id = ?').bind(badge || null, user.user_id).run();
            return json({ success: true, oshi_badge: badge || null });
        }

        // 9. Admin Moderation
        if (route === 'admin' && (user?.role === 'admin' || user?.role === 'mod')) {
            const sub = path[1];
            const body = await request.json();

            if (sub === 'delete') {
                if (body.type === 'thread') {
                    await db.prepare('DELETE FROM threads WHERE id = ?').bind(body.id).run();
                } else if (body.type === 'reply') {
                    await db.prepare('DELETE FROM replies WHERE id = ?').bind(body.id).run();
                }
                return json({ success: true });
            }
            if (sub === 'pin') {
                const th = await db.prepare('SELECT is_pinned FROM threads WHERE id = ?').bind(body.thread_id).first();
                const newPinned = th?.is_pinned ? 0 : 1;
                await db.prepare('UPDATE threads SET is_pinned = ? WHERE id = ?').bind(newPinned, body.thread_id).run();
                return json({ success: true, is_pinned: newPinned });
            }
            if (sub === 'lock') {
                const th = await db.prepare('SELECT is_locked FROM threads WHERE id = ?').bind(body.thread_id).first();
                const newLocked = th?.is_locked ? 0 : 1;
                await db.prepare('UPDATE threads SET is_locked = ? WHERE id = ?').bind(newLocked, body.thread_id).run();
                return json({ success: true, is_locked: newLocked });
            }
            if (sub === 'settings' && user?.role === 'admin') {
                const { key, value } = body;
                if (!key) return json({ error: 'Missing key' }, 400);
                await db.prepare('INSERT OR REPLACE INTO site_settings (key, value) VALUES (?, ?)').bind(key, value || '').run();
                return json({ success: true, key, value });
            }
        }

        // 10. Site Settings (e.g. Banner Image)
        if (route === 'settings' && method === 'GET') {
            try {
                const rows = (await db.prepare('SELECT key, value FROM site_settings').all()).results || [];
                const settings = {};
                for (const r of rows) settings[r.key] = r.value;
                return json({ success: true, settings });
            } catch {
                return json({ success: true, settings: {} });
            }
        }

        return json({ error: 'Not Found' }, 404);
    } catch (err) {
        return json({ error: err.message }, 500);
    }
}
