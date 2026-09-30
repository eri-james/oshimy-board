// Cloudflare Pages Edge Middleware
// Dynamically rewrites SEO, OpenGraph & Twitter tags for crawlers, Discord, and Google

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
            const thread = await env.DB.prepare('SELECT id, board, subject, comment, media_url, created_at FROM threads WHERE id = ?').bind(threadId).first();
            if (thread) {
                const replyId = url.searchParams.get('r') || url.searchParams.get('reply');
                let reply = null;
                if (replyId) {
                    try {
                        reply = await env.DB.prepare('SELECT id, thread_id, board, name, comment, media_url, created_at FROM replies WHERE id = ? AND thread_id = ?').bind(replyId, threadId).first();
                    } catch (_) {}
                }

                let pageTitle, pageDesc, threadMedia, canonicalUrl;

                if (reply) {
                    const cleanReplyComment = (reply.comment || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 180);
                    const cleanSubject = thread.subject && thread.subject.trim() ? `${thread.subject.trim()} - ` : '';
                    pageTitle = `Reply >>${reply.id.substring(1, 9)} - ${cleanSubject}/${thread.board}/ | OshiMY`;
                    pageDesc = cleanReplyComment || `Reply by ${reply.name || 'Anonymous'} in /${thread.board}/ thread #${thread.id.substring(1, 9)}`;
                    threadMedia = (reply.media_url && !reply.media_url.endsWith('.mp3'))
                        ? reply.media_url
                        : ((thread.media_url && !thread.media_url.endsWith('.mp3')) ? thread.media_url : currentBanner);
                    canonicalUrl = `${origin}/?b=${thread.board}&t=${thread.id}&r=${reply.id}`;
                } else {
                    const cleanComment = (thread.comment || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 180);
                    const subjectTitle = thread.subject && thread.subject.trim() 
                        ? `${thread.subject.trim()} - ` 
                        : (cleanComment ? `${cleanComment.slice(0, 40)}... - ` : '');
                    pageTitle = `${subjectTitle}/${thread.board}/ | OshiMY`;
                    pageDesc = cleanComment || `Thread on /${thread.board}/ - OshiMY Malaysian VTuber & Otaku Imageboard`;
                    threadMedia = (thread.media_url && !thread.media_url.endsWith('.mp3')) ? thread.media_url : currentBanner;
                    canonicalUrl = `${origin}/?b=${thread.board}&t=${thread.id}`;
                }

                return new HTMLRewriter()
                    .on('title', { element(el) { el.setInnerContent(pageTitle); } })
                    .on('meta[name="description"]', { element(el) { el.setAttribute('content', pageDesc); } })
                    .on('meta[property="og:title"]', { element(el) { el.setAttribute('content', pageTitle); } })
                    .on('meta[property="og:description"]', { element(el) { el.setAttribute('content', pageDesc); } })
                    .on('meta[property="og:image"]', { element(el) { el.setAttribute('content', threadMedia); } })
                    .on('meta[property="og:url"]', { element(el) { el.setAttribute('content', canonicalUrl); } })
                    .on('meta[name="twitter:title"]', { element(el) { el.setAttribute('content', pageTitle); } })
                    .on('meta[name="twitter:description"]', { element(el) { el.setAttribute('content', pageDesc); } })
                    .on('meta[name="twitter:image"]', { element(el) { el.setAttribute('content', threadMedia); } })
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

            return new HTMLRewriter()
                .on('title', { element(el) { el.setInnerContent(pageTitle); } })
                .on('meta[name="description"]', { element(el) { el.setAttribute('content', pageDesc); } })
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
