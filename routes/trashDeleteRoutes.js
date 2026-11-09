const express = require("express");
const fs = require("fs/promises");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const db = require("../database");

const {
  MEDIA_DIR,
  getSafeMediaPath,
  getTrashPath,
  getThumbnailPath
} = require("../utils/pathUtils");

const {
  getUniqueFilePath
} = require("../services/mediaService");

const { getTrashThumbnailFilePath, createTrashThumbnail, invalidateTrashThumbnail } = require("../services/thumbnailService");
const router = express.Router();

const execFileAsync =
  promisify(execFile);


/**
 * ゴミ箱内の相対パスを正規化
 *
 * DBの新形式:
 * 3211.jpg
 *
 * DBの旧形式:
 * .trash/3211.jpg
 */
function normalizeTrashRelativePath(
  trashRelativePath
) {
  if (
    trashRelativePath === ".trash"
  ) {
    return "";
  }

  if (
    trashRelativePath.startsWith(
      ".trash/"
    )
  ) {
    return trashRelativePath.substring(
      ".trash/".length
    );
  }

  return trashRelativePath;
}


/**
 * ゴミ箱ファイルの実体パスを取得
 */
function getTrashFilePath(
  trashRelativePath
) {
  const normalizedPath =
    normalizeTrashRelativePath(
      trashRelativePath
    );

  return getTrashPath(
    normalizedPath
  );
}


/**
 * ゴミ箱ファイル用サムネイルパスを取得
 *
 * 実体:
 * Memory/.thumbnails/.trash/3211.jpg
 */
function getTrashThumbnailPath(trashRelativePath) {
  return getTrashThumbnailFilePath(trashRelativePath);
}


/**
 * ゴミ箱一覧
 *
 * GET /api/trash
 */
router.delete(
  "/:id",
  async (req, res) => {

    const id =
      Number(req.params.id);

    if (!Number.isInteger(id)) {
      return res.status(400).json({
        error:
          "Invalid trash id"
      });
    }

    try {
      /*
       * DBから取得
       */
      const trashItem =
        db.prepare(`
          SELECT
            id,
            trash_path
          FROM trash
          WHERE id = ?
        `).get(id);

      if (!trashItem) {
        return res.status(404).json({
          error:
            "Trash item not found"
        });
      }

      const trashFilePath =
        getTrashFilePath(
          trashItem.trash_path
        );

      /*
       * ファイルを完全削除
       */
      try {
        await fs.unlink(
          trashFilePath
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
       * ゴミ箱サムネイルも削除
       */
      try {
        await invalidateTrashThumbnail(trashItem.trash_path);

      } catch (error) {
        if (
          error.code !==
          "ENOENT"
        ) {
          throw error;
        }
      }

      /*
       * DBから削除
       */
      db.prepare(`
        DELETE FROM trash
        WHERE id = ?
      `).run(id);

      res.json({
        message:
          "Media permanently deleted",

        id
      });

    } catch (error) {
      console.error(error);

      res.status(500).json({
        error:
          "Failed to permanently delete media"
      });
    }
  }
);


/**
 * ゴミ箱を空にする
 *
 * DELETE /api/trash
 */

router.delete(
  "/",
  async (req, res) => {

    try {
      const items =
        db.prepare(`
          SELECT
            id,
            trash_path
          FROM trash
        `).all();

      for (const item of items) {

        /*
         * ゴミ箱内のファイル
         */
        const trashFilePath =
          getTrashFilePath(
            item.trash_path
          );

        try {
          await fs.unlink(
            trashFilePath
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
         * ゴミ箱サムネイル
         */
        try {
          await invalidateTrashThumbnail(item.trash_path);

        } catch (error) {
          if (
            error.code !==
            "ENOENT"
          ) {
            throw error;
          }
        }
        // Mark each successfully deleted item immediately. If a later item
        // fails, the DB no longer refers to already-deleted earlier items.
        db.prepare(`DELETE FROM trash WHERE id = ?`).run(item.id);
      }

      res.json({
        message:
          "Trash emptied"
      });

    } catch (error) {
      console.error(error);

      res.status(500).json({
        error:
          "Failed to empty trash"
      });
    }
  }
);

module.exports = router;
