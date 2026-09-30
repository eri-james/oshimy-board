CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    display_title TEXT,
    created_at INTEGER NOT NULL,
    xp INTEGER NOT NULL DEFAULT 0,
    level INTEGER NOT NULL DEFAULT 1,
    streak INTEGER NOT NULL DEFAULT 0,
    last_active_date TEXT,
    last_omikuji_date TEXT,
    oshi_badge TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL,
    username TEXT NOT NULL,
    display_title TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS threads (
    id TEXT PRIMARY KEY,
    board TEXT NOT NULL,
    name TEXT DEFAULT 'Anonymous',
    subject TEXT,
    comment TEXT NOT NULL,
    media_url TEXT,
    ip_hash TEXT,
    user_id TEXT,
    role TEXT,
    display_title TEXT,
    is_pinned INTEGER DEFAULT 0,
    is_locked INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    bumped_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_threads_board_bumped ON threads(board, bumped_at DESC);
CREATE INDEX IF NOT EXISTS idx_threads_pinned ON threads(is_pinned DESC);
CREATE INDEX IF NOT EXISTS idx_threads_user_id ON threads(user_id);

CREATE TABLE IF NOT EXISTS replies (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    board TEXT NOT NULL,
    name TEXT DEFAULT 'Anonymous',
    comment TEXT NOT NULL,
    media_url TEXT,
    ip_hash TEXT,
    user_id TEXT,
    role TEXT,
    display_title TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_replies_thread_created ON replies(thread_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_replies_user_id ON replies(user_id);

CREATE TABLE IF NOT EXISTS watchlist (
    user_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, thread_id),
    FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_watchlist_user ON watchlist(user_id);

CREATE TABLE IF NOT EXISTS site_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
