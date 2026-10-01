// Cloudflare Pages Edge Middleware
// Dynamically rewrites SEO, OpenGraph & Twitter tags for crawlers, Discord, WhatsApp, and Google

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

// Helper sanitizers for HTML injection
function escapeAttr(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Helper: Resolve any image, video, Pixiv, Twitter/X, Reddit, YouTube URL for rich Discord & messenger embeds
async function resolveSocialMedia(rawUrl, origin) {
    if (!rawUrl || typeof rawUrl !== 'string') {
        return { type: 'none', imageUrl: null, videoUrl: null, videoType: null, source: null };
    }
    const cleanUrl = rawUrl.trim();
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

        // 3a. Query api.vxtwitter.com JSON API
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
                    return {
                        type: 'video',
                        imageUrl: videoItem.thumbnail_url || blackThumbUrl,
                        videoUrl: videoItem.url,
                        videoType: 'video/mp4',
                        source: 'Twitter / X Video'
                    };
                }

                if (imageItem) {
                    return {
                        type: 'image',
                        imageUrl: imageItem.url,
                        videoUrl: null,
                        videoType: null,
                        source: 'Twitter / X'
                    };
                }
            }
        } catch (_) {}

        // 3b. Query api.fxtwitter.com JSON API
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
                        return {
                            type: 'video',
                            imageUrl: videoItem.thumbnail_url || blackThumbUrl,
                            videoUrl: videoItem.url,
                            videoType: 'video/mp4',
                            source: 'Twitter / X Video'
                        };
                    }
                    const photoItem = (t.media.photos && t.media.photos[0]) || (t.media.all && t.media.all.find(m => m.type === 'photo' || m.type === 'image'));
                    if (photoItem) {
                        return {
                            type: 'image',
                            imageUrl: photoItem.url,
                            videoUrl: null,
                            videoType: null,
                            source: 'Twitter / X'
                        };
                    }
                }
            }
        } catch (_) {}

        // 3c. Fallback: probe vxTwitter HTML tags
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
                        imageUrl: (imgMatch && imgMatch[1]) || blackThumbUrl,
                        videoUrl: vidMatch[1],
                        videoType: 'video/mp4',
                        source: 'Twitter / X Video'
                    };
                }
                if (imgMatch && imgMatch[1]) {
                    return {
                        type: 'image',
                        imageUrl: imgMatch[1],
                        videoUrl: null,
                        videoType: null,
                        source: 'Twitter / X'
                    };
                }
            }
        } catch (_) {}

        return {
            type: 'image',
            imageUrl: blackThumbUrl,
            videoUrl: null,
            videoType: null,
            source: 'Twitter / X'
        };
    }

    // 4. Reddit
    // 4a. Direct Reddit video (v.redd.it or reddit.com/video/)
    const redditVidMatch = cleanUrl.match(/(?:v\.redd\.it|reddit\.com\/video\/)([a-zA-Z0-9_-]+)/i);
    if (redditVidMatch) {
        const vidId = redditVidMatch[1];
        return {
            type: 'video',
            imageUrl: blackThumbUrl,
            videoUrl: `https://v.redd.it/${vidId}/DASH_720.mp4`,
            videoType: 'video/mp4',
            source: 'Reddit Video'
        };
    }
    // 4b. Reddit post with comments
    const redditPostMatch = cleanUrl.match(/(?:reddit\.com|vxreddit\.com|rxddit\.com)\/r\/([a-zA-Z0-9_]+)(?:\/comments\/([a-zA-Z0-9]+))?/i);
    if (redditPostMatch) {
        const sub = redditPostMatch[1];
        const postId = redditPostMatch[2];
        return {
            type: 'image',
            imageUrl: postId ? `https://redditez.com/r/${sub}/comments/${postId}.jpg` : null,
            videoUrl: null,
            videoType: null,
            source: `Reddit r/${sub}`
        };
    }

    // 5. Direct Video Files (.mp4, .webm, .mov or proxy stream)
    if (/\.(mp4|webm|mov)(?:\?.*)?$/i.test(cleanUrl) || cleanUrl.includes('/api/proxy/stream')) {
        let absVideoUrl = cleanUrl;
        if (cleanUrl.startsWith('/') && origin) {
            absVideoUrl = `${origin}${cleanUrl}`;
        }
        const thumbUrl = origin ? `${origin}/api/video/thumbnail?url=${encodeURIComponent(absVideoUrl)}` : blackThumbUrl;
        return {
            type: 'video',
            imageUrl: thumbUrl,
            videoUrl: absVideoUrl,
            videoType: cleanUrl.includes('.webm') ? 'video/webm' : 'video/mp4',
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

export async function onRequest(context) {
    const { request, env, next } = context;
    const url = new URL(request.url);

    // Skip API routes, sitemaps, robots, and assets with file extensions (.js, .css, .png, etc.)
    if (url.pathname.startsWith('/api') || url.pathname.endsWith('.xml') || url.pathname.endsWith('.txt') || (url.pathname.includes('.') && !url.pathname.endsWith('.html'))) {
        return next();
    }

    const response = await next();
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
        return response;
    }

    if (!env || !env.DB) {
        return response;
    }

    try {
        const origin = url.origin;
        let currentBanner = 'https://images.unsplash.com/photo-1578632767115-351597cf2477?auto=format&fit=crop&w=1200&h=300&q=80';
        try {
            const bannerRow = await env.DB.prepare('SELECT value FROM site_settings WHERE key = ?').bind('banner_url').first();
            if (bannerRow && bannerRow.value && bannerRow.value.trim()) {
                currentBanner = bannerRow.value.trim();
            }
        } catch (_) {}

        // Check if thread is requested
        const threadId = url.searchParams.get('t') || url.searchParams.get('thread');
        if (threadId) {
            const thread = await env.DB.prepare('SELECT id, board, subject, comment, media_url, created_at, (SELECT COUNT(*) FROM replies r WHERE r.thread_id = threads.id) as reply_count FROM threads WHERE id = ?').bind(threadId).first();
            if (thread) {
                const replyId = url.searchParams.get('r') || url.searchParams.get('reply');
                let reply = null;
                if (replyId) {
                    try {
                        reply = await env.DB.prepare('SELECT id, thread_id, board, name, comment, media_url, created_at FROM replies WHERE id = ? AND thread_id = ?').bind(replyId, threadId).first();
                    } catch (_) {}
                }

                const rawMedia = (reply && reply.media_url) ? reply.media_url : (thread.media_url || null);
                const resolvedMedia = await resolveSocialMedia(rawMedia, origin);
                const blackThumbUrl = `${origin}/asset/img/video_black_thumb.png`;
                const displayImage = resolvedMedia.type === 'video'
                    ? (resolvedMedia.imageUrl || blackThumbUrl)
                    : (resolvedMedia.imageUrl || currentBanner);

                let pageTitle, pageDesc, canonicalUrl;
                const siteName = `OshiMY - /${thread.board}/`;
                const threadNum = thread.id.startsWith('-') ? thread.id.substring(1, 9) : thread.id.substring(0, 8);

                if (reply) {
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

                const isVideo = resolvedMedia.type === 'video' && Boolean(resolvedMedia.videoUrl);

                return new HTMLRewriter()
                    .on('head', {
                        element(el) {
                            if (isVideo) {
                                el.append(`
<meta property="og:video" content="${escapeAttr(resolvedMedia.videoUrl)}">
<meta property="og:video:secure_url" content="${escapeAttr(resolvedMedia.videoUrl)}">
<meta property="og:video:type" content="${escapeAttr(resolvedMedia.videoType || 'video/mp4')}">
<meta property="og:video:width" content="1280">
<meta property="og:video:height" content="720">
<meta name="twitter:player" content="${escapeAttr(resolvedMedia.videoUrl)}">
<meta name="twitter:player:width" content="1280">
<meta name="twitter:player:height" content="720">`, { html: true });
                            }
                        }
                    })
                    .on('title', { element(el) { el.setInnerContent(pageTitle); } })
                    .on('meta[name="description"]', { element(el) { el.setAttribute('content', pageDesc); } })
                    .on('meta[property="og:site_name"]', { element(el) { el.setAttribute('content', siteName); } })
                    .on('meta[property="og:type"]', { element(el) { el.setAttribute('content', isVideo ? 'video.other' : 'article'); } })
                    .on('meta[property="og:title"]', { element(el) { el.setAttribute('content', pageTitle); } })
                    .on('meta[property="og:description"]', { element(el) { el.setAttribute('content', pageDesc); } })
                    .on('meta[property="og:image"]', { element(el) { el.setAttribute('content', displayImage); } })
                    .on('meta[property="og:url"]', { element(el) { el.setAttribute('content', canonicalUrl); } })
                    .on('meta[name="twitter:card"]', { element(el) { el.setAttribute('content', isVideo ? 'player' : 'summary_large_image'); } })
                    .on('meta[name="twitter:title"]', { element(el) { el.setAttribute('content', pageTitle); } })
                    .on('meta[name="twitter:description"]', { element(el) { el.setAttribute('content', pageDesc); } })
                    .on('meta[name="twitter:image"]', { element(el) { el.setAttribute('content', displayImage); } })
                    .on('link[rel="canonical"]', { element(el) { el.setAttribute('href', canonicalUrl); } })
                    .transform(response);
            }
        }

        // Check if board is requested
        const boardKey = url.searchParams.get('b');
        if (boardKey && SFW_BOARDS[boardKey]) {
            const b = SFW_BOARDS[boardKey];
            const pageTitle = `${b.title} | OshiMY`;
            const pageDesc = `${b.description} Participate in anonymous discussions on /${boardKey}/ at OshiMY.`;
            const canonicalUrl = `${origin}/?b=${boardKey}`;
            const siteName = `OshiMY - /${boardKey}/`;

            return new HTMLRewriter()
                .on('title', { element(el) { el.setInnerContent(pageTitle); } })
                .on('meta[name="description"]', { element(el) { el.setAttribute('content', pageDesc); } })
                .on('meta[property="og:site_name"]', { element(el) { el.setAttribute('content', siteName); } })
                .on('meta[property="og:title"]', { element(el) { el.setAttribute('content', pageTitle); } })
                .on('meta[property="og:description"]', { element(el) { el.setAttribute('content', pageDesc); } })
                .on('meta[property="og:image"]', { element(el) { el.setAttribute('content', currentBanner); } })
                .on('meta[property="og:url"]', { element(el) { el.setAttribute('content', canonicalUrl); } })
                .on('meta[name="twitter:title"]', { element(el) { el.setAttribute('content', pageTitle); } })
                .on('meta[name="twitter:description"]', { element(el) { el.setAttribute('content', pageDesc); } })
                .on('meta[name="twitter:image"]', { element(el) { el.setAttribute('content', currentBanner); } })
                .on('link[rel="canonical"]', { element(el) { el.setAttribute('href', canonicalUrl); } })
                .transform(response);
        }

        // Default Homepage
        return new HTMLRewriter()
            .on('meta[property="og:image"]', { element(el) { el.setAttribute('content', currentBanner); } })
            .on('meta[name="twitter:image"]', { element(el) { el.setAttribute('content', currentBanner); } })
            .transform(response);

    } catch (e) {
        console.error('Error rewriting social metadata:', e);
        return response;
    }
}

