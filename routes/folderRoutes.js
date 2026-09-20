const express = require("express");
const fs = require("fs/promises");
const path = require("path");

const db = require("../database");

const {
    getSafeMediaPath
} = require("../utils/pathUtils");

const router = express.Router();

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

            if (
                entry.name === ".thumbnails"
            ) {
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