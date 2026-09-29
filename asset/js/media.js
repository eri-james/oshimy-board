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

    // 2. Twitter / X Detection (handles status URLs with username/handle & tweet ID)
    const xRegex = /(?:https?:\/\/)?(?:www\.)?(?:twitter\.com|x\.com)\/(?:#!\/)?(?:([a-zA-Z0-9_]+)\/status\/|status\/)(\d+)/i;
    const xMatch = cleanUrl.match(xRegex);
    if (xMatch) {
        return { 
            type: 'x', 
            handle: xMatch[1] && xMatch[1].toLowerCase() !== 'status' ? xMatch[1] : null, 
            id: xMatch[2], 
            url: cleanUrl 
        };
    }

    // Twitter CDN Images (pbs.twimg.com)
    if (cleanUrl.match(/(?:https?:\/\/)?pbs\.twimg\.com\/media\/[^\s]+/i)) {
        return { type: 'image', url: cleanUrl };
    }

    // 3. Reddit CDN Images (i.redd.it, preview.redd.it, external-preview.redd.it)
    if (cleanUrl.match(/(?:https?:\/\/)?(?:i|preview|external-preview)\.redd\.it\/[^\s]+/i)) {
        return { type: 'image', url: cleanUrl };
    }

    // 4. Reddit Direct Video (v.redd.it)
    const redditVideoRegex = /(?:https?:\/\/)?v\.redd\.it\/([a-zA-Z0-9_-]+)/i;
    const redditVideoMatch = cleanUrl.match(redditVideoRegex);
    if (redditVideoMatch) {
        return { type: 'reddit_video', id: redditVideoMatch[1], url: cleanUrl };
    }

    // 5. Reddit Post & Share Link Detection (handles /r/sub/comments/id, /r/sub/s/shareId, /comments/id, redd.it/id)
    const redditPostRegex = /(?:https?:\/\/)?(?:(?:www\.|old\.|new\.|m\.|sh\.)?reddit\.com\/(?:r\/([a-zA-Z0-9_]+)\/(?:comments\/([a-z0-9]+)|s\/([a-zA-Z0-9_-]+))|(?:comments\/([a-z0-9]+)|s\/([a-zA-Z0-9_-]+)))|(?<![a-zA-Z0-9])redd\.it\/([a-z0-9]+))/i;
    const redditPostMatch = cleanUrl.match(redditPostRegex);
    if (redditPostMatch) {
        const subreddit = redditPostMatch[1] || 'reddit';
        const id = redditPostMatch[2] || redditPostMatch[3] || redditPostMatch[4] || redditPostMatch[5] || redditPostMatch[6];
        const isShare = !!(redditPostMatch[3] || redditPostMatch[5]);
        return { type: 'reddit', subreddit, id, isShare, url: cleanUrl };
    }

    // 4. Direct HTML5 Video Detection
    if (cleanUrl.match(/\.(mp4|webm|ogv|mov|m4v)(?:\?.*)?$/i)) {
        return { type: 'video', url: cleanUrl };
    }

    // 5. Direct HTML5 Audio Detection
    if (cleanUrl.match(/\.(mp3|wav|ogg|m4a|aac|opus|flac)(?:\?.*)?$/i)) {
        return { type: 'audio', url: cleanUrl };
    }

    // 6. Default Fallback: Treat as Image
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
        const handleLabel = media.handle ? `@${escapeHtml(media.handle)}` : 'Post';
        return `
            <div class="media-container file-placeholder x-placeholder" onclick="openLightbox('x', '${media.id}')" title="Click to view Tweet by ${handleLabel}">
                <div class="file-ext" style="color:#1DA1F2;">𝕏</div>
                <div style="font-size:11px; color:#fff; font-weight:bold; margin-top:4px;">${handleLabel}</div>
                <div style="font-size:10px; color:#aaa; margin-top:2px;">View Tweet &amp; Media</div>
            </div>
        `;
    }

    // 3. Reddit Post Card
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

    // 4. Reddit Video Card (v.redd.it)
    if (media.type === 'reddit_video') {
        return `
            <div class="media-container file-placeholder reddit-placeholder" onclick="openLightbox('reddit_video', '${media.id}')" title="Click to view Reddit Video">
                <div class="file-ext" style="color:#FF4500;">🎥</div>
                <div style="font-size:11px; color:#fff; font-weight:bold; margin-top:4px;">Reddit Video</div>
                <div class="play-overlay">▶</div>
            </div>
        `;
    }

    // 5. Direct Video
    if (media.type === 'video') {
        return `
            <div class="media-container" onclick="openLightbox('video', '${escapeHtml(media.url)}')" style="cursor:pointer;" title="Click to play Video">
                <video src="${escapeHtml(media.url)}#t=0.001" preload="metadata" muted playsinline style="max-width:200px; max-height:200px; object-fit:cover; display:block; pointer-events:none; border:none;"></video>
                <div class="play-overlay">▶</div>
            </div>
        `;
    }

    // 6. Direct Audio
    if (media.type === 'audio') {
        return `
            <div class="media-container file-placeholder" onclick="openLightbox('audio', '${escapeHtml(media.url)}')" style="cursor:pointer; background:#2c3e50;" title="Click to play Audio">
                <div class="file-ext" style="color:#00e5ff;">🎵</div>
                <div style="font-size:11px; color:#fff; font-weight:bold; margin-top:4px;">Audio File</div>
                <div class="play-overlay" style="width:36px; height:36px; font-size:18px;">▶</div>
            </div>
        `;
    }

    // 7. Standard Image (including i.redd.it and pbs.twimg.com)
    return `
        <img src="${escapeHtml(media.url)}" class="thread-image" loading="lazy" decoding="async" alt="Post attachment" onclick="openLightbox('image', '${escapeHtml(media.url)}')" onerror="this.onerror=null; this.style.display='none';" title="Click to expand image">
    `;
}

// --- CLIENT-SIDE MEDIA VALIDATION ---
function validateMediaUrl(url) {
    return new Promise((resolve) => {
        if (!url || !url.trim()) return resolve({ valid: true });
        const media = getMediaType(url);
        
        // Video, Audio, YouTube, Twitter, Reddit are accepted without pre-loading
        if (media.type !== 'image') {
            return resolve({ valid: true, type: media.type });
        }

        // Test Image Load
        const img = new Image();
        let finished = false;
        img.onload = () => {
            if (!finished) {
                finished = true;
                resolve({ valid: true, type: 'image' });
            }
        };
        img.onerror = () => {
            if (!finished) {
                finished = true;
                resolve({ valid: false, error: "Image failed to load. Check that the URL is public and direct." });
            }
        };
        img.src = media.url;

        // 4-second timeout guard
        setTimeout(() => {
            if (!finished) {
                finished = true;
                // Allow through on slow networks rather than blocking the post
                resolve({ valid: true, type: 'image' });
            }
        }, 4000);
    });
}

// --- CENTRALIZED LIGHTBOX CONTROLLER ---
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

    if (type === 'image' && img) {
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
    else if (type === 'x' && frame) {
        frame.src = `https://platform.twitter.com/embed/Tweet.html?id=${content}&theme=${theme}`;
        frame.style.display = 'block';
        frame.style.width = "550px";
        frame.style.height = "520px";
    }
    else if (type === 'reddit') {
        const subreddit = extra1 || 'reddit';
        const postId = extra2 || '';
        const isShare = typeof extra3 !== 'undefined' && Boolean(extra3);

        if (isShare && custom) {
            custom.innerHTML = `
                <div style="background:#1a1a1b; color:#fff; border-radius:12px; padding:28px 24px; text-align:center; max-width:440px; border:2px solid #FF4500; box-shadow:0 8px 30px rgba(0,0,0,0.8);">
                    <div style="display:inline-flex; align-items:center; justify-content:center; width:56px; height:56px; border-radius:50%; background:rgba(255,69,0,0.15); margin-bottom:14px;">
                        <svg width="34" height="34" viewBox="0 0 24 24" fill="#FF4500">
                            <path d="M12 0C5.373 0 0 5.373 0 12c0 3.314 1.343 6.314 3.515 8.485l-1.03 3.09a.75.75 0 00.95.95l3.09-1.03C8.686 22.657 11.686 24 15 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm5.01 13.5c0 .825-.675 1.5-1.5 1.5-.412 0-.788-.168-1.06-.44-.825.562-1.95.915-3.2.94l.544-2.548 1.77.375c.026.685.586 1.233 1.286 1.233.714 0 1.29-.576 1.29-1.29 0-.714-.576-1.29-1.29-1.29-.488 0-.915.27-1.14.667l-2.01-.426a.375.375 0 00-.442.29l-.66 3.09c-1.32-.025-2.512-.39-3.375-.97a1.49 1.49 0 01-.983.37c-.825 0-1.5-.675-1.5-1.5 0-.585.34-1.09.83-1.332-.045-.22-.07-.446-.07-.668 0-2.348 2.73-4.25 6.1-4.25s6.1 1.902 6.1 4.25c0 .222-.025.448-.07.668.49.242.83.747.83 1.332z"/>
                        </svg>
                    </div>
                    <div style="font-size:1.15em; font-weight:bold; color:#fff; margin-bottom:6px;">Reddit Video &amp; Post</div>
                    <div style="font-size:0.9em; color:#bbb; margin-bottom:18px;">From <b>r/${escapeHtml(subreddit)}</b> (Shared via Reddit Mobile)</div>
                    <a href="${escapeHtml(content)}" target="_blank" rel="noopener noreferrer" style="display:inline-block; background:#FF4500; color:#fff; font-weight:bold; font-size:1em; padding:10px 22px; border-radius:8px; text-decoration:none; transition:background 0.15s ease;" onmouseover="this.style.background='#ff5722'" onmouseout="this.style.background='#FF4500'">
                        Watch / View on Reddit ↗
                    </a>
                    <div style="font-size:0.75em; color:#888; margin-top:14px;">Opens directly in your Reddit app or browser</div>
                </div>
            `;
            custom.style.display = 'block';
        } else if (frame) {
            const embedUrl = `https://embed.reddit.com/r/${encodeURIComponent(subreddit)}/comments/${encodeURIComponent(postId)}/?embed=true&theme=${theme}`;
            frame.src = embedUrl;
            frame.style.display = 'block';
            frame.style.width = "650px";
            frame.style.height = "540px";
        }
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
            if (typeof showToast === 'function') {
                showToast("File exceeds 32MB limit.");
            } else {
                alert("File exceeds 32MB limit.");
            }
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
                if (typeof showToast === 'function') {
                    showToast("Image uploaded successfully!");
                }
            } else {
                const errMsg = result.error?.message || "Upload failed";
                if (typeof showToast === 'function') showToast(errMsg);
                else alert("Upload Failed: " + errMsg);
            }
        } catch (err) {
            if (typeof showToast === 'function') showToast("Network error during upload.");
            else alert("Network Error during upload");
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
