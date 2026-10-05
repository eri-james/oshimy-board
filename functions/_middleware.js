// Cloudflare Pages Edge Middleware
// Dynamically rewrites SEO, OpenGraph & Twitter tags for crawlers, Discord, WhatsApp, and Google

const ALL_BOARDS = {
    'myvt':  { title: '/myvt/ - MY VTuber', description: 'Malaysian Virtual YouTuber discussions, streams, talents, and community banter.' },
    'vt':    { title: '/vt/ - SEA & Global VTuber', description: 'Southeast Asian and international VTuber discussion, talents, and agency updates.' },
    'vg':    { title: '/vg/ - Video Games', description: 'Video games, gacha, co-op lobbies, gameplay clips, and gamer discussion.' },
    'amg':   { title: '/amg/ - Anime & Manga', description: 'Anime, manga, light novels, season watchalongs, and otaku culture.' },
    'ca':    { title: '/ca/ - Cosplay & Art', description: 'Cosplay photography, illustrations, artwork showcases, and craft discussion.' },
    'tech':  { title: '/tech/ - Tech Stuff', description: 'Hardware, software, gadgets, PC building, streaming gear, and tech topics.' },
    'mamak': { title: '/mamak/ - MY Stuff & Off-topic', description: 'Malaysian daily life, mamak session banter, food, and general off-topic lounge.' },
    'rqr':   { title: '/rqr/ - Board Request & Report', description: 'Feedback, board requests, bug reports, and suggestions for OshiMY.' },
    'myvth': { title: '/myvth/ - MY VTuber (18+)', description: 'NSFW Malaysian VTuber discussion board on OshiMY.' },
    'vth':   { title: '/vth/ - Global VTuber (18+)', description: 'NSFW SEA & Global VTuber discussion board on OshiMY.' },
    'hm':    { title: '/hm/ - Hentai & Doujin (18+)', description: 'NSFW Hentai, manga, and doujin discussion board on OshiMY.' },
    'hg':    { title: '/hg/ - Hentai Games & VN (18+)', description: 'NSFW Hentai games and visual novel discussion board on OshiMY.' }
};

// Helper sanitizers for HTML injection
function escapeAttr(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

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

    // 2. If we have a v.redd.it video ID, probe renders.vxreddit.com, vxreddit muxer, and v.redd.it CMAF/DASH .mp4 streams
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

function toTnktokUrl(cleanUrl) {
    if (!cleanUrl || typeof cleanUrl !== 'string') return '';
    const trimmed = cleanUrl.trim();
    if (/https?:\/\/a\.tnktok\.com/i.test(trimmed)) return trimmed;
    if (/https?:\/\/(?:www\.)?(?:tnktok\.com|vxtiktok\.com|tiktxk\.com)/i.test(trimmed)) {
        return trimmed.replace(/https?:\/\/(?:www\.)?(?:tnktok\.com|vxtiktok\.com|tiktxk\.com)/i, 'https://a.tnktok.com');
    }
    return trimmed.replace(/https?:\/\/(?:www\.|m\.|vt\.|vm\.)?tiktok\.com/i, 'https://a.tnktok.com');
}

// Helper: Resolve any image, video, Pixiv, Twitter/X, Reddit, TikTok, YouTube URL for rich Discord & messenger embeds
async function resolveSocialMedia(rawUrl, origin) {
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
                    const isGif = videoItem.type === 'gif' || (videoItem.url && videoItem.url.includes('tweet_video'));
                    if (isGif) {
                        return {
                            type: 'image',
                            isGif: true,
                            imageUrl: `https://gifconvert.vxtwitter.com/convert.avif?url=${videoItem.url}`,
                            videoUrl: null,
                            videoType: null,
                            width: videoItem.size?.width || 1000,
                            height: videoItem.size?.height || 1000,
                            source: 'Twitter / X GIF'
                        };
                    }
                    return {
                        type: 'video',
                        imageUrl: videoItem.thumbnail_url || blackThumbUrl,
                        videoUrl: videoItem.url,
                        videoType: 'video/mp4',
                        width: videoItem.size?.width || 1280,
                        height: videoItem.size?.height || 720,
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
                        const isGif = videoItem.type === 'gif' || (videoItem.url && videoItem.url.includes('tweet_video'));
                        if (isGif) {
                            return {
                                type: 'image',
                                isGif: true,
                                imageUrl: `https://gifconvert.vxtwitter.com/convert.avif?url=${videoItem.url}`,
                                videoUrl: null,
                                videoType: null,
                                width: videoItem.width || 1000,
                                height: videoItem.height || 1000,
                                source: 'Twitter / X GIF'
                            };
                        }
                        return {
                            type: 'video',
                            imageUrl: videoItem.thumbnail_url || blackThumbUrl,
                            videoUrl: videoItem.url,
                            videoType: 'video/mp4',
                            width: videoItem.width || 1280,
                            height: videoItem.height || 720,
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
            const vxredditUrl = toVxRedditUrl(cleanUrl);

            // Probe vxreddit.com with Discordbot User-Agent (mirrors Twitter vxtwitter resolution)
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

    // 5. TikTok Video & Share URLs (handles tiktok.com, vt.tiktok.com, vm.tiktok.com, a.tnktok.com, tnktok.com, tfxktok.com)
    const isTikTok = /(?:tiktok\.com|a\.tnktok\.com|tnktok\.com|vxtiktok\.com|tiktxk\.com|tfxktok\.com)\//i.test(cleanUrl);
    if (isTikTok) {
        const tnktokUrl = toTnktokUrl(cleanUrl);
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 4000);
            const ttResp = await fetch(tnktokUrl, {
                signal: controller.signal,
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)' },
                redirect: 'follow'
            });
            clearTimeout(timeout);
            if (ttResp.ok) {
                const ttHtml = await ttResp.text();
                const vidMatch = ttHtml.match(/<meta\s+(?:property|name)=["'](?:og:video(?::secure_url|:url)?|twitter:player:stream)["']\s+content=["'](https?:\/\/[^"']+)["']/i) ||
                                 ttHtml.match(/<meta\s+content=["'](https?:\/\/[^"']+)["']\s+(?:property|name)=["'](?:og:video(?::secure_url|:url)?|twitter:player:stream)["']/i);
                const imgMatch = ttHtml.match(/<meta\s+(?:property|name)=["'](?:og:image|twitter:image)["']\s+content=["'](https?:\/\/[^"']+)["']/i) ||
                                 ttHtml.match(/<meta\s+content=["'](https?:\/\/[^"']+)["']\s+(?:property|name)=["'](?:og:image|twitter:image)["']/i);
                const decodedImg = imgMatch && imgMatch[1] ? decodeHtmlEntities(imgMatch[1].trim()) : null;
                if (vidMatch && vidMatch[1]) {
                    return {
                        type: 'video',
                        imageUrl: decodedImg || blackThumbUrl,
                        videoUrl: decodeHtmlEntities(vidMatch[1].trim()),
                        videoType: 'video/mp4',
                        source: 'TikTok'
                    };
                }
                if (decodedImg) {
                    return {
                        type: 'image',
                        imageUrl: decodedImg,
                        videoUrl: null,
                        videoType: null,
                        source: 'TikTok'
                    };
                }
            }
        } catch (_) {}

        return {
            type: 'image',
            imageUrl: blackThumbUrl,
            videoUrl: null,
            videoType: null,
            source: 'TikTok'
        };
    }

    // 6. Direct Video Files (.mp4, .webm, .mov or proxy stream, including Catbox.moe videos with optional ?thumb= concrete thumbnail URL)
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

// Attach standard HTTP security hardening headers to HTML responses
function applySecurityHeaders(res) {
    if (!res || !res.headers) return res;
    const newHeaders = new Headers(res.headers);
    newHeaders.set('X-Content-Type-Options', 'nosniff');
    newHeaders.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    newHeaders.set('X-XSS-Protection', '1; mode=block');
    newHeaders.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    newHeaders.set(
        'Content-Security-Policy',
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://platform.twitter.com https://*.tiktok.com https://www.youtube.com https://s.ytimg.com; " +
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
        "font-src 'self' data: https://fonts.gstatic.com; " +
        "img-src 'self' data: blob: https:; " +
        "media-src 'self' data: blob: https:; " +
        "connect-src 'self' https:; " +
        "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://*.tiktok.com https://platform.twitter.com https://*.twitter.com https://*.x.com; " +
        "frame-ancestors 'self' *; " +
        "base-uri 'self';"
    );
    return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers: newHeaders
    });
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
        return applySecurityHeaders(response);
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
            const thread = await env.DB.prepare('SELECT id, board, name, subject, comment, media_url, created_at, reply_count FROM threads WHERE id = ?').bind(threadId).first();
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
                const vidWidth = resolvedMedia.width || 1280;
                const vidHeight = resolvedMedia.height || 720;
                const vidType = resolvedMedia.videoType || 'video/mp4';

                return applySecurityHeaders(new HTMLRewriter()
                    .on('head', {
                        element(el) {
                            if (isVideo) {
                                el.append(`
<meta property="og:video" content="${escapeAttr(resolvedMedia.videoUrl)}">
<meta property="og:video:secure_url" content="${escapeAttr(resolvedMedia.videoUrl)}">
<meta property="og:video:type" content="${escapeAttr(vidType)}">
<meta property="og:video:width" content="${vidWidth}">
<meta property="og:video:height" content="${vidHeight}">
<meta name="twitter:player:stream" content="${escapeAttr(resolvedMedia.videoUrl)}">
<meta name="twitter:player:stream:content_type" content="${escapeAttr(vidType)}">
<meta name="twitter:player" content="${escapeAttr(resolvedMedia.videoUrl)}">
<meta name="twitter:player:width" content="${vidWidth}">
<meta name="twitter:player:height" content="${vidHeight}">`, { html: true });
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
                    .transform(response));
            }
        }

        // Check if board is requested
        const boardKey = url.searchParams.get('b');
        if (boardKey && ALL_BOARDS[boardKey]) {
            const b = ALL_BOARDS[boardKey];
            const pageTitle = `${b.title} | OshiMY`;
            const pageDesc = `${b.description} Participate in anonymous discussions on /${boardKey}/ at OshiMY.`;
            const canonicalUrl = `${origin}/?b=${boardKey}`;
            const siteName = `OshiMY - /${boardKey}/`;

            return applySecurityHeaders(new HTMLRewriter()
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
                .transform(response));
        }

        // Default Homepage
        return applySecurityHeaders(new HTMLRewriter()
            .on('meta[property="og:image"]', { element(el) { el.setAttribute('content', currentBanner); } })
            .on('meta[name="twitter:image"]', { element(el) { el.setAttribute('content', currentBanner); } })
            .transform(response));

    } catch (e) {
        console.error('Error rewriting social metadata:', e);
        return applySecurityHeaders(response);
    }
}

