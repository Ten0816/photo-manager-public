const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { getSafeMediaPath, getThumbnailPath, getTrashPath } = require('../utils/pathUtils');
const { isMediaFile } = require('./mediaService');

const maxWorkers = Math.max(1, Math.min(4, Number(process.env.THUMBNAIL_WORKERS) || 2));
const jobs = [];
const inFlight = new Map();
let active = 0;

function runQueue() {
    while (active < maxWorkers && jobs.length) {
        const job = jobs.shift();
        active++;
        job().finally(() => { active--; runQueue(); });
    }
}
function enqueue(fn) {
    return new Promise((resolve, reject) => {
        jobs.push(async () => {
            try { resolve(await fn()); }
            catch (error) { reject(error); }
        });
        runQueue();
    });
}

function getThumbnailFilePath(relativePath) {
    const parsed = path.parse(relativePath);
    return getThumbnailPath(path.join(parsed.dir, parsed.base + '.thumb.jpg'));
}
function getTrashThumbnailFilePath(trashRelativePath) {
    const normalized = trashRelativePath.replace(/^\.trash\//, '');
    const parsed = path.parse(normalized);
    return getThumbnailPath(path.join('.trash', parsed.dir, parsed.base + '.thumb.jpg'));
}

async function createThumbnailForFile(source, thumbnailPath) {
    if (!isMediaFile(source)) throw new Error('Unsupported media type');
    const sourceStat = await fs.stat(source);
    if (!sourceStat.isFile()) throw new Error('Not a media file');
    const fingerprint = { size: sourceStat.size, mtimeMs: sourceStat.mtimeMs };
    const metaFile = thumbnailPath + '.json';
    try {
        const previous = JSON.parse(await fs.readFile(metaFile, 'utf8'));
        if (previous.size === fingerprint.size && previous.mtimeMs === fingerprint.mtimeMs) {
            await fs.access(thumbnailPath);
            return thumbnailPath;
        }
    } catch { /* cache missing or outdated */ }

    // Serialize generation of the same thumbnail; bound total ffmpeg processes.
    if (inFlight.has(thumbnailPath)) return inFlight.get(thumbnailPath);
    const promise = enqueue(async () => {
        // Recheck cache after waiting in case the first request already rendered it.
        try {
            const previous = JSON.parse(await fs.readFile(metaFile, 'utf8'));
            if (previous.size === fingerprint.size && previous.mtimeMs === fingerprint.mtimeMs) {
                await fs.access(thumbnailPath);
                return thumbnailPath;
            }
        } catch { /* needs generation */ }
        await fs.mkdir(path.dirname(thumbnailPath), { recursive: true });
        const tmp = thumbnailPath + '.' + crypto.randomUUID() + '.jpg';
        const tmpMeta = metaFile + '.' + crypto.randomUUID() + '.tmp';
        try {
            await new Promise((resolve, reject) => {
                execFile('ffmpeg', [
                    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
                    '-i', source, '-frames:v', '1',
                    '-vf', "scale='min(400,iw)':-1", '-q:v', '5',
                    '-threads', '1', '-update', '1', tmp
                ], { timeout: 120000, maxBuffer: 1024 * 1024 }, error => error ? reject(error) : resolve());
            });
            await fs.rename(tmp, thumbnailPath);
            await fs.writeFile(tmpMeta, JSON.stringify(fingerprint));
            await fs.rename(tmpMeta, metaFile);
            return thumbnailPath;
        } finally {
            await Promise.allSettled([fs.rm(tmp, { force: true }), fs.rm(tmpMeta, { force: true })]);
        }
    });
    inFlight.set(thumbnailPath, promise);
    try { return await promise; }
    finally { inFlight.delete(thumbnailPath); }
}

async function createThumbnail(relativePath) {
    return createThumbnailForFile(getSafeMediaPath(relativePath), getThumbnailFilePath(relativePath));
}
async function createTrashThumbnail(trashRelativePath) {
    const normalized = trashRelativePath.replace(/^\.trash\//, '');
    return createThumbnailForFile(getTrashPath(normalized), getTrashThumbnailFilePath(trashRelativePath));
}
async function invalidateThumbnail(relativePath) {
    const filename = getThumbnailFilePath(relativePath);
    await Promise.allSettled([
        fs.rm(filename, { force: true }),
        fs.rm(filename + '.json', { force: true })
    ]);
}
async function invalidateTrashThumbnail(trashRelativePath) {
    const filename = getTrashThumbnailFilePath(trashRelativePath);
    await Promise.allSettled([
        fs.rm(filename, { force: true }),
        fs.rm(filename + '.json', { force: true })
    ]);
}
module.exports = {
    createThumbnail, createTrashThumbnail, createThumbnailForFile,
    invalidateThumbnail, invalidateTrashThumbnail,
    getThumbnailPath: getThumbnailFilePath,
    getThumbnailFilePath, getTrashThumbnailFilePath
};
