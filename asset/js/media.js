// ==========================================
// MEDIA.JS - Centralized Media & Embed Engine
// Handles Images, Video, Audio, YouTube, Twitter/X, Reddit, Lightbox & ImgBB Upload
// ==========================================

const IMGBB_API_KEY = "6d885f930c72cd28e6520e6c7494704f";

function getVxRedditUrl(url) {
    if (!url || typeof url !== 'string') return '';
    const cleanUrl = url.trim();
    const vMatch = cleanUrl.match(/v\.redd\.it\/([a-zA-Z0-9_-]+)/i);
    if (vMatch) return `https://vxreddit.com/comments/${vMatch[1]}`;
    const rMatch = cleanUrl.match(/(?:https?:\/\/)?redd\.it\/([a-zA-Z0-9_-]+)/i);
    if (rMatch) return `https://vxreddit.com/comments/${rMatch[1]}`;
    if (/https?:\/\/(?:www\.)?vxreddit\.com/i.test(cleanUrl)) return cleanUrl;
    if (/https?:\/\/(?:www\.)?rxddit\.com/i.test(cleanUrl)) return cleanUrl.replace(/rxddit\.com/i, 'vxreddit.com');
    return cleanUrl.replace(/https?:\/\/(?:www\.|old\.|new\.|m\.|sh\.)?reddit\.com/i, 'https://vxreddit.com');
}

function isSpoilerMediaUrl(url) {
    if (!url || typeof url !== 'string') return false;
    return /(?:^spoiler:|#spoiler$)/i.test(url.trim());
}

function stripSpoilerFlag(url) {
    if (!url || typeof url !== 'string') return '';
    return url.trim().replace(/^spoiler:/i, '').replace(/#spoiler$/i, '').trim();
}

function formatSpoilerMediaUrl(url, isSpoiler) {
    const clean = stripSpoilerFlag(url);
    if (!clean) return '';
    return isSpoiler ? `${clean}#spoiler` : clean;
}

function getSpoilerOverlayHtml(isSpoiler) {
    if (!isSpoiler) return '';
    return `
        <div class="spoiler-overlay" aria-hidden="true">
            <svg class="spoiler-eye-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                <circle cx="12" cy="12" r="3"></circle>
            </svg>
            <span class="spoiler-label">SPOILER</span>
        </div>
    `;
}

function syncSpoilerToggleUI(mode = 'main') {
    const isQr = mode === 'qr';
    const checkbox = document.getElementById(isQr ? 'qrSpoilerInput' : 'spoilerInput');
    const pill = document.getElementById(isQr ? 'qrSpoilerTogglePill' : 'spoilerTogglePill');
    const label = document.getElementById(isQr ? 'qrSpoilerToggleLabel' : 'spoilerToggleLabel');
    const checked = Boolean(checkbox && checkbox.checked);

    if (pill) {
        pill.classList.toggle('active', checked);
    }
    if (label) {
        label.innerText = checked ? 'Spoiler: ON' : 'Spoiler';
    }
    if (!isQr) {
        const previewImg = document.getElementById('uploadPreviewImg');
        if (previewImg) {
            previewImg.classList.toggle('spoiler-preview-blur', checked);
        }
    }
}

// --- CENTRALIZED MEDIA TYPE DETECTION ---
function getMediaType(url) {
    if (!url || typeof url !== 'string') return null;
    const isSpoiler = isSpoilerMediaUrl(url);
    const cleanUrl = stripSpoilerFlag(url);
    if (!cleanUrl) return null;

    // 1. YouTube Detection (standard, shorts, live, embed, youtu.be, music.youtube)
    const ytRegex = /(?:https?:\/\/)?(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|v\/|shorts\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i;
    const ytMatch = cleanUrl.match(ytRegex);
    if (ytMatch) {
        return { type: 'youtube', id: ytMatch[1], url: cleanUrl, isSpoiler };
    }

    // 2. Twitter / X Detection (handles twitter.com, x.com, vxtwitter, fxtwitter, fixupx, /status/ and /i/status/)
    const xRegex = /(?:https?:\/\/)?(?:www\.)?(?:twitter\.com|x\.com|vxtwitter\.com|fxtwitter\.com|fixupx\.com)\/(?:#!\/)?(?:([a-zA-Z0-9_]+)\/status\/|status\/|i\/status\/)(\d+)/i;
    const xMatch = cleanUrl.match(xRegex);
    if (xMatch) {
        const rawHandle = xMatch[1];
        const isNotHandle = !rawHandle || ['status', 'i', 'intent'].includes(rawHandle.toLowerCase());
        return { 
            type: 'x', 
            handle: isNotHandle ? null : rawHandle, 
            id: xMatch[2], 
            url: cleanUrl,
            isSpoiler
        };
    }

    // Twitter CDN Images (pbs.twimg.com)
    if (cleanUrl.match(/(?:https?:\/\/)?pbs\.twimg\.com\/media\/[^\s]+/i)) {
        return { type: 'image', url: cleanUrl, isSpoiler };
    }

    // 3. Pixiv Artwork Link (pixiv.net/artworks/:id)
    const pixivRegex = /(?:https?:\/\/)?(?:www\.)?pixiv\.net\/(?:[a-zA-Z-]+\/)?artworks\/(\d+)/i;
    const pixivMatch = cleanUrl.match(pixivRegex);
    if (pixivMatch) {
        return { type: 'pixiv', id: pixivMatch[1], url: cleanUrl, isSpoiler };
    }

    // 4. Pixiv Direct CDN Images (i.pximg.net, i.pixiv.re, pixiv.re - requires proxy or proxy helper)
    const pximgRegex = /(?:https?:\/\/)?([a-zA-Z0-9-]+\.(?:pximg\.net|pixiv\.re)\/[^\s]+|pixiv\.re\/\d+(?:-\d+)?\.(?:jpg|png|gif|jpeg))/i;
    const pximgMatch = cleanUrl.match(pximgRegex);
    if (pximgMatch) {
        const fullUrl = cleanUrl.startsWith('http') ? cleanUrl : `https://${cleanUrl}`;
        // If already pointing to pixiv.re helper, it can be loaded directly with fallback
        const isHelper = /pixiv\.re/i.test(fullUrl);
        const helperUrl = isHelper ? fullUrl : fullUrl.replace(/^https?:\/\/[a-zA-Z0-9-]+\.pximg\.net\//i, 'https://i.pixiv.re/');
        const proxyUrl = `/api/proxy/pixiv?url=${encodeURIComponent(fullUrl)}`;
        return { 
            type: 'pixiv_image', 
            url: fullUrl,
            helperUrl,
            proxyUrl,
            isSpoiler
        };
    }

    // 5. Reddit CDN Images (i.redd.it, preview.redd.it, external-preview.redd.it)
    if (cleanUrl.match(/(?:https?:\/\/)?(?:i|preview|external-preview)\.redd\.it\/[^\s]+/i)) {
        return { type: 'image', url: cleanUrl, isSpoiler };
    }

    // 6. Reddit Direct Video (v.redd.it - mapped to vxreddit merged audio+video helper)
    const redditVideoRegex = /(?:https?:\/\/)?v\.redd\.it\/([a-zA-Z0-9_-]+)/i;
    const redditVideoMatch = cleanUrl.match(redditVideoRegex);
    if (redditVideoMatch) {
        const vid = redditVideoMatch[1];
        const vxUrl = `https://vxreddit.com/comments/${vid}`;
        const videoUrl = `https://vxreddit.com/redditvideo.mp4?video_url=${encodeURIComponent('https://v.redd.it/' + vid + '/CMAF_720.m3u8')}&audio_url=${encodeURIComponent('https://v.redd.it/' + vid + '/CMAF_AUDIO_128.m3u8')}`;
        return { type: 'reddit_video', id: vid, url: cleanUrl, vxUrl, videoUrl, isSpoiler };
    }

    // 7. Reddit Post & Share Link Detection (handles reddit.com, vxreddit.com, rxddit.com, redd.it)
    const redditPostRegex = /(?:https?:\/\/)?(?:(?:www\.|old\.|new\.|m\.|sh\.)?(?:reddit\.com|vxreddit\.com|rxddit\.com)\/(?:r\/([a-zA-Z0-9_]+)\/(?:comments\/([a-z0-9]+)|s\/([a-zA-Z0-9_-]+))|(?:comments\/([a-z0-9]+)|s\/([a-zA-Z0-9_-]+)))|(?<![a-zA-Z0-9])redd\.it\/([a-z0-9]+))/i;
    const redditPostMatch = cleanUrl.match(redditPostRegex);
    if (redditPostMatch) {
        const subreddit = redditPostMatch[1] || 'reddit';
        const id = redditPostMatch[2] || redditPostMatch[3] || redditPostMatch[4] || redditPostMatch[5] || redditPostMatch[6];
        const isShare = !!(redditPostMatch[3] || redditPostMatch[5]);
        const vxUrl = getVxRedditUrl(cleanUrl);
        return { type: 'reddit', subreddit, id, isShare, url: cleanUrl, vxUrl, isSpoiler };
    }

    // 8. Direct HTML5 Video Detection
    if (cleanUrl.match(/\.(mp4|webm|ogv|mov|m4v)(?:\?.*)?$/i)) {
        return { type: 'video', url: cleanUrl, isSpoiler };
    }

    // 9. Direct HTML5 Audio Detection
    if (cleanUrl.match(/\.(mp3|wav|ogg|m4a|aac|opus|flac)(?:\?.*)?$/i)) {
        return { type: 'audio', url: cleanUrl, isSpoiler };
    }

    // 10. Default Fallback: Treat as Image
    return { type: 'image', url: cleanUrl, isSpoiler };
}

// --- EMBED METADATA SESSION CACHE & THUMBNAIL HELPER PROXIES ---
const embedMemoryCache = new Map();

function getCachedEmbedMeta(key) {
    if (embedMemoryCache.has(key)) return embedMemoryCache.get(key);
    try {
        const raw = sessionStorage.getItem('oshimy_embed_' + key);
        if (raw) {
            const parsed = JSON.parse(raw);
            embedMemoryCache.set(key, parsed);
            return parsed;
        }
    } catch (_) {}
    return null;
}

function setCachedEmbedMeta(key, val) {
    embedMemoryCache.set(key, val);
    try {
        sessionStorage.setItem('oshimy_embed_' + key, JSON.stringify(val));
    } catch (_) {}
}

// Offload external image thumbnails via wsrv.nl global CDN (converts to lightweight WebP)
function getOptimizedThumbUrl(rawUrl, width = 360) {
    if (!rawUrl || typeof rawUrl !== 'string') return rawUrl;
    if (rawUrl.startsWith('/') || rawUrl.startsWith('data:') || rawUrl.includes('wsrv.nl')) return rawUrl;
    // Skip animated GIFs, Catbox direct files, or Pixiv reverse-proxied URLs so files load directly without proxy delay
    if (/\.gif(?:\?|$)/i.test(rawUrl) || rawUrl.includes('catbox.moe') || rawUrl.includes('pximg.net') || rawUrl.includes('pixiv.re')) {
        return rawUrl;
    }
    return `https://wsrv.nl/?url=${encodeURIComponent(rawUrl)}&w=${width}&output=webp&q=82&we`;
}

// --- CENTRALIZED MEDIA RENDERING ---
function renderMedia(url) {
    if (!url) return "";
    const media = getMediaType(url);
    if (!media) return "";

    const spoilerClass = media.isSpoiler ? ' spoiler-media' : '';
    const spoilerOverlay = getSpoilerOverlayHtml(media.isSpoiler);

    // 1. Lite YouTube Facade Card (WebP thumbnail + zero-JS overhead until clicked)
    if (media.type === 'youtube') {
        const webpThumb = `https://i.ytimg.com/vi_webp/${media.id}/hqdefault.webp`;
        const jpgFallback = `https://i.ytimg.com/vi/${media.id}/mqdefault.jpg`;
        return `
            <div class="media-container yt-lite-facade${spoilerClass}" onclick="openLightbox('youtube', '${media.id}')" title="Click to play YouTube Video (${media.id})">
                <img src="${webpThumb}" onerror="if(this.src!=='${jpgFallback}')this.src='${jpgFallback}';" alt="YouTube Thumbnail" loading="lazy" decoding="async" style="max-width:200px; max-height:200px; object-fit:cover; display:block;">
                <div class="play-overlay yt-play-badge">▶</div>
                <div class="pixiv-badge" style="background:#ff0000;">YouTube</div>
                ${spoilerOverlay}
            </div>
        `;
    } 

    // 2. Twitter / X Card
    if (media.type === 'x') {
        const handleLabel = media.handle ? `@${escapeHtml(media.handle)}` : '𝕏 Post';
        const cleanHandle = media.handle || 'i';
        return `
            <div class="media-container file-placeholder x-placeholder${spoilerClass}" data-tweet-id="${media.id}" data-tweet-handle="${escapeHtml(cleanHandle)}" onclick="openLightbox('x', '${media.id}', '${escapeHtml(cleanHandle)}')" title="Click to view Tweet by ${handleLabel}">
                <div class="tweet-thumb-slot" id="tweet_slot_${media.id}" style="width:100%; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center;">
                    <div class="file-ext" style="color:#1DA1F2; font-size:24px; font-weight:900;">𝕏</div>
                    <div style="font-size:11px; color:#fff; font-weight:bold; margin-top:4px;">${handleLabel}</div>
                    <div style="font-size:10px; color:#aaa; margin-top:2px;">View Tweet &amp; Media</div>
                </div>
                ${spoilerOverlay}
            </div>
        `;
    }

    // 3. Pixiv Artwork Link
    if (media.type === 'pixiv') {
        const helperFallback = `https://pixiv.re/${media.id}.jpg`;
        return `
            <div class="media-container file-placeholder pixiv-placeholder${spoilerClass}" data-pixiv-id="${media.id}" onclick="openLightbox('pixiv', '${media.id}')" title="Click to view Pixiv Artwork #${media.id}">
                <div class="pixiv-thumb-slot" id="pixiv_slot_${media.id}" style="width:100%; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center;">
                    <div style="position:relative; width:100%; height:100%; display:flex; align-items:center; justify-content:center;">
                        <img src="${helperFallback}" class="thread-image" loading="lazy" decoding="async" alt="Pixiv #${media.id}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" style="max-width:200px; max-height:200px; object-fit:cover; border-radius:4px; display:block;">
                        <div class="pixiv-fallback-badge" style="display:none; flex-direction:column; align-items:center; justify-content:center;">
                            <div class="file-ext" style="color:#0096fa; font-size:22px; font-weight:900;">pixiv</div>
                            <div style="font-size:11px; color:#fff; font-weight:bold; margin-top:4px;">#${media.id}</div>
                        </div>
                        <div class="pixiv-badge">pixiv</div>
                    </div>
                </div>
                ${spoilerOverlay}
            </div>
        `;
    }

    // 4. Pixiv Direct Image (i.pximg.net / i.pixiv.re - rendered with automatic proxy helper fallback)
    if (media.type === 'pixiv_image') {
        const primarySrc = media.proxyUrl || `/api/proxy/pixiv?url=${encodeURIComponent(media.url)}`;
        const helperFallback = media.helperUrl || media.url.replace(/^https?:\/\/[a-zA-Z0-9-]+\.pximg\.net\//i, 'https://i.pixiv.re/');
        if (media.isSpoiler) {
            return `
                <div class="media-container spoiler-media" onclick="const img=this.querySelector('img'); openLightbox('pixiv_image', img ? (img.currentSrc || img.src) : '${escapeHtml(primarySrc)}', '${escapeHtml(media.url)}')" title="Click to expand Pixiv image (Spoiler)">
                    <img src="${escapeHtml(primarySrc)}" class="thread-image" loading="lazy" decoding="async" alt="Pixiv image" onerror="if(this.dataset.triedHelper !== 'true'){ this.dataset.triedHelper='true'; this.src='${escapeHtml(helperFallback)}'; } else { this.style.display='none'; }">
                    ${spoilerOverlay}
                </div>
            `;
        }
        return `
            <img src="${escapeHtml(primarySrc)}" class="thread-image" loading="lazy" decoding="async" alt="Pixiv image" onclick="openLightbox('pixiv_image', this.currentSrc || this.src, '${escapeHtml(media.url)}')" onerror="if(this.dataset.triedHelper !== 'true'){ this.dataset.triedHelper='true'; this.src='${escapeHtml(helperFallback)}'; } else { this.style.display='none'; }" title="Click to expand Pixiv image">
        `;
    }

    // 5. Reddit Post Card (with vxreddit proxy helper integration)
    if (media.type === 'reddit') {
        const isShareParam = media.isShare ? 'true' : 'false';
        return `
            <div class="media-container file-placeholder reddit-placeholder${spoilerClass}" data-reddit-url="${escapeHtml(media.url)}" data-vx-url="${escapeHtml(media.vxUrl || '')}" onclick="openLightbox('reddit', '${escapeHtml(media.url)}', '${escapeHtml(media.subreddit)}', '${escapeHtml(media.id)}', ${isShareParam})" title="Click to view Reddit post on r/${escapeHtml(media.subreddit)}">
                <div class="reddit-thumb-slot" style="width:100%; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center;">
                    <div style="display:flex; align-items:center; justify-content:center; width:44px; height:44px; border-radius:50%; background:rgba(255, 69, 0, 0.15); margin-bottom:8px;">
                        <svg width="26" height="26" viewBox="0 0 24 24" fill="#FF4500">
                            <path d="M12 0C5.373 0 0 5.373 0 12c0 3.314 1.343 6.314 3.515 8.485l-1.03 3.09a.75.75 0 00.95.95l3.09-1.03C8.686 22.657 11.686 24 15 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm5.01 13.5c0 .825-.675 1.5-1.5 1.5-.412 0-.788-.168-1.06-.44-.825.562-1.95.915-3.2.94l.544-2.548 1.77.375c.026.685.586 1.233 1.286 1.233.714 0 1.29-.576 1.29-1.29 0-.714-.576-1.29-1.29-1.29-.488 0-.915.27-1.14.667l-2.01-.426a.375.375 0 00-.442.29l-.66 3.09c-1.32-.025-2.512-.39-3.375-.97a1.49 1.49 0 01-.983.37c-.825 0-1.5-.675-1.5-1.5 0-.585.34-1.09.83-1.332-.045-.22-.07-.446-.07-.668 0-2.348 2.73-4.25 6.1-4.25s6.1 1.902 6.1 4.25c0 .222-.025.448-.07.668.49.242.83.747.83 1.332z"/>
                        </svg>
                    </div>
                    <div style="font-size:12px; font-weight:bold; color:#fff; max-width:160px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; line-height:1.2;">r/${escapeHtml(media.subreddit)}</div>
                    <div style="font-size:10px; color:#ff8c5a; margin-top:4px; font-weight:600; line-height:1.2;">${media.isShare ? 'Reddit Video / Post' : 'View Post &amp; Media'}</div>
                </div>
                ${spoilerOverlay}
            </div>
        `;
    }

    // 6. Reddit Video Card (v.redd.it with vxreddit streaming helper)
    if (media.type === 'reddit_video') {
        return `
            <div class="media-container file-placeholder reddit-placeholder${spoilerClass}" data-reddit-url="${escapeHtml(media.url)}" data-vx-url="${escapeHtml(media.vxUrl || '')}" onclick="openLightbox('reddit_video', '${media.id}')" title="Click to play Reddit Video with Audio">
                <div class="reddit-thumb-slot" style="width:100%; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center;">
                    <div class="file-ext" style="color:#FF4500; font-size:28px;">🎥</div>
                    <div style="font-size:11px; color:#fff; font-weight:bold; margin-top:4px;">Reddit Video</div>
                    <div class="play-overlay">▶</div>
                </div>
                ${spoilerOverlay}
            </div>
        `;
    }

    // 7. Direct Video
    if (media.type === 'video') {
        return `
            <div class="media-container${spoilerClass}" onclick="openLightbox('video', '${escapeHtml(media.url)}')" style="cursor:pointer;" title="Click to play Video">
                <video src="${escapeHtml(media.url)}#t=0.001" preload="metadata" muted playsinline style="max-width:200px; max-height:200px; object-fit:cover; display:block; pointer-events:none; border:none;"></video>
                <div class="play-overlay">▶</div>
                ${spoilerOverlay}
            </div>
        `;
    }

    // 8. Direct Audio
    if (media.type === 'audio') {
        return `
            <div class="media-container file-placeholder${spoilerClass}" onclick="openLightbox('audio', '${escapeHtml(media.url)}')" style="cursor:pointer; background:#2c3e50;" title="Click to play Audio">
                <div class="file-ext" style="color:#00e5ff;">🎵</div>
                <div style="font-size:11px; color:#fff; font-weight:bold; margin-top:4px;">Audio File</div>
                <div class="play-overlay" style="width:36px; height:36px; font-size:18px;">▶</div>
                ${spoilerOverlay}
            </div>
        `;
    }

    // 9. Standard Image (including Catbox, i.redd.it, pbs.twimg.com) with wsrv.nl WebP thumbnail proxy
    const optimizedThumb = getOptimizedThumbUrl(media.url, 360);
    if (media.isSpoiler) {
        return `
            <div class="media-container spoiler-media" onclick="openLightbox('image', '${escapeHtml(media.url)}')" title="Click to expand full-resolution image (Spoiler)">
                <img src="${escapeHtml(optimizedThumb)}" data-full-src="${escapeHtml(media.url)}" class="thread-image" loading="lazy" decoding="async" alt="Post attachment" onerror="if(this.src !== this.dataset.fullSrc){ this.src = this.dataset.fullSrc; } else { this.onerror=null; this.style.display='none'; }">
                ${spoilerOverlay}
            </div>
        `;
    }
    return `
        <img src="${escapeHtml(optimizedThumb)}" data-full-src="${escapeHtml(media.url)}" class="thread-image" loading="lazy" decoding="async" alt="Post attachment" onclick="openLightbox('image', '${escapeHtml(media.url)}')" onerror="if(this.src !== this.dataset.fullSrc){ this.src = this.dataset.fullSrc; } else { this.onerror=null; this.style.display='none'; }" title="Click to expand full-resolution image">
    `;
}

// --- VIEWPORT-AWARE LAZY EMBED HYDRATION (IntersectionObserver + Session Cache) ---
let embedHydrationObserver = null;

function getEmbedObserver() {
    if (embedHydrationObserver || typeof IntersectionObserver === 'undefined') {
        return embedHydrationObserver;
    }
    embedHydrationObserver = new IntersectionObserver((entries, obs) => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const el = entry.target;
            obs.unobserve(el);
            if (el.classList.contains('pixiv-placeholder')) {
                hydrateSinglePixivSlot(el);
            } else if (el.classList.contains('x-placeholder')) {
                hydrateSingleTwitterSlot(el);
            } else if (el.classList.contains('reddit-placeholder')) {
                hydrateSingleRedditSlot(el);
            }
        }
    }, { rootMargin: '350px 0px' });
    return embedHydrationObserver;
}

async function hydrateSinglePixivSlot(placeholder) {
    const id = placeholder.getAttribute('data-pixiv-id');
    if (!id || placeholder.getAttribute('data-hydrated') === 'true') return;
    placeholder.setAttribute('data-hydrated', 'true');

    const applyPixivArt = (art) => {
        const slot = placeholder.querySelector('.pixiv-thumb-slot');
        if (!slot) return;
        const pagesBadge = (art.pageCount && art.pageCount > 1) 
            ? `<div class="pixiv-pages-badge">📚 ${art.pageCount}P</div>` 
            : '';
        if (art.proxyUrl) {
            const badgeText = art.isR18 ? 'pixiv • R-18' : 'pixiv';
            const badgeStyle = art.isR18 ? 'background:rgba(225, 29, 72, 0.95);' : '';
            const helperFallback = `https://pixiv.re/${id}.jpg`;
            slot.innerHTML = `
                <div style="position:relative; width:100%; height:100%; display:flex; align-items:center; justify-content:center;">
                    <img src="${art.proxyUrl}" class="thread-image" loading="lazy" decoding="async" alt="${escapeHtml(art.title)}" onerror="if(this.src!=='${helperFallback}'){this.src='${helperFallback}';}else{this.style.display='none';}" style="max-width:200px; max-height:200px; object-fit:cover; border-radius:4px; display:block;">
                    <div class="pixiv-badge" style="${badgeStyle}">${badgeText}</div>
                    ${pagesBadge}
                </div>
            `;
            placeholder.classList.add('pixiv-thumb-loaded');
        } else {
            slot.innerHTML = `
                <div class="file-ext" style="color:${art.isR18 ? '#e11d48' : '#0096fa'}; font-size:22px; font-weight:900;">${art.isR18 ? 'R-18' : 'pixiv'}</div>
                <div style="font-size:11px; color:#fff; font-weight:bold; margin-top:4px; max-width:140px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(art.title)}</div>
                <div style="font-size:10px; color:#aaa; margin-top:2px;">By ${escapeHtml(art.author)}</div>
                ${pagesBadge}
            `;
        }
        placeholder.title = `${art.isR18 ? '[R-18] ' : ''}${art.title} by ${art.author}${art.pageCount > 1 ? ` (${art.pageCount} images)` : ''} - Click to expand`;
    };

    const cached = getCachedEmbedMeta('pixiv_' + id);
    if (cached) {
        applyPixivArt(cached);
        return;
    }

    try {
        const resp = await fetch(`/api/pixiv/artwork?id=${id}`);
        const data = await resp.json();
        if (data.success && data.artwork) {
            setCachedEmbedMeta('pixiv_' + id, data.artwork);
            applyPixivArt(data.artwork);
        }
    } catch (_) {}
}

async function fetchTweetWithFixTweetFallback(id, handle) {
    const cached = getCachedEmbedMeta('tw_' + id);
    if (cached) return cached;

    try {
        const resp = await fetch(`/api/twitter/tweet?id=${id}&handle=${encodeURIComponent(handle || 'i')}`);
        const data = await resp.json();
        if (data.success && data.tweet) {
            setCachedEmbedMeta('tw_' + id, data.tweet);
            return data.tweet;
        }
    } catch (_) {}

    // Direct client-side FixTweet helper proxy fallback (zero widgets.js bloat)
    try {
        const fxResp = await fetch(`https://api.fxtwitter.com/${encodeURIComponent(handle || 'i')}/status/${id}`);
        if (fxResp.ok) {
            const fxJson = await fxResp.json();
            if (fxJson && fxJson.tweet) {
                const t = fxJson.tweet;
                const photos = t.media?.photos || [];
                const vids = t.media?.videos || [];
                const pages = photos.map((p, idx) => ({
                    pageIndex: idx,
                    displayUrl: p.url,
                    helperUrl: p.url,
                    originalUrl: p.url
                }));
                const mapped = {
                    id,
                    url: t.url || `https://x.com/${t.author?.screen_name || handle}/status/${id}`,
                    text: t.text || '',
                    authorName: t.author?.name || handle,
                    authorHandle: t.author?.screen_name || handle,
                    avatar: t.author?.avatar_url || '',
                    likes: t.likes || 0,
                    retweets: t.retweets || 0,
                    hasMedia: photos.length > 0 || vids.length > 0,
                    mediaType: vids.length > 0 ? 'video' : (photos.length > 0 ? 'image' : 'none'),
                    videoUrl: vids[0]?.url || null,
                    videoThumbnail: vids[0]?.thumbnail_url || photos[0]?.url || null,
                    imageUrl: photos[0]?.url || null,
                    pages,
                    pageCount: pages.length
                };
                setCachedEmbedMeta('tw_' + id, mapped);
                return mapped;
            }
        }
    } catch (_) {}
    return null;
}

async function hydrateSingleTwitterSlot(placeholder) {
    const id = placeholder.getAttribute('data-tweet-id');
    const handle = placeholder.getAttribute('data-tweet-handle') || 'i';
    if (!id || placeholder.getAttribute('data-hydrated') === 'true') return;
    placeholder.setAttribute('data-hydrated', 'true');

    const t = await fetchTweetWithFixTweetFallback(id, handle);
    if (!t) return;

    const slot = placeholder.querySelector('.tweet-thumb-slot');
    if (slot) {
        const rawThumb = t.videoThumbnail || t.imageUrl;
        if (rawThumb) {
            const thumb = getOptimizedThumbUrl(rawThumb, 360);
            const isVideo = t.mediaType === 'video';
            const multiBadge = (t.pageCount && t.pageCount > 1) 
                ? `<div class="pixiv-pages-badge" style="background:rgba(29,161,242,0.95);">📚 ${t.pageCount}P</div>` 
                : '';
            const playOverlay = isVideo 
                ? `<div class="play-overlay" style="position:absolute; width:36px; height:36px; line-height:36px; font-size:18px;">▶</div>` 
                : '';

            slot.innerHTML = `
                <div style="position:relative; width:100%; height:100%; display:flex; align-items:center; justify-content:center; overflow:hidden;">
                    <img src="${escapeHtml(thumb)}" onerror="if(this.src!=='${escapeHtml(rawThumb)}')this.src='${escapeHtml(rawThumb)}';" class="thread-image" loading="lazy" decoding="async" alt="Tweet media" style="max-width:200px; max-height:200px; object-fit:cover; border-radius:4px; display:block;">
                    ${playOverlay}
                    ${multiBadge}
                    <div class="pixiv-badge" style="background:#1DA1F2;">𝕏 @${escapeHtml(t.authorHandle)}</div>
                </div>
            `;
            placeholder.classList.add('x-thumb-loaded');
        } else if (t.text) {
            slot.innerHTML = `
                <div style="padding:8px; display:flex; flex-direction:column; align-items:flex-start; text-align:left; width:100%;">
                    <div style="display:flex; align-items:center; gap:6px; margin-bottom:4px; width:100%;">
                        ${t.avatar ? `<img src="${escapeHtml(t.avatar)}" style="width:18px; height:18px; border-radius:50%; object-fit:cover;">` : '<span style="color:#1DA1F2; font-weight:bold; font-size:12px;">𝕏</span>'}
                        <span style="font-size:11px; font-weight:bold; color:#fff; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">@${escapeHtml(t.authorHandle)}</span>
                    </div>
                    <div style="font-size:10px; color:#ccc; line-height:1.3; max-height:60px; overflow:hidden; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical;">
                        ${escapeHtml(t.text)}
                    </div>
                </div>
            `;
        }
        placeholder.title = `@${t.authorHandle}: "${(t.text || '').slice(0, 100)}..." - Click to open`;
    }
}

async function hydrateSingleRedditSlot(placeholder) {
    const postUrl = placeholder.getAttribute('data-reddit-url');
    if (!postUrl || placeholder.getAttribute('data-hydrated') === 'true') return;
    placeholder.setAttribute('data-hydrated', 'true');

    const applyRedditPost = (p) => {
        const slot = placeholder.querySelector('.reddit-thumb-slot');
        if (!slot) return;
        const rawThumb = p.thumbnailUrl || p.imageUrl || p.videoThumbnail || p.videoUrl;
        if (rawThumb && (p.mediaType === 'image' || p.mediaType === 'video')) {
            const thumb = getOptimizedThumbUrl(rawThumb, 360);
            const isVideo = p.mediaType === 'video';
            const playOverlay = isVideo 
                ? `<div class="play-overlay" style="position:absolute; width:36px; height:36px; line-height:36px; font-size:18px;">▶</div>` 
                : '';
            const multiBadge = (p.pageCount && p.pageCount > 1) 
                ? `<div class="pixiv-pages-badge" style="background:#FF4500;">📚 ${p.pageCount}P</div>` 
                : '';
            const scoreBadge = p.score 
                ? `<div style="position:absolute; top:6px; right:6px; background:rgba(0,0,0,0.75); color:#ff6a33; font-size:10px; font-weight:bold; padding:2px 6px; border-radius:4px; backdrop-filter:blur(2px); z-index:2;">⬆️ ${escapeHtml(p.score)}</div>` 
                : '';

            slot.innerHTML = `
                <div style="position:relative; width:100%; height:100%; display:flex; align-items:center; justify-content:center; overflow:hidden;">
                    <img src="${escapeHtml(thumb)}" onerror="if(this.src!=='${escapeHtml(rawThumb)}')this.src='${escapeHtml(rawThumb)}';" referrerpolicy="no-referrer" class="thread-image" loading="lazy" decoding="async" alt="Reddit media" style="max-width:200px; max-height:200px; object-fit:cover; border-radius:4px; display:block;">
                    ${playOverlay}
                    ${multiBadge}
                    ${scoreBadge}
                    <div class="pixiv-badge" style="background:#FF4500;">r/${escapeHtml(p.subreddit)}</div>
                </div>
            `;
            placeholder.classList.add('reddit-thumb-loaded');
        } else if (p.title) {
            const scoreSnippet = p.score ? `<span style="font-size:10px; color:#ff6a33; font-weight:bold;">⬆️ ${escapeHtml(p.score)}</span>` : '';
            slot.innerHTML = `
                <div style="padding:8px; display:flex; flex-direction:column; align-items:flex-start; text-align:left; width:100%;">
                    <div style="display:flex; align-items:center; justify-content:space-between; width:100%; margin-bottom:4px;">
                        <span style="color:#FF4500; font-weight:bold; font-size:11px;">r/${escapeHtml(p.subreddit)}</span>
                        ${scoreSnippet}
                    </div>
                    <div style="font-size:10px; color:#9ca3af; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; width:100%; margin-bottom:4px;">by ${escapeHtml(p.author)}</div>
                    <div style="font-size:11px; font-weight:bold; color:#fff; line-height:1.3; max-height:60px; overflow:hidden; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical;">
                        ${escapeHtml(p.title)}
                    </div>
                </div>
            `;
        }
        placeholder.title = `r/${p.subreddit}: "${p.title}"${p.pageCount > 1 ? ` (${p.pageCount} images)` : ''}${p.score ? ` (⬆️ ${p.score})` : ''} - Click to open`;
    };

    const cached = getCachedEmbedMeta('rd_' + postUrl);
    if (cached) {
        applyRedditPost(cached);
        return;
    }

    try {
        const resp = await fetch(`/api/reddit/post?url=${encodeURIComponent(postUrl)}`);
        const data = await resp.json();
        if (data.success && data.post) {
            setCachedEmbedMeta('rd_' + postUrl, data.post);
            applyRedditPost(data.post);
        }
    } catch (_) {}
}

function hydratePixivEmbeds() {
    const slots = document.querySelectorAll('.pixiv-placeholder[data-pixiv-id]:not([data-hydrated="true"])');
    if (!slots || slots.length === 0) return;
    const obs = getEmbedObserver();
    for (const placeholder of slots) {
        if (obs) obs.observe(placeholder);
        else hydrateSinglePixivSlot(placeholder);
    }
}

function hydrateTwitterEmbeds() {
    const slots = document.querySelectorAll('.x-placeholder[data-tweet-id]:not([data-hydrated="true"])');
    if (!slots || slots.length === 0) return;
    const obs = getEmbedObserver();
    for (const placeholder of slots) {
        if (obs) obs.observe(placeholder);
        else hydrateSingleTwitterSlot(placeholder);
    }
}

function hydrateRedditEmbeds() {
    const slots = document.querySelectorAll('.reddit-placeholder[data-reddit-url]:not([data-hydrated="true"])');
    if (!slots || slots.length === 0) return;
    const obs = getEmbedObserver();
    for (const placeholder of slots) {
        if (obs) obs.observe(placeholder);
        else hydrateSingleRedditSlot(placeholder);
    }
}

// --- CLIENT-SIDE MEDIA VALIDATION ---
async function validateMediaUrl(url) {
    if (!url || !url.trim()) return { valid: true };
    const media = getMediaType(url);
    if (!media) return { valid: true };
    
    // Video, Audio, YouTube, Twitter, Reddit, Pixiv are accepted directly without blocking image pre-loading
    if (['video', 'audio', 'youtube', 'x', 'reddit', 'reddit_video', 'pixiv', 'pixiv_image'].includes(media.type)) {
        return { valid: true, type: media.type };
    }

    // Pixiv Artwork validation: Query resolver endpoint
    if (media.type === 'pixiv') {
        try {
            const resp = await fetch(`/api/pixiv/artwork?id=${media.id}`);
            const data = await resp.json();
            if (data.success && data.artwork) {
                return { valid: true, type: 'pixiv', artwork: data.artwork };
            }
            return { valid: false, error: data.error || "Pixiv artwork not found or is set to private." };
        } catch (err) {
            // Allow through if network check times out
            return { valid: true, type: 'pixiv' };
        }
    }

    // Pixiv Direct Image (i.pximg.net): Test via reverse proxy to avoid 403 Forbidden
    const testUrl = (media.type === 'pixiv_image' && media.proxyUrl) ? media.proxyUrl : media.url;

    // Trusted direct upload hosts already verified by /api/upload
    if (/^https:\/\/(?:files\.catbox\.moe|i\.ibb\.co)\//i.test(testUrl)) {
        return { valid: true, type: media.type };
    }

    return new Promise((resolve) => {
        const img = new Image();
        img.referrerPolicy = 'no-referrer';
        let finished = false;
        let triedProxy = false;
        img.onload = () => {
            if (!finished) {
                finished = true;
                resolve({ valid: true, type: media.type });
            }
        };
        img.onerror = () => {
            if (!triedProxy && !testUrl.startsWith('/') && !testUrl.includes('wsrv.nl')) {
                triedProxy = true;
                img.src = `https://wsrv.nl/?url=${encodeURIComponent(testUrl)}&w=360`;
                return;
            }
            if (!finished) {
                finished = true;
                resolve({ valid: false, error: "Image failed to load. Check that the URL is public and direct." });
            }
        };
        img.src = testUrl;

        // 4-second timeout guard
        setTimeout(() => {
            if (!finished) {
                finished = true;
                // Allow through on slow networks rather than blocking the post
                resolve({ valid: true, type: media.type });
            }
        }, 4000);
    });
}

// --- UNIFIED MULTI-PAGE GALLERY CAROUSEL CONTROLLER ---
// Supports Pixiv, Twitter/X, and Reddit multi-image galleries with ◀ ▶ buttons and keyboard navigation
let currentGallery = {
    platform: 'pixiv', // 'pixiv' | 'x' | 'reddit'
    pages: [],
    currentIndex: 0,
    title: '',
    author: '',
    postUrl: '',
    artworkUrl: '',
    isR18: false,
    themeColor: '#0096fa',
    viewLinkText: 'View on Pixiv ↗'
};

// Backwards-compatible alias for existing callers
let currentPixivGallery = currentGallery;

function renderGalleryCarouselModal() {
    const custom = document.getElementById('lbCustom');
    if (!custom) return;

    const { pages, currentIndex, title, author, postUrl, artworkUrl, isR18, platform, themeColor, viewLinkText } = currentGallery;
    const targetUrl = postUrl || artworkUrl || '';
    const pageCount = pages ? pages.length : 0;
    const cur = (pages && pages[currentIndex]) ? pages[currentIndex] : (pages ? pages[0] : null);
    const isReddit = platform === 'reddit';
    const isX = platform === 'x';
    const isPixiv = platform === 'pixiv';
    const activeColor = isR18 ? '#e11d48' : (themeColor || (isReddit ? '#FF4500' : (isX ? '#1DA1F2' : '#0096fa')));
    const hasMultiple = pageCount > 1;

    const helperFallback = cur ? (cur.helperUrl || cur.displayUrl) : '';
    const displaySrc = cur ? cur.displayUrl : '';
    const r18Tag = isR18 ? '<span style="background:#e11d48; color:#fff; font-size:0.75em; padding:2px 6px; border-radius:4px; font-weight:bold; margin-right:6px;">R-18</span>' : '';
    const defaultBtnText = isReddit ? 'View on Reddit ↗' : (isX ? 'View on 𝕏 ↗' : 'View on Pixiv ↗');
    const buttonText = viewLinkText || defaultBtnText;

    custom.innerHTML = `
        <div style="background:#111827; color:#fff; border-radius:12px; padding:16px 20px; text-align:center; max-width:min(94vw, 920px); max-height:90vh; display:flex; flex-direction:column; align-items:center; border:2px solid ${activeColor}; box-shadow:0 8px 36px rgba(0,0,0,0.95); overflow:hidden; position:relative;">
            <!-- Header bar -->
            <div style="display:flex; justify-content:space-between; align-items:center; width:100%; margin-bottom:10px; border-bottom:1px solid rgba(255,255,255,0.12); padding-bottom:8px; gap:12px;">
                <div style="text-align:left; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1;">
                    <div style="font-weight:bold; font-size:1.1em; color:#fff; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${r18Tag}${escapeHtml(title)}</div>
                    <div style="font-size:0.85em; color:#9ca3af; margin-top:2px;">
                        ${isReddit ? `<b style="color:#FF4500;">${escapeHtml(author)}</b>` : (isX ? `<b>${escapeHtml(author)}</b>` : `By <b>${escapeHtml(author)}</b>`)}
                        ${hasMultiple ? ` • <span style="color:${activeColor}; font-weight:bold;">Page ${currentIndex + 1} of ${pageCount}</span>` : ''}
                    </div>
                </div>
                <div style="display:flex; align-items:center; gap:8px;">
                    ${hasMultiple ? `<span style="font-size:0.75em; color:#aaa; display:inline-block;" class="carousel-hint">Use ◀ ▶ or Arrow keys</span>` : ''}
                    ${targetUrl ? `
                        <a href="${escapeHtml(targetUrl)}" target="_blank" rel="noopener noreferrer" style="background:${activeColor}; color:#fff; font-weight:bold; font-size:0.85em; padding:6px 14px; border-radius:6px; text-decoration:none; white-space:nowrap; transition:opacity 0.15s ease;" onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">
                            ${escapeHtml(buttonText)}
                        </a>
                    ` : ''}
                </div>
            </div>

            <!-- Image viewport with carousel arrows -->
            <div style="position:relative; width:100%; max-height:calc(85vh - 125px); min-height:220px; display:flex; justify-content:center; align-items:center; overflow:hidden;">
                ${hasMultiple ? `
                    <button type="button" class="pixiv-carousel-btn" style="position:absolute; left:8px; z-index:10; background:rgba(0,0,0,0.65);" onclick="navigateGalleryPage(-1)" ${currentIndex === 0 ? 'disabled' : ''} title="Previous page (Left arrow)">
                        ◀
                    </button>
                ` : ''}

                <div style="width:100%; height:100%; display:flex; justify-content:center; align-items:center;">
                    <img id="galleryCarouselImg" src="${displaySrc}" referrerpolicy="no-referrer" style="max-width:100%; max-height:calc(85vh - 130px); object-fit:contain; border-radius:6px; box-shadow:0 4px 20px rgba(0,0,0,0.6); user-select:none; cursor:pointer;" alt="${escapeHtml(title)} - Page ${currentIndex + 1}" title="Click to view full image in lightbox" onclick="openLightbox('image', '${escapeHtml(displaySrc)}')" onerror="if(this.dataset.triedHelper!=='true' && '${helperFallback}' && this.src !== '${helperFallback}'){this.dataset.triedHelper='true';this.src='${helperFallback}';}else{this.parentElement.innerHTML='<div style=\\'padding:30px; color:#aaa;\\'>Image failed to load. ${targetUrl ? `<a href=\\'${escapeHtml(targetUrl)}\\' target=\\'_blank\\' style=\\'color:${activeColor};\\'>Open on ${isReddit ? 'Reddit' : (isX ? '𝕏' : 'Pixiv')} ↗</a>` : ''}</div>';}">
                </div>

                ${hasMultiple ? `
                    <button type="button" class="pixiv-carousel-btn" style="position:absolute; right:8px; z-index:10; background:rgba(0,0,0,0.65);" onclick="navigateGalleryPage(1)" ${currentIndex >= pageCount - 1 ? 'disabled' : ''} title="Next page (Right arrow)">
                        ▶
                    </button>
                ` : ''}
            </div>

            <!-- Page indicator pills for multi-page illustrations/galleries -->
            ${hasMultiple ? `
                <div style="display:flex; justify-content:center; align-items:center; gap:6px; margin-top:10px; max-width:100%; overflow-x:auto; padding:4px 0;">
                    ${pages.map((p, idx) => `
                        <button type="button" onclick="setGalleryPage(${idx})" style="border:none; cursor:pointer; width:${idx === currentIndex ? '22px' : '10px'}; height:8px; border-radius:4px; background:${idx === currentIndex ? activeColor : 'rgba(255,255,255,0.3)'}; transition:all 0.2s ease;" title="Page ${idx + 1}"></button>
                    `).join('')}
                </div>
            ` : ''}
        </div>
    `;
}

function navigateGalleryPage(dir) {
    const gallery = currentGallery || currentPixivGallery;
    if (!gallery || !gallery.pages || !gallery.pages.length) return;
    const newIdx = gallery.currentIndex + dir;
    if (newIdx >= 0 && newIdx < gallery.pages.length) {
        gallery.currentIndex = newIdx;
        currentGallery = gallery;
        currentPixivGallery = gallery;
        renderGalleryCarouselModal();
    }
}

function setGalleryPage(idx) {
    const gallery = currentGallery || currentPixivGallery;
    if (!gallery || !gallery.pages || !gallery.pages.length) return;
    if (idx >= 0 && idx < gallery.pages.length) {
        gallery.currentIndex = idx;
        currentGallery = gallery;
        currentPixivGallery = gallery;
        renderGalleryCarouselModal();
    }
}

// Backwards-compatible aliases
function renderPixivCarouselModal() {
    renderGalleryCarouselModal();
}
function navigatePixivPage(dir) {
    navigateGalleryPage(dir);
}
function setPixivPage(idx) {
    setGalleryPage(idx);
}

// Arrow key navigation listener for Lightbox (Pixiv, Twitter/X, and Reddit carousels)
if (typeof window !== 'undefined') {
    window.addEventListener('keydown', (e) => {
        const lb = document.getElementById('lightbox');
        if (!lb || lb.style.display !== 'flex') return;

        // If gallery carousel is active and has multiple pages
        const gallery = currentGallery || currentPixivGallery;
        if (gallery && gallery.pages && gallery.pages.length > 1) {
            if (e.key === 'ArrowLeft' || e.key === 'Left') {
                e.preventDefault();
                navigateGalleryPage(-1);
                return;
            }
            if (e.key === 'ArrowRight' || e.key === 'Right') {
                e.preventDefault();
                navigateGalleryPage(1);
                return;
            }
        }
    });
}
function openLightbox(type, content, extra1, extra2, extra3) {
    const lb = document.getElementById('lightbox');
    if (!lb) return;

    const img = document.getElementById('lbImg');
    const vid = document.getElementById('lbVideo');
    const frame = document.getElementById('lbFrame');
    const custom = document.getElementById('lbCustom');

    // Reset all display states and media sources cleanly
    if (img) { 
        img.style.display = 'none'; 
        img.removeAttribute('src'); 
    }
    if (vid) { 
        vid.style.display = 'none'; 
        vid.pause(); 
        vid.removeAttribute('src'); 
        vid.load();
    }
    if (custom) { 
        custom.style.display = 'none'; 
        custom.innerHTML = ""; 
    }
    if (frame) { 
        frame.style.display = 'none'; 
        frame.removeAttribute('src'); 
        frame.style.width = "800px"; 
        frame.style.height = "450px"; 
    }

    // Determine current theme: Night mode (P5) vs Standard (P3R)
    const isNight = typeof currentBoard !== 'undefined' && typeof BOARDS !== 'undefined' && BOARDS[currentBoard] && BOARDS[currentBoard].type === 'nsfw';
    const theme = isNight ? 'dark' : 'light';

    // Auto-detect Pixiv artwork ID and page index if clicking a direct Pixiv image (i.pximg.net or pixiv.re)
    if (type === 'pixiv_image') {
        const fullTarget = `${extra1 || ''} ${content || ''}`;
        const pxMatch = fullTarget.match(/(\d+)_p(\d+)/i) || fullTarget.match(/pixiv\.re\/(\d+)(?:-(\d+))?/i);
        if (pxMatch && pxMatch[1]) {
            type = 'pixiv';
            content = pxMatch[1];
            // If from pixiv.re/id-N.jpg, index is N-1; if from id_pN, index is N
            const isSuffix = fullTarget.includes('pixiv.re') && !fullTarget.includes('_p');
            extra1 = pxMatch[2] ? (parseInt(pxMatch[2], 10) - (isSuffix ? 1 : 0)) : 0;
        }
    }

    if (type === 'image' && img) {
        img.src = content;
        img.style.display = 'block';
    } 
    else if (type === 'pixiv_image' && img) {
        // Fallback for direct images where no illustration ID was detected
        img.src = content;
        img.style.display = 'block';
    }
    else if ((type === 'video' || type === 'audio') && vid) {
        vid.src = content;
        vid.style.display = 'block';
        vid.play().catch(() => {});
    } 
    else if (type === 'youtube' && frame) {
        frame.src = `https://www.youtube-nocookie.com/embed/${content}?autoplay=1&rel=0`;
        frame.style.display = 'block';
    } 
    else if (type === 'x') {
        const tweetId = content;
        const handle = extra1 || 'i';

        if (custom) {
            custom.innerHTML = `
                <div style="background:#111827; color:#fff; border-radius:12px; padding:24px 20px; text-align:center; min-width:280px; max-width:600px; border:2px solid #1DA1F2; box-shadow:0 8px 30px rgba(0,0,0,0.85);">
                    <div style="font-size:1.1em; color:#1DA1F2; font-weight:bold; margin-bottom:8px;">𝕏 Loading Tweet...</div>
                    <div style="font-size:0.85em; opacity:0.7;">Fetching tweet media and contents via FixTweet proxy...</div>
                </div>
            `;
            custom.style.display = 'block';
        }

        fetchTweetWithFixTweetFallback(tweetId, handle)
            .then(t => {
                if (t) {

                    // 1. If it has a video: play native HTML5 video with controls and audio!
                    if (t.mediaType === 'video' && t.videoUrl) {
                        if (custom) custom.style.display = 'none';
                        if (vid) {
                            const streamUrl = `/api/proxy/video?url=${encodeURIComponent(t.videoUrl)}`;
                            vid.referrerPolicy = "no-referrer";
                            vid.style.display = 'block';
                            vid.controls = true;
                            vid.src = streamUrl;
                            vid.load();
                            vid.play().catch(() => {});
                        }
                        return;
                    }

                    // 2. If it has multiple images: open in multi-page carousel with ◀ ▶ keys!
                    if (t.pages && t.pages.length > 1) {
                        currentGallery = {
                            platform: 'x',
                            pages: t.pages,
                            currentIndex: 0,
                            title: t.text.slice(0, 80) || `Tweet by @${t.authorHandle}`,
                            author: `${t.authorName} (@${t.authorHandle})`,
                            postUrl: t.url,
                            artworkUrl: t.url,
                            isR18: false,
                            themeColor: '#1DA1F2',
                            viewLinkText: 'View on 𝕏 ↗'
                        };
                        currentPixivGallery = currentGallery;
                        renderGalleryCarouselModal();
                        return;
                    }

                    // 3. If single image: open directly in lightbox
                    if (t.imageUrl) {
                        if (custom) custom.style.display = 'none';
                        if (img) {
                            img.src = t.imageUrl;
                            img.style.display = 'block';
                        }
                        return;
                    }

                    // 4. If text-only tweet: show clean, high-fidelity dark-mode card
                    if (custom) {
                        custom.innerHTML = `
                            <div style="background:#111827; color:#fff; border-radius:12px; padding:20px 24px; text-align:left; max-width:min(90vw, 550px); border:1.5px solid #1DA1F2; box-shadow:0 8px 36px rgba(0,0,0,0.9);">
                                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:8px; gap:10px;">
                                    <div style="display:flex; align-items:center; gap:10px;">
                                        ${t.avatar ? `<img src="${escapeHtml(t.avatar)}" style="width:38px; height:38px; border-radius:50%; object-fit:cover;">` : '<span style="font-size:24px; color:#1DA1F2;">𝕏</span>'}
                                        <div>
                                            <div style="font-weight:bold; font-size:15px; color:#fff;">${escapeHtml(t.authorName)}</div>
                                            <div style="font-size:12px; color:#9ca3af;">@${escapeHtml(t.authorHandle)}</div>
                                        </div>
                                    </div>
                                    <a href="${escapeHtml(t.url)}" target="_blank" rel="noopener noreferrer" style="background:#1DA1F2; color:#fff; font-size:12px; font-weight:bold; padding:5px 12px; border-radius:6px; text-decoration:none; white-space:nowrap;">View on 𝕏 ↗</a>
                                </div>
                                <div style="font-size:15px; line-height:1.5; color:#f3f4f6; margin-bottom:12px; white-space:pre-wrap;">${escapeHtml(t.text)}</div>
                                ${t.likes || t.retweets ? `
                                    <div style="font-size:12px; color:#9ca3af; border-top:1px solid rgba(255,255,255,0.08); padding-top:8px; display:flex; gap:14px;">
                                        ${t.likes ? `<span>❤️ ${t.likes.toLocaleString()}</span>` : ''}
                                        ${t.retweets ? `<span>🔁 ${t.retweets.toLocaleString()}</span>` : ''}
                                    </div>
                                ` : ''}
                            </div>
                        `;
                        custom.style.display = 'block';
                        return;
                    }
                }

                // Fallback to official iframe embed
                if (frame) {
                    if (custom) custom.style.display = 'none';
                    frame.src = `https://platform.twitter.com/embed/Tweet.html?id=${tweetId}&theme=${theme}`;
                    frame.style.display = 'block';
                    frame.style.width = "550px";
                    frame.style.height = "520px";
                }
            })
            .catch(() => {
                if (frame) {
                    if (custom) custom.style.display = 'none';
                    frame.src = `https://platform.twitter.com/embed/Tweet.html?id=${tweetId}&theme=${theme}`;
                    frame.style.display = 'block';
                    frame.style.width = "550px";
                    frame.style.height = "520px";
                }
            });
    }
    else if (type === 'pixiv' && custom) {
        const artworkId = content;
        const initialPageIndex = Math.max(0, parseInt(extra1, 10) || 0);

        custom.innerHTML = `
            <div style="background:#1a1a1b; color:#fff; border-radius:12px; padding:24px 20px; text-align:center; min-width:280px; max-width:800px; border:2px solid #0096fa; box-shadow:0 8px 30px rgba(0,0,0,0.85);">
                <div style="font-size:1.1em; color:#0096fa; font-weight:bold; margin-bottom:8px;">🎨 Loading Pixiv Artwork #${artworkId}...</div>
                <div style="font-size:0.85em; opacity:0.7;">Fetching artwork details and media pages...</div>
            </div>
        `;
        custom.style.display = 'block';

        fetch(`/api/pixiv/artwork?id=${artworkId}`)
            .then(r => r.json())
            .then(data => {
                if (data.success && data.artwork) {
                    const art = data.artwork;
                    const pages = (art.pages && art.pages.length > 0) ? art.pages : [{
                        pageIndex: 0,
                        displayUrl: art.proxyUrl || `https://pixiv.re/${artworkId}.jpg`,
                        helperUrl: `https://pixiv.re/${artworkId}.jpg`,
                        originalUrl: art.imageUrl
                    }];

                    currentGallery = {
                        platform: 'pixiv',
                        pages,
                        currentIndex: (initialPageIndex >= 0 && initialPageIndex < pages.length) ? initialPageIndex : 0,
                        title: art.title || `Artwork #${artworkId}`,
                        author: art.author || 'Artist',
                        postUrl: art.artworkUrl || `https://www.pixiv.net/artworks/${artworkId}`,
                        artworkUrl: art.artworkUrl || `https://www.pixiv.net/artworks/${artworkId}`,
                        isR18: !!art.isR18,
                        themeColor: '#0096fa',
                        viewLinkText: 'View on Pixiv ↗'
                    };
                    currentPixivGallery = currentGallery;
                    renderGalleryCarouselModal();

                    // If server only returned 1 page, actively probe for additional pages via helper
                    if (pages.length === 1) {
                        const probeNextPage = (p) => {
                            const testImg = new Image();
                            testImg.onload = () => {
                                if (!currentPixivGallery || !currentPixivGallery.artworkUrl.includes(artworkId)) return;
                                const exists = currentPixivGallery.pages.some(pg => pg.pageIndex === p - 1);
                                if (!exists) {
                                    currentPixivGallery.pages.push({
                                        pageIndex: p - 1,
                                        displayUrl: `https://pixiv.re/${artworkId}-${p}.jpg`,
                                        helperUrl: `https://pixiv.re/${artworkId}-${p}.jpg`,
                                        originalUrl: `https://pixiv.re/${artworkId}-${p}.jpg`
                                    });
                                    renderPixivCarouselModal();
                                    if (p < 25) probeNextPage(p + 1);
                                }
                            };
                            testImg.src = `https://pixiv.re/${artworkId}-${p}.jpg`;
                        };
                        probeNextPage(2);
                    }
                } else {
                    // Fallback: check if page 2 exists via community helper to enable carousel even on API fallback
                    const fallbackPages = [{
                        pageIndex: 0,
                        displayUrl: `https://pixiv.re/${artworkId}.jpg`,
                        helperUrl: `https://pixiv.re/${artworkId}.jpg`,
                        originalUrl: `https://pixiv.re/${artworkId}.jpg`
                    }];

                    // Optimistically probe for multi-page illustrations
                    const testImg2 = new Image();
                    testImg2.onload = () => {
                        if (currentPixivGallery && currentPixivGallery.artworkUrl.includes(artworkId)) {
                            currentPixivGallery.pages.push({
                                pageIndex: 1,
                                displayUrl: `https://pixiv.re/${artworkId}-2.jpg`,
                                helperUrl: `https://pixiv.re/${artworkId}-2.jpg`,
                                originalUrl: `https://pixiv.re/${artworkId}-2.jpg`
                            });
                            renderPixivCarouselModal();
                        }
                    };
                    testImg2.src = `https://pixiv.re/${artworkId}-2.jpg`;

                    currentPixivGallery = {
                        pages: fallbackPages,
                        currentIndex: 0,
                        title: `Pixiv Artwork #${artworkId}`,
                        author: 'Pixiv Artist',
                        artworkUrl: `https://www.pixiv.net/artworks/${artworkId}`,
                        isR18: false
                    };
                    renderPixivCarouselModal();
                }
            })
            .catch(() => {
                const fallbackPages = [{
                    pageIndex: 0,
                    displayUrl: `https://pixiv.re/${artworkId}.jpg`,
                    helperUrl: `https://pixiv.re/${artworkId}.jpg`,
                    originalUrl: `https://pixiv.re/${artworkId}.jpg`
                }];

                const testImg2 = new Image();
                testImg2.onload = () => {
                    if (currentPixivGallery && currentPixivGallery.artworkUrl.includes(artworkId)) {
                        currentPixivGallery.pages.push({
                            pageIndex: 1,
                            displayUrl: `https://pixiv.re/${artworkId}-2.jpg`,
                            helperUrl: `https://pixiv.re/${artworkId}-2.jpg`,
                            originalUrl: `https://pixiv.re/${artworkId}-2.jpg`
                        });
                        renderPixivCarouselModal();
                    }
                };
                testImg2.src = `https://pixiv.re/${artworkId}-2.jpg`;

                currentPixivGallery = {
                    pages: fallbackPages,
                    currentIndex: 0,
                    title: `Pixiv Artwork #${artworkId}`,
                    author: 'Pixiv Artist',
                    artworkUrl: `https://www.pixiv.net/artworks/${artworkId}`,
                    isR18: false
                };
                renderPixivCarouselModal();
            });
    }
    else if (type === 'reddit') {
        const postUrl = content;
        const subreddit = extra1 || 'reddit';
        const postId = extra2 || '';
        const isShare = typeof extra3 !== 'undefined' && Boolean(extra3);
        const vxUrl = getVxRedditUrl(postUrl);

        if (custom) {
            custom.innerHTML = `
                <div style="background:#1a1a1b; color:#fff; border-radius:12px; padding:24px 20px; text-align:center; min-width:280px; max-width:600px; border:2px solid #FF4500; box-shadow:0 8px 30px rgba(0,0,0,0.85);">
                    <div style="font-size:1.1em; color:#FF4500; font-weight:bold; margin-bottom:8px;">Reddit Loading Post...</div>
                    <div style="font-size:0.85em; opacity:0.75;">Fetching post details and media via vxreddit...</div>
                </div>
            `;
            custom.style.display = 'block';
        }

        fetch(`/api/reddit/post?url=${encodeURIComponent(postUrl)}`)
            .then(r => r.json())
            .then(data => {
                if (data.success && data.post) {
                    const p = data.post;
                    const displaySub = p.subreddit || subreddit;
                    const targetVxUrl = p.vxUrl || vxUrl;

                    // 1. Direct Video Post: Stream immediately through proxy in HTML5 native player with controls & audio
                    if (p.mediaType === 'video' && p.videoUrl) {
                        const streamUrl = `/api/proxy/video?url=${encodeURIComponent(p.videoUrl)}`;
                        if (custom) {
                            custom.innerHTML = `
                                <div style="background:#1a1a1b; color:#fff; border-radius:12px; padding:18px 20px; text-align:left; max-width:min(92vw, 760px); border:2px solid #FF4500; box-shadow:0 8px 36px rgba(0,0,0,0.95);">
                                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:8px; gap:10px; flex-wrap:wrap;">
                                        <div>
                                            <div style="font-weight:bold; font-size:15px; color:#FF4500;">r/${escapeHtml(displaySub)}</div>
                                            <div style="font-size:12px; color:#9ca3af;">Posted by ${escapeHtml(p.author)}${p.score ? ` • ⬆️ ${escapeHtml(p.score)}` : ''}${p.comments ? ` • 💬 ${escapeHtml(p.comments)}` : ''}</div>
                                        </div>
                                        <div style="display:flex; gap:8px;">
                                            <a href="${escapeHtml(targetVxUrl)}" target="_blank" rel="noopener noreferrer" style="background:rgba(255,69,0,0.2); border:1px solid #FF4500; color:#FF4500; font-size:12px; font-weight:bold; padding:5px 10px; border-radius:6px; text-decoration:none; white-space:nowrap;" title="Open with vxReddit proxy helper">vxReddit ↗</a>
                                            <a href="${escapeHtml(p.url)}" target="_blank" rel="noopener noreferrer" style="background:#FF4500; color:#fff; font-size:12px; font-weight:bold; padding:5px 12px; border-radius:6px; text-decoration:none; white-space:nowrap;">View on Reddit ↗</a>
                                        </div>
                                    </div>
                                    <div style="font-size:15px; font-weight:bold; line-height:1.4; color:#f3f4f6; margin-bottom:12px;">
                                        ${escapeHtml(p.title)}
                                    </div>
                                    <div style="position:relative; width:100%; border-radius:8px; overflow:hidden; background:#000; margin-bottom:12px;">
                                        <video src="${escapeHtml(streamUrl)}" controls autoplay playsinline style="width:100%; max-height:min(70vh, 520px); display:block; object-fit:contain; border-radius:8px; outline:none;"></video>
                                    </div>
                                    ${p.description ? `
                                        <div style="font-size:13px; line-height:1.45; color:#d1d5db; margin-bottom:12px; white-space:pre-wrap; max-height:120px; overflow-y:auto; padding:8px 12px; background:rgba(255,255,255,0.04); border-radius:6px;">
                                            ${escapeHtml(p.description)}
                                        </div>
                                    ` : ''}
                                </div>
                            `;
                            custom.style.display = 'block';
                        }
                        return;
                    }

                    // 2. Multi-image Gallery: Open in interactive carousel with ◀ ▶ buttons and keyboard arrow keys!
                    if (p.pages && p.pages.length > 1) {
                        currentGallery = {
                            platform: 'reddit',
                            pages: p.pages,
                            currentIndex: 0,
                            title: p.title || `Post on r/${p.subreddit}`,
                            author: `r/${p.subreddit} • Posted by ${p.author}`,
                            postUrl: p.url,
                            artworkUrl: p.url,
                            isR18: false,
                            themeColor: '#FF4500',
                            viewLinkText: 'View on Reddit ↗'
                        };
                        currentPixivGallery = currentGallery;
                        renderGalleryCarouselModal();
                        return;
                    }

                    // 3. Rich Card with Image or Text Discussion
                    if (custom) {
                        custom.innerHTML = `
                            <div style="background:#1a1a1b; color:#fff; border-radius:12px; padding:20px 24px; text-align:left; max-width:min(92vw, 680px); border:2px solid #FF4500; box-shadow:0 8px 36px rgba(0,0,0,0.95);">
                                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:8px; gap:10px; flex-wrap:wrap;">
                                    <div>
                                        <div style="font-weight:bold; font-size:15px; color:#FF4500;">r/${escapeHtml(displaySub)}</div>
                                        <div style="font-size:12px; color:#9ca3af;">Posted by ${escapeHtml(p.author)}${p.score ? ` • ⬆️ ${escapeHtml(p.score)}` : ''}${p.comments ? ` • 💬 ${escapeHtml(p.comments)}` : ''}</div>
                                    </div>
                                    <div style="display:flex; gap:8px;">
                                        <a href="${escapeHtml(targetVxUrl)}" target="_blank" rel="noopener noreferrer" style="background:rgba(255,69,0,0.2); border:1px solid #FF4500; color:#FF4500; font-size:12px; font-weight:bold; padding:5px 10px; border-radius:6px; text-decoration:none; white-space:nowrap;" title="Open with vxReddit proxy helper">vxReddit ↗</a>
                                        <a href="${escapeHtml(p.url)}" target="_blank" rel="noopener noreferrer" style="background:#FF4500; color:#fff; font-size:12px; font-weight:bold; padding:5px 12px; border-radius:6px; text-decoration:none; white-space:nowrap;">View on Reddit ↗</a>
                                    </div>
                                </div>
                                <div style="font-size:16px; font-weight:bold; line-height:1.4; color:#f3f4f6; margin-bottom:14px;">
                                    ${escapeHtml(p.title)}
                                </div>
                                ${p.imageUrl ? `
                                    <div style="text-align:center; margin-bottom:14px;">
                                        <img src="${escapeHtml(p.imageUrl)}" referrerpolicy="no-referrer" onclick="openLightbox('image', '${escapeHtml(p.imageUrl)}')" style="max-width:100%; max-height:500px; border-radius:8px; object-fit:contain; cursor:pointer; box-shadow:0 4px 16px rgba(0,0,0,0.5);" title="Click to view full image">
                                        <div style="font-size:11px; color:#ff8c5a; margin-top:4px;">🔍 Click image to expand</div>
                                    </div>
                                ` : ''}
                                ${p.description ? `
                                    <div style="font-size:13px; line-height:1.45; color:#d1d5db; margin-bottom:14px; white-space:pre-wrap; max-height:160px; overflow-y:auto; padding:8px 12px; background:rgba(255,255,255,0.04); border-radius:6px;">
                                        ${escapeHtml(p.description)}
                                    </div>
                                ` : ''}
                                <div style="text-align:center; margin-top:8px;">
                                    <a href="${escapeHtml(p.url)}" target="_blank" rel="noopener noreferrer" style="display:inline-block; background:rgba(255,69,0,0.15); border:1px solid #FF4500; color:#FF4500; font-weight:bold; font-size:13px; padding:8px 20px; border-radius:6px; text-decoration:none;">
                                        Open Full Post &amp; Comments on Reddit ↗
                                    </a>
                                </div>
                            </div>
                        `;
                        custom.style.display = 'block';
                        return;
                    }
                }

                // Fallback card with direct Reddit and vxReddit links
                if (custom) {
                    custom.innerHTML = `
                        <div style="background:#1a1a1b; color:#fff; border-radius:12px; padding:28px 24px; text-align:center; max-width:440px; border:2px solid #FF4500; box-shadow:0 8px 30px rgba(0,0,0,0.85);">
                            <div style="font-size:1.8rem; margin-bottom:8px;">Reddit</div>
                            <div style="font-size:1.1em; font-weight:bold; color:#fff; margin-bottom:6px;">r/${escapeHtml(subreddit)}</div>
                            <div style="font-size:0.9em; color:#bbb; margin-bottom:18px;">Click below to open the post directly or via vxReddit helper:</div>
                            <div style="display:flex; justify-content:center; gap:10px; flex-wrap:wrap;">
                                <a href="${escapeHtml(vxUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline-block; background:rgba(255,69,0,0.2); border:1px solid #FF4500; color:#FF4500; font-weight:bold; font-size:0.95em; padding:9px 18px; border-radius:8px; text-decoration:none;">
                                    Open via vxReddit ↗
                                </a>
                                <a href="${escapeHtml(postUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline-block; background:#FF4500; color:#fff; font-weight:bold; font-size:0.95em; padding:9px 18px; border-radius:8px; text-decoration:none;">
                                    View on Reddit ↗
                                </a>
                            </div>
                        </div>
                    `;
                    custom.style.display = 'block';
                }
            })
            .catch(() => {
                if (custom) {
                    custom.innerHTML = `
                        <div style="background:#1a1a1b; color:#fff; border-radius:12px; padding:28px 24px; text-align:center; max-width:440px; border:2px solid #FF4500; box-shadow:0 8px 30px rgba(0,0,0,0.85);">
                            <div style="font-size:1.8rem; margin-bottom:8px;">Reddit</div>
                            <div style="font-size:1.1em; font-weight:bold; color:#fff; margin-bottom:6px;">r/${escapeHtml(subreddit)}</div>
                            <div style="font-size:0.9em; color:#bbb; margin-bottom:18px;">Could not load preview. Open directly:</div>
                            <div style="display:flex; justify-content:center; gap:10px; flex-wrap:wrap;">
                                <a href="${escapeHtml(vxUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline-block; background:rgba(255,69,0,0.2); border:1px solid #FF4500; color:#FF4500; font-weight:bold; font-size:0.95em; padding:9px 18px; border-radius:8px; text-decoration:none;">
                                    Open via vxReddit ↗
                                </a>
                                <a href="${escapeHtml(postUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline-block; background:#FF4500; color:#fff; font-weight:bold; font-size:0.95em; padding:9px 18px; border-radius:8px; text-decoration:none;">
                                    View on Reddit ↗
                                </a>
                            </div>
                        </div>
                    `;
                    custom.style.display = 'block';
                }
            });
    }
    else if (type === 'reddit_video') {
        const videoId = content;
        const targetUrl = `https://v.redd.it/${videoId}`;
        const vxUrl = `https://vxreddit.com/comments/${videoId}`;
        const directMergedVid = `https://vxreddit.com/redditvideo.mp4?video_url=${encodeURIComponent('https://v.redd.it/' + videoId + '/CMAF_720.m3u8')}&audio_url=${encodeURIComponent('https://v.redd.it/' + videoId + '/CMAF_AUDIO_128.m3u8')}`;

        if (custom) {
            custom.innerHTML = `
                <div style="background:#1a1a1b; color:#fff; border-radius:12px; padding:24px 20px; text-align:center; min-width:280px; max-width:600px; border:2px solid #FF4500; box-shadow:0 8px 30px rgba(0,0,0,0.85);">
                    <div style="font-size:1.1em; color:#FF4500; font-weight:bold; margin-bottom:8px;">Reddit Loading Video via vxreddit...</div>
                    <div style="font-size:0.85em; opacity:0.75;">Fetching combined audio+video stream...</div>
                </div>
            `;
            custom.style.display = 'block';
        }

        fetch(`/api/reddit/post?url=${encodeURIComponent(targetUrl)}`)
            .then(r => r.json())
            .then(data => {
                const vidUrl = (data.success && data.post && data.post.videoUrl) ? data.post.videoUrl : directMergedVid;
                const streamUrl = `/api/proxy/video?url=${encodeURIComponent(vidUrl)}`;
                const p = (data.success && data.post) ? data.post : null;
                const title = p?.title || 'Reddit Video';
                const author = p?.author ? `Posted by ${p.author}` : '';
                const sub = p?.subreddit ? `r/${p.subreddit}` : 'Reddit Video';

                if (custom) {
                    custom.innerHTML = `
                        <div style="background:#1a1a1b; color:#fff; border-radius:12px; padding:18px 20px; text-align:left; max-width:min(92vw, 760px); border:2px solid #FF4500; box-shadow:0 8px 36px rgba(0,0,0,0.95);">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:8px; gap:10px; flex-wrap:wrap;">
                                <div>
                                    <div style="font-weight:bold; font-size:15px; color:#FF4500;">${escapeHtml(sub)}</div>
                                    ${author ? `<div style="font-size:12px; color:#9ca3af;">${escapeHtml(author)}</div>` : ''}
                                </div>
                                <div style="display:flex; gap:8px;">
                                    <a href="${escapeHtml(vxUrl)}" target="_blank" rel="noopener noreferrer" style="background:rgba(255,69,0,0.2); border:1px solid #FF4500; color:#FF4500; font-size:12px; font-weight:bold; padding:5px 10px; border-radius:6px; text-decoration:none; white-space:nowrap;">vxReddit ↗</a>
                                    <a href="${escapeHtml(targetUrl)}" target="_blank" rel="noopener noreferrer" style="background:#FF4500; color:#fff; font-size:12px; font-weight:bold; padding:5px 12px; border-radius:6px; text-decoration:none; white-space:nowrap;">View on Reddit ↗</a>
                                </div>
                            </div>
                            ${title !== 'Reddit Video' ? `<div style="font-size:15px; font-weight:bold; line-height:1.4; color:#f3f4f6; margin-bottom:12px;">${escapeHtml(title)}</div>` : ''}
                            <div style="position:relative; width:100%; border-radius:8px; overflow:hidden; background:#000;">
                                <video src="${escapeHtml(streamUrl)}" controls autoplay playsinline style="width:100%; max-height:min(70vh, 520px); display:block; object-fit:contain; border-radius:8px; outline:none;"></video>
                            </div>
                        </div>
                    `;
                    custom.style.display = 'block';
                }
            })
            .catch(() => {
                const streamUrl = `/api/proxy/video?url=${encodeURIComponent(directMergedVid)}`;
                if (custom) {
                    custom.innerHTML = `
                        <div style="background:#1a1a1b; color:#fff; border-radius:12px; padding:18px 20px; text-align:left; max-width:min(92vw, 760px); border:2px solid #FF4500; box-shadow:0 8px 36px rgba(0,0,0,0.95);">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:8px; gap:10px;">
                                <div style="font-weight:bold; font-size:15px; color:#FF4500;">Reddit Video</div>
                                <div style="display:flex; gap:8px;">
                                    <a href="${escapeHtml(vxUrl)}" target="_blank" rel="noopener noreferrer" style="background:rgba(255,69,0,0.2); border:1px solid #FF4500; color:#FF4500; font-size:12px; font-weight:bold; padding:5px 10px; border-radius:6px; text-decoration:none;">vxReddit ↗</a>
                                    <a href="${escapeHtml(targetUrl)}" target="_blank" rel="noopener noreferrer" style="background:#FF4500; color:#fff; font-size:12px; font-weight:bold; padding:5px 12px; border-radius:6px; text-decoration:none;">View on Reddit ↗</a>
                                </div>
                            </div>
                            <div style="position:relative; width:100%; border-radius:8px; overflow:hidden; background:#000;">
                                <video src="${escapeHtml(streamUrl)}" controls autoplay playsinline style="width:100%; max-height:min(70vh, 520px); display:block; object-fit:contain; border-radius:8px; outline:none;"></video>
                            </div>
                        </div>
                    `;
                    custom.style.display = 'block';
                }
            });
    }

    lb.style.display = 'flex';
}

function closeLightbox(e) {
    if (!e || e.target.id === 'lightbox' || e.target.id === 'lightboxContent' || e.key === 'Escape') {
        const lb = document.getElementById('lightbox');
        if (!lb) return;
        lb.style.display = 'none';

        const vid = document.getElementById('lbVideo');
        if (vid) {
            vid.pause();
            vid.removeAttribute('src');
            vid.load();
        }

        const frame = document.getElementById('lbFrame');
        if (frame) {
            frame.removeAttribute('src');
        }

        const img = document.getElementById('lbImg');
        if (img) {
            img.removeAttribute('src');
        }

        const custom = document.getElementById('lbCustom');
        if (custom) {
            custom.style.display = 'none';
            custom.innerHTML = "";
        }
        currentGallery = {
            platform: 'pixiv',
            pages: [],
            currentIndex: 0,
            title: '',
            author: '',
            postUrl: '',
            artworkUrl: '',
            isR18: false
        };
        currentPixivGallery = currentGallery;
    }
}

// Close Lightbox on ESC key
if (typeof window !== 'undefined') {
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const lb = document.getElementById('lightbox');
            if (lb && lb.style.display === 'flex') {
                closeLightbox(e);
            }
        }
    });
}

// --- LIVE MEDIA INPUT DETECTOR ---
function initMediaInputDetector() {
    const bindDetector = (inputEl, badgeEl, mode = 'main') => {
        if (!inputEl) return;
        const isQr = mode === 'qr';
        const rowEl = document.getElementById(isQr ? 'qrAttachmentMetaRow' : 'mediaAttachmentMetaRow');
        const spoilerBarEl = document.getElementById(isQr ? 'qrSpoilerBar' : 'mediaSpoilerBar');
        const spoilerCheckEl = document.getElementById(isQr ? 'qrSpoilerInput' : 'spoilerInput');

        const updateBadge = () => {
            const val = inputEl.value.trim();
            if (!badgeEl) return;
            if (!val) {
                badgeEl.style.display = 'none';
                badgeEl.innerHTML = '';
                if (spoilerBarEl) spoilerBarEl.style.display = 'none';
                if (rowEl) rowEl.style.display = 'none';
                if (spoilerCheckEl) {
                    spoilerCheckEl.checked = false;
                    syncSpoilerToggleUI(mode);
                }
                return;
            }

            const media = getMediaType(val);
            if (!media) {
                badgeEl.style.display = 'none';
                if (spoilerBarEl) spoilerBarEl.style.display = 'none';
                if (rowEl) rowEl.style.display = 'none';
                return;
            }

            if (rowEl) rowEl.style.display = 'flex';
            if (spoilerBarEl) spoilerBarEl.style.display = 'inline-flex';
            if (spoilerCheckEl && media.isSpoiler && !spoilerCheckEl.checked) {
                spoilerCheckEl.checked = true;
                syncSpoilerToggleUI(mode);
            }
            badgeEl.style.display = 'block';
            if (media.type === 'reddit') {
                badgeEl.style.background = 'rgba(255, 69, 0, 0.15)';
                badgeEl.style.color = '#ff6a33';
                badgeEl.style.border = '1px solid #FF4500';
                const label = media.isShare ? 'Mobile Share Link' : 'Post / Media Link';
                badgeEl.innerHTML = `✓ Reddit ${label} Detected: <b>r/${escapeHtml(media.subreddit)}</b> (vxReddit Helper Attached)`;
            } else if (media.type === 'reddit_video') {
                badgeEl.style.background = 'rgba(255, 69, 0, 0.15)';
                badgeEl.style.color = '#ff6a33';
                badgeEl.style.border = '1px solid #FF4500';
                badgeEl.innerHTML = `✓ Reddit Video Detected (vxReddit stream with audio attached)`;
            } else if (media.type === 'x') {
                badgeEl.style.background = 'rgba(29, 161, 242, 0.15)';
                badgeEl.style.color = '#1DA1F2';
                badgeEl.style.border = '1px solid #1DA1F2';
                badgeEl.innerHTML = `✓ 𝕏 / Twitter Post Detected: <b>${media.handle ? '@' + escapeHtml(media.handle) : 'Post'}</b> (Interactive Embed)`;
            } else if (media.type === 'youtube') {
                badgeEl.style.background = 'rgba(255, 0, 0, 0.15)';
                badgeEl.style.color = '#ff4d4d';
                badgeEl.style.border = '1px solid #ff4d4d';
                badgeEl.innerHTML = `✓ YouTube Video Detected (Thumbnail &amp; Player)`;
            } else if (media.type === 'pixiv') {
                badgeEl.style.background = 'rgba(0, 150, 250, 0.15)';
                badgeEl.style.color = '#0096fa';
                badgeEl.style.border = '1px solid #0096fa';
                badgeEl.innerHTML = `✓ Pixiv Artwork Detected: <b>#${media.id}</b> (Interactive Card &amp; Viewer)`;
            } else if (media.type === 'pixiv_image') {
                badgeEl.style.background = 'rgba(0, 150, 250, 0.15)';
                badgeEl.style.color = '#0096fa';
                badgeEl.style.border = '1px solid #0096fa';
                badgeEl.innerHTML = `✓ Pixiv Direct Image Detected (Hotlink Protection Bypassed)`;
            } else if (media.type === 'video') {
                badgeEl.style.background = 'rgba(0, 229, 255, 0.15)';
                badgeEl.style.color = '#00e5ff';
                badgeEl.style.border = '1px solid #00e5ff';
                badgeEl.innerHTML = `✓ HTML5 Video Detected`;
            } else if (media.type === 'audio') {
                badgeEl.style.background = 'rgba(46, 204, 113, 0.15)';
                badgeEl.style.color = '#2ecc71';
                badgeEl.style.border = '1px solid #2ecc71';
                badgeEl.innerHTML = `✓ Audio Track Detected`;
            } else {
                badgeEl.style.background = 'rgba(255, 255, 255, 0.08)';
                badgeEl.style.color = 'var(--text-color)';
                badgeEl.style.border = '1px solid var(--border-color)';
                badgeEl.innerHTML = `✓ Image URL Detected`;
            }
        };

        inputEl.addEventListener('input', updateBadge);
        inputEl.addEventListener('change', updateBadge);
        inputEl.addEventListener('paste', () => setTimeout(updateBadge, 50));
    };

    bindDetector(document.getElementById('imageInput'), document.getElementById('mediaDetectedBadge'), 'main');
    bindDetector(document.getElementById('qrImage'), document.getElementById('qrMediaBadge'), 'qr');
}

// --- CLIENT-SIDE WEBP IMAGE COMPRESSION, VIDEO METADATA VALIDATION & CATBOX.MOE UPLOAD CONTROLLER ---
const UPLOAD_LIMITS = {
    STATIC_IMAGE_MAX_RAW: 15 * 1024 * 1024, // Up to 15MB raw before WebP compression
    STATIC_IMAGE_MAX_FINAL: 5 * 1024 * 1024, // Max 5MB after WebP compression
    GIF_MAX_BYTES: 8 * 1024 * 1024,          // Max 8MB for animated GIF
    VIDEO_MAX_BYTES: 20 * 1024 * 1024,       // Max 20MB for MP4 / WebM
    VIDEO_MAX_DURATION_SEC: 90,              // Max 90 seconds clip duration
    VIDEO_MAX_LONG_EDGE: 1920,               // Max 1080p (1920x1080 or 1080x1920)
    VIDEO_MAX_SHORT_EDGE: 1080
};

const ALLOWED_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const ALLOWED_VIDEO_MIMES = ['video/mp4', 'video/webm'];

// Inspects an MP4/WebM file in <50ms using an offscreen <video> element to check duration, resolution & capture a preview frame
function inspectAndValidateVideoFile(file) {
    return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.muted = true;
        video.playsInline = true;
        const objectUrl = URL.createObjectURL(file);
        let settled = false;

        const cleanup = () => {
            try {
                video.removeAttribute('src');
                video.load();
                URL.revokeObjectURL(objectUrl);
            } catch (_) {}
        };

        const timer = setTimeout(() => {
            if (!settled) {
                settled = true;
                cleanup();
                reject(new Error('Could not read video metadata. Please ensure the file is a valid MP4 or WebM video.'));
            }
        }, 6000);

        video.onerror = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            cleanup();
            reject(new Error('Unsupported or corrupted video codec. Please use standard MP4 (H.264) or WebM (VP8/VP9).'));
        };

        video.onloadedmetadata = () => {
            if (settled) return;
            const duration = video.duration || 0;
            const width = video.videoWidth || 0;
            const height = video.videoHeight || 0;

            if (duration > UPLOAD_LIMITS.VIDEO_MAX_DURATION_SEC) {
                settled = true;
                clearTimeout(timer);
                cleanup();
                reject(new Error(`Video is ${Math.round(duration)}s long. Maximum allowed clip duration is ${UPLOAD_LIMITS.VIDEO_MAX_DURATION_SEC}s (1m 30s).`));
                return;
            }

            const longEdge = Math.max(width, height);
            const shortEdge = Math.min(width, height);
            if (longEdge > UPLOAD_LIMITS.VIDEO_MAX_LONG_EDGE || shortEdge > UPLOAD_LIMITS.VIDEO_MAX_SHORT_EDGE) {
                settled = true;
                clearTimeout(timer);
                cleanup();
                reject(new Error(`Video resolution (${width}×${height}) exceeds 1080p maximum (${UPLOAD_LIMITS.VIDEO_MAX_LONG_EDGE}×${UPLOAD_LIMITS.VIDEO_MAX_SHORT_EDGE}).`));
                return;
            }

            // Seek slightly to grab a thumbnail frame for the preview box
            video.currentTime = Math.min(0.2, duration / 2 || 0);
        };

        video.onseeked = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            let thumbDataUrl = '';
            try {
                const canvas = document.createElement('canvas');
                canvas.width = Math.min(320, video.videoWidth || 320);
                canvas.height = Math.min(180, video.videoHeight || 180);
                const ctx = canvas.getContext('2d');
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                thumbDataUrl = canvas.toDataURL('image/webp', 0.75);
            } catch (_) {}

            const meta = {
                duration: Math.max(1, Math.round(video.duration || 0)),
                width: video.videoWidth || 0,
                height: video.videoHeight || 0,
                thumbDataUrl
            };
            cleanup();
            resolve(meta);
        };

        video.src = objectUrl;
    });
}

// Preserves original binary file untouched when <= 5MB; only compresses via canvas.toBlob when a static image exceeds 5MB
let currentPreviewObjectUrl = null;

async function prepareMediaBlobForUpload(file) {
    // Keep animated GIFs, Videos, WebP, and any static image <= 5MB completely untouched (exact original bytes!)
    if (
        !file ||
        !file.type.startsWith('image/') ||
        file.type === 'image/gif' ||
        file.type === 'image/webp' ||
        file.size <= UPLOAD_LIMITS.STATIC_IMAGE_MAX_FINAL
    ) {
        return {
            blob: file,
            mimeType: file.type || 'application/octet-stream',
            filename: file.name || `upload_${Date.now()}`,
            originalSize: file.size,
            compressedSize: file.size
        };
    }

    // Only compress oversized (> 5MB) static JPG/PNG images down to fit the 5MB limit
    return new Promise((resolve) => {
        const img = new Image();
        const objectUrl = URL.createObjectURL(file);
        img.onload = () => {
            const MAX_DIM = 2048;
            let width = img.naturalWidth || img.width;
            let height = img.naturalHeight || img.height;
            if (width > MAX_DIM || height > MAX_DIM) {
                if (width > height) {
                    height = Math.round((height * MAX_DIM) / width);
                    width = MAX_DIM;
                } else {
                    width = Math.round((width * MAX_DIM) / height);
                    height = MAX_DIM;
                }
            }
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            URL.revokeObjectURL(objectUrl);

            canvas.toBlob((blob) => {
                if (blob && blob.size > 128) {
                    const ext = blob.type === 'image/webp' ? 'webp' : (blob.type === 'image/jpeg' ? 'jpg' : 'png');
                    const baseName = (file.name || 'image').replace(/\.[^.]+$/, '');
                    resolve({
                        blob,
                        mimeType: blob.type || 'image/webp',
                        filename: `${baseName}.${ext}`,
                        originalSize: file.size,
                        compressedSize: blob.size
                    });
                } else {
                    resolve({
                        blob: file,
                        mimeType: file.type || 'image/jpeg',
                        filename: file.name || `image_${Date.now()}.jpg`,
                        originalSize: file.size,
                        compressedSize: file.size
                    });
                }
            }, 'image/webp', 0.85);
        };
        img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            resolve({
                blob: file,
                mimeType: file.type || 'image/png',
                filename: file.name || `image_${Date.now()}.png`,
                originalSize: file.size,
                compressedSize: file.size
            });
        };
        img.src = objectUrl;
    });
}

function clearUploadedMedia() {
    const urlInput = document.getElementById('imageInput');
    const previewBox = document.getElementById('uploadPreviewBox');
    const previewImg = document.getElementById('uploadPreviewImg');
    const spoilerInput = document.getElementById('spoilerInput');
    if (currentPreviewObjectUrl) {
        try { URL.revokeObjectURL(currentPreviewObjectUrl); } catch (_) {}
        currentPreviewObjectUrl = null;
    }
    if (spoilerInput) {
        spoilerInput.checked = false;
        syncSpoilerToggleUI('main');
    }
    if (urlInput) {
        urlInput.value = '';
        urlInput.dispatchEvent(new Event('input'));
    }
    if (previewBox) previewBox.style.display = 'none';
    if (previewImg) {
        previewImg.src = '';
        previewImg.style.display = 'block';
        previewImg.classList.remove('spoiler-preview-blur');
    }
}

async function uploadMediaFile(file, targetInputEl = null) {
    if (!file) return;

    const mime = (file.type || '').toLowerCase();
    const fileName = (file.name || '').toLowerCase();

    // 1. Strict Format Validation (JPG, PNG, WebP, GIF, MP4, WebM only)
    if (fileName.endsWith('.mkv') || fileName.endsWith('.avi') || fileName.endsWith('.mov')) {
        showToast("Unsupported video format. Only MP4 and WebM videos are allowed.", 4000, "error");
        return;
    }
    const isAllowedImage = ALLOWED_IMAGE_MIMES.includes(mime);
    const isAllowedVideo = ALLOWED_VIDEO_MIMES.includes(mime);
    if (!isAllowedImage && !isAllowedVideo) {
        showToast("Unsupported format. Allowed: JPG, PNG, WebP, GIF, MP4, and WebM.", 4000, "error");
        return;
    }

    // 2. Tiered Size Validation
    if (mime === 'image/gif' && file.size > UPLOAD_LIMITS.GIF_MAX_BYTES) {
        showToast(`GIF is ${(file.size / (1024 * 1024)).toFixed(1)}MB. Max allowed for GIFs is 8MB.`, 4000, "error");
        return;
    }
    if (isAllowedImage && mime !== 'image/gif' && file.size > UPLOAD_LIMITS.STATIC_IMAGE_MAX_RAW) {
        showToast(`Image is ${(file.size / (1024 * 1024)).toFixed(1)}MB. Max raw image size is 15MB (5MB after compression).`, 4000, "error");
        return;
    }
    if (isAllowedVideo && file.size > UPLOAD_LIMITS.VIDEO_MAX_BYTES) {
        showToast(`Video is ${(file.size / (1024 * 1024)).toFixed(1)}MB. Max allowed for MP4/WebM videos is 20MB.`, 4000, "error");
        return;
    }

    const uploadBtn = document.getElementById('uploadBtn');
    const urlInput = targetInputEl || document.getElementById('imageInput');
    const previewBox = document.getElementById('uploadPreviewBox');
    const previewImg = document.getElementById('uploadPreviewImg');
    const previewInfo = document.getElementById('uploadPreviewInfo');

    let videoMeta = null;
    if (isAllowedVideo) {
        if (uploadBtn) {
            uploadBtn.innerText = "Checking Video...";
            uploadBtn.disabled = true;
        }
        try {
            videoMeta = await inspectAndValidateVideoFile(file);
        } catch (vErr) {
            if (uploadBtn) {
                uploadBtn.innerText = "📤 Upload (Catbox)";
                uploadBtn.disabled = false;
            }
            showToast(vErr.message || "Invalid video file", 4500, "error");
            return;
        }
    }

    if (uploadBtn) {
        uploadBtn.innerText = isAllowedVideo ? "Uploading Video..." : "Uploading...";
        uploadBtn.disabled = true;
    }
    if (previewBox && (!targetInputEl || targetInputEl.id === 'imageInput')) {
        previewBox.style.display = 'flex';
        if (previewInfo) {
            previewInfo.innerText = isAllowedVideo
                ? `Uploading ${videoMeta ? `${videoMeta.duration}s (${videoMeta.width}×${videoMeta.height})` : ''} video to Catbox.moe...`
                : 'Uploading to Catbox.moe...';
        }
    }

    try {
        const processed = await prepareMediaBlobForUpload(file);
        if (!isAllowedVideo && mime !== 'image/gif' && processed.compressedSize > UPLOAD_LIMITS.STATIC_IMAGE_MAX_FINAL) {
            throw new Error('Image exceeds 5MB limit even after compression.');
        }

        if (previewImg) {
            if (currentPreviewObjectUrl) {
                try { URL.revokeObjectURL(currentPreviewObjectUrl); } catch (_) {}
                currentPreviewObjectUrl = null;
            }
            if (isAllowedVideo && videoMeta && videoMeta.thumbDataUrl) {
                previewImg.src = videoMeta.thumbDataUrl;
                previewImg.style.display = 'block';
            } else if (processed.blob && processed.mimeType.startsWith('image/')) {
                currentPreviewObjectUrl = URL.createObjectURL(processed.blob);
                previewImg.src = currentPreviewObjectUrl;
                previewImg.style.display = 'block';
            } else {
                previewImg.style.display = 'none';
            }
        }

        const resp = await fetch('/api/upload', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/octet-stream',
                'X-File-Name': encodeURIComponent(processed.filename || 'upload'),
                'X-Mime-Type': processed.mimeType || 'application/octet-stream'
            },
            body: processed.blob
        });
        const result = await resp.json();

        if (result.success && result.url) {
            if (urlInput) {
                urlInput.value = result.url;
                urlInput.dispatchEvent(new Event('input'));
            }
            if (isAllowedVideo) {
                const sizeMB = (processed.originalSize / (1024 * 1024)).toFixed(1);
                const metaLabel = videoMeta ? ` • ${videoMeta.duration}s • ${videoMeta.width}×${videoMeta.height}` : '';
                if (previewInfo) {
                    previewInfo.innerHTML = `✓ 🎥 Video on <b>${escapeHtml(result.provider || 'catbox.moe')}</b> (${sizeMB} MB${metaLabel})`;
                }
                showToast(`Video uploaded to Catbox.moe! (${sizeMB} MB${metaLabel})`, 3500, "success");
            } else {
                const origKB = Math.max(1, Math.round(processed.originalSize / 1024));
                const compKB = Math.max(1, Math.round(processed.compressedSize / 1024));
                const savedPct = origKB > compKB ? ` (-${Math.round((1 - compKB / origKB) * 100)}%)` : '';
                if (previewInfo) {
                    previewInfo.innerHTML = `✓ Hosted on <b>${escapeHtml(result.provider || 'catbox.moe')}</b> (${compKB} KB${savedPct})`;
                }
                showToast(`Uploaded to ${result.provider || 'Catbox.moe'}! (${compKB} KB${savedPct})`, 3200, "success");
            }
        } else {
            throw new Error(result.error || 'Upload failed');
        }
    } catch (err) {
        if (previewBox) previewBox.style.display = 'none';
        showToast("Upload Error: " + (err.message || "Network error"), 4000, "error");
    } finally {
        if (uploadBtn) {
            uploadBtn.innerText = "📤 Upload (Catbox)";
            uploadBtn.disabled = false;
        }
    }
}

function initMediaUpload() {
    const uploadBtn = document.getElementById('uploadBtn');
    const hiddenInput = document.getElementById('hiddenFileInput');
    const dropzone = document.getElementById('uploadDropzone');
    const formWrapper = document.getElementById('formWrapper');

    if (uploadBtn && hiddenInput) {
        uploadBtn.onclick = () => hiddenInput.click();
        hiddenInput.onchange = async () => {
            const file = hiddenInput.files[0];
            if (file) await uploadMediaFile(file);
            hiddenInput.value = "";
        };
    }

    // Drag & Drop support on post form & dropzone
    const bindDragDrop = (el, targetInputId) => {
        if (!el || el.dataset.dragBound === 'true') return;
        el.dataset.dragBound = 'true';

        el.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (dropzone) dropzone.classList.add('drag-over');
            el.classList.add('drag-over');
        });
        el.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (dropzone) dropzone.classList.remove('drag-over');
            el.classList.remove('drag-over');
        });
        el.addEventListener('drop', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (dropzone) dropzone.classList.remove('drag-over');
            el.classList.remove('drag-over');

            const files = e.dataTransfer?.files;
            if (files && files.length > 0) {
                const file = files[0];
                if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
                    const targetEl = document.getElementById(targetInputId || 'imageInput');
                    await uploadMediaFile(file, targetEl);
                } else {
                    showToast("Please drop an image or video file.", 3000, "error");
                }
            }
        });
    };

    bindDragDrop(dropzone, 'imageInput');
    bindDragDrop(formWrapper, 'imageInput');
    bindDragDrop(document.getElementById('quickReplyBox'), 'qrImage');

    // Clipboard Paste (Ctrl+V) image upload support in comment & media inputs
    const bindClipboardPaste = (el, targetInputId) => {
        if (!el || el.dataset.pasteBound === 'true') return;
        el.dataset.pasteBound = 'true';
        el.addEventListener('paste', async (e) => {
            const items = e.clipboardData?.items;
            if (!items) return;
            for (const item of items) {
                if (item.kind === 'file' && (item.type.startsWith('image/') || item.type.startsWith('video/'))) {
                    e.preventDefault();
                    const file = item.getAsFile();
                    if (file) {
                        const targetEl = document.getElementById(targetInputId || 'imageInput');
                        await uploadMediaFile(file, targetEl);
                    }
                    return;
                }
            }
        });
    };

    bindClipboardPaste(document.getElementById('commentInput'), 'imageInput');
    bindClipboardPaste(document.getElementById('imageInput'), 'imageInput');
    bindClipboardPaste(document.getElementById('qrComment'), 'qrImage');
    bindClipboardPaste(document.getElementById('qrImage'), 'qrImage');
}

if (typeof window !== 'undefined') {
    window.clearUploadedMedia = clearUploadedMedia;
    window.uploadMediaFile = uploadMediaFile;
    window.syncSpoilerToggleUI = syncSpoilerToggleUI;
    window.formatSpoilerMediaUrl = formatSpoilerMediaUrl;
    window.getSpoilerOverlayHtml = getSpoilerOverlayHtml;
    window.isSpoilerMediaUrl = isSpoilerMediaUrl;
    window.stripSpoilerFlag = stripSpoilerFlag;
}

// Auto-initialize controls on DOM ready
function initAllMedia() {
    initMediaUpload();
    initMediaInputDetector();
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initAllMedia);
    } else {
        initAllMedia();
    }
}

// Export unified namespace
if (typeof window !== 'undefined') {
    window.MediaHandler = {
        getMediaType,
        renderMedia,
        validateMediaUrl,
        openLightbox,
        closeLightbox,
        initMediaUpload
    };
}
