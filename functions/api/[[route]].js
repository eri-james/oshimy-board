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

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': '*'
        }
    });
}

// Find D1 binding across common casing/names
function getDb(env) {
    if (!env) return null;
    return env.DB || env.db || env.D1 || env.DATABASE || env.database || env['myvt-db'] || env.myvt_db || env['myvt-database'] || null;
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

            // Attach preview replies
            for (const th of threads) {
                const prev = await db.prepare(
                    'SELECT * FROM (SELECT * FROM replies WHERE thread_id = ? ORDER BY created_at DESC LIMIT 3) ORDER BY created_at ASC'
                ).bind(th.id).all();
                th.preview_replies = prev.results || [];
            }

            return json({ success: true, threads });
        }

        // 3. GET /api/thread?id=...
        if (route === 'thread' && method === 'GET') {
            const id = url.searchParams.get('id');
            if (!id) return json({ error: 'Missing id' }, 400);

            const thread = await db.prepare('SELECT * FROM threads WHERE id = ?').bind(id).first();
            if (!thread) return json({ error: 'Not found' }, 404);

            const replies = await db.prepare('SELECT * FROM replies WHERE thread_id = ? ORDER BY created_at ASC').bind(id).all();
            return json({ success: true, thread, replies: replies.results || [] });
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
