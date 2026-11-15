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

const {
    acquireLock,
    releaseLock
} = require("../utils/fileOperationLock");

// 名前変更APIの実行中、共通のファイル操作ロックを保持する。
async function withMediaRenameLock(req, res, callback) {
    let owner = null;

    try {
        owner = acquireLock(db, "media_rename");
        await callback();

    } catch (error) {

        if (
            error.code === "FILE_OPERATION_LOCKED" ||
            error.code === "PENDING_OPERATION"
        ) {
            if (!res.headersSent) {
                res.status(409).json({
                    error: "別のファイル操作が実行中、または復旧待ちです。"
                });
            }
            return;
        }

        console.error("Media rename lock error:", error);

        if (!res.headersSent) {
            res.status(500).json({
                error: "Failed to rename media"
            });
        }

    } finally {

        if (owner !== null) {
            const released = releaseLock(db, owner);

            if (!released) {
                console.error(
                    "Failed to release media rename lock"
                );
            }
        }
    }
}


const {
    beginMediaRenameWithIdentity,
    completeMediaRename
} = require("../utils/mediaRenameJournal");

const {
    invalidateThumbnail
} = require("../services/thumbnailService");


const {
    cancelUnchangedMediaRename
} = require("../utils/mediaRenameCancellation");

const router = express.Router();

/**
 * メディア名前変更
 *
 * PUT /api/media?path=...
 *
 * 元ファイルとサムネイルを同時に名前変更する
 */
router.put("/", async (req, res) =>
    withMediaRenameLock(req, res, async () => {

    let journalId = null;
    let renamePlan = null;

    try {
        const relativePath = req.query.path;
        const inputName = req.body?.name;

        // 入力チェック
        if (
            typeof relativePath !== "string" ||
            !relativePath
        ) {
            return res.status(400).json({
                error: "Media path is required"
            });
        }

        if (!validateMediaName(inputName)) {
            return res.status(400).json({
                error: "Invalid file name"
            });
        }

        // 元の拡張子を維持
        const oldExtension = getExtension(relativePath);
        const inputExtension = path.extname(inputName);
        const newBaseName = path.basename(
            inputName,
            inputExtension
        );

        const newName = newBaseName + oldExtension;

        // 安全なパスを取得
        const oldPath = getSafeMediaPath(relativePath);

        const relativeDirectory = path.dirname(relativePath);

        const newRelativePath = path.join(
            relativeDirectory === "."
                ? ""
                : relativeDirectory,
            newName
        );

        const newPath = getSafeMediaPath(newRelativePath);

        // 変更なし
        if (relativePath === newRelativePath) {
            return res.json({
                message: "Media name is unchanged",
                oldPath: relativePath,
                newPath: newRelativePath
            });
        }

        // DB上の対象を確認
        const media = db.prepare(`
            SELECT id, path
            FROM media
            WHERE path = ?
        `).get(relativePath);

        if (!media) {
            return res.status(404).json({
                error: "Media not found in database"
            });
        }

        // 元ファイルの確認
        let stat;

        try {
            stat = await fs.lstat(oldPath);
        } catch (error) {
            if (error.code === "ENOENT") {
                return res.status(404).json({
                    error: "Media file not found"
                });
            }

            throw error;
        }

        if (!stat.isFile() || stat.isSymbolicLink()) {
            return res.status(400).json({
                error: "Target is not a regular file"
            });
        }

        // 同名ファイルの存在確認
        try {
            await fs.lstat(newPath);

            return res.status(409).json({
                error: "同じ名前のファイルがすでに存在します。"
            });

        } catch (error) {
            if (error.code !== "ENOENT") {
                throw error;
            }
        }

        // DB上でも重複を確認
        const existing = db.prepare(`
            SELECT id
            FROM media
            WHERE path = ?
        `).get(newRelativePath);

        if (existing) {
            return res.status(409).json({
                error: "移動先のパスがDBに登録されています。"
            });
        }

        const plan = {
            id: media.id,
            from: relativePath,
            to: newRelativePath
        };

        renamePlan = plan;

        // ==========================================
        // ジャーナル登録
        // ==========================================

        journalId = await beginMediaRenameWithIdentity(
            db,
            plan,
            oldPath
        );

        // ==========================================
        // 実ファイルの名前変更
        // ==========================================

        await moveFileNoOverwrite(
            oldPath,
            newPath
        );

        // ==========================================
        // SQLite更新とジャーナル完了
        // ==========================================

        completeMediaRename(
            db,
            journalId,
            plan
        );

        journalId = null;

        // ==========================================
        // サムネイルの無効化
        // ==========================================

        // キャッシュ削除失敗は名前変更失敗としない。
        await invalidateThumbnail(relativePath)
            .catch(console.error);

        await invalidateThumbnail(newRelativePath)
            .catch(console.error);

        return res.json({
            message: "Media renamed",
            oldPath: relativePath,
            newPath: newRelativePath
        });

    } catch (error) {

        console.error("Rename media error:", error);

        // ジャーナル登録後のエラーは
        // 自動削除・自動ロールバックしない。
        // 復旧コマンドによる確認を要求する。
        if (journalId !== null) {

            let cancelled = false;

            try {
                if (renamePlan !== null) {
                    cancelled =
                        await cancelUnchangedMediaRename(
                            db,
                            journalId,
                            renamePlan
                        );
                }
            } catch (cancelError) {
                console.error(
                    "Rename cancellation verification failed:",
                    cancelError
                );
            }

            // 元の状態を確認できた場合だけ
            // ジャーナルを取り消す。
            if (cancelled) {
                return res.status(500).json({
                    error: "名前変更に失敗しました。",
                    recoveryRequired: false,
                    message:
                        "ファイルとDBが変更前の状態であることを確認しました。"
                });
            }

            // 状態が不明ならジャーナルを保持する。
            return res.status(500).json({
                error: "名前変更が中断されました。",
                recoveryRequired: true,
                message:
                    "操作履歴が残っています。管理者による確認が必要です。"
            });
        }

        if (error.code === "EEXIST") {
            return res.status(409).json({
                error: "同名ファイルが存在します。"
            });
        }

        if (error.code === "ENOENT") {
            return res.status(404).json({
                error: "Media file not found"
            });
        }

        return res.status(500).json({
            error: "Failed to rename media"
        });
    }
}));


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
