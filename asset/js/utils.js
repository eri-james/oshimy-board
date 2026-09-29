// ==========================================
// UTILS.JS - Helpers & Text Processing
// ==========================================

// Get list of my own posts from storage
const MY_POSTS = JSON.parse(localStorage.getItem('my_posts') || "[]");

function escapeHtml(text) {
    if (!text) return "";
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function formatComment(text) {
    if (!text) return "";
    let formatted = escapeHtml(text);
    
    // Quote Links (>>ID)
    const quoteRegex = /&gt;&gt;([a-zA-Z0-9\-_]+)/g;
    formatted = formatted.replace(quoteRegex, (m, id) => {
        // Check if I own this post ID
        const isMe = MY_POSTS.includes(id);
        const youTag = isMe ? ` <span style="font-weight:bold; font-style:italic; font-size:0.9em;">(You)</span>` : "";
        
        return `<a href="#post_${id}" class="quote-link" data-post-id="${id}">>>${id.substring(1,8)}</a>${youTag}`;
    });
    
    // 2. NEW: Auto-Linkify URLs (http/https)
    // Matches http:// or https:// followed by non-whitespace characters
    const urlRegex = /(https?:\/\/[^\s<]+)/g;
    formatted = formatted.replace(urlRegex, (url) => {
        return `<a href="${url}" target="_blank" style="color:var(--main-accent); text-decoration:underline;">${url}</a>`;
    });

    // 3. Greentext (>text)
    const greenRegex = /^(&gt;[^&].*)$/gm;
    formatted = formatted.replace(greenRegex, '<span style="color:#2e7d32;">$1</span>');
    
    return formatted;
}

function quotePost(postId, threadId) {
    // Scenario 1: We are on the Board View (or a different thread)
    // We need to jump to the correct thread first.
    if (!currentThreadId || currentThreadId !== threadId) {
        // Save the quote to browser memory
        sessionStorage.setItem('pending_quote', '>>' + postId);
        
        // Redirect to the correct thread
        window.location.hash = '#thread_' + threadId;
        return;
    }

    // Scenario 2: We are already in the correct thread
    const box = document.getElementById('commentInput');
    
    // Add new line if box isn't empty
    const prefix = box.value.length > 0 ? '\n' : '';
    
    box.value += `${prefix}>>${postId}\n`;
    box.focus();
    
    // Scroll to form
    document.getElementById('postForm').scrollIntoView();
}

function highlightPost(id) { 
    const el = document.getElementById('post_'+id); 
    if(el) el.style.boxShadow = "0 0 10px var(--main-accent)"; 
}

function unhighlightPost(id) { 
    const el = document.getElementById('post_'+id); 
    if(el) el.style.boxShadow = ""; 
}

function generateBacklinks(scopeElement = null) {
    // 1. Only clear existing backlinks on a full-page initial load.
    // In silent/incremental updates, scopeElement is passed, so we NEVER wipe out existing backlinks!
    if (!scopeElement) {
        document.querySelectorAll('.backlink-container').forEach(el => el.innerHTML = "");
    }

    // 2. Scan comments within the requested scope
    const root = scopeElement || document;
    const comments = root.querySelectorAll ? root.querySelectorAll('.comment') : [];
    
    comments.forEach(commentDiv => {
        // Identify the Replier (The Child)
        const replierDiv = commentDiv.closest('[id^="post_"]'); 
        if (!replierDiv) return;
        const replierId = replierDiv.id.replace("post_", "");

        // Find every quote (>>ID) in this comment
        const links = commentDiv.querySelectorAll('.quote-link');
        
        links.forEach(link => {
            // Identify the Target (The Parent)
            const href = link.getAttribute('href');
            if(!href || !href.includes('#post_')) return;
            
            // Extract pure ID
            const targetId = href.split('#post_')[1];
            
            // 3. Find the container of the Parent post
            const container = document.getElementById('backlinks_' + targetId);
            
            if (container) {
                // Prevent duplicate backlinks for the same replier
                const existing = container.querySelector(`a[href="#post_${replierId}"]`);
                if (existing) return;

                // Limit visual clutter (max 15 backlinks)
                if (container.childElementCount < 15) {
                    const displayId = replierId.substring(1,8);
                    
                    // Create the link
                    const newLink = document.createElement('a');
                    newLink.href = `#post_${replierId}`;
                    newLink.className = 'backlink';
                    newLink.setAttribute('data-post-id', replierId);
                    newLink.innerHTML = `&gt;&gt;${displayId}`;
                    
                    // Add Highlight Events
                    newLink.onmouseenter = () => highlightPost(replierId);
                    newLink.onmouseleave = () => unhighlightPost(replierId);
                    
                    container.appendChild(newLink);
                }
            }
        });
    });
}

// ==========================================
// TOAST NOTIFICATION
// ==========================================
let toastTimer = null;
function showToast(message, duration = 3000) {
    let toast = document.getElementById('siteToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'siteToast';
        toast.className = 'site-toast';
        document.body.appendChild(toast);
    }
    toast.innerText = message;
    toast.classList.add('show');

    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        toast.classList.remove('show');
    }, duration);
}

// ==========================================
// SEAMLESS POST & LINKBACK NAVIGATION
// ==========================================
function navigateToPost(postId, triggerElement = null) {
    if (!postId) return;

    const targetEl = document.getElementById('post_' + postId);
    if (targetEl) {
        // Post is already on the current page: smooth scroll & pulse highlight
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        targetEl.classList.remove('post-highlight-active');
        void targetEl.offsetWidth; // trigger reflow for animation restart
        targetEl.classList.add('post-highlight-active');
        setTimeout(() => {
            targetEl.classList.remove('post-highlight-active');
        }, 2500);
        return;
    }

    // Post is NOT on the current view:
    // Check if we are on the Board View and the click came from inside a thread card
    if (!currentThreadId) {
        const threadCard = triggerElement ? triggerElement.closest('.thread') : null;
        if (threadCard && threadCard.id) {
            const threadId = threadCard.id.replace('thread_', '');
            sessionStorage.setItem('pending_scroll_post', postId);
            window.location.hash = '#thread_' + threadId;
            return;
        }
    }

    // If inside thread view and post was not found (e.g. deleted reply)
    showToast(`Referenced post >>${postId.substring(1, 9)} not found.`);
}

// Intercept all quote-link and backlink clicks so they never crash into board mode
document.addEventListener('click', (e) => {
    // Hide any open hover preview tooltip immediately upon clicking
    if (previewTooltip) {
        previewTooltip.classList.remove('visible');
        previewTooltip.style.display = 'none';
    }

    const link = e.target.closest('.quote-link, .backlink');
    if (!link) return;

    // Prevent default browser jump which replaces the hash with #post_...
    e.preventDefault();
    e.stopPropagation();

    const postId = link.getAttribute('data-post-id') || (link.getAttribute('href') || '').replace('#post_', '');
    if (postId) {
        navigateToPost(postId, link);
    }
});

// ==========================================
// FLOATING HOVER PREVIEWS FOR QUOTES & BACKLINKS
// ==========================================
let previewTooltip = null;

function initHoverPreviews() {
    if (!previewTooltip) {
        previewTooltip = document.createElement('div');
        previewTooltip.id = 'postPreviewPopup';
        previewTooltip.className = 'post-preview-popup';
        // Guaranteed inline safeguards so it never appears as a block at page bottom
        previewTooltip.style.position = 'fixed';
        previewTooltip.style.display = 'none';
        previewTooltip.style.zIndex = '10000';
        document.body.appendChild(previewTooltip);
    }

    document.addEventListener('mouseover', (e) => {
        const link = e.target.closest('.quote-link, .backlink');
        if (!link) return;

        const postId = link.getAttribute('data-post-id') || (link.getAttribute('href') || '').replace('#post_', '');
        if (!postId) return;

        const targetEl = document.getElementById('post_' + postId);
        if (!targetEl) return;

        highlightPost(postId);

        // Populate hover preview tooltip with a cloned snapshot
        const clone = targetEl.cloneNode(true);
        clone.removeAttribute('id');
        clone.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
        
        previewTooltip.innerHTML = '';
        previewTooltip.appendChild(clone);
        previewTooltip.style.display = 'block';
        previewTooltip.classList.add('visible');

        // Position tooltip clamped to viewport
        const rect = link.getBoundingClientRect();
        const popupWidth = Math.min(480, window.innerWidth - 30);
        let left = rect.left;
        if (left + popupWidth > window.innerWidth - 15) {
            left = window.innerWidth - popupWidth - 15;
        }
        if (left < 10) left = 10;

        let top = rect.bottom + 8;
        if (top + 220 > window.innerHeight && rect.top > 220) {
            top = rect.top - 8 - (previewTooltip.offsetHeight || 140);
        }

        previewTooltip.style.left = `${left}px`;
        previewTooltip.style.top = `${top}px`;
    });

    document.addEventListener('mouseout', (e) => {
        const link = e.target.closest('.quote-link, .backlink');
        if (!link) return;

        const postId = link.getAttribute('data-post-id') || (link.getAttribute('href') || '').replace('#post_', '');
        if (postId) {
            unhighlightPost(postId);
        }

        if (previewTooltip) {
            previewTooltip.classList.remove('visible');
            previewTooltip.style.display = 'none';
            previewTooltip.innerHTML = '';
        }
    });
}

// ==========================================
// FLOATING BACK TO TOP BUBBLE
// ==========================================
function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function initBackToTop() {
    const btn = document.getElementById('backToTopBtn');
    if (!btn) return;

    window.addEventListener('scroll', () => {
        // Appears when scrolled down more than 280px
        if (window.scrollY > 280) {
            btn.classList.add('visible');
        } else {
            btn.classList.remove('visible');
        }
    }, { passive: true });
}

// Auto-initialize on load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        initHoverPreviews();
        initBackToTop();
    });
} else {
    initHoverPreviews();
    initBackToTop();
}