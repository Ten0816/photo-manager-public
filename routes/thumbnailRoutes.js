const express = require("express");
const fs = require("fs");

const {
    getSafeMediaPath
} = require("../utils/pathUtils");

const {
    createThumbnail
} = require("../services/thumbnailService");

const router = express.Router();


/**
 * サムネイル取得・生成
 *
 * GET /api/thumbnail?path=...
 */
router.get("/", async (req, res) => {

    try {

        const relativePath =
            req.query.path;


        if (!relativePath) {

            return res.status(400).send(
                "Path is required"
            );
        }


        // ----------------------------
        // メディアパスの安全性を確認
        // ----------------------------

        getSafeMediaPath(
            relativePath
        );


        // ----------------------------
        // サムネイル取得・生成
        // ----------------------------

        const thumbnailPath =
            await createThumbnail(
                relativePath
            );


        // ----------------------------
        // サムネイルを返す
        // ----------------------------

        res.type("image/jpeg");


        const stream =
            fs.createReadStream(
                thumbnailPath
            );


        stream.on(
            "error",
            (error) => {

                console.error(
                    "Thumbnail stream error:",
                    error
                );


                if (!res.headersSent) {

                    res.status(500).send(
                        "Failed to read thumbnail"
                    );
                }
            }
        );


        stream.pipe(res);


    } catch (error) {

        console.error(
            "Thumbnail error:",
            error
        );


        if (
            error.message ===
            "Invalid path"
        ) {

            return res.status(400).send(
                "Invalid path"
            );
        }


        if (
            error.message ===
            "Unsupported media type"
        ) {

            return res.status(400).send(
                "Unsupported media type"
            );
        }


        res.status(500).send(
            "Failed to create thumbnail"
        );
    }
});


module.exports = router;