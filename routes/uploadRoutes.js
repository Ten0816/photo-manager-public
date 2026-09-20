const express = require("express");
const multer = require("multer");
const fs = require("fs/promises");
const fsSync = require("fs");
const path = require("path");
const os = require("os");

const db = require("../database");

const {
    getSafeMediaPath
} = require("../utils/pathUtils");

const {
    MEDIA_EXTENSIONS,
    getExtension,
    getMediaType,
    getUniqueFilePath
} = require("../services/mediaService");

const router = express.Router();

const MAX_FILE_SIZE =
    10 * 1024 * 1024 * 1024;

const UPLOAD_TEMP_DIR =
    path.join(
        os.tmpdir(),
        "photo-manager-uploads"
    );

fsSync.mkdirSync(
    UPLOAD_TEMP_DIR,
    {
        recursive: true
    }
);

// Multer設定
const storage =
    multer.diskStorage({
        destination: (
            req,
            file,
            callback
        ) => {
            callback(
                null,
                UPLOAD_TEMP_DIR
            );
        },

        filename: (
            req,
            file,
            callback
        ) => {
            callback(
                null,
                file.originalname
            );
        }
    });

const upload =
    multer({
        storage: storage,

        limits: {
            fileSize: MAX_FILE_SIZE
        },

        fileFilter: (
            req,
            file,
            callback
        ) => {
            const extension =
                getExtension(
                    file.originalname
                );

            if (
                !MEDIA_EXTENSIONS.includes(
                    extension
                )
            ) {
                return callback(
                    new Error(
                        "Unsupported file type"
                    )
                );
            }

            callback(null, true);
        }
    });

/**
 * ファイルアップロード
 *
 * POST /api/upload?path=...
 */
router.post("/", (req, res) => {
    upload.array("files")(
        req,
        res,
        async (error) => {

            // Multerエラー
            if (error) {
                if (
                    error.code ===
                    "LIMIT_FILE_SIZE"
                ) {
                    return res.status(413).json({
                        error:
                            "ファイルサイズが大きすぎます。1ファイル10GBまでです。"
                    });
                }

                if (
                    error.message ===
                    "Unsupported file type"
                ) {
                    return res.status(400).json({
                        error:
                            "対応していないファイル形式です。"
                    });
                }

                console.error(error);

                return res.status(500).json({
                    error:
                        "Upload failed"
                });
            }

            try {
                if (
                    !req.files ||
                    req.files.length === 0
                ) {
                    return res.status(400).json({
                        error:
                            "No files uploaded"
                    });
                }

                const relativePath =
                    req.query.path || "";

                const directory =
                    getSafeMediaPath(
                        relativePath
                    );

                await fs.mkdir(
                    directory,
                    {
                        recursive: true
                    }
                );

                const uploadedFiles = [];

                const registerMedia =
                    db.prepare(`
                        INSERT INTO media (
                            path,
                            type,
                            file_size,
                            modified_at
                        )
                        VALUES (?, ?, ?, ?)

                        ON CONFLICT(path)
                        DO UPDATE SET
                            type =
                                excluded.type,
                            file_size =
                                excluded.file_size,
                            modified_at =
                                excluded.modified_at
                    `);

                // ファイル保存
                for (
                    const file of req.files
                ) {
                    const temporaryPath =
                        file.path;

                    const destinationPath =
                        await getUniqueFilePath(
                            directory,
                            file.originalname
                        );

                    await fs.copyFile(
                        temporaryPath,
                        destinationPath
                    );

                    await fs.unlink(
                        temporaryPath
                    );

                    const stat =
                        await fs.stat(
                            destinationPath
                        );

                    const savedFileName =
                        path.basename(
                            destinationPath
                        );

                    const mediaPath =
                        path.join(
                            relativePath,
                            savedFileName
                        );

                    const mediaType =
                        getMediaType(
                            savedFileName
                        );

                    registerMedia.run(
                        mediaPath,
                        mediaType,
                        stat.size,
                        Math.floor(
                            stat.mtimeMs
                        )
                    );

                    uploadedFiles.push(
                        mediaPath
                    );
                }

                console.log(
                    uploadedFiles.length +
                    " 件のファイルを " +
                    (
                        relativePath ||
                        "Memory"
                    ) +
                    " にアップロードしました。"
                );

                res.json({
                    message:
                        "Upload completed",

                    count:
                        uploadedFiles.length,

                    files:
                        uploadedFiles
                });

            } catch (error) {
                console.error(error);

                res.status(500).json({
                    error:
                        "Upload failed"
                });
            }
        }
    );
});

module.exports = router;