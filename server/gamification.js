// ==========================================
// GAMIFICATION.JS - EXP, Level Progression, and Oshi Omikuji Logic
// ==========================================

export const XP_RULES = {
    THREAD_CREATION: 20,
    REPLY_CREATION: 8,
    OMIKUJI_DRAW: 16,
    DAILY_STREAK: 4, // per consecutive day
    REACTION_RECEIVED: 4
};

export const OMIKUJI_FORTUNES = [
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

export const ALLOWED_OSHI_BADGES = [
    'VOGI',
    'Project Orbit',
    'Hoshizora Entertainment',
    'VGakuenLive',
    'Indie',
    'Hololive',
    'Nijisanji',
    'Phase Connect'
];

export function getXpRequirementForLevel(level) {
    const lvl = Math.max(1, parseInt(level, 10) || 1);
    let req = 25;
    for (let i = 1; i < lvl; i++) {
        req = Math.round(req * 1.1);
    }
    return req;
}

export function calculateLevel(xp) {
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

export function getLevelProgress(xp) {
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

export function getRank(level) {
    const lvl = Math.max(1, parseInt(level, 10) || 1);
    if (lvl >= 30) {
        return { title: 'Superchat Whale', badge: '🐳', minLvl: 30 };
    } else if (lvl >= 20) {
        return { title: 'Gachikoi', badge: '💖', minLvl: 20 };
    } else if (lvl >= 10) {
        return { title: 'Chat Member', badge: '⭐', minLvl: 10 };
    } else if (lvl >= 5) {
        return { title: 'Shrimp', badge: '🦐', minLvl: 5 };
    } else {
        return { title: 'DD Lurker', badge: '🌱', minLvl: 1 };
    }
}

export function getTodayDateStr() {
    // Format YYYY-MM-DD in UTC
    return new Date().toISOString().slice(0, 10);
}

export function drawRandomOmikuji() {
    const index = Math.floor(Math.random() * OMIKUJI_FORTUNES.length);
    return OMIKUJI_FORTUNES[index];
}

/**
 * Safely awards XP to a user in SQLite and updates their level using the dynamic scaling formula.
 */
export function awardUserXP(db, userId, xpAmount) {
    if (!userId || !xpAmount || xpAmount <= 0) return null;
    try {
        const user = db.prepare('SELECT xp FROM users WHERE id = ?').get(userId);
        if (!user) return null;
        const newXp = (user.xp || 0) + xpAmount;
        const newLevel = calculateLevel(newXp);
        db.prepare(`
            UPDATE users
            SET xp = ?,
                level = ?
            WHERE id = ?
        `).run(newXp, newLevel, userId);
        return true;
    } catch (err) {
        console.error('[Gamification] awardUserXP error:', err);
        return null;
    }
}
