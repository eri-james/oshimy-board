// ==========================================
// 1. CONFIGURATION & ENVIRONMENT SWITCHER
// ==========================================

const prodConfig = {
    apiKey: "AIzaSyB-34VVrHjdEnDPDc6rDsBKUA8wLImF2bw",
    authDomain: "myvt-board.firebaseapp.com",
    databaseURL: "https://myvt-board-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "myvt-board",
    storageBucket: "myvt-board.firebasestorage.app",
    messagingSenderId: "609061476847",
    appId: "1:609061476847:web:85841c6f06a7ff6d8e7e1a",
    measurementId: "G-7TF8SF89DE"
};

const devConfig = {
    apiKey: "AIzaSyBWM3qQIlXHfsmxHItxV2TD4gsoxtlHtIw",
    authDomain: "myvt-dev.firebaseapp.com",
    databaseURL: "https://myvt-dev-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "myvt-dev",
    storageBucket: "myvt-dev.firebasestorage.app",
    messagingSenderId: "538812482957",
    appId: "1:538812482957:web:2d5a38f15a60909a0ce9c4"
};

const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
const firebaseConfig = isLocal ? devConfig : prodConfig;

firebase.initializeApp(firebaseConfig);
const database = firebase.database();

if (isLocal) console.log("%c 🛠️ DEV MODE: Using Test Database ", "background: #222; color: #ffcc00;");

// ==========================================
// 2. BOARD DEFINITIONS
// ==========================================

const BOARDS = {
    'myvt':  { title: '/myvt/ - Malaysian Virtual Youtubers', type: 'sfw' },
    'vt':    { title: '/vt/ - Global & SEA VTubers',         type: 'sfw' },
    'v':     { title: '/v/ - Video Gaming',                  type: 'sfw' },
    'acg':   { title: '/acg/ - Anime & Events',              type: 'sfw' },
    'art':   { title: '/art/ - Fanart & Assets',             type: 'sfw' },
    'tech':  { title: '/tech/ - Rigging & Streaming',        type: 'sfw' },
    'mamak': { title: '/mamak/ - General / Off-topic',       type: 'sfw' },
    'myvth': { title: '/myvth/ - MY VTuber Hentai',          type: 'nsfw' },
    'h':     { title: '/h/ - Hentai General',                type: 'nsfw' }
};

const urlParams = new URLSearchParams(window.location.search);
let currentBoard = urlParams.get('b'); 
let currentThreadId = null;

// FIX: Helper function is now defined correctly
function getBoardRef() {
    return database.ref('boards/' + currentBoard + '/threads');
}

// ==========================================
// 3. ADMIN & MODERATION
// ==========================================
let isModMode = false;
function loadAdminScript(password) {
    const script = document.createElement('script');
    script.src = password + ".js";
    script.onload = () => {
        isModMode = true;
        localStorage.setItem('adminKey', password);
        document.body.classList.add('mod-mode-active');
        router(); 
    };
    script.onerror = () => {
        alert("Login Failed.");
        localStorage.removeItem('adminKey');
    };
    document.head.appendChild(script);
}

function tryLogin() {
    const pass = prompt("Enter Admin Password:");
    if (pass) loadAdminScript(pass);
}

const savedKey = localStorage.getItem('adminKey');
if (savedKey) loadAdminScript(savedKey);

window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && (e.key === 'L' || e.key === 'l')) { e.preventDefault(); tryLogin(); }
    if (e.ctrlKey && e.shiftKey && (e.key === 'O' || e.key === 'o')) {
        e.preventDefault();
        localStorage.removeItem('adminKey');
        location.reload();
    }
});

if (urlParams.has('mod')) tryLogin();
if (urlParams.has('logout')) {
    localStorage.removeItem('adminKey');
    window.location.href = window.location.pathname + "?b=" + currentBoard;
}

// ==========================================
// 4. NAVIGATION & NSFW GATE
// ==========================================

function checkNSFWGate() {
    if (currentBoard && BOARDS[currentBoard].type === 'nsfw') {
        if (!sessionStorage.getItem('nsfw_consent')) {
            document.body.classList.add('gate-active');
            document.getElementById('nsfwGate').style.display = 'flex';
            document.getElementById('gateBoardName').innerText = currentBoard;
            return false;
        }
    }
    return true;
}

function acceptNSFW() {
    sessionStorage.setItem('nsfw_consent', 'true');
    document.body.classList.remove('gate-active');
    document.getElementById('nsfwGate').style.display = 'none';
    router();
}

window.addEventListener('hashchange', router);
window.addEventListener('load', router);

function router() {
    const hash = window.location.hash;
    if (hash === "#bottom") return;

    const homeView = document.getElementById('homeView');
    const boardView = document.getElementById('boardView');
    const threadView = document.getElementById('threadView');
    const formWrapper = document.getElementById('formWrapper');
    const topDivider = document.getElementById('topDivider');

    document.body.classList.remove('night-mode');

    if (!currentBoard || !BOARDS[currentBoard]) {
        homeView.style.display = "block";
        boardView.style.display = "none";
        threadView.style.display = "none";
        formWrapper.style.display = "none";
        topDivider.style.display = "none";
        document.getElementById('boardTitle').innerText = "MYVT - Portal";
        return;
    }

    homeView.style.display = "none";
    formWrapper.style.display = "block";
    topDivider.style.display = "block";
    document.getElementById('boardTitle').innerText = BOARDS[currentBoard].title;
    
    // Toggle Persona 5 (Night) Mode
    if (BOARDS[currentBoard].type === 'nsfw') document.body.classList.add('night-mode');

    if (!checkNSFWGate()) return;

    if (hash.startsWith("#thread_")) {
        currentThreadId = hash.replace("#thread_", "");
        loadThreadView(currentThreadId);
    } else {
        currentThreadId = null;
        loadBoardView();
    }
}

window.addEventListener('DOMContentLoaded', () => {
    const navContainer = document.getElementById('navBoards');
    if (!currentBoard) return;
    
    const currentType = BOARDS[currentBoard].type;
    let html = "";
    for (const [key, data] of Object.entries(BOARDS)) {
        if (data.type === currentType) {
            const isActive = (key === currentBoard) ? 'style="font-weight:900; border-bottom: 2px solid;"' : '';
            html += `[ <a href="?b=${key}" ${isActive}>/${key}/</a> ] `;
        }
    }
    if (currentType === 'nsfw') html += `<br><span style="font-size:0.8em;">[ <a href="?b=myvt">Return to Surface</a> ]</span>`;
    navContainer.innerHTML = html;
});

// ==========================================
// 5. VIEW LOGIC
// ==========================================

function loadBoardView() {
    document.getElementById('boardView').style.display = "block";
    document.getElementById('threadView').style.display = "none";
    document.getElementById('formTitle').innerText = "Create New Thread";
    document.getElementById('subjectInput').style.display = "block";

    getBoardRef().orderByChild('lastUpdated').limitToLast(20).on('value', (snapshot) => {
        const div = document.getElementById('threadList');
        div.innerHTML = "";
        const data = snapshot.val();
        if (!data) return;

        const sortedThreads = [];
        snapshot.forEach((childSnap) => { sortedThreads.push({ id: childSnap.key, ...childSnap.val() }); });
        
        sortedThreads.reverse().forEach((thread) => {
            const totalReplies = thread.replies ? Object.keys(thread.replies).length : 0;
            let threadHtml = renderThreadCard(thread.id, thread, true, totalReplies);

            if (thread.replies) {
                const repliesArr = Object.entries(thread.replies).sort((a, b) => a[1].timestamp - b[1].timestamp);
                repliesArr.slice(-2).forEach(([rId, rData]) => {
                    threadHtml += renderReply(rId, rData, thread.id);
                });
            }
            div.innerHTML += threadHtml;
        });
    });
}

function loadThreadView(threadId) {
    document.getElementById('boardView').style.display = "none";
    document.getElementById('threadView').style.display = "block";
    document.getElementById('formTitle').innerText = "Reply to Thread " + threadId.substring(1,8);
    document.getElementById('subjectInput').style.display = "none";

    database.ref('boards/' + currentBoard + '/threads/' + threadId).on('value', (snap) => {
        const op = snap.val();
        if(!op) { if(window.location.hash.includes(threadId)) window.location.hash = ""; return; }
        document.getElementById('opContainer').innerHTML = renderThreadCard(threadId, op, false);
        setTimeout(generateBacklinks, 200);
    });

    database.ref('boards/' + currentBoard + '/threads/' + threadId + '/replies').on('value', (snapshot) => {
        const div = document.getElementById('repliesContainer');
        div.innerHTML = "";
        const data = snapshot.val();
        if (data) Object.entries(data).forEach(([id, reply]) => { div.innerHTML += renderReply(id, reply, threadId); });
        setTimeout(generateBacklinks, 200);
    });
}

// ==========================================
// 6. RENDER FUNCTIONS (UI)
// ==========================================

function renderThreadCard(id, data, isPreview, replyCount = 0) {
    const date = new Date(data.timestamp).toLocaleString();
    const replyLink = isPreview ? `<a href="#thread_${id}" class="reply-link">Reply ➜</a>` : "";
    const ipHtml = isModMode ? `<span style="color: blue; font-weight:bold; font-size:0.8em;"> [IP: ${data.ip || '?'}]</span>` : "";
    const delBtn = isModMode ? `<span class="admin-delete-btn" onclick="deleteThread('${id}')">[X]</span>` : "";

    let summaryHtml = "";
    if (isPreview && replyCount > 0) {
        summaryHtml = `
        <div class="thread-summary">
            <span><span class="reply-count-num">${replyCount}</span> Replies</span>
            <span style="cursor:pointer;" onclick="window.location.hash='#thread_${id}'">View Context &#9660;</span>
        </div>`;
    }

    return `
    <div class="thread-card" id="post_${id}">
        <!-- HEADER ROW -->
        <div class="post-info">
            <span class="subject">${data.subject || ""}</span>
            <span class="name">${data.name}</span>
            <span class="time">${date}</span> 
            <span class="post-id" onclick="quotePost('${id}')">No. ${id.substring(1,8)}</span>
            ${ipHtml} ${delBtn} 
            ${replyLink}
        </div>
        
        <!-- CONTENT BODY -->
        <div class="post-content">
            ${renderMedia(data.image)}
            <blockquote class="comment">${formatComment(data.comment)}</blockquote>
        </div>
        
        ${summaryHtml}
        <div class="backlink-container" id="backlinks_${id}"></div>
    </div>`;
}

function renderReply(id, data, threadId) {
    const date = new Date(data.timestamp).toLocaleString();
    const ipHtml = isModMode ? `<span style="color: blue; font-weight:bold; font-size:0.8em;"> [IP: ${data.ip || '?'}]</span>` : "";
    const delBtn = isModMode ? `<span class="admin-delete-btn" onclick="deleteReply('${threadId}', '${id}')">[X]</span>` : "";

    return `
    <div class="reply" id="post_${id}">
        <div class="post-info">
            <span class="name">${data.name}</span>
            <span class="time">${date}</span> 
            <span class="post-id" onclick="quotePost('${id}')">No. ${id.substring(1,8)}</span>
            ${ipHtml} ${delBtn}
        </div>
        ${renderMedia(data.image)}
        <blockquote class="comment">${formatComment(data.comment)}</blockquote>
        <div class="backlink-container" id="backlinks_${id}"></div>
    </div>`;
}

// ==========================================
// 7. MEDIA ENGINE
// ==========================================

function getMediaType(url) {
    if (!url) return null;
    const ytRegex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?|live|shorts)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
    const xRegex = /(?:twitter\.com|x\.com)\/.*\/status\/(\d+)/;
    
    const ytMatch = url.match(ytRegex);
    const xMatch = url.match(xRegex);

    if (ytMatch) return { type: 'youtube', id: ytMatch[1] };
    if (xMatch) return { type: 'x', id: xMatch[1] };
    if (url.match(/\.(mp4|webm|ogg)$/i)) return { type: 'video', url: url };
    
    return { type: 'image', url: url };
}

function renderMedia(url) {
    if (!url) return "";
    const media = getMediaType(url);

    if (media.type === 'youtube') {
        const thumbUrl = `https://img.youtube.com/vi/${media.id}/0.jpg`;
        return `<div class="media-container" onclick="openLightbox('youtube', '${media.id}')"><img src="${thumbUrl}"><div class="play-overlay">▶</div></div>`;
    } 
    else if (media.type === 'x') {
        return `<div class="media-container file-placeholder x-placeholder" onclick="openLightbox('x', '${media.id}')"><div class="file-ext" style="color:#1DA1F2">𝕏</div><div style="font-size:10px; color:#fff">View Post</div></div>`;
    } 
    else if (media.type === 'video') {
        return `<div class="media-container file-placeholder" onclick="openLightbox('video', '${media.url}')"><div class="file-ext">VIDEO</div><div>Play</div></div>`;
    } 
    else {
        return `<img src="${url}" class="thread-image" onclick="openLightbox('image', '${url}')">`;
    }
}

function openLightbox(type, content) {
    const lb = document.getElementById('lightbox');
    const img = document.getElementById('lbImg');
    const vid = document.getElementById('lbVideo');
    const frame = document.getElementById('lbFrame');

    img.style.display = vid.style.display = frame.style.display = 'none';
    img.src = vid.src = frame.src = "";
    frame.style.width = "800px";

    if (type === 'image') { img.src = content; img.style.display = 'block'; }
    else if (type === 'video') { vid.src = content; vid.style.display = 'block'; vid.play(); }
    else if (type === 'youtube') { 
        frame.src = `https://www.youtube.com/embed/${content}?autoplay=1`; 
        frame.style.display = 'block'; 
    }
    else if (type === 'x') { 
        frame.src = `https://platform.twitter.com/embed/Tweet.html?id=${content}&theme=${BOARDS[currentBoard].type === 'nsfw' ? 'dark' : 'light'}`; 
        frame.style.display = 'block'; frame.style.width = "550px"; 
    }
    lb.style.display = 'flex';
}

function closeLightbox(e) {
    if (e.target.id === 'lightbox' || e.target.id === 'lightboxContent') {
        document.getElementById('lightbox').style.display = 'none';
        document.getElementById('lbVideo').pause();
        document.getElementById('lbVideo').src = "";
        document.getElementById('lbFrame').src = "";
    }
}

// ==========================================
// 8. TEXT & BACKLINKS
// ==========================================

function formatComment(text) {
    if (!text) return "";
    let formatted = escapeHtml(text);
    formatted = formatted.replace(/&gt;&gt;([a-zA-Z0-9\-_]+)/g, (m, id) => `<a href="#post_${id}" class="quote-link">>>${id.substring(1,8)}</a>`);
    formatted = formatted.replace(/^(&gt;[^&].*)$/gm, '<span style="color:#789922;">$1</span>');
    return formatted;
}

function quotePost(id) {
    const box = document.getElementById('commentInput');
    box.value += `>>${id}\n`;
    box.focus();
    if(currentThreadId) document.getElementById('postForm').scrollIntoView();
}

function generateBacklinks() {
    document.querySelectorAll('.backlink-container').forEach(el => el.innerHTML = "");
    document.querySelectorAll('.comment').forEach(commentDiv => {
        const replierDiv = commentDiv.closest('[id^="post_"]');
        if (!replierDiv) return;
        const replierId = replierDiv.id.replace("post_", "");
        commentDiv.querySelectorAll('.quote-link').forEach(link => {
            const href = link.getAttribute('href');
            if(!href || !href.includes('#post_')) return;
            const targetId = href.split('#post_')[1];
            const container = document.getElementById('backlinks_' + targetId);
            if (container && !container.querySelector(`[href="#post_${replierId}"]`)) {
                if (container.childElementCount < 10) {
                    container.innerHTML += `<a href="#post_${replierId}" class="backlink" onmouseenter="highlightPost('${replierId}')" onmouseleave="unhighlightPost('${replierId}')">&gt;&gt;${replierId.substring(1,8)}</a>`;
                }
            }
        });
    });
}

function highlightPost(id) { const el = document.getElementById('post_'+id); if(el) el.style.background = "rgba(255,255,255,0.2)"; }
function unhighlightPost(id) { const el = document.getElementById('post_'+id); if(el) el.style.background = ""; }
function escapeHtml(t) { return t ? t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") : ""; }

// ==========================================
// 9. UPLOAD & SUBMIT
// ==========================================

const IMGBB_API_KEY = "6d885f930c72cd28e6520e6c7494704f";

document.addEventListener('DOMContentLoaded', () => {
    const uploadBtn = document.getElementById('uploadBtn');
    if (!uploadBtn) return;
    const hiddenInput = document.getElementById('hiddenFileInput');
    const urlInput = document.getElementById('imageInput');
    uploadBtn.onclick = () => hiddenInput.click();
    hiddenInput.onchange = async () => {
        const file = hiddenInput.files[0];
        if (!file) return;
        uploadBtn.innerText = "UP..."; uploadBtn.disabled = true;
        const formData = new FormData(); formData.append("image", file);
        try {
            const resp = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, { method: "POST", body: formData });
            const result = await resp.json();
            if (result.success) { urlInput.value = result.data.url; urlInput.focus(); }
        } catch (err) { alert("Upload Failed."); }
        finally { uploadBtn.innerText = "Upload Image"; uploadBtn.disabled = false; }
    };
});

function validateMediaUrl(url) {
    return new Promise((resolve) => {
        if (!url) return resolve(true);
        if (getMediaType(url).type !== 'image') return resolve(true);
        const img = new Image();
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        img.src = url;
        setTimeout(() => resolve(false), 5000);
    });
}

document.getElementById('postForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    const comment = document.getElementById('commentInput').value;
    const image = document.getElementById('imageInput').value.trim();
    if (!comment) return alert("Comment required");

    const btn = document.getElementById('submitBtn');
    btn.disabled = true; btn.innerText = "Processing...";

    if (!(await validateMediaUrl(image))) { alert("Invalid URL"); btn.disabled = false; btn.innerText = "Submit Post"; return; }

    let userIP = "Unknown";
    try { const resp = await fetch('https://api.ipify.org?format=json'); const data = await resp.json(); userIP = data.ip; } catch (err) {}

    const now = Date.now();
    const postData = { name: document.getElementById('nameInput').value || "Anonymous", comment, image, timestamp: now, ip: userIP };

    try {
        if (currentThreadId) {
            await database.ref('boards/' + currentBoard + '/threads/' + currentThreadId + '/replies').push(postData);
            await database.ref('boards/' + currentBoard + '/threads/' + currentThreadId).update({ lastUpdated: now });
        } else {
            postData.subject = document.getElementById('subjectInput').value;
            postData.lastUpdated = now;
            await getBoardRef().push(postData);
        }
        document.getElementById('commentInput').value = document.getElementById('imageInput').value = document.getElementById('subjectInput').value = "";
    } catch(e) { alert("Error: " + e.message); }
    finally { btn.disabled = false; btn.innerText = "Submit Post"; if (!currentThreadId) setTimeout(loadBoardView, 500); }
});