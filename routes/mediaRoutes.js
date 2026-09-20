const express = require("express");
const fs = require("fs/promises");
const path = require("path");

const db = require("../database");

const {
    MEDIA_DIR,
    TRASH_DIR,
    getSafeMediaPath,
    getThumbnailPath,
    getTrashPath
} = require("../utils/pathUtils");

const {
    validateMediaName,
    getExtension,
    getUniqueFilePath
} = require("../services/mediaService");

const router = express.Router();

/**
 * メディア一覧取得
 *
 * GET /api/media?path=...&page=...&limit=...
 */
router.get("/", async (req, res) => {
    try {
        const page =
            parseInt(
                req.query.page
            ) || 1;

        const limit =
            parseInt(
                req.query.limit
            ) || 100;

        const relativePath =
            req.query.path || "";

        if (
            page < 1 ||
            limit < 1
        ) {
            return res.status(400).json({
                error:
                    "Invalid page or limit"
            });
        }

        getSafeMediaPath(
            relativePath
        );

        const offset =
            (page - 1) * limit;

        let media;
        let total;

        if (relativePath === "") {
            media =
                db.prepare(`
                    SELECT
                        id,
                        path,
                        type,
                        file_size,
                        modified_at,
                        taken_at
                    FROM media
                    WHERE instr(path, '/') = 0
                    ORDER BY path
                    LIMIT ? OFFSET ?
                `).all(
                    limit,
                    offset
                );

            total =
                db.prepare(`
                    SELECT
                        COUNT(*) AS count
                    FROM media
                    WHERE instr(path, '/') = 0
                `).get().count;

        } else {
            const prefix =
                relativePath + "/%";

            const deepPrefix =
                relativePath + "/%/%";

            media =
                db.prepare(`
                    SELECT
                        id,
                        path,
                        type,
                        file_size,
                        modified_at,
                        taken_at
                    FROM media
                    WHERE path LIKE ?
                    AND path NOT LIKE ?
                    ORDER BY path
                    LIMIT ? OFFSET ?
                `).all(
                    prefix,
                    deepPrefix,
                    limit,
                    offset
                );

            total =
                db.prepare(`
                    SELECT
                        COUNT(*) AS count
                    FROM media
                    WHERE path LIKE ?
                    AND path NOT LIKE ?
                `).get(
                    prefix,
                    deepPrefix
                ).count;
        }

        res.json({
            media,
            page,
            limit,
            total,
            hasMore:
                offset + media.length <
                total
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            error:
                "Failed to fetch media"
        });
    }
});


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
        await fs.rename(
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
                ).name + ".jpg"
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
 * メディア名前変更
 *
 * PUT /api/media?path=...
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

        /*
         * 元ファイルの拡張子
         */
        const oldExtension =
            getExtension(
                relativePath
            );

        /*
         * 入力された拡張子を除去
         */
        const inputExtension =
            path.extname(
                inputName
            );

        const newBaseName =
            path.basename(
                inputName,
                inputExtension
            );

        /*
         * 元の拡張子を使用
         */
        const newName =
            newBaseName +
            oldExtension;

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

        /*
         * 新しい相対パス
         */
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

        /*
         * 同名ファイル確認
         */
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

        await fs.rename(
            oldPath,
            newPath
        );

        /*
         * SQLite更新
         */
        db.prepare(`
            UPDATE media
            SET path = ?
            WHERE path = ?
        `).run(
            newRelativePath,
            relativePath
        );

        res.json({
            message:
                "Media renamed",

            oldPath:
                relativePath,

            newPath:
                newRelativePath
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
                "Failed to rename media"
        });
    }
});

module.exports = router;