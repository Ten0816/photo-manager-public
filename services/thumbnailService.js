const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const {
    MEDIA_DIR,
    THUMBNAIL_DIR,
    getSafeMediaPath,
    getThumbnailPath
} = require("../utils/pathUtils");

const execFileAsync =
    promisify(execFile);

async function ensureThumbnailDir() {
    await fs.promises.mkdir(
        THUMBNAIL_DIR,
        {
            recursive: true
        }
    );
}

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
function getThumbnailFilePath(relativePath) {
    const parsed =
        path.parse(relativePath);

    const thumbnailRelativePath =
        path.join(
            parsed.dir,
            parsed.name + ".jpg"
        );

    return getThumbnailPath(
        thumbnailRelativePath
    );
}

async function createThumbnail(relativePath) {
    await ensureThumbnailDir();

    const sourcePath =
        getSafeMediaPath(
            relativePath
        );

    const thumbnailPath =
        getThumbnailFilePath(
            relativePath
        );

    await fs.promises.mkdir(
        path.dirname(thumbnailPath),
        {
            recursive: true
        }
    );

    // 既に存在する場合は再生成しない
    try {
        await fs.promises.access(
            thumbnailPath
        );

        console.log(
            "Thumbnail exists:",
            thumbnailPath
        );

        return thumbnailPath;

    } catch {
        // サムネイルが存在しないので生成
    }

    console.log(
        "Creating thumbnail:",
        sourcePath
    );

    console.log(
        "Thumbnail path:",
        thumbnailPath
    );

    await execFileAsync("ffmpeg", [
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
    ]);

    console.log(
        "Thumbnail created:",
        thumbnailPath
    );

    return thumbnailPath;
}

module.exports = {
    ensureThumbnailDir,
    createThumbnail,
    getThumbnailPath: getThumbnailFilePath
};