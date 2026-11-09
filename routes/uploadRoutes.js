const express = require('express');
const multer = require('multer');
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../database');
const { getSafeMediaPath, MEDIA_DIR } = require('../utils/pathUtils');
const { moveFileNoOverwrite } = require('../utils/fileOperations');
const { MEDIA_EXTENSIONS, getExtension, getMediaType, validateMediaName } = require('../services/mediaService');

const router = express.Router();
const MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024;
const MAX_FILES = 200;
const UPLOAD_TEMP_DIR = path.join(MEDIA_DIR, '.incoming');

const storage = multer.diskStorage({
    destination: (req, file, cb) =>
        fsSync.mkdir(UPLOAD_TEMP_DIR, { recursive: true, mode: 0o700 }, error => cb(error, UPLOAD_TEMP_DIR)),
    // Never use the user-supplied originalname for a shared temp filename.
    filename: (req, file, cb) => cb(null, crypto.randomUUID() + '.upload')
});
const upload = multer({
    storage,
    limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES },
    fileFilter: (req, file, cb) => {
        if (!validateMediaName(file.originalname) ||
            !MEDIA_EXTENSIONS.includes(getExtension(file.originalname))) {
            return cb(new Error('Unsupported file type'));
        }
        cb(null, true);
    }
});

const registerMedia = db.prepare(`
    INSERT INTO media (path, type, file_size, modified_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET
        type = excluded.type, file_size = excluded.file_size,
        modified_at = excluded.modified_at, taken_at = NULL
`);

router.post('/', (req, res) => {
    upload.array('files', MAX_FILES)(req, res, async error => {
        const tempFiles = req.files || [];
        try {
            if (error) {
                const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
                return res.status(status).json({ error: error.message || 'Upload failed' });
            }
            if (!tempFiles.length) return res.status(400).json({ error: 'No files uploaded' });

            const relativePath = req.query.path || '';
            const directory = getSafeMediaPath(relativePath);
            await fs.mkdir(directory, { recursive: true });
            const uploadedFiles = [];

            for (const file of tempFiles) {
                const originalName = path.basename(file.originalname);
                const extension = path.extname(originalName);
                const basename = path.basename(originalName, extension);
                let destinationPath;
                // Multer has already streamed the entire upload into the HDD's
                // .incoming directory. Link it into the destination only after
                // upload completion; no duplicate 10GB copy or SD-card temp file.
                for (let counter = 0; counter < 10000; counter++) {
                    const filename = counter === 0 ? originalName : `${basename} (${counter})${extension}`;
                    const candidate = path.join(directory, filename);
                    try {
                        await moveFileNoOverwrite(file.path, candidate);
                        destinationPath = candidate;
                        break;
                    } catch (copyError) {
                        if (copyError.code !== 'EEXIST') throw copyError;
                    }
                }
                if (!destinationPath) throw new Error('Unable to find an unused filename');
                try {
                    const stat = await fs.stat(destinationPath);
                    const mediaPath = path.join(relativePath, path.basename(destinationPath));
                    registerMedia.run(mediaPath, getMediaType(destinationPath), stat.size, Math.floor(stat.mtimeMs));
                    uploadedFiles.push(mediaPath);
                } catch (dbError) {
                    await fs.unlink(destinationPath).catch(e => console.error('Upload rollback failed:', e));
                    throw dbError;
                }
            }
            return res.json({ message: 'Upload completed', count: uploadedFiles.length, files: uploadedFiles });
        } catch (error) {
            console.error('Upload failed:', error);
            if (!res.headersSent) res.status(500).json({ error: 'Upload failed; completed files may remain' });
        } finally {
            await Promise.allSettled(tempFiles.map(file => fs.unlink(file.path)));
        }
    });
});
module.exports = router;
