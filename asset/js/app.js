// ==========================================
// APP.JS - Core Logic, Routing, Rendering
// Connected to Cloudflare D1 / SQLite REST API
// ==========================================

let userWatchlistIds = new Set();

// --- NSFW GATE ---
function checkNSFWGate() {
    if (currentBoard && BOARDS[currentBoard] && BOARDS[currentBoard].type === 'nsfw') {
        if (!sessionStorage.getItem('nsfw_consent')) {
            document.body.classList.add('gate-active');
            const gate = document.getElementById('nsfwGate');
            if (gate) gate.style.display = 'flex';
            const gateName = document.getElementById('gateBoardName');
            if (gateName) gateName.innerText = currentBoard;
            return false;
        }
    }
    return true;
}

function acceptNSFW() {
    sessionStorage.setItem('nsfw_consent', 'true');
    document.body.classList.remove('gate-active');
    const gate = document.getElementById('nsfwGate');
    if (gate) gate.style.display = 'none';
    router();
}

// --- ROUTER ---
window.addEventListener('hashchange', router);
window.addEventListener('load', () => {
    initAuth();
    loadSiteSettings();
    router();
    startAutoUpdate();
});

function router() {
    const hash = window.location.hash;
    if (hash === "#bottom") return;

    // View Elements
    const homeView = document.getElementById('homeView');
    const boardView = document.getElementById('boardView');
    const threadView = document.getElementById('threadView');
    const formWrapper = document.getElementById('formWrapper');
    const topDivider = document.getElementById('topDivider');

    // 0. POST ANCHOR SAFETY CHECK:
    // If the hash is #post_..., NEVER kick the user out of the thread view!
    if (hash.startsWith("#post_")) {
        const targetPostId = hash.replace("#post_", "");
        if (currentThreadId) {
            // Already in thread view: scroll and highlight smoothly
            const el = document.getElementById('post_' + targetPostId);
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                el.classList.remove('post-highlight-active');
                void el.offsetWidth;
                el.classList.add('post-highlight-active');
                setTimeout(() => el.classList.remove('post-highlight-active'), 2500);
            }
            return;
        }
    }

    document.body.classList.remove('night-mode');

    // 1. HOME PAGE (No Board Selected)
    if (!currentBoard || !BOARDS[currentBoard]) {
        if (homeView) homeView.style.display = "block";
        if (boardView) boardView.style.display = "none";
        if (threadView) threadView.style.display = "none";
        if (formWrapper) formWrapper.style.display = "none";
        if (topDivider) topDivider.style.display = "none";
        document.getElementById('boardTitle').innerText = "OshiMY - Portal";
        document.title = "OshiMY - Malaysian VTuber & Otaku Imageboard";
        loadPortalStats();
        return;
    }

    // 2. BOARD / THREAD MODE
    if (homeView) homeView.style.display = "none";
    if (topDivider) topDivider.style.display = "block";
    
    // Set Titles & Theme
    document.title = `${BOARDS[currentBoard].title} | OshiMY`;
    document.getElementById('boardTitle').innerText = BOARDS[currentBoard].title;
    
    if (BOARDS[currentBoard].type === 'nsfw') {
        document.body.classList.add('night-mode');
    }

    // Check Gate
    if (!checkNSFWGate()) return;

    const urlParam = new URLSearchParams(window.location.search);
    const isArchiveView = urlParam.get('view') === 'archive';

    if (hash.startsWith("#thread_")) {
        // Parse thread and potential post anchor (e.g. #thread_123#post_456)
        let threadPart = hash.replace("#thread_", "");
        let postPart = null;
        if (threadPart.includes("#post_")) {
            const splitHash = threadPart.split("#post_");
            threadPart = splitHash[0];
            postPart = splitHash[1];
        }

        // Thread Mode
        if (boardView) boardView.style.display = "none";
        if (threadView) threadView.style.display = "block";
        if (formWrapper) formWrapper.style.display = "block";
        currentThreadId = threadPart;
        lastThreadSignature = "";

        if (postPart) {
            sessionStorage.setItem('pending_scroll_post', postPart);
        }

        loadThreadView(currentThreadId);
    } else {
        // Board Mode
        currentThreadId = null;
        lastBoardSignature = "";
        if (threadView) threadView.style.display = "none";
        if (boardView) boardView.style.display = "block";
        if (formWrapper) formWrapper.style.display = isArchiveView ? "none" : "block"; 
        loadBoardView(isArchiveView);
    }

    renderBoardNav();
}

// --- DYNAMIC HEADER NAVIGATION ---
function renderBoardNav() {
    const navContainer = document.getElementById('navBoards');
    if (!navContainer) return;
    
    const currentType = (currentBoard && BOARDS[currentBoard]) ? BOARDS[currentBoard].type : 'sfw';
    let html = "";
    
    for (const [key, data] of Object.entries(BOARDS)) {
        if (data.type === currentType) {
            const isActive = (key === currentBoard) ? 'style="font-weight:900; border-bottom: 2px solid;"' : '';
            html += `[ <a href="?b=${key}" ${isActive}>/${key}/</a> ] `;
        }
    }

    // Add Archive Toggle if inside a board
    if (currentBoard && BOARDS[currentBoard]) {
        const isArch = new URLSearchParams(window.location.search).get('view') === 'archive';
        const archLabel = isArch ? '⚡ Active' : '📦 Archive';
        const archHref = isArch ? `?b=${currentBoard}` : `?b=${currentBoard}&view=archive`;
        html += ` [ <a href="${archHref}" style="opacity:0.85; font-style:italic;">${archLabel}</a> ]`;
    }

    navContainer.innerHTML = html;
}

// --- PORTAL STATS ON HOME VIEW ---
const DEFAULT_BANNER = "https://images.unsplash.com/photo-1578632767115-351597cf2477?auto=format&fit=crop&w=1200&h=300&q=80";

async function loadPortalStats() {
    loadSiteSettings();
    try {
        const data = await apiFetch('/boards');
        if (data.success && data.boards) {
            for (const [key, b] of Object.entries(data.boards)) {
                const el = document.getElementById(`stat_${key}`);
                if (el) {
                    el.innerText = `(${b.thread_count} threads)`;
                }
            }
        }
    } catch (err) {
        console.warn('Could not load board stats:', err);
    }
}

async function loadSiteSettings() {
    try {
        const data = await apiFetch('/settings');
        const img = document.getElementById('homeBannerImg');
        const input = document.getElementById('bannerUrlInput');
        if (data.success && data.settings && data.settings.banner_url) {
            if (img) img.src = data.settings.banner_url;
            if (input) input.value = data.settings.banner_url;
        } else {
            if (img && !img.src) img.src = DEFAULT_BANNER;
            if (input) input.value = DEFAULT_BANNER;
        }
    } catch (e) {
        console.warn('Could not load site settings:', e);
    }
}

function toggleBannerEditor() {
    const box = document.getElementById('bannerEditorBox');
    if (!box) return;
    const isShowing = box.style.display === 'block';
    box.style.display = isShowing ? 'none' : 'block';
    const statusMsg = document.getElementById('bannerStatusMsg');
    if (statusMsg) statusMsg.innerText = '';
}

async function saveBannerUrl() {
    const input = document.getElementById('bannerUrlInput');
    const statusMsg = document.getElementById('bannerStatusMsg');
    const val = input ? input.value.trim() : '';
    if (!val) {
        if (statusMsg) {
            statusMsg.style.color = '#ef4444';
            statusMsg.innerText = 'Please enter an image URL.';
        }
        return;
    }

    try {
        const res = await apiFetch('/admin/settings', {
            method: 'POST',
            body: { key: 'banner_url', value: val }
        });
        if (res.success) {
            const img = document.getElementById('homeBannerImg');
            if (img) img.src = val;
            if (statusMsg) {
                statusMsg.style.color = '#2e7d32';
                statusMsg.innerText = 'Banner updated!';
            }
            setTimeout(() => {
                toggleBannerEditor();
            }, 1000);
        }
    } catch (err) {
        if (statusMsg) {
            statusMsg.style.color = '#ef4444';
            statusMsg.innerText = err.message;
        }
    }
}

async function resetBannerUrl() {
    const input = document.getElementById('bannerUrlInput');
    const statusMsg = document.getElementById('bannerStatusMsg');
    if (input) input.value = DEFAULT_BANNER;
    try {
        await apiFetch('/admin/settings', {
            method: 'POST',
            body: { key: 'banner_url', value: DEFAULT_BANNER }
        });
        const img = document.getElementById('homeBannerImg');
        if (img) img.src = DEFAULT_BANNER;
        if (statusMsg) {
            statusMsg.style.color = '#2e7d32';
            statusMsg.innerText = 'Reset to default banner.';
        }
        setTimeout(() => {
            toggleBannerEditor();
        }, 1000);
    } catch (err) {
        if (statusMsg) {
            statusMsg.style.color = '#ef4444';
            statusMsg.innerText = err.message;
        }
    }
}

// --- LOAD BOARD VIEW ---
let lastBoardSignature = "";

async function loadBoardView(isArchive = false, isSilent = false) {
    const container = document.getElementById('threadList');
    if (!container) return;
    
    if (!isSilent) {
        container.innerHTML = `<div style="text-align:center; padding: 20px; color: var(--text-color);">Loading ${isArchive ? 'archived ' : ''}threads...</div>`;
    }

    // Configure form for new thread
    const formTitle = document.getElementById('formTitle');
    const subjectInput = document.getElementById('subjectInput');
    const submitBtn = document.getElementById('submitBtn');
    if (!isSilent) {
        if (formTitle) formTitle.innerText = isArchive ? "Board Archive" : "Create New Thread";
        if (subjectInput) subjectInput.style.display = "block";
        if (submitBtn) submitBtn.innerText = "Submit New Thread";
    }

    try {
        const viewParam = isArchive ? '&view=archive' : '';
        const res = await apiFetch(`/threads?b=${currentBoard}${viewParam}`);
        const threads = res.threads || [];

        if (threads.length === 0) {
            if (!isSilent) {
                container.innerHTML = `<div style="text-align:center; padding: 40px; color: var(--text-color);">No ${isArchive ? 'archived ' : ''}threads found on /${currentBoard}/.</div>`;
            }
            lastBoardSignature = "";
            return;
        }

        // Generate data signature to detect if anything on the board actually changed
        const currentSignature = JSON.stringify(threads.map(t => [
            t.id, 
            t.reply_count, 
            t.bumped_at, 
            t.is_pinned, 
            t.is_locked,
            (t.preview_replies || []).map(r => r.id)
        ]));

        // If silent auto-update and no changes occurred: DO NOT TOUCH THE DOM!
        // This completely prevents unnecessary layout shifts, image reloads, or scroll drifts.
        if (isSilent && lastBoardSignature === currentSignature) {
            return;
        }
        lastBoardSignature = currentSignature;

        // Viewport Anchor Preservation:
        // Find which thread card is currently visible in the user's viewport so we lock directly onto it
        let anchorId = null;
        let anchorTop = 0;
        if (isSilent) {
            const currentThreads = Array.from(container.querySelectorAll('.thread'));
            for (const thEl of currentThreads) {
                const rect = thEl.getBoundingClientRect();
                if (rect.bottom > 0 && rect.top < window.innerHeight) {
                    anchorId = thEl.id;
                    anchorTop = rect.top;
                    break;
                }
            }
        }

        let html = "";
        for (const th of threads) {
            html += renderThreadPreview(th);
        }

        container.innerHTML = html;
        generateBacklinks();

        // Re-align viewport to the exact thread the user was reading
        if (isSilent && anchorId) {
            const restoreAnchor = () => {
                const newAnchor = document.getElementById(anchorId);
                if (newAnchor) {
                    const diff = newAnchor.getBoundingClientRect().top - anchorTop;
                    if (Math.abs(diff) > 0.5) {
                        window.scrollBy({ top: diff, behavior: 'instant' });
                    }
                }
            };
            restoreAnchor();
            // Safety re-check after images/fonts lay out
            requestAnimationFrame(restoreAnchor);
        }
    } catch (err) {
        if (!isSilent) {
            container.innerHTML = `<div style="color:red; text-align:center; padding: 20px;">Failed to load board: ${err.message}</div>`;
        }
    }
}

// Render Thread Card in Board Index
function renderThreadPreview(th) {
    const isOwner = MY_POSTS.includes(th.id);
    const youTag = isOwner ? ` <span style="font-weight:bold; font-style:italic; font-size:0.9em;">(You)</span>` : "";
    const pinnedBadge = th.is_pinned ? `<span style="color:#d97706; font-weight:bold; margin-right:6px;">📌 [Pinned]</span>` : '';
    const lockedBadge = th.is_locked ? `<span style="color:#dc2626; font-weight:bold; margin-right:6px;">🔒 [Locked]</span>` : '';
    const roleBadge = th.display_title ? `<span style="background:var(--main-accent); color:#fff; border-radius:4px; padding:1px 5px; font-size:0.85em; margin-right:4px;">${escapeHtml(th.display_title)}</span>` : '';

    const dateStr = new Date(th.created_at).toLocaleString();
    const mediaHtml = renderMedia(th.media_url);

    // Mod controls
    let modControls = "";
    if (currentUser && (currentUser.role === 'admin' || currentUser.role === 'mod')) {
        modControls = `
            <span style="margin-left: 10px; font-size: 0.9em;">
                [<a href="#" onclick="togglePin('${th.id}'); return false;">${th.is_pinned ? 'Unpin' : 'Pin'}</a>]
                [<a href="#" onclick="toggleLock('${th.id}'); return false;">${th.is_locked ? 'Unlock' : 'Lock'}</a>]
                [<a href="#" onclick="adminDelete('thread', '${th.id}'); return false;" style="color:red;">Delete</a>]
            </span>
        `;
    }

    // Watch control
    let watchControl = "";
    if (currentUser) {
        const isWatched = userWatchlistIds.has(th.id);
        watchControl = `
            <span style="margin-left: 6px; font-size: 0.9em;">
                [<a href="javascript:void(0)" onclick="toggleWatch('${th.id}')" id="watchBtn_${th.id}" style="${isWatched ? 'color:#eab308; font-weight:bold;' : ''}">${isWatched ? '⭐ Watching' : '⭐ Watch'}</a>]
            </span>
        `;
    }

    // Preview replies HTML
    let repliesHtml = "";
    if (th.preview_replies && th.preview_replies.length > 0) {
        for (const r of th.preview_replies) {
            repliesHtml += renderReplyCard(r, th.id, true);
        }
    }

    const replyCountText = th.reply_count > 0 
        ? `${th.reply_count} ${th.reply_count === 1 ? 'reply' : 'replies'}` 
        : `No replies yet`;

    return `
        <div class="thread" id="thread_${th.id}">
            <div class="op" id="post_${th.id}">
                ${mediaHtml}
                <div class="post-content">
                    <div class="post-header">
                        ${pinnedBadge}
                        ${lockedBadge}
                        <span class="subject">${escapeHtml(th.subject || '')}</span>
                        ${roleBadge}
                        <span class="name">${escapeHtml(th.name || 'Anonymous')}</span>
                        <span class="date">${dateStr}</span>
                        <span class="post-id">No. <a href="?b=${currentBoard}#thread_${th.id}">${th.id.substring(1, 9)}</a></span>
                        ${youTag}
                        <a href="?b=${currentBoard}#thread_${th.id}" class="reply-link">[Reply ➜]</a>
                        ${watchControl}
                        ${modControls}
                    </div>
                    <div class="backlink-container" id="backlinks_${th.id}"></div>
                    <div class="comment">${formatComment(th.comment)}</div>
                    <div style="font-size:0.85em; color:var(--text-color); opacity:0.8; margin-top:8px;">
                        [ <a href="?b=${currentBoard}#thread_${th.id}">${replyCountText}</a> ]
                    </div>
                </div>
            </div>
            <div class="replies" style="margin-left: 20px;">
                ${repliesHtml}
            </div>
        </div>
        <hr style="margin: 20px 0; border-color: var(--border-color);">
    `;
}

// --- LOAD SINGLE THREAD VIEW ---
let lastThreadSignature = "";

async function loadThreadView(threadId, isSilent = false) {
    const opContainer = document.getElementById('opContainer');
    const repliesContainer = document.getElementById('repliesContainer');
    const formTitle = document.getElementById('formTitle');
    const subjectInput = document.getElementById('subjectInput');
    const submitBtn = document.getElementById('submitBtn');
    const formWrapper = document.getElementById('formWrapper');

    if (!opContainer || !repliesContainer) return;

    if (!isSilent) {
        opContainer.innerHTML = `<div style="text-align:center; padding: 20px;">Loading thread #${threadId}...</div>`;
        repliesContainer.innerHTML = "";
    }

    // Configure form for reply
    if (!isSilent) {
        if (formTitle) formTitle.innerText = `Reply to Thread #${threadId.substring(1, 9)}`;
        if (subjectInput) subjectInput.style.display = "none";
        if (submitBtn) submitBtn.innerText = "Submit Reply";
    }

    try {
        const data = await apiFetch(`/thread?id=${threadId}`);
        const th = data.thread;
        const replies = data.replies || [];

        // Check if anything in the thread actually changed
        const lastReplyId = replies.length > 0 ? replies[replies.length - 1].id : 'none';
        const currentSignature = `${th.id}_${th.is_locked}_${th.is_pinned}_${replies.length}_${lastReplyId}`;

        // If silent auto-update and nothing changed: DO NOT TOUCH THE DOM!
        if (isSilent && lastThreadSignature === currentSignature) {
            return;
        }
        lastThreadSignature = currentSignature;

        if (!isSilent) {
            const threadSubject = th.subject || (th.comment ? th.comment.substring(0, 32) + '...' : `Thread #${th.id.substring(1, 9)}`);
            document.title = `/${currentBoard}/ - ${threadSubject} | OshiMY`;
        }

        if (th.is_locked && formWrapper) {
            formWrapper.style.display = "none";
        } else if (formWrapper) {
            formWrapper.style.display = "block";
        }

        // Viewport Anchor Preservation in Thread View
        let anchorReplyId = null;
        let anchorReplyTop = 0;
        if (isSilent) {
            const visibleCards = Array.from(repliesContainer.querySelectorAll('.reply-container'));
            for (const card of visibleCards) {
                const rect = card.getBoundingClientRect();
                if (rect.bottom > 0 && rect.top < window.innerHeight) {
                    anchorReplyId = card.id;
                    anchorReplyTop = rect.top;
                    break;
                }
            }
        }

        // Render OP if not already rendered or if not silent
        if (!isSilent || !document.getElementById(`post_${th.id}`)) {
            const isOwner = MY_POSTS.includes(th.id);
            const youTag = isOwner ? ` <span style="font-weight:bold; font-style:italic; font-size:0.9em;">(You)</span>` : "";
            const pinnedBadge = th.is_pinned ? `<span style="color:#d97706; font-weight:bold; margin-right:6px;">📌 [Pinned]</span>` : '';
            const lockedBadge = th.is_locked ? `<span style="color:#dc2626; font-weight:bold; margin-right:6px;">🔒 [Locked]</span>` : '';
            const roleBadge = th.display_title ? `<span style="background:var(--main-accent); color:#fff; border-radius:4px; padding:1px 5px; font-size:0.85em; margin-right:4px;">${escapeHtml(th.display_title)}</span>` : '';
            const dateStr = new Date(th.created_at).toLocaleString();
            const mediaHtml = renderMedia(th.media_url);

            let modControls = "";
            if (currentUser && (currentUser.role === 'admin' || currentUser.role === 'mod')) {
                modControls = `
                    <span style="margin-left: 10px; font-size: 0.9em;">
                        [<a href="#" onclick="togglePin('${th.id}'); return false;">${th.is_pinned ? 'Unpin' : 'Pin'}</a>]
                        [<a href="#" onclick="toggleLock('${th.id}'); return false;">${th.is_locked ? 'Unlock' : 'Lock'}</a>]
                        [<a href="#" onclick="adminDelete('thread', '${th.id}'); return false;" style="color:red;">Delete</a>]
                    </span>
                `;
            }

            let watchControl = "";
            if (currentUser) {
                const isWatched = userWatchlistIds.has(th.id);
                watchControl = `
                    <span style="margin-left: 6px; font-size: 0.9em;">
                        [<a href="javascript:void(0)" onclick="toggleWatch('${th.id}')" id="watchBtn_${th.id}" style="${isWatched ? 'color:#eab308; font-weight:bold;' : ''}">${isWatched ? '⭐ Watching' : '⭐ Watch'}</a>]
                    </span>
                `;
            }

            opContainer.innerHTML = `
                <div class="op" id="post_${th.id}">
                    ${mediaHtml}
                    <div class="post-content">
                        <div class="post-header">
                            ${pinnedBadge}
                            ${lockedBadge}
                            <span class="subject">${escapeHtml(th.subject || '')}</span>
                            ${roleBadge}
                            <span class="name">${escapeHtml(th.name || 'Anonymous')}</span>
                            <span class="date">${dateStr}</span>
                            <span class="post-id">No. <a href="javascript:void(0)" onclick="quotePost('${th.id}', '${th.id}')">${th.id.substring(1, 9)}</a></span>
                            ${youTag}
                            ${watchControl}
                            ${modControls}
                        </div>
                        <div class="backlink-container" id="backlinks_${th.id}"></div>
                        <div class="comment">${formatComment(th.comment)}</div>
                    </div>
                </div>
                <hr style="margin: 15px 0; border-color: var(--border-color);">
            `;
        }

        // Render Replies
        if (!isSilent) {
            let repliesHtml = "";
            for (const r of replies) {
                repliesHtml += renderReplyCard(r, th.id, false);
            }
            repliesContainer.innerHTML = repliesHtml;
            generateBacklinks();
        } else {
            // In silent auto-update, only append new replies that arrived!
            const newElements = [];
            for (const r of replies) {
                if (!document.getElementById(`post_${r.id}`)) {
                    const temp = document.createElement('div');
                    temp.innerHTML = renderReplyCard(r, th.id, false);
                    const el = temp.firstElementChild;
                    repliesContainer.appendChild(el);
                    newElements.push(el);
                }
            }

            // Incremental backlinks: ONLY scan the new replies, never wipe out existing backlinks!
            for (const el of newElements) {
                generateBacklinks(el);
            }

            // Restore scroll anchor if needed
            if (anchorReplyId) {
                const restoreAnchor = () => {
                    const el = document.getElementById(anchorReplyId);
                    if (el) {
                        const diff = el.getBoundingClientRect().top - anchorReplyTop;
                        if (Math.abs(diff) > 0.5) {
                            window.scrollBy({ top: diff, behavior: 'instant' });
                        }
                    }
                };
                restoreAnchor();
                requestAnimationFrame(restoreAnchor);
            }
        }

        // Check if there was a pending quote
        if (!isSilent) {
            const pendingQuote = sessionStorage.getItem('pending_quote');
            if (pendingQuote) {
                sessionStorage.removeItem('pending_quote');
                const box = document.getElementById('commentInput');
                if (box) {
                    box.value += pendingQuote + '\n';
                    box.focus();
                }
            }

            // Check if there was a pending post to scroll & highlight
            const pendingPost = sessionStorage.getItem('pending_scroll_post');
            if (pendingPost) {
                sessionStorage.removeItem('pending_scroll_post');
                setTimeout(() => {
                    const targetEl = document.getElementById('post_' + pendingPost);
                    if (targetEl) {
                        targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        targetEl.classList.remove('post-highlight-active');
                        void targetEl.offsetWidth;
                        targetEl.classList.add('post-highlight-active');
                        setTimeout(() => targetEl.classList.remove('post-highlight-active'), 2500);
                    }
                }, 150);
            }
        }
    } catch (err) {
        if (!isSilent) {
            opContainer.innerHTML = `<div style="color:red; text-align:center;">Failed to load thread: ${err.message}</div>`;
        }
    }
}

// Render Single Reply
function renderReplyCard(r, threadId, isPreview = false) {
    const isOwner = MY_POSTS.includes(r.id);
    const youTag = isOwner ? ` <span style="font-weight:bold; font-style:italic; font-size:0.9em;">(You)</span>` : "";
    const roleBadge = r.display_title ? `<span style="background:var(--main-accent); color:#fff; border-radius:4px; padding:1px 5px; font-size:0.85em; margin-right:4px;">${escapeHtml(r.display_title)}</span>` : '';
    const dateStr = new Date(r.created_at).toLocaleString();
    const mediaHtml = renderMedia(r.media_url);

    let modControls = "";
    if (currentUser && (currentUser.role === 'admin' || currentUser.role === 'mod')) {
        modControls = `
            <span style="margin-left: 8px; font-size: 0.85em;">
                [<a href="#" onclick="adminDelete('reply', '${r.id}'); return false;" style="color:red;">Delete</a>]
            </span>
        `;
    }

    return `
        <div class="reply-container" id="post_${r.id}" style="margin-bottom: 8px;">
            <div class="reply">
                ${mediaHtml}
                <div class="post-content">
                    <div class="post-header">
                        ${roleBadge}
                        <span class="name">${escapeHtml(r.name || 'Anonymous')}</span>
                        <span class="date">${dateStr}</span>
                        <span class="post-id">No. <a href="javascript:void(0)" onclick="quotePost('${r.id}', '${threadId}')">${r.id.substring(1, 9)}</a></span>
                        ${youTag}
                        ${modControls}
                    </div>
                    <div class="backlink-container" id="backlinks_${r.id}"></div>
                    <div class="comment">${formatComment(r.comment)}</div>
                </div>
            </div>
        </div>
    `;
}

// --- POST SUBMISSION ---
document.addEventListener('DOMContentLoaded', () => {
    const postForm = document.getElementById('postForm');
    if (!postForm) return;

    postForm.onsubmit = async (e) => {
        e.preventDefault();

        const submitBtn = document.getElementById('submitBtn');
        const nameInput = document.getElementById('nameInput');
        const subjectInput = document.getElementById('subjectInput');
        const commentInput = document.getElementById('commentInput');
        const imageInput = document.getElementById('imageInput');

        if (!commentInput.value.trim()) return;

        submitBtn.disabled = true;
        submitBtn.innerText = "Posting...";

        // Validate media URL if provided
        const mediaVal = imageInput.value.trim();
        if (mediaVal && typeof validateMediaUrl === 'function') {
            const check = await validateMediaUrl(mediaVal);
            if (!check.valid) {
                if (typeof showToast === 'function') {
                    showToast(check.error || "Invalid media or image URL.");
                } else {
                    alert(check.error || "Invalid media or image URL.");
                }
                submitBtn.disabled = false;
                submitBtn.innerText = currentThreadId ? "Submit Reply" : "Create Thread";
                return;
            }
        }

        try {
            if (currentThreadId) {
                // Reply
                const res = await apiFetch('/replies', {
                    method: 'POST',
                    body: {
                        thread_id: currentThreadId,
                        board: currentBoard,
                        name: nameInput.value,
                        comment: commentInput.value,
                        media_url: imageInput.value
                    }
                });

                if (res.success && res.reply) {
                    MY_POSTS.push(res.reply.id);
                    localStorage.setItem('my_posts', JSON.stringify(MY_POSTS));
                    commentInput.value = "";
                    imageInput.value = "";
                    const badge = document.getElementById('mediaDetectedBadge');
                    if (badge) { badge.style.display = 'none'; badge.innerHTML = ''; }
                    await loadThreadView(currentThreadId);
                }
            } else {
                // New Thread
                const res = await apiFetch('/threads', {
                    method: 'POST',
                    body: {
                        board: currentBoard,
                        name: nameInput.value,
                        subject: subjectInput.value,
                        comment: commentInput.value,
                        media_url: imageInput.value
                    }
                });

                if (res.success && res.thread) {
                    MY_POSTS.push(res.thread.id);
                    localStorage.setItem('my_posts', JSON.stringify(MY_POSTS));
                    subjectInput.value = "";
                    commentInput.value = "";
                    imageInput.value = "";
                    const badge = document.getElementById('mediaDetectedBadge');
                    if (badge) { badge.style.display = 'none'; badge.innerHTML = ''; }
                    // Jump to new thread
                    window.location.hash = `#thread_${res.thread.id}`;
                }
            }
        } catch (err) {
            alert("Posting Error: " + err.message);
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerText = currentThreadId ? "Submit Reply" : "Submit Post";
        }
    };
});

// --- ADMIN / MODERATOR ACTIONS ---
async function adminDelete(type, id) {
    if (!confirm(`Are you sure you want to delete this ${type}? This cannot be undone.`)) return;

    try {
        await apiFetch('/admin/delete', {
            method: 'POST',
            body: { type, id }
        });
        if (type === 'thread' && currentThreadId === id) {
            window.location.hash = "";
        } else {
            router();
        }
    } catch (err) {
        alert("Failed to delete: " + err.message);
    }
}

async function togglePin(threadId) {
    try {
        await apiFetch('/admin/pin', {
            method: 'POST',
            body: { thread_id: threadId }
        });
        router();
    } catch (err) {
        alert("Failed to pin: " + err.message);
    }
}

async function toggleLock(threadId) {
    try {
        await apiFetch('/admin/lock', {
            method: 'POST',
            body: { thread_id: threadId }
        });
        router();
    } catch (err) {
        alert("Failed to lock: " + err.message);
    }
}

// --- AUTH & USER MANAGEMENT ---
async function initAuth() {
    if (!authToken) {
        updateAuthUI(null);
        syncUserPerks();
        return;
    }

    try {
        const data = await apiFetch('/auth/me');
        currentUser = data.user;
        updateAuthUI(currentUser);
        syncUserPerks();
    } catch {
        localStorage.removeItem('myvt_token');
        authToken = null;
        currentUser = null;
        updateAuthUI(null);
        syncUserPerks();
    }
}

function updateAuthUI(user) {
    const authStatusEl = document.getElementById('authStatus');
    if (authStatusEl) {
        if (user) {
            const badge = user.display_title ? ` (${user.display_title})` : ` [${user.role}]`;
            authStatusEl.innerHTML = `
                [ <b>@${escapeHtml(user.username)}</b>${badge} ]
                [ <a href="javascript:void(0)" onclick="logout()">Logout</a> ]
            `;
        } else {
            authStatusEl.innerHTML = `
                [ <a href="javascript:void(0)" onclick="openAuthModal('login')">Login</a> ]
                [ <a href="javascript:void(0)" onclick="openAuthModal('register')">Register</a> ]
            `;
        }
    }

    const bannerAdmin = document.getElementById('bannerAdminControl');
    if (bannerAdmin) {
        bannerAdmin.style.display = (user && user.role === 'admin') ? 'block' : 'none';
    }
}

function openAuthModal(mode = 'login') {
    const modal = document.getElementById('authModal');
    if (!modal) return;
    modal.style.display = 'flex';
    setAuthMode(mode);
}

function closeAuthModal() {
    const modal = document.getElementById('authModal');
    if (modal) modal.style.display = 'none';
}

function setAuthMode(mode) {
    const title = document.getElementById('authModalTitle');
    const submitBtn = document.getElementById('authSubmitBtn');
    const toggleText = document.getElementById('authToggleText');
    const form = document.getElementById('authForm');
    if (!form) return;

    form.dataset.mode = mode;
    if (mode === 'login') {
        title.innerText = "Member / Staff Login";
        submitBtn.innerText = "Login";
        toggleText.innerHTML = `Don't have an account? <a href="javascript:void(0)" onclick="setAuthMode('register')">Register here</a>`;
    } else {
        title.innerText = "Register New Account";
        submitBtn.innerText = "Register";
        toggleText.innerHTML = `Already have an account? <a href="javascript:void(0)" onclick="setAuthMode('login')">Login here</a>`;
    }
}

async function handleAuthSubmit(e) {
    e.preventDefault();
    const form = document.getElementById('authForm');
    const mode = form.dataset.mode || 'login';
    const username = document.getElementById('authUsername').value.trim();
    const password = document.getElementById('authPassword').value;
    const msg = document.getElementById('authMessage');

    msg.innerText = "";
    try {
        const endpoint = mode === 'login' ? '/auth/login' : '/auth/register';
        const res = await apiFetch(endpoint, {
            method: 'POST',
            body: { username, password }
        });

        if (res.success && res.token) {
            authToken = res.token;
            localStorage.setItem('myvt_token', authToken);
            currentUser = res.user;
            updateAuthUI(currentUser);
            closeAuthModal();
            syncUserPerks();
            router();
        }
    } catch (err) {
        msg.innerText = err.message;
    }
}

async function logout() {
    try {
        await apiFetch('/auth/logout', { method: 'POST' });
    } catch {}
    localStorage.removeItem('myvt_token');
    authToken = null;
    currentUser = null;
    updateAuthUI(null);
    syncUserPerks();
    router();
}

// --- USER PERKS: CROSS-DEVICE (YOU), WATCHLIST & NOTIFICATIONS ---
async function syncUserPerks() {
    const notifNav = document.getElementById('notifNav');
    const watchNav = document.getElementById('watchNav');

    if (!currentUser) {
        userWatchlistIds.clear();
        if (notifNav) notifNav.style.display = 'none';
        if (watchNav) watchNav.style.display = 'none';
        return;
    }

    if (notifNav) notifNav.style.display = 'inline';
    if (watchNav) watchNav.style.display = 'inline';

    // 1. Cross-Device (You) sync
    try {
        const postsData = await apiFetch('/user/my-posts');
        if (postsData.success && Array.isArray(postsData.post_ids)) {
            let updated = false;
            for (const pid of postsData.post_ids) {
                if (!MY_POSTS.includes(pid)) {
                    MY_POSTS.push(pid);
                    updated = true;
                }
            }
            if (updated) {
                localStorage.setItem('my_posts', JSON.stringify(MY_POSTS));
            }
        }
    } catch (e) {
        console.warn('Failed to sync (You) posts:', e);
    }

    // 2. Watchlist sync
    try {
        const watchData = await apiFetch('/user/watchlist');
        if (watchData.success && Array.isArray(watchData.watchlist)) {
            userWatchlistIds = new Set(watchData.watchlist.map(t => t.id));
            const badge = document.getElementById('watchlistBadge');
            if (badge) badge.innerText = `(${userWatchlistIds.size})`;
        }
    } catch (e) {
        console.warn('Failed to sync watchlist:', e);
    }

    // 3. Reply notifications sync
    try {
        const notifData = await apiFetch('/user/notifications');
        if (notifData.success && Array.isArray(notifData.notifications)) {
            const lastSeen = parseInt(localStorage.getItem('myvt_last_seen_notif') || '0', 10);
            const unread = notifData.notifications.filter(n => n.created_at > lastSeen).length;
            const badge = document.getElementById('replyBadge');
            if (badge) {
                if (unread > 0) {
                    badge.innerText = unread;
                    badge.style.display = 'inline';
                } else {
                    badge.style.display = 'none';
                }
            }
        }
    } catch (e) {
        console.warn('Failed to sync notifications:', e);
    }
}

async function toggleWatch(threadId) {
    if (!currentUser) {
        openAuthModal('login');
        return;
    }
    try {
        const res = await apiFetch('/user/watchlist/toggle', {
            method: 'POST',
            body: { thread_id: threadId }
        });
        if (res.success) {
            if (res.watched) {
                userWatchlistIds.add(threadId);
            } else {
                userWatchlistIds.delete(threadId);
            }
            const badge = document.getElementById('watchlistBadge');
            if (badge) badge.innerText = `(${userWatchlistIds.size})`;

            // Update any visible watch buttons
            const btns = document.querySelectorAll(`[id^="watchBtn_${threadId}"]`);
            btns.forEach(btn => {
                btn.innerText = res.watched ? '⭐ Watching' : '⭐ Watch';
                btn.style.color = res.watched ? '#eab308' : '';
                btn.style.fontWeight = res.watched ? 'bold' : '';
            });
        }
    } catch (err) {
        alert("Failed to update watchlist: " + err.message);
    }
}

async function openWatchlistModal() {
    const modal = document.getElementById('watchlistModal');
    const container = document.getElementById('watchlistContent');
    if (!modal || !container) return;

    modal.style.display = 'flex';
    container.innerHTML = '<div style="text-align:center; opacity:0.6; padding:20px;">Loading watchlist...</div>';

    try {
        const res = await apiFetch('/user/watchlist');
        if (!res.success || !res.watchlist || res.watchlist.length === 0) {
            container.innerHTML = `
                <div style="text-align:center; padding:30px; opacity:0.75;">
                    <div style="font-size:2rem; margin-bottom:8px;">⭐</div>
                    <div style="font-weight:bold; margin-bottom:4px;">No watched threads yet</div>
                    <div style="font-size:0.9em;">Click <b>[⭐ Watch]</b> on any thread to track new replies and discussions across your devices!</div>
                </div>
            `;
            return;
        }

        userWatchlistIds = new Set(res.watchlist.map(t => t.id));
        const badge = document.getElementById('watchlistBadge');
        if (badge) badge.innerText = `(${userWatchlistIds.size})`;

        let html = '';
        for (const th of res.watchlist) {
            const timeAgo = formatTimeAgo(th.bumped_at);
            const title = escapeHtml(th.subject || th.comment.substring(0, 50) + '...');
            html += `
                <div style="border:1px solid var(--border-color); border-radius:6px; padding:10px; background:rgba(0,0,0,0.03); display:flex; justify-content:space-between; align-items:center; gap:10px;">
                    <div style="min-width:0; flex-grow:1;">
                        <div style="font-size:0.85em; opacity:0.8; margin-bottom:2px;">
                            <span style="font-weight:bold; color:var(--main-accent);">/${th.board}/</span> • ${th.reply_count} replies • Last bumped ${timeAgo}
                        </div>
                        <a href="?b=${th.board}#thread_${th.id}" onclick="closeWatchlistModal()" style="font-weight:bold; text-decoration:none; color:var(--text-color); font-size:0.95em; display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                            ${title}
                        </a>
                    </div>
                    <div style="display:flex; gap:6px; flex-shrink:0;">
                        <a href="?b=${th.board}#thread_${th.id}" onclick="closeWatchlistModal()" style="padding:4px 8px; background:var(--main-accent); color:#fff; border-radius:4px; font-size:0.8em; text-decoration:none; font-weight:bold;">Visit ➜</a>
                        <button onclick="unwatchFromModal('${th.id}')" style="padding:4px 8px; background:none; border:1px solid var(--border-color); border-radius:4px; font-size:0.8em; cursor:pointer; color:var(--text-color);">✕</button>
                    </div>
                </div>
            `;
        }
        container.innerHTML = html;
    } catch (err) {
        container.innerHTML = `<div style="color:red; text-align:center; padding:20px;">Failed to load watchlist: ${err.message}</div>`;
    }
}

function closeWatchlistModal() {
    const modal = document.getElementById('watchlistModal');
    if (modal) modal.style.display = 'none';
}

async function unwatchFromModal(threadId) {
    await toggleWatch(threadId);
    openWatchlistModal();
}

async function openNotificationsModal() {
    const modal = document.getElementById('notificationsModal');
    const container = document.getElementById('notificationsList');
    if (!modal || !container) return;

    modal.style.display = 'flex';
    container.innerHTML = '<div style="text-align:center; opacity:0.6; padding:20px;">Loading notifications...</div>';

    // Update last seen timestamp
    localStorage.setItem('myvt_last_seen_notif', Date.now().toString());
    const badge = document.getElementById('replyBadge');
    if (badge) badge.style.display = 'none';

    try {
        const res = await apiFetch('/user/notifications');
        if (!res.success || !res.notifications || res.notifications.length === 0) {
            container.innerHTML = `
                <div style="text-align:center; padding:30px; opacity:0.75;">
                    <div style="font-size:2rem; margin-bottom:8px;">🔔</div>
                    <div style="font-weight:bold; margin-bottom:4px;">No replies yet</div>
                    <div style="font-size:0.9em;">When someone replies to your threads or quotes your comments (&gt;&gt;No.), you'll be notified here!</div>
                </div>
            `;
            return;
        }

        let html = '';
        for (const n of res.notifications) {
            const timeAgo = formatTimeAgo(n.created_at);
            const snippet = escapeHtml(n.comment.length > 120 ? n.comment.substring(0, 120) + '...' : n.comment);
            const poster = escapeHtml(n.name || 'Anonymous');
            html += `
                <div style="border:1px solid var(--border-color); border-radius:6px; padding:10px; background:rgba(0,0,0,0.03);">
                    <div style="display:flex; justify-content:space-between; font-size:0.8em; opacity:0.8; margin-bottom:4px;">
                        <span><b style="color:var(--main-accent);">/${n.board}/</b> in <i>${escapeHtml(n.subject || 'Thread')}</i></span>
                        <span>${timeAgo}</span>
                    </div>
                    <div style="font-size:0.85em; font-weight:bold; color:var(--text-color); margin-bottom:4px;">
                        ${poster} replied:
                    </div>
                    <div style="font-size:0.9em; margin-bottom:6px; font-style:italic;">
                        "${snippet}"
                    </div>
                    <div style="text-align:right;">
                        <a href="?b=${n.board}#thread_${n.thread_id}" onclick="closeNotificationsModal()" style="font-size:0.8em; font-weight:bold; color:var(--main-accent); text-decoration:none;">
                            View in Thread [➜]
                        </a>
                    </div>
                </div>
            `;
        }
        container.innerHTML = html;
    } catch (err) {
        container.innerHTML = `<div style="color:red; text-align:center; padding:20px;">Failed to load notifications: ${err.message}</div>`;
    }
}

function closeNotificationsModal() {
    const modal = document.getElementById('notificationsModal');
    if (modal) modal.style.display = 'none';
}

function formatTimeAgo(ts) {
    const diff = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
}

// --- 4CHAN-STYLE AUTO-POLLING ---
function startAutoUpdate() {
    if (autoUpdateTimer) clearInterval(autoUpdateTimer);
    autoUpdateTimer = setInterval(() => {
        if (!isAutoUpdateEnabled) return;
        if (document.hidden) return; // Don't poll if browser tab is in background

        // Also sync notifications and watchlist silently in background
        if (currentUser) {
            syncUserPerks();
        }

        // Detect if archive view
        const isArch = new URLSearchParams(window.location.search).get('view') === 'archive';

        if (currentThreadId) {
            loadThreadView(currentThreadId, true); // true = silent background update
        } else if (currentBoard) {
            loadBoardView(isArch, true); // true = silent background update
        }
    }, 15000); // 15 seconds
}

function toggleAutoUpdate() {
    isAutoUpdateEnabled = !isAutoUpdateEnabled;
    const btn = document.getElementById('autoUpdateToggle');
    if (btn) {
        btn.innerText = isAutoUpdateEnabled ? "Auto-Update: On (15s)" : "Auto-Update: Off";
        btn.style.color = isAutoUpdateEnabled ? "var(--main-accent)" : "#888";
    }
}
