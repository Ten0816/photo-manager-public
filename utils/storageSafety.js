const fs = require('fs/promises');
const path = require('path');
const { MEDIA_DIR, STORAGE_MARKER } = require('./pathUtils');

// The marker MUST be created manually on the actual mounted HDD, never by this app.
// Its absence causes a fail-closed 503/failed scheduled job rather than writing
// into an empty host bind-mount directory after the drive disconnects.
async function assertStorageAvailable() {
    const marker = path.join(MEDIA_DIR, STORAGE_MARKER);
    let stat;
    try {
        stat = await fs.lstat(marker);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('invalid marker');
        const value = (await fs.readFile(marker, 'utf8')).trim();
        if (value !== 'photo-manager-storage-v1') throw new Error('invalid marker');
        await fs.readdir(MEDIA_DIR);
    } catch (cause) {
        const error = new Error(`Media storage unavailable: ${marker}`);
        error.code = 'STORAGE_UNAVAILABLE';
        error.cause = cause;
        throw error;
    }
}

function requireStorage(req, res, next) {
    assertStorageAvailable().then(() => next(), error => {
        console.error('Storage safety check failed:', error.message);
        res.status(503).json({ error: 'HDDを確認できません。ファイル操作を停止しました。' });
    });
}

module.exports = { assertStorageAvailable, requireStorage };
