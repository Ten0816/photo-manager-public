// Read-only integrity audit. Does not modify user media or SQLite rows.
const fs = require('fs/promises');
const db = require('./database');
const { getSafeMediaPath, getTrashPath } = require('./utils/pathUtils');
const { assertStorageAvailable } = require('./utils/storageSafety');

async function main() {
    await assertStorageAvailable();
    const problems = [];
    const rows = db.prepare('SELECT id, path FROM media').all();
    const deleted = db.prepare('SELECT id, trash_path FROM trash').all();
    for (const row of rows) {
        try {
            const stat = await fs.stat(getSafeMediaPath(row.path));
            if (!stat.isFile()) throw new Error('not a file');
        } catch (error) {
            problems.push({ kind: 'media', id: row.id, path: row.path, error: error.code || error.message });
        }
    }
    for (const row of deleted) {
        const relative = row.trash_path.replace(/^\.trash\//, '');
        try {
            const stat = await fs.stat(getTrashPath(relative));
            if (!stat.isFile()) throw new Error('not a file');
        } catch (error) {
            problems.push({ kind: 'trash', id: row.id, path: row.trash_path, error: error.code || error.message });
        }
    }
    console.log(JSON.stringify({ media: rows.length, trash: deleted.length, problems }, null, 2));
    if (problems.length) process.exitCode = 2;
}
main().catch(error => { console.error('Audit aborted:', error); process.exitCode = 1; });
