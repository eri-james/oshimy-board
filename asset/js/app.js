// ==========================================
// APP.JS - Core Logic, Routing, Rendering
// Connected to Cloudflare D1 / SQLite REST API
// ==========================================

let userWatchlistIds = new Set();

// --- NSFW GATE & GLOBAL BLUR TOGGLE ---
let nsfwBlurEnabled = localStorage.getItem('oshimy_nsfw_blur') !== 'off';

function applyNsfwBlurState() {
    const isNsfwBoard = Boolean(currentBoard && BOARDS[currentBoard] && BOARDS[currentBoard].type === 'nsfw');
    if (isNsfwBoard && !nsfwBlurEnabled) {
        document.body.classList.add('nsfw-blur-off');
    } else {
        document.body.classList.remove('nsfw-blur-off');
    }
}

function toggleNsfwBlur() {
    nsfwBlurEnabled = !nsfwBlurEnabled;
    localStorage.setItem('oshimy_nsfw_blur', nsfwBlurEnabled ? 'on' : 'off');
    applyNsfwBlurState();
    renderBoardNav();
    if (typeof showToast === 'function') {
        showToast(
            nsfwBlurEnabled
                ? 'NSFW Blur: ON (Hover media to reveal)'
                : 'NSFW Blur: OFF (All media unblurred)',
            2500
        );
    }
}

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
    if (typeof initGamification === 'function') initGamification();
    initQuickReply();
    initKeyboardNavigation();
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

    const urlParam = new URLSearchParams(window.location.search);
    if (urlParam.get('b') && BOARDS[urlParam.get('b')]) {
        currentBoard = urlParam.get('b');
    }

    let targetThreadId = null;
    let postPart = null;

    if (hash.startsWith("#thread_")) {
        let threadPart = hash.replace("#thread_", "");
        if (threadPart.includes("#post_")) {
            const splitHash = threadPart.split("#post_");
            threadPart = splitHash[0];
            postPart = splitHash[1];
        }
        targetThreadId = threadPart;
    } else if (urlParam.get('t') || urlParam.get('thread')) {
        targetThreadId = urlParam.get('t') || urlParam.get('thread');
        if (hash.startsWith("#post_")) {
            postPart = hash.replace("#post_", "");
        } else if (urlParam.get('r') || urlParam.get('reply')) {
            postPart = urlParam.get('r') || urlParam.get('reply');
        }
    }

    // 1. DIRECT THREAD MODE (via hash #thread_ or search param ?t= or ?thread=)
    if (targetThreadId) {
        if (homeView) homeView.style.display = "none";
        if (boardView) boardView.style.display = "none";
        if (threadView) threadView.style.display = "block";
        if (formWrapper) formWrapper.style.display = "block";
        if (topDivider) topDivider.style.display = "block";
        currentThreadId = targetThreadId;
        lastThreadSignature = "";

        // If board is known from query param or current state, apply board theme and title immediately
        if (currentBoard && BOARDS[currentBoard]) {
            document.title = `${BOARDS[currentBoard].title} | OshiMY`;
            document.getElementById('boardTitle').innerText = BOARDS[currentBoard].title;
            if (BOARDS[currentBoard].type === 'nsfw') {
                document.body.classList.add('night-mode');
            } else {
                document.body.classList.remove('night-mode');
            }
            applyNsfwBlurState();
        }

        if (postPart) {
            sessionStorage.setItem('pending_scroll_post', postPart);
        }

        loadThreadView(currentThreadId);
        renderBoardNav();
        return;
    }

    // 2. HOME PAGE (No Board Selected)
    if (!currentBoard || !BOARDS[currentBoard]) {
        document.body.classList.remove('nsfw-blur-off');
        if (homeView) homeView.style.display = "block";
        if (boardView) boardView.style.display = "none";
        if (threadView) threadView.style.display = "none";
        if (formWrapper) formWrapper.style.display = "none";
        if (topDivider) topDivider.style.display = "none";
        document.getElementById('boardTitle').innerText = "OshiMY - Portal";
        document.title = "OshiMY - Malaysian VTuber & Otaku Imageboard";
        renderBoardNav();
        loadPortalStats();
        return;
    }

    // 3. BOARD MODE
    if (homeView) homeView.style.display = "none";
    if (topDivider) topDivider.style.display = "block";
    
    // Set Titles & Theme
    document.title = `${BOARDS[currentBoard].title} | OshiMY`;
    document.getElementById('boardTitle').innerText = BOARDS[currentBoard].title;
    
    if (BOARDS[currentBoard].type === 'nsfw') {
        document.body.classList.add('night-mode');
    }
    applyNsfwBlurState();

    // Check Gate
    if (!checkNSFWGate()) return;

    const isArchiveView = urlParam.get('view') === 'archive';
    currentThreadId = null;
    lastBoardSignature = "";
    if (threadView) threadView.style.display = "none";
    if (boardView) boardView.style.display = "block";
    if (formWrapper) formWrapper.style.display = isArchiveView ? "none" : "block"; 
    loadBoardView(isArchiveView);

    renderBoardNav();
}

function returnToBoard() {
    if (currentBoard && BOARDS[currentBoard]) {
        // If query parameters contain ?t= or ?thread=, remove them and retain board
        const url = `?b=${currentBoard}`;
        if (window.location.search.includes('t=') || window.location.search.includes('thread=')) {
            window.location.href = url;
            return;
        }
        window.location.hash = '';
        router();
    } else {
        window.location.href = 'index.html';
    }
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

    // Add Index / Catalog / Archive Toggles if inside a board
    if (currentBoard && BOARDS[currentBoard]) {
        const isArch = new URLSearchParams(window.location.search).get('view') === 'archive';
        const isCat = typeof isCatalogMode === 'function' ? isCatalogMode() : false;

        const indexStyle = (!isCat && !isArch) ? 'style="font-weight:900; color:var(--main-accent); border-bottom:1px solid;"' : '';
        const catStyle = (isCat && !isArch) ? 'style="font-weight:900; color:var(--main-accent); border-bottom:1px solid;"' : '';

        html += ` [ <a href="javascript:void(0)" onclick="setBoardMode('index')" ${indexStyle}>📋 Index</a> | <a href="javascript:void(0)" onclick="setBoardMode('catalog')" ${catStyle}>🗂️ Catalog</a> ]`;

        const archLabel = isArch ? '⚡ Active' : '📦 Archive';
        const archHref = isArch ? `?b=${currentBoard}` : `?b=${currentBoard}&view=archive`;
        html += ` [ <a href="${archHref}" style="opacity:0.85; font-style:italic;">${archLabel}</a> ]`;

        if (currentType === 'nsfw') {
            const blurStateLabel = nsfwBlurEnabled ? 'Blur: ON' : 'Blur: OFF';
            const btnActiveClass = nsfwBlurEnabled ? '' : ' blur-off-active';
            const btnTitle = nsfwBlurEnabled
                ? 'NSFW Blur is ON (Hover media to reveal). Click to unblur all media.'
                : 'NSFW Blur is OFF (All media visible). Click to re-enable media blur.';
            html += ` <button type="button" id="nsfwBlurToggleBtn" class="nsfw-blur-toggle-btn${btnActiveClass}" onclick="toggleNsfwBlur()" title="${btnTitle}" aria-pressed="${!nsfwBlurEnabled}">
                <svg class="nsfw-eye-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                    <circle cx="12" cy="12" r="3"></circle>
                </svg>
                <span>${blurStateLabel}</span>
            </button>`;
        }
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
let currentBoardViewMode = localStorage.getItem('oshimy_board_mode') || 'index';
let cachedBoardThreads = [];
let catalogFilterQuery = "";
let catalogSortCriteria = "bump";

// Navigation AbortController for race condition prevention
let navAbortController = null;

function cancelPendingNavFetch() {
    if (navAbortController) {
        try {
            navAbortController.abort();
        } catch (e) {}
        navAbortController = null;
    }
}

function isCatalogMode() {
    const urlParam = new URLSearchParams(window.location.search).get('view');
    if (urlParam === 'catalog') return true;
    if (urlParam === 'archive') return false;
    return currentBoardViewMode === 'catalog';
}

function setBoardMode(mode) {
    if (currentBoardViewMode === mode) return;
    currentBoardViewMode = mode;
    localStorage.setItem('oshimy_board_mode', mode);
    renderBoardNav();

    // Optimization 1: Zero-network switch if current board threads are already cached in memory
    if (cachedBoardThreads && cachedBoardThreads.length > 0 && currentBoard) {
        renderCurrentBoardData(cachedBoardThreads);
        return;
    }
    loadBoardView(false, false);
}

function renderCurrentBoardData(threads) {
    const container = document.getElementById('threadList');
    const catalogToolbar = document.getElementById('catalogToolbar');
    const catalogGrid = document.getElementById('catalogGrid');
    const formWrapper = document.getElementById('formWrapper');
    if (!container) return;

    const isCatalog = isCatalogMode();

    if (isCatalog) {
        container.style.display = 'none';
        if (catalogToolbar) catalogToolbar.style.display = 'flex';
        if (catalogGrid) catalogGrid.style.display = 'grid';
        if (formWrapper) formWrapper.style.display = 'none';
        renderCatalogGrid(threads);
    } else {
        container.style.display = 'block';
        if (catalogToolbar) catalogToolbar.style.display = 'none';
        if (catalogGrid) catalogGrid.style.display = 'none';
        if (formWrapper) formWrapper.style.display = 'block';

        let html = "";
        for (const th of threads) {
            html += renderThreadPreview(th);
        }
        container.innerHTML = html;
        generateBacklinks();
    }
}

function handleCatalogSearch(val) {
    catalogFilterQuery = val || "";
    renderCatalogGrid(cachedBoardThreads);
}

function handleCatalogSort(val) {
    catalogSortCriteria = val || "bump";
    renderCatalogGrid(cachedBoardThreads);
}

function renderCatalogGrid(threads) {
    const grid = document.getElementById('catalogGrid');
    const stats = document.getElementById('catalogStats');
    if (!grid) return;

    let list = [...(threads || [])];

    // Filter
    if (catalogFilterQuery.trim()) {
        const q = catalogFilterQuery.toLowerCase();
        list = list.filter(t => 
            (t.subject && t.subject.toLowerCase().includes(q)) ||
            (t.comment && t.comment.toLowerCase().includes(q)) ||
            (t.name && t.name.toLowerCase().includes(q))
        );
    }

    // Sort
    if (catalogSortCriteria === 'date') {
        list.sort((a, b) => b.created_at - a.created_at);
    } else if (catalogSortCriteria === 'replies') {
        list.sort((a, b) => (b.reply_count || 0) - (a.reply_count || 0));
    } // default is bump order (already sorted by server)

    if (stats) {
        stats.innerText = `${list.length} ${list.length === 1 ? 'thread' : 'threads'}`;
    }

    if (list.length === 0) {
        grid.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; padding: 40px; opacity: 0.7;">No matching threads found in catalog.</div>`;
        return;
    }

    let html = "";
    for (const th of list) {
        const isSpoilerThumb = typeof isSpoilerMediaUrl === 'function' && isSpoilerMediaUrl(th.media_url);
        const spoilerOverlay = (isSpoilerThumb && typeof getSpoilerOverlayHtml === 'function') ? getSpoilerOverlayHtml(true) : '';
        const thumb = getCatalogThumbnail(th.media_url);
        const subject = escapeHtml(th.subject || 'No Subject');
        const snippet = escapeHtml((th.comment || '').replace(/\n+/g, ' ')).substring(0, 90);
        const replies = th.reply_count || 0;
        const pinned = th.is_pinned ? '📌 ' : '';
        const locked = th.is_locked ? '🔒 ' : '';
        const dateStr = new Date(th.bumped_at || th.created_at).toLocaleDateString();

        html += `
            <a href="?b=${currentBoard}&t=${th.id}" class="catalog-tile" id="cat_${th.id}">
                <div class="catalog-thumb-container${isSpoilerThumb ? ' spoiler-media' : ''}">
                    ${thumb}
                    ${spoilerOverlay}
                    <span class="catalog-badge-overlay">R: ${replies}</span>
                </div>
                <div class="catalog-info">
                    <div class="catalog-subject">${pinned}${locked}${subject}</div>
                    <div class="catalog-snippet">${snippet}</div>
                </div>
                <div class="catalog-meta">
                    <span>No.${th.id.substring(1, 8)}</span>
                    <span>${dateStr}</span>
                </div>
            </a>
        `;
    }

    grid.innerHTML = html;

    if (typeof hydratePixivEmbeds === 'function') hydratePixivEmbeds();
    if (typeof hydrateTwitterEmbeds === 'function') hydrateTwitterEmbeds();
    if (typeof hydrateRedditEmbeds === 'function') hydrateRedditEmbeds();
}

function getCatalogThumbnail(mediaUrl) {
    if (!mediaUrl || !mediaUrl.trim()) {
        return `<div class="catalog-placeholder-icon">💬</div>`;
    }
    const media = typeof getMediaType === 'function' ? getMediaType(mediaUrl) : null;
    if (!media) {
        return `<div class="catalog-placeholder-icon">💬</div>`;
    }

    if (media.type === 'youtube') {
        const thumb = `https://i.ytimg.com/vi_webp/${media.id}/mqdefault.webp`;
        const jpgFallback = `https://i.ytimg.com/vi/${media.id}/mqdefault.jpg`;
        return `<img src="${thumb}" onerror="if(this.src!=='${jpgFallback}')this.src='${jpgFallback}';" class="catalog-thumb" alt="YouTube Thumbnail" loading="lazy" decoding="async">`;
    }
    if (media.type === 'x') {
        const cleanHandle = media.handle || 'i';
        return `
            <div class="x-placeholder" data-tweet-id="${media.id}" data-tweet-handle="${escapeHtml(cleanHandle)}" style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; border:none;">
                <div class="tweet-thumb-slot" style="width:100%; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center;">
                    <div class="catalog-placeholder-icon" style="color:#1DA1F2;">𝕏</div>
                </div>
            </div>
        `;
    }
    if (media.type === 'reddit') {
        return `
            <div class="reddit-placeholder" data-reddit-url="${escapeHtml(media.url)}" style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; border:none;">
                <div class="reddit-thumb-slot" style="width:100%; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center;">
                    <div class="catalog-placeholder-icon" style="color:#FF4500;">🤖</div>
                </div>
            </div>
        `;
    }
    if (media.type === 'reddit_video') {
        return `<div class="catalog-placeholder-icon" style="color:#FF4500;">🎥</div>`;
    }
    if (media.type === 'pixiv') {
        const thumb = `https://pixiv.re/${media.id}.jpg`;
        return `<img src="${thumb}" class="catalog-thumb" alt="Pixiv #${media.id}" loading="lazy" decoding="async" onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'catalog-placeholder-icon\\' style=\\'color:#0096fa;\\'>🎨</div>';">`;
    }
    if (media.type === 'pixiv_image') {
        const primarySrc = media.proxyUrl || `/api/proxy/pixiv?url=${encodeURIComponent(media.url)}`;
        const helperFallback = media.helperUrl || media.url.replace(/^https?:\/\/[a-zA-Z0-9-]+\.pximg\.net\//i, 'https://i.pixiv.re/');
        return `<img src="${escapeHtml(primarySrc)}" class="catalog-thumb" alt="Pixiv Image" loading="lazy" decoding="async" onerror="if(this.dataset.triedHelper!=='true'){this.dataset.triedHelper='true';this.src='${escapeHtml(helperFallback)}';}else{this.onerror=null;this.parentElement.innerHTML='<div class=\\'catalog-placeholder-icon\\' style=\\'color:#0096fa;\\'>🎨</div>';}">`;
    }
    if (media.type === 'video') {
        return `<video src="${escapeHtml(media.url)}#t=0.001" preload="metadata" muted playsinline class="catalog-thumb" style="pointer-events:none;"></video>`;
    }
    if (media.type === 'audio') {
        return `<div class="catalog-placeholder-icon">🎵</div>`;
    }
    const optThumb = typeof getOptimizedThumbUrl === 'function' ? getOptimizedThumbUrl(media.url, 260) : media.url;
    return `<img src="${escapeHtml(optThumb)}" class="catalog-thumb" alt="Thumbnail" loading="lazy" decoding="async" onerror="if(this.src!=='${escapeHtml(media.url)}'){this.src='${escapeHtml(media.url)}';}else{this.onerror=null; this.parentElement.innerHTML='<div class=\\'catalog-placeholder-icon\\'>🖼️</div>';}">`;
}

// --- ANONYMOUS PER-THREAD POSTER IDS, OSHI FAN-NAMES, DECOUPLED VANITY & STAMP REACTIONS ---
const CLIENT_BOARD_FAN_NAMES = {
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

const STAMP_DEFINITIONS = [
    { key: 'kusa',      emoji: '🌿', label: 'Kusa',      title: 'Kusa / LOL (草)' },
    { key: 'tskr',      emoji: '🙏', label: 'TSKR',      title: 'Tasikaru / Blessed' },
    { key: 'uoooh',     emoji: '😭', label: 'Uoooh',     title: 'Uoooh / Cute & Funny' },
    { key: 'ikz',       emoji: '🔥', label: 'IKZ',       title: 'Ikuzo! / Let\'s Go!' },
    { key: 'oshi',      emoji: '💖', label: 'Oshi',      title: 'Gachikoi / My Oshi' },
    { key: 'glowstick', emoji: '🥖', label: 'Wotagei',   title: 'Penlight / Wotagei Cheer' }
];

let activeHighlightedPosterId = null;

function rollBoardFanName() {
    const nameInput = document.getElementById('nameInput');
    if (!nameInput) return;
    const list = CLIENT_BOARD_FAN_NAMES[currentBoard] || CLIENT_BOARD_FAN_NAMES['myvt'];
    const currentVal = nameInput.value.trim();
    const candidates = list.filter(n => n !== currentVal);
    const chosen = candidates[Math.floor(Math.random() * candidates.length)] || list[0];
    nameInput.value = chosen;
    const postAnonToggle = document.getElementById('postAnonToggle');
    if (postAnonToggle) postAnonToggle.checked = true;
}

function syncIdentityFormState() {
    const nameInput = document.getElementById('nameInput');
    const postAnonToggle = document.getElementById('postAnonToggle');
    if (!nameInput || !currentUser) return;

    if (postAnonToggle && !postAnonToggle.checked) {
        nameInput.value = currentUser.username;
    } else if (nameInput.value === currentUser.username) {
        nameInput.value = 'Anonymous';
    }
}

function getPostIdentityPayload(rawName) {
    const postAnonToggle = document.getElementById('postAnonToggle');
    const showVanityToggle = document.getElementById('showVanityToggle');
    const guestFlairSelect = document.getElementById('guestOshiFlairSelect');

    const postAsAnon = currentUser ? (postAnonToggle ? postAnonToggle.checked : true) : true;
    const showVanity = currentUser ? (showVanityToggle ? showVanityToggle.checked : true) : false;
    const selectedFlair = guestFlairSelect ? guestFlairSelect.value : '';

    let effectiveName = (rawName || '').trim();
    if (currentUser && !postAsAnon && (!effectiveName || effectiveName.toLowerCase() === 'anonymous')) {
        effectiveName = currentUser.username;
    }

    return {
        name: effectiveName || 'Anonymous',
        post_as_anonymous: postAsAnon,
        show_vanity_flair: showVanity,
        guest_flair: selectedFlair ? { oshiBadge: selectedFlair } : null
    };
}

function renderPosterIdBadge(posterId) {
    if (!posterId) return '';
    const clean = String(posterId).substring(0, 8);
    let hash = 0;
    for (let i = 0; i < clean.length; i++) {
        hash = clean.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    const isActive = activeHighlightedPosterId === clean ? ' poster-id-active' : '';
    return `<span class="poster-id-pill${isActive}" data-poster-id="${escapeHtml(clean)}" onclick="highlightPosterId('${escapeHtml(clean)}', event)" style="--pid-hue: ${hue};" title="Anonymous Thread ID (Click to highlight all posts by ID: ${escapeHtml(clean)})">ID: ${escapeHtml(clean)}</span>`;
}

function highlightPosterId(posterId, event) {
    if (event) event.stopPropagation();
    if (!posterId) return;

    if (activeHighlightedPosterId === posterId) {
        activeHighlightedPosterId = null;
    } else {
        activeHighlightedPosterId = posterId;
    }

    const allPills = document.querySelectorAll('.poster-id-pill');
    let matchCount = 0;
    allPills.forEach(pill => {
        const pid = pill.getAttribute('data-poster-id');
        const postCard = pill.closest('.op, .reply');
        if (activeHighlightedPosterId && pid === activeHighlightedPosterId) {
            pill.classList.add('poster-id-active');
            if (postCard) postCard.classList.add('poster-id-card-highlight');
            matchCount++;
        } else {
            pill.classList.remove('poster-id-active');
            if (postCard) postCard.classList.remove('poster-id-card-highlight');
        }
    });

    if (activeHighlightedPosterId && typeof showToast === 'function') {
        showToast(`Highlighted ${matchCount} ${matchCount === 1 ? 'post' : 'posts'} by ID: ${posterId}`, 2200, 'info');
    }
}

function renderVanityFlairBadges(vanityFlairRaw) {
    if (!vanityFlairRaw) return '';
    let flair = null;
    try {
        flair = typeof vanityFlairRaw === 'string' ? JSON.parse(vanityFlairRaw) : vanityFlairRaw;
    } catch (_) {
        return '';
    }
    if (!flair || typeof flair !== 'object') return '';

    let html = '';
    if (flair.rankTitle && flair.rankBadge) {
        html += `<span class="vanity-rank-pill" title="Verified Anonymous Rank Flair (Decoupled from Account Identity)">${escapeHtml(flair.rankBadge)} Lv.${flair.level || 1} ${escapeHtml(flair.rankTitle)}</span>`;
    }
    if (flair.streak && flair.streak > 1) {
        html += `<span class="vanity-streak-pill" title="${flair.streak}-Day Oshi Omikuji Streak">🔥 ${flair.streak}d</span>`;
    }
    if (flair.oshiBadge) {
        html += `<span class="vanity-oshi-pill" title="Oshi Agency Flair">${escapeHtml(flair.oshiBadge)}</span>`;
    }
    return html;
}

function getMyStampedSet() {
    try {
        const arr = JSON.parse(localStorage.getItem('oshimy_my_stamps') || '[]');
        return new Set(Array.isArray(arr) ? arr : []);
    } catch (_) {
        return new Set();
    }
}

function saveMyStampedSet(set) {
    try {
        localStorage.setItem('oshimy_my_stamps', JSON.stringify(Array.from(set)));
    } catch (_) {}
}

function renderStampReactionsBar(postId, postType, reactionsRaw) {
    if (!postId || String(postId).startsWith('opt_')) return '';
    let counts = {};
    try {
        counts = typeof reactionsRaw === 'string' ? JSON.parse(reactionsRaw || '{}') : (reactionsRaw || {});
    } catch (_) {
        counts = {};
    }
    const myStamps = getMyStampedSet();

    const buttonsHtml = STAMP_DEFINITIONS.map(st => {
        const c = parseInt(counts[st.key], 10) || 0;
        const isMine = myStamps.has(`${postId}:${st.key}`);
        const activeClass = isMine ? ' stamp-btn-active' : '';
        const hasCountClass = c > 0 ? ' stamp-btn-has-count' : '';
        return `<button type="button" class="stamp-reaction-btn${activeClass}${hasCountClass}" data-post-id="${escapeHtml(postId)}" data-stamp="${st.key}" onclick="togglePostReaction('${escapeHtml(postId)}', '${postType}', '${st.key}', this)" title="${escapeHtml(st.title)}"><span class="stamp-emoji">${st.emoji}</span><span class="stamp-label">${st.label}</span><span class="stamp-count">${c > 0 ? c : ''}</span></button>`;
    }).join('');

    return `<div class="stamp-reactions-bar" id="stamps_${escapeHtml(postId)}">${buttonsHtml}</div>`;
}

async function togglePostReaction(postId, postType, stamp, btnEl) {
    if (!postId || !stamp) return;
    const myStamps = getMyStampedSet();
    const key = `${postId}:${stamp}`;
    const wasActive = myStamps.has(key);

    // Optimistic UI update
    const countEl = btnEl ? btnEl.querySelector('.stamp-count') : null;
    let curCount = countEl ? (parseInt(countEl.innerText, 10) || 0) : 0;
    if (wasActive) {
        myStamps.delete(key);
        curCount = Math.max(0, curCount - 1);
        if (btnEl) btnEl.classList.remove('stamp-btn-active');
    } else {
        myStamps.add(key);
        curCount = curCount + 1;
        if (btnEl) btnEl.classList.add('stamp-btn-active');
    }
    saveMyStampedSet(myStamps);
    if (countEl) countEl.innerText = curCount > 0 ? String(curCount) : '';
    if (btnEl) btnEl.classList.toggle('stamp-btn-has-count', curCount > 0);

    try {
        const res = await apiFetch('/reactions/toggle', {
            method: 'POST',
            body: { post_id: postId, post_type: postType, stamp }
        });
        if (res && res.success && res.reactions) {
            const bar = document.getElementById(`stamps_${postId}`);
            if (bar) {
                STAMP_DEFINITIONS.forEach(st => {
                    const b = bar.querySelector(`[data-stamp="${st.key}"]`);
                    if (b) {
                        const c = parseInt(res.reactions[st.key], 10) || 0;
                        const cSpan = b.querySelector('.stamp-count');
                        if (cSpan) cSpan.innerText = c > 0 ? String(c) : '';
                        b.classList.toggle('stamp-btn-has-count', c > 0);
                    }
                });
            }
        }
    } catch (_) {}
}

if (typeof window !== 'undefined') {
    window.rollBoardFanName = rollBoardFanName;
    window.syncIdentityFormState = syncIdentityFormState;
    window.highlightPosterId = highlightPosterId;
    window.togglePostReaction = togglePostReaction;
}

// Smart Diff: updates threads in place without wiping innerHTML
function smartDiffBoard(container, threads) {
    const existingCards = new Map();
    for (const card of Array.from(container.querySelectorAll('.thread'))) {
        const id = card.id.replace('thread_', '');
        existingCards.set(id, card);
    }

    const targetIds = new Set(threads.map(t => t.id));

    // 1. Remove deleted or archived threads
    for (const [id, card] of existingCards.entries()) {
        if (!targetIds.has(id)) {
            const nextEl = card.nextElementSibling;
            if (nextEl && nextEl.tagName === 'HR') nextEl.remove();
            card.remove();
        }
    }

    // 2. Insert or update existing cards preserving DOM nodes
    let prevCard = null;
    for (let i = 0; i < threads.length; i++) {
        const th = threads[i];
        let card = existingCards.get(th.id);

        if (!card) {
            const temp = document.createElement('div');
            temp.innerHTML = renderThreadPreview(th);
            card = temp.firstElementChild;
            const hr = temp.querySelector('hr');

            if (prevCard && prevCard.nextElementSibling) {
                const anchor = prevCard.nextElementSibling.tagName === 'HR' ? prevCard.nextElementSibling.nextSibling : prevCard.nextSibling;
                container.insertBefore(card, anchor);
                if (hr) container.insertBefore(hr, card.nextSibling);
            } else {
                container.prepend(card);
                if (hr) card.after(hr);
            }
            card.classList.add('new-thread-fade');
        } else {
            // Update reply count text in place
            const replyCountLink = card.querySelector('.reply-count-link');
            const replyCountText = th.reply_count > 0 
                ? `${th.reply_count} ${th.reply_count === 1 ? 'reply' : 'replies'}` 
                : `No replies yet`;
            if (replyCountLink && replyCountLink.innerText !== replyCountText) {
                replyCountLink.innerText = replyCountText;
            }

            // Update preview replies if new preview replies were posted
            const repliesContainer = card.querySelector('.replies');
            if (repliesContainer) {
                if (!th.preview_replies || th.preview_replies.length === 0) {
                    if (repliesContainer.children.length > 0) {
                        repliesContainer.innerHTML = '';
                    }
                } else {
                    const existingReplyIds = Array.from(card.querySelectorAll('.reply-container')).map(el => el.id.replace('post_', ''));
                    const targetReplyIds = th.preview_replies.map(r => r.id);
                    if (existingReplyIds.join(',') !== targetReplyIds.join(',')) {
                        let newRepliesHtml = '';
                        for (const r of th.preview_replies) {
                            newRepliesHtml += renderReplyCard(r, th.id, true);
                        }
                        repliesContainer.innerHTML = newRepliesHtml;
                    }
                }
            }

            // Re-order DOM element if bumped without recreating nodes
            if (prevCard) {
                const expectedTarget = prevCard.nextElementSibling?.tagName === 'HR' ? prevCard.nextElementSibling : prevCard;
                if (card.previousElementSibling !== expectedTarget) {
                    const hr = card.nextElementSibling?.tagName === 'HR' ? card.nextElementSibling : null;
                    expectedTarget.after(card);
                    if (hr) card.after(hr);
                }
            } else if (container.firstElementChild !== card) {
                const hr = card.nextElementSibling?.tagName === 'HR' ? card.nextElementSibling : null;
                container.prepend(card);
                if (hr) card.after(hr);
            }
        }

        prevCard = card;
    }

    generateBacklinks();
}

async function loadBoardView(isArchive = false, isSilent = false) {
    const container = document.getElementById('threadList');
    const catalogToolbar = document.getElementById('catalogToolbar');
    const catalogGrid = document.getElementById('catalogGrid');
    const formWrapper = document.getElementById('formWrapper');
    if (!container) return;

    const isCatalog = isCatalogMode() && !isArchive;

    if (isCatalog) {
        container.style.display = 'none';
        if (catalogToolbar) catalogToolbar.style.display = 'flex';
        if (catalogGrid) catalogGrid.style.display = 'grid';
        if (formWrapper) formWrapper.style.display = 'none';
    } else {
        container.style.display = 'block';
        if (catalogToolbar) catalogToolbar.style.display = 'none';
        if (catalogGrid) catalogGrid.style.display = 'none';
        if (formWrapper) formWrapper.style.display = isArchive ? 'none' : 'block';
    }

    if (!isSilent) {
        cancelPendingNavFetch();
        navAbortController = new AbortController();

        if (cachedBoardThreads.length === 0) {
            if (isCatalog && catalogGrid) {
                catalogGrid.innerHTML = `<div style="grid-column: 1 / -1; text-align:center; padding: 30px; opacity:0.7;">Loading catalog...</div>`;
            } else {
                container.innerHTML = `<div style="text-align:center; padding: 20px; color: var(--text-color);">Loading ${isArchive ? 'archived ' : ''}threads...</div>`;
            }
        } else if (isCatalog) {
            // Instant render cached threads into catalog mode while re-validating
            renderCatalogGrid(cachedBoardThreads);
        }
    }

    // Configure form for new thread
    const formTitle = document.getElementById('formTitle');
    const subjectInput = document.getElementById('subjectInput');
    const submitBtn = document.getElementById('submitBtn');
    if (!isSilent && !isCatalog) {
        if (formTitle) formTitle.innerText = isArchive ? "Board Archive" : "Create New Thread";
        if (subjectInput) subjectInput.style.display = "block";
        if (submitBtn) submitBtn.innerText = "Submit New Thread";
    }

    try {
        const signal = !isSilent && navAbortController ? navAbortController.signal : undefined;
        const viewParam = isArchive ? '&view=archive' : '';
        const modeParam = isCatalog ? '&mode=catalog' : '';
        const res = await apiFetch(`/threads?b=${currentBoard}${viewParam}${modeParam}`, { signal });
        if (isSilent && res.notModified) {
            return; // 304 Not Modified: server confirmed zero changes during silent background update
        }
        const threads = res.threads || cachedBoardThreads || [];
        cachedBoardThreads = threads;

        if (threads.length === 0) {
            if (!isSilent) {
                const emptyMsg = `<div style="text-align:center; padding: 40px; color: var(--text-color);">No ${isArchive ? 'archived ' : ''}threads found on /${currentBoard}/.</div>`;
                if (isCatalog && catalogGrid) catalogGrid.innerHTML = emptyMsg;
                else container.innerHTML = emptyMsg;
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

        if (isSilent && lastBoardSignature === currentSignature) {
            return;
        }
        lastBoardSignature = currentSignature;

        if (isCatalog) {
            renderCatalogGrid(threads);
            return;
        }

        // SMART DIFF: If container already has thread cards, update in place without full DOM wipe!
        if (isSilent && container.querySelectorAll('.thread').length > 0) {
            smartDiffBoard(container, threads);
            return;
        }

        // Viewport Anchor Preservation:
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
            requestAnimationFrame(restoreAnchor);
        }
    } catch (err) {
        if (err.name === 'AbortError') return; // Cancelled silently, new navigation took over
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
    const posterIdHtml = renderPosterIdBadge(th.poster_id);
    const vanityFlairHtml = renderVanityFlairBadges(th.vanity_flair);
    const stampsBarHtml = renderStampReactionsBar(th.id, 'thread', th.reactions);

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
                        ${vanityFlairHtml}
                        ${posterIdHtml}
                        <span class="date">${dateStr}</span>
                        <span class="post-id">No. <a href="?b=${currentBoard}&t=${th.id}#post_${th.id}" onclick="quotePost('${th.id}', '${th.id}', event)" title="Quote post (Click) / Copy link (Right-click)">${th.id.substring(1, 9)}</a><a href="javascript:void(0)" onclick="copyPostLink('${th.id}', '${th.id}', '${currentBoard}', event)" class="post-link-btn" title="Copy link to this post">🔗</a></span>
                        ${youTag}
                        <a href="?b=${currentBoard}&t=${th.id}" class="reply-link">[Reply ➜]</a>
                        ${watchControl}
                        ${modControls}
                    </div>
                    <div class="backlink-container" id="backlinks_${th.id}"></div>
                    <div class="comment">${formatComment(th.comment)}</div>
                    ${stampsBarHtml}
                    <div style="font-size:0.85em; color:var(--text-color); opacity:0.8; margin-top:8px;">
                        [ <a href="?b=${currentBoard}&t=${th.id}" class="reply-count-link">${replyCountText}</a> ]
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
        cancelPendingNavFetch();
        navAbortController = new AbortController();

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
        const signal = !isSilent && navAbortController ? navAbortController.signal : undefined;

        // Optimization 3: Delta updates for background polling if replies already exist in DOM
        let latestReplyTimestamp = 0;
        if (isSilent) {
            const existingCards = repliesContainer.querySelectorAll('.reply-container');
            existingCards.forEach(card => {
                const ts = parseInt(card.getAttribute('data-created-at') || '0', 10);
                if (ts > latestReplyTimestamp) latestReplyTimestamp = ts;
            });
        }

        const endpoint = (isSilent && latestReplyTimestamp > 0)
            ? `/thread?id=${threadId}&since=${latestReplyTimestamp}`
            : `/thread?id=${threadId}`;

        const data = await apiFetch(endpoint, { signal });
        if (isSilent && data.notModified) {
            return; // 304 Not Modified: server confirmed zero changes during silent background update
        }
        if (data.is_delta && (!data.replies || data.replies.length === 0)) {
            return; // Delta Polling Optimization (Audit Recommendation C.2): 0 new replies, skip DOM overhead
        }
        const th = data.thread;
        const replies = data.replies || [];

        if (th && th.board && (!currentBoard || currentBoard !== th.board)) {
            currentBoard = th.board;
            renderBoardNav();
        }

        // Always ensure the board title and theme (e.g. NSFW night-mode) match the active thread's board
        if (th && th.board && BOARDS[th.board]) {
            const bData = BOARDS[th.board];
            const titleEl = document.getElementById('boardTitle');
            if (titleEl) titleEl.innerText = bData.title;
            if (bData.type === 'nsfw') {
                document.body.classList.add('night-mode');
            } else {
                document.body.classList.remove('night-mode');
            }
            applyNsfwBlurState();
            renderBoardNav();
        }

        // Keep browser URL clean and easily shareable for Discord/social previews
        if (!isSilent && th && th.board) {
            const threadUrl = `?b=${th.board}&t=${th.id}`;
            if (window.location.search !== `?b=${th.board}&t=${th.id}` && !window.location.hash.includes('#post_')) {
                history.replaceState(null, '', threadUrl);
            }
        }

        // If delta update arrived, only append brand-new replies without full re-render
        if (data.is_delta) {
            if (th) {
                if (th.is_locked && formWrapper) {
                    formWrapper.style.display = "none";
                } else if (formWrapper) {
                    formWrapper.style.display = "block";
                }
            }

            if (replies.length > 0) {
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
                for (const el of newElements) {
                    generateBacklinks(el);
                }
            }
            return;
        }

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

            const opPosterIdHtml = renderPosterIdBadge(th.poster_id);
            const opVanityFlairHtml = renderVanityFlairBadges(th.vanity_flair);
            const opStampsBarHtml = renderStampReactionsBar(th.id, 'thread', th.reactions);

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
                            ${opVanityFlairHtml}
                            ${opPosterIdHtml}
                            <span class="date">${dateStr}</span>
                            <span class="post-id">No. <a href="?b=${currentBoard}&t=${th.id}#post_${th.id}" onclick="quotePost('${th.id}', '${th.id}', event)" title="Quote post (Click) / Copy link (Right-click)">${th.id.substring(1, 9)}</a><a href="javascript:void(0)" onclick="copyPostLink('${th.id}', '${th.id}', '${currentBoard}', event)" class="post-link-btn" title="Copy link to this post">🔗</a></span>
                            ${youTag}
                            ${watchControl}
                            ${modControls}
                        </div>
                        <div class="backlink-container" id="backlinks_${th.id}"></div>
                        <div class="comment">${formatComment(th.comment)}</div>
                        ${opStampsBarHtml}
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
                    temp.innerHTML = renderReplyCard(r, (th ? th.id : threadId), false);
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
        if (err.name === 'AbortError') return; // Cancelled silently, new navigation took over
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
    if (currentUser && (currentUser.role === 'admin' || currentUser.role === 'mod') && !r.is_optimistic) {
        modControls = `
            <span style="margin-left: 8px; font-size: 0.85em;">
                [<a href="#" onclick="adminDelete('reply', '${r.id}'); return false;" style="color:red;">Delete</a>]
            </span>
        `;
    }

    const optClass = r.is_optimistic ? ' reply-optimistic' : '';
    const postIdHtml = r.is_optimistic 
        ? `<span class="posting-badge">Posting</span>` 
        : `No. <a href="?b=${currentBoard}&t=${threadId}&r=${r.id}#post_${r.id}" onclick="quotePost('${r.id}', '${threadId}', event)" title="Quote post (Click) / Copy link (Right-click)">${r.id.substring(1, 9)}</a><a href="javascript:void(0)" onclick="copyPostLink('${r.id}', '${threadId}', '${currentBoard}', event)" class="post-link-btn" title="Copy link to this post">🔗</a>`;
    const posterIdHtml = renderPosterIdBadge(r.poster_id);
    const vanityFlairHtml = renderVanityFlairBadges(r.vanity_flair);
    const stampsBarHtml = renderStampReactionsBar(r.id, 'reply', r.reactions);

    return `
        <div class="reply-container${optClass}" id="post_${r.id}" data-created-at="${r.created_at || 0}" style="margin-bottom: 8px;">
            <div class="reply">
                ${mediaHtml}
                <div class="post-content">
                    <div class="post-header">
                        ${roleBadge}
                        <span class="name">${escapeHtml(r.name || 'Anonymous')}</span>
                        ${vanityFlairHtml}
                        ${posterIdHtml}
                        <span class="date">${dateStr}</span>
                        <span class="post-id" id="post_id_label_${r.id}">${postIdHtml}</span>
                        ${youTag}
                        ${modControls}
                    </div>
                    <div class="backlink-container" id="backlinks_${r.id}"></div>
                    <div class="comment">${formatComment(r.comment)}</div>
                    ${stampsBarHtml}
                </div>
            </div>
        </div>
    `;
}

// --- FLOATING QUICK REPLY (QR) CONTROLLER ---
let isQrDragging = false;
let qrDragStartX = 0;
let qrDragStartY = 0;
let qrInitialLeft = 0;
let qrInitialTop = 0;
let activeQrThreadId = null;

function openQuickReply(threadId, quoteId = null) {
    const dock = document.getElementById('quickReplyDock');
    const comment = document.getElementById('qrComment');
    const title = document.getElementById('qrTitle');
    const nameInput = document.getElementById('qrName');
    if (!dock || !comment) return;

    activeQrThreadId = threadId || currentThreadId;
    dock.setAttribute('data-thread-id', activeQrThreadId || '');

    if (title) {
        const boardStr = currentBoard ? `/${currentBoard}/` : '';
        const idStr = activeQrThreadId ? ` #${activeQrThreadId.substring(1, 9)}` : '';
        title.innerText = `⚡ Quick Reply - ${boardStr}${idStr}`;
    }

    // Sync name from main form
    const mainName = document.getElementById('nameInput');
    if (mainName && mainName.value && nameInput) {
        nameInput.value = mainName.value;
    }

    dock.style.display = 'flex';
    dock.classList.remove('qr-minimized');
    const minBtn = document.getElementById('qrMinBtn');
    if (minBtn) minBtn.innerText = '−';

    // Append quote if specified
    if (quoteId) {
        const prefix = comment.value.length > 0 && !comment.value.endsWith('\n') ? '\n' : '';
        comment.value += `${prefix}>>${quoteId}\n`;
    }

    comment.focus();
    comment.selectionStart = comment.selectionEnd = comment.value.length;
}

function closeQuickReply() {
    const dock = document.getElementById('quickReplyDock');
    if (dock) dock.style.display = 'none';
}

function toggleQuickReplyMinimize() {
    const dock = document.getElementById('quickReplyDock');
    const minBtn = document.getElementById('qrMinBtn');
    if (!dock) return;
    const isMin = dock.classList.toggle('qr-minimized');
    if (minBtn) minBtn.innerText = isMin ? '+' : '−';
}

async function submitQuickReply() {
    const commentInput = document.getElementById('qrComment');
    const nameInput = document.getElementById('qrName');
    const imageInput = document.getElementById('qrImage');
    const qrSpoilerInput = document.getElementById('qrSpoilerInput');
    const dock = document.getElementById('quickReplyDock');

    const threadId = activeQrThreadId || currentThreadId || dock?.getAttribute('data-thread-id');
    if (!threadId) {
        showToast("Please select or open a thread to reply to.", 3500, "error");
        return;
    }

    const rawMediaUrl = imageInput ? imageInput.value : '';
    const isSpoiler = Boolean(qrSpoilerInput && qrSpoilerInput.checked);
    const formattedMediaUrl = (typeof formatSpoilerMediaUrl === 'function')
        ? formatSpoilerMediaUrl(rawMediaUrl, isSpoiler)
        : rawMediaUrl;

    await submitReplyCore({
        threadId,
        comment: commentInput ? commentInput.value : '',
        name: nameInput ? nameInput.value : '',
        media_url: formattedMediaUrl,
        source: 'qr'
    });
}

function initQuickReply() {
    const dock = document.getElementById('quickReplyDock');
    const header = document.getElementById('qrHeader');
    const uploadBtn = document.getElementById('qrUploadBtn');
    const hiddenFileInput = document.getElementById('qrHiddenFileInput');
    const imageInput = document.getElementById('qrImage');
    const badge = document.getElementById('qrMediaBadge');
    const comment = document.getElementById('qrComment');

    if (!dock || !header) return;

    // Restore saved position
    try {
        const savedPos = JSON.parse(localStorage.getItem('oshimy_qr_pos') || 'null');
        if (savedPos && savedPos.left && savedPos.top) {
            const maxLeft = window.innerWidth - 360;
            const maxTop = window.innerHeight - 100;
            const left = Math.max(10, Math.min(savedPos.left, maxLeft));
            const top = Math.max(10, Math.min(savedPos.top, maxTop));
            dock.style.left = `${left}px`;
            dock.style.top = `${top}px`;
            dock.style.bottom = 'auto';
            dock.style.right = 'auto';
        }
    } catch (e) {}

    // Mouse drag
    header.addEventListener('mousedown', (e) => {
        if (e.target.closest('.qr-controls')) return;
        isQrDragging = true;
        const rect = dock.getBoundingClientRect();
        qrDragStartX = e.clientX;
        qrDragStartY = e.clientY;
        qrInitialLeft = rect.left;
        qrInitialTop = rect.top;
        dock.style.bottom = 'auto';
        dock.style.right = 'auto';
        e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
        if (!isQrDragging) return;
        const dx = e.clientX - qrDragStartX;
        const dy = e.clientY - qrDragStartY;
        let newLeft = qrInitialLeft + dx;
        let newTop = qrInitialTop + dy;

        const maxLeft = window.innerWidth - dock.offsetWidth - 10;
        const maxTop = window.innerHeight - 50;
        newLeft = Math.max(10, Math.min(newLeft, maxLeft));
        newTop = Math.max(10, Math.min(newTop, maxTop));

        dock.style.left = `${newLeft}px`;
        dock.style.top = `${newTop}px`;
    });

    window.addEventListener('mouseup', () => {
        if (!isQrDragging) return;
        isQrDragging = false;
        const rect = dock.getBoundingClientRect();
        localStorage.setItem('oshimy_qr_pos', JSON.stringify({ left: rect.left, top: rect.top }));
    });

    // Touch drag for mobile
    header.addEventListener('touchstart', (e) => {
        if (e.target.closest('.qr-controls')) return;
        const touch = e.touches[0];
        isQrDragging = true;
        const rect = dock.getBoundingClientRect();
        qrDragStartX = touch.clientX;
        qrDragStartY = touch.clientY;
        qrInitialLeft = rect.left;
        qrInitialTop = rect.top;
        dock.style.bottom = 'auto';
        dock.style.right = 'auto';
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
        if (!isQrDragging || !e.touches[0]) return;
        const touch = e.touches[0];
        const dx = touch.clientX - qrDragStartX;
        const dy = touch.clientY - qrDragStartY;
        dock.style.left = `${Math.max(10, qrInitialLeft + dx)}px`;
        dock.style.top = `${Math.max(10, qrInitialTop + dy)}px`;
    }, { passive: true });

    window.addEventListener('touchend', () => {
        isQrDragging = false;
    });

    // Double-click header toggles minimize
    header.addEventListener('dblclick', (e) => {
        if (e.target.closest('.qr-controls')) return;
        toggleQuickReplyMinimize();
    });

    // Live media detector inside QR
    if (imageInput && badge) {
        const qrRowEl = document.getElementById('qrAttachmentMetaRow');
        const qrSpoilerBarEl = document.getElementById('qrSpoilerBar');
        const qrSpoilerCheckEl = document.getElementById('qrSpoilerInput');
        const updateQrBadge = () => {
            const val = imageInput.value.trim();
            if (!val) {
                badge.style.display = 'none';
                badge.innerHTML = '';
                if (qrSpoilerBarEl) qrSpoilerBarEl.style.display = 'none';
                if (qrRowEl) qrRowEl.style.display = 'none';
                if (qrSpoilerCheckEl) {
                    qrSpoilerCheckEl.checked = false;
                    if (typeof syncSpoilerToggleUI === 'function') syncSpoilerToggleUI('qr');
                }
                return;
            }
            const media = typeof getMediaType === 'function' ? getMediaType(val) : null;
            if (qrRowEl) qrRowEl.style.display = 'flex';
            if (qrSpoilerBarEl) qrSpoilerBarEl.style.display = 'inline-flex';
            badge.style.display = 'block';
            if (media && (media.type === 'pixiv' || media.type === 'pixiv_image')) {
                badge.style.background = 'rgba(0, 150, 250, 0.15)';
                badge.style.color = '#0096fa';
                badge.innerHTML = media.type === 'pixiv' ? `✓ Pixiv #${media.id} Attached` : '✓ Pixiv Image (Proxied)';
            } else {
                badge.style.background = 'rgba(0, 132, 255, 0.15)';
                badge.style.color = 'var(--main-accent)';
                badge.innerHTML = '✓ Media attached';
            }
        };
        imageInput.addEventListener('input', updateQrBadge);
        imageInput.addEventListener('change', updateQrBadge);
    }

    // Media upload inside QR (uses Catbox.moe + WebP compression helper)
    if (uploadBtn && hiddenFileInput && imageInput) {
        uploadBtn.onclick = () => hiddenFileInput.click();
        hiddenFileInput.onchange = async () => {
            const file = hiddenFileInput.files[0];
            if (!file) return;
            uploadBtn.innerText = "⏳";
            uploadBtn.disabled = true;
            try {
                if (typeof uploadMediaFile === 'function') {
                    await uploadMediaFile(file, imageInput);
                }
            } finally {
                uploadBtn.innerText = "Upload";
                uploadBtn.disabled = false;
                hiddenFileInput.value = "";
            }
        };
    }
}

// --- SMOOTH OPTIMISTIC POST INSERTION CORE ---
async function submitReplyCore({ threadId, comment, name, media_url, source = 'main' }) {
    if (!comment || !comment.trim()) return;

    const qrStatus = document.getElementById('qrStatus');
    const qrSubmitBtn = document.getElementById('qrSubmitBtn');
    const mainSubmitBtn = document.getElementById('submitBtn');

    if (qrSubmitBtn) { qrSubmitBtn.disabled = true; qrSubmitBtn.innerText = "Posting..."; }
    if (mainSubmitBtn) { mainSubmitBtn.disabled = true; mainSubmitBtn.innerText = "Posting..."; }
    if (qrStatus) { qrStatus.style.color = 'var(--text-color)'; qrStatus.innerText = "Sending..."; }

    // Validate media URL if provided
    const mediaVal = (media_url || '').trim();
    if (mediaVal && typeof validateMediaUrl === 'function') {
        const check = await validateMediaUrl(mediaVal);
        if (!check.valid) {
            const errMsg = check.error || "Invalid media or image URL.";
            if (qrStatus) { qrStatus.style.color = '#ef4444'; qrStatus.innerText = errMsg; }
            showToast(errMsg, 3500, "error");
            if (qrSubmitBtn) { qrSubmitBtn.disabled = false; qrSubmitBtn.innerText = "Submit"; }
            if (mainSubmitBtn) { mainSubmitBtn.disabled = false; mainSubmitBtn.innerText = "Submit Reply"; }
            return;
        }
    }

    // 1. Optimistic UI: Generate temporary ID and insert immediately into DOM
    const tempId = 'opt_' + Date.now();
    const optimisticReply = {
        id: tempId,
        thread_id: threadId,
        board: currentBoard,
        name: (name || '').trim() || 'Anonymous',
        comment: comment.trim(),
        media_url: mediaVal,
        created_at: Date.now(),
        role: currentUser?.role || null,
        display_title: currentUser?.display_title || null,
        is_optimistic: true
    };

    const repliesContainer = document.getElementById('repliesContainer');
    let optimisticEl = null;

    if (currentThreadId === threadId && repliesContainer) {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = renderReplyCard(optimisticReply, threadId);
        optimisticEl = tempDiv.firstElementChild;
        repliesContainer.appendChild(optimisticEl);
        optimisticEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // Clear comment inputs immediately for instant, fluid UI response
    const qrComment = document.getElementById('qrComment');
    const mainComment = document.getElementById('commentInput');
    const qrImage = document.getElementById('qrImage');
    const mainImage = document.getElementById('imageInput');
    const qrSpoilerInput = document.getElementById('qrSpoilerInput');
    if (qrComment) qrComment.value = "";
    if (mainComment) mainComment.value = "";
    if (qrImage) {
        qrImage.value = "";
        qrImage.dispatchEvent(new Event('input'));
    }
    if (mainImage) mainImage.value = "";
    if (qrSpoilerInput) {
        qrSpoilerInput.checked = false;
        if (typeof syncSpoilerToggleUI === 'function') syncSpoilerToggleUI('qr');
    }
    if (typeof clearUploadedMedia === 'function') clearUploadedMedia();

    const identityPayload = getPostIdentityPayload(name);

    try {
        const res = await apiFetch('/replies', {
            method: 'POST',
            body: {
                thread_id: threadId,
                board: currentBoard,
                name: identityPayload.name,
                comment: comment.trim(),
                media_url: mediaVal,
                post_as_anonymous: identityPayload.post_as_anonymous,
                show_vanity_flair: identityPayload.show_vanity_flair,
                guest_flair: identityPayload.guest_flair
            }
        });

        if (res.success && res.reply) {
            MY_POSTS.push(res.reply.id);
            localStorage.setItem('my_posts', JSON.stringify(MY_POSTS));

            if (typeof handleGamificationPostHook === 'function') {
                handleGamificationPostHook(false);
            }

            // Sync optimistic element with real server data in place
            if (optimisticEl) {
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = renderReplyCard(res.reply, threadId, false);
                const freshEl = tempDiv.firstElementChild;
                if (freshEl) {
                    freshEl.classList.add('new-reply-flash');
                    optimisticEl.replaceWith(freshEl);
                    optimisticEl = freshEl;
                }
                generateBacklinks();
                if (typeof hydratePixivEmbeds === 'function') hydratePixivEmbeds();
                if (typeof hydrateTwitterEmbeds === 'function') hydrateTwitterEmbeds();
                if (typeof hydrateRedditEmbeds === 'function') hydrateRedditEmbeds();
            } else if (currentThreadId !== threadId) {
                history.pushState(null, '', `?b=${currentBoard}&t=${threadId}`);
                router();
            }

            if (qrStatus) {
                qrStatus.style.color = '#22c55e';
                qrStatus.innerText = 'Posted!';
                setTimeout(() => {
                    if (qrStatus) qrStatus.innerText = '';
                    closeQuickReply();
                }, 900);
            }
        }
    } catch (err) {
        if (optimisticEl) {
            const idLabel = optimisticEl.querySelector('.post-id');
            if (idLabel) {
                idLabel.innerHTML = `<span style="color:#ef4444; font-weight:bold;">⚠️ Failed to post</span>`;
            }
        }
        if (qrStatus) {
            qrStatus.style.color = '#ef4444';
            qrStatus.innerText = err.message;
        }
        if (typeof showToast === 'function') {
            showToast('Failed to post reply: ' + err.message);
        }
    } finally {
        if (qrSubmitBtn) { qrSubmitBtn.disabled = false; qrSubmitBtn.innerText = "Submit"; }
        if (mainSubmitBtn) { mainSubmitBtn.disabled = false; mainSubmitBtn.innerText = "Submit Reply"; }
    }
}

// --- KEYBOARD SHORTCUTS NAVIGATION ---
function initKeyboardNavigation() {
    window.addEventListener('keydown', (e) => {
        const tag = e.target.tagName;
        const isTyping = ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || e.target.isContentEditable;

        // Esc key closes any open overlay or Quick Reply
        if (e.key === 'Escape') {
            const lb = document.getElementById('lightbox');
            if (lb && lb.style.display === 'flex') {
                closeLightbox(e);
                return;
            }
            const shortcuts = document.getElementById('shortcutsModal');
            if (shortcuts && shortcuts.style.display === 'flex') {
                closeShortcutsModal();
                return;
            }
            const auth = document.getElementById('authModal');
            if (auth && auth.style.display === 'flex') {
                closeAuthModal();
                return;
            }
            const notif = document.getElementById('notificationsModal');
            if (notif && notif.style.display === 'flex') {
                closeNotificationsModal();
                return;
            }
            const watch = document.getElementById('watchlistModal');
            if (watch && watch.style.display === 'flex') {
                closeWatchlistModal();
                return;
            }
            const qr = document.getElementById('quickReplyDock');
            if (qr && qr.style.display !== 'none') {
                closeQuickReply();
                return;
            }
            return;
        }

        // Ctrl/Cmd + Enter submits inside form or QR
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            if (e.target.id === 'qrComment') {
                e.preventDefault();
                submitQuickReply();
                return;
            }
            if (e.target.id === 'commentInput') {
                e.preventDefault();
                const form = document.getElementById('postForm');
                if (form) form.dispatchEvent(new Event('submit', { cancelable: true }));
                return;
            }
        }

        if (isTyping) return;

        // ? Key opens Shortcuts Modal
        if (e.key === '?' || (e.shiftKey && e.key === '/')) {
            e.preventDefault();
            openShortcutsModal();
            return;
        }

        // R Key opens Quick Reply (only when viewing an active thread and no modifier keys are pressed)
        if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.metaKey && !e.altKey) {
            if (currentThreadId) {
                e.preventDefault();
                openQuickReply(currentThreadId);
            }
            return;
        }

        // J Key: Jump to next post/reply (without modifier keys)
        if ((e.key === 'j' || e.key === 'J') && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            navigatePosts(1);
            return;
        }

        // K Key: Jump to previous post/reply (without modifier keys)
        if ((e.key === 'k' || e.key === 'K') && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            navigatePosts(-1);
            return;
        }
    });
}

function navigatePosts(direction) {
    const isThread = !!currentThreadId;
    const selector = isThread ? '.op, .reply-container' : '.thread, .catalog-tile';
    const items = Array.from(document.querySelectorAll(selector)).filter(el => el.offsetParent !== null);
    if (items.length === 0) return;

    const threshold = 60;
    let targetIndex = -1;

    if (direction > 0) {
        targetIndex = items.findIndex(el => el.getBoundingClientRect().top > threshold);
        if (targetIndex === -1) targetIndex = items.length - 1;
    } else {
        for (let i = items.length - 1; i >= 0; i--) {
            if (items[i].getBoundingClientRect().top < -threshold) {
                targetIndex = i;
                break;
            }
        }
        if (targetIndex === -1) targetIndex = 0;
    }

    const targetEl = items[targetIndex];
    if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        targetEl.classList.remove('post-keyboard-focus');
        void targetEl.offsetWidth;
        targetEl.classList.add('post-keyboard-focus');
        setTimeout(() => targetEl.classList.remove('post-keyboard-focus'), 1500);
    }
}

function openShortcutsModal() {
    const modal = document.getElementById('shortcutsModal');
    if (modal) modal.style.display = 'flex';
}

function closeShortcutsModal() {
    const modal = document.getElementById('shortcutsModal');
    if (modal) modal.style.display = 'none';
}

// --- POST SUBMISSION ---
document.addEventListener('DOMContentLoaded', () => {
    initQuickReply();
    initKeyboardNavigation();

    const postForm = document.getElementById('postForm');
    if (!postForm) return;

    postForm.onsubmit = async (e) => {
        e.preventDefault();

        const submitBtn = document.getElementById('submitBtn');
        const nameInput = document.getElementById('nameInput');
        const subjectInput = document.getElementById('subjectInput');
        const commentInput = document.getElementById('commentInput');
        const imageInput = document.getElementById('imageInput');
        const spoilerInput = document.getElementById('spoilerInput');

        if (!commentInput.value.trim()) return;

        const isSpoiler = Boolean(spoilerInput && spoilerInput.checked);
        const formattedMediaUrl = (typeof formatSpoilerMediaUrl === 'function')
            ? formatSpoilerMediaUrl(imageInput.value, isSpoiler)
            : imageInput.value.trim();

        if (currentThreadId) {
            // Reply via optimistic submit core
            await submitReplyCore({
                threadId: currentThreadId,
                comment: commentInput.value,
                name: nameInput.value,
                media_url: formattedMediaUrl,
                source: 'main'
            });
            return;
        }

        // New Thread Creation
        submitBtn.disabled = true;
        submitBtn.innerText = "Posting...";

        // Validate media URL if provided
        const mediaVal = formattedMediaUrl;
        if (mediaVal && typeof validateMediaUrl === 'function') {
            const check = await validateMediaUrl(mediaVal);
            if (!check.valid) {
                const errMsg = check.error || "Invalid media or image URL.";
                showToast(errMsg, 3500, "error");
                submitBtn.disabled = false;
                submitBtn.innerText = "Create Thread";
                return;
            }
        }

        const identityPayload = getPostIdentityPayload(nameInput.value);

        try {
            const res = await apiFetch('/threads', {
                method: 'POST',
                body: {
                    board: currentBoard,
                    name: identityPayload.name,
                    subject: subjectInput.value,
                    comment: commentInput.value,
                    media_url: formattedMediaUrl,
                    post_as_anonymous: identityPayload.post_as_anonymous,
                    show_vanity_flair: identityPayload.show_vanity_flair,
                    guest_flair: identityPayload.guest_flair
                }
            });

            if (res.success && res.thread) {
                MY_POSTS.push(res.thread.id);
                localStorage.setItem('my_posts', JSON.stringify(MY_POSTS));

                if (typeof handleGamificationPostHook === 'function') {
                    handleGamificationPostHook(true);
                }

                subjectInput.value = "";
                commentInput.value = "";
                imageInput.value = "";
                if (typeof clearUploadedMedia === 'function') clearUploadedMedia();
                const badge = document.getElementById('mediaDetectedBadge');
                if (badge) { badge.style.display = 'none'; badge.innerHTML = ''; }
                history.pushState(null, '', `?b=${currentBoard}&t=${res.thread.id}`);
                router();
            }
        } catch (err) {
            showToast("Posting Error: " + err.message, 4000, "error");
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
        showToast("Failed to delete: " + err.message, 4000, "error");
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
        showToast("Failed to pin: " + err.message, 4000, "error");
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
        showToast("Failed to lock: " + err.message, 4000, "error");
    }
}

// --- AUTH & USER MANAGEMENT ---
async function initAuth() {
    if (!authToken) {
        updateAuthUI(null);
        syncUserPerks();
        if (typeof initGamification === 'function') initGamification();
        return;
    }

    try {
        const data = await apiFetch('/auth/me');
        currentUser = data.user;
        updateAuthUI(currentUser);
        syncUserPerks();
        if (typeof initGamification === 'function') initGamification();
    } catch {
        localStorage.removeItem('myvt_token');
        authToken = null;
        currentUser = null;
        updateAuthUI(null);
        syncUserPerks();
        if (typeof initGamification === 'function') initGamification();
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

    const vanityBar = document.getElementById('decoupledVanityBar');
    if (vanityBar) {
        vanityBar.style.display = user ? 'flex' : 'none';
    }
    syncIdentityFormState();
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
            if (typeof initGamification === 'function') initGamification();
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
    if (typeof initGamification === 'function') initGamification();
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

    // 1. Fast, lightweight user sync endpoint (Audit Recommendation A.3)
    try {
        const syncData = await apiFetch('/user/sync');
        if (syncData.success && syncData.user_sync) {
            const badge = document.getElementById('replyBadge');
            if (badge) {
                const unread = syncData.user_sync.unread_notifications || 0;
                if (unread > 0) {
                    badge.innerText = unread;
                    badge.style.display = 'inline';
                } else {
                    badge.style.display = 'none';
                }
            }
            const wBadge = document.getElementById('watchlistBadge');
            if (wBadge) wBadge.innerText = `(${syncData.user_sync.watchlist_count || 0})`;
        }
    } catch (_) {}

    // 2. Cross-device (You) posts sync
    try {
        const postData = await apiFetch('/user/my-posts');
        if (postData.success && Array.isArray(postData.post_ids)) {
            let updated = false;
            for (const pid of postData.post_ids) {
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

    // 3. Watchlist sync
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
}

// Decoupled notification & perks sync on tab focus and 60-second low-frequency interval (Audit Recommendation A.3)
window.addEventListener('focus', () => {
    if (currentUser) syncUserPerks();
});
setInterval(() => {
    if (currentUser && !document.hidden) syncUserPerks();
}, 60000);

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
        showToast("Failed to update watchlist: " + err.message, 4000, "error");
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
                        <a href="?b=${th.board}&t=${th.id}" onclick="closeWatchlistModal()" style="font-weight:bold; text-decoration:none; color:var(--text-color); font-size:0.95em; display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                            ${title}
                        </a>
                    </div>
                    <div style="display:flex; gap:6px; flex-shrink:0;">
                        <a href="?b=${th.board}&t=${th.id}" onclick="closeWatchlistModal()" style="padding:4px 8px; background:var(--main-accent); color:#fff; border-radius:4px; font-size:0.8em; text-decoration:none; font-weight:bold;">Visit ➜</a>
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
                        <a href="?b=${n.board}&t=${n.thread_id}&r=${n.id}#post_${n.id}" onclick="closeNotificationsModal()" style="font-size:0.8em; font-weight:bold; color:var(--main-accent); text-decoration:none;">
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

// --- ADAPTIVE AUTO-POLLING WITH EXPONENTIAL BACKOFF (Audit Recommendation C.1) ---
let lastUserInteraction = Date.now();
let activePollTimeout = null;

function recordUserActivity() {
    const now = Date.now();
    const wasIdle = (now - lastUserInteraction) > 120000;
    lastUserInteraction = now;
    if (wasIdle && isAutoUpdateEnabled) {
        // User returned from idle: wake up immediately and reschedule at active interval
        scheduleNextAutoUpdate(true);
    }
}

['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'].forEach(evt => {
    window.addEventListener(evt, recordUserActivity, { passive: true });
});

function getAdaptiveInterval() {
    const idleMs = Date.now() - lastUserInteraction;
    // 30s for thread view, 45s for board view (Audit Recommendation C.1)
    const baseInterval = currentThreadId ? 30000 : 45000;
    if (idleMs > 300000) {
        // Inactive > 5 minutes: 120s
        return 120000;
    } else if (idleMs > 120000) {
        // Inactive > 2 minutes: 60s
        return 60000;
    }
    return baseInterval;
}

function updateAutoUpdateToggleLabel(intervalMs) {
    const btn = document.getElementById('autoUpdateToggle');
    if (!btn) return;
    if (!isAutoUpdateEnabled) {
        btn.innerText = "Auto-Update: Off";
        btn.style.color = "#888";
    } else {
        const sec = Math.round(intervalMs / 1000);
        const isIdle = intervalMs > (currentThreadId ? 30000 : 45000);
        btn.innerText = isIdle ? `Auto-Update: On (Idle ${sec}s)` : `Auto-Update: On (${sec}s)`;
        btn.style.color = "var(--main-accent)";
    }
}

function scheduleNextAutoUpdate(immediate = false) {
    if (activePollTimeout) {
        clearTimeout(activePollTimeout);
        activePollTimeout = null;
    }
    if (!isAutoUpdateEnabled) {
        updateAutoUpdateToggleLabel(0);
        return;
    }

    const interval = getAdaptiveInterval();
    updateAutoUpdateToggleLabel(interval);

    const delay = immediate ? 500 : interval;
    activePollTimeout = setTimeout(async () => {
        if (!isAutoUpdateEnabled) return;
        if (!document.hidden) {
            const isArch = new URLSearchParams(window.location.search).get('view') === 'archive';
            try {
                if (currentThreadId) {
                    await loadThreadView(currentThreadId, true);
                } else if (currentBoard) {
                    await loadBoardView(isArch, true);
                }
            } catch (_) {}
        }
        scheduleNextAutoUpdate();
    }, delay);
}

function startAutoUpdate() {
    scheduleNextAutoUpdate();
}

function toggleAutoUpdate() {
    isAutoUpdateEnabled = !isAutoUpdateEnabled;
    if (isAutoUpdateEnabled) {
        lastUserInteraction = Date.now();
        scheduleNextAutoUpdate(true);
    } else {
        if (activePollTimeout) {
            clearTimeout(activePollTimeout);
            activePollTimeout = null;
        }
        updateAutoUpdateToggleLabel(0);
    }
}
