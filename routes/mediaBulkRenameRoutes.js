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

const router = express.Router();

/**
 * メディア一括名前変更
 *
 * POST /api/media/bulk-rename
 *
 * 元ファイルとサムネイルを同時に名前変更する
 */
router.post("/bulk-rename", async (req, res) => {

    const ids =
        req.body.ids;

    const baseName =
        req.body.baseName;


    // ========================================================
    // 入力チェック
    // ========================================================

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
        typeof baseName !== "string" ||
        !baseName.trim()
    ) {

        return res.status(400).json({
            error:
                "Base name is required"
        });
    }


    const trimmedBaseName =
        baseName.trim();


    if (
        !validateMediaName(
            trimmedBaseName
        )
    ) {

        return res.status(400).json({
            error:
                "Invalid file name"
        });
    }


    // ========================================================
    // IDを正規化
    // ========================================================

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


    // ========================================================
    // DBからメディア取得
    //
    // 注意:
    // SQLのIN句では配列順が保証されないため、
    // uniqueIdsの順番に並べ直す。
    // ========================================================

    const placeholders =
        uniqueIds
            .map(() => "?")
            .join(",");


    try {

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
            `).all(
                ...uniqueIds
            );


        if (
            mediaList.length !==
            uniqueIds.length
        ) {

            return res.status(404).json({
                error:
                    "Some media were not found"
            });
        }


        const mediaMap =
            new Map(
                mediaList.map(
                    media => [
                        media.id,
                        media
                    ]
                )
            );


        const orderedMedia =
            uniqueIds.map(
                id => mediaMap.get(id)
            );


        // ====================================================
        // 名前変更計画作成
        // ====================================================

        const renamePlan = [];


        for (
            let index = 0;
            index < orderedMedia.length;
            index++
        ) {

            const media =
                orderedMedia[index];


            const oldRelativePath =
                media.path;


            const oldPath =
                getSafeMediaPath(
                    oldRelativePath
                );


            const directory =
                path.dirname(
                    oldPath
                );


            // 元ファイルの拡張子を維持
            const extension =
                getExtension(
                    oldRelativePath
                );


            const newName =
                `${trimmedBaseName}_${index + 1}${extension}`;


            // 新しい相対パス
            const relativeDirectory =
                path.dirname(
                    oldRelativePath
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


            const newPath =
                path.join(
                    directory,
                    newName
                );


            // ----------------------------------------------
            // サムネイル
            // ----------------------------------------------

            const oldThumbnailRelativePath =
                path.join(
                    path.dirname(
                        oldRelativePath
                    ),
                    path.parse(
                        oldRelativePath
                    ).name + ".jpg"
                );


            const newThumbnailRelativePath =
                path.join(
                    path.dirname(
                        newRelativePath
                    ),
                    path.parse(
                        newRelativePath
                    ).name + ".jpg"
                );


            const oldThumbnailPath =
                getThumbnailPath(
                    oldThumbnailRelativePath
                );


            const newThumbnailPath =
                getThumbnailPath(
                    newThumbnailRelativePath
                );


            renamePlan.push({
                media,

                oldRelativePath,
                newRelativePath,

                oldPath,
                newPath,

                oldThumbnailRelativePath,
                newThumbnailRelativePath,

                oldThumbnailPath,
                newThumbnailPath,

                temporaryPath: null,
                temporaryThumbnailPath: null
            });
        }


        // ====================================================
        // 重複する新しい名前がないか確認
        // ====================================================

        const newRelativePaths =
            new Set();


        for (const plan of renamePlan) {

            if (
                newRelativePaths.has(
                    plan.newRelativePath
                )
            ) {

                return res.status(409).json({
                    error:
                        `名前が重複しています: ${plan.newRelativePath}`
                });
            }


            newRelativePaths.add(
                plan.newRelativePath
            );
        }


        // ====================================================
        // 現在選択されていないファイルとの衝突確認
        // ====================================================

        const selectedOldPaths =
            new Set(
                renamePlan.map(
                    plan => plan.oldRelativePath
                )
            );


        for (const plan of renamePlan) {

            if (
                plan.oldRelativePath ===
                plan.newRelativePath
            ) {
                continue;
            }


            try {

                await fs.access(
                    plan.newPath
                );


                // 新しい名前が、今回名前変更する
                // 別ファイルの元の名前ならOK。
                if (
                    !selectedOldPaths.has(
                        plan.newRelativePath
                    )
                ) {

                    return res.status(409).json({
                        error:
                            `同じ名前のファイルがすでに存在します: ${plan.newRelativePath}`
                    });
                }


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
        // サムネイルの衝突確認
        // ====================================================

        const selectedOldThumbnailPaths =
            new Set(
                renamePlan.map(
                    plan =>
                        plan.oldThumbnailRelativePath
                )
            );


        for (const plan of renamePlan) {

            if (
                plan.oldThumbnailRelativePath ===
                plan.newThumbnailRelativePath
            ) {
                continue;
            }


            try {

                await fs.access(
                    plan.newThumbnailPath
                );


                if (
                    !selectedOldThumbnailPaths.has(
                        plan.newThumbnailRelativePath
                    )
                ) {

                    return res.status(409).json({
                        error:
                            `同じ名前のサムネイルがすでに存在します: ${plan.newThumbnailRelativePath}`
                    });
                }


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
        // 元ファイルの存在確認
        // ====================================================

        for (const plan of renamePlan) {

            const stat =
                await fs.stat(
                    plan.oldPath
                );


            if (!stat.isFile()) {

                return res.status(400).json({
                    error:
                        `Target is not a file: ${plan.oldRelativePath}`
                });
            }
        }


        // ====================================================
        // 一時ファイル名を作る
        //
        // A.jpg → .bulk-rename-temp-xxx
        //
        // これにより
        //
        // A.jpg → B.jpg
        // B.jpg → A.jpg
        //
        // のようなケースでも安全に変更できる。
        // ====================================================

        const operationId =
            `${Date.now()}-${process.pid}-${Math.random()
                .toString(36)
                .slice(2)}`;


        for (
            let index = 0;
            index < renamePlan.length;
            index++
        ) {

            const plan =
                renamePlan[index];


            const temporaryName =
                `.bulk-rename-${operationId}-${index}`;


            plan.temporaryPath =
                path.join(
                    path.dirname(
                        plan.oldPath
                    ),
                    temporaryName
                );


            plan.temporaryThumbnailPath =
                path.join(
                    path.dirname(
                        plan.oldThumbnailPath
                    ),
                    temporaryName + ".jpg"
                );
        }


        // ====================================================
        // 実ファイルを一旦一時ファイルへ
        // ====================================================

        const movedFiles = [];


        try {

            for (const plan of renamePlan) {

                await fs.rename(
                    plan.oldPath,
                    plan.temporaryPath
                );


                movedFiles.push(plan);
            }

        } catch (error) {

            console.error(
                "Failed to move files to temporary paths:",
                error
            );


            for (
                const plan of
                [...movedFiles].reverse()
            ) {

                try {

                    await fs.rename(
                        plan.temporaryPath,
                        plan.oldPath
                    );

                } catch (rollbackError) {

                    console.error(
                        "Failed to rollback temporary file rename:",
                        rollbackError
                    );
                }
            }


            throw error;
        }


        // ====================================================
        // サムネイルを一時ファイルへ
        // ====================================================

        const movedThumbnails = [];


        try {

            for (const plan of renamePlan) {

                try {

                    await fs.rename(
                        plan.oldThumbnailPath,
                        plan.temporaryThumbnailPath
                    );


                    movedThumbnails.push(plan);

                } catch (error) {

                    // サムネイルが存在しない場合は
                    // スキップする。
                    if (
                        error.code ===
                        "ENOENT"
                    ) {
                        continue;
                    }


                    throw error;
                }
            }

        } catch (error) {

            console.error(
                "Failed to move thumbnails to temporary paths:",
                error
            );


            for (
                const plan of
                [...movedThumbnails].reverse()
            ) {

                try {

                    await fs.rename(
                        plan.temporaryThumbnailPath,
                        plan.oldThumbnailPath
                    );

                } catch (rollbackError) {

                    console.error(
                        "Failed to rollback thumbnail rename:",
                        rollbackError
                    );
                }
            }


            for (
                const plan of
                [...movedFiles].reverse()
            ) {

                try {

                    await fs.rename(
                        plan.temporaryPath,
                        plan.oldPath
                    );

                } catch (rollbackError) {

                    console.error(
                        "Failed to rollback file rename:",
                        rollbackError
                    );
                }
            }


            throw error;
        }


        // ====================================================
        // 一時ファイル → 新しい名前
        // ====================================================

        const renamedFiles = [];
        const renamedThumbnails = [];


        try {

            for (const plan of renamePlan) {

                await fs.rename(
                    plan.temporaryPath,
                    plan.newPath
                );


                renamedFiles.push(plan);
            }


            // サムネイル
            for (const plan of movedThumbnails) {

                await fs.rename(
                    plan.temporaryThumbnailPath,
                    plan.newThumbnailPath
                );


                renamedThumbnails.push(plan);
            }


        } catch (error) {

            console.error(
                "Failed to rename files to final paths:",
                error
            );


            // ----------------------------------------------
            // 変更後ファイルを元へ戻す
            // ----------------------------------------------

            for (
                const plan of
                [...renamedFiles].reverse()
            ) {

                try {

                    await fs.rename(
                        plan.newPath,
                        plan.oldPath
                    );

                } catch (rollbackError) {

                    console.error(
                        "Failed to rollback renamed file:",
                        rollbackError
                    );
                }
            }


            // ----------------------------------------------
            // まだ一時ファイルにあるものを元へ
            // ----------------------------------------------

            for (
                const plan of
                [...movedFiles].reverse()
            ) {

                try {

                    // すでにnewPathへ移動済みなら
                    // temporaryPathは存在しない
                    try {
                        await fs.access(
                            plan.temporaryPath
                        );
                    } catch {
                        continue;
                    }


                    await fs.rename(
                        plan.temporaryPath,
                        plan.oldPath
                    );

                } catch (rollbackError) {

                    console.error(
                        "Failed to rollback temporary file:",
                        rollbackError
                    );
                }
            }


            // ----------------------------------------------
            // サムネイルを元へ
            // ----------------------------------------------

            for (
                const plan of
                [...renamedThumbnails].reverse()
            ) {

                try {

                    await fs.rename(
                        plan.newThumbnailPath,
                        plan.oldThumbnailPath
                    );

                } catch (rollbackError) {

                    console.error(
                        "Failed to rollback renamed thumbnail:",
                        rollbackError
                    );
                }
            }


            for (
                const plan of
                [...movedThumbnails].reverse()
            ) {

                try {

                    try {
                        await fs.access(
                            plan.temporaryThumbnailPath
                        );
                    } catch {
                        continue;
                    }


                    await fs.rename(
                        plan.temporaryThumbnailPath,
                        plan.oldThumbnailPath
                    );

                } catch (rollbackError) {

                    console.error(
                        "Failed to rollback temporary thumbnail:",
                        rollbackError
                    );
                }
            }


            throw error;
        }


        // ====================================================
        // SQLite更新
        // ====================================================

        try {

            const transaction =
                db.transaction(() => {

                    const updateMedia =
                        db.prepare(`
                            UPDATE media
                            SET path = ?
                            WHERE id = ?
                        `);


                    for (const plan of renamePlan) {

                        updateMedia.run(
                            plan.newRelativePath,
                            plan.media.id
                        );
                    }
                });


            transaction();


        } catch (error) {

            console.error(
                "Failed to update media database:",
                error
            );


            // ----------------------------------------------
            // ファイルを元に戻す
            // ----------------------------------------------

            for (
                const plan of
                [...renamePlan].reverse()
            ) {

                try {

                    await fs.rename(
                        plan.newPath,
                        plan.oldPath
                    );

                } catch (rollbackError) {

                    console.error(
                        "Failed to rollback renamed file after DB failure:",
                        rollbackError
                    );
                }
            }


            // ----------------------------------------------
            // サムネイルを元に戻す
            // ----------------------------------------------

            for (
                const plan of
                [...renamedThumbnails].reverse()
            ) {

                try {

                    await fs.rename(
                        plan.newThumbnailPath,
                        plan.oldThumbnailPath
                    );

                } catch (rollbackError) {

                    console.error(
                        "Failed to rollback thumbnail after DB failure:",
                        rollbackError
                    );
                }
            }


            throw error;
        }


        // ====================================================
        // 完了
        // ====================================================

        res.json({
            message:
                "Media renamed successfully",

            count:
                renamePlan.length,

            files:
                renamePlan.map(
                    plan => ({
                        id:
                            plan.media.id,

                        oldPath:
                            plan.oldRelativePath,

                        newPath:
                            plan.newRelativePath
                    })
                )
        });


    } catch (error) {

        console.error(
            "Bulk rename error:",
            error
        );


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
                "Failed to rename media"
        });
    }
});

module.exports = router;
