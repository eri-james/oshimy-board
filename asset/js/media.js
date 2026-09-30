// ==========================================
// MEDIA.JS - Centralized Media & Embed Engine
// Handles Images, Video, Audio, YouTube, Twitter/X, Reddit, Lightbox & ImgBB Upload
// ==========================================

const IMGBB_API_KEY = "6d885f930c72cd28e6520e6c7494704f";

// --- CENTRALIZED MEDIA TYPE DETECTION ---
function getMediaType(url) {
    if (!url || typeof url !== 'string') return null;
    const cleanUrl = url.trim();
    if (!cleanUrl) return null;

    // 1. YouTube Detection (standard, shorts, live, embed, youtu.be, music.youtube)
    const ytRegex = /(?:https?:\/\/)?(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|v\/|shorts\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i;
    const ytMatch = cleanUrl.match(ytRegex);
    if (ytMatch) {
        return { type: 'youtube', id: ytMatch[1], url: cleanUrl };
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
            url: cleanUrl 
        };
    }

    // Twitter CDN Images (pbs.twimg.com)
    if (cleanUrl.match(/(?:https?:\/\/)?pbs\.twimg\.com\/media\/[^\s]+/i)) {
        return { type: 'image', url: cleanUrl };
    }

    // 3. Pixiv Artwork Link (pixiv.net/artworks/:id)
    const pixivRegex = /(?:https?:\/\/)?(?:www\.)?pixiv\.net\/(?:[a-zA-Z-]+\/)?artworks\/(\d+)/i;
    const pixivMatch = cleanUrl.match(pixivRegex);
    if (pixivMatch) {
        return { type: 'pixiv', id: pixivMatch[1], url: cleanUrl };
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
            proxyUrl
        };
    }

    // 5. Reddit CDN Images (i.redd.it, preview.redd.it, external-preview.redd.it)
    if (cleanUrl.match(/(?:https?:\/\/)?(?:i|preview|external-preview)\.redd\.it\/[^\s]+/i)) {
        return { type: 'image', url: cleanUrl };
    }

    // 6. Reddit Direct Video (v.redd.it)
    const redditVideoRegex = /(?:https?:\/\/)?v\.redd\.it\/([a-zA-Z0-9_-]+)/i;
    const redditVideoMatch = cleanUrl.match(redditVideoRegex);
    if (redditVideoMatch) {
        return { type: 'reddit_video', id: redditVideoMatch[1], url: cleanUrl };
    }

    // 7. Reddit Post & Share Link Detection (handles /r/sub/comments/id, /r/sub/s/shareId, /comments/id, redd.it/id)
    const redditPostRegex = /(?:https?:\/\/)?(?:(?:www\.|old\.|new\.|m\.|sh\.)?reddit\.com\/(?:r\/([a-zA-Z0-9_]+)\/(?:comments\/([a-z0-9]+)|s\/([a-zA-Z0-9_-]+))|(?:comments\/([a-z0-9]+)|s\/([a-zA-Z0-9_-]+)))|(?<![a-zA-Z0-9])redd\.it\/([a-z0-9]+))/i;
    const redditPostMatch = cleanUrl.match(redditPostRegex);
    if (redditPostMatch) {
        const subreddit = redditPostMatch[1] || 'reddit';
        const id = redditPostMatch[2] || redditPostMatch[3] || redditPostMatch[4] || redditPostMatch[5] || redditPostMatch[6];
        const isShare = !!(redditPostMatch[3] || redditPostMatch[5]);
        return { type: 'reddit', subreddit, id, isShare, url: cleanUrl };
    }

    // 8. Direct HTML5 Video Detection
    if (cleanUrl.match(/\.(mp4|webm|ogv|mov|m4v)(?:\?.*)?$/i)) {
        return { type: 'video', url: cleanUrl };
    }

    // 9. Direct HTML5 Audio Detection
    if (cleanUrl.match(/\.(mp3|wav|ogg|m4a|aac|opus|flac)(?:\?.*)?$/i)) {
        return { type: 'audio', url: cleanUrl };
    }

    // 10. Default Fallback: Treat as Image
    return { type: 'image', url: cleanUrl };
}

// --- CENTRALIZED MEDIA RENDERING ---
function renderMedia(url) {
    if (!url) return "";
    const media = getMediaType(url);
    if (!media) return "";

    // 1. YouTube Card
    if (media.type === 'youtube') {
        const thumbUrl = `https://img.youtube.com/vi/${media.id}/mqdefault.jpg`;
        return `
            <div class="media-container" onclick="openLightbox('youtube', '${media.id}')" title="Click to play YouTube Video">
                <img src="${thumbUrl}" alt="YouTube Thumbnail" loading="lazy" decoding="async">
                <div class="play-overlay">▶</div>
            </div>
        `;
    } 

    // 2. Twitter / X Card
    if (media.type === 'x') {
        const handleLabel = media.handle ? `@${escapeHtml(media.handle)}` : '𝕏 Post';
        const cleanHandle = media.handle || 'i';
        return `
            <div class="media-container file-placeholder x-placeholder" data-tweet-id="${media.id}" data-tweet-handle="${escapeHtml(cleanHandle)}" onclick="openLightbox('x', '${media.id}', '${escapeHtml(cleanHandle)}')" title="Click to view Tweet by ${handleLabel}">
                <div class="tweet-thumb-slot" id="tweet_slot_${media.id}" style="width:100%; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center;">
                    <div class="file-ext" style="color:#1DA1F2; font-size:24px; font-weight:900;">𝕏</div>
                    <div style="font-size:11px; color:#fff; font-weight:bold; margin-top:4px;">${handleLabel}</div>
                    <div style="font-size:10px; color:#aaa; margin-top:2px;">View Tweet &amp; Media</div>
                </div>
            </div>
        `;
    }

    // 3. Pixiv Artwork Link
    if (media.type === 'pixiv') {
        const helperFallback = `https://pixiv.re/${media.id}.jpg`;
        return `
            <div class="media-container file-placeholder pixiv-placeholder" data-pixiv-id="${media.id}" onclick="openLightbox('pixiv', '${media.id}')" title="Click to view Pixiv Artwork #${media.id}">
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
            </div>
        `;
    }

    // 4. Pixiv Direct Image (i.pximg.net / i.pixiv.re - rendered with automatic proxy helper fallback)
    if (media.type === 'pixiv_image') {
        const primarySrc = media.proxyUrl || `/api/proxy/pixiv?url=${encodeURIComponent(media.url)}`;
        const helperFallback = media.helperUrl || media.url.replace(/^https?:\/\/[a-zA-Z0-9-]+\.pximg\.net\//i, 'https://i.pixiv.re/');
        return `
            <img src="${escapeHtml(primarySrc)}" class="thread-image" loading="lazy" decoding="async" alt="Pixiv image" onclick="openLightbox('pixiv_image', this.currentSrc || this.src, '${escapeHtml(media.url)}')" onerror="if(this.dataset.triedHelper !== 'true'){ this.dataset.triedHelper='true'; this.src='${escapeHtml(helperFallback)}'; } else { this.style.display='none'; }" title="Click to expand Pixiv image">
        `;
    }

    // 5. Reddit Post Card
    if (media.type === 'reddit') {
        const isShareParam = media.isShare ? 'true' : 'false';
        return `
            <div class="media-container file-placeholder reddit-placeholder" onclick="openLightbox('reddit', '${escapeHtml(media.url)}', '${escapeHtml(media.subreddit)}', '${escapeHtml(media.id)}', ${isShareParam})" title="Click to view Reddit post on r/${escapeHtml(media.subreddit)}">
                <div style="display:flex; align-items:center; justify-content:center; width:44px; height:44px; border-radius:50%; background:rgba(255, 69, 0, 0.15); margin-bottom:8px;">
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="#FF4500">
                        <path d="M12 0C5.373 0 0 5.373 0 12c0 3.314 1.343 6.314 3.515 8.485l-1.03 3.09a.75.75 0 00.95.95l3.09-1.03C8.686 22.657 11.686 24 15 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm5.01 13.5c0 .825-.675 1.5-1.5 1.5-.412 0-.788-.168-1.06-.44-.825.562-1.95.915-3.2.94l.544-2.548 1.77.375c.026.685.586 1.233 1.286 1.233.714 0 1.29-.576 1.29-1.29 0-.714-.576-1.29-1.29-1.29-.488 0-.915.27-1.14.667l-2.01-.426a.375.375 0 00-.442.29l-.66 3.09c-1.32-.025-2.512-.39-3.375-.97a1.49 1.49 0 01-.983.37c-.825 0-1.5-.675-1.5-1.5 0-.585.34-1.09.83-1.332-.045-.22-.07-.446-.07-.668 0-2.348 2.73-4.25 6.1-4.25s6.1 1.902 6.1 4.25c0 .222-.025.448-.07.668.49.242.83.747.83 1.332z"/>
                    </svg>
                </div>
                <div style="font-size:12px; font-weight:bold; color:#fff; max-width:160px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; line-height:1.2;">r/${escapeHtml(media.subreddit)}</div>
                <div style="font-size:10px; color:#ff8c5a; margin-top:4px; font-weight:600; line-height:1.2;">${media.isShare ? 'Reddit Video / Post' : 'View Post &amp; Media'}</div>
            </div>
        `;
    }

    // 6. Reddit Video Card (v.redd.it)
    if (media.type === 'reddit_video') {
        return `
            <div class="media-container file-placeholder reddit-placeholder" onclick="openLightbox('reddit_video', '${media.id}')" title="Click to view Reddit Video">
                <div class="file-ext" style="color:#FF4500;">🎥</div>
                <div style="font-size:11px; color:#fff; font-weight:bold; margin-top:4px;">Reddit Video</div>
                <div class="play-overlay">▶</div>
            </div>
        `;
    }

    // 7. Direct Video
    if (media.type === 'video') {
        return `
            <div class="media-container" onclick="openLightbox('video', '${escapeHtml(media.url)}')" style="cursor:pointer;" title="Click to play Video">
                <video src="${escapeHtml(media.url)}#t=0.001" preload="metadata" muted playsinline style="max-width:200px; max-height:200px; object-fit:cover; display:block; pointer-events:none; border:none;"></video>
                <div class="play-overlay">▶</div>
            </div>
        `;
    }

    // 8. Direct Audio
    if (media.type === 'audio') {
        return `
            <div class="media-container file-placeholder" onclick="openLightbox('audio', '${escapeHtml(media.url)}')" style="cursor:pointer; background:#2c3e50;" title="Click to play Audio">
                <div class="file-ext" style="color:#00e5ff;">🎵</div>
                <div style="font-size:11px; color:#fff; font-weight:bold; margin-top:4px;">Audio File</div>
                <div class="play-overlay" style="width:36px; height:36px; font-size:18px;">▶</div>
            </div>
        `;
    }

    // 9. Standard Image (including i.redd.it and pbs.twimg.com)
    return `
        <img src="${escapeHtml(media.url)}" class="thread-image" loading="lazy" decoding="async" alt="Post attachment" onclick="openLightbox('image', '${escapeHtml(media.url)}')" onerror="this.onerror=null; this.style.display='none';" title="Click to expand image">
    `;
}

// Hydrates Pixiv artwork card placeholders with actual thumbnails from /api/pixiv/artwork
async function hydratePixivEmbeds() {
    const slots = document.querySelectorAll('.pixiv-placeholder[data-pixiv-id]');
    if (!slots || slots.length === 0) return;

    for (const placeholder of slots) {
        const id = placeholder.getAttribute('data-pixiv-id');
        if (!id || placeholder.getAttribute('data-hydrated') === 'true') continue;
        placeholder.setAttribute('data-hydrated', 'true');

        try {
            const resp = await fetch(`/api/pixiv/artwork?id=${id}`);
            const data = await resp.json();
            if (data.success && data.artwork) {
                const art = data.artwork;
                const slot = placeholder.querySelector('.pixiv-thumb-slot');
                if (slot) {
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
                }
            }
        } catch (_) {}
    }
}

async function hydrateTwitterEmbeds() {
    const slots = document.querySelectorAll('.x-placeholder[data-tweet-id]');
    if (!slots || slots.length === 0) return;

    for (const placeholder of slots) {
        const id = placeholder.getAttribute('data-tweet-id');
        const handle = placeholder.getAttribute('data-tweet-handle') || 'i';
        if (!id || placeholder.getAttribute('data-hydrated') === 'true') continue;
        placeholder.setAttribute('data-hydrated', 'true');

        try {
            const resp = await fetch(`/api/twitter/tweet?id=${id}&handle=${encodeURIComponent(handle)}`);
            const data = await resp.json();
            if (data.success && data.tweet) {
                const t = data.tweet;
                const slot = placeholder.querySelector('.tweet-thumb-slot');
                if (slot) {
                    const thumb = t.videoThumbnail || t.imageUrl;
                    if (thumb) {
                        const isVideo = t.mediaType === 'video';
                        const multiBadge = (t.pageCount && t.pageCount > 1) 
                            ? `<div class="pixiv-pages-badge" style="background:rgba(29,161,242,0.95);">📚 ${t.pageCount}P</div>` 
                            : '';
                        const playOverlay = isVideo 
                            ? `<div class="play-overlay" style="position:absolute; width:36px; height:36px; line-height:36px; font-size:18px;">▶</div>` 
                            : '';

                        slot.innerHTML = `
                            <div style="position:relative; width:100%; height:100%; display:flex; align-items:center; justify-content:center; overflow:hidden;">
                                <img src="${escapeHtml(thumb)}" class="thread-image" loading="lazy" decoding="async" alt="Tweet media" style="max-width:200px; max-height:200px; object-fit:cover; border-radius:4px; display:block;">
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
                    placeholder.title = `@${t.authorHandle}: "${t.text.slice(0, 100)}..." - Click to open`;
                }
            }
        } catch (_) {}
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

    return new Promise((resolve) => {
        const img = new Image();
        let finished = false;
        img.onload = () => {
            if (!finished) {
                finished = true;
                resolve({ valid: true, type: media.type });
            }
        };
        img.onerror = () => {
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

// --- PIXIV MULTI-PAGE CAROUSEL CONTROLLER ---
let currentPixivGallery = {
    pages: [],
    currentIndex: 0,
    title: '',
    author: '',
    artworkUrl: '',
    isR18: false
};

function renderPixivCarouselModal() {
    const custom = document.getElementById('lbCustom');
    if (!custom) return;

    const { pages, currentIndex, title, author, artworkUrl, isR18 } = currentPixivGallery;
    const pageCount = pages.length;
    const cur = pages[currentIndex] || pages[0];
    const r18Tag = isR18 ? '<span style="background:#e11d48; color:#fff; font-size:0.75em; padding:2px 6px; border-radius:4px; font-weight:bold; margin-right:6px;">R-18</span>' : '';
    const hasMultiple = pageCount > 1;

    const helperFallback = cur ? cur.helperUrl : '';
    const displaySrc = cur ? cur.displayUrl : '';

    custom.innerHTML = `
        <div style="background:#111827; color:#fff; border-radius:12px; padding:16px 20px; text-align:center; max-width:min(94vw, 920px); max-height:90vh; display:flex; flex-direction:column; align-items:center; border:2px solid ${isR18 ? '#e11d48' : '#0096fa'}; box-shadow:0 8px 36px rgba(0,0,0,0.95); overflow:hidden; position:relative;">
            <!-- Header bar -->
            <div style="display:flex; justify-content:space-between; align-items:center; width:100%; margin-bottom:10px; border-bottom:1px solid rgba(255,255,255,0.12); padding-bottom:8px; gap:12px;">
                <div style="text-align:left; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1;">
                    <div style="font-weight:bold; font-size:1.1em; color:#fff; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${r18Tag}${escapeHtml(title)}</div>
                    <div style="font-size:0.85em; color:#9ca3af; margin-top:2px;">
                        By <b>${escapeHtml(author)}</b>
                        ${hasMultiple ? ` • <span style="color:#38bdf8; font-weight:bold;">Page ${currentIndex + 1} of ${pageCount}</span>` : ''}
                    </div>
                </div>
                <div style="display:flex; align-items:center; gap:8px;">
                    ${hasMultiple ? `<span style="font-size:0.75em; color:#aaa; display:inline-block;" class="carousel-hint">Use ◀ ▶ or Arrow keys</span>` : ''}
                    <a href="${escapeHtml(artworkUrl)}" target="_blank" rel="noopener noreferrer" style="background:${isR18 ? '#e11d48' : '#0096fa'}; color:#fff; font-weight:bold; font-size:0.85em; padding:6px 14px; border-radius:6px; text-decoration:none; white-space:nowrap; transition:opacity 0.15s ease;" onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">
                        View on Pixiv ↗
                    </a>
                </div>
            </div>

            <!-- Image viewport with carousel arrows -->
            <div style="position:relative; width:100%; max-height:calc(85vh - 125px); min-height:220px; display:flex; justify-content:center; align-items:center; overflow:hidden;">
                ${hasMultiple ? `
                    <button type="button" class="pixiv-carousel-btn" style="position:absolute; left:8px; z-index:10;" onclick="navigatePixivPage(-1)" ${currentIndex === 0 ? 'disabled' : ''} title="Previous page (Left arrow)">
                        ◀
                    </button>
                ` : ''}

                <div style="width:100%; height:100%; display:flex; justify-content:center; align-items:center;">
                    <img id="pixivCarouselImg" src="${displaySrc}" style="max-width:100%; max-height:calc(85vh - 130px); object-fit:contain; border-radius:6px; box-shadow:0 4px 20px rgba(0,0,0,0.6); user-select:none;" alt="${escapeHtml(title)} - Page ${currentIndex + 1}" onerror="if(this.dataset.triedHelper!=='true'){this.dataset.triedHelper='true';this.src='${helperFallback}';}else{this.parentElement.innerHTML='<div style=\\'padding:30px; color:#aaa;\\'>Image failed to load. <a href=\\'${escapeHtml(artworkUrl)}\\' target=\\'_blank\\' style=\\'color:#0096fa;\\'>Open on Pixiv ↗</a></div>';}">
                </div>

                ${hasMultiple ? `
                    <button type="button" class="pixiv-carousel-btn" style="position:absolute; right:8px; z-index:10;" onclick="navigatePixivPage(1)" ${currentIndex >= pageCount - 1 ? 'disabled' : ''} title="Next page (Right arrow)">
                        ▶
                    </button>
                ` : ''}
            </div>

            <!-- Page indicator pills for multi-page illustrations -->
            ${hasMultiple ? `
                <div style="display:flex; justify-content:center; align-items:center; gap:6px; margin-top:10px; max-width:100%; overflow-x:auto; padding:4px 0;">
                    ${pages.map((p, idx) => `
                        <button type="button" onclick="setPixivPage(${idx})" style="border:none; cursor:pointer; width:${idx === currentIndex ? '22px' : '10px'}; height:8px; border-radius:4px; background:${idx === currentIndex ? (isR18 ? '#e11d48' : '#0096fa') : 'rgba(255,255,255,0.3)'}; transition:all 0.2s ease;" title="Page ${idx + 1}"></button>
                    `).join('')}
                </div>
            ` : ''}
        </div>
    `;
}

function navigatePixivPage(dir) {
    if (!currentPixivGallery || !currentPixivGallery.pages.length) return;
    const newIdx = currentPixivGallery.currentIndex + dir;
    if (newIdx >= 0 && newIdx < currentPixivGallery.pages.length) {
        currentPixivGallery.currentIndex = newIdx;
        renderPixivCarouselModal();
    }
}

function setPixivPage(idx) {
    if (!currentPixivGallery || !currentPixivGallery.pages.length) return;
    if (idx >= 0 && idx < currentPixivGallery.pages.length) {
        currentPixivGallery.currentIndex = idx;
        renderPixivCarouselModal();
    }
}

// Arrow key navigation listener for Lightbox
if (typeof window !== 'undefined') {
    window.addEventListener('keydown', (e) => {
        const lb = document.getElementById('lightbox');
        if (!lb || lb.style.display !== 'flex') return;

        // If Pixiv carousel is active and has multiple pages
        if (currentPixivGallery && currentPixivGallery.pages && currentPixivGallery.pages.length > 1) {
            if (e.key === 'ArrowLeft' || e.key === 'Left') {
                e.preventDefault();
                navigatePixivPage(-1);
                return;
            }
            if (e.key === 'ArrowRight' || e.key === 'Right') {
                e.preventDefault();
                navigatePixivPage(1);
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
        frame.src = `https://www.youtube.com/embed/${content}?autoplay=1`;
        frame.style.display = 'block';
    } 
    else if (type === 'x') {
        const tweetId = content;
        const handle = extra1 || 'i';

        if (custom) {
            custom.innerHTML = `
                <div style="background:#111827; color:#fff; border-radius:12px; padding:24px 20px; text-align:center; min-width:280px; max-width:600px; border:2px solid #1DA1F2; box-shadow:0 8px 30px rgba(0,0,0,0.85);">
                    <div style="font-size:1.1em; color:#1DA1F2; font-weight:bold; margin-bottom:8px;">𝕏 Loading Tweet...</div>
                    <div style="font-size:0.85em; opacity:0.7;">Fetching tweet media and contents...</div>
                </div>
            `;
            custom.style.display = 'block';
        }

        fetch(`/api/twitter/tweet?id=${tweetId}&handle=${encodeURIComponent(handle)}`)
            .then(r => r.json())
            .then(data => {
                if (data.success && data.tweet) {
                    const t = data.tweet;

                    // 1. If it has a video: play native HTML5 video with controls and audio!
                    if (t.mediaType === 'video' && t.videoUrl) {
                        if (custom) custom.style.display = 'none';
                        if (vid) {
                            vid.src = t.videoUrl;
                            vid.style.display = 'block';
                            vid.controls = true;
                            vid.play().catch(() => {});
                        }
                        return;
                    }

                    // 2. If it has multiple images: open in multi-page carousel with ◀ ▶ keys!
                    if (t.pages && t.pages.length > 1) {
                        currentPixivGallery = {
                            pages: t.pages,
                            currentIndex: 0,
                            title: t.text.slice(0, 80) || `Tweet by @${t.authorHandle}`,
                            author: `${t.authorName} (@${t.authorHandle})`,
                            artworkUrl: t.url,
                            isR18: false
                        };
                        renderPixivCarouselModal();
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

                    currentPixivGallery = {
                        pages,
                        currentIndex: (initialPageIndex >= 0 && initialPageIndex < pages.length) ? initialPageIndex : 0,
                        title: art.title || `Artwork #${artworkId}`,
                        author: art.author || 'Artist',
                        artworkUrl: art.artworkUrl || `https://www.pixiv.net/artworks/${artworkId}`,
                        isR18: !!art.isR18
                    };

                    renderPixivCarouselModal();
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

        if (custom) {
            custom.innerHTML = `
                <div style="background:#1a1a1b; color:#fff; border-radius:12px; padding:24px 20px; text-align:center; min-width:280px; max-width:600px; border:2px solid #FF4500; box-shadow:0 8px 30px rgba(0,0,0,0.85);">
                    <div style="font-size:1.1em; color:#FF4500; font-weight:bold; margin-bottom:8px;">Reddit Loading Post...</div>
                    <div style="font-size:0.85em; opacity:0.7;">Fetching post details and media...</div>
                </div>
            `;
            custom.style.display = 'block';
        }

        fetch(`/api/reddit/post?url=${encodeURIComponent(postUrl)}`)
            .then(r => r.json())
            .then(data => {
                if (data.success && data.post && custom) {
                    const p = data.post;
                    custom.innerHTML = `
                        <div style="background:#1a1a1b; color:#fff; border-radius:12px; padding:20px 24px; text-align:left; max-width:min(90vw, 580px); border:2px solid #FF4500; box-shadow:0 8px 36px rgba(0,0,0,0.9);">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:8px; gap:10px;">
                                <div>
                                    <div style="font-weight:bold; font-size:15px; color:#FF4500;">r/${escapeHtml(p.subreddit)}</div>
                                    <div style="font-size:12px; color:#9ca3af;">Posted by ${escapeHtml(p.author)}</div>
                                </div>
                                <a href="${escapeHtml(p.url)}" target="_blank" rel="noopener noreferrer" style="background:#FF4500; color:#fff; font-size:12px; font-weight:bold; padding:5px 12px; border-radius:6px; text-decoration:none; white-space:nowrap;">View on Reddit ↗</a>
                            </div>
                            <div style="font-size:16px; font-weight:bold; line-height:1.4; color:#f3f4f6; margin-bottom:14px;">
                                ${escapeHtml(p.title)}
                            </div>
                            ${p.thumbnailUrl ? `
                                <div style="text-align:center; margin-bottom:14px;">
                                    <img src="${escapeHtml(p.thumbnailUrl)}" style="max-width:100%; max-height:280px; border-radius:8px; object-fit:contain;">
                                </div>
                            ` : ''}
                            <div style="text-align:center;">
                                <a href="${escapeHtml(p.url)}" target="_blank" rel="noopener noreferrer" style="display:inline-block; background:rgba(255,69,0,0.15); border:1px solid #FF4500; color:#FF4500; font-weight:bold; font-size:13px; padding:8px 18px; border-radius:6px; text-decoration:none;">
                                    Open Full Post &amp; Comments ↗
                                </a>
                            </div>
                        </div>
                    `;
                    custom.style.display = 'block';
                    return;
                }

                // Fallback to official embed or share modal
                if (isShare && custom) {
                    custom.innerHTML = `
                        <div style="background:#1a1a1b; color:#fff; border-radius:12px; padding:28px 24px; text-align:center; max-width:440px; border:2px solid #FF4500; box-shadow:0 8px 30px rgba(0,0,0,0.8);">
                            <div style="font-size:1.15em; font-weight:bold; color:#fff; margin-bottom:6px;">Reddit Video &amp; Post</div>
                            <div style="font-size:0.9em; color:#bbb; margin-bottom:18px;">From <b>r/${escapeHtml(subreddit)}</b> (Shared via Reddit Mobile)</div>
                            <a href="${escapeHtml(postUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline-block; background:#FF4500; color:#fff; font-weight:bold; font-size:1em; padding:10px 22px; border-radius:8px; text-decoration:none;">
                                Watch / View on Reddit ↗
                            </a>
                        </div>
                    `;
                    custom.style.display = 'block';
                } else if (frame) {
                    if (custom) custom.style.display = 'none';
                    const embedUrl = `https://embed.reddit.com/r/${encodeURIComponent(subreddit)}/comments/${encodeURIComponent(postId)}/?embed=true&theme=${theme}`;
                    frame.src = embedUrl;
                    frame.style.display = 'block';
                    frame.style.width = "650px";
                    frame.style.height = "540px";
                }
            })
            .catch(() => {
                if (isShare && custom) {
                    custom.innerHTML = `
                        <div style="background:#1a1a1b; color:#fff; border-radius:12px; padding:28px 24px; text-align:center; max-width:440px; border:2px solid #FF4500; box-shadow:0 8px 30px rgba(0,0,0,0.8);">
                            <div style="font-size:1.15em; font-weight:bold; color:#fff; margin-bottom:6px;">Reddit Video &amp; Post</div>
                            <div style="font-size:0.9em; color:#bbb; margin-bottom:18px;">From <b>r/${escapeHtml(subreddit)}</b></div>
                            <a href="${escapeHtml(postUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline-block; background:#FF4500; color:#fff; font-weight:bold; font-size:1em; padding:10px 22px; border-radius:8px; text-decoration:none;">
                                Watch / View on Reddit ↗
                            </a>
                        </div>
                    `;
                    custom.style.display = 'block';
                } else if (frame) {
                    if (custom) custom.style.display = 'none';
                    const embedUrl = `https://embed.reddit.com/r/${encodeURIComponent(subreddit)}/comments/${encodeURIComponent(postId)}/?embed=true&theme=${theme}`;
                    frame.src = embedUrl;
                    frame.style.display = 'block';
                    frame.style.width = "650px";
                    frame.style.height = "540px";
                }
            });
    }
    else if (type === 'reddit_video' && frame) {
        frame.src = `https://embed.reddit.com/video/${encodeURIComponent(content)}/?embed=true&theme=${theme}`;
        frame.style.display = 'block';
        frame.style.width = "650px";
        frame.style.height = "500px";
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
        currentPixivGallery = {
            pages: [],
            currentIndex: 0,
            title: '',
            author: '',
            artworkUrl: '',
            isR18: false
        };
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
    const imageInput = document.getElementById('imageInput');
    const badge = document.getElementById('mediaDetectedBadge');
    if (!imageInput || !badge) return;

    const updateBadge = () => {
        const val = imageInput.value.trim();
        if (!val) {
            badge.style.display = 'none';
            badge.innerHTML = '';
            return;
        }

        const media = getMediaType(val);
        if (!media) {
            badge.style.display = 'none';
            return;
        }

        badge.style.display = 'block';
        if (media.type === 'reddit') {
            badge.style.background = 'rgba(255, 69, 0, 0.15)';
            badge.style.color = '#ff6a33';
            badge.style.border = '1px solid #FF4500';
            const label = media.isShare ? 'Mobile Share Link' : 'Post / Video Link';
            badge.innerHTML = `✓ Reddit ${label} Detected: <b>r/${escapeHtml(media.subreddit)}</b> (Media Card Attached)`;
        } else if (media.type === 'reddit_video') {
            badge.style.background = 'rgba(255, 69, 0, 0.15)';
            badge.style.color = '#ff6a33';
            badge.style.border = '1px solid #FF4500';
            badge.innerHTML = `✓ Reddit Video Detected (Player will be attached)`;
        } else if (media.type === 'x') {
            badge.style.background = 'rgba(29, 161, 242, 0.15)';
            badge.style.color = '#1DA1F2';
            badge.style.border = '1px solid #1DA1F2';
            badge.innerHTML = `✓ 𝕏 / Twitter Post Detected: <b>${media.handle ? '@' + escapeHtml(media.handle) : 'Post'}</b> (Interactive Embed)`;
        } else if (media.type === 'youtube') {
            badge.style.background = 'rgba(255, 0, 0, 0.15)';
            badge.style.color = '#ff4d4d';
            badge.style.border = '1px solid #ff4d4d';
            badge.innerHTML = `✓ YouTube Video Detected (Thumbnail &amp; Player)`;
        } else if (media.type === 'pixiv') {
            badge.style.background = 'rgba(0, 150, 250, 0.15)';
            badge.style.color = '#0096fa';
            badge.style.border = '1px solid #0096fa';
            badge.innerHTML = `✓ Pixiv Artwork Detected: <b>#${media.id}</b> (Interactive Card &amp; Viewer)`;
        } else if (media.type === 'pixiv_image') {
            badge.style.background = 'rgba(0, 150, 250, 0.15)';
            badge.style.color = '#0096fa';
            badge.style.border = '1px solid #0096fa';
            badge.innerHTML = `✓ Pixiv Direct Image Detected (Hotlink Protection Bypassed)`;
        } else if (media.type === 'video') {
            badge.style.background = 'rgba(0, 229, 255, 0.15)';
            badge.style.color = '#00e5ff';
            badge.style.border = '1px solid #00e5ff';
            badge.innerHTML = `✓ HTML5 Video Detected`;
        } else if (media.type === 'audio') {
            badge.style.background = 'rgba(46, 204, 113, 0.15)';
            badge.style.color = '#2ecc71';
            badge.style.border = '1px solid #2ecc71';
            badge.innerHTML = `✓ Audio Track Detected`;
        } else {
            badge.style.background = 'rgba(255, 255, 255, 0.08)';
            badge.style.color = 'var(--text-color)';
            badge.style.border = '1px solid var(--border-color)';
            badge.innerHTML = `✓ Image URL Detected`;
        }
    };

    imageInput.addEventListener('input', updateBadge);
    imageInput.addEventListener('change', updateBadge);
    imageInput.addEventListener('paste', () => setTimeout(updateBadge, 50));
}

// --- IMGBB UPLOAD CONTROLLER ---
function initMediaUpload() {
    const uploadBtn = document.getElementById('uploadBtn');
    if (!uploadBtn) return;
    const hiddenInput = document.getElementById('hiddenFileInput');
    const urlInput = document.getElementById('imageInput');

    uploadBtn.onclick = () => {
        if (hiddenInput) hiddenInput.click();
    };

    if (!hiddenInput) return;

    hiddenInput.onchange = async () => {
        const file = hiddenInput.files[0];
        if (!file) return;

        // Size check (max 32MB for ImgBB)
        if (file.size > 32 * 1024 * 1024) {
            showToast("File exceeds 32MB limit.", 3500, "error");
            hiddenInput.value = "";
            return;
        }

        uploadBtn.innerText = "Uploading...";
        uploadBtn.disabled = true;
        const formData = new FormData();
        formData.append("image", file);

        try {
            const resp = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, {
                method: "POST",
                body: formData
            });
            const result = await resp.json();
            if (result.success && result.data && result.data.url) {
                if (urlInput) {
                    urlInput.value = result.data.url;
                    urlInput.dispatchEvent(new Event('input'));
                    urlInput.focus();
                }
                showToast("Image uploaded successfully!", 3000, "success");
            } else {
                const errMsg = result.error?.message || "Upload failed";
                showToast("Upload Failed: " + errMsg, 4000, "error");
            }
        } catch (err) {
            showToast("Network Error during upload", 4000, "error");
        } finally {
            uploadBtn.innerText = "Upload Image";
            uploadBtn.disabled = false;
            hiddenInput.value = "";
        }
    };
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
