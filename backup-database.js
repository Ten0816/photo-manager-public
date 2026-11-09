const path = require('path');
const fs = require('fs/promises');
const db = require('./database');
const DB_FILE = process.env.DATABASE_PATH || path.join(__dirname, 'data', 'photo-manager.db');
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(path.dirname(DB_FILE), 'backups');
async function main() {
    await fs.mkdir(BACKUP_DIR, { recursive: true, mode: 0o700 });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = path.join(BACKUP_DIR, `photo-manager-${stamp}.db`);
    await db.backup(filename); // Consistent snapshot in WAL mode.
    // Keep 30 days of automated snapshots. This is not an off-device backup.
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    for (const entry of await fs.readdir(BACKUP_DIR, { withFileTypes: true })) {
        if (!entry.isFile() || !/^photo-manager-\d{4}-\d\d-\d\dT.*\.db$/.test(entry.name)) continue;
        const candidate = path.join(BACKUP_DIR, entry.name);
        if ((await fs.stat(candidate)).mtimeMs < cutoff) await fs.unlink(candidate);
    }
    console.log('SQLite backup created:', filename);
}
main().catch(error => { console.error('Backup failed:', error); process.exitCode = 1; });
