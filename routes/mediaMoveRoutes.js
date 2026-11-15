const express = require("express");
const fs = require("fs/promises");
const path = require("path");

const db = require("../database");

const {
    getSafeMediaPath
} = require("../utils/pathUtils");

const { moveFileNoOverwrite } = require("../utils/fileOperations");
const { invalidateThumbnail } = require("../services/thumbnailService");
const {
    assertNoPendingOperations,
    beginBulkMove,
    completeBulkMove
} = require("../utils/operationJournal");

const {
    acquireLock,
    releaseLock
} = require("../utils/fileOperationLock");


// ロールバック後に実ファイル・DB・ジャーナルを検証する。
// すべて正常な場合だけジャーナルを削除する。
async function verifyAndCancelRolledBackMove(journalId, plans) {

    if (journalId === null) {
        return false;
    }

    const journal = db.prepare(`
        SELECT operation, state, payload
        FROM file_operation_journal
        WHERE id = ?
    `).get(journalId);

    if (
        !journal ||
        journal.operation !== "bulk_move" ||
        journal.state !== "pending"
    ) {
        return false;
    }

    let entries;

    try {
        entries = JSON.parse(journal.payload);
    } catch {
        return false;
    }

    if (!Array.isArray(entries) || entries.length !== plans.length) {
        return false;
    }

    for (let i = 0; i < plans.length; i++) {

        const plan = plans[i];
        const entry = entries[i];

        if (
            entry.id !== plan.media.id ||
            entry.from !== plan.media.path ||
            entry.to !== plan.newRelativePath
        ) {
            return false;
        }

        // 移動元は通常のファイルでなければならない。
        let source;

        try {
            source = await fs.lstat(plan.oldPath);
        } catch {
            return false;
        }

        if (!source.isFile() || source.isSymbolicLink()) {
            return false;
        }

        // 移動先には対象ファイルが存在してはいけない。
        try {
            await fs.lstat(plan.newPath);

            return false;

        } catch (error) {

            if (error.code !== "ENOENT") {
                return false;
            }
        }

        const media = db.prepare(`
            SELECT path
            FROM media
            WHERE id = ?
        `).get(plan.media.id);

        if (!media || media.path !== plan.media.path) {
            return false;
        }
    }

    // DBの状態を再確認してジャーナルを削除する。
    // ファイル状態の検査はロック保持中に実施している。
    return db.transaction(() => {

        for (const plan of plans) {

            const media = db.prepare(`
                SELECT path
                FROM media
                WHERE id = ?
            `).get(plan.media.id);

            if (!media || media.path !== plan.media.path) {
                return false;
            }
        }

        const result = db.prepare(`
            DELETE FROM file_operation_journal
            WHERE id = ?
              AND operation = 'bulk_move'
              AND state = 'pending'
              AND payload = ?
        `).run(journalId, journal.payload);

        return result.changes === 1;

    }).immediate();
}

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
    let journalId = null;
    let lockOwner = null;


    try {

        lockOwner = acquireLock(db, "bulk_move");

        assertNoPendingOperations(db);

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
        const destinationNames = new Set();


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


            if (destinationNames.has(newRelativePath)) {
                return res.status(409).json({ error: `選択したファイル同士で名前が重複しています: ${fileName}` });
            }
            destinationNames.add(newRelativePath);

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

        journalId = beginBulkMove(db, movePlan);

        try {

            for (const plan of movePlan) {

                await moveFileNoOverwrite(
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

                    await moveFileNoOverwrite(
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

            // ロールバック後の状態を検証する。
            // 完全に元の状態へ戻った場合だけ履歴を削除する。
            try {

                const restored =
                    await verifyAndCancelRolledBackMove(
                        journalId,
                        movePlan
                    );

                if (restored) {

                    console.log(
                        "Bulk move rollback verified; journal cleared."
                    );

                    journalId = null;

                } else {

                    console.error(
                        "Bulk move requires recovery; journal retained."
                    );
                }

            } catch (verificationError) {

                console.error(
                    "Rollback verification failed; journal retained:",
                    verificationError
                );
            }

            throw error;
        }


        // --------------------------------
        // DB更新と操作履歴の完了
        // SQLiteトランザクションで同時に処理
        completeBulkMove(db, journalId, movePlan);
        journalId = null;

        // Cache is disposable; never roll back a successful move for cache cleanup.
        for (const plan of movePlan) {
            await invalidateThumbnail(plan.media.path).catch(console.error);
            await invalidateThumbnail(plan.newRelativePath).catch(console.error);
        }

        res.json({
            message:
                "Media moved successfully",

            count:
                movePlan.length
        });


    } catch (error) {

        console.error(error);


        if (error.code === "FILE_OPERATION_LOCKED") {
            return res.status(409).json({
                error: "別のファイル操作が実行中です。"
            });
        }

        if (error.code === "PENDING_OPERATION") {
            return res.status(409).json({
                error: "未解決のファイル操作があります。operations:check を実行してください。"
            });
        }

        if (error.code === "EEXIST") {
            return res.status(409).json({error: "同名ファイルが移動先に存在します"});
        }
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
    } finally {
        if (lockOwner !== null) {
            const released = releaseLock(db, lockOwner);
            if (!released) {
                console.error(
                    "Failed to release bulk move lock"
                );
            }
        }
    }
});



module.exports = router;
