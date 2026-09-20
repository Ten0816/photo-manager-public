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
    ".trash"
]);

/**
 * 内部フォルダかどうか
 */
function isInternalDirectory(name) {
    return INTERNAL_DIRECTORIES.has(name);
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

        if (
            folderName.includes("/") ||
            folderName.includes("\\") ||
            folderName === "." ||
            folderName === ".."
        ) {
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

        if (
            newName.includes("/") ||
            newName.includes("\\") ||
            newName === "." ||
            newName === ".."
        ) {
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

        db.prepare(`
            UPDATE media
            SET path = ? || substr(path, ?)
            WHERE path LIKE ?
        `).run(
            newPrefix,
            oldPrefix.length + 1,
            oldPrefix + "%"
        );

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