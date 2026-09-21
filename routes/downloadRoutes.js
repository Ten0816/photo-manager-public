const express = require("express");
const {
    ZipArchive
} = require("archiver");
const path = require("path");

const db = require("../database");

const {
    getSafeMediaPath
} = require("../utils/pathUtils");

const router =
    express.Router();

/*
 * 単一ファイルダウンロード
 */
router.get("/", async (req, res) => {
    const relativePath =
        req.query.path;

    if (
        typeof relativePath !== "string" ||
        !relativePath
    ) {
        return res.status(400).json({
            error: "Media path is required"
        });
    }

    try {
        const filePath =
            getSafeMediaPath(
                relativePath
            );

        res.download(
            filePath,
            path.basename(relativePath),
            error => {
                if (error) {
                    console.error(
                        "Download failed:",
                        error
                    );

                    if (!res.headersSent) {
                        res.status(404).json({
                            error:
                                "Media file not found"
                        });
                    }
                }
            }
        );

    } catch (error) {
        console.error(error);

        res.status(400).json({
            error:
                "Invalid media path"
        });
    }
});


/*
 * 複数ファイルをZIPとしてダウンロード
 */
router.post("/zip", async (req, res) => {
    const ids =
        req.body?.ids;

    if (
        !Array.isArray(ids) ||
        ids.length === 0
    ) {
        return res.status(400).json({
            error:
                "Media IDs are required"
        });
    }

    try {
        const media =
            db.prepare(`
                SELECT
                    id,
                    path,
                    type
                FROM media
                WHERE id IN (
                    ${ids.map(() => "?").join(",")}
                )
            `).all(...ids);

        if (media.length === 0) {
            return res.status(404).json({
                error:
                    "Media not found"
            });
        }

        res.statusCode = 200;

        res.setHeader(
            "Content-Type",
            "application/zip"
        );

        res.setHeader(
            "Content-Disposition",
            'attachment; filename="photo-manager.zip"'
        );

        const archive =
            new ZipArchive({
                zlib: {
                    level: 0
                }
            });

        archive.on(
            "error",
            error => {
                console.error(
                    "ZIP creation failed:",
                    error
                );

                if (!res.headersSent) {
                    res.status(500).json({
                        error:
                            "Failed to create ZIP"
                    });
                } else {
                    res.destroy(error);
                }
            }
        );

        archive.pipe(res);

        for (const item of media) {
            try {
                const filePath =
                    getSafeMediaPath(
                        item.path
                    );

                archive.file(
                    filePath,
                    {
                        name: item.path
                    }
                );

            } catch (error) {
                console.warn(
                    "ZIPに追加できないファイル:",
                    item.path
                );
            }
        }

        await archive.finalize();

    } catch (error) {
        console.error(
            "ZIP download failed:",
            error
        );

        if (!res.headersSent) {
            res.status(500).json({
                error:
                    "Failed to download ZIP"
            });
        }
    }
});

module.exports = router;
