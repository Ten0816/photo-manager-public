const express = require("express");
const fs = require("fs/promises");
const path = require("path");

const db = require("../database");

const {
    TRASH_DIR,
    getSafeMediaPath,
    getThumbnailPath,
    getTrashPath
} = require("../utils/pathUtils");

const {
    getUniqueFilePath
} = require("../services/mediaService");

const { moveFileNoOverwrite } = require("../utils/fileOperations");
const router = express.Router();

/**
 * メディア削除
 *
 * DELETE /api/media?path=...
 *
 * 完全削除ではなくゴミ箱へ移動する
 */
router.delete("/", async (req, res) => {
    const relativePath =
        req.query.path;

    if (!relativePath) {
        return res.status(400).json({
            error:
                "Media path is required"
        });
    }

    let filePath;
    let trashPath;

    try {
        /*
         * 元ファイル
         */
        filePath =
            getSafeMediaPath(
                relativePath
            );

        /*
         * DBからメディア情報取得
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
         * ファイル確認
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
         * ゴミ箱の保存先
         */
        trashPath =
            getTrashPath(
                relativePath
            );

        /*
         * ゴミ箱側のディレクトリ作成
         */
        await fs.mkdir(
            path.dirname(
                trashPath
            ),
            {
                recursive: true
            }
        );

        /*
         * 同じパスがすでにゴミ箱に存在する場合、
         * 自動的に名前を変更する。
         *
         * 例:
         * test.jpg
         * test (1).jpg
         * test (2).jpg
         */
        try {
            await fs.access(
                trashPath
            );

            trashPath =
                await getUniqueFilePath(
                    path.dirname(
                        trashPath
                    ),
                    path.basename(
                        trashPath
                    )
                );

        } catch (error) {
            if (
                error.code !==
                "ENOENT"
            ) {
                throw error;
            }
        }

        /*
         * ファイルをゴミ箱へ移動
         */
        await moveFileNoOverwrite(
            filePath,
            trashPath
        );

        /*
         * 元の相対パスに対する
         * ゴミ箱内の相対パス
         */
        const trashRelativePath =
            path.relative(
                TRASH_DIR,
                trashPath
            );

        try {
            /*
             * DB処理
             *
             * INSERTとDELETEを
             * SQLiteトランザクションでまとめる
             */
            const transaction =
                db.transaction(() => {

                    db.prepare(`
                        INSERT INTO trash (
                            original_path,
                            trash_path,
                            type,
                            file_size,
                            modified_at,
                            taken_at,
                            deleted_at
                        )
                        VALUES (
                            ?,
                            ?,
                            ?,
                            ?,
                            ?,
                            ?,
                            ?
                        )
                    `).run(
                        relativePath,
                        trashRelativePath,
                        media.type,
                        media.file_size,
                        media.modified_at,
                        media.taken_at,
                        Date.now()
                    );

                    db.prepare(`
                        DELETE FROM media
                        WHERE path = ?
                    `).run(
                        relativePath
                    );
                });

            transaction();

        } catch (error) {
            /*
             * DB処理に失敗した場合、
             * ファイルを元の場所へ戻す
             */
            try {
                await fs.rename(
                    trashPath,
                    filePath
                );
            } catch (rollbackError) {
                console.error(
                    "Failed to rollback file move:",
                    rollbackError
                );
            }

            throw error;
        }

        /*
         * サムネイル削除
         *
         * 現在のサムネイル仕様では
         * 元ファイルの拡張子に関係なく
         * .jpgになっている。
         */
        const thumbnailRelativePath =
            path.join(
                path.dirname(
                    relativePath
                ),
                path.parse(
                    relativePath
                ).base + ".thumb.jpg"
            );

        const thumbnailPath =
            getThumbnailPath(
                thumbnailRelativePath
            );

        try {
            await fs.unlink(
                thumbnailPath
            );

        } catch (error) {
            if (
                error.code !==
                "ENOENT"
            ) {
                console.error(
                    "Failed to delete thumbnail:",
                    error
                );
            }
        }

        res.json({
            message:
                "Media moved to trash",

            path:
                relativePath
        });

    } catch (error) {
        console.error(error);

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
                "Failed to move media to trash"
        });
    }
});

/**
 * メディア一括削除
 *
 * POST /api/media/bulk-delete
 *
 * 完全削除ではなくゴミ箱へ移動する
 */

module.exports = router;
