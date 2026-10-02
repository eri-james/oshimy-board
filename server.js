import express from 'express';
import path from 'path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'url';
import { db, hashPassword, verifyPassword, hashIp, generateId, generatePosterId } from './server/db.js';
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
const PORT = 3000;

app.set('trust proxy', true);

// Cache directory for extracted video first-frame thumbnails
const VIDEO_THUMBS_DIR = path.join(__dirname, 'cache', 'video_thumbs');
if (!fs.existsSync(VIDEO_THUMBS_DIR)) {
    try { fs.mkdirSync(VIDEO_THUMBS_DIR, { recursive: true }); } catch (_) {}
}

// Consistent HTTPS-aware origin resolver
function getOrigin(req) {
    const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
    const host = req.headers['x-forwarded-host'] || req.get('host') || '127.0.0.1:3000';
    return `${proto}://${host}`;
}

app.use('/api/upload', express.raw({ type: 'application/octet-stream', limit: '25mb' }));
app.use(express.json({ limit: '30mb' }));
app.use(express.urlencoded({ extended: true, limit: '30mb' }));

// Board definitions
const BOARDS = {
    'myvt':  { title: '/myvt/ - MY VTuber',             type: 'sfw',  fanName: 'Anon DD' },
    'vt':    { title: '/vt/ - SEA & Global VTuber',     type: 'sfw',  fanName: 'Global DD' },
    'vg':    { title: '/vg/ - Video Games',             type: 'sfw',  fanName: 'Anon Gamer' },
    'amg':   { title: '/amg/ - Anime & Manga',          type: 'sfw',  fanName: 'Anon Otaku' },
    'ca':    { title: '/ca/ - Cosplay & Art',           type: 'sfw',  fanName: 'Anon Creator' },
    'tech':  { title: '/tech/ - Tech Stuff',            type: 'sfw',  fanName: 'Wizard Anon' },
    'mamak': { title: '/mamak/ - MY Stuff & Off-topic', type: 'sfw',  fanName: 'Mamak Regular' },
    'rqr':   { title: '/rqr/ - Board Request & Report', type: 'sfw',  fanName: 'Anon Reporter' },
    'myvth': { title: '/myvth/ - MY VTuber Ecchi & H',  type: 'nsfw', fanName: 'Cultured DD' },
    'vth':   { title: '/vth/ - Vtuber Ecchi & H',       type: 'nsfw', fanName: 'Cultured Anon' },
    'hm':    { title: '/hm/ - H Media',                 type: 'nsfw', fanName: 'Fellow Degen' },
    'hg':    { title: '/hg/ - H Games',                 type: 'nsfw', fanName: 'Gacha Cultist' }
};

const ALLOWED_STAMPS = ['kusa', 'tskr', 'uoooh', 'ikz', 'oshi', 'glowstick', '🌱', '🔥', '😭', '🏮'];

const SERVER_BOARD_FAN_NAMES = {
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

function getDefaultBoardName(board, rawName) {
    const clean = (rawName || '').trim();
    if (!clean || clean.toLowerCase() === 'anonymous') {
        const list = SERVER_BOARD_FAN_NAMES[board];
        if (list && list.length > 0) {
            return list[Math.floor(Math.random() * list.length)];
        }
        return BOARDS[board]?.fanName || 'Anonymous';
    }
    return clean;
}

function buildUserVanityFlair(userId, showVanity, guestFlair) {
    if (userId && showVanity) {
        try {
            const u = db.prepare('SELECT xp, level, streak, oshi_badge FROM users WHERE id = ?').get(userId);
            if (u) {
                const lvl = calculateLevel(u.xp || 0);
                const rank = getRank(lvl);
                return JSON.stringify({
                    rankBadge: rank.badge,
                    rankTitle: rank.title,
                    level: lvl,
                    streak: u.streak || 0,
                    oshiBadge: (u.oshi_badge && ALLOWED_OSHI_BADGES.includes(u.oshi_badge)) ? u.oshi_badge : null
                });
            }
        } catch (_) {}
    }
    if (guestFlair && typeof guestFlair === 'object') {
        if (guestFlair.oshiBadge && ALLOWED_OSHI_BADGES.includes(guestFlair.oshiBadge)) {
            return JSON.stringify({ oshiBadge: guestFlair.oshiBadge });
        }
    } else if (guestFlair && typeof guestFlair === 'string') {
        const sanitized = guestFlair.trim().slice(0, 80);
        if (ALLOWED_OSHI_BADGES.includes(sanitized)) {
            return JSON.stringify({ oshiBadge: sanitized });
        }
    }
    return null;
}

// Verify genuine binary file signature (magic bytes) to prevent disguised files
function detectMagicMime(buf) {
    if (!buf || buf.length < 12) return null;
    // JPEG: FF D8 FF
    if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'image/png';
    // GIF: 47 49 46 38 ('GIF8')
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'image/gif';
    // WebP: 'RIFF' .... 'WEBP'
    if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
        buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) {
        return 'image/webp';
    }
    // MP4: bytes 4..7 === 'ftyp' (66 74 79 70)
    if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) {
        return 'video/mp4';
    }
    // WebM / Matroska EBML header: 1A 45 DF A3
    if (buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3) {
        return 'video/webm';
    }
    return null;
}

// Build raw binary multipart/form-data payload (avoids FormData/Blob binary corruption across runtimes)
function buildCatboxMultipart(fileBytes, safeName, mimeType, userhash) {
    const boundary = '----OshiMYCatboxBoundary' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    const enc = new TextEncoder();
    const parts = [
        `--${boundary}\r\nContent-Disposition: form-data; name="reqtype"\r\n\r\nfileupload\r\n`
    ];
    if (userhash) {
        parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="userhash"\r\n\r\n${userhash}\r\n`);
    }
    parts.push(
        `--${boundary}\r\nContent-Disposition: form-data; name="fileToUpload"; filename="${safeName}"\r\nContent-Type: ${mimeType}\r\n\r\n`
    );
    const headerBytes = enc.encode(parts.join(''));
    const footerBytes = enc.encode(`\r\n--${boundary}--\r\n`);
    const u8 = fileBytes instanceof Uint8Array
        ? new Uint8Array(fileBytes.buffer, fileBytes.byteOffset, fileBytes.byteLength)
        : new Uint8Array(fileBytes);
    const body = new Uint8Array(headerBytes.length + u8.length + footerBytes.length);
    body.set(headerBytes, 0);
    body.set(u8, headerBytes.length);
    body.set(footerBytes, headerBytes.length + u8.length);
    return {
        body,
        contentType: `multipart/form-data; boundary=${boundary}`
    };
}

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
// Uses indexed reply_mentions table to eliminate full table scans (Audit Finding 1 & Recommendation A.2)
function getUserSyncData(userId) {
    if (!userId) return null;
    try {
        const notifRow = db.prepare(`
            SELECT COUNT(*) as unread_count
            FROM reply_mentions
            WHERE target_user_id = ? AND is_read = 0
        `).get(userId);

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

// Video Streaming Proxy route supporting HTTP Range (scrubbing, streaming)
app.get('/api/proxy/video', async (req, res) => {
    const rawUrl = req.query.url;
    if (!rawUrl) return res.status(400).send('Missing video url');

    try {
        const target = new URL(rawUrl);
        const allowedHosts = [
            'video.twimg.com', 'pbs.twimg.com', 'twimg.com',
            'v.redd.it', 'packaged-media.redd.it', 'preview.redd.it', 'i.redd.it', 'reddit.com', 'redditmedia.com',
            'vxreddit.com', 'rxddit.com', 'embedez.com', 'redditez.com', 'akamaized.net', 'cloudfront.net'
        ];
        const isAllowed = allowedHosts.some(h => target.hostname === h || target.hostname.endsWith('.' + h));
        if (!isAllowed) {
            return res.status(403).send('Host not allowed for video proxy');
        }

        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Referer': target.hostname.includes('twimg.com') ? 'https://x.com/' : (target.hostname.includes('vxreddit.com') ? 'https://vxreddit.com/' : 'https://www.reddit.com/')
        };

        if (req.headers.range) {
            headers['Range'] = req.headers.range;
        }

        const upstream = await fetch(rawUrl, { headers, redirect: 'follow' });
        const contentType = upstream.headers.get('content-type') || 'video/mp4';
        const contentRange = upstream.headers.get('content-range');
        const contentLength = upstream.headers.get('content-length');
        const acceptRanges = upstream.headers.get('accept-ranges') || 'bytes';

        res.status(upstream.status);
        res.setHeader('Content-Type', contentType);
        res.setHeader('Accept-Ranges', acceptRanges);
        res.setHeader('Access-Control-Allow-Origin', '*');
        if (contentRange) res.setHeader('Content-Range', contentRange);
        if (contentLength) res.setHeader('Content-Length', contentLength);

        if (upstream.body) {
            const stream = Readable.fromWeb(upstream.body);
            stream.pipe(res);
        } else {
            res.end();
        }
    } catch (err) {
        console.error('Video proxy streaming error:', err);
        res.status(502).send('Error proxying video');
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

// Helper to extract and cache first frame of a video URL via ffmpeg
function extractVideoFirstFrame(cleanVidUrl, thumbFile, timeoutMs = 5500) {
    return new Promise((resolve) => {
        if (fs.existsSync(thumbFile) && fs.statSync(thumbFile).size > 100) {
            return resolve(true);
        }
        let settled = false;
        const done = (ok) => {
            if (settled) return;
            settled = true;
            resolve(Boolean(ok && fs.existsSync(thumbFile) && fs.statSync(thumbFile).size > 100));
        };
        try {
            const child = spawn('/usr/bin/ffmpeg', [
                '-y',
                '-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                '-ss', '00:00:00.100',
                '-i', cleanVidUrl,
                '-vframes', '1',
                '-an',
                '-vf', "scale='min(1280,iw)':-2",
                '-q:v', '3',
                '-f', 'image2',
                thumbFile
            ], { timeout: timeoutMs });
            child.on('close', (code) => done(code === 0));
            child.on('error', () => done(false));
        } catch (_) {
            done(false);
        }
    });
}

// Dynamic Video Thumbnail Extraction & Caching Endpoint (First frame of video, black thumb only as fallback)
app.get('/api/video/thumbnail', async (req, res) => {
    const videoUrl = req.query.url;
    const fallbackPath = path.join(__dirname, 'asset', 'img', 'video_black_thumb.png');
    if (!videoUrl || typeof videoUrl !== 'string') {
        res.setHeader('Content-Type', 'image/png');
        return res.sendFile(fallbackPath);
    }

    try {
        const cleanVidUrl = decodeURIComponent(videoUrl).trim().replace(/^spoiler:/i, '').replace(/#spoiler$/i, '').trim();
        // SSRF protection: only permit http/https schemes, reject loopback / internal private targets
        if (!/^https?:\/\//i.test(cleanVidUrl) || cleanVidUrl.includes('localhost') || cleanVidUrl.includes('127.0.0.1')) {
            res.setHeader('Content-Type', 'image/png');
            return res.sendFile(fallbackPath);
        }

        const urlHash = crypto.createHash('sha256').update(cleanVidUrl).digest('hex').substring(0, 32);
        const thumbFile = path.join(VIDEO_THUMBS_DIR, `${urlHash}.jpg`);

        // 1. Serve from disk cache if available
        if (fs.existsSync(thumbFile) && fs.statSync(thumbFile).size > 100) {
            res.setHeader('Content-Type', 'image/jpeg');
            res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
            return fs.createReadStream(thumbFile).pipe(res);
        }

        // 2. Extract first frame using ffmpeg
        const ok = await extractVideoFirstFrame(cleanVidUrl, thumbFile, 6000);
        if (ok && fs.existsSync(thumbFile) && fs.statSync(thumbFile).size > 100) {
            res.setHeader('Content-Type', 'image/jpeg');
            res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
            return fs.createReadStream(thumbFile).pipe(res);
        }

        // 3. Fallback to black thumbnail only if extraction fails
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=300');
        return res.sendFile(fallbackPath);
    } catch (_) {
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=300');
        return res.sendFile(fallbackPath);
    }
});

// In-memory cache for Twitter tweet details
const tweetCache = new Map();

// Twitter / 𝕏 Tweet Details Resolver via vxTwitter & fxTwitter proxy helpers
app.get('/api/twitter/tweet', async (req, res) => {
    const id = req.query.id;
    const handle = req.query.handle || 'i';
    if (!id || !/^\d+$/.test(String(id).trim())) {
        return res.status(400).json({ error: 'Invalid tweet id' });
    }

    const cleanId = String(id).trim();
    if (tweetCache.has(cleanId)) {
        return res.json({ success: true, tweet: tweetCache.get(cleanId) });
    }

    try {
        let tweetData = null;

        // 1. Try vxtwitter API first
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 4000);
            const vxResp = await fetch(`https://api.vxtwitter.com/${handle}/status/${cleanId}`, {
                signal: controller.signal,
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
            });
            clearTimeout(timeout);
            if (vxResp.ok) {
                tweetData = await vxResp.json();
            }
        } catch (_) {}

        // 2. Fallback to fxtwitter API
        if (!tweetData) {
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 4000);
                const fxResp = await fetch(`https://api.fxtwitter.com/${handle}/status/${cleanId}`, {
                    signal: controller.signal,
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
                });
                clearTimeout(timeout);
                if (fxResp.ok) {
                    const fxJson = await fxResp.json();
                    if (fxJson && fxJson.tweet) {
                        const t = fxJson.tweet;
                        tweetData = {
                            tweetID: t.id,
                            tweetURL: t.url,
                            text: t.text,
                            user_name: t.author?.name || handle,
                            user_screen_name: t.author?.screen_name || handle,
                            user_profile_image_url: t.author?.avatar_url,
                            likes: t.likes || 0,
                            retweets: t.retweets || 0,
                            media_extended: (t.media?.all || []).map(m => ({
                                type: m.type === 'video' ? 'video' : 'image',
                                url: m.url,
                                thumbnail_url: m.thumbnail_url || m.url,
                                size: { width: m.width, height: m.height }
                            }))
                        };
                    }
                }
            } catch (_) {}
        }

        if (!tweetData) {
            return res.status(404).json({ error: 'Tweet not found or could not be retrieved' });
        }

        // Process media items (videos, multi-images)
        const mediaList = tweetData.media_extended || [];
        const videoItem = mediaList.find(m => m.type === 'video' || m.type === 'gif');
        const imageItems = mediaList.filter(m => m.type === 'image');

        const pages = imageItems.map((img, idx) => ({
            pageIndex: idx,
            displayUrl: img.url,
            helperUrl: img.url,
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
            videoUrl: videoItem ? videoItem.url : null,
            videoThumbnail: videoItem ? (videoItem.thumbnail_url || videoItem.url) : null,
            imageUrl: imageItems.length > 0 ? imageItems[0].url : null,
            pages,
            pageCount: pages.length
        };

        tweetCache.set(cleanId, tweet);
        if (tweetCache.size > 500) {
            const firstKey = tweetCache.keys().next().value;
            tweetCache.delete(firstKey);
        }

        res.json({ success: true, tweet });
    } catch (err) {
        console.error('Twitter lookup error:', err);
        res.status(500).json({ error: 'Failed to fetch tweet details' });
    }
});

// In-memory cache for Reddit post details
const redditPostCache = new Map();

function decodeHtmlEntities(str) {
    if (!str || typeof str !== 'string') return '';
    return str
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#x2F;/gi, '/')
        .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(dec));
}

function toVxRedditUrl(cleanUrl) {
    const vMatch = cleanUrl.match(/v\.redd\.it\/([a-zA-Z0-9_-]+)/i);
    if (vMatch) {
        return `https://vxreddit.com/comments/${vMatch[1]}`;
    }
    const rMatch = cleanUrl.match(/(?:https?:\/\/)?redd\.it\/([a-zA-Z0-9_-]+)/i);
    if (rMatch) {
        return `https://vxreddit.com/comments/${rMatch[1]}`;
    }
    if (/https?:\/\/(?:www\.)?vxreddit\.com/i.test(cleanUrl)) {
        return cleanUrl;
    }
    if (/https?:\/\/(?:www\.)?rxddit\.com/i.test(cleanUrl)) {
        return cleanUrl.replace(/rxddit\.com/i, 'vxreddit.com');
    }
    return cleanUrl.replace(/https?:\/\/(?:www\.|old\.|new\.|m\.|sh\.)?reddit\.com/i, 'https://vxreddit.com');
}

// Resolves vxreddit muxer URLs or v.redd.it video IDs to a direct playable .mp4 URL (renders.vxreddit.com or v.redd.it CMAF/DASH .mp4)
async function resolveDirectRedditVideoUrl(rawVideoUrl, fallbackVidId = null) {
    let extractedVidId = fallbackVidId;

    if (rawVideoUrl && typeof rawVideoUrl === 'string') {
        const vIdMatch = decodeURIComponent(rawVideoUrl).match(/v\.redd\.it\/([a-zA-Z0-9_-]+)/i);
        if (vIdMatch && vIdMatch[1]) {
            extractedVidId = vIdMatch[1];
        }

        // 1. Follow vxreddit.com/redditvideo.mp4 redirect to renders.vxreddit.com/{id}.mp4 (muxed audio+video MP4)
        if (rawVideoUrl.includes('vxreddit.com/redditvideo.mp4')) {
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 3800);
                const r = await fetch(rawVideoUrl, {
                    method: 'GET',
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
                        'Range': 'bytes=0-0'
                    },
                    redirect: 'follow',
                    signal: controller.signal
                });
                clearTimeout(timeout);
                if ((r.ok || r.status === 206) && r.url && !r.url.includes('redditvideo.mp4')) {
                    return r.url;
                }
            } catch (_) {}

            // Fallback: convert inner video_url .m3u8 parameter directly to .mp4 on v.redd.it CDN
            try {
                const u = new URL(rawVideoUrl);
                const innerVideo = u.searchParams.get('video_url');
                if (innerVideo) {
                    const mp4Candidate = innerVideo.replace(/\.m3u8$/i, '.mp4');
                    const controller = new AbortController();
                    const timeout = setTimeout(() => controller.abort(), 2000);
                    const r = await fetch(mp4Candidate, {
                        method: 'GET',
                        headers: { 'Range': 'bytes=0-0' },
                        signal: controller.signal
                    });
                    clearTimeout(timeout);
                    if (r.ok || r.status === 206) {
                        return mp4Candidate;
                    }
                }
            } catch (_) {}
        } else if (/^https?:\/\/renders\.vxreddit\.com\/.+\.mp4/i.test(rawVideoUrl)) {
            return rawVideoUrl;
        }
    }

    // 2. If we have a v.redd.it video ID, probe vxreddit muxer, renders.vxreddit.com, and v.redd.it CMAF/DASH .mp4 streams
    if (extractedVidId) {
        try {
            const muxUrl = `https://vxreddit.com/redditvideo.mp4?video_url=${encodeURIComponent(`https://v.redd.it/${extractedVidId}/CMAF_720.m3u8`)}&audio_url=${encodeURIComponent(`https://v.redd.it/${extractedVidId}/CMAF_AUDIO_128.m3u8`)}`;
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 3500);
            const r = await fetch(muxUrl, {
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
                    'Range': 'bytes=0-0'
                },
                redirect: 'follow',
                signal: controller.signal
            });
            clearTimeout(timeout);
            if ((r.ok || r.status === 206) && r.url && !r.url.includes('redditvideo.mp4')) {
                return r.url;
            }
        } catch (_) {}

        const candidates = [
            `https://renders.vxreddit.com/${extractedVidId}.mp4`,
            `https://v.redd.it/${extractedVidId}/CMAF_720.mp4`,
            `https://v.redd.it/${extractedVidId}/CMAF_480.mp4`,
            `https://v.redd.it/${extractedVidId}/CMAF_360.mp4`,
            `https://v.redd.it/${extractedVidId}/DASH_720.mp4`,
            `https://v.redd.it/${extractedVidId}/DASH_480.mp4`
        ];
        for (const cand of candidates) {
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 1500);
                const r = await fetch(cand, {
                    method: 'GET',
                    headers: { 'Range': 'bytes=0-0' },
                    signal: controller.signal
                });
                clearTimeout(timeout);
                if (r.ok || r.status === 206) {
                    return cand;
                }
            } catch (_) {}
        }
    }

    return rawVideoUrl;
}

// Reddit Post Details Resolver using vxreddit proxy helper with rich media extraction & oEmbed fallback
app.get('/api/reddit/post', async (req, res) => {
    const postUrl = req.query.url;
    if (!postUrl) {
        return res.status(400).json({ error: 'Missing Reddit post url' });
    }

    const cleanUrl = String(postUrl).trim();
    if (redditPostCache.has(cleanUrl)) {
        return res.json({ success: true, post: redditPostCache.get(cleanUrl) });
    }

    try {
        let subreddit = 'reddit';
        const subMatch = cleanUrl.match(/(?:reddit\.com|vxreddit\.com|rxddit\.com)\/r\/([a-zA-Z0-9_]+)/i);
        if (subMatch) subreddit = subMatch[1];
        
        // Extract post ID or video ID from various Reddit URL schemes (/comments/:id, /s/:shareId, redd.it/:id, v.redd.it/:id)
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

        // 1. Primary Query: vxreddit proxy helper with Discordbot User-Agent for rich OpenGraph & direct stream data
        const vxredditUrl = toVxRedditUrl(cleanUrl);

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

                // Extract Site Name / Author / Subreddit / Score / Comments
                const siteMatch = vxHtml.match(/<meta\s+(?:property|name)=["']og:site_name["']\s+content=["']([^"']+)["']/i) ||
                                  vxHtml.match(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["']og:site_name["']/i);
                if (siteMatch && siteMatch[1]) {
                    const rawSite = decodeHtmlEntities(siteMatch[1].trim());
                    const parsedSite = rawSite.match(/u\/([^\s]+)\s+on\s+r\/([^\s]+)(?:\s*-\s*⬆️\s*([\d,]+)\s*\|\s*💬\s*([\d,]+))?/i);
                    if (parsedSite) {
                        if (parsedSite[1] && parsedSite[1] !== '[deleted]') author = parsedSite[1];
                        if (parsedSite[2]) subreddit = parsedSite[2];
                        if (parsedSite[3]) score = parsedSite[3];
                        if (parsedSite[4]) comments = parsedSite[4];
                    }
                }

                // Extract Title
                const titleMatch = vxHtml.match(/<meta\s+(?:property|name)=["'](?:og:title|twitter:title)["']\s+content=["']([^"']+)["']/i) ||
                                   vxHtml.match(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["'](?:og:title|twitter:title)["']/i);
                if (titleMatch && titleMatch[1]) {
                    const rawTitle = decodeHtmlEntities(titleMatch[1].trim());
                    if (rawTitle && rawTitle !== 'vxReddit' && !rawTitle.startsWith('[')) {
                        title = rawTitle;
                    }
                }

                // Extract Description / Selftext
                const descMatch = vxHtml.match(/<meta\s+(?:property|name)=["'](?:og:description|twitter:description)["']\s+content=["']([^"']+)["']/i) ||
                                  vxHtml.match(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["'](?:og:description|twitter:description)["']/i);
                if (descMatch && descMatch[1]) {
                    const rawDesc = decodeHtmlEntities(descMatch[1].trim());
                    if (rawDesc && rawDesc !== '[deleted]' && rawDesc !== '[removed]' && rawDesc !== 'Invalid post path' && !rawDesc.toLowerCase().includes('failed to get data')) {
                        description = rawDesc;
                    }
                }

                // Extract Video Stream (vxreddit provides combined audio+video MP4)
                const vidMatch = vxHtml.match(/<meta\s+(?:property|name)=["'](?:og:video|og:video:url|og:video:secure_url|twitter:player:stream)["']\s+content=["'](https?:\/\/[^"']+)["']/i) ||
                                 vxHtml.match(/<meta\s+content=["'](https?:\/\/[^"']+)["']\s+(?:property|name)=["'](?:og:video|og:video:url|og:video:secure_url|twitter:player:stream)["']/i);
                if (vidMatch && vidMatch[1]) {
                    videoUrl = decodeHtmlEntities(vidMatch[1].trim());
                }

                // Extract Image / Thumbnail
                const imgMatches = [...vxHtml.matchAll(/<meta\s+(?:property|name)=["'](?:og:image|twitter:image)["']\s+content=["'](https?:\/\/[^"']+)["']/gi)];
                for (const m of imgMatches) {
                    if (m[1]) {
                        const decodedImg = decodeHtmlEntities(m[1].trim());
                        if (!rawImages.includes(decodedImg)) {
                            rawImages.push(decodedImg);
                        }
                    }
                }
            }
        } catch (_) {}

        // Fallback for direct v.redd.it videos using vxreddit's merged audio+video helper
        if (isDirectVideo && !videoUrl && postId) {
            videoUrl = await resolveDirectRedditVideoUrl(null, postId);
        } else if (videoUrl) {
            videoUrl = (await resolveDirectRedditVideoUrl(videoUrl, postId)) || videoUrl;
        }

        // 2. Secondary Query: redditez / embedez fallback if title or media was not found
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
                        if (ogTitle && ogTitle[1]) title = decodeHtmlEntities(ogTitle[1].trim());
                    }

                    if (!description) {
                        const ogDesc = ezHtml.match(/<meta\s+(?:property|name)=["'](?:og:description|twitter:description)["']\s+content=["']([^"']+)["']/i);
                        if (ogDesc && ogDesc[1]) description = decodeHtmlEntities(ogDesc[1].trim());
                    }

                    if (!videoUrl) {
                        const ogVid = ezHtml.match(/<meta\s+(?:property|name)=["'](?:og:video|og:video:url|og:video:secure_url|twitter:player:stream)["']\s+content=["'](https?:\/\/[^"']+)["']/i);
                        if (ogVid && ogVid[1]) videoUrl = decodeHtmlEntities(ogVid[1].trim());
                    }

                    // Multi-image extraction fallback from ezHtml redirect source links
                    const redirectMatches = ezHtml.match(/https?:\/\/[^\s"'<>\\]+path=content\.media\.\d+\.source/g) || [];
                    for (const rm of redirectMatches) {
                        if (!rawImages.includes(rm)) rawImages.push(rm);
                    }

                    if (rawImages.length === 0) {
                        const ogImg = ezHtml.match(/<meta\s+(?:property|name)=["'](?:og:image|twitter:image)["']\s+content=["'](https?:\/\/[^"']+)["']/i);
                        if (ogImg && ogImg[1]) rawImages.push(decodeHtmlEntities(ogImg[1].trim()));
                    }
                }
            } catch (_) {}
        }

        // 3. Official Reddit oEmbed query for fallback metadata & post title
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

        redditPostCache.set(cleanUrl, post);
        if (redditPostCache.size > 500) {
            const firstKey = redditPostCache.keys().next().value;
            redditPostCache.delete(firstKey);
        }

        res.json({ success: true, post });
    } catch (err) {
        console.error('Reddit lookup error:', err);
        res.status(500).json({ error: 'Failed to fetch Reddit post details' });
    }
});

// Stateless Media Upload Proxy (Catbox.moe Primary with userhash -> ImgBB Failover for images, Zero DB storage)
app.post('/api/upload', async (req, res) => {
    try {
        let buffer = null;
        let filename = '';

        if (Buffer.isBuffer(req.body) && req.body.length > 0) {
            buffer = req.body;
            try {
                filename = decodeURIComponent(req.headers['x-file-name'] || '');
            } catch (_) {
                filename = String(req.headers['x-file-name'] || '');
            }
        } else {
            const { image_base64, file_base64, filename: bodyFilename } = req.body || {};
            const rawBase64 = image_base64 || file_base64;
            if (!rawBase64 || typeof rawBase64 !== 'string') {
                return res.status(400).json({ error: 'Missing media payload' });
            }
            filename = bodyFilename || '';
            const commaIdx = rawBase64.indexOf(',');
            const base64Clean = (commaIdx !== -1 ? rawBase64.slice(commaIdx + 1) : rawBase64).replace(/\s+/g, '');
            buffer = Buffer.from(base64Clean, 'base64');
        }

        if (!buffer || buffer.length < 12) {
            return res.status(400).json({ error: 'Invalid or empty media file' });
        }

        // 1. Verify genuine binary magic bytes & allowed format whitelist
        const detectedMime = detectMagicMime(buffer);
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
            return res.status(415).json({
                error: 'Unsupported file format. Allowed: JPG, PNG, WebP (max 5MB), GIF (max 8MB), and MP4/WebM video (max 20MB).'
            });
        }

        // Prevent WebM vs MKV spoofing if user uploaded an .mkv file (both share EBML header 1A 45 DF A3)
        if (detectedMime === 'video/webm' && filename && /\.mkv$/i.test(filename)) {
            return res.status(415).json({
                error: 'MKV videos are not supported by browsers. Please upload MP4 or WebM.'
            });
        }

        // 2. Enforce tiered size limits
        if (buffer.length > rule.maxBytes) {
            const maxMB = Math.round(rule.maxBytes / (1024 * 1024));
            const actualMB = (buffer.length / (1024 * 1024)).toFixed(1);
            return res.status(413).json({
                error: `${rule.label} is ${actualMB}MB, which exceeds the ${maxMB}MB limit.`
            });
        }

        const isVideo = detectedMime.startsWith('video/');
        const baseName = (filename || `oshimy_${Date.now()}`).replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_') || `oshimy_${Date.now()}`;
        const safeName = `${baseName}.${rule.ext}`;
        const catboxUserhash = process.env.CATBOX_USERHASH || '1e5680e58e931a1d509c280dc';

        // 3. Primary: Catbox.moe permanent upload with raw binary multipart body
        try {
            const { body: multipartBody, contentType } = buildCatboxMultipart(buffer, safeName, detectedMime, catboxUserhash);

            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 25000);
            const catboxResp = await fetch('https://catbox.moe/user/api.php', {
                method: 'POST',
                body: multipartBody,
                signal: controller.signal,
                headers: {
                    'Content-Type': contentType,
                    'User-Agent': 'OshiMY-Board/1.0 (+https://oshimy.moe)'
                }
            });
            clearTimeout(timeout);

            if (catboxResp.ok) {
                const text = (await catboxResp.text()).trim();
                if (text.startsWith('https://files.catbox.moe/')) {
                    return res.json({
                        success: true,
                        url: text,
                        provider: 'catbox.moe',
                        media_kind: isVideo ? 'video' : 'image'
                    });
                }
            }
        } catch (catErr) {
            console.warn('[Upload] Catbox primary warning:', catErr.message);
        }

        // 4. If Video: do not fallback to ImgBB (ImgBB only supports images)
        if (isVideo) {
            return res.status(502).json({
                error: 'Catbox.moe video upload timed out or is temporarily unreachable. Please try again shortly.'
            });
        }

        // 5. Secondary Permanent Failover for Images only: ImgBB
        const imgbbKey = process.env.IMGBB_API_KEY || '6d885f930c72cd28e6520e6c7494704f';
        const imgbbForm = new URLSearchParams();
        imgbbForm.append('image', buffer.toString('base64'));
        const imgbbResp = await fetch(`https://api.imgbb.com/1/upload?key=${imgbbKey}`, {
            method: 'POST',
            body: imgbbForm
        });
        const imgbbData = await imgbbResp.json();
        if (imgbbData.success && imgbbData.data && imgbbData.data.url) {
            return res.json({
                success: true,
                url: imgbbData.data.url,
                provider: 'imgbb',
                media_kind: 'image'
            });
        }

        return res.status(502).json({ error: 'All permanent image hosts failed to accept the upload' });
    } catch (err) {
        console.error('[Upload] Error:', err);
        return res.status(500).json({ error: 'Upload processing failed' });
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
        res.set('Cache-Control', 'public, max-age=5, stale-while-revalidate=15');

        if (req.headers['if-none-match'] === etag) {
            return res.status(304).end();
        }

        let query = `
            SELECT t.*, (SELECT COUNT(*) FROM replies r WHERE r.thread_id = t.id) as reply_count
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

        // Initialize preview_replies array and thread-scoped poster_id on all threads
        const threadIpMap = new Map();
        for (const th of threads) {
            th.preview_replies = [];
            th.poster_id = generatePosterId(th.ip_hash, th.id);
            th.is_op = true;
            threadIpMap.set(th.id, th.ip_hash);
        }

        // Preview replies: query the latest preview replies for threads that have replies
        const threadsWithReplies = threads.filter(t => (t.reply_count || 0) > 0);
        if (threadsWithReplies.length > 0) {
            const threadIds = threadsWithReplies.map(t => t.id);
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
                r.poster_id = generatePosterId(r.ip_hash, r.thread_id);
                const opIp = threadIpMap.get(r.thread_id);
                r.is_op = Boolean(r.ip_hash && opIp && r.ip_hash === opIp);
                if (!replyMap.has(r.thread_id)) {
                    replyMap.set(r.thread_id, []);
                }
                replyMap.get(r.thread_id).push(r);
            }

            for (const th of threads) {
                if (replyMap.has(th.id)) {
                    th.preview_replies = replyMap.get(th.id);
                }
            }
        }

        res.json({ success: true, threads });
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
        const since = req.query.since ? parseInt(req.query.since, 10) : 0;

        // Delta Polling Optimization (Audit Recommendation C.2)
        if (since > 0) {
            const replies = db.prepare(`
                SELECT * FROM replies 
                WHERE thread_id = ? AND created_at > ?
                ORDER BY created_at ASC
            `).all(threadId, since);

            if (replies.length === 0) {
                // 0 new replies: return empty delta immediately without reading thread or counting total replies
                return res.json({
                    success: true,
                    thread: null,
                    replies: [],
                    is_delta: true,
                    total_replies: -1
                });
            }

            const opRow = db.prepare('SELECT ip_hash FROM threads WHERE id = ?').get(threadId);
            for (const r of replies) {
                r.poster_id = generatePosterId(r.ip_hash, threadId);
                r.is_op = Boolean(r.ip_hash && opRow?.ip_hash && r.ip_hash === opRow.ip_hash);
            }

            return res.json({
                success: true,
                thread: null,
                replies,
                is_delta: true,
                total_replies: -1
            });
        }

        const thread = db.prepare('SELECT * FROM threads WHERE id = ?').get(threadId);
        if (!thread) {
            return res.status(404).json({ error: 'Thread not found' });
        }

        thread.poster_id = generatePosterId(thread.ip_hash, thread.id);
        thread.is_op = true;

        // HTTP Caching & 304 Not Modified based on thread bumped_at, lock/pin status, and reactions
        const etag = `W/"tr-${thread.id}-${thread.bumped_at}-${thread.is_pinned}-${thread.is_locked}-${(thread.reactions || '').length}"`;
        res.set('ETag', etag);
        res.set('Cache-Control', 'public, max-age=5, stale-while-revalidate=15');

        if (req.headers['if-none-match'] === etag) {
            return res.status(304).end();
        }

        const replies = db.prepare(`
            SELECT * FROM replies 
            WHERE thread_id = ? 
            ORDER BY created_at ASC
        `).all(threadId);

        for (const r of replies) {
            r.poster_id = generatePosterId(r.ip_hash, thread.id);
            r.is_op = Boolean(r.ip_hash && thread.ip_hash && r.ip_hash === thread.ip_hash);
        }

        const totalReplies = thread.reply_count || replies.length;

        res.json({ 
            success: true, 
            thread, 
            replies,
            is_delta: false,
            total_replies: totalReplies
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 4. Create New Thread
app.post('/api/threads', (req, res) => {
    const { board, name, subject, comment, media_url, show_vanity, show_vanity_flair, hide_identity, post_as_anonymous, guest_flair } = req.body;
    const hideId = hide_identity !== undefined ? Boolean(hide_identity) : Boolean(post_as_anonymous);
    const showVanity = show_vanity_flair !== undefined ? Boolean(show_vanity_flair) : (show_vanity !== false);

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

        const posterName = getDefaultBoardName(board, name);
        const posterSubject = (subject && subject.trim()) ? subject.trim() : '';
        const posterMedia = (media_url && media_url.trim()) ? media_url.trim() : '';

        const userId = req.user ? req.user.user_id : null;
        // Decoupled Vanity: If hideId is enabled, omit public role/display_title while keeping vanity_flair
        const role = (req.user && !hideId) ? req.user.role : null;
        const displayTitle = (req.user && !hideId) ? req.user.display_title : null;
        const vanityFlair = buildUserVanityFlair(userId, showVanity, guest_flair);

        try {
            db.prepare(`
                INSERT INTO threads (id, board, name, subject, comment, media_url, ip_hash, user_id, role, display_title, vanity_flair, reactions, created_at, bumped_at, is_pinned, is_locked)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, 0, 0)
            `).run(id, board, posterName, posterSubject, comment.trim(), posterMedia, ipHash, userId, role, displayTitle, vanityFlair, now, now);
        } catch (_) {
            db.prepare(`
                INSERT INTO threads (id, board, name, subject, comment, media_url, ip_hash, user_id, role, display_title, created_at, bumped_at, is_pinned, is_locked)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
            `).run(id, board, posterName, posterSubject, comment.trim(), posterMedia, ipHash, userId, role, displayTitle, now, now);
        }

        const created = {
            id,
            board,
            name: posterName,
            subject: posterSubject,
            comment: comment.trim(),
            media_url: posterMedia,
            ip_hash: ipHash,
            poster_id: generatePosterId(ipHash, id),
            is_op: true,
            user_id: userId,
            role,
            display_title: displayTitle,
            vanity_flair: vanityFlair,
            reactions: '{}',
            created_at: now,
            bumped_at: now,
            is_pinned: 0,
            is_locked: 0,
            reply_count: 0
        };

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
    const { thread_id, board, name, comment, media_url, show_vanity, show_vanity_flair, hide_identity, post_as_anonymous, guest_flair } = req.body;
    const hideId = hide_identity !== undefined ? Boolean(hide_identity) : Boolean(post_as_anonymous);
    const showVanity = show_vanity_flair !== undefined ? Boolean(show_vanity_flair) : (show_vanity !== false);

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

        const posterName = getDefaultBoardName(thread.board, name);
        const posterMedia = (media_url && media_url.trim()) ? media_url.trim() : '';

        const userId = req.user ? req.user.user_id : null;
        const role = (req.user && !hideId) ? req.user.role : null;
        const displayTitle = (req.user && !hideId) ? req.user.display_title : null;
        const vanityFlair = buildUserVanityFlair(userId, showVanity, guest_flair);

        try {
            db.prepare(`
                INSERT INTO replies (id, thread_id, board, name, comment, media_url, ip_hash, user_id, role, display_title, vanity_flair, reactions, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?)
            `).run(id, thread_id, thread.board, posterName, comment.trim(), posterMedia, ipHash, userId, role, displayTitle, vanityFlair, now);
        } catch (_) {
            db.prepare(`
                INSERT INTO replies (id, thread_id, board, name, comment, media_url, ip_hash, user_id, role, display_title, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(id, thread_id, thread.board, posterName, comment.trim(), posterMedia, ipHash, userId, role, displayTitle, now);
        }

        // Bump thread activity and denormalized reply_count (Audit Finding 3 & 5)
        try {
            db.prepare('UPDATE threads SET reply_count = reply_count + 1, bumped_at = ? WHERE id = ?').run(now, thread_id);
        } catch (_) {
            db.prepare('UPDATE threads SET bumped_at = ? WHERE id = ?').run(now, thread_id);
        }

        // Mention and OP notification detection (Audit Finding 1 & Recommendation A.2)
        try {
            const targetUserIds = new Set();
            if (thread.user_id && thread.user_id !== userId) {
                targetUserIds.add(thread.user_id);
            }
            const quoteMatches = comment.matchAll(/>>(?:#)?([a-zA-Z0-9_\-]+)/g);
            for (const match of quoteMatches) {
                const rawQuote = match[1];
                if (thread.id === rawQuote || thread.id.includes(rawQuote)) {
                    if (thread.user_id && thread.user_id !== userId) {
                        targetUserIds.add(thread.user_id);
                    }
                }
                const quotedReply = db.prepare(`
                    SELECT user_id FROM replies 
                    WHERE thread_id = ? AND (id = ? OR id LIKE ?)
                    LIMIT 1
                `).get(thread_id, rawQuote, '%' + rawQuote + '%');
                if (quotedReply && quotedReply.user_id && quotedReply.user_id !== userId) {
                    targetUserIds.add(quotedReply.user_id);
                }
            }

            if (targetUserIds.size > 0) {
                const insertMention = db.prepare(`
                    INSERT OR IGNORE INTO reply_mentions (id, source_reply_id, target_user_id, thread_id, created_at, is_read)
                    VALUES (?, ?, ?, ?, ?, 0)
                `);
                for (const targetUid of targetUserIds) {
                    const mentionId = 'm_' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
                    insertMention.run(mentionId, id, targetUid, thread_id, now);
                }
            }
        } catch (mErr) {
            console.warn('[Mentions] Error registering reply mention:', mErr);
        }

        // Construct reply in memory - eliminates redundant read query (Audit Recommendation A.5)
        const created = {
            id,
            thread_id,
            board: thread.board,
            name: posterName,
            comment: comment.trim(),
            media_url: posterMedia,
            ip_hash: ipHash,
            poster_id: generatePosterId(ipHash, thread_id),
            is_op: Boolean(ipHash && thread.ip_hash && ipHash === thread.ip_hash),
            user_id: userId,
            role,
            display_title: displayTitle,
            vanity_flair: vanityFlair,
            reactions: '{}',
            created_at: now
        };

        if (userId) {
            awardUserXP(db, userId, XP_RULES.REPLY_CREATION);
        }

        res.json({ success: true, reply: created });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 5b. Lightweight "Kusa / Wotagei" Stamp Reactions
app.post('/api/reactions/toggle', (req, res) => {
    const { post_type, target_type, post_id, target_id, stamp } = req.body || {};
    const targetId = post_id || target_id;
    const targetType = post_type || target_type;
    if (!targetId || !ALLOWED_STAMPS.includes(stamp)) {
        return res.status(400).json({ error: 'Invalid reaction parameters' });
    }

    const table = targetType === 'thread' ? 'threads' : 'replies';
    try {
        const post = db.prepare(`SELECT id, user_id, ip_hash, reactions FROM ${table} WHERE id = ?`).get(targetId);
        if (!post) {
            return res.status(404).json({ error: 'Post not found' });
        }

        const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
        const ipHash = hashIp(clientIp);

        let reactionsObj = {};
        try {
            reactionsObj = JSON.parse(post.reactions || '{}') || {};
        } catch (_) {
            reactionsObj = {};
        }

        const existing = db.prepare('SELECT 1 FROM post_reactions WHERE post_id = ? AND stamp = ? AND ip_hash = ?').get(targetId, stamp, ipHash);
        let active = false;

        if (existing) {
            db.prepare('DELETE FROM post_reactions WHERE post_id = ? AND stamp = ? AND ip_hash = ?').run(targetId, stamp, ipHash);
            const nextCount = Math.max(0, (parseInt(reactionsObj[stamp], 10) || 1) - 1);
            if (nextCount > 0) reactionsObj[stamp] = nextCount;
            else delete reactionsObj[stamp];
            active = false;
        } else {
            try {
                db.prepare('INSERT OR IGNORE INTO post_reactions (post_id, post_type, stamp, ip_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(targetId, targetType === 'thread' ? 'thread' : 'reply', stamp, ipHash, Date.now());
            } catch (_) {
                db.prepare('INSERT OR IGNORE INTO post_reactions (post_id, stamp, ip_hash, created_at) VALUES (?, ?, ?, ?)').run(targetId, stamp, ipHash, Date.now());
            }
            reactionsObj[stamp] = (parseInt(reactionsObj[stamp], 10) || 0) + 1;
            active = true;

            // Award +5 XP to post author if reacted by someone else
            if (post.user_id && post.ip_hash !== ipHash) {
                awardUserXP(db, post.user_id, 5);
            }
        }

        const serialized = JSON.stringify(reactionsObj);
        db.prepare(`UPDATE ${table} SET reactions = ? WHERE id = ?`).run(serialized, targetId);

        res.json({ success: true, post_id: targetId, stamp, reactions: reactionsObj, active });
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
            SELECT m.id as mention_id, m.is_read, r.id, r.thread_id, r.board, r.name, r.comment, r.created_at, t.subject
            FROM reply_mentions m
            JOIN replies r ON r.id = m.source_reply_id
            JOIN threads t ON t.id = m.thread_id
            WHERE m.target_user_id = ?
            ORDER BY m.created_at DESC LIMIT 30
        `).all(uid);

        // Mark unread mentions as read
        db.prepare('UPDATE reply_mentions SET is_read = 1 WHERE target_user_id = ? AND is_read = 0').run(uid);

        res.json({ success: true, notifications });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 9c2. Dedicated User Sync Endpoint (Decoupled from content polling, Audit Recommendation A.3)
app.get('/api/user/sync', (req, res) => {
    if (!req.user) return res.json({ success: true, user_sync: null });
    const sync = getUserSyncData(req.user.user_id);
    res.json({ success: true, user_sync: sync });
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
            const rep = db.prepare('SELECT thread_id FROM replies WHERE id = ?').get(id);
            db.prepare('DELETE FROM replies WHERE id = ?').run(id);
            if (rep) {
                db.prepare('UPDATE threads SET reply_count = MAX(0, reply_count - 1) WHERE id = ?').run(rep.thread_id);
            }
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

// Helper: Resolve any image, video, Pixiv, Twitter/X, Reddit, YouTube URL for rich Discord & messenger embeds
async function resolveSocialMedia(rawUrl, origin, tweetCacheContext = null, redditCacheContext = null) {
    if (!rawUrl || typeof rawUrl !== 'string') {
        return { type: 'none', imageUrl: null, videoUrl: null, videoType: null, source: null };
    }
    const cleanUrl = rawUrl.trim().replace(/^spoiler:/i, '').replace(/#spoiler$/i, '').trim();
    if (!cleanUrl) {
        return { type: 'none', imageUrl: null, videoUrl: null, videoType: null, source: null };
    }
    const blackThumbUrl = `${origin}/asset/img/video_black_thumb.png`;

    // 1. Pixiv Artworks (illust_id or artworks/ID)
    const pixivMatch = cleanUrl.match(/(?:pixiv\.net\/(?:en\/)?artworks\/|illust_id=)(\d+)/i) || cleanUrl.match(/pixiv\.re\/(\d+)/i);
    if (pixivMatch) {
        const id = pixivMatch[1];
        return {
            type: 'image',
            imageUrl: `https://pixiv.re/${id}.jpg`,
            videoUrl: null,
            videoType: null,
            source: 'Pixiv'
        };
    }

    // 2. YouTube (watch?v=, youtu.be, shorts, embed, live)
    const ytMatch = cleanUrl.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([a-zA-Z0-9_-]{11})/i);
    if (ytMatch) {
        const ytId = ytMatch[1];
        return {
            type: 'video',
            imageUrl: `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`,
            videoUrl: `https://www.youtube.com/embed/${ytId}`,
            videoType: 'text/html',
            source: 'YouTube'
        };
    }

    // 3. Twitter / X (handles x.com, twitter.com, vxtwitter, fxtwitter, fixupx, /status/ and /i/status/)
    const xMatch = cleanUrl.match(/(?:twitter\.com|x\.com|vxtwitter\.com|fxtwitter\.com|fixupx\.com)\/(?:#!\/)?(?:([a-zA-Z0-9_]+)\/status\/|status\/|i\/status\/)(\d+)/i);
    if (xMatch) {
        const handle = xMatch[1] || 'i';
        const statusId = xMatch[2];

        // 3a. Check in-memory tweet cache first
        if (tweetCacheContext && typeof tweetCacheContext.get === 'function' && tweetCacheContext.has(statusId)) {
            const cached = tweetCacheContext.get(statusId);
            if (cached.mediaType === 'video' && cached.videoUrl) {
                return {
                    type: 'video',
                    imageUrl: cached.videoThumbnail || blackThumbUrl,
                    videoUrl: cached.videoUrl,
                    videoType: 'video/mp4',
                    source: 'Twitter / X Video'
                };
            }
            if (cached.imageUrl) {
                return {
                    type: 'image',
                    imageUrl: cached.imageUrl,
                    videoUrl: null,
                    videoType: null,
                    source: 'Twitter / X'
                };
            }
        }

        // 3b. Query api.vxtwitter.com JSON API
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 3500);
            const vxResp = await fetch(`https://api.vxtwitter.com/${handle}/status/${statusId}`, {
                signal: controller.signal,
                headers: { 'User-Agent': 'curl/7.88.1' }
            });
            clearTimeout(timeout);
            if (vxResp.ok) {
                const vxJson = await vxResp.json();
                const mediaList = vxJson.media_extended || [];
                const videoItem = mediaList.find(m => m.type === 'video' || m.type === 'gif');
                const imageItem = mediaList.find(m => m.type === 'image');

                if (videoItem) {
                    const videoRes = {
                        type: 'video',
                        imageUrl: videoItem.thumbnail_url || blackThumbUrl,
                        videoUrl: videoItem.url,
                        videoType: 'video/mp4',
                        source: 'Twitter / X Video'
                    };
                    if (tweetCacheContext && typeof tweetCacheContext.set === 'function') {
                        tweetCacheContext.set(statusId, {
                            id: statusId,
                            mediaType: 'video',
                            videoUrl: videoItem.url,
                            videoThumbnail: videoItem.thumbnail_url || blackThumbUrl,
                            imageUrl: null
                        });
                    }
                    return videoRes;
                }

                if (imageItem) {
                    const imageRes = {
                        type: 'image',
                        imageUrl: imageItem.url,
                        videoUrl: null,
                        videoType: null,
                        source: 'Twitter / X'
                    };
                    if (tweetCacheContext && typeof tweetCacheContext.set === 'function') {
                        tweetCacheContext.set(statusId, {
                            id: statusId,
                            mediaType: 'image',
                            videoUrl: null,
                            videoThumbnail: null,
                            imageUrl: imageItem.url
                        });
                    }
                    return imageRes;
                }
            }
        } catch (_) {}

        // 3c. Query api.fxtwitter.com JSON API
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 3500);
            const fxResp = await fetch(`https://api.fxtwitter.com/${handle}/status/${statusId}`, {
                signal: controller.signal,
                headers: { 'User-Agent': 'curl/7.88.1' }
            });
            clearTimeout(timeout);
            if (fxResp.ok) {
                const fxJson = await fxResp.json();
                const t = fxJson && fxJson.tweet;
                if (t && t.media) {
                    const videoItem = (t.media.videos && t.media.videos[0]) || (t.media.all && t.media.all.find(m => m.type === 'video' || m.type === 'gif'));
                    if (videoItem) {
                        const videoRes = {
                            type: 'video',
                            imageUrl: videoItem.thumbnail_url || blackThumbUrl,
                            videoUrl: videoItem.url,
                            videoType: 'video/mp4',
                            source: 'Twitter / X Video'
                        };
                        if (tweetCacheContext && typeof tweetCacheContext.set === 'function') {
                            tweetCacheContext.set(statusId, {
                                id: statusId,
                                mediaType: 'video',
                                videoUrl: videoItem.url,
                                videoThumbnail: videoItem.thumbnail_url || blackThumbUrl,
                                imageUrl: null
                            });
                        }
                        return videoRes;
                    }
                    const photoItem = (t.media.photos && t.media.photos[0]) || (t.media.all && t.media.all.find(m => m.type === 'photo' || m.type === 'image'));
                    if (photoItem) {
                        const imageRes = {
                            type: 'image',
                            imageUrl: photoItem.url,
                            videoUrl: null,
                            videoType: null,
                            source: 'Twitter / X'
                        };
                        if (tweetCacheContext && typeof tweetCacheContext.set === 'function') {
                            tweetCacheContext.set(statusId, {
                                id: statusId,
                                mediaType: 'image',
                                videoUrl: null,
                                videoThumbnail: null,
                                imageUrl: photoItem.url
                            });
                        }
                        return imageRes;
                    }
                }
            }
        } catch (_) {}

        // 3d. Fallback: probe vxTwitter HTML tags for direct stream/image tags
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 3000);
            const vxHtmlResp = await fetch(`https://vxtwitter.com/${handle}/status/${statusId}`, {
                signal: controller.signal,
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)' }
            });
            clearTimeout(timeout);
            if (vxHtmlResp.ok) {
                const vxHtml = await vxHtmlResp.text();
                const vidMatch = vxHtml.match(/<meta\s+(?:property|name)=["'](?:og:video(?::secure_url)?|twitter:player:stream)["']\s+content=["']([^"']+)["']/i) ||
                                 vxHtml.match(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["'](?:og:video(?::secure_url)?|twitter:player:stream)["']/i);
                const imgMatch = vxHtml.match(/<meta\s+(?:property|name)=["'](?:og:image|twitter:image)["']\s+content=["']([^"']+)["']/i) ||
                                 vxHtml.match(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["'](?:og:image|twitter:image)["']/i);
                if (vidMatch && vidMatch[1]) {
                    return {
                        type: 'video',
                        imageUrl: (imgMatch && imgMatch[1] ? decodeHtmlEntities(imgMatch[1].trim()) : null) || blackThumbUrl,
                        videoUrl: decodeHtmlEntities(vidMatch[1].trim()),
                        videoType: 'video/mp4',
                        source: 'Twitter / X Video'
                    };
                }
                if (imgMatch && imgMatch[1]) {
                    return {
                        type: 'image',
                        imageUrl: decodeHtmlEntities(imgMatch[1].trim()),
                        videoUrl: null,
                        videoType: null,
                        source: 'Twitter / X'
                    };
                }
            }
        } catch (_) {}

        // 3e. Clean fallback thumbnail (never a fake .jpg that returns an HTML page)
        return {
            type: 'image',
            imageUrl: blackThumbUrl,
            videoUrl: null,
            videoType: null,
            source: 'Twitter / X'
        };
    }

    // 4. Reddit (handles reddit.com/r/..., reddit.com/comments/..., /s/ share links, redd.it, v.redd.it, vxreddit, rxddit)
    // Exclude direct image hosts i.redd.it / preview.redd.it so they resolve as direct images in step 7
    const isDirectRedditImage = /^https?:\/\/(?:i|preview|external-preview)\.redd\.it\//i.test(cleanUrl);
    if (!isDirectRedditImage) {
        // 4a. Direct Reddit video (v.redd.it or reddit.com/video/)
        const redditVidMatch = cleanUrl.match(/(?:v\.redd\.it\/|reddit\.com\/video\/)([a-zA-Z0-9_-]+)/i);
        if (redditVidMatch) {
            const vidId = redditVidMatch[1];
            const directVidUrl = await resolveDirectRedditVideoUrl(null, vidId);
            return {
                type: 'video',
                imageUrl: blackThumbUrl,
                videoUrl: directVidUrl || `https://v.redd.it/${vidId}/CMAF_720.mp4`,
                videoType: 'video/mp4',
                width: 1280,
                height: 720,
                source: 'Reddit Video'
            };
        }

        // 4b. Reddit Post URLs (/r/sub/comments/..., /r/sub/s/..., /comments/..., redd.it/...)
        const isRedditPost = /(?:reddit\.com|vxreddit\.com|rxddit\.com)\/(?:r\/[a-zA-Z0-9_]+|comments\/|u\/|user\/)|https?:\/\/redd\.it\/[a-zA-Z0-9_-]+/i.test(cleanUrl);
        if (isRedditPost) {
            const subMatch = cleanUrl.match(/(?:reddit\.com|vxreddit\.com|rxddit\.com)\/r\/([a-zA-Z0-9_]+)/i);
            const sub = subMatch ? subMatch[1] : 'reddit';
            let cached = null;
            if (redditCacheContext && typeof redditCacheContext.get === 'function') {
                cached = redditCacheContext.get(cleanUrl);
            }
            if (cached) {
                if (cached.mediaType === 'video' && cached.videoUrl) {
                    const directVidUrl = await resolveDirectRedditVideoUrl(cached.videoUrl, cached.postId);
                    return {
                        type: 'video',
                        imageUrl: cached.videoThumbnail || cached.thumbnailUrl || cached.imageUrl || blackThumbUrl,
                        videoUrl: directVidUrl || cached.videoUrl,
                        videoType: 'video/mp4',
                        width: cached.width || 1280,
                        height: cached.height || 720,
                        source: `Reddit r/${cached.subreddit || sub}`
                    };
                }
                if (cached.imageUrl) {
                    return {
                        type: 'image',
                        imageUrl: cached.imageUrl,
                        videoUrl: null,
                        videoType: null,
                        source: `Reddit r/${cached.subreddit || sub}`
                    };
                }
            }

            // Actively probe vxreddit.com with Discordbot User-Agent (mirrors Twitter vxtwitter resolution)
            const vxredditUrl = toVxRedditUrl(cleanUrl);
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 4000);
                const vxResp = await fetch(vxredditUrl, {
                    signal: controller.signal,
                    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)' },
                    redirect: 'follow'
                });
                clearTimeout(timeout);

                if (vxResp.ok) {
                    const vxHtml = await vxResp.text();
                    const vidMatch = vxHtml.match(/<meta\s+(?:property|name)=["'](?:og:video(?::secure_url|:url)?|twitter:player:stream)["']\s+content=["'](https?:\/\/[^"']+)["']/i) ||
                                     vxHtml.match(/<meta\s+content=["'](https?:\/\/[^"']+)["']\s+(?:property|name)=["'](?:og:video(?::secure_url|:url)?|twitter:player:stream)["']/i);
                    const imgMatch = vxHtml.match(/<meta\s+(?:property|name)=["'](?:og:image|twitter:image)["']\s+content=["'](https?:\/\/[^"']+)["']/i) ||
                                     vxHtml.match(/<meta\s+content=["'](https?:\/\/[^"']+)["']\s+(?:property|name)=["'](?:og:image|twitter:image)["']/i);
                    const widthMatch = vxHtml.match(/<meta\s+(?:property|name)=["'](?:og:video:width|twitter:player:width)["']\s+content=["'](\d+)["']/i) ||
                                       vxHtml.match(/<meta\s+content=["'](\d+)["']\s+(?:property|name)=["'](?:og:video:width|twitter:player:width)["']/i);
                    const heightMatch = vxHtml.match(/<meta\s+(?:property|name)=["'](?:og:video:height|twitter:player:height)["']\s+content=["'](\d+)["']/i) ||
                                        vxHtml.match(/<meta\s+content=["'](\d+)["']\s+(?:property|name)=["'](?:og:video:height|twitter:player:height)["']/i);

                    const decodedImg = imgMatch && imgMatch[1] ? decodeHtmlEntities(imgMatch[1].trim()) : null;
                    const vidWidth = widthMatch && widthMatch[1] ? parseInt(widthMatch[1], 10) : 1280;
                    const vidHeight = heightMatch && heightMatch[1] ? parseInt(heightMatch[1], 10) : 720;

                    if (vidMatch && vidMatch[1]) {
                        const rawVidUrl = decodeHtmlEntities(vidMatch[1].trim());
                        const directVidUrl = await resolveDirectRedditVideoUrl(rawVidUrl);
                        return {
                            type: 'video',
                            imageUrl: decodedImg || blackThumbUrl,
                            videoUrl: directVidUrl || rawVidUrl,
                            videoType: 'video/mp4',
                            width: vidWidth,
                            height: vidHeight,
                            source: `Reddit r/${sub}`
                        };
                    }

                    if (decodedImg) {
                        return {
                            type: 'image',
                            imageUrl: decodedImg,
                            videoUrl: null,
                            videoType: null,
                            source: `Reddit r/${sub}`
                        };
                    }
                }
            } catch (_) {}

            // Secondary fallback: probe rxddit.com HTML meta tags
            try {
                const rxdditUrl = vxredditUrl.replace(/vxreddit\.com/i, 'rxddit.com');
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 3500);
                const rxResp = await fetch(rxdditUrl, {
                    signal: controller.signal,
                    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)' },
                    redirect: 'follow'
                });
                clearTimeout(timeout);

                if (rxResp.ok) {
                    const rxHtml = await rxResp.text();
                    const imgMatch = rxHtml.match(/<meta\s+(?:property|name)=["'](?:og:image|twitter:image)["']\s+content=["'](https?:\/\/[^"']+)["']/i) ||
                                     rxHtml.match(/<meta\s+content=["'](https?:\/\/[^"']+)["']\s+(?:property|name)=["'](?:og:image|twitter:image)["']/i);
                    const decodedImg = imgMatch && imgMatch[1] ? decodeHtmlEntities(imgMatch[1].trim()) : null;
                    if (decodedImg) {
                        return {
                            type: 'image',
                            imageUrl: decodedImg,
                            videoUrl: null,
                            videoType: null,
                            source: `Reddit r/${sub}`
                        };
                    }
                }
            } catch (_) {}

            return {
                type: 'image',
                imageUrl: blackThumbUrl,
                videoUrl: null,
                videoType: null,
                source: `Reddit r/${sub}`
            };
        }
    }

    // 5. Direct Video Files (.mp4, .webm, .mov or proxy stream, including Catbox.moe videos with optional ?thumb= concrete thumbnail URL)
    if (/\.(mp4|webm|mov)(?:\?.*)?$/i.test(cleanUrl) || cleanUrl.includes('/api/proxy/stream')) {
        let baseVideoUrl = cleanUrl;
        let concreteThumbUrl = null;
        const thumbMatch = cleanUrl.match(/^([^?#]+\.(?:mp4|webm|mov))\?thumb=(.+)$/i);
        if (thumbMatch) {
            baseVideoUrl = thumbMatch[1];
            try {
                const decoded = decodeURIComponent(thumbMatch[2].trim());
                if (/^https?:\/\//i.test(decoded)) concreteThumbUrl = decoded;
            } catch (_) {
                if (/^https?:\/\//i.test(thumbMatch[2].trim())) concreteThumbUrl = thumbMatch[2].trim();
            }
        }
        let absVideoUrl = baseVideoUrl;
        if (baseVideoUrl.startsWith('/') && origin) {
            absVideoUrl = `${origin}${baseVideoUrl}`;
        }
        if (!concreteThumbUrl && origin && /^https?:\/\//i.test(absVideoUrl)) {
            try {
                const urlHash = crypto.createHash('sha256').update(absVideoUrl).digest('hex').substring(0, 32);
                const thumbFile = path.join(VIDEO_THUMBS_DIR, `${urlHash}.jpg`);
                // Pre-extract first frame during HTML crawl so when Discord requests /api/video/thumbnail 50ms later, it is already cached on disk
                if (!fs.existsSync(thumbFile) || fs.statSync(thumbFile).size <= 100) {
                    await extractVideoFirstFrame(absVideoUrl, thumbFile, 3800);
                }
            } catch (_) {}
        }
        const thumbUrl = concreteThumbUrl || (origin ? `${origin}/api/video/thumbnail?url=${encodeURIComponent(absVideoUrl)}` : blackThumbUrl);
        return {
            type: 'video',
            imageUrl: thumbUrl,
            videoUrl: absVideoUrl,
            videoType: baseVideoUrl.toLowerCase().includes('.webm') ? 'video/webm' : 'video/mp4',
            width: 1280,
            height: 720,
            source: 'Video'
        };
    }

    // 6. Direct Audio Files (.mp3, .wav, .ogg, .m4a)
    if (/\.(mp3|wav|ogg|m4a)(?:\?.*)?$/i.test(cleanUrl)) {
        return {
            type: 'audio',
            imageUrl: null,
            videoUrl: null,
            videoType: null,
            source: 'Audio'
        };
    }

    // 7. Direct Images (i.ibb.co, catbox, imgur, or common extensions)
    let absImgUrl = cleanUrl;
    if (cleanUrl.startsWith('/') && origin) {
        absImgUrl = `${origin}${cleanUrl}`;
    }
    return {
        type: 'image',
        imageUrl: absImgUrl,
        videoUrl: null,
        videoType: null,
        source: 'Image'
    };
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
    const origin = getOrigin(req);
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
    const origin = getOrigin(req);
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

app.get('*', async (req, res) => {
    // If request path is an API route, return 404 JSON
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'API route not found' });
    }

    try {
        const indexPath = path.join(__dirname, 'index.html');
        let html = fs.readFileSync(indexPath, 'utf8');
        const origin = getOrigin(req);

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
                const thread = db.prepare('SELECT id, board, name, subject, comment, media_url, created_at, (SELECT COUNT(*) FROM replies r WHERE r.thread_id = threads.id) as reply_count FROM threads WHERE id = ?').get(threadId);
                if (thread) {
                    const replyId = req.query.r || req.query.reply;
                    let reply = null;
                    if (replyId) {
                        try {
                            reply = db.prepare('SELECT id, thread_id, board, name, comment, media_url, created_at FROM replies WHERE id = ? AND thread_id = ?').get(replyId, threadId);
                        } catch (_) {}
                    }

                    const rawMedia = (reply && reply.media_url) ? reply.media_url : (thread.media_url || null);
                    const resolvedMedia = await resolveSocialMedia(rawMedia, origin, tweetCache, redditPostCache);
                    const blackThumbUrl = `${origin}/asset/img/video_black_thumb.png`;
                    const displayImage = resolvedMedia.type === 'video'
                        ? (resolvedMedia.imageUrl || blackThumbUrl)
                        : (resolvedMedia.imageUrl || currentBanner);

                    let pageTitle, pageDesc, canonicalUrl;
                    const siteName = `OshiMY - /${thread.board}/`;

                    const threadNum = thread.id.startsWith('-') ? thread.id.substring(1, 9) : thread.id.substring(0, 8);

                    if (reply) {
                        // Embed specific reply!
                        const replyNum = reply.id.startsWith('-') ? reply.id.substring(1, 9) : reply.id.substring(0, 8);
                        const threadSubj = thread.subject && thread.subject.trim() ? `"${thread.subject.trim()}"` : `Thread #${threadNum}`;
                        pageTitle = `💬 Reply >>${replyNum} on ${threadSubj} (/${thread.board}/) | OshiMY`;

                        const cleanReplyComment = (reply.comment || '')
                            .replace(/<br\s*[\/]?>/gi, ' ')
                            .replace(/<[^>]*>/g, '')
                            .replace(/\s+/g, ' ')
                            .trim()
                            .slice(0, 220);

                        pageDesc = cleanReplyComment 
                            ? `"${cleanReplyComment}"\n\n👤 ${reply.name || 'Anonymous'} • Replying to ${threadSubj}`
                            : `Reply >>${replyNum} by ${reply.name || 'Anonymous'} in /${thread.board}/ thread #${threadNum}`;

                        canonicalUrl = `${origin}/?b=${thread.board}&t=${thread.id}&r=${reply.id}`;
                    } else {
                        // Standard Thread Embed
                        const threadSubj = thread.subject && thread.subject.trim();
                        pageTitle = threadSubj 
                            ? `📌 ${threadSubj} - /${thread.board}/ | OshiMY`
                            : `🧵 /${thread.board}/ Thread #${threadNum} | OshiMY`;

                        const cleanComment = (thread.comment || '')
                            .replace(/<br\s*[\/]?>/gi, ' ')
                            .replace(/<[^>]*>/g, '')
                            .replace(/\s+/g, ' ')
                            .trim()
                            .slice(0, 220);

                        const repliesLabel = thread.reply_count === 1 ? '1 reply' : `${thread.reply_count || 0} replies`;
                        pageDesc = cleanComment
                            ? `"${cleanComment}"\n\n💬 ${repliesLabel} • 👤 ${thread.name || 'Anonymous'} • /${thread.board}/`
                            : `Thread #${threadNum} by ${thread.name || 'Anonymous'} in /${thread.board}/ (${repliesLabel})`;

                        canonicalUrl = `${origin}/?b=${thread.board}&t=${thread.id}`;
                    }

                    // Replace SEO tags
                    html = html
                        .replace(/<title>.*?<\/title>/, `<title>${escapeHtml(pageTitle)}</title>`)
                        .replace(/<meta name="description" content=".*?">/, `<meta name="description" content="${escapeAttr(pageDesc)}">`)
                        .replace(/<meta property="og:site_name" content=".*?">/, `<meta property="og:site_name" content="${escapeAttr(siteName)}">`)
                        .replace(/<meta property="og:title" content=".*?">/, `<meta property="og:title" content="${escapeAttr(pageTitle)}">`)
                        .replace(/<meta property="og:description" content=".*?">/, `<meta property="og:description" content="${escapeAttr(pageDesc)}">`)
                        .replace(/<meta property="og:image" content=".*?">/, `<meta property="og:image" content="${escapeAttr(displayImage)}">`)
                        .replace(/<meta property="og:url" content=".*?">/, `<meta property="og:url" content="${escapeAttr(canonicalUrl)}">`)
                        .replace(/<meta name="twitter:title" content=".*?">/, `<meta name="twitter:title" content="${escapeAttr(pageTitle)}">`)
                        .replace(/<meta name="twitter:description" content=".*?">/, `<meta name="twitter:description" content="${escapeAttr(pageDesc)}">`)
                        .replace(/<meta name="twitter:image" content=".*?">/, `<meta name="twitter:image" content="${escapeAttr(displayImage)}">`)
                        .replace(/<link rel="canonical" href=".*?">/, `<link rel="canonical" href="${escapeAttr(canonicalUrl)}">`);

                    // Video tags injection for Discord player
                    let extraMeta = '';
                    if (resolvedMedia.type === 'video' && resolvedMedia.videoUrl) {
                        const vidWidth = resolvedMedia.width || 1280;
                        const vidHeight = resolvedMedia.height || 720;
                        const vidType = resolvedMedia.videoType || 'video/mp4';
                        html = html
                            .replace(/<meta property="og:type" content=".*?">/, `<meta property="og:type" content="video.other">`)
                            .replace(/<meta name="twitter:card" content=".*?">/, `<meta name="twitter:card" content="player">`);
                        extraMeta += `
    <meta property="og:video" content="${escapeAttr(resolvedMedia.videoUrl)}">
    <meta property="og:video:secure_url" content="${escapeAttr(resolvedMedia.videoUrl)}">
    <meta property="og:video:type" content="${escapeAttr(vidType)}">
    <meta property="og:video:width" content="${vidWidth}">
    <meta property="og:video:height" content="${vidHeight}">
    <meta name="twitter:player:stream" content="${escapeAttr(resolvedMedia.videoUrl)}">
    <meta name="twitter:player:stream:content_type" content="${escapeAttr(vidType)}">
    <meta name="twitter:player" content="${escapeAttr(resolvedMedia.videoUrl)}">
    <meta name="twitter:player:width" content="${vidWidth}">
    <meta name="twitter:player:height" content="${vidHeight}">`;
                    } else {
                        html = html
                            .replace(/<meta property="og:type" content=".*?">/, `<meta property="og:type" content="article">`)
                            .replace(/<meta name="twitter:card" content=".*?">/, `<meta name="twitter:card" content="summary_large_image">`);
                    }

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
      "image": "${escapeJson(displayImage)}",
      "datePublished": "${new Date((reply ? reply.created_at : thread.created_at) || Date.now()).toISOString()}",
      "url": "${escapeJson(canonicalUrl)}",
      "publisher": {
        "@type": "Organization",
        "name": "OshiMY",
        "url": "${origin}/"
      }
    }
    </script>`;
                    html = html.replace('</head>', `${extraMeta}\n${threadJsonLd}\n</head>`);

                    res.setHeader('Content-Type', 'text/html; charset=utf-8');
                    return res.send(html);
                }
            } catch (threadErr) {
                console.warn('Could not render SSR thread/reply meta:', threadErr.message);
            }
        }

        // Check if a specific board is requested
        const boardKey = req.query.b;
        const boardMeta = boardKey ? (SFW_BOARDS[boardKey] || BOARDS[boardKey]) : null;
        if (boardKey && boardMeta) {
            const pageTitle = `${boardMeta.title} | OshiMY`;
            const pageDesc = `${boardMeta.description || `Anonymous discussions on /${boardKey}/ at OshiMY.`} Participate in anonymous discussions on /${boardKey}/ at OshiMY.`;
            const canonicalUrl = `${origin}/?b=${boardKey}`;
            const siteName = `OshiMY - /${boardKey}/`;

            html = html
                .replace(/<title>.*?<\/title>/, `<title>${escapeHtml(pageTitle)}</title>`)
                .replace(/<meta name="description" content=".*?">/, `<meta name="description" content="${escapeAttr(pageDesc)}">`)
                .replace(/<meta property="og:site_name" content=".*?">/, `<meta property="og:site_name" content="${escapeAttr(siteName)}">`)
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
