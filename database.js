const Database = require("better-sqlite3");

const db = new Database("photo-manager.db");

db.pragma("journal_mode = WAL");

db.exec(`
    CREATE TABLE IF NOT EXISTS media (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        modified_at INTEGER NOT NULL
    )
`);

module.exports = db;
