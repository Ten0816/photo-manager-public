const express = require("express");
const fs = require("fs/promises");
const path = require("path");

const db = require("../database");

const {
    getSafeMediaPath
} = require("../utils/pathUtils");

const router = express.Router();

/**
 * メディア一括移動
 *
 * POST /api/media/bulk-move
 */
router.post("/bulk-move", async (req, res) => {

    const ids =
        req.body.ids;

    const destination =
        req.body.destination;


    // --------------------------------
    // 入力チェック
    // --------------------------------

    if (
        !Array.isArray(ids) ||
        ids.length === 0
    ) {

        return res.status(400).json({
            error:
                "Media IDs are required"
        });
    }


    if (
        typeof destination !==
        "string"
    ) {

        return res.status(400).json({
            error:
                "Destination is required"
        });
    }


    const trimmedDestination =
        destination.trim();


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
            error:
                "Invalid media IDs"
        });
    }


    let movedFiles = [];


    try {

        // --------------------------------
        // 移動先の安全性確認
        // --------------------------------

        const destinationPath =
            getSafeMediaPath(
                trimmedDestination
            );


        // --------------------------------
        // DBからメディア取得
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
        // 移動先フォルダ作成
        // --------------------------------

        await fs.mkdir(
            destinationPath,
            {
                recursive: true
            }
        );


        // --------------------------------
        // 移動計画作成
        // --------------------------------

        const movePlan = [];


        for (const media of mediaList) {

            const oldPath =
                getSafeMediaPath(
                    media.path
                );


            const fileName =
                path.basename(
                    media.path
                );


            const newRelativePath =
                path.join(
                    trimmedDestination,
                    fileName
                );


            getSafeMediaPath(
                newRelativePath
            );


            const newPath =
                getSafeMediaPath(
                    newRelativePath
                );


            // 同じ場所への移動
            if (
                media.path ===
                newRelativePath
            ) {

                return res.status(400).json({
                    error:
                        `Already in destination: ${media.path}`
                });
            }


            // 移動先に同名ファイルがあるか確認
            try {

                await fs.access(
                    newPath
                );

                return res.status(409).json({
                    error:
                        `同じ名前のファイルがすでに存在します: ${fileName}`
                });

            } catch (error) {

                if (
                    error.code !==
                    "ENOENT"
                ) {
                    throw error;
                }
            }


            movePlan.push({
                media,
                oldPath,
                newPath,
                newRelativePath
            });
        }


        // --------------------------------
        // 実ファイル移動
        // --------------------------------

        try {

            for (const plan of movePlan) {

                await fs.rename(
                    plan.oldPath,
                    plan.newPath
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
                        plan.newPath,
                        plan.oldPath
                    );

                } catch (rollbackError) {

                    console.error(
                        "Failed to rollback bulk move:",
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

                    const updateMedia =
                        db.prepare(`
                            UPDATE media
                            SET path = ?
                            WHERE id = ?
                        `);


                    for (const plan of movePlan) {

                        updateMedia.run(
                            plan.newRelativePath,
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
                        plan.newPath,
                        plan.oldPath
                    );

                } catch (rollbackError) {

                    console.error(
                        "Failed to rollback bulk move:",
                        rollbackError
                    );
                }
            }

            throw error;
        }


        res.json({
            message:
                "Media moved successfully",

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
                "Failed to move media"
        });
    }
});



module.exports = router;
