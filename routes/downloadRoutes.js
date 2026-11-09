const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const { ZipArchive } = require('archiver');
const db = require('../database');
const { getSafeMediaPath } = require('../utils/pathUtils');
const router = express.Router();

const MAX_ZIP_FILES = 1000;
const MAX_ZIP_BYTES = 20 * 1024 * 1024 * 1024;

router.get('/', async (req, res) => {
    const relativePath = req.query.path;
    if (typeof relativePath !== 'string' || !relativePath) {
        return res.status(400).json({ error: 'Media path is required' });
    }
    try {
        const filePath = getSafeMediaPath(relativePath);
        if (!db.prepare('SELECT 1 FROM media WHERE path = ?').get(relativePath)) {
            return res.status(404).json({ error: 'Media not found' });
        }
        res.download(filePath, path.basename(relativePath), error => {
            if (error && !res.headersSent) res.status(404).json({ error: 'Media file not found' });
        });
    } catch (error) {
        res.status(400).json({ error: 'Invalid media path' });
    }
});

router.post('/zip', async (req, res) => {
    const raw = req.body?.ids;
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_ZIP_FILES ||
        raw.some(value => !Number.isSafeInteger(Number(value)) || Number(value) < 1)) {
        return res.status(400).json({ error: `1〜${MAX_ZIP_FILES}個の有効なIDを指定してください` });
    }
    const ids = [...new Set(raw.map(Number))];
    try {
        const media = db.prepare(`SELECT id, path, file_size FROM media WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
        if (media.length !== ids.length) return res.status(404).json({ error: 'Some media were not found' });
        let bytes = 0;
        const files = [];
        for (const item of media) {
            const filePath = getSafeMediaPath(item.path);
            const stat = await fs.stat(filePath);
            if (!stat.isFile()) return res.status(400).json({ error: 'Invalid media file' });
            bytes += stat.size;
            if (bytes > MAX_ZIP_BYTES) return res.status(413).json({ error: 'ZIPの合計容量が20GBを超えます' });
            files.push({ filePath, relative: item.path });
        }
        const archive = new ZipArchive({ zlib: { level: 0 } });
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', 'attachment; filename="photo-manager.zip"');
        archive.on('error', error => {
            console.error('ZIP creation failed:', error);
            if (!res.headersSent) res.status(500).json({ error: 'ZIP creation failed' });
            else res.destroy(error);
        });
        res.on('close', () => { if (!res.writableEnded) archive.abort(); });
        archive.pipe(res);
        for (const file of files) archive.file(file.filePath, { name: file.relative });
        await archive.finalize();
    } catch (error) {
        console.error('ZIP download failed:', error);
        if (!res.headersSent) res.status(500).json({ error: 'ZIP download failed' });
    }
});
module.exports = router;
