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
router.post("/bulk-delete", async (req, res) => {

    const ids = req.body.ids;

    // --------------------------------
    // IDチェック
    // --------------------------------

    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({
            error: "Media IDs are required"
        });
    }

    const uniqueIds = [
        ...new Set(
            ids.map(id => Number(id))
        )
    ];

    if (
        uniqueIds.some(
            id =>
                !Number.isInteger(id) ||
                id <= 0
        )
    ) {
        return res.status(400).json({
            error: "Invalid media IDs"
        });
    }


    let movedFiles = [];

    try {

        // --------------------------------
        // DBからメディア情報取得
        // --------------------------------

        const placeholders =
            uniqueIds
                .map(() => "?")
                .join(",");

        const mediaList =
            db.prepare(`
                SELECT
                    id,
                    path,
                    type,
                    file_size,
                    modified_at,
                    taken_at
                FROM media
                WHERE id IN (${placeholders})
            `).all(...uniqueIds);


        if (
            mediaList.length !==
            uniqueIds.length
        ) {
            return res.status(404).json({
                error:
                    "Some media were not found"
            });
        }


        // --------------------------------
        // ファイル存在確認
        // --------------------------------

        for (const media of mediaList) {

            const filePath =
                getSafeMediaPath(
                    media.path
                );

            const stat =
                await fs.stat(
                    filePath
                );

            if (!stat.isFile()) {
                return res.status(400).json({
                    error:
                        `Target is not a file: ${media.path}`
                });
            }
        }


        // --------------------------------
        // ゴミ箱パスを事前に決定
        // --------------------------------

        const movePlan = [];
        const plannedTrashPaths = new Set();

        for (const media of mediaList) {

            const filePath =
                getSafeMediaPath(
                    media.path
                );

            let trashPath =
                getTrashPath(
                    media.path
                );


            await fs.mkdir(
                path.dirname(trashPath),
                {
                    recursive: true
                }
            );


            // 同名ファイルが存在する場合
            // 自動的に連番を付ける
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


            const trashRelativePath =
                path.relative(
                    TRASH_DIR,
                    trashPath
                );


            movePlan.push({
                media,
                filePath,
                trashPath,
                trashRelativePath
            });
        }


        // --------------------------------
        // ファイルをゴミ箱へ移動
        // --------------------------------

        try {

            for (const plan of movePlan) {

                await moveFileNoOverwrite(
                    plan.filePath,
                    plan.trashPath
                );

                movedFiles.push(plan);
            }

        } catch (error) {

            // 途中まで移動したファイルを
            // 元の場所へ戻す
            for (
                const plan of
                [...movedFiles].reverse()
            ) {

                try {

                    await fs.rename(
                        plan.trashPath,
                        plan.filePath
                    );

                } catch (rollbackError) {

                    console.error(
                        "Failed to rollback bulk delete:",
                        rollbackError
                    );
                }
            }

            throw error;
        }


        // --------------------------------
        // DB更新
        // --------------------------------

        try {

            const transaction =
                db.transaction(() => {

                    const insertTrash =
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
                        `);


                    const deleteMedia =
                        db.prepare(`
                            DELETE FROM media
                            WHERE id = ?
                        `);


                    for (const plan of movePlan) {

                        insertTrash.run(
                            plan.media.path,
                            plan.trashRelativePath,
                            plan.media.type,
                            plan.media.file_size,
                            plan.media.modified_at,
                            plan.media.taken_at,
                            Date.now()
                        );

                        deleteMedia.run(
                            plan.media.id
                        );
                    }
                });


            transaction();

        } catch (error) {

            // DB更新失敗時は
            // ファイルを元に戻す

            for (
                const plan of
                [...movedFiles].reverse()
            ) {

                try {

                    await fs.rename(
                        plan.trashPath,
                        plan.filePath
                    );

                } catch (rollbackError) {

                    console.error(
                        "Failed to rollback bulk delete:",
                        rollbackError
                    );
                }
            }

            throw error;
        }


        // --------------------------------
        // サムネイル削除
        // --------------------------------

        for (const plan of movePlan) {

            const thumbnailRelativePath =
                path.join(
                    path.dirname(
                        plan.media.path
                    ),
                    path.parse(
                        plan.media.path
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
        }


        res.json({
            message:
                "Media moved to trash",

            count:
                movePlan.length
        });


    } catch (error) {

        console.error(error);


        if (
            error.code ===
            "ENOENT"
        ) {

            return res.status(404).json({
                error:
                    "Some media files were not found"
            });
        }


        res.status(500).json({
            error:
                "Failed to move media to trash"
        });
    }
});

module.exports = router;
