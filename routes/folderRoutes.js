const express = require("express");
const fs = require("fs/promises");
const path = require("path");

const db = require("../database");

const {
    getSafeMediaPath
} = require("../utils/pathUtils");

const router = express.Router();

/**
 * アプリ内部で使用する特殊フォルダ
 *
 * ユーザーからは通常のフォルダとして扱わない。
 */
const INTERNAL_DIRECTORIES = new Set([
    ".thumbnails",
    ".trash",
    ".incoming"
]);

/**
 * 内部フォルダかどうか
 */
function isInternalDirectory(name) {
    return INTERNAL_DIRECTORIES.has(name);
}

/**
 * フォルダ名が安全か確認
 */
function isValidFolderName(name) {
    return typeof name === "string" && name.length > 0 &&
        !name.includes("/") &&
        !name.includes("\\") &&
        name !== "." &&
        name !== ".." && !name.includes("\0");
}

/**
 * フォルダ一覧取得
 *
 * GET /api/folders?path=...
 */
router.get("/", async (req, res) => {
    try {
        const relativePath =
            req.query.path || "";

        const directory =
            getSafeMediaPath(
                relativePath
            );

        const entries =
            await fs.readdir(
                directory,
                {
                    withFileTypes: true
                }
            );

        const folders = [];

        for (const entry of entries) {
            if (!entry.isDirectory()) {
                continue;
            }

            // アプリ内部フォルダは表示しない
            if (isInternalDirectory(entry.name)) {
                continue;
            }

            folders.push({
                name: entry.name,

                path: path.join(
                    relativePath,
                    entry.name
                )
            });
        }

        folders.sort((a, b) => {
            return a.name.localeCompare(
                b.name,
                undefined,
                {
                    numeric: true
                }
            );
        });

        res.json({
            path: relativePath,
            folders: folders
        });

    } catch (error) {
        console.error(error);

        if (error.code === "ENOENT") {
            return res.status(404).json({
                error:
                    "Folder not found"
            });
        }

        res.status(500).json({
            error:
                "Failed to read folders"
        });
    }
});

/**
 * フォルダ作成
 *
 * POST /api/folders?path=...
 */
router.post("/", async (req, res) => {
    try {
        const relativePath =
            req.query.path || "";

        const folderName =
            req.body.name;

        if (!folderName) {
            return res.status(400).json({
                error:
                    "Folder name is required"
            });
        }

        if (!isValidFolderName(folderName)) {
            return res.status(400).json({
                error:
                    "Invalid folder name"
            });
        }

        // 内部フォルダ名の作成を禁止
        if (isInternalDirectory(folderName)) {
            return res.status(400).json({
                error:
                    "この名前のフォルダは作成できません。"
            });
        }

        const parentDirectory =
            getSafeMediaPath(
                relativePath
            );

        const folderPath =
            path.join(
                parentDirectory,
                folderName
            );

        await fs.mkdir(folderPath);

        res.json({
            message:
                "Folder created",

            name:
                folderName,

            path:
                path.join(
                    relativePath,
                    folderName
                )
        });

    } catch (error) {
        console.error(error);

        if (error.code === "EEXIST") {
            return res.status(409).json({
                error:
                    "同じ名前のフォルダがすでに存在します。"
            });
        }

        res.status(500).json({
            error:
                "Failed to create folder"
        });
    }
});

/**
 * フォルダ削除
 *
 * 空フォルダのみ削除可能
 *
 * DELETE /api/folders?path=...
 */
router.delete("/", async (req, res) => {
    try {
        const relativePath =
            req.query.path || "";

        if (!relativePath) {
            return res.status(400).json({
                error:
                    "Cannot delete root folder"
            });
        }

        // パスの最後のフォルダ名を取得
        const folderName =
            path.basename(
                relativePath
            );

        // 内部フォルダの削除を禁止
        if (isInternalDirectory(folderName)) {
            return res.status(403).json({
                error:
                    "このフォルダは削除できません。"
            });
        }

        const folderPath =
            getSafeMediaPath(
                relativePath
            );

        const entries =
            await fs.readdir(
                folderPath,
                {
                    withFileTypes: true
                }
            );

        if (entries.length > 0) {
            return res.status(409).json({
                error:
                    "フォルダが空ではありません。"
            });
        }

        await fs.rmdir(folderPath);

        res.json({
            message:
                "Folder deleted",

            path:
                relativePath
        });

    } catch (error) {
        console.error(error);

        if (error.code === "ENOENT") {
            return res.status(404).json({
                error:
                    "Folder not found"
            });
        }

        res.status(500).json({
            error:
                "Failed to delete folder"
        });
    }
});

/**
 * フォルダ名前変更
 *
 * PUT /api/folders?path=...
 */
router.put("/", async (req, res) => {
    try {
        const relativePath =
            req.query.path || "";

        const newName =
            req.body.name;

        if (!relativePath) {
            return res.status(400).json({
                error:
                    "Cannot rename root folder"
            });
        }

        if (!newName) {
            return res.status(400).json({
                error:
                    "Folder name is required"
            });
        }

        if (!isValidFolderName(newName)) {
            return res.status(400).json({
                error:
                    "Invalid folder name"
            });
        }

        // 現在のフォルダ名を確認
        const currentName =
            path.basename(
                relativePath
            );

        // 内部フォルダの名前変更を禁止
        if (isInternalDirectory(currentName)) {
            return res.status(403).json({
                error:
                    "このフォルダは名前を変更できません。"
            });
        }

        // 内部フォルダ名への変更も禁止
        if (isInternalDirectory(newName)) {
            return res.status(400).json({
                error:
                    "この名前には変更できません。"
            });
        }

        const oldPath =
            getSafeMediaPath(
                relativePath
            );

        const parentPath =
            path.dirname(oldPath);

        const newPath =
            path.join(
                parentPath,
                newName
            );

        const relativeParent =
            path.dirname(relativePath);

        const newRelativePath =
            path.join(
                relativeParent === "."
                    ? ""
                    : relativeParent,
                newName
            );

        getSafeMediaPath(
            newRelativePath
        );

        if (relativePath === newRelativePath) {
            return res.json({ message: "Folder name is unchanged", oldPath: relativePath, newPath: newRelativePath });
        }

        // 同名フォルダ確認
        try {
            await fs.access(newPath);

            return res.status(409).json({
                error:
                    "同じ名前のフォルダがすでに存在します。"
            });

        } catch (error) {
            if (error.code !== "ENOENT") {
                throw error;
            }
        }

        await fs.rename(
            oldPath,
            newPath
        );

        // SQLiteのパスを更新
        const oldPrefix =
            relativePath + "/";

        const newPrefix =
            newRelativePath + "/";

        try {
            db.prepare(`
                UPDATE media
                SET path = ? || substr(path, ?)
                WHERE substr(path, 1, ?) = ?
            `).run(
                newPrefix,
                oldPrefix.length + 1,
                oldPrefix.length,
                oldPrefix
            );
        } catch (error) {
            // Do not leave a renamed folder with unchanged media rows.
            try { await fs.rename(newPath, oldPath); }
            catch (rollbackError) { console.error("Folder rollback failed:", rollbackError); }
            throw error;
        }

        // Keep the folder's cache with it (failure is non-critical).
        const { getThumbnailPath } = require("../utils/pathUtils");
        try {
            const oldCache = getThumbnailPath(relativePath);
            const newCache = getThumbnailPath(newRelativePath);
            await fs.mkdir(path.dirname(newCache), { recursive: true });
            await fs.rename(oldCache, newCache);
        } catch (cacheError) {
            if (cacheError.code !== "ENOENT") console.warn("Thumbnail cache move skipped:", cacheError);
        }

        res.json({
            message:
                "Folder renamed",

            oldPath:
                relativePath,

            newPath:
                newRelativePath
        });

    } catch (error) {
        console.error(error);

        if (error.code === "ENOENT") {
            return res.status(404).json({
                error:
                    "Folder not found"
            });
        }

        res.status(500).json({
            error:
                "Failed to rename folder"
        });
    }
});

module.exports = router;