import fs from 'node:fs';
import path from 'node:path';
import { generatePosterId } from './db.js';

export const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000;   // 30 Days before auto-lock
export const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000; // 14 Days in DB before permanent static HTML baking

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function escapeAttr(str) {
    if (!str) return '';
    return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function formatStaticComment(text) {
    if (!text) return '';
    let formatted = escapeHtml(text);

    // >>PostID Quote links
    const quoteRegex = /&gt;&gt;([a-zA-Z0-9\-_]+)/g;
    formatted = formatted.replace(quoteRegex, (match, id) => {
        return `<a href="#post_${id}" class="quote-link" data-post-id="${id}">&gt;&gt;${id.substring(1, 9)}</a>`;
    });

    // Auto-linkify URLs (http/https)
    const urlRegex = /(https?:\/\/[^\s<]+)/g;
    formatted = formatted.replace(urlRegex, (url) => {
        return `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color:var(--main-accent); text-decoration:underline;">${url}</a>`;
    });

    // Greentext (>text)
    const greenRegex = /^(&gt;[^&].*)$/gm;
    formatted = formatted.replace(greenRegex, '<span style="color:#2e7d32;">$1</span>');

    return formatted;
}

export function renderStaticMedia(mediaUrl) {
    if (!mediaUrl || !mediaUrl.trim()) return '';
    const cleanUrl = mediaUrl.trim();
    const isVideo = /\.(mp4|webm|mov)(\?.*)?$/i.test(cleanUrl) || cleanUrl.includes('catbox') && cleanUrl.endsWith('.mp4');

    if (isVideo) {
        return `
            <div class="media-container" style="float:left; margin:0 15px 10px 0;">
                <video controls src="${escapeAttr(cleanUrl)}" style="max-width:320px; max-height:240px; border-radius:6px; background:#000;" preload="metadata"></video>
            </div>
        `;
    }

    return `
        <div class="media-container" style="float:left; margin:0 15px 10px 0;">
            <a href="${escapeAttr(cleanUrl)}" target="_blank" rel="noopener noreferrer">
                <img src="${escapeAttr(cleanUrl)}" class="post-media" style="max-width:250px; max-height:250px; object-fit:contain; border-radius:6px; border:1px solid var(--border-color);" alt="Media" loading="lazy" />
            </a>
        </div>
    `;
}

export function renderStaticStampReactions(reactionsRaw) {
    if (!reactionsRaw) return '';
    let counts = {};
    try {
        counts = typeof reactionsRaw === 'string' ? JSON.parse(reactionsRaw || '{}') : (reactionsRaw || {});
    } catch (_) {
        counts = {};
    }

    const STAMP_MAP = {
        'kusa': { emoji: '🌱', label: '草' },
        'tasukaru': { emoji: '🙏', label: '助かる' },
        'kawaii': { emoji: '✨', label: 'かわいい' },
        'yabai': { emoji: '⚠️', label: 'ヤバい' },
        'penang': { emoji: '🍜', label: 'Lekas' },
        'dd': { emoji: '🤝', label: 'DD' }
    };

    const chips = [];
    for (const [key, count] of Object.entries(counts)) {
        const num = parseInt(count, 10);
        if (num > 0) {
            const info = STAMP_MAP[key] || { emoji: '🏷️', label: key };
            chips.push(`
                <span class="stamp-chip" style="display:inline-flex; align-items:center; gap:4px; padding:2px 8px; background:var(--card-bg); border:1px solid var(--border-color); border-radius:12px; font-size:0.85em; opacity:0.9;">
                    <span>${info.emoji}</span>
                    <span style="font-weight:600;">${info.label}</span>
                    <span style="opacity:0.8; font-size:0.9em;">(${num})</span>
                </span>
            `);
        }
    }

    if (chips.length === 0) return '';
    return `<div class="static-reactions-bar" style="display:flex; flex-wrap:wrap; gap:6px; margin-top:8px;">${chips.join('')}</div>`;
}

export function generateStaticThreadHtml({ thread, replies, origin = '' }) {
    const boardKey = thread.board;
    const title = thread.subject || `Thread #${thread.id.substring(1, 9)}`;
    const pageTitle = `[Archive] /${boardKey}/ - ${title} | OshiMY`;
    const lockedDateStr = thread.locked_at ? new Date(thread.locked_at).toLocaleString() : new Date().toLocaleString();
    const createdDateStr = new Date(thread.created_at).toLocaleString();

    // Map backlinks (which replies quote which post)
    const backlinksMap = new Map();
    const quoteRegex = />>([a-zA-Z0-9\-_]+)/g;

    for (const r of replies) {
        let match;
        const regex = new RegExp(quoteRegex);
        while ((match = regex.exec(r.comment)) !== null) {
            const targetId = match[1];
            if (!backlinksMap.has(targetId)) backlinksMap.set(targetId, []);
            backlinksMap.get(targetId).push(r.id);
        }
    }

    function renderBacklinks(postId) {
        const list = backlinksMap.get(postId);
        if (!list || list.length === 0) return '';
        const links = list.map(bid => `<a href="#post_${bid}" class="backlink-pill">&gt;&gt;${bid.substring(1, 9)}</a>`).join(' ');
        return `<div class="backlinks" style="font-size:0.8em; margin: 4px 0 6px 0; opacity:0.85;">Replies: ${links}</div>`;
    }

    // Render OP
    const opPosterId = generatePosterId(thread.ip_hash, thread.id);
    const opMediaHtml = renderStaticMedia(thread.media_url);
    const opCommentHtml = formatStaticComment(thread.comment);
    const opBacklinks = renderBacklinks(thread.id);
    const opReactionsHtml = renderStaticStampReactions(thread.reactions);

    // Render Replies
    const repliesHtml = replies.map(r => {
        const replyPosterId = generatePosterId(r.ip_hash, thread.id);
        const rMedia = renderStaticMedia(r.media_url);
        const rComment = formatStaticComment(r.comment);
        const rBacklinks = renderBacklinks(r.id);
        const rDate = new Date(r.created_at).toLocaleString();
        const rReactions = renderStaticStampReactions(r.reactions);
        const isOpPoster = (r.ip_hash && thread.ip_hash && r.ip_hash === thread.ip_hash);
        const opTag = isOpPoster ? `<span style="color:var(--main-accent); font-weight:bold; font-size:0.85em; margin-right:4px;">(OP)</span>` : '';

        return `
            <div class="reply-container" id="post_${r.id}" style="margin-bottom:10px;">
                <div class="reply" style="background:var(--reply-bg); border:1px solid var(--border-color); border-radius:8px; padding:10px 14px; position:relative;">
                    ${rMedia}
                    <div class="post-content">
                        <div class="post-header" style="font-size:0.9em; margin-bottom:6px; color:var(--text-color); display:flex; flex-wrap:wrap; align-items:center; gap:6px;">
                            ${opTag}
                            <span class="name" style="font-weight:bold; color:var(--header-color);">${escapeHtml(r.name || 'Anonymous')}</span>
                            <span class="poster-id-badge" style="background:var(--card-bg); border:1px solid var(--border-color); padding:1px 6px; border-radius:4px; font-family:monospace; font-size:0.85em;">ID: ${escapeHtml(replyPosterId)}</span>
                            <span class="date" style="opacity:0.7; font-size:0.85em;">${rDate}</span>
                            <span class="post-id">No. <a href="#post_${r.id}" onclick="copyAnchorLink('${r.id}', event)" title="Click to copy direct link">${r.id.substring(1, 9)}</a></span>
                        </div>
                        ${rBacklinks}
                        <div class="comment" style="line-height:1.5; word-break:break-word;">${rComment}</div>
                        ${rReactions}
                    </div>
                    <div style="clear:both;"></div>
                </div>
            </div>
        `;
    }).join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(pageTitle)}</title>
    <meta name="description" content="Archived discussion from /${boardKey}/: ${escapeAttr(title)}">
    <meta name="robots" content="index, follow">
    <link rel="stylesheet" href="/asset/css/core.css">
    <link rel="stylesheet" href="/asset/css/layout.css">
    <link rel="stylesheet" href="/asset/css/themes.css">
    <style>
        .archive-banner {
            background: rgba(220, 38, 38, 0.08);
            border: 1px solid #ef4444;
            border-radius: 10px;
            padding: 14px 18px;
            margin: 15px auto 25px auto;
            max-width: 900px;
            color: var(--text-color);
        }
        .highlighted-post .reply,
        .highlighted-post.op {
            box-shadow: 0 0 12px var(--main-accent) !important;
            border-color: var(--main-accent) !important;
        }
        .backlink-pill {
            display: inline-block;
            margin-right: 4px;
            color: var(--main-accent);
            text-decoration: underline;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1 id="boardTitle">/${boardKey}/ - Archive</h1>
        <div class="nav-site" style="display:flex; justify-content:center; gap:10px; margin-top:8px; font-size:0.95em;">
            <span>[ <a href="/">🏠 Home</a> ]</span>
            <span>[ <a href="/?b=${boardKey}">⚡ Active Board</a> ]</span>
            <span>[ <a href="/?b=${boardKey}&view=archive" style="font-weight:bold;">📦 Board Archives</a> ]</span>
        </div>
    </div>

    <div class="container" style="max-width:960px; margin:0 auto; padding:10px;">
        <div class="archive-banner">
            <div style="font-weight:bold; font-size:1.05em; display:flex; align-items:center; gap:6px; margin-bottom:4px; color:#dc2626;">
                <span>🔒</span>
                <span>Permanent Static Archive</span>
            </div>
            <div style="font-size:0.9em; opacity:0.9; line-height:1.4;">
                This thread was locked and archived on <strong>${lockedDateStr}</strong>. It has been baked into a hardcoded static HTML archive to minimize database resource consumption. Interactive stamps and new replies are permanently disabled.
            </div>
        </div>

        <div class="thread" id="thread_${thread.id}">
            <div class="op" id="post_${thread.id}" style="background:var(--card-bg); border:1px solid var(--border-color); border-radius:10px; padding:16px; margin-bottom:20px;">
                ${opMediaHtml}
                <div class="post-content">
                    <div class="post-header" style="font-size:0.95em; margin-bottom:8px; display:flex; flex-wrap:wrap; align-items:center; gap:6px;">
                        <span style="color:#dc2626; font-weight:bold;">🔒 [Locked &amp; Archived]</span>
                        <span class="subject" style="font-weight:bold; font-size:1.15em; color:var(--header-color);">${escapeHtml(thread.subject || '')}</span>
                        <span class="name" style="font-weight:bold; color:var(--header-color);">${escapeHtml(thread.name || 'Anonymous')}</span>
                        <span class="poster-id-badge" style="background:var(--reply-bg); border:1px solid var(--border-color); padding:1px 6px; border-radius:4px; font-family:monospace; font-size:0.85em;">ID: ${escapeHtml(opPosterId)}</span>
                        <span class="date" style="opacity:0.7; font-size:0.85em;">${createdDateStr}</span>
                        <span class="post-id">No. <a href="#post_${thread.id}" onclick="copyAnchorLink('${thread.id}', event)" title="Click to copy direct link">${thread.id.substring(1, 9)}</a></span>
                    </div>
                    ${opBacklinks}
                    <div class="comment" style="font-size:1.05em; line-height:1.6; word-break:break-word; margin-top:8px;">${opCommentHtml}</div>
                    ${opReactionsHtml}
                </div>
                <div style="clear:both;"></div>
            </div>

            <div class="replies" style="margin-left:20px;">
                ${repliesHtml}
            </div>
        </div>

        <div style="text-align:center; padding:30px 0; opacity:0.8; font-size:0.9em;">
            [ <a href="/?b=${boardKey}&view=archive">Return to /${boardKey}/ Archives</a> ] &bull;
            [ <a href="#top" onclick="window.scrollTo({top:0, behavior:'smooth'}); return false;">Top of Page ▲</a> ]
        </div>
    </div>

    <script>
        function updateHighlight() {
            document.querySelectorAll('.highlighted-post').forEach(el => el.classList.remove('highlighted-post'));
            if (window.location.hash) {
                const target = document.querySelector(window.location.hash);
                if (target) {
                    target.classList.add('highlighted-post');
                    target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            }
        }
        function copyAnchorLink(id, event) {
            if (event) event.preventDefault();
            const url = window.location.origin + window.location.pathname + '#post_' + id;
            if (navigator.clipboard) {
                navigator.clipboard.writeText(url).then(() => {
                    alert('Copied direct link to post No. ' + id.substring(1, 9));
                }).catch(() => {
                    window.location.hash = '#post_' + id;
                });
            } else {
                window.location.hash = '#post_' + id;
            }
        }
        window.addEventListener('hashchange', updateHighlight);
        window.addEventListener('DOMContentLoaded', updateHighlight);
    </script>
</body>
</html>`;
}

export function bakeThreadToStaticHtml(db, thread, archivesDir, origin = '') {
    const replies = db.prepare(`
        SELECT * FROM replies
        WHERE thread_id = ?
        ORDER BY created_at ASC
    `).all(thread.id);

    const html = generateStaticThreadHtml({ thread, replies, origin });
    const boardDir = path.join(archivesDir, thread.board);
    if (!fs.existsSync(boardDir)) {
        fs.mkdirSync(boardDir, { recursive: true });
    }

    const relativePath = path.join('archives', thread.board, `${thread.id}.html`).replace(/\\/g, '/');
    const fullFilePath = path.join(archivesDir, thread.board, `${thread.id}.html`);
    fs.writeFileSync(fullFilePath, html, 'utf-8');

    // Prune database in a transaction to release disk space
    db.exec('BEGIN TRANSACTION;');
    try {
        db.prepare(`
            DELETE FROM post_reactions
            WHERE post_id = ? 
               OR post_id IN (SELECT id FROM replies WHERE thread_id = ?)
        `).run(thread.id, thread.id);

        db.prepare('DELETE FROM replies WHERE thread_id = ?').run(thread.id);

        db.prepare(`
            UPDATE threads
            SET is_static = 1,
                is_archived = 1,
                is_locked = 1,
                static_path = ?,
                reactions = '{}'
            WHERE id = ?
        `).run(relativePath, thread.id);

        db.exec('COMMIT;');
        console.log(`[Archive] Baked thread #${thread.id} to static HTML (${relativePath}) and purged replies from SQLite.`);
    } catch (err) {
        db.exec('ROLLBACK;');
        console.error(`[Archive] Failed to prune SQLite for thread #${thread.id}:`, err);
        throw err;
    }

    return relativePath;
}

export function autoLockOldThreads(db, now = Date.now()) {
    const cutoff = now - ONE_MONTH_MS;
    const candidates = db.prepare(`
        SELECT id, board, subject FROM threads
        WHERE is_locked = 0 AND bumped_at < ?
    `).all(cutoff);

    if (candidates.length === 0) return 0;

    const lockStmt = db.prepare(`
        UPDATE threads
        SET is_locked = 1,
            is_archived = 1,
            locked_at = ?
        WHERE id = ?
    `);

    db.exec('BEGIN TRANSACTION;');
    try {
        for (const c of candidates) {
            lockStmt.run(now, c.id);
        }
        db.exec('COMMIT;');
        console.log(`[Archive] Auto-locked ${candidates.length} inactive threads (>30 days since last bump).`);
    } catch (err) {
        db.exec('ROLLBACK;');
        console.error('[Archive] Error during auto-lock batch:', err);
    }

    return candidates.length;
}

export function bakeExpiredArchivedThreads(db, archivesDir, origin = '', now = Date.now()) {
    const cutoff = now - FOURTEEN_DAYS_MS;
    const candidates = db.prepare(`
        SELECT * FROM threads
        WHERE (is_locked = 1 OR is_archived = 1)
          AND locked_at IS NOT NULL
          AND locked_at <= ?
          AND is_static = 0
    `).all(cutoff);

    if (candidates.length === 0) return 0;

    let bakedCount = 0;
    for (const th of candidates) {
        try {
            bakeThreadToStaticHtml(db, th, archivesDir, origin);
            bakedCount++;
        } catch (err) {
            console.error(`[Archive] Error baking expired thread #${th.id}:`, err);
        }
    }

    return bakedCount;
}

export function runArchiveLifecycle(db, archivesDir, origin = '') {
    const now = Date.now();
    const lockedCount = autoLockOldThreads(db, now);
    const bakedCount = bakeExpiredArchivedThreads(db, archivesDir, origin, now);
    return { lockedCount, bakedCount };
}
