const path = require("path");

const MEDIA_DIR = process.env.MEDIA_DIR || "/data/Memory";

const THUMBNAIL_DIR = path.join(MEDIA_DIR, ".thumbnails");

function getSafePath(baseDir, relativePath) {
    const normalized = path.normalize(relativePath);

    if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
        throw new Error("Invalid path");
    }

    const fullPath = path.join(baseDir, normalized);

    if (!fullPath.startsWith(baseDir)) {
        throw new Error("Invalid path");
    }

    return fullPath;
}

function getSafeMediaPath(relativePath) {
    return getSafePath(MEDIA_DIR, relativePath);
}

function getMediaPath(relativePath) {
    return getSafePath(MEDIA_DIR, relativePath);
}

function getThumbnailPath(relativePath) {
    return getSafePath(THUMBNAIL_DIR, relativePath);
}

module.exports = {
    MEDIA_DIR,
    THUMBNAIL_DIR,
    getSafePath,
    getSafeMediaPath,
    getMediaPath,
    getThumbnailPath
};