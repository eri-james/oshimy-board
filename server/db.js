import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const dbPath = path.join(rootDir, 'myvt.db');
export const db = new DatabaseSync(dbPath);

// Enable foreign keys
db.exec('PRAGMA foreign_keys = ON;');

// Initialize schema
const schemaSql = fs.readFileSync(path.join(rootDir, 'db', 'schema.sql'), 'utf-8');
db.exec(schemaSql);

// Safe auto-migrations for gamification fields and performance denormalizations
try {
    const userCols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
    if (!userCols.includes('xp')) db.exec("ALTER TABLE users ADD COLUMN xp INTEGER NOT NULL DEFAULT 0;");
    if (!userCols.includes('level')) db.exec("ALTER TABLE users ADD COLUMN level INTEGER NOT NULL DEFAULT 1;");
    if (!userCols.includes('streak')) db.exec("ALTER TABLE users ADD COLUMN streak INTEGER NOT NULL DEFAULT 0;");
    if (!userCols.includes('last_active_date')) db.exec("ALTER TABLE users ADD COLUMN last_active_date TEXT;");
    if (!userCols.includes('last_omikuji_date')) db.exec("ALTER TABLE users ADD COLUMN last_omikuji_date TEXT;");
    if (!userCols.includes('oshi_badge')) db.exec("ALTER TABLE users ADD COLUMN oshi_badge TEXT;");

    const threadCols = db.prepare("PRAGMA table_info(threads)").all().map(c => c.name);
    if (!threadCols.includes('reply_count')) {
        db.exec("ALTER TABLE threads ADD COLUMN reply_count INTEGER NOT NULL DEFAULT 0;");
    }
    if (!threadCols.includes('vanity_flair')) {
        db.exec("ALTER TABLE threads ADD COLUMN vanity_flair TEXT;");
    }
    if (!threadCols.includes('reactions')) {
        db.exec("ALTER TABLE threads ADD COLUMN reactions TEXT DEFAULT '{}';");
    }
    if (!threadCols.includes('locked_at')) {
        db.exec("ALTER TABLE threads ADD COLUMN locked_at INTEGER;");
    }
    if (!threadCols.includes('is_archived')) {
        db.exec("ALTER TABLE threads ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0;");
    }
    if (!threadCols.includes('is_static')) {
        db.exec("ALTER TABLE threads ADD COLUMN is_static INTEGER NOT NULL DEFAULT 0;");
    }
    if (!threadCols.includes('static_path')) {
        db.exec("ALTER TABLE threads ADD COLUMN static_path TEXT;");
    }

    const replyCols = db.prepare("PRAGMA table_info(replies)").all().map(c => c.name);
    if (!replyCols.includes('vanity_flair')) {
        db.exec("ALTER TABLE replies ADD COLUMN vanity_flair TEXT;");
    }
    if (!replyCols.includes('reactions')) {
        db.exec("ALTER TABLE replies ADD COLUMN reactions TEXT DEFAULT '{}';");
    }

    // Sync any existing locked threads to be archived as well
    db.exec(`
        UPDATE threads 
        SET is_archived = 1, locked_at = COALESCE(locked_at, bumped_at) 
        WHERE is_locked = 1 AND is_archived = 0;
    `);

    // Always ensure denormalized reply_count is accurately synced with replies table
    db.exec(`
        UPDATE threads
        SET reply_count = (SELECT COUNT(*) FROM replies WHERE replies.thread_id = threads.id);
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS post_reactions (
            post_id TEXT NOT NULL,
            stamp TEXT NOT NULL,
            ip_hash TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (post_id, stamp, ip_hash)
        );
        CREATE INDEX IF NOT EXISTS idx_post_reactions_post ON post_reactions(post_id);
        CREATE TABLE IF NOT EXISTS reply_mentions (
            id TEXT PRIMARY KEY,
            source_reply_id TEXT,
            target_user_id TEXT NOT NULL,
            thread_id TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            is_read INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE,
            FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_mentions_target_unread ON reply_mentions(target_user_id, is_read);
        CREATE INDEX IF NOT EXISTS idx_mentions_target_created ON reply_mentions(target_user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_replies_thread_created_desc ON replies(thread_id, created_at DESC);
    `);
} catch (err) {
    console.error('[DB] Auto-migration error:', err);
}

// Security Helpers
export function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
    if (!stored || !stored.includes(':')) return false;
    const [salt, key] = stored.split(':');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(key, 'hex'), Buffer.from(hash, 'hex'));
}

export function hashIp(ip) {
    if (!ip || ip === 'Unknown') return 'anon';
    return crypto.createHash('sha256').update(ip + '-myvt-salt').digest('hex').substring(0, 12);
}

// Thread-scoped anonymous poster ID (unlinkable across different threads)
export function generatePosterId(ipHash, threadId) {
    const raw = `${ipHash || 'anon'}:${threadId || 'global'}:oshimy-poster-salt`;
    return crypto.createHash('sha256').update(raw).digest('base64url').replace(/[-_]/g, 'X').substring(0, 6);
}

// Generate unique ID (compatible with Firebase string keys)
export function generateId() {
    return '-' + Date.now().toString(36) + crypto.randomBytes(6).toString('base64url');
}

// Seed admin user and historical data
export function initSeedData() {
    // 1. Ensure Default Admin & Moderator accounts exist
    const adminCheck = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
    if (!adminCheck) {
        const adminId = 'user_admin_01';
        const adminHash = hashPassword('admin123');
        db.prepare(`
            INSERT INTO users (id, username, password_hash, role, display_title, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(adminId, 'admin', adminHash, 'admin', 'Admin 🛡️', Date.now());
        console.log('[DB] Created default admin account: admin / admin123');
    }

    // 2. Check if threads table needs seeding from Firebase backup
    const threadCountRow = db.prepare('SELECT COUNT(*) as count FROM threads').get();
    if (threadCountRow && threadCountRow.count === 0) {
        console.log('[DB] Threads table empty. Seeding from legacy_archive/firebase_backup.json...');
        const backupPath = path.join(rootDir, 'legacy_archive', 'firebase_backup.json');
        if (fs.existsSync(backupPath)) {
            try {
                const data = JSON.parse(fs.readFileSync(backupPath, 'utf-8'));
                const boards = data.boards || {};
                
                const insertThread = db.prepare(`
                    INSERT INTO threads (id, board, name, subject, comment, media_url, ip_hash, created_at, bumped_at, is_pinned, is_locked, reply_count)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)
                `);

                const insertReply = db.prepare(`
                    INSERT INTO replies (id, thread_id, board, name, comment, media_url, ip_hash, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `);

                let threadCount = 0;
                let replyCount = 0;
                const sqlStatements = [];

                for (const [boardId, boardData] of Object.entries(boards)) {
                    const threads = boardData.threads || {};
                    for (const [threadId, thread] of Object.entries(threads)) {
                        const name = thread.name || 'Anonymous';
                        const subject = thread.subject || '';
                        const comment = thread.comment || '';
                        const media = thread.image || '';
                        const ipHash = hashIp(thread.ip);
                        const createdAt = thread.timestamp || Date.now();
                        const bumpedAt = thread.lastUpdated || createdAt;
                        const replies = thread.replies || {};
                        const rCount = Object.keys(replies).length;

                        insertThread.run(
                            threadId,
                            boardId,
                            name,
                            subject,
                            comment,
                            media,
                            ipHash,
                            createdAt,
                            bumpedAt,
                            rCount
                        );
                        threadCount++;

                        const escapeSql = (s) => (s ? s.replace(/'/g, "''").replace(/\r/g, '').replace(/\n/g, "' || char(10) || '") : '');
                        sqlStatements.push(`INSERT OR IGNORE INTO threads (id, board, name, subject, comment, media_url, ip_hash, created_at, bumped_at, is_pinned, is_locked, reply_count) VALUES ('${escapeSql(threadId)}', '${escapeSql(boardId)}', '${escapeSql(name)}', '${escapeSql(subject)}', '${escapeSql(comment)}', '${escapeSql(media)}', '${escapeSql(ipHash)}', ${createdAt}, ${bumpedAt}, 0, 0, ${rCount});`);

                        for (const [replyId, reply] of Object.entries(replies)) {
                            const rName = reply.name || 'Anonymous';
                            const rComment = reply.comment || '';
                            const rMedia = reply.image || '';
                            const rIpHash = hashIp(reply.ip);
                            const rCreatedAt = reply.timestamp || Date.now();

                            insertReply.run(
                                replyId,
                                threadId,
                                boardId,
                                rName,
                                rComment,
                                rMedia,
                                rIpHash,
                                rCreatedAt
                            );
                            replyCount++;

                            sqlStatements.push(`INSERT OR IGNORE INTO replies (id, thread_id, board, name, comment, media_url, ip_hash, created_at) VALUES ('${escapeSql(replyId)}', '${escapeSql(threadId)}', '${escapeSql(boardId)}', '${escapeSql(rName)}', '${escapeSql(rComment)}', '${escapeSql(rMedia)}', '${escapeSql(rIpHash)}', ${rCreatedAt});`);
                        }
                    }
                }

                // Ensure all thread reply counts are fully synced after seeding
                db.exec(`
                    UPDATE threads
                    SET reply_count = (SELECT COUNT(*) FROM replies WHERE replies.thread_id = threads.id);
                `);

                // Write Cloudflare D1 import.sql file without inline comments
                const d1ImportSql = [
                    fs.readFileSync(path.join(rootDir, 'db', 'schema.sql'), 'utf-8'),
                    '',
                    `INSERT OR IGNORE INTO users (id, username, password_hash, role, display_title, created_at) VALUES ('user_admin_01', 'admin', '${hashPassword("admin123")}', 'admin', 'Admin 🛡️', ${Date.now()});`,
                    '',
                    ...sqlStatements
                ].join('\n');

                fs.writeFileSync(path.join(rootDir, 'db', 'import.sql'), d1ImportSql, 'utf-8');
                console.log(`[DB] Seeding complete! Imported ${threadCount} threads and ${replyCount} replies.`);
                console.log('[DB] Generated db/import.sql for Cloudflare D1 deployment.');
            } catch (err) {
                console.error('[DB] Failed to seed from backup:', err);
            }
        }
    }
}

initSeedData();
