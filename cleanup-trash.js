const fs = require("fs/promises");
const path = require("path");

const db = require("./database");

const {
    MEDIA_DIR,
    getTrashPath,
    getThumbnailPath
} = require("./utils/pathUtils");


const RETENTION_DAYS =
    Number(
        process.env.TRASH_RETENTION_DAYS || 30
    );


if (
    !Number.isInteger(RETENTION_DAYS) ||
    RETENTION_DAYS < 1
) {
    console.error(
        "Invalid TRASH_RETENTION_DAYS:",
        RETENTION_DAYS
    );

    process.exit(1);
}


const threshold =
    Date.now() -
    RETENTION_DAYS *
    24 *
    60 *
    60 *
    1000;


/**
 * ゴミ箱内の相対パスを正規化
 */
function normalizeTrashRelativePath(
    trashRelativePath
) {
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
 * ゴミ箱ファイルの実体パス
 */
function getTrashFilePath(
    trashRelativePath
) {
    return getTrashPath(
        normalizeTrashRelativePath(
            trashRelativePath
        )
    );
}


/**
 * ゴミ箱サムネイルの実体パス
 */
function getTrashThumbnailPath(
    trashRelativePath
) {
    return getThumbnailPath(
        path.join(
            ".trash",
            normalizeTrashRelativePath(
                trashRelativePath
            )
        )
    );
}


async function cleanupTrash() {

    const items =
        db.prepare(`
            SELECT
                id,
                trash_path,
                deleted_at
            FROM trash
            WHERE deleted_at < ?
            ORDER BY deleted_at ASC
        `).all(threshold);


    console.log(
        `Found ${items.length} expired trash item(s).`
    );


    for (const item of items) {

        console.log(
            "Deleting:",
            item.trash_path
        );


        /*
         * ゴミ箱内の実ファイル
         */
        try {

            await fs.unlink(
                getTrashFilePath(
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


        /*
         * DBから削除
         */
        db.prepare(`
            DELETE FROM trash
            WHERE id = ?
        `).run(item.id);
    }


    console.log(
        `Deleted ${items.length} expired trash item(s).`
    );
}


cleanupTrash()
    .catch(error => {

        console.error(
            "Trash cleanup failed:",
            error
        );

        process.exit(1);
    });