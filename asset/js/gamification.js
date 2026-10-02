// ==========================================
// GAMIFICATION.JS - Frontend Progression & Daily Omikuji
// Supports Anonymous Guests (localStorage) & Logged-in Sync
// ==========================================

const GUEST_GAMIFICATION_KEY = 'oshimy_guest_gamification';

const CLIENT_XP_RULES = {
    THREAD: 20,
    REPLY: 8,
    OMIKUJI: 16,
    STREAK: 4
};

const CLIENT_FORTUNES = [
    {
        type: 'Daikichi',
        title: '大吉 (Great Blessing)',
        badge: '✨',
        description: 'Your oshi read your superchat, laughed at your joke, and pinned your comment!'
    },
    {
        type: 'Chukichi',
        title: '中吉 (Middle Blessing)',
        badge: '🌟',
        description: 'Guaranteed SSR pull on your favorite banner tonight. Lucky stream archive unlocked!'
    },
    {
        type: 'Shokichi',
        title: '小吉 (Small Blessing)',
        badge: '🍀',
        description: 'Stream starts right on time with crisp 1080p60 and zero audio desync.'
    },
    {
        type: 'Suekichi',
        title: '末吉 (Future Blessing)',
        badge: '🌙',
        description: 'A surprise guerrilla midnight karaoke stream is secretly brewing.'
    },
    {
        type: 'Kyo',
        title: '凶 (Misfortune)',
        badge: '💀',
        description: 'Stream postponed due to an emergency Windows update and OBS audio meltdown!'
    }
];

const FACTION_OPTIONS = [
    { id: 'VOGI', name: '❌ VOGI' },
    { id: 'Project Orbit', name: '🪐 Project Orbit' },
    { id: 'Hoshizora Entertainment', name: '✨ Hoshizora Entertainment' },
    { id: 'VGakuenLive', name: '🏫 VGakuenLive' },
    { id: 'Indie', name: '🌺 Indie' },
    { id: 'Hololive', name: '▶️ Hololive' },
    { id: 'Nijisanji', name: '🌈 Nijisanji' },
    { id: 'Phase Connect', name: '🔗 Phase Connect' }
];

// Current active profile cache
let currentGamificationState = {
    isGuest: true,
    username: 'Anonymous',
    xp: 0,
    level: 1,
    rankTitle: 'DD Lurker',
    rankBadge: '🌱',
    streak: 0,
    oshi_badge: null,
    can_draw_omikuji: true,
    last_omikuji_date: null,
    last_fortune: null
};

function getXpRequirementForLevel(level) {
    const lvl = Math.max(1, parseInt(level, 10) || 1);
    let req = 25;
    for (let i = 1; i < lvl; i++) {
        req = Math.round(req * 1.1);
    }
    return req;
}

function calculateLevelFromXp(xp) {
    const validXp = Math.max(0, parseInt(xp, 10) || 0);
    let remXp = validXp;
    let level = 1;
    let currentReq = 25;
    while (remXp >= currentReq) {
        remXp -= currentReq;
        level++;
        currentReq = Math.round(currentReq * 1.1);
    }
    return level;
}

function getLevelProgress(xp) {
    const validXp = Math.max(0, parseInt(xp, 10) || 0);
    let remXp = validXp;
    let level = 1;
    let currentReq = 25;
    while (remXp >= currentReq) {
        remXp -= currentReq;
        level++;
        currentReq = Math.round(currentReq * 1.1);
    }
    const progressXp = remXp;
    const nextLevelReq = currentReq;
    const percent = nextLevelReq > 0 ? Math.min(100, Math.floor((progressXp / nextLevelReq) * 100)) : 100;
    return {
        level,
        progressXp,
        nextLevelReq,
        percent
    };
}

function getRankFromLevel(level) {
    const lvl = Math.max(1, parseInt(level, 10) || 1);
    if (lvl >= 30) return { title: 'Superchat Whale', badge: '🐳', minLvl: 30 };
    if (lvl >= 20) return { title: 'Gachikoi', badge: '💖', minLvl: 20 };
    if (lvl >= 10) return { title: 'Chat Member', badge: '⭐', minLvl: 10 };
    if (lvl >= 5) return { title: 'Shrimp', badge: '🦐', minLvl: 5 };
    return { title: 'DD Lurker', badge: '🌱', minLvl: 1 };
}

function getTodayUtcString() {
    return new Date().toISOString().slice(0, 10);
}

function getYesterdayUtcString() {
    return new Date(Date.now() - 86400000).toISOString().slice(0, 10);
}

// --- GUEST STORAGE HELPERS ---
function loadGuestGamification() {
    const raw = localStorage.getItem(GUEST_GAMIFICATION_KEY);
    if (!raw) {
        return {
            xp: 0,
            level: 1,
            streak: 0,
            last_active_date: null,
            last_omikuji_date: null,
            oshi_badge: null,
            last_fortune: null
        };
    }
    try {
        return JSON.parse(raw);
    } catch {
        return { xp: 0, level: 1, streak: 0, last_active_date: null, last_omikuji_date: null, oshi_badge: null, last_fortune: null };
    }
}

function saveGuestGamification(state) {
    localStorage.setItem(GUEST_GAMIFICATION_KEY, JSON.stringify(state));
}

// --- INITIALIZE GAMIFICATION SYSTEM ---
async function initGamification() {
    if (currentUser) {
        // Authenticated Member Mode
        await syncMemberGamification();
    } else {
        // Anonymous Guest Mode (Zero Database Calls!)
        const guest = loadGuestGamification();
        const today = getTodayUtcString();
        const level = calculateLevelFromXp(guest.xp);
        const rank = getRankFromLevel(level);

        currentGamificationState = {
            isGuest: true,
            username: 'Anonymous',
            xp: guest.xp || 0,
            level,
            rankTitle: rank.title,
            rankBadge: rank.badge,
            streak: guest.streak || 0,
            oshi_badge: guest.oshi_badge || null,
            can_draw_omikuji: guest.last_omikuji_date !== today,
            last_omikuji_date: guest.last_omikuji_date,
            last_fortune: guest.last_fortune
        };
        updateGamificationNav();
    }
}

// Fetch member profile from server
async function syncMemberGamification() {
    if (!authToken) return;
    try {
        const res = await apiFetch('/user/profile');
        if (res.success && res.user) {
            const u = res.user;
            currentGamificationState = {
                isGuest: false,
                username: u.username,
                xp: u.xp,
                level: u.level,
                rankTitle: u.rankTitle,
                rankBadge: u.rankBadge,
                streak: u.streak,
                oshi_badge: u.oshi_badge,
                can_draw_omikuji: u.can_draw_omikuji,
                last_omikuji_date: u.last_omikuji_date,
                last_fortune: null
            };
            updateGamificationNav();
        }
    } catch (err) {
        console.warn('Gamification sync notice:', err.message);
    }
}

// --- UPDATE NAV SITE BAR ---
function updateGamificationNav() {
    const rankDisplay = document.getElementById('userRankDisplay');
    const omikujiBadge = document.getElementById('omikujiBadge');

    if (rankDisplay) {
        const badge = currentGamificationState.rankBadge;
        const lvl = currentGamificationState.level;
        const selectedFaction = FACTION_OPTIONS.find(f => f.id === currentGamificationState.oshi_badge);
        const factionText = selectedFaction ? ` [${selectedFaction.name}]` : (currentGamificationState.oshi_badge ? ` [${currentGamificationState.oshi_badge}]` : '');
        rankDisplay.innerHTML = `${badge} Lv.${lvl} ${escapeHtml(currentGamificationState.rankTitle)}${factionText}`;
    }

    if (omikujiBadge) {
        if (currentGamificationState.can_draw_omikuji) {
            omikujiBadge.style.display = 'inline-block';
            omikujiBadge.innerText = 'Ready!';
            omikujiBadge.style.background = '#10b981'; // vibrant green
        } else {
            omikujiBadge.style.display = 'none';
        }
    }
}

// --- AWARD XP HOOK (CALLED ON THREAD / REPLY CREATION) ---
function handleGamificationPostHook(isThread = false) {
    const xpToAdd = isThread ? CLIENT_XP_RULES.THREAD : CLIENT_XP_RULES.REPLY;
    const actionLabel = isThread ? 'Thread Created!' : 'Reply Posted!';

    if (!currentGamificationState.isGuest) {
        // Authenticated: The server already incremented XP in the database
        const oldLevel = currentGamificationState.level;
        currentGamificationState.xp += xpToAdd;
        currentGamificationState.level = calculateLevelFromXp(currentGamificationState.xp);
        const rank = getRankFromLevel(currentGamificationState.level);
        currentGamificationState.rankTitle = rank.title;
        currentGamificationState.rankBadge = rank.badge;

        showGamificationToast(`+${xpToAdd} XP`, actionLabel, rank.badge);
        if (currentGamificationState.level > oldLevel) {
            setTimeout(() => {
                showGamificationToast(`🎉 LEVEL UP!`, `You reached Level ${currentGamificationState.level} (${rank.title})!`, '⭐');
            }, 600);
        }
        updateGamificationNav();
    } else {
        // Anonymous Guest: Update localStorage with zero network quota
        const guest = loadGuestGamification();
        const oldLevel = calculateLevelFromXp(guest.xp);
        guest.xp = (guest.xp || 0) + xpToAdd;
        const newLevel = calculateLevelFromXp(guest.xp);
        guest.level = newLevel;
        saveGuestGamification(guest);

        const rank = getRankFromLevel(newLevel);
        currentGamificationState.xp = guest.xp;
        currentGamificationState.level = newLevel;
        currentGamificationState.rankTitle = rank.title;
        currentGamificationState.rankBadge = rank.badge;

        showGamificationToast(`+${xpToAdd} XP`, actionLabel, rank.badge);
        if (newLevel > oldLevel) {
            setTimeout(() => {
                showGamificationToast(`🎉 LEVEL UP!`, `You reached Level ${newLevel} (${rank.title})!`, '⭐');
            }, 600);
        }
        updateGamificationNav();
    }
}

// --- DAILY OMIKUJI MODAL ---
function openOmikujiModal() {
    const modal = document.getElementById('omikujiModal');
    if (!modal) return;

    renderOmikujiModalContent();
    modal.style.display = 'flex';
}

function closeOmikujiModal() {
    const modal = document.getElementById('omikujiModal');
    if (modal) modal.style.display = 'none';
}

function renderOmikujiModalContent() {
    const box = document.getElementById('omikujiModalContent');
    if (!box) return;

    const s = currentGamificationState;
    const canDraw = s.can_draw_omikuji;
    const streak = s.streak || 0;

    let fortuneHtml = '';
    if (!canDraw && (s.last_fortune || !s.isGuest)) {
        // Already drawn today
        const fortune = s.last_fortune || {
            type: 'Daikichi',
            title: 'Fortune Drawn Today',
            badge: '🥠',
            description: 'You have already collected your daily blessing for today! Come back tomorrow for your next streak bonus.'
        };

        fortuneHtml = `
            <div class="omikuji-slip-card fortune-revealed" style="animation: slipPop 0.5s ease;">
                <div class="omikuji-kanji-stamp">${escapeHtml(fortune.badge)}</div>
                <h3 style="margin: 8px 0; font-size: 1.35rem; color: #dc2626;">${escapeHtml(fortune.title)}</h3>
                <p style="font-size: 0.95rem; margin: 10px 0; line-height: 1.5; color: var(--text-color);">
                    "${escapeHtml(fortune.description)}"
                </p>
                <div style="margin-top: 14px; padding-top: 10px; border-top: 1px dashed var(--border-color); font-size: 0.82rem; opacity: 0.85;">
                    ⏳ Cooldown active: Next fortune draw resets at midnight UTC.
                </div>
            </div>
        `;
    } else {
        // Ready to draw
        fortuneHtml = `
            <div class="omikuji-draw-box" id="omikujiDrawBox">
                <div class="omikuji-shrine-cylinder" id="shrineCylinder">
                    <div style="font-size: 3rem; margin-bottom: 6px;">🏮</div>
                    <div style="font-size: 1rem; font-weight: bold; color: var(--main-accent);">Oshi Shrine Omikuji</div>
                    <div style="font-size: 0.85rem; opacity: 0.8; margin-top: 4px;">Shake the cylinder to receive your daily fortune slip!</div>
                </div>
                <div style="margin-top: 16px;">
                    <button type="button" id="omikujiDrawActionBtn" class="btn-draw-omikuji" onclick="executeOmikujiDraw()">
                        🎋 Draw Daily Fortune (+16 XP)
                    </button>
                </div>
            </div>
        `;
    }

    box.innerHTML = `
        <div style="text-align: center; margin-bottom: 16px;">
            <div style="font-size: 0.88rem; font-weight: bold; color: var(--main-accent); margin-bottom: 4px;">
                ⛩️ DAILY OSHI OMIKUJI (おみくじ)
            </div>
            <div style="font-size: 0.82rem; opacity: 0.8;">
                Consecutive Streak: <b>🔥 ${streak} Day${streak === 1 ? '' : 's'}</b> 
                ${streak > 1 ? `<span style="color:#10b981; font-weight:bold;">(+${CLIENT_XP_RULES.STREAK} XP Bonus active)</span>` : ''}
            </div>
        </div>

        <div id="omikujiInteractiveSlot">
            ${fortuneHtml}
        </div>

        ${s.isGuest ? `
            <div style="margin-top: 18px; padding: 10px; border-radius: 6px; background: rgba(59, 130, 246, 0.08); border: 1px solid rgba(59, 130, 246, 0.2); font-size: 0.8rem; text-align: center;">
                🌱 <b>Guest Mode:</b> Your XP and daily fortunes are saved right here in your browser. 
                <a href="javascript:void(0)" onclick="closeOmikujiModal(); openAuthModal('register');" style="color:var(--main-accent); font-weight:bold;">Register an account</a> to sync across devices!
            </div>
        ` : ''}
    `;
}

async function executeOmikujiDraw() {
    const btn = document.getElementById('omikujiDrawActionBtn');
    const cylinder = document.getElementById('shrineCylinder');
    if (btn) btn.disabled = true;

    // Shake animation
    if (cylinder) {
        cylinder.classList.add('shrine-shake');
    }

    try {
        if (!currentGamificationState.isGuest) {
            // Call Member API
            const res = await apiFetch('/user/omikuji', { method: 'POST' });
            if (res.success) {
                currentGamificationState.can_draw_omikuji = false;
                currentGamificationState.xp = res.total_xp;
                currentGamificationState.level = res.level;
                currentGamificationState.rankTitle = res.rankTitle;
                currentGamificationState.rankBadge = res.rankBadge;
                currentGamificationState.streak = res.streak;
                currentGamificationState.last_fortune = res.fortune;

                updateGamificationNav();
                showGamificationToast(`+${res.xp_awarded} XP!`, `Drew ${res.fortune.title}`, res.fortune.badge);
                setTimeout(() => {
                    renderOmikujiModalContent();
                }, 700);
            }
        } else {
            // Anonymous Guest: Handle locally
            const today = getTodayUtcString();
            const guest = loadGuestGamification();
            if (guest.last_omikuji_date === today) {
                showToast('You have already drawn your fortune today!', 3500, 'info');
                return;
            }

            // Calculate streak
            let newStreak = 1;
            if (guest.last_active_date) {
                const yest = getYesterdayUtcString();
                if (guest.last_active_date === yest) {
                    newStreak = (guest.streak || 0) + 1;
                } else if (guest.last_active_date === today) {
                    newStreak = guest.streak || 1;
                }
            }

            const randIdx = Math.floor(Math.random() * CLIENT_FORTUNES.length);
            const fortune = CLIENT_FORTUNES[randIdx];
            const streakBonus = newStreak > 1 ? CLIENT_XP_RULES.STREAK : 0;
            const xpGained = CLIENT_XP_RULES.OMIKUJI + streakBonus;

            guest.xp = (guest.xp || 0) + xpGained;
            guest.level = calculateLevelFromXp(guest.xp);
            guest.streak = newStreak;
            guest.last_active_date = today;
            guest.last_omikuji_date = today;
            guest.last_fortune = fortune;
            saveGuestGamification(guest);

            const rank = getRankFromLevel(guest.level);
            currentGamificationState.can_draw_omikuji = false;
            currentGamificationState.xp = guest.xp;
            currentGamificationState.level = guest.level;
            currentGamificationState.rankTitle = rank.title;
            currentGamificationState.rankBadge = rank.badge;
            currentGamificationState.streak = newStreak;
            currentGamificationState.last_fortune = fortune;

            updateGamificationNav();
            showGamificationToast(`+${xpGained} XP!`, `Drew ${fortune.title}`, fortune.badge);
            setTimeout(() => {
                renderOmikujiModalContent();
            }, 700);
        }
    } catch (err) {
        showToast(err.message || 'Failed to draw fortune.', 4000, 'error');
        if (btn) btn.disabled = false;
        if (cylinder) cylinder.classList.remove('shrine-shake');
    }
}

// --- PROFILE / RANK MODAL ---
function openProfileModal() {
    const modal = document.getElementById('profileModal');
    if (!modal) return;

    renderProfileModalContent();
    modal.style.display = 'flex';
}

function closeProfileModal() {
    const modal = document.getElementById('profileModal');
    if (modal) modal.style.display = 'none';
}

function renderProfileModalContent() {
    const box = document.getElementById('profileModalContent');
    if (!box) return;

    const s = currentGamificationState;
    const prog = getLevelProgress(s.xp);
    s.level = prog.level;
    const rank = getRankFromLevel(s.level);
    s.rankTitle = rank.title;
    s.rankBadge = rank.badge;
    const progressXp = prog.progressXp;
    const nextLevelReq = prog.nextLevelReq;
    const percent = prog.percent;

    // Next Rank Milestone
    let nextMilestone = 'Max Rank Achieved (Superchat Whale 🐳)';
    if (s.level < 5) nextMilestone = 'Reach Lv.5 for 🦐 Shrimp rank';
    else if (s.level < 10) nextMilestone = 'Reach Lv.10 for ⭐ Chat Member rank';
    else if (s.level < 20) nextMilestone = 'Reach Lv.20 for 💖 Gachikoi rank';
    else if (s.level < 30) nextMilestone = 'Reach Lv.30 for 🐳 Superchat Whale rank';

    box.innerHTML = `
        <div style="display:flex; align-items:center; gap:14px; margin-bottom:16px;">
            <div style="font-size:2.8rem; background:rgba(0,0,0,0.05); width:64px; height:64px; border-radius:12px; display:flex; align-items:center; justify-content:center; border:1px solid var(--border-color);">
                ${s.rankBadge}
            </div>
            <div>
                <h3 style="margin:0; font-size:1.25rem;">
                    ${escapeHtml(s.username)}
                    ${s.isGuest ? `<span style="font-size:0.75rem; background:rgba(0,0,0,0.1); padding:2px 6px; border-radius:4px; margin-left:4px;">Guest</span>` : ''}
                </h3>
                <div style="font-size:0.9rem; font-weight:bold; color:var(--main-accent); margin-top:2px;">
                    ${s.rankBadge} ${escapeHtml(s.rankTitle)} • Level ${s.level}
                </div>
            </div>
        </div>

        <!-- PROGRESS BAR -->
        <div style="margin-bottom:18px;">
            <div style="display:flex; justify-content:space-between; font-size:0.82rem; margin-bottom:4px; opacity:0.85;">
                <span>EXP: <b>${s.xp} XP</b></span>
                <span>${progressXp} / ${nextLevelReq} XP to Lv.${s.level + 1} (${percent}%)</span>
            </div>
            <div style="height:10px; background:rgba(0,0,0,0.08); border-radius:9999px; overflow:hidden; border:1px solid var(--border-color);">
                <div style="width:${percent}%; height:100%; background:var(--main-accent); transition:width 0.4s ease;"></div>
            </div>
            <div style="font-size:0.75rem; opacity:0.75; margin-top:4px; text-align:right;">
                🎯 ${nextMilestone}
            </div>
        </div>

        <!-- STATS GRID -->
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:18px;">
            <div style="border:1px solid var(--border-color); border-radius:8px; padding:10px; text-align:center; background:rgba(0,0,0,0.02);">
                <div style="font-size:0.8rem; opacity:0.8;">Consecutive Streak</div>
                <div style="font-size:1.3rem; font-weight:bold; color:#ef4444; margin-top:2px;">🔥 ${s.streak} Days</div>
            </div>
            <div style="border:1px solid var(--border-color); border-radius:8px; padding:10px; text-align:center; background:rgba(0,0,0,0.02);">
                <div style="font-size:0.8rem; opacity:0.8;">Daily Omikuji</div>
                <div style="font-size:1.1rem; font-weight:bold; color:${s.can_draw_omikuji ? '#10b981' : '#6b7280'}; margin-top:4px;">
                    ${s.can_draw_omikuji ? '🎋 Ready to Draw' : '✅ Drawn Today'}
                </div>
            </div>
        </div>

        <!-- FACTION STAMP SELECTOR -->
        <div style="border-top:1px dashed var(--border-color); padding-top:14px; margin-bottom:16px;">
            <label style="font-size:0.85rem; font-weight:bold; display:block; margin-bottom:6px;">
                🚩 Select Your Faction / Stamp:
            </label>
            <div style="display:flex; gap:8px;">
                <select id="factionBadgeSelect" style="flex:1; padding:6px 8px; border-radius:6px; border:1px solid var(--border-color); background:var(--card-bg); color:var(--text-color); font-size:0.88rem;">
                    <option value="">-- No Faction (None) --</option>
                    ${FACTION_OPTIONS.map(opt => `
                        <option value="${opt.id}" ${s.oshi_badge === opt.id ? 'selected' : ''}>${opt.name}</option>
                    `).join('')}
                </select>
                <button type="button" onclick="saveFactionSelection()" style="padding:6px 14px; background:var(--main-accent); color:#fff; border:none; border-radius:6px; font-weight:bold; cursor:pointer; font-size:0.85rem;">
                    Save Faction
                </button>
            </div>
        </div>

        <!-- HOW TO EARN XP ACCORDION -->
        <details style="font-size:0.8rem; opacity:0.9; background:rgba(0,0,0,0.02); border:1px solid var(--border-color); border-radius:6px; padding:8px 10px;">
            <summary style="cursor:pointer; font-weight:bold;">💡 How to Earn EXP & Ranks</summary>
            <ul style="margin:8px 0 0 16px; padding:0; line-height:1.5;">
                <li><b>Create New Thread:</b> +20 XP</li>
                <li><b>Post a Reply:</b> +8 XP</li>
                <li><b>Draw Daily Omikuji:</b> +16 XP</li>
                <li><b>Daily Streak:</b> +4 XP bonus per consecutive day</li>
                <li style="margin-top:4px; opacity:0.85;"><b>Level Up Requirement:</b> Starts at 25 XP (Lv.1), increasing by +10% max XP each level.</li>
            </ul>
        </details>
    `;
}

async function saveFactionSelection() {
    const sel = document.getElementById('factionBadgeSelect');
    if (!sel) return;
    const newBadge = sel.value || null;

    try {
        if (!currentGamificationState.isGuest) {
            const res = await apiFetch('/user/badge', {
                method: 'POST',
                body: { badge: newBadge }
            });
            if (res.success) {
                currentGamificationState.oshi_badge = newBadge;
                updateGamificationNav();
                renderProfileModalContent();
                const opt = FACTION_OPTIONS.find(f => f.id === newBadge);
                showGamificationToast('Faction Saved!', `Joined ${opt ? opt.name : 'None'}`, '🚩');
            }
        } else {
            const guest = loadGuestGamification();
            guest.oshi_badge = newBadge;
            saveGuestGamification(guest);
            currentGamificationState.oshi_badge = newBadge;
            updateGamificationNav();
            renderProfileModalContent();
            const opt = FACTION_OPTIONS.find(f => f.id === newBadge);
            showGamificationToast('Faction Saved!', `Joined ${opt ? opt.name : 'None'}`, '🚩');
        }
    } catch (err) {
        showToast('Failed to save faction: ' + err.message, 4000, 'error');
    }
}

// --- FLOATING XP TOAST NOTIFICATION ---
function showGamificationToast(title, message, icon = '✨') {
    let container = document.getElementById('gamificationToastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'gamificationToastContainer';
        container.className = 'gamification-toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = 'gamification-toast-item';
    toast.innerHTML = `
        <div class="toast-icon">${icon}</div>
        <div class="toast-body">
            <div class="toast-title">${escapeHtml(title)}</div>
            <div class="toast-desc">${escapeHtml(message)}</div>
        </div>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('toast-fade-out');
        setTimeout(() => {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 400);
    }, 3200);
}
