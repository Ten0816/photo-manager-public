const express = require("express");
const fs = require("fs/promises");
const path = require("path");

const db = require("../database");

const {
    getSafeMediaPath
} = require("../utils/pathUtils");

const {
    validateMediaName,
    getExtension
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
            parseInt(req.query.page) || 1;

        const limit =
            parseInt(req.query.limit) || 100;

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
                    SELECT COUNT(*) AS count
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
                    SELECT COUNT(*) AS count
                    FROM media
                    WHERE path LIKE ?
                    AND path NOT LIKE ?
                `).get(
                    prefix,
                    deepPrefix
                ).count;
        }

        res.json({
            media: media,
            page: page,
            limit: limit,
            total: total,

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
 */
router.delete("/", async (req, res) => {
    try {
        const relativePath =
            req.query.path;

        if (!relativePath) {
            return res.status(400).json({
                error:
                    "Media path is required"
            });
        }

        const filePath =
            getSafeMediaPath(
                relativePath
            );

        const stat =
            await fs.stat(filePath);

        if (!stat.isFile()) {
            return res.status(400).json({
                error:
                    "Target is not a file"
            });
        }

        await fs.unlink(filePath);

        db.prepare(`
            DELETE FROM media
            WHERE path = ?
        `).run(
            relativePath
        );

        res.json({
            message:
                "Media deleted",

            path:
                relativePath
        });

    } catch (error) {
        console.error(error);

        if (error.code === "ENOENT") {
            return res.status(404).json({
                error:
                    "Media not found"
            });
        }

        res.status(500).json({
            error:
                "Failed to delete media"
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

        if (!validateMediaName(inputName)) {
            return res.status(400).json({
                error:
                    "Invalid file name"
            });
        }

        // 元ファイルの拡張子
        const oldExtension =
            getExtension(relativePath);

        // 入力された拡張子を除去
        const inputExtension =
            path.extname(inputName);

        const newBaseName =
            path.basename(
                inputName,
                inputExtension
            );

        // 元の拡張子を使用
        const newName =
            newBaseName +
            oldExtension;

        const oldPath =
            getSafeMediaPath(
                relativePath
            );

        const directory =
            path.dirname(oldPath);

        const newPath =
            path.join(
                directory,
                newName
            );

        // 新しい相対パス
        const relativeDirectory =
            path.dirname(relativePath);

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

        // 同名ファイル確認
        try {
            await fs.access(newPath);

            return res.status(409).json({
                error:
                    "同じ名前のファイルがすでに存在します。"
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

        // SQLite更新
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

        if (error.code === "ENOENT") {
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