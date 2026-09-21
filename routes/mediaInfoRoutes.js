const express = require("express");
const exifr = require("exifr");
const fs = require("fs/promises");
const path = require("path");

const db = require("../database");

const {
    getSafeMediaPath
} = require("../utils/pathUtils");

const router = express.Router();


/**
 * メディア詳細情報
 *
 * GET /api/media-info?path=...
 */
router.get("/", async (req, res) => {

    const relativePath =
        req.query.path;

    if (
        typeof relativePath !==
        "string" ||
        !relativePath
    ) {
        return res.status(400).json({
            error:
                "Media path is required"
        });
    }


    try {

        /*
         * DBからメディア情報を取得
         */
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


        /*
         * 実ファイルのパス
         */
        const filePath =
            getSafeMediaPath(
                relativePath
            );


        /*
         * ファイル存在確認
         */
        const stat =
            await fs.stat(
                filePath
            );


        if (!stat.isFile()) {
            return res.status(400).json({
                error:
                    "Target is not a file"
            });
        }


        /*
         * 基本情報
         */
        const result = {

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

            exif:
                null
        };


        /*
         * 写真の場合のみEXIFを取得
         */
        if (
            media.type ===
            "image"
        ) {

            try {

                result.exif =
                    await exifr.parse(
                        filePath
                    );

            } catch (error) {

                console.warn(
                    "EXIFの読み込みに失敗しました:",
                    relativePath
                );

                console.warn(
                    error.message
                );

            }
        }


        res.json(
            result
        );


    } catch (error) {

        console.error(error);


        if (
            error.code ===
            "ENOENT"
        ) {
            return res.status(404).json({
                error:
                    "Media file not found"
            });
        }


        res.status(500).json({
            error:
                "Failed to fetch media information"
        });

    }

});


module.exports = router;