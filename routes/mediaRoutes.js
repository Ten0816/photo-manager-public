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
 * GET /api/media?path=...&page=...&limit=...&sort=...
 *
 * sort:
 *   name-asc   名前順
 *   name-desc  名前逆順
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

        const sort =
            req.query.sort ||
            "name-asc";


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


        /*
         * ソート条件
         *
         * sortを直接SQLへ入れない。
         * 必ずホワイトリストから選択する。
         */
        const sortMap = {

            "name-asc": `
        path ASC
    `,

            "name-desc": `
        path DESC
    `
        };


        if (!sortMap[sort]) {

            return res.status(400).json({
                error:
                    "Invalid sort option"
            });

        }


        const orderBy =
            sortMap[sort];


        const offset =
            (page - 1) * limit;


        let media;
        let total;


        // ============================
        // ルートフォルダ
        // ============================

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
                    ORDER BY
                        ${orderBy}
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


            // ============================
            // サブフォルダ
            // ============================

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
                    ORDER BY
                        ${orderBy}
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

            sort,

            hasMore:
                offset +
                media.length <
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
 * メディア一括削除
 *
 * POST /api/media/bulk-delete
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

                await fs.rename(
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


/**
 * メディア名前変更
 *
 * PUT /api/media?path=...
 */
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

        await fs.rename(
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