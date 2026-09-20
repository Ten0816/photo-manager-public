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
function getTrashThumbnailPath(
  trashRelativePath
) {
  const normalizedPath =
    normalizeTrashRelativePath(
      trashRelativePath
    );

  return getThumbnailPath(
    path.join(
      ".trash",
      normalizedPath
    )
  );
}


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
 * ゴミ箱サムネイル
 *
 * GET /api/trash/:id/thumbnail
 */
router.get(
  "/:id/thumbnail",
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
       * ゴミ箱DBから取得
       */
      const trashItem =
        db.prepare(`
          SELECT
            id,
            trash_path,
            type
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
       * ゴミ箱内の実ファイル
       */
      const trashFilePath =
        getTrashFilePath(
          trashItem.trash_path
        );

      /*
       * ファイルが存在するか確認
       */
      await fs.access(
        trashFilePath
      );

      /*
       * サムネイル保存先
       */
      const thumbnailPath =
        getTrashThumbnailPath(
          trashItem.trash_path
        );

      /*
       * サムネイルディレクトリ作成
       */
      await fs.mkdir(
        path.dirname(
          thumbnailPath
        ),
        {
          recursive: true
        }
      );

      /*
       * 既存サムネイルがあれば使用
       */
      try {
        await fs.access(
          thumbnailPath
        );

      } catch {
        /*
         * サムネイル生成
         */
        console.log(
          "Creating trash thumbnail:",
          trashFilePath
        );

        await execFileAsync(
          "ffmpeg",
          [
            "-y",
            "-i",
            trashFilePath,
            "-frames:v",
            "1",
            "-vf",
            "scale='min(400,iw)':-1",
            "-q:v",
            "5",
            "-update",
            "1",
            thumbnailPath
          ]
        );
      }

      /*
       * JPEGとして返す
       */
      res.type("image/jpeg");

      const thumbnail =
        await fs.readFile(
          thumbnailPath
        );

      res.send(
        thumbnail
      );

    } catch (error) {
      console.error(
        "Trash thumbnail error:",
        error
      );

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
          "Failed to create trash thumbnail"
      });
    }
  }
);


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
      const trashFilePath =
        getTrashFilePath(
          trashItem.trash_path
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

      /*
       * ゴミ箱サムネイルを削除
       *
       * 復元後は通常のサムネイルを
       * 必要になった時に再生成する。
       */
      try {
        await fs.unlink(
          getTrashThumbnailPath(
            trashItem.trash_path
          )
        );

      } catch (error) {
        if (
          error.code !==
          "ENOENT"
        ) {
          console.error(
            "Failed to delete trash thumbnail:",
            error
          );
        }
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
        await fs.unlink(
          getTrashThumbnailPath(
            trashItem.trash_path
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
          await fs.unlink(
            getTrashThumbnailPath(
              item.trash_path
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
      }

      /*
       * DBからすべて削除
       */
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