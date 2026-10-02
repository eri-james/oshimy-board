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

const AUTO_LOCK_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const ARCHIVE_STATIC_GRACE_MS = 14 * 24 * 60 * 60 * 1000;

async function runD1AutoLock(db) {
    if (!db) return;
    try {
        const autoLockCutoff = Date.now() - AUTO_LOCK_DAYS_MS;
        await db.prepare(`
            UPDATE threads 
            SET is_locked = 1, is_archived = 1, locked_at = ?
            WHERE bumped_at < ? AND (is_locked = 0 OR is_locked IS NULL)
        `).bind(Date.now(), autoLockCutoff).run();
    } catch (_) {}
}

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
    THREAD_CREATION: 20,
    REPLY_CREATION: 8,
    OMIKUJI_DRAW: 16,
    DAILY_STREAK: 4,
    REACTION_RECEIVED: 4
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

const BOARD_FAN_NAMES = {
    'myvt':  ['Oshi-min', 'Gachikoi', 'DD Lurker', 'Kaigai-niki (MY)', 'Superchat Whale', 'Mamak Watcher'],
    'vt':    ['Shrimp', 'Kenzoku', 'Takodachi', 'Dragoon', 'Ruffian', 'Niji-anon', 'DD Clip Watcher'],
    'vg':    ['Sweaty Gamer', 'Gacha Salt Miner', 'F2P BTW', 'Frame Perfect Anon', 'Backlog Warrior'],
    'amg':   ['Seasonal Watcher', 'Manga Reader', 'LN Purist', 'Sakuga Enjoyer', 'Seiyuu Otaku'],
    'ca':    ['CF Booth Pilgrim', 'Cosplay Photog', 'Sketchbook Anon', 'Itasha Driver', 'Rigger-san'],
    'tech':  ['ThinkPad Enjoyer', 'Arch BTW', 'Homelab Anon', 'VRAM Hoarder', 'Mechanical Keycapper'],
    'mamak': ['Teh Tarik Kurang Manis', 'Roti Canai Banjir', 'Bossku', 'Lepak Anon', 'Maggi Goreng Doubly'],
    'rqr':   ['Janny Summoner', 'Rule Lawyer', 'Feedback Anon', 'Bug Hunter'],
    'myvth': ['Bonk Patrol Target', 'Halal-not Anon', 'Cultured Oshi-min', '3AM Lurker'],
    'vth':   ['Cultured Shrimp', 'Seiso Reject', 'Lewdtuber Enjoyer', 'Bonk Evader'],
    'hm':    ['6-Digit Scholar', 'Tag Filterer', 'Uncensored Seeker', 'Doujin Connoisseur'],
    'hg':    ['VN Reader', 'RPGMaker Veteran', 'Illusionist', 'Save File Collector']
};

const ALLOWED_STAMPS = ['kusa', 'tskr', 'uoooh', 'ikz', 'oshi', 'glowstick'];

function resolveAuthorName(rawName, board) {
    const trimmed = (rawName || '').trim();
    if (!trimmed || trimmed.toLowerCase() === 'anonymous') {
        const list = BOARD_FAN_NAMES[board] || ['Anonymous'];
        return list[Math.floor(Math.random() * list.length)];
    }
    return trimmed;
}

async function generatePosterIdEdge(ipHash, threadId) {
    const enc = new TextEncoder();
    const data = enc.encode((ipHash || 'anon') + '::thread_salt::' + (threadId || 'global'));
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 8);
}

async function attachPosterIdsEdge(postList, fallbackThreadId = null) {
    if (!Array.isArray(postList)) return postList;
    await Promise.all(postList.map(async (p) => {
        const tid = p.thread_id || fallbackThreadId || p.id;
        p.poster_id = await generatePosterIdEdge(p.ip_hash || 'anon', tid);
        if (!p.reactions) p.reactions = '{}';
    }));
    return postList;
}

async function resolveVanityFlairEdge(db, userId, showVanity, guestFlair) {
    if (userId && showVanity) {
        try {
            const u = await db.prepare('SELECT xp, level, streak, oshi_badge, last_omikuji_date FROM users WHERE id = ?').bind(userId).first();
            if (u) {
                const level = calculateLevel(u.xp || 0);
                const rank = getRank(level);
                return JSON.stringify({
                    rankBadge: rank.badge,
                    rankTitle: rank.title,
                    level,
                    streak: u.streak || 0,
                    oshiBadge: u.oshi_badge || null
                });
            }
        } catch (_) {}
    }
    if (guestFlair && typeof guestFlair === 'object') {
        const safe = {};
        if (guestFlair.oshiBadge && ALLOWED_OSHI_BADGES.includes(guestFlair.oshiBadge)) {
            safe.oshiBadge = guestFlair.oshiBadge;
        }
        if (Object.keys(safe).length > 0) return JSON.stringify(safe);
    }
    return null;
}

function getXpRequirementForLevel(level) {
    const lvl = Math.max(1, parseInt(level, 10) || 1);
    let req = 25;
    for (let i = 1; i < lvl; i++) {
        req = Math.round(req * 1.1);
    }
    return req;
}

function calculateLevel(xp) {
    const validXp = Math.max(0, parseInt(xp, 10) || 0);
    let remXp = validXp;
    let level = 1;
    let currentReq = 25;
    while (remXp >= currentReq) {
        remXp -= currentReq;
        level++;
        currentReq = Math.round(currentReq * 1.1);
    }
    return level;
}

function getLevelProgress(xp) {
    const validXp = Math.max(0, parseInt(xp, 10) || 0);
    let remXp = validXp;
    let level = 1;
    let currentReq = 25;
    while (remXp >= currentReq) {
        remXp -= currentReq;
        level++;
        currentReq = Math.round(currentReq * 1.1);
    }
    const progressXp = remXp;
    const nextLevelReq = currentReq;
    const percent = nextLevelReq > 0 ? Math.min(100, Math.floor((progressXp / nextLevelReq) * 100)) : 100;
    return {
        level,
        progressXp,
        nextLevelReq,
        percent
    };
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
    if (!userId || !xpAmount || xpAmount <= 0) return;
    try {
        const user = await db.prepare('SELECT xp FROM users WHERE id = ?').bind(userId).first();
        if (!user) return;
        const newXp = (user.xp || 0) + xpAmount;
        const newLevel = calculateLevel(newXp);
        await db.prepare(`
            UPDATE users
            SET xp = ?,
                level = ?
            WHERE id = ?
        `).bind(newXp, newLevel, userId).run();
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

// Helper: Auto-migrate Cloudflare D1 schema for existing live databases missing newer columns/tables
let d1SchemaMigrated = false;

async function ensureD1Schema(db, force = false) {
    if (!db || (d1SchemaMigrated && !force)) return;
    d1SchemaMigrated = true;
    try {
        // 1. Ensure threads.reply_count, vanity_flair, reactions exist and are synced
        let threadCols = [];
        try {
            const threadColsRes = await db.prepare("PRAGMA table_info(threads)").all();
            threadCols = (threadColsRes.results || []).map(c => c.name);
        } catch (_) {}

        if (threadCols.length > 0 && !threadCols.includes('reply_count')) {
            try {
                await db.prepare("ALTER TABLE threads ADD COLUMN reply_count INTEGER NOT NULL DEFAULT 0").run();
                await db.prepare("UPDATE threads SET reply_count = (SELECT COUNT(*) FROM replies WHERE replies.thread_id = threads.id)").run();
            } catch (_) {}
        }
        if (threadCols.length > 0 && !threadCols.includes('vanity_flair')) {
            await db.prepare("ALTER TABLE threads ADD COLUMN vanity_flair TEXT").run().catch(() => {});
        }
        if (threadCols.length > 0 && !threadCols.includes('reactions')) {
            await db.prepare("ALTER TABLE threads ADD COLUMN reactions TEXT DEFAULT '{}'").run().catch(() => {});
        }
        if (threadCols.length > 0 && !threadCols.includes('is_archived')) {
            await db.prepare("ALTER TABLE threads ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0").run().catch(() => {});
        }
        if (threadCols.length > 0 && !threadCols.includes('locked_at')) {
            await db.prepare("ALTER TABLE threads ADD COLUMN locked_at INTEGER DEFAULT NULL").run().catch(() => {});
        }
        if (threadCols.length > 0 && !threadCols.includes('is_static')) {
            await db.prepare("ALTER TABLE threads ADD COLUMN is_static INTEGER NOT NULL DEFAULT 0").run().catch(() => {});
        }
        if (threadCols.length > 0 && !threadCols.includes('static_path')) {
            await db.prepare("ALTER TABLE threads ADD COLUMN static_path TEXT DEFAULT NULL").run().catch(() => {});
        }

        // 1b. Ensure replies.vanity_flair and replies.reactions exist
        try {
            const replyColsRes = await db.prepare("PRAGMA table_info(replies)").all();
            const replyCols = (replyColsRes.results || []).map(c => c.name);
            if (replyCols.length > 0 && !replyCols.includes('vanity_flair')) {
                await db.prepare("ALTER TABLE replies ADD COLUMN vanity_flair TEXT").run().catch(() => {});
            }
            if (replyCols.length > 0 && !replyCols.includes('reactions')) {
                await db.prepare("ALTER TABLE replies ADD COLUMN reactions TEXT DEFAULT '{}'").run().catch(() => {});
            }
        } catch (_) {}

        // 1c. Ensure post_reactions table exists
        await db.prepare(`
            CREATE TABLE IF NOT EXISTS post_reactions (
                post_id TEXT NOT NULL,
                post_type TEXT NOT NULL,
                ip_hash TEXT NOT NULL,
                stamp TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                PRIMARY KEY (post_id, ip_hash, stamp)
            )
        `).run().catch(() => {});

        // 2. Ensure users gamification columns exist
        let userCols = [];
        try {
            const userColsRes = await db.prepare("PRAGMA table_info(users)").all();
            userCols = (userColsRes.results || []).map(c => c.name);
        } catch (_) {}

        const addColIfMissing = async (col, def) => {
            if (!userCols.includes(col)) {
                await db.prepare(`ALTER TABLE users ADD COLUMN ${col} ${def}`).run().catch(() => {});
            }
        };
        await addColIfMissing('xp', 'INTEGER NOT NULL DEFAULT 0');
        await addColIfMissing('level', 'INTEGER NOT NULL DEFAULT 1');
        await addColIfMissing('streak', 'INTEGER NOT NULL DEFAULT 0');
        await addColIfMissing('last_active_date', 'TEXT');
        await addColIfMissing('last_omikuji_date', 'TEXT');
        await addColIfMissing('oshi_badge', 'TEXT');

        // 3. Ensure reply_mentions, watchlist, and site_settings tables exist
        await db.prepare(`
            CREATE TABLE IF NOT EXISTS reply_mentions (
                id TEXT PRIMARY KEY,
                source_reply_id TEXT,
                target_user_id TEXT NOT NULL,
                thread_id TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                is_read INTEGER NOT NULL DEFAULT 0
            )
        `).run().catch(() => {});
        await db.prepare("CREATE INDEX IF NOT EXISTS idx_mentions_target_unread ON reply_mentions(target_user_id, is_read)").run().catch(() => {});
        await db.prepare("CREATE INDEX IF NOT EXISTS idx_mentions_target_created ON reply_mentions(target_user_id, created_at DESC)").run().catch(() => {});
        await db.prepare("CREATE INDEX IF NOT EXISTS idx_replies_thread_created_desc ON replies(thread_id, created_at DESC)").run().catch(() => {});
        await db.prepare(`
            CREATE TABLE IF NOT EXISTS watchlist (
                user_id TEXT NOT NULL,
                thread_id TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                PRIMARY KEY (user_id, thread_id)
            )
        `).run().catch(() => {});
        await db.prepare(`
            CREATE TABLE IF NOT EXISTS site_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        `).run().catch(() => {});
    } catch (_) {
        d1SchemaMigrated = false;
    }
}

// Helper: Calculate lightweight user perks sync data for Cloudflare D1
// Uses indexed reply_mentions table to eliminate full table scans (Audit Finding 1 & Recommendation A.2)
async function getD1UserSyncData(db, userId) {
    if (!userId) return null;
    try {
        const notif = await db.prepare(`
            SELECT COUNT(*) as unread_count
            FROM reply_mentions
            WHERE target_user_id = ? AND is_read = 0
        `).bind(userId).first();

        const watch = await db.prepare('SELECT COUNT(*) as watch_count FROM watchlist WHERE user_id = ?').bind(userId).first();

        return {
            unread_notifications: notif ? notif.unread_count : 0,
            watchlist_count: watch ? watch.watch_count : 0
        };
    } catch (e) {
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

    // Cloudflare Edge Cache API (Audit Recommendation B.1)
    const isPublicCacheable = method === 'GET' && (
        path[0] === 'threads' || 
        (path[0] === 'thread' && !url.searchParams.has('since')) ||
        path[0] === 'boards'
    );
    let edgeCache = null;
    let cacheKey = null;
    try {
        if (typeof caches !== 'undefined' && caches.default) {
            edgeCache = caches.default;
            cacheKey = new Request(request.url, request);
            if (isPublicCacheable) {
                const cachedResp = await edgeCache.match(cacheKey);
                if (cachedResp) {
                    return cachedResp;
                }
            }
        }
    } catch (_) {}

    const db = getDb(env);
    if (!db) {
        return json({
            error: "Cloudflare D1 binding not found. Please go to Pages Settings > Functions > D1 database bindings, ensure Variable name is 'DB' (uppercase) for both Production and Preview environments, and trigger a new deployment."
        }, 500);
    }

    const route = path[0] || '';
    if (route !== 'proxy' && route !== 'pixiv' && route !== 'twitter' && route !== 'reddit' && route !== 'upload') {
        await ensureD1Schema(db);
    }
    const user = await getUser(request, db);

    try {
        // Offloaded Image & Video Upload Proxy (Catbox.moe permanent primary with userhash + ImgBB fallback for images)
        if (route === 'upload' && method === 'POST') {
            const reqContentType = (request.headers.get('content-type') || '').toLowerCase();
            let bytes = null;
            let filename = '';
            let cleanBase64 = '';

            if (reqContentType.includes('application/octet-stream')) {
                const arrayBuf = await request.arrayBuffer();
                bytes = new Uint8Array(arrayBuf);
                try {
                    filename = decodeURIComponent(request.headers.get('x-file-name') || '');
                } catch (_) {
                    filename = String(request.headers.get('x-file-name') || '');
                }
            } else {
                const body = await request.json();
                const { image_base64, file_base64, filename: bodyFilename } = body || {};
                const rawBase64 = image_base64 || file_base64;
                if (!rawBase64) {
                    return json({ error: 'Missing media payload' }, 400);
                }
                filename = bodyFilename || '';
                const strBase64 = String(rawBase64);
                const commaIdx = strBase64.indexOf(',');
                cleanBase64 = (commaIdx !== -1 ? strBase64.slice(commaIdx + 1) : strBase64).replace(/\s+/g, '');
                const binaryStr = atob(cleanBase64);
                const bLen = binaryStr.length;
                bytes = new Uint8Array(bLen);
                for (let i = 0; i < bLen; i++) {
                    bytes[i] = binaryStr.charCodeAt(i);
                }
            }

            const len = bytes ? bytes.byteLength : 0;
            if (len < 12) {
                return json({ error: 'Invalid or empty file' }, 400);
            }
            if (len > 20 * 1024 * 1024) {
                return json({ error: 'File exceeds 20MB maximum limit' }, 413);
            }

            // 1. Magic-byte signature detection
            let detectedMime = null;
            if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
                detectedMime = 'image/jpeg';
            } else if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
                detectedMime = 'image/png';
            } else if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
                detectedMime = 'image/gif';
            } else if (
                bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
                bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
            ) {
                detectedMime = 'image/webp';
            } else if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
                detectedMime = 'video/mp4';
            } else if (bytes[0] === 0x1A && bytes[1] === 0x45 && bytes[2] === 0xDF && bytes[3] === 0xA3) {
                detectedMime = 'video/webm';
            }

            const allowedMimes = {
                'image/jpeg': { ext: 'jpg',  maxBytes: 5 * 1024 * 1024,  label: 'Static Image (JPG)' },
                'image/png':  { ext: 'png',  maxBytes: 5 * 1024 * 1024,  label: 'Static Image (PNG)' },
                'image/webp': { ext: 'webp', maxBytes: 5 * 1024 * 1024,  label: 'WebP Image' },
                'image/gif':  { ext: 'gif',  maxBytes: 8 * 1024 * 1024,  label: 'Animated GIF' },
                'video/mp4':  { ext: 'mp4',  maxBytes: 20 * 1024 * 1024, label: 'MP4 Video' },
                'video/webm': { ext: 'webm', maxBytes: 20 * 1024 * 1024, label: 'WebM Video' }
            };

            const rule = detectedMime ? allowedMimes[detectedMime] : null;
            if (!rule) {
                return json({
                    error: 'Unsupported file format. Allowed: JPG, PNG, WebP (max 5MB), GIF (max 8MB), and MP4/WebM video (max 20MB).'
                }, 415);
            }

            if (detectedMime === 'video/webm' && filename && /\.mkv$/i.test(filename)) {
                return json({
                    error: 'MKV videos are not supported by browsers. Please upload MP4 or WebM.'
                }, 415);
            }

            // 2. Enforce tiered size limits
            if (len > rule.maxBytes) {
                const maxMB = Math.round(rule.maxBytes / (1024 * 1024));
                const actualMB = (len / (1024 * 1024)).toFixed(1);
                return json({
                    error: `${rule.label} is ${actualMB}MB, which exceeds the ${maxMB}MB limit.`
                }, 413);
            }

            const isVideo = detectedMime.startsWith('video/');
            const baseName = (filename || `oshimy_${Date.now()}`).replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_') || `oshimy_${Date.now()}`;
            const safeName = `${baseName}.${rule.ext}`;
            const catboxUserhash = env?.CATBOX_USERHASH || '1e5680e58e931a1d509c280dc';

            // Helper: Build multipart/form-data binary body
            const buildMultipartPayload = (fields, fileField, fileBytes, fileName, fileMime) => {
                const boundary = '----OshiMYBoundary' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
                const enc = new TextEncoder();
                let headerStr = '';
                for (const [k, v] of Object.entries(fields)) {
                    headerStr += `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`;
                }
                headerStr += `--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${fileName}"\r\nContent-Type: ${fileMime}\r\n\r\n`;
                const headerBytes = enc.encode(headerStr);
                const footerBytes = enc.encode(`\r\n--${boundary}--\r\n`);
                const multipartBody = new Uint8Array(headerBytes.length + fileBytes.byteLength + footerBytes.length);
                multipartBody.set(headerBytes, 0);
                multipartBody.set(fileBytes, headerBytes.length);
                multipartBody.set(footerBytes, headerBytes.length + fileBytes.byteLength);
                return { multipartBody, boundary };
            };

            // 3. Primary: Catbox.moe permanent upload API using raw binary multipart body
            // Includes HEAD verification to guard against Catbox 0-byte ghost files on retry
            try {
                const { multipartBody, boundary } = buildMultipartPayload(
                    { reqtype: 'fileupload', userhash: catboxUserhash },
                    'fileToUpload',
                    bytes,
                    safeName,
                    detectedMime
                );

                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 18000);
                const catResp = await fetch('https://catbox.moe/user/api.php', {
                    method: 'POST',
                    body: multipartBody,
                    signal: controller.signal,
                    headers: {
                        'Content-Type': `multipart/form-data; boundary=${boundary}`,
                        'User-Agent': 'OshiMY-Imageboard/1.0 (+https://oshimy.moe)'
                    }
                });
                clearTimeout(timeout);

                if (catResp.ok) {
                    const textUrl = (await catResp.text()).trim();
                    if (textUrl.startsWith('https://files.catbox.moe/')) {
                        // Verify Catbox actually wrote non-zero bytes (prevents 0-byte ghost file URL on retry)
                        let catboxVerified = false;
                        try {
                            const vCtrl = new AbortController();
                            const vTimer = setTimeout(() => vCtrl.abort(), 4500);
                            const vResp = await fetch(textUrl, {
                                method: 'HEAD',
                                signal: vCtrl.signal,
                                headers: { 'User-Agent': 'OshiMY-Imageboard/1.0 (+https://oshimy.moe)' }
                            });
                            clearTimeout(vTimer);
                            const contentLen = parseInt(vResp.headers.get('content-length') || '0', 10);
                            if (vResp.ok && contentLen > 32) {
                                catboxVerified = true;
                            }
                        } catch (_) {}

                        if (catboxVerified) {
                            return json({
                                success: true,
                                url: textUrl,
                                provider: 'catbox.moe',
                                media_kind: isVideo ? 'video' : 'image'
                            });
                        }
                    }
                }
            } catch (_) {}

            // 4. Secondary Permanent Failovers for Images: Freeimage.host (Cloudflare CDN) & ImgBB
            if (!isVideo) {
                if (!cleanBase64) {
                    let bin = '';
                    const chunk = 0x8000;
                    for (let i = 0; i < bytes.length; i += chunk) {
                        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
                    }
                    cleanBase64 = btoa(bin);
                }

                // 4a. Freeimage.host (Permanent Cloudflare-backed direct image CDN: iili.io)
                try {
                    const freeImgKey = env?.FREEIMAGE_API_KEY || '6d207e02198a847aa98d0a2a901485a5';
                    const freeForm = new URLSearchParams();
                    freeForm.append('key', freeImgKey);
                    freeForm.append('action', 'upload');
                    freeForm.append('source', cleanBase64);
                    freeForm.append('format', 'json');
                    const fCtrl = new AbortController();
                    const fTimer = setTimeout(() => fCtrl.abort(), 15000);
                    const freeResp = await fetch('https://freeimage.host/api/1/upload', {
                        method: 'POST',
                        body: freeForm,
                        signal: fCtrl.signal
                    });
                    clearTimeout(fTimer);
                    if (freeResp.ok) {
                        const freeData = await freeResp.json();
                        if (freeData?.status_code === 200 && freeData?.image?.url) {
                            return json({
                                success: true,
                                url: freeData.image.url,
                                provider: 'freeimage.host',
                                media_kind: 'image'
                            });
                        }
                    }
                } catch (_) {}

                // 4b. ImgBB (Permanent direct image host: i.ibb.co)
                const candidateKeys = [
                    env?.IMGBB_API_KEY,
                    '6d885f930c72cd28e6520e6c7494704f'
                ].filter((k, idx, arr) => k && k !== 'ba7dd29db4fb9b62ebfb8fae4c6c7922' && arr.indexOf(k) === idx);

                for (const imgbbKey of candidateKeys) {
                    try {
                        const imgbbForm = new URLSearchParams();
                        imgbbForm.append('image', cleanBase64);
                        const ibbCtrl = new AbortController();
                        const ibbTimer = setTimeout(() => ibbCtrl.abort(), 15000);
                        const ibbResp = await fetch(`https://api.imgbb.com/1/upload?key=${imgbbKey}`, {
                            method: 'POST',
                            body: imgbbForm,
                            signal: ibbCtrl.signal
                        });
                        clearTimeout(ibbTimer);
                        const ibbData = await ibbResp.json();
                        if (ibbData?.success && ibbData?.data?.url) {
                            return json({
                                success: true,
                                url: ibbData.data.url,
                                provider: 'imgbb',
                                media_kind: 'image'
                            });
                        }
                    } catch (_) {}
                }
            }

            // 5. Tertiary Permanent Failover for both Videos & Images: kappa.lol (supports MP4, WebM, GIF, WebP, JPG, PNG)
            try {
                const { multipartBody, boundary } = buildMultipartPayload(
                    {},
                    'file',
                    bytes,
                    safeName,
                    detectedMime
                );
                const kCtrl = new AbortController();
                const kTimer = setTimeout(() => kCtrl.abort(), 22000);
                const kResp = await fetch('https://kappa.lol/api/upload', {
                    method: 'POST',
                    body: multipartBody,
                    signal: kCtrl.signal,
                    headers: {
                        'Content-Type': `multipart/form-data; boundary=${boundary}`,
                        'User-Agent': 'OshiMY-Imageboard/1.0 (+https://oshimy.moe)'
                    }
                });
                clearTimeout(kTimer);
                if (kResp.ok) {
                    const kData = await kResp.json();
                    if (kData?.link) {
                        const extSuffix = kData.ext || `.${rule.ext}`;
                        const finalUrl = kData.link.endsWith(extSuffix) ? kData.link : `${kData.link}${extSuffix}`;
                        return json({
                            success: true,
                            url: finalUrl,
                            provider: 'kappa.lol',
                            media_kind: isVideo ? 'video' : 'image'
                        });
                    }
                }
            } catch (_) {}

            return json({ error: 'All permanent media hosts failed to accept the upload. Please try again.' }, 502);
        }
        // Pixiv Image Reverse Proxy for Cloudflare Pages (bypasses hotlink blocks)
        if (route === 'proxy' && path[1] === 'pixiv' && method === 'GET') {
            const targetUrl = url.searchParams.get('url');
            if (!targetUrl) return new Response('Missing url parameter', { status: 400 });

            let parsedUrl;
            try {
                parsedUrl = new URL(targetUrl);
            } catch (_) {
                return new Response('Invalid url format', { status: 400 });
            }

            const hostname = parsedUrl.hostname.toLowerCase();
            if (hostname !== 'pximg.net' && !hostname.endsWith('.pximg.net')) {
                return new Response('Only pximg.net domains are supported', { status: 403 });
            }

            try {
                let upstreamResp = await fetch(targetUrl, {
                    headers: {
                        'Referer': 'https://www.pixiv.net/',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
                    }
                });

                if (!upstreamResp.ok) {
                    const helperUrl = targetUrl.replace(/^https?:\/\/[a-zA-Z0-9-]+\.pximg\.net\//i, 'https://i.pixiv.re/');
                    try {
                        const helperResp = await fetch(helperUrl);
                        if (helperResp.ok) upstreamResp = helperResp;
                    } catch (_) {}
                }

                if (!upstreamResp.ok) {
                    return new Response(`Upstream Pixiv error: ${upstreamResp.status}`, { status: upstreamResp.status });
                }

                const contentType = upstreamResp.headers.get('content-type') || 'image/jpeg';
                const headers = new Headers({
                    'Content-Type': contentType,
                    'Cache-Control': 'public, max-age=86400, immutable',
                    'Access-Control-Allow-Origin': '*'
                });
                const contentLength = upstreamResp.headers.get('content-length');
                if (contentLength) headers.set('Content-Length', contentLength);

                return new Response(upstreamResp.body, { status: 200, headers });
            } catch (err) {
                try {
                    const helperUrl = targetUrl.replace(/^https?:\/\/[a-zA-Z0-9-]+\.pximg\.net\//i, 'https://i.pixiv.re/');
                    const helperResp = await fetch(helperUrl);
                    if (helperResp.ok) {
                        const headers = new Headers({
                            'Content-Type': helperResp.headers.get('content-type') || 'image/jpeg',
                            'Cache-Control': 'public, max-age=86400, immutable',
                            'Access-Control-Allow-Origin': '*'
                        });
                        return new Response(helperResp.body, { status: 200, headers });
                    }
                } catch (_) {}
                return new Response('Error proxying Pixiv image', { status: 502 });
            }
        }

        // Video Thumbnail fallback route for Cloudflare Pages (zero D1 reads/writes; falls back to static black thumbnail PNG if no ?thumb= was attached)
        if (route === 'video' && path[1] === 'thumbnail' && method === 'GET') {
            return Response.redirect(`${url.origin}/asset/img/video_black_thumb.png`, 302);
        }

        // Video Streaming Proxy route supporting HTTP Range (scrubbing, streaming)
        if (route === 'proxy' && path[1] === 'video' && method === 'GET') {
            const rawUrl = url.searchParams.get('url');
            if (!rawUrl) return new Response('Missing video url', { status: 400 });

            try {
                const target = new URL(rawUrl);
                const allowedHosts = [
                    'video.twimg.com', 'pbs.twimg.com', 'twimg.com',
                    'v.redd.it', 'packaged-media.redd.it', 'preview.redd.it', 'i.redd.it', 'reddit.com', 'redditmedia.com',
                    'vxreddit.com', 'rxddit.com', 'embedez.com', 'redditez.com', 'akamaized.net', 'cloudfront.net'
                ];
                const isAllowed = allowedHosts.some(h => target.hostname === h || target.hostname.endsWith('.' + h));
                if (!isAllowed) {
                    return new Response('Host not allowed for video proxy', { status: 403 });
                }

                const headers = new Headers();
                headers.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
                headers.set('Referer', target.hostname.includes('twimg.com') ? 'https://x.com/' : (target.hostname.includes('vxreddit.com') ? 'https://vxreddit.com/' : 'https://www.reddit.com/'));

                const clientRange = request.headers.get('Range');
                if (clientRange) {
                    headers.set('Range', clientRange);
                }

                const upstream = await fetch(rawUrl, { headers, redirect: 'follow' });
                const responseHeaders = new Headers(upstream.headers);
                responseHeaders.set('Access-Control-Allow-Origin', '*');
                responseHeaders.set('Accept-Ranges', 'bytes');
                if (!responseHeaders.has('Content-Type')) {
                    responseHeaders.set('Content-Type', 'video/mp4');
                }

                return new Response(upstream.body, {
                    status: upstream.status,
                    headers: responseHeaders
                });
            } catch (err) {
                return new Response('Error proxying video', { status: 502 });
            }
        }

        // Pixiv Artwork Metadata resolver
        if (route === 'pixiv' && path[1] === 'artwork' && method === 'GET') {
            const illustId = url.searchParams.get('id');
            if (!illustId || !/^\d+$/.test(String(illustId).trim())) {
                return json({ error: 'Invalid or missing Pixiv illustration id' }, 400);
            }

            const cleanId = String(illustId).trim();
            try {
                let body = null;
                let isR18 = false;
                let title = `Artwork #${cleanId}`;
                let author = 'Pixiv Artist';
                let authorId = '';
                let pageCount = 1;
                let imageUrl = '';

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
                } catch (_) {}

                if (!imageUrl) {
                    try {
                        const helperCheck = await fetch(`https://pixiv.re/${cleanId}.jpg`, { method: 'HEAD' });
                        if (helperCheck.ok) {
                            imageUrl = `https://pixiv.re/${cleanId}.jpg`;
                        }
                    } catch (_) {}
                }

                // If pageCount is 1 or body was not retrieved, probe if multiple pages exist via helper
                if (pageCount <= 1) {
                    try {
                        const p2Check = await fetch(`https://pixiv.re/${cleanId}-2.jpg`, { method: 'HEAD' });
                        if (p2Check.ok) {
                            const probes = await Promise.all([3, 4, 5, 6, 7, 8].map(async p => {
                                try {
                                    const r = await fetch(`https://pixiv.re/${cleanId}-${p}.jpg`, { method: 'HEAD' });
                                    return r.ok ? p : 0;
                                } catch (_) { return 0; }
                            }));
                            pageCount = Math.max(2, ...probes);
                            if (!imageUrl) imageUrl = `https://pixiv.re/${cleanId}.jpg`;
                        }
                    } catch (_) {}
                }

                // If title or author is still generic fallback, scrape from Pixiv artwork page HTML
                if (title === `Artwork #${cleanId}`) {
                    try {
                        const pageResp = await fetch(`https://www.pixiv.net/artworks/${cleanId}`, {
                            headers: {
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                            }
                        });
                        if (pageResp.ok) {
                            const html = await pageResp.text();
                            const titleMatch = html.match(/<meta property="twitter:title" content="([^"]+)"/i) || html.match(/<meta property="og:title" content="([^"]+)"/i);
                            if (titleMatch && titleMatch[1]) {
                                title = titleMatch[1].replace(/ - pixiv$/i, '').trim();
                            }
                            const authorMatch = html.match(/\/users\/(\d+)"[^>]*>([^<]+)<\/a>/i);
                            if (authorMatch && authorMatch[2]) {
                                author = authorMatch[2].trim();
                                authorId = authorMatch[1];
                            }
                        }
                    } catch (_) {}
                }

                let proxyUrl = '';
                if (imageUrl) {
                    if (imageUrl.includes('pixiv.re')) {
                        proxyUrl = imageUrl;
                    } else {
                        proxyUrl = `/api/proxy/pixiv?url=${encodeURIComponent(imageUrl)}`;
                    }
                }

                if (!imageUrl) {
                    return json({ error: 'Artwork not found or completely removed from Pixiv' }, 404);
                }

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

                return json({ success: true, artwork });
            } catch (err) {
                return json({ error: 'Failed to fetch Pixiv artwork data' }, 500);
            }
        }

        // Twitter / 𝕏 Tweet Details Resolver via vxTwitter & fxTwitter proxy helpers
        if (route === 'twitter' && path[1] === 'tweet' && method === 'GET') {
            const id = url.searchParams.get('id');
            const handle = url.searchParams.get('handle') || 'i';
            if (!id || !/^\d+$/.test(String(id).trim())) {
                return json({ error: 'Invalid tweet id' }, 400);
            }

            const cleanId = String(id).trim();
            try {
                let tweetData = null;

                try {
                    const vxResp = await fetch(`https://api.vxtwitter.com/${handle}/status/${cleanId}`, {
                        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
                    });
                    if (vxResp.ok) {
                        tweetData = await vxResp.json();
                    }
                } catch (_) {}

                if (!tweetData) {
                    try {
                        const fxResp = await fetch(`https://api.fxtwitter.com/${handle}/status/${cleanId}`, {
                            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
                        });
                        if (fxResp.ok) {
                            const fxJson = await fxResp.json();
                            if (fxJson && fxJson.tweet) {
                                const t = fxJson.tweet;
                                const allMedia = [
                                    ...(t.media?.all || []),
                                    ...(t.media?.videos || []),
                                    ...(t.media?.photos || [])
                                ];
                        const seenUrls = new Set();
                        const uniqueMedia = [];
                        for (const m of allMedia) {
                            if (m && m.url && !seenUrls.has(m.url)) {
                                seenUrls.add(m.url);
                                uniqueMedia.push(m);
                            }
                        }

                        tweetData = {
                            tweetID: t.id,
                            tweetURL: t.url,
                            text: t.text,
                            user_name: t.author?.name || handle,
                            user_screen_name: t.author?.screen_name || handle,
                            user_profile_image_url: t.author?.avatar_url,
                            likes: t.likes || 0,
                            retweets: t.retweets || 0,
                            media_extended: uniqueMedia.map(m => {
                                const isVid = m.type === 'video' || m.type === 'gif' || (m.url && m.url.includes('.mp4')) || (m.url && m.url.includes('tweet_video'));
                                let thumb = m.thumbnail_url || null;
                                if (!thumb || thumb.includes('.mp4')) {
                                    const vidMatch = (m.url || '').match(/tweet_video\/([a-zA-Z0-9_-]+)\.mp4/i);
                                    if (vidMatch) {
                                        thumb = `https://pbs.twimg.com/tweet_video_thumb/${vidMatch[1]}.jpg`;
                                    }
                                }
                                return {
                                    type: isVid ? (m.type === 'gif' || (m.url && m.url.includes('tweet_video')) ? 'gif' : 'video') : 'image',
                                    url: m.url,
                                    thumbnail_url: thumb || (isVid ? null : m.url),
                                    size: { width: m.width, height: m.height }
                                };
                            })
                        };
                    }
                }
            } catch (_) {}
        }

        if (!tweetData) {
            return json({ error: 'Tweet not found or could not be retrieved' }, 404);
        }

        // Process media items (videos, gifs, multi-images)
        const mediaList = tweetData.media_extended || [];
        const videoItem = mediaList.find(m => m.type === 'video' || m.type === 'gif' || (m.url && (m.url.includes('.mp4') || m.url.includes('tweet_video'))));
        const imageItems = mediaList.filter(m => m.type === 'image' && !m.url?.includes('.mp4') && !m.url?.includes('tweet_video'));
        const isGif = videoItem ? (videoItem.type === 'gif' || (videoItem.url && videoItem.url.includes('tweet_video'))) : false;

        let videoThumb = videoItem ? (videoItem.thumbnail_url || null) : null;
        if ((!videoThumb || videoThumb.includes('.mp4')) && videoItem && videoItem.url) {
            const vidMatch = videoItem.url.match(/tweet_video\/([a-zA-Z0-9_-]+)\.mp4/i);
            if (vidMatch) {
                videoThumb = `https://pbs.twimg.com/tweet_video_thumb/${vidMatch[1]}.jpg`;
            }
        }

        const pages = imageItems.map((img, idx) => ({
            pageIndex: idx,
            displayUrl: img.url,
            helperUrl: `https://wsrv.nl/?url=${encodeURIComponent(img.url)}&output=webp&we`,
            originalUrl: img.url
        }));

        const tweet = {
            id: cleanId,
            url: tweetData.tweetURL || `https://x.com/${tweetData.user_screen_name || handle}/status/${cleanId}`,
            text: tweetData.text || '',
            authorName: tweetData.user_name || handle,
            authorHandle: tweetData.user_screen_name || handle,
            avatar: tweetData.user_profile_image_url || '',
            likes: tweetData.likes || 0,
            retweets: tweetData.retweets || 0,
            hasMedia: mediaList.length > 0,
            mediaType: videoItem ? 'video' : (imageItems.length > 0 ? 'image' : 'none'),
            isGif: Boolean(isGif),
            videoUrl: videoItem ? videoItem.url : null,
            videoThumbnail: videoThumb,
            imageUrl: imageItems.length > 0 ? imageItems[0].url : null,
            pages,
            pageCount: pages.length
        };

                return json({ success: true, tweet });
            } catch (err) {
                return json({ error: 'Failed to fetch tweet details' }, 500);
            }
        }

        // Reddit Post Details Resolver using vxreddit proxy helper with rich media extraction & oEmbed fallback
        if (route === 'reddit' && path[1] === 'post' && method === 'GET') {
            const postUrl = url.searchParams.get('url');
            if (!postUrl) {
                return json({ error: 'Missing Reddit post url' }, 400);
            }

            const cleanUrl = String(postUrl).trim();
            try {
                let subreddit = 'reddit';
                const subMatch = cleanUrl.match(/(?:reddit\.com|vxreddit\.com|rxddit\.com)\/r\/([a-zA-Z0-9_]+)/i);
                if (subMatch) subreddit = subMatch[1];
                
                // Extract post ID or video ID from various Reddit formats
                const idMatch = cleanUrl.match(/(?:\/comments\/|\/s\/|redd\.it\/|v\.redd\.it\/|\/video\/)([a-zA-Z0-9_-]+)/i);
                const postId = idMatch ? idMatch[1] : '';
                const isDirectVideo = /v\.redd\.it|reddit\.com\/video\//i.test(cleanUrl);

                let title = '';
                let author = '';
                let score = '';
                let comments = '';
                let imageUrl = null;
                let videoUrl = null;
                let videoThumbnail = null;
                let description = '';
                let html = '';
                let rawImages = [];

                const decodeEntities = (s) => {
                    if (!s || typeof s !== 'string') return '';
                    return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x2F;/gi, '/');
                };

                // 1. Primary Query: vxreddit proxy helper with Discordbot User-Agent
                let vxredditUrl = cleanUrl;
                const vMatch = cleanUrl.match(/v\.redd\.it\/([a-zA-Z0-9_-]+)/i);
                const rMatch = cleanUrl.match(/(?:https?:\/\/)?redd\.it\/([a-zA-Z0-9_-]+)/i);
                if (vMatch) {
                    vxredditUrl = `https://vxreddit.com/comments/${vMatch[1]}`;
                } else if (rMatch) {
                    vxredditUrl = `https://vxreddit.com/comments/${rMatch[1]}`;
                } else if (/https?:\/\/(?:www\.)?vxreddit\.com/i.test(cleanUrl)) {
                    vxredditUrl = cleanUrl;
                } else if (/https?:\/\/(?:www\.)?rxddit\.com/i.test(cleanUrl)) {
                    vxredditUrl = cleanUrl.replace(/rxddit\.com/i, 'vxreddit.com');
                } else {
                    vxredditUrl = cleanUrl.replace(/https?:\/\/(?:www\.|old\.|new\.|m\.|sh\.)?reddit\.com/i, 'https://vxreddit.com');
                }

                try {
                    const controller = new AbortController();
                    const timeout = setTimeout(() => controller.abort(), 5000);
                    const vxResp = await fetch(vxredditUrl, {
                        signal: controller.signal,
                        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)' },
                        redirect: 'follow'
                    });
                    clearTimeout(timeout);

                    if (vxResp.ok) {
                        const vxHtml = await vxResp.text();

                        const siteMatch = vxHtml.match(/<meta\s+(?:property|name)=["']og:site_name["']\s+content=["']([^"']+)["']/i) ||
                                          vxHtml.match(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["']og:site_name["']/i);
                        if (siteMatch && siteMatch[1]) {
                            const rawSite = decodeEntities(siteMatch[1].trim());
                            const parsedSite = rawSite.match(/u\/([^\s]+)\s+on\s+r\/([^\s]+)(?:\s*-\s*⬆️\s*([\d,]+)\s*\|\s*💬\s*([\d,]+))?/i);
                            if (parsedSite) {
                                if (parsedSite[1] && parsedSite[1] !== '[deleted]') author = parsedSite[1];
                                if (parsedSite[2]) subreddit = parsedSite[2];
                                if (parsedSite[3]) score = parsedSite[3];
                                if (parsedSite[4]) comments = parsedSite[4];
                            }
                        }

                        const titleMatch = vxHtml.match(/<meta\s+(?:property|name)=["'](?:og:title|twitter:title)["']\s+content=["']([^"']+)["']/i) ||
                                           vxHtml.match(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["'](?:og:title|twitter:title)["']/i);
                        if (titleMatch && titleMatch[1]) {
                            const rawTitle = decodeEntities(titleMatch[1].trim());
                            if (rawTitle && rawTitle !== 'vxReddit' && !rawTitle.startsWith('[')) {
                                title = rawTitle;
                            }
                        }

                        const descMatch = vxHtml.match(/<meta\s+(?:property|name)=["'](?:og:description|twitter:description)["']\s+content=["']([^"']+)["']/i) ||
                                          vxHtml.match(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["'](?:og:description|twitter:description)["']/i);
                        if (descMatch && descMatch[1]) {
                            const rawDesc = decodeEntities(descMatch[1].trim());
                            if (rawDesc && rawDesc !== '[deleted]' && rawDesc !== '[removed]' && rawDesc !== 'Invalid post path' && !rawDesc.toLowerCase().includes('failed to get data')) {
                                description = rawDesc;
                            }
                        }

                        const vidMatch = vxHtml.match(/<meta\s+(?:property|name)=["'](?:og:video|og:video:url|og:video:secure_url|twitter:player:stream)["']\s+content=["'](https?:\/\/[^"']+)["']/i) ||
                                         vxHtml.match(/<meta\s+content=["'](https?:\/\/[^"']+)["']\s+(?:property|name)=["'](?:og:video|og:video:url|og:video:secure_url|twitter:player:stream)["']/i);
                        if (vidMatch && vidMatch[1]) {
                            videoUrl = decodeEntities(vidMatch[1].trim());
                        }

                        const imgMatches = [...vxHtml.matchAll(/<meta\s+(?:property|name)=["'](?:og:image|twitter:image)["']\s+content=["'](https?:\/\/[^"']+)["']/gi)];
                        for (const m of imgMatches) {
                            if (m[1]) {
                                const decodedImg = decodeEntities(m[1].trim());
                                if (!rawImages.includes(decodedImg)) {
                                    rawImages.push(decodedImg);
                                }
                            }
                        }
                    }
                } catch (_) {}

                // Direct v.redd.it fallback & vxreddit muxer resolution to direct renders.vxreddit.com / CMAF .mp4 stream
                if (isDirectVideo && !videoUrl && postId) {
                    videoUrl = `https://vxreddit.com/redditvideo.mp4?video_url=${encodeURIComponent('https://v.redd.it/' + postId + '/CMAF_720.m3u8')}&audio_url=${encodeURIComponent('https://v.redd.it/' + postId + '/CMAF_AUDIO_128.m3u8')}`;
                }

                if (videoUrl && videoUrl.includes('vxreddit.com/redditvideo.mp4')) {
                    try {
                        const muxController = new AbortController();
                        const muxTimeout = setTimeout(() => muxController.abort(), 3800);
                        const muxResp = await fetch(videoUrl, {
                            method: 'GET',
                            headers: {
                                'User-Agent': 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
                                'Range': 'bytes=0-0'
                            },
                            redirect: 'follow',
                            signal: muxController.signal
                        });
                        clearTimeout(muxTimeout);
                        if ((muxResp.ok || muxResp.status === 206) && muxResp.url && !muxResp.url.includes('redditvideo.mp4')) {
                            videoUrl = muxResp.url;
                        }
                    } catch (_) {}
                }

                // 2. Secondary Query: redditez / embedez fallback
                if (!title || (!videoUrl && rawImages.length === 0)) {
                    try {
                        const redditezPath = postId ? `/comments/${postId}` : (new URL(cleanUrl).pathname);
                        const redditezUrl = `https://redditez.com${redditezPath}`;
                        const ezController = new AbortController();
                        const ezTimeout = setTimeout(() => ezController.abort(), 3500);
                        const ezResp = await fetch(redditezUrl, {
                            signal: ezController.signal,
                            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)' }
                        });
                        clearTimeout(ezTimeout);

                        if (ezResp.ok) {
                            const ezHtml = await ezResp.text();

                            if (!title) {
                                const ogTitle = ezHtml.match(/<meta\s+(?:property|name)=["'](?:og:title|twitter:title)["']\s+content=["']([^"']+)["']/i);
                                if (ogTitle && ogTitle[1]) title = decodeEntities(ogTitle[1].trim());
                            }

                            if (!description) {
                                const ogDesc = ezHtml.match(/<meta\s+(?:property|name)=["'](?:og:description|twitter:description)["']\s+content=["']([^"']+)["']/i);
                                if (ogDesc && ogDesc[1]) description = decodeEntities(ogDesc[1].trim());
                            }

                            if (!videoUrl) {
                                const ogVid = ezHtml.match(/<meta\s+(?:property|name)=["'](?:og:video|og:video:url|og:video:secure_url|twitter:player:stream)["']\s+content=["'](https?:\/\/[^"']+)["']/i);
                                if (ogVid && ogVid[1]) videoUrl = decodeEntities(ogVid[1].trim());
                            }

                            const redirectMatches = ezHtml.match(/https?:\/\/[^\s"'<>\\]+path=content\.media\.\d+\.source/g) || [];
                            for (const rm of redirectMatches) {
                                if (!rawImages.includes(rm)) rawImages.push(rm);
                            }

                            if (rawImages.length === 0) {
                                const ogImg = ezHtml.match(/<meta\s+(?:property|name)=["'](?:og:image|twitter:image)["']\s+content=["'](https?:\/\/[^"']+)["']/i);
                                if (ogImg && ogImg[1]) rawImages.push(decodeEntities(ogImg[1].trim()));
                            }
                        }
                    } catch (_) {}
                }

                // 3. Official Reddit oEmbed query for fallback metadata
                if (!title || (!videoUrl && rawImages.length === 0)) {
                    try {
                        const oembedUrl = `https://www.reddit.com/oembed?url=${encodeURIComponent(cleanUrl)}`;
                        const controller = new AbortController();
                        const timeout = setTimeout(() => controller.abort(), 3000);
                        const oResp = await fetch(oembedUrl, {
                            signal: controller.signal,
                            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
                        });
                        clearTimeout(timeout);

                        if (oResp.ok) {
                            const oData = await oResp.json();
                            if (oData.title && (!title || title.startsWith('['))) title = oData.title;
                            if (oData.author_name && !author) author = oData.author_name;
                            if (oData.html) html = oData.html;
                            if (!videoThumbnail && oData.thumbnail_url) videoThumbnail = oData.thumbnail_url;
                            if (rawImages.length === 0 && oData.thumbnail_url) rawImages.push(oData.thumbnail_url);
                        }
                    } catch (_) {}
                }

                // Resolve EmbedEZ redirect URLs in parallel (up to 12 images) to direct i.redd.it links
                const resolvedImages = await Promise.all(rawImages.slice(0, 12).map(async (rawImg) => {
                    if (rawImg.includes('embedez.com/api/v2/redirect') || rawImg.includes('redditez.com/api/v2/redirect')) {
                        try {
                            const headController = new AbortController();
                            const headTimeout = setTimeout(() => headController.abort(), 2000);
                            const headResp = await fetch(rawImg, {
                                method: 'HEAD',
                                redirect: 'follow',
                                signal: headController.signal
                            });
                            clearTimeout(headTimeout);
                            if (headResp && headResp.url) {
                                return headResp.url;
                            }
                        } catch (_) {}
                    }
                    return rawImg;
                }));

                // Build pages array for multi-image carousel
                const pages = resolvedImages.map((imgUrl, idx) => ({
                    pageIndex: idx,
                    displayUrl: imgUrl,
                    helperUrl: imgUrl,
                    originalUrl: imgUrl
                }));

                if (!title) title = `Reddit Post in r/${subreddit}`;
                if (!author) author = 'Reddit User';

                imageUrl = pages.length > 0 ? pages[0].displayUrl : null;
                const mediaType = videoUrl ? 'video' : (pages.length > 0 ? 'image' : 'text');

                const post = {
                    url: cleanUrl,
                    vxUrl: vxredditUrl,
                    title,
                    author,
                    subreddit,
                    postId,
                    score,
                    comments,
                    description,
                    mediaType,
                    videoUrl,
                    videoThumbnail: videoThumbnail || imageUrl,
                    imageUrl,
                    thumbnailUrl: imageUrl || videoThumbnail || null,
                    pages,
                    pageCount: pages.length,
                    html
                };

                return json({ success: true, post });
            } catch (err) {
                return json({ error: 'Failed to fetch Reddit post details' }, 500);
            }
        }

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

            await runD1AutoLock(db);

            // HTTP Caching & 304 Not Modified check via fast index lookup
            let metaSql = 'SELECT MAX(bumped_at) as max_bump, COUNT(*) as count FROM threads WHERE board = ?';
            if (isArchive) {
                metaSql += ` AND (is_locked = 1 OR is_archived = 1)`;
            } else {
                metaSql += ` AND (is_locked = 0 AND (is_archived IS NULL OR is_archived = 0))`;
            }
            const isCatalog = url.searchParams.get('mode') === 'catalog';
            const meta = await db.prepare(metaSql).bind(board).first();
            const maxBump = meta?.max_bump || 0;
            const count = meta?.count || 0;
            const etag = `W/"th-${board}-${isArchive ? 'arch' : 'act'}-${isCatalog ? 'cat' : 'list'}-${count}-${maxBump}"`;

            if (request.headers.get('if-none-match') === etag) {
                return new Response(null, {
                    status: 304,
                    headers: {
                        'ETag': etag,
                        'Cache-Control': 'public, max-age=5, stale-while-revalidate=15',
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Headers': '*'
                    }
                });
            }

            let sql = `SELECT t.*, (SELECT COUNT(*) FROM replies r WHERE r.thread_id = t.id) as reply_count FROM threads t WHERE t.board = ?`;
            if (isArchive) {
                sql += ` AND (t.is_locked = 1 OR t.is_archived = 1) ORDER BY COALESCE(t.locked_at, t.bumped_at) DESC LIMIT 100`;
            } else {
                sql += ` AND (t.is_locked = 0 AND (t.is_archived IS NULL OR t.is_archived = 0)) ORDER BY t.is_pinned DESC, t.bumped_at DESC LIMIT 50`;
            }

            const list = await db.prepare(sql).bind(board).all();
            const threads = list.results || [];

            await Promise.all(threads.map(async (th) => {
                th.poster_id = await generatePosterIdEdge(th.ip_hash || 'anon', th.id);
                if (!th.reactions) th.reactions = '{}';
                th.preview_replies = [];
                if (isCatalog && th.comment && th.comment.length > 220) {
                    th.comment = th.comment.substring(0, 220) + '…';
                }
            }));

            // Preview replies: query latest replies for threads with replies (skip when mode=catalog)
            const threadsWithReplies = isCatalog ? [] : threads.filter(t => (t.reply_count || 0) > 0);
            if (threadsWithReplies.length > 0) {
                const threadIds = threadsWithReplies.map(t => t.id);
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
                const prevResults = prev.results || [];
                await Promise.all(prevResults.map(async (r) => {
                    r.poster_id = await generatePosterIdEdge(r.ip_hash || 'anon', r.thread_id);
                    if (!r.reactions) r.reactions = '{}';
                }));
                for (const r of prevResults) {
                    if (!replyMap.has(r.thread_id)) replyMap.set(r.thread_id, []);
                    replyMap.get(r.thread_id).push(r);
                }
                for (const th of threads) {
                    if (replyMap.has(th.id)) {
                        th.preview_replies = replyMap.get(th.id);
                    }
                }
            }

            const responseData = { success: true, threads };
            const headers = { 
                'ETag': etag, 
                'Cache-Control': 'public, max-age=5, stale-while-revalidate=15',
                'Access-Control-Expose-Headers': 'ETag'
            };

            const resp = json(responseData, 200, headers);
            if (edgeCache && cacheKey) {
                context.waitUntil(edgeCache.put(cacheKey, resp.clone()));
            }
            return resp;
        }

        // 3. GET /api/thread?id=... (with optional ?since=TIMESTAMP delta updates)
        if (route === 'thread' && method === 'GET') {
            const id = url.searchParams.get('id');
            if (!id) return json({ error: 'Missing id' }, 400);

            const since = parseInt(url.searchParams.get('since') || '0', 10);

            // Delta Polling Optimization (Audit Recommendation C.2)
            if (since > 0) {
                const repliesRes = await db.prepare('SELECT * FROM replies WHERE thread_id = ? AND created_at > ? ORDER BY created_at ASC').bind(id, since).all();
                const replies = await attachPosterIdsEdge(repliesRes.results || [], id);
                if (replies.length === 0) {
                    return json({
                        success: true,
                        thread: null,
                        replies: [],
                        is_delta: true,
                        total_replies: -1
                    }, 200, { 'Cache-Control': 'no-cache' });
                }
                return json({
                    success: true,
                    thread: null,
                    replies,
                    is_delta: true,
                    total_replies: -1
                }, 200, { 'Cache-Control': 'no-cache' });
            }

            const thread = await db.prepare('SELECT * FROM threads WHERE id = ?').bind(id).first();
            if (!thread) return json({ error: 'Not found' }, 404);
            thread.poster_id = await generatePosterIdEdge(thread.ip_hash || 'anon', thread.id);
            if (!thread.reactions) thread.reactions = '{}';

            const etag = `W/"tr-${thread.id}-${thread.bumped_at}-${thread.is_pinned}-${thread.is_locked}"`;
            if (request.headers.get('if-none-match') === etag) {
                return new Response(null, {
                    status: 304,
                    headers: {
                        'ETag': etag,
                        'Cache-Control': 'public, max-age=5, stale-while-revalidate=15',
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Headers': '*'
                    }
                });
            }

            const rawReplies = (await db.prepare('SELECT * FROM replies WHERE thread_id = ? ORDER BY created_at ASC').bind(id).all()).results || [];
            const replies = await attachPosterIdsEdge(rawReplies, id);
            const totalReplies = thread.reply_count || replies.length;

            const responseData = { 
                success: true, 
                thread, 
                replies,
                is_delta: false,
                total_replies: totalReplies
            };

            const headers = { 
                'ETag': etag, 
                'Cache-Control': 'public, max-age=5, stale-while-revalidate=15',
                'Access-Control-Expose-Headers': 'ETag'
            };

            const resp = json(responseData, 200, headers);
            if (edgeCache && cacheKey) {
                context.waitUntil(edgeCache.put(cacheKey, resp.clone()));
            }
            return resp;
        }

        // 4. POST /api/threads
        if (route === 'threads' && method === 'POST') {
            const body = await request.json();
            const { board, name, subject, comment, media_url, post_as_anonymous, show_vanity_flair, guest_flair } = body;
            if (!board || !BOARDS[board] || !comment?.trim()) return json({ error: 'Invalid input' }, 400);

            const id = '-' + Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
            const now = Date.now();
            const clientIp = request.headers.get('cf-connecting-ip') || 'anon';
            const posterName = resolveAuthorName(name, board);
            const posterSubject = (subject?.trim() || '');
            const posterMedia = (media_url?.trim() || '');
            const hideIdentity = Boolean(post_as_anonymous);
            const visibleRole = hideIdentity ? null : (user?.role || null);
            const visibleTitle = hideIdentity ? null : (user?.display_title || null);
            const vanityFlair = await resolveVanityFlairEdge(db, user?.user_id, show_vanity_flair !== false, guest_flair);

            try {
                await db.prepare(`
                    INSERT INTO threads (id, board, name, subject, comment, media_url, ip_hash, user_id, role, display_title, vanity_flair, reactions, created_at, bumped_at, is_pinned, is_locked)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, 0, 0)
                `).bind(
                    id, board, posterName, posterSubject, comment.trim(), posterMedia,
                    clientIp, user?.user_id || null, visibleRole, visibleTitle, vanityFlair, now, now
                ).run();
            } catch (_) {
                await ensureD1Schema(db, true);
                await db.prepare(`
                    INSERT INTO threads (id, board, name, subject, comment, media_url, ip_hash, user_id, role, display_title, created_at, bumped_at, is_pinned, is_locked)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
                `).bind(
                    id, board, posterName, posterSubject, comment.trim(), posterMedia,
                    clientIp, user?.user_id || null, visibleRole, visibleTitle, now, now
                ).run();
            }

            if (user?.user_id) {
                await awardD1UserXp(db, user.user_id, XP_RULES.THREAD_CREATION);
            }

            // Invalidate edge cache for this board
            if (edgeCache) {
                const purgeUrl = new URL(request.url);
                purgeUrl.pathname = '/api/threads';
                purgeUrl.search = `?b=${board}`;
                context.waitUntil(edgeCache.delete(new Request(purgeUrl.toString())));
            }

            // Construct in memory without redundant SELECT (Audit Recommendation A.5)
            const createdThread = {
                id,
                board,
                name: posterName,
                subject: posterSubject,
                comment: comment.trim(),
                media_url: posterMedia,
                ip_hash: clientIp,
                poster_id: await generatePosterIdEdge(clientIp, id),
                user_id: user?.user_id || null,
                role: visibleRole,
                display_title: visibleTitle,
                vanity_flair: vanityFlair,
                reactions: '{}',
                created_at: now,
                bumped_at: now,
                is_pinned: 0,
                is_locked: 0,
                reply_count: 0
            };

            return json({ success: true, thread: createdThread });
        }

        // 5. POST /api/replies
        if (route === 'replies' && method === 'POST') {
            const body = await request.json();
            const { thread_id, name, comment, media_url, post_as_anonymous, show_vanity_flair, guest_flair } = body;
            if (!thread_id || !comment?.trim()) return json({ error: 'Missing comment or thread_id' }, 400);

            const thread = await db.prepare('SELECT * FROM threads WHERE id = ?').bind(thread_id).first();
            if (!thread) return json({ error: 'Thread not found' }, 404);
            if (thread.is_locked || thread.is_archived) {
                return json({ error: 'This thread is archived and locked. New replies are disabled.' }, 403);
            }

            const id = '-' + Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
            const now = Date.now();
            const clientIp = request.headers.get('cf-connecting-ip') || 'anon';
            const posterName = resolveAuthorName(name, thread.board);
            const posterMedia = (media_url?.trim() || '');
            const hideIdentity = Boolean(post_as_anonymous);
            const visibleRole = hideIdentity ? null : (user?.role || null);
            const visibleTitle = hideIdentity ? null : (user?.display_title || null);
            const vanityFlair = await resolveVanityFlairEdge(db, user?.user_id, show_vanity_flair !== false, guest_flair);

            try {
                await db.prepare(`
                    INSERT INTO replies (id, thread_id, board, name, comment, media_url, ip_hash, user_id, role, display_title, vanity_flair, reactions, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?)
                `).bind(
                    id, thread_id, thread.board, posterName, comment.trim(), posterMedia,
                    clientIp, user?.user_id || null, visibleRole, visibleTitle, vanityFlair, now
                ).run();
            } catch (_) {
                await ensureD1Schema(db, true);
                await db.prepare(`
                    INSERT INTO replies (id, thread_id, board, name, comment, media_url, ip_hash, user_id, role, display_title, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).bind(
                    id, thread_id, thread.board, posterName, comment.trim(), posterMedia,
                    clientIp, user?.user_id || null, visibleRole, visibleTitle, now
                ).run();
            }

            // Bump thread activity and denormalized reply_count (Audit Finding 3 & 5)
            try {
                await db.prepare('UPDATE threads SET reply_count = reply_count + 1, bumped_at = ? WHERE id = ?').bind(now, thread_id).run();
            } catch (_) {
                await ensureD1Schema(db, true);
                try {
                    await db.prepare('UPDATE threads SET reply_count = reply_count + 1, bumped_at = ? WHERE id = ?').bind(now, thread_id).run();
                } catch (_) {
                    await db.prepare('UPDATE threads SET bumped_at = ? WHERE id = ?').bind(now, thread_id).run();
                }
            }

            // Mention and OP notification detection (Audit Finding 1 & Recommendation A.2)
            try {
                const targetUserIds = new Set();
                if (thread.user_id && thread.user_id !== user?.user_id) {
                    targetUserIds.add(thread.user_id);
                }
                const quoteMatches = comment.matchAll(/>>(?:#)?([a-zA-Z0-9_\-]+)/g);
                for (const match of quoteMatches) {
                    const rawQuote = match[1];
                    if (thread.id === rawQuote || thread.id.includes(rawQuote)) {
                        if (thread.user_id && thread.user_id !== user?.user_id) {
                            targetUserIds.add(thread.user_id);
                        }
                    }
                    const quotedReply = await db.prepare(`
                        SELECT user_id FROM replies 
                        WHERE thread_id = ? AND (id = ? OR id LIKE ?)
                        LIMIT 1
                    `).bind(thread_id, rawQuote, '%' + rawQuote + '%').first();
                    if (quotedReply && quotedReply.user_id && quotedReply.user_id !== user?.user_id) {
                        targetUserIds.add(quotedReply.user_id);
                    }
                }

                for (const targetUid of targetUserIds) {
                    const mentionId = 'm_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
                    await db.prepare(`
                        INSERT OR IGNORE INTO reply_mentions (id, source_reply_id, target_user_id, thread_id, created_at, is_read)
                        VALUES (?, ?, ?, ?, ?, 0)
                    `).bind(mentionId, id, targetUid, thread_id, now).run().catch(() => {});
                }
            } catch (mErr) {}

            if (user?.user_id) {
                await awardD1UserXp(db, user.user_id, XP_RULES.REPLY_CREATION);
            }

            // Invalidate edge cache for this thread and board
            if (edgeCache) {
                const threadUrl = new URL(request.url);
                threadUrl.pathname = '/api/thread';
                threadUrl.search = `?id=${thread_id}`;
                context.waitUntil(edgeCache.delete(new Request(threadUrl.toString())));

                const boardUrl = new URL(request.url);
                boardUrl.pathname = '/api/threads';
                boardUrl.search = `?b=${thread.board}`;
                context.waitUntil(edgeCache.delete(new Request(boardUrl.toString())));
            }

            // Construct in memory without redundant SELECT (Audit Recommendation A.5)
            const createdReply = {
                id,
                thread_id,
                board: thread.board,
                name: posterName,
                comment: comment.trim(),
                media_url: posterMedia,
                ip_hash: clientIp,
                poster_id: await generatePosterIdEdge(clientIp, thread_id),
                user_id: user?.user_id || null,
                role: visibleRole,
                display_title: visibleTitle,
                vanity_flair: vanityFlair,
                reactions: '{}',
                created_at: now
            };

            return json({ success: true, reply: createdReply });
        }

        // 5b. POST /api/reactions/toggle (Lightweight "Kusa / Wotagei" Stamp Reactions)
        if (route === 'reactions' && path[1] === 'toggle' && method === 'POST') {
            const body = await request.json();
            const { post_id, post_type, stamp } = body || {};
            if (!post_id || !ALLOWED_STAMPS.includes(stamp)) {
                return json({ error: 'Invalid reaction parameters' }, 400);
            }
            const table = post_type === 'thread' ? 'threads' : 'replies';
            const target = await db.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(post_id).first();
            if (!target) return json({ error: 'Post not found' }, 404);

            let isArchivedOrLocked = false;
            if (post_type === 'thread') {
                isArchivedOrLocked = Boolean(target.is_locked || target.is_archived);
            } else {
                const parent = await db.prepare('SELECT is_locked, is_archived FROM threads WHERE id = ?').bind(target.thread_id).first();
                if (parent && (parent.is_locked || parent.is_archived)) {
                    isArchivedOrLocked = true;
                }
            }
            if (isArchivedOrLocked) {
                return json({ error: 'This thread is archived. Reactions are closed.' }, 403);
            }

            const ipHash = request.headers.get('cf-connecting-ip') || 'anon';
            let reactionsObj = {};
            try {
                reactionsObj = JSON.parse(target.reactions || '{}') || {};
            } catch (_) {
                reactionsObj = {};
            }

            const existing = await db.prepare(
                'SELECT 1 FROM post_reactions WHERE post_id = ? AND ip_hash = ? AND stamp = ?'
            ).bind(post_id, ipHash, stamp).first();

            let active = false;
            if (existing) {
                await db.prepare('DELETE FROM post_reactions WHERE post_id = ? AND ip_hash = ? AND stamp = ?').bind(post_id, ipHash, stamp).run();
                reactionsObj[stamp] = Math.max(0, (parseInt(reactionsObj[stamp], 10) || 1) - 1);
                if (reactionsObj[stamp] <= 0) delete reactionsObj[stamp];
                active = false;
            } else {
                await db.prepare(
                    'INSERT INTO post_reactions (post_id, post_type, ip_hash, stamp, created_at) VALUES (?, ?, ?, ?, ?)'
                ).bind(post_id, post_type === 'thread' ? 'thread' : 'reply', ipHash, stamp, Date.now()).run();
                reactionsObj[stamp] = (parseInt(reactionsObj[stamp], 10) || 0) + 1;
                active = true;
                if (target.user_id) {
                    await awardD1UserXp(db, target.user_id, XP_RULES.REACTION_RECEIVED || 4);
                }
            }

            const updatedJson = JSON.stringify(reactionsObj);
            await db.prepare(`UPDATE ${table} SET reactions = ? WHERE id = ?`).bind(updatedJson, post_id).run().catch(() => {});

            return json({
                success: true,
                post_id,
                stamp,
                active,
                reactions: reactionsObj
            });
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

        // 8c. User Perks: Notifications (Indexed reply_mentions query - Audit Finding 1 & Recommendation A.2)
        if (route === 'user' && path[1] === 'notifications' && method === 'GET') {
            if (!user) return json({ success: true, notifications: [] });
            const uid = user.user_id;
            try {
                const notifs = (await db.prepare(`
                    SELECT m.id as mention_id, m.is_read, r.id, r.thread_id, r.board, r.name, r.comment, r.created_at, t.subject
                    FROM reply_mentions m
                    JOIN replies r ON r.id = m.source_reply_id
                    JOIN threads t ON t.id = m.thread_id
                    WHERE m.target_user_id = ?
                    ORDER BY m.created_at DESC LIMIT 30
                `).bind(uid).all()).results || [];

                await db.prepare('UPDATE reply_mentions SET is_read = 1 WHERE target_user_id = ? AND is_read = 0').bind(uid).run().catch(() => {});

                return json({ success: true, notifications: notifs });
            } catch (_) {
                await ensureD1Schema(db, true);
                return json({ success: true, notifications: [] });
            }
        }

        // 8c2. Dedicated User Sync Endpoint (Decoupled from content polling - Audit Recommendation A.3)
        if (route === 'user' && path[1] === 'sync' && method === 'GET') {
            if (!user) return json({ success: true, user_sync: null });
            const sync = await getD1UserSyncData(db, user.user_id);
            return json({ success: true, user_sync: sync });
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
            const u = await db.prepare('SELECT * FROM users WHERE id = ?').bind(user.user_id).first();
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
                    last_omikuji_date: u.last_omikuji_date || null
                }
            });
        }

        // 8f. Gamification: Daily Oshi Omikuji Draw
        if (route === 'user' && path[1] === 'omikuji' && method === 'POST') {
            if (!user) return json({ error: 'Login required' }, 401);
            const u = await db.prepare('SELECT * FROM users WHERE id = ?').bind(user.user_id).first();
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

            try {
                await db.prepare(`
                    UPDATE users 
                    SET xp = ?, level = ?, streak = ?, last_active_date = ?, last_omikuji_date = ?
                    WHERE id = ?
                `).bind(newXp, newLevel, newStreak, today, today, u.id).run();
            } catch (_) {
                await ensureD1Schema(db, true);
                await db.prepare(`
                    UPDATE users 
                    SET xp = ?, level = ?, streak = ?, last_active_date = ?, last_omikuji_date = ?
                    WHERE id = ?
                `).bind(newXp, newLevel, newStreak, today, today, u.id).run().catch(() => {});
            }

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
            try {
                await db.prepare('UPDATE users SET oshi_badge = ? WHERE id = ?').bind(badge || null, user.user_id).run();
            } catch (_) {
                await ensureD1Schema(db, true);
                await db.prepare('UPDATE users SET oshi_badge = ? WHERE id = ?').bind(badge || null, user.user_id).run().catch(() => {});
            }
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
                    const rep = await db.prepare('SELECT thread_id FROM replies WHERE id = ?').bind(body.id).first();
                    await db.prepare('DELETE FROM replies WHERE id = ?').bind(body.id).run();
                    if (rep) {
                        await db.prepare('UPDATE threads SET reply_count = MAX(0, reply_count - 1) WHERE id = ?').bind(rep.thread_id).run().catch(() => {});
                    }
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
                const th = await db.prepare('SELECT is_locked, is_archived, is_static FROM threads WHERE id = ?').bind(body.thread_id).first();
                if (th?.is_static) {
                    return json({ error: 'This thread is permanently baked into static HTML and cannot be unlocked.' }, 400);
                }
                const newLocked = th?.is_locked ? 0 : 1;
                const lockedAt = newLocked ? Date.now() : null;
                await db.prepare('UPDATE threads SET is_locked = ?, is_archived = ?, locked_at = ? WHERE id = ?').bind(newLocked, newLocked, lockedAt, body.thread_id).run();
                return json({ success: true, is_locked: newLocked, is_archived: newLocked, locked_at: lockedAt });
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
