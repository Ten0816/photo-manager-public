const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const {
    getSafeMediaPath,
    getThumbnailPath
} = require("../utils/pathUtils");

const execFileAsync =
    promisify(execFile);


/**
 * サムネイルのパスを取得
 *
 * 元ファイル:
 *   2026/photo.jpg
 *   2026/movie.mp4
 *
 * サムネイル:
 *   2026/photo.jpg
 *   2026/movie.jpg
 */
function getThumbnailFilePath(
    relativePath
) {

    const parsed =
        path.parse(
            relativePath
        );


    const thumbnailRelativePath =
        path.join(
            parsed.dir,
            parsed.name + ".jpg"
        );


    return getThumbnailPath(
        thumbnailRelativePath
    );
}


async function createThumbnail(
    relativePath
) {

    // ----------------------------
    // 元ファイルの安全性を確認
    // ----------------------------

    const sourcePath =
        getSafeMediaPath(
            relativePath
        );


    // ----------------------------
    // サムネイルのパスを取得
    // ----------------------------

    const thumbnailPath =
        getThumbnailFilePath(
            relativePath
        );


    // ----------------------------
    // 既存サムネイルを確認
    // ----------------------------

    try {

        await fs.promises.access(
            thumbnailPath
        );

        return thumbnailPath;

    } catch {
        // サムネイルが存在しないので生成
    }


    // ----------------------------
    // サムネイル保存先を作成
    // ----------------------------

    await fs.promises.mkdir(
        path.dirname(
            thumbnailPath
        ),
        {
            recursive: true
        }
    );


    // ----------------------------
    // サムネイル生成
    // ----------------------------

    await execFileAsync(
        "ffmpeg",
        [
            "-y",

            "-i",
            sourcePath,

            // 動画の場合は最初のフレームを使用
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


    return thumbnailPath;
}


module.exports = {
    createThumbnail,
    getThumbnailPath:
        getThumbnailFilePath
};