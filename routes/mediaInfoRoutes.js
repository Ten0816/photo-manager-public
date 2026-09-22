const express = require("express");
const path = require("path");

const db = require("../database");

const router = express.Router();


/**
 * メディア詳細情報
 *
 * GET /api/media-info?path=...
 */
router.get("/", async (req, res) => {

    const relativePath =
        req.query.path;


    // ----------------------------
    // パスチェック
    // ----------------------------

    if (
        typeof relativePath !== "string" ||
        !relativePath
    ) {

        return res.status(400).json({
            error:
                "Media path is required"
        });
    }


    try {

        // ----------------------------
        // DBからメディア情報を取得
        // ----------------------------

        const media =
            db.prepare(`
                SELECT
                    id,
                    path,
                    type,
                    file_size,
                    modified_at,
                    taken_at
                FROM media
                WHERE path = ?
            `).get(
                relativePath
            );


        if (!media) {

            return res.status(404).json({
                error:
                    "Media not found"
            });
        }


        // ----------------------------
        // 詳細情報を返す
        // ----------------------------

        res.json({

            id:
                media.id,

            path:
                media.path,

            name:
                path.basename(
                    media.path
                ),

            type:
                media.type,

            fileSize:
                media.file_size,

            modifiedAt:
                media.modified_at,

            takenAt:
                media.taken_at,

            // 現在はEXIFをViewer表示時には取得しない
            exif:
                null
        });


    } catch (error) {

        console.error(error);


        res.status(500).json({
            error:
                "Failed to fetch media information"
        });
    }

});


module.exports = router;