// ==========================================
// APP.JS - Core Logic, Routing, Rendering
// ==========================================

// --- NSFW GATE ---
function checkNSFWGate() {
    if (currentBoard && BOARDS[currentBoard] && BOARDS[currentBoard].type === 'nsfw') {
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

// --- ROUTER ---
window.addEventListener('hashchange', router);
window.addEventListener('load', router);

function router() {
    const hash = window.location.hash;
    if (hash === "#bottom") return;

    // View Elements
    const homeView = document.getElementById('homeView');
    const boardView = document.getElementById('boardView');
    const threadView = document.getElementById('threadView');
    const formWrapper = document.getElementById('formWrapper');
    const topDivider = document.getElementById('topDivider');

    document.body.classList.remove('night-mode');

    // 1. HOME PAGE (No Board Selected)
    if (!currentBoard || !BOARDS[currentBoard]) {
        homeView.style.display = "block";
        boardView.style.display = "none";
        threadView.style.display = "none";
        formWrapper.style.display = "none";
        topDivider.style.display = "none";
        document.getElementById('boardTitle').innerText = "MYVT - Portal";
        document.title = "MYVT - Portal";
        return;
    }

    // 2. BOARD / THREAD MODE
    homeView.style.display = "none";
    topDivider.style.display = "block";
    
    // Set Titles & Theme
    document.title = BOARDS[currentBoard].title;
    document.getElementById('boardTitle').innerText = BOARDS[currentBoard].title;
    
    if (BOARDS[currentBoard].type === 'nsfw') document.body.classList.add('night-mode');

    // Check Gate
    if (!checkNSFWGate()) return;

    // Detect Archive Mode
    const urlParam = new URLSearchParams(window.location.search);
    const isArchiveView = urlParam.get('view') === 'archive';

    if (hash.startsWith("#thread_")) {
        // Thread Mode
        formWrapper.style.display = "block"; // Default show, hidden later if locked
        currentThreadId = hash.replace("#thread_", "");
        loadThreadView(currentThreadId);
    } else {
        // Board Mode
        currentThreadId = null;
        // Hide "New Thread" form if in Archive Mode
        formWrapper.style.display = isArchiveView ? "none" : "block"; 
        loadBoardView(isArchiveView);
    }
}

// --- DYNAMIC HEADER ---
window.addEventListener('DOMContentLoaded', () => {
    const navContainer = document.getElementById('navBoards');
    if (!currentBoard || !BOARDS[currentBoard]) return; 
    
    const currentType = BOARDS[currentBoard].type;
    let html = "";
    
    // 1. Board Links
    for (const [key, data] of Object.entries(BOARDS)) {
        if (data.type === currentType) {
            const isActive = (key === currentBoard) ? 'style="font-weight:900; border-bottom: 2px solid;"' : '';
            html += `[ <a href="?b=${key}" ${isActive}>/${key}/</a> ] `;
        }
    }

    // 2. Archive Toggle Links
    html += `<div style="margin-top:8px; font-size:0.9em; opacity:0.9;">`;
    const urlParam = new URLSearchParams(window.location.search);
    const isArchived = urlParam.get('view') === 'archive';
    
    if (isArchived) {
        html += `[ <a href="?b=${currentBoard}">Current Threads</a> ] 
                 [ <span style="font-weight:bold; color:var(--header-color);">Archives</span> ]`;
    } else {
        html += `[ <span style="font-weight:bold; color:var(--header-color);">Current Threads</span> ] 
                 [ <a href="?b=${currentBoard}&view=archive">Archives</a> ]`;
    }
    html += `</div>`;

    // 3. Return Link (NSFW only)
    if (currentType === 'nsfw') html += `<div style="font-size:0.8em; margin-top:5px;">[ <a href="?b=myvt">Return to Surface</a> ]</div>`;
    
    navContainer.innerHTML = html;
});

// ==========================================
// 5. VIEW LOGIC
// ==========================================

function loadBoardView(isArchiveMode) {

    // --- RESET RELOAD FLAG ---
    // User returned to board, so next time they click a thread, allow a reload again.
    if (!window.location.hash.startsWith("#thread_")) {
        sessionStorage.removeItem('thread_reloaded');
    }
    // -------------------------

    document.getElementById('boardView').style.display = "block";
    document.getElementById('threadView').style.display = "none";
    document.getElementById('formTitle').innerText = "Create New Thread";
    document.getElementById('subjectInput').style.display = "block";

    if (isArchiveMode) {
        document.getElementById('boardTitle').innerHTML += ` <span style="color:red; font-size:0.6em;">[ARCHIVE]</span>`;
    }

    // --- ARCHIVE FILTER LOGIC ---
    const now = Date.now();
    // Default to 3 days if config missing
    const limit = (typeof ARCHIVE_TIME_MS !== 'undefined') ? ARCHIVE_TIME_MS : 259200000; 
    const cutoff = now - limit;

    let query = getBoardRef().orderByChild('lastUpdated');

    if (isArchiveMode) {
        // Get Old Threads
        query = query.endAt(cutoff).limitToLast(50);
    } else {
        // Get Active Threads
        query = query.startAt(cutoff);
    }

    query.on('value', (snapshot) => {
        const div = document.getElementById('threadList');
        div.innerHTML = "";
        const data = snapshot.val();
        
        if (!data) {
            div.innerHTML = `<div style="text-align:center; padding:20px; color:#666;">No threads found in this view.</div>`;
            return;
        }

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
            threadHtml += '<hr class="thread-separator">';
            div.innerHTML += threadHtml;
        });
    });
}

function loadThreadView(threadId) {

    // --- FORCE SINGLE RELOAD SNIPPET ---
    // If we haven't reloaded yet for this specific viewing session...
    if (!sessionStorage.getItem('thread_reloaded')) {
        sessionStorage.setItem('thread_reloaded', 'true'); // Mark as done
        window.location.reload(); // Reload the page
        return; // Stop script execution until reload completes
    }

    document.getElementById('boardView').style.display = "none";
    document.getElementById('threadView').style.display = "block";
    document.getElementById('formTitle').innerText = "Reply to Thread " + threadId.substring(1,8);
    document.getElementById('subjectInput').style.display = "none";

    // 1. Load OP
    database.ref('boards/' + currentBoard + '/threads/' + threadId).on('value', (snap) => {
        const op = snap.val();
        if(!op) { 
            if(window.location.hash.includes(threadId)) window.location.hash = ""; 
            return; 
        }
        
        document.getElementById('opContainer').innerHTML = renderThreadCard(threadId, op, false);

        // --- NEW: CHECK FOR PENDING QUOTES ---
        // Check if we came here from the Board View with a quote request
        const pending = sessionStorage.getItem('pending_quote');
        if (pending) {
            const box = document.getElementById('commentInput');
            box.value += pending + '\n';
            sessionStorage.removeItem('pending_quote'); // Clear it so it doesn't happen again on refresh
            document.getElementById('postForm').scrollIntoView();
        }

        // --- CHECK ARCHIVE LOCK ---
        const limit = (typeof ARCHIVE_TIME_MS !== 'undefined') ? ARCHIVE_TIME_MS : 259200000;
        const timeDiff = Date.now() - (op.lastUpdated || op.timestamp);
        const formDiv = document.getElementById('formWrapper');

        // Lock form if old AND not admin
        if (timeDiff > limit && !isModMode) {
            formDiv.innerHTML = `<div class="post-box" style="text-align:center; padding:20px; font-weight:bold; color:#777; background:var(--reply-bg);">⛔ This thread is archived and locked.</div>`;
        } else {
            // If the form was previously replaced by the lock message, we might need to reload 
            // to get the form back when switching threads.
            // For now, if the ID 'postForm' is missing, simply reload page to restore it.
            if (!document.getElementById('postForm')) location.reload();
        }

        setTimeout(generateBacklinks, 200);
    });

    // 2. Load Replies
    database.ref('boards/' + currentBoard + '/threads/' + threadId + '/replies').on('value', (snapshot) => {
        const div = document.getElementById('repliesContainer');
        div.innerHTML = ""; // Clear current list
        
        const data = snapshot.val();
        if (data) {
            Object.entries(data).forEach(([id, reply]) => {
                div.innerHTML += renderReply(id, reply, threadId);
            });
        }
        
        // --- FIX: Run Backlinks Logic Immediately ---
        // We run this AFTER the innerHTML is set, so the elements exist.
        generateBacklinks(); 
        
        // Run it again after a tiny delay just in case the DOM was slow to paint (for mobile)
        setTimeout(generateBacklinks, 100);
    });

}

// ==========================================
// 6. RENDERERS (UI)
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
        <div class="post-info">
            <span class="subject">${data.subject || ""}</span>
            <span class="name">${data.name}</span>
            <span class="time">${date}</span> 
            <span class="post-id" onclick="quotePost('${id}', '${id}')">No. ${id.substring(1,8)}</span>
            ${ipHtml} ${delBtn} ${replyLink}
        </div>
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
            <span class="post-id" onclick="quotePost('${id}', '${threadId}')">No. ${id.substring(1,8)}</span>
            ${ipHtml} ${delBtn}
        </div>
        ${renderMedia(data.image)}
        <blockquote class="comment">${formatComment(data.comment)}</blockquote>
        <div class="backlink-container" id="backlinks_${id}"></div>
    </div>`;
}

// ==========================================
// 7. SUBMIT LOGIC (With Cooldown & "You" ID Saving)
// ==========================================

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
    const btn = document.getElementById('submitBtn');

    // --- 1. SPAM COOLDOWN ---
    const now = Date.now(); 
    const lastPostTime = localStorage.getItem('last_post_time');
    const COOLDOWN_SECONDS = 15; 

    if (lastPostTime) {
        const diff = (now - parseInt(lastPostTime)) / 1000;
        if (diff < COOLDOWN_SECONDS) {
            const remaining = Math.ceil(COOLDOWN_SECONDS - diff);
            alert(`Please wait ${remaining} seconds before posting again.`);
            return;
        }
    }

    if (!comment) return alert("Comment required");

    btn.disabled = true; 
    btn.innerText = "Processing...";

    // --- 2. MEDIA VALIDATION ---
    if (!(await validateMediaUrl(image))) { 
        alert("Invalid URL"); 
        btn.disabled = false; 
        btn.innerText = "Submit Post"; 
        return; 
    }

    let userIP = "Unknown";
    try { 
        const resp = await fetch('https://api.ipify.org?format=json'); 
        const data = await resp.json(); 
        userIP = data.ip; 
    } catch (err) {}

    // --- 3. PREPARE DATA ---
    const postData = { 
        name: document.getElementById('nameInput').value || "Anonymous", 
        comment, 
        image, 
        timestamp: now, 
        ip: userIP 
    };

    // --- 4. SAVE TO FIREBASE & LOCAL STORAGE ---
    try {
        // Load existing history of "(You)" posts
        const MY_POSTS = JSON.parse(localStorage.getItem('my_posts') || "[]");

        if (currentThreadId) {
            // CASE A: REPLYING
            // Push to Firebase and Capture the Reference (newRef)
            const newRef = await database.ref('boards/' + currentBoard + '/threads/' + currentThreadId + '/replies').push(postData);
            
            // Save the new ID to our local history
            MY_POSTS.push(newRef.key);
            
            // Update Bump Time
            await database.ref('boards/' + currentBoard + '/threads/' + currentThreadId).update({ lastUpdated: now });
        } else {
            // CASE B: NEW THREAD
            postData.subject = document.getElementById('subjectInput').value;
            postData.lastUpdated = now;
            
            // Push to Firebase and Capture Ref
            const newRef = await getBoardRef().push(postData);
            
            // Save the new ID
            MY_POSTS.push(newRef.key);
        }

        // Commit the updated list to LocalStorage
        localStorage.setItem('my_posts', JSON.stringify(MY_POSTS));
        
        // Save Cooldown Timestamp
        localStorage.setItem('last_post_time', now);

        // Reset Form
        document.getElementById('commentInput').value = "";
        document.getElementById('imageInput').value = "";
        document.getElementById('subjectInput').value = "";
        
    } catch(e) { 
        alert("Error: " + e.message); 
    } finally { 
        btn.disabled = false; 
        btn.innerText = "Submit Post"; 
        
        // Reload board if we are on the index
        if (!currentThreadId) setTimeout(() => loadBoardView(), 500); 
    }
});