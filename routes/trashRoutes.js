const express = require("express");
const fs = require("fs/promises");
const path = require("path");

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

const router = express.Router();


/**
 * ゴミ箱一覧
 *
 * GET /api/trash
 */
router.get("/", (req, res) => {
  try {
    const trash =
      db.prepare(`
                SELECT
                    id,
                    original_path,
                    trash_path,
                    type,
                    file_size,
                    modified_at,
                    taken_at,
                    deleted_at
                FROM trash
                ORDER BY deleted_at DESC
            `).all();

    res.json({
      trash
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error:
        "Failed to fetch trash"
    });
  }
});


/**
 * ゴミ箱から復元
 *
 * POST /api/trash/:id/restore
 */
router.post(
  "/:id/restore",
  async (req, res) => {

    const id =
      Number(req.params.id);

    if (!Number.isInteger(id)) {
      return res.status(400).json({
        error:
          "Invalid trash id"
      });
    }

    let trashItem;

    try {
      /*
       * ゴミ箱DBから取得
       */
      trashItem =
        db.prepare(`
                    SELECT
                        id,
                        original_path,
                        trash_path,
                        type,
                        file_size,
                        modified_at,
                        taken_at
                    FROM trash
                    WHERE id = ?
                `).get(id);

      if (!trashItem) {
        return res.status(404).json({
          error:
            "Trash item not found"
        });
      }

      /*
       * ゴミ箱内のファイル
       */
      let trashRelativePath =
        trashItem.trash_path;

      /*
       * 旧形式:
       * .trash/3211.jpg
       *
       * 新形式:
       * 3211.jpg
       *
       * 旧形式のデータも復元できるようにする
       */
      if (
        trashRelativePath === ".trash"
      ) {
        trashRelativePath = "";
      } else if (
        trashRelativePath.startsWith(
          ".trash/"
        )
      ) {
        trashRelativePath =
          trashRelativePath.substring(
            ".trash/".length
          );
      }

      const trashFilePath =
        getTrashPath(
          trashRelativePath
        );

      await fs.stat(
        trashFilePath
      );

      /*
       * 本来の復元先
       */
      const originalFilePath =
        getSafeMediaPath(
          trashItem.original_path
        );

      /*
       * 復元先ディレクトリ
       */
      await fs.mkdir(
        path.dirname(
          originalFilePath
        ),
        {
          recursive: true
        }
      );

      /*
       * 同名ファイルが存在する場合、
       * 自動的に名前を変更する。
       */
      let finalFilePath =
        originalFilePath;

      try {
        await fs.access(
          finalFilePath
        );

        finalFilePath =
          await getUniqueFilePath(
            path.dirname(
              originalFilePath
            ),
            path.basename(
              originalFilePath
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
       * 実際に使用する相対パス
       */
      const finalRelativePath =
        path.relative(
          MEDIA_DIR,
          finalFilePath
        );

      /*
       * ファイルを復元
       */
      await fs.rename(
        trashFilePath,
        finalFilePath
      );

      try {
        /*
         * mediaへ戻す
         */
        const transaction =
          db.transaction(() => {

            db.prepare(`
                            INSERT INTO media (
                                path,
                                type,
                                file_size,
                                modified_at,
                                taken_at
                            )
                            VALUES (
                                ?,
                                ?,
                                ?,
                                ?,
                                ?
                            )
                        `).run(
              finalRelativePath,
              trashItem.type,
              trashItem.file_size,
              trashItem.modified_at,
              trashItem.taken_at
            );

            db.prepare(`
                            DELETE FROM trash
                            WHERE id = ?
                        `).run(id);
          });

        transaction();

      } catch (error) {
        /*
         * DB処理に失敗した場合、
         * ゴミ箱へ戻す
         */
        try {
          await fs.rename(
            finalFilePath,
            trashFilePath
          );
        } catch (
        rollbackError
        ) {
          console.error(
            "Failed to rollback restore:",
            rollbackError
          );
        }

        throw error;
      }

      res.json({
        message:
          "Media restored",

        path:
          finalRelativePath
      });

    } catch (error) {
      console.error(error);

      if (
        error.code ===
        "ENOENT"
      ) {
        return res.status(404).json({
          error:
            "Trash file not found"
        });
      }

      res.status(500).json({
        error:
          "Failed to restore media"
      });
    }
  }
);


/**
 * ゴミ箱から完全削除
 *
 * DELETE /api/trash/:id
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

      let trashRelativePath =
        trashItem.trash_path;

      /*
       * 旧形式:
       * .trash/3211.jpg
       *
       * 新形式:
       * 3211.jpg
       *
       * 旧形式のデータも復元できるようにする
       */
      if (
        trashRelativePath === ".trash"
      ) {
        trashRelativePath = "";
      } else if (
        trashRelativePath.startsWith(
          ".trash/"
        )
      ) {
        trashRelativePath =
          trashRelativePath.substring(
            ".trash/".length
          );
      }

      const trashFilePath =
        getTrashPath(
          trashRelativePath
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
        let trashRelativePath =
          trashItem.trash_path;

        /*
         * 旧形式:
         * .trash/3211.jpg
         *
         * 新形式:
         * 3211.jpg
         *
         * 旧形式のデータも復元できるようにする
         */
        if (
          trashRelativePath === ".trash"
        ) {
          trashRelativePath = "";
        } else if (
          trashRelativePath.startsWith(
            ".trash/"
          )
        ) {
          trashRelativePath =
            trashRelativePath.substring(
              ".trash/".length
            );
        }

        const trashFilePath =
          getTrashPath(
            trashRelativePath
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
      }

      db.prepare(`
                DELETE FROM trash
            `).run();

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