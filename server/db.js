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
                    INSERT INTO threads (id, board, name, subject, comment, media_url, ip_hash, created_at, bumped_at, is_pinned, is_locked)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
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

                        insertThread.run(
                            threadId,
                            boardId,
                            name,
                            subject,
                            comment,
                            media,
                            ipHash,
                            createdAt,
                            bumpedAt
                        );
                        threadCount++;

                        const escapeSql = (s) => (s ? s.replace(/'/g, "''").replace(/\r/g, '').replace(/\n/g, "' || char(10) || '") : '');
                        sqlStatements.push(`INSERT OR IGNORE INTO threads (id, board, name, subject, comment, media_url, ip_hash, created_at, bumped_at, is_pinned, is_locked) VALUES ('${escapeSql(threadId)}', '${escapeSql(boardId)}', '${escapeSql(name)}', '${escapeSql(subject)}', '${escapeSql(comment)}', '${escapeSql(media)}', '${escapeSql(ipHash)}', ${createdAt}, ${bumpedAt}, 0, 0);`);

                        const replies = thread.replies || {};
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
