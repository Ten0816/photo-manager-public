const express = require("express");
const fs = require("fs/promises");
const path = require("path");

const db = require("../database");

const {
    getSafeMediaPath,
    getThumbnailPath
} = require("../utils/pathUtils");

const {
    validateMediaName,
    getExtension
} = require("../services/mediaService");

const { moveFileNoOverwrite } = require("../utils/fileOperations");
const router = express.Router();

/**
 * メディア名前変更
 *
 * PUT /api/media?path=...
 *
 * 元ファイルとサムネイルを同時に名前変更する
 */
router.put("/", async (req, res) => {

    try {

        const relativePath =
            req.query.path;


        if (!relativePath) {

            return res.status(400).json({
                error:
                    "Media path is required"
            });
        }


        const inputName =
            req.body.name;


        if (
            !validateMediaName(
                inputName
            )
        ) {

            return res.status(400).json({
                error:
                    "Invalid file name"
            });
        }


        // ====================================================
        // 元ファイルの拡張子を維持
        // ====================================================

        const oldExtension =
            getExtension(
                relativePath
            );


        const inputExtension =
            path.extname(
                inputName
            );


        const newBaseName =
            path.basename(
                inputName,
                inputExtension
            );


        const newName =
            newBaseName +
            oldExtension;


        // ====================================================
        // 元ファイル
        // ====================================================

        const oldPath =
            getSafeMediaPath(
                relativePath
            );


        const directory =
            path.dirname(
                oldPath
            );


        const newPath =
            path.join(
                directory,
                newName
            );


        // ====================================================
        // 新しい相対パス
        // ====================================================

        const relativeDirectory =
            path.dirname(
                relativePath
            );


        const newRelativePath =
            path.join(
                relativeDirectory === "."
                    ? ""
                    : relativeDirectory,
                newName
            );


        getSafeMediaPath(
            newRelativePath
        );


        // ====================================================
        // サムネイルパス
        //
        // 例:
        //
        // photo.jpg
        // ↓
        // thumbnails/photo.jpg
        //
        // video.mp4
        // ↓
        // thumbnails/video.jpg
        // ====================================================

        const oldThumbnailRelativePath =
            path.join(
                path.dirname(
                    relativePath
                ),
                path.parse(
                    relativePath
                ).base + ".thumb.jpg"
            );


        const newThumbnailRelativePath =
            path.join(
                path.dirname(
                    newRelativePath
                ),
                path.parse(
                    newRelativePath
                ).base + ".thumb.jpg"
            );


        const oldThumbnailPath =
            getThumbnailPath(
                oldThumbnailRelativePath
            );


        const newThumbnailPath =
            getThumbnailPath(
                newThumbnailRelativePath
            );


        // ====================================================
        // 同じファイル名なら何もしない
        // ====================================================

        if (
            relativePath ===
            newRelativePath
        ) {

            return res.json({
                message:
                    "Media name is unchanged",

                oldPath:
                    relativePath,

                newPath:
                    newRelativePath
            });
        }


        // ====================================================
        // 新しいファイル名の重複確認
        // ====================================================

        try {

            await fs.access(
                newPath
            );


            return res.status(409).json({
                error:
                    "同じ名前のファイルがすでに存在します。"
            });

        } catch (error) {

            if (
                error.code !==
                "ENOENT"
            ) {

                throw error;
            }
        }


        // ====================================================
        // 元ファイル存在確認
        // ====================================================

        try {

            const stat =
                await fs.stat(
                    oldPath
                );


            if (!stat.isFile()) {

                return res.status(400).json({
                    error:
                        "Target is not a file"
                });
            }

        } catch (error) {

            if (
                error.code ===
                "ENOENT"
            ) {

                return res.status(404).json({
                    error:
                        "Media not found"
                });
            }

            throw error;
        }


        // ====================================================
        // サムネイルが存在するか確認
        //
        // 無い場合は、元ファイルだけ変更する。
        // ====================================================

        let thumbnailExists = true;


        try {

            await fs.access(
                oldThumbnailPath
            );

        } catch (error) {

            if (
                error.code ===
                "ENOENT"
            ) {

                thumbnailExists = false;

            } else {

                throw error;
            }
        }


        // ====================================================
        // 新しいサムネイルが既に存在するか確認
        // ====================================================

        if (thumbnailExists) {

            try {

                await fs.access(
                    newThumbnailPath
                );


                return res.status(409).json({
                    error:
                        "同じ名前のサムネイルがすでに存在します。"
                });

            } catch (error) {

                if (
                    error.code !==
                    "ENOENT"
                ) {

                    throw error;
                }
            }
        }


        // ====================================================
        // 元ファイルを名前変更
        // ====================================================

        await moveFileNoOverwrite(
            oldPath,
            newPath
        );


        // ====================================================
        // サムネイルを名前変更
        // ====================================================

        if (thumbnailExists) {

            try {

                await fs.rename(
                    oldThumbnailPath,
                    newThumbnailPath
                );

            } catch (error) {

                // サムネイル変更に失敗した場合、
                // 元ファイルを元の名前へ戻す。
                try {

                    await fs.rename(
                        newPath,
                        oldPath
                    );

                } catch (rollbackError) {

                    console.error(
                        "Failed to rollback media rename:",
                        rollbackError
                    );
                }


                throw error;
            }
        }


        // ====================================================
        // SQLite更新
        // ====================================================

        try {

            db.prepare(`
                UPDATE media
                SET path = ?
                WHERE path = ?
            `).run(
                newRelativePath,
                relativePath
            );

        } catch (error) {

            console.error(
                "Failed to update media database:",
                error
            );


            // ------------------------------------------------
            // サムネイルを元へ戻す
            // ------------------------------------------------

            if (thumbnailExists) {

                try {

                    await fs.rename(
                        newThumbnailPath,
                        oldThumbnailPath
                    );

                } catch (rollbackError) {

                    console.error(
                        "Failed to rollback thumbnail rename:",
                        rollbackError
                    );
                }
            }


            // ------------------------------------------------
            // メディア本体を元へ戻す
            // ------------------------------------------------

            try {

                await fs.rename(
                    newPath,
                    oldPath
                );

            } catch (rollbackError) {

                console.error(
                    "Failed to rollback media rename:",
                    rollbackError
                );
            }


            throw error;
        }


        // ====================================================
        // 完了
        // ====================================================

        // Rebuild cache on demand rather than keeping mismatched metadata.
        const { invalidateThumbnail } = require("../services/thumbnailService");
        await invalidateThumbnail(relativePath);
        await invalidateThumbnail(newRelativePath);

        res.json({
            message:
                "Media renamed",

            oldPath:
                relativePath,

            newPath:
                newRelativePath
        });


    } catch (error) {

        console.error(
            "Rename media error:",
            error
        );


        if (
            error.code ===
            "ENOENT"
        ) {

            return res.status(404).json({
                error:
                    "Media not found"
            });
        }


        res.status(500).json({
            error:
                "Failed to rename media"
        });
    }
});


/**
 * メディア一括名前変更
 *
 * POST /api/media/bulk-rename
 *
 * body:
 * {
 *     ids: [1, 2, 3],
 *     baseName: "2022"
 * }
 *
 * 例:
 *
 * IMG001.jpg
 * IMG002.png
 * IMG003.mp4
 *
 * ↓
 *
 * 2022_1.jpg
 * 2022_2.png
 * 2022_3.mp4
 */

module.exports = router;
