const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

const dbPath =
    process.env.DATABASE_PATH ||
    path.join(__dirname, "data", "photo-manager.db");

fs.mkdirSync(path.dirname(dbPath), {
    recursive: true
});

const db = new Database(dbPath);

// SQLiteのロックが発生した場合、5秒間待ってからエラーにする
db.pragma("busy_timeout = 5000");

// WALモードを使用する
db.pragma("journal_mode = WAL");

db.exec(`
    CREATE TABLE IF NOT EXISTS media (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        modified_at INTEGER NOT NULL,
        taken_at TEXT
    )
`);

// 既存のDBにもEXIF用カラムを追加する
const columns = db.prepare("PRAGMA table_info(media)").all();
const columnNames = new Set(columns.map(column => column.name));

if (!columnNames.has("taken_at")) {
    db.exec("ALTER TABLE media ADD COLUMN taken_at TEXT");
}

module.exports = db;