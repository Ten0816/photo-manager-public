// Manual cache garbage collection. Safe by default: dry-run unless --apply.
const fs = require('fs/promises');
const path = require('path');
const db = require('./database');
const { THUMBNAIL_DIR } = require('./utils/pathUtils');
const { assertStorageAvailable } = require('./utils/storageSafety');
const apply = process.argv.includes('--apply');

async function* walk(dir) {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); }
    catch (error) {
        if (error.code === 'ENOENT') return;
        throw error;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) yield* walk(full);
        else if (entry.isFile()) yield full; // No symlinks are traversed.
    }
}
async function main() {
    await assertStorageAvailable();
    const knownMedia = new Set(db.prepare('SELECT path FROM media').all().map(row => row.path));
    const knownTrash = new Set(db.prepare('SELECT trash_path FROM trash').all().map(row => row.trash_path.replace(/^\.trash\//, '')));
    const candidates = [];
    for await (const filename of walk(THUMBNAIL_DIR)) {
        if (!filename.endsWith('.jpg')) continue;
        const relative = path.relative(THUMBNAIL_DIR, filename);
        let stale = true;
        if (relative.endsWith('.thumb.jpg')) {
            const source = relative.slice(0, -'.thumb.jpg'.length);
            stale = source.startsWith('.trash' + path.sep)
                ? !knownTrash.has(source.slice('.trash/'.length))
                : !knownMedia.has(source);
        }
        // Legacy files without .thumb.jpg are always cache and can be removed.
        if (stale) candidates.push(filename);
    }
    console.log(`Outdated/orphan/legacy thumbnails: ${candidates.length}; mode: ${apply ? 'APPLY' : 'DRY RUN'}`);
    if (apply) {
        for (const filename of candidates) {
            await fs.rm(filename, { force: true });
            await fs.rm(filename + '.json', { force: true });
        }
    } else {
        console.log(candidates.slice(0, 30).map(file => path.relative(THUMBNAIL_DIR, file)).join('\n'));
        if (candidates.length > 30) console.log(`... and ${candidates.length - 30} more`);
    }
}
main().catch(error => { console.error('Thumbnail prune failed:', error); process.exitCode = 1; });
