const express = require("express");
const path = require("path");

const db = require("../database");

const {
    getSafeMediaPath
} = require("../utils/pathUtils");

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
            req.query.page === undefined ? 1 : Number(req.query.page);

        const limit =
            req.query.limit === undefined ? 100 : Number(req.query.limit);

        const relativePath =
            req.query.path || "";

        const sort =
            req.query.sort || "name-asc";


        // ----------------------------
        // パラメータ検証
        // ----------------------------

        if (
            !Number.isSafeInteger(page) ||
            !Number.isSafeInteger(limit) ||
            page < 1 ||
            limit < 1 ||
            limit > 200
        ) {
            return res.status(400).json({
                error: "Invalid page or limit"
            });
        }

        getSafeMediaPath(relativePath);


        if (
            sort !== "name-asc" &&
            sort !== "name-desc"
        ) {
            return res.status(400).json({
                error: "Invalid sort option"
            });
        }


        // ----------------------------
// メディア取得・自然順ソート
// ----------------------------

const order =
    sort === "name-desc"
        ? "DESC"
        : "ASC";

let media;

if (relativePath === "") {

    // ルートフォルダ

    media = db.prepare(`
        SELECT
            id,
            path,
            type,
            file_size,
            modified_at,
            taken_at
        FROM media
        WHERE instr(path, '/') = 0
    `).all();

} else {

    // サブフォルダ

    const prefix = relativePath + "/";
    media = db.prepare(`
        SELECT
            id,
            path,
            type,
            file_size,
            modified_at,
            taken_at
        FROM media
        WHERE substr(path, 1, ?) = ?
          AND instr(substr(path, ?), '/') = 0
    `).all(
        prefix.length,
        prefix,
        prefix.length + 1
    );
}


// ----------------------------
// 自然順ソート
// ----------------------------

media.sort((a, b) => {
    const nameA = path.basename(a.path);
    const nameB = path.basename(b.path);

    const result = nameA.localeCompare(
        nameB,
        undefined,
        {
            numeric: true,
            sensitivity: "base"
        }
    );

    return sort === "name-desc"
        ? -result
        : result;
});


        // ----------------------------
        // ページネーション
        // ----------------------------

        const total =
            media.length;

        const offset =
            (page - 1) * limit;

        const paginatedMedia =
            media.slice(
                offset,
                offset + limit
            );


        // ----------------------------
        // レスポンス
        // ----------------------------

        res.json({

            media: paginatedMedia,

            page,

            limit,

            total,

            sort,

            hasMore:
                offset + paginatedMedia.length < total

        });


    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: "Failed to fetch media"
        });

    }

});


module.exports = router;
