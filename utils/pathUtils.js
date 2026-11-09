const fs = require('fs');
const path = require('path');

const MEDIA_DIR = path.resolve(process.env.MEDIA_DIR || '/data/Memory');
const THUMBNAIL_DIR = path.join(MEDIA_DIR, '.thumbnails');
const TRASH_DIR = path.join(MEDIA_DIR, '.trash');
const STORAGE_MARKER = '.photo-manager-storage-id';
const INTERNAL_DIRS = new Set(['.thumbnails', '.trash', '.incoming']);

function getSafePath(baseDir, relativePath) {
    if (typeof relativePath !== 'string' || relativePath.includes('\0') ||
        path.isAbsolute(relativePath) || relativePath.includes('\\')) {
        throw new Error('Invalid path');
    }
    const base = path.resolve(baseDir);
    const full = path.resolve(base, relativePath);
    const rel = path.relative(base, full);
    if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
        throw new Error('Invalid path');
    }
    // Block traversal via symlinked components, including existing destination files.
    // Existing paths are checked synchronously because these helpers are also used in routes.
    let current = base;
    for (const segment of rel.split(path.sep).filter(Boolean)) {
        current = path.join(current, segment);
        try {
            if (fs.lstatSync(current).isSymbolicLink()) {
                throw new Error('Invalid path: symbolic links are not allowed');
            }
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
    }
    return full;
}

function getSafeMediaPath(relativePath) {
    const full = getSafePath(MEDIA_DIR, relativePath);
    const rel = path.relative(MEDIA_DIR, full);
    if (rel.split(path.sep).some(part => INTERNAL_DIRS.has(part)) ||
        rel === STORAGE_MARKER) {
        throw new Error('Invalid path: protected storage area');
    }
    return full;
}

const getMediaPath = getSafeMediaPath;
const getThumbnailPath = relativePath => getSafePath(THUMBNAIL_DIR, relativePath);
const getTrashPath = relativePath => getSafePath(TRASH_DIR, relativePath);

module.exports = {
    MEDIA_DIR, THUMBNAIL_DIR, TRASH_DIR, STORAGE_MARKER,
    getSafePath, getSafeMediaPath, getMediaPath, getThumbnailPath, getTrashPath
};
