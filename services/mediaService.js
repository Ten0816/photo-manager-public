const fs = require("fs/promises");
const path = require("path");

const IMAGE_EXTENSIONS = [
    ".jpg",
    ".jpeg",
    ".png",
    ".webp"
];

const VIDEO_EXTENSIONS = [
    ".mp4",
    ".mov",
    ".avi",
    ".mkv",
    ".webm"
];

const MEDIA_EXTENSIONS = [
    ...IMAGE_EXTENSIONS,
    ...VIDEO_EXTENSIONS
];

/**
 * ファイル名から拡張子を取得
 */
function getExtension(fileName) {
    return path.extname(fileName).toLowerCase();
}

/**
 * メディアファイルか判定
 */
function isMediaFile(fileName) {
    const extension =
        getExtension(fileName);

    return MEDIA_EXTENSIONS.includes(
        extension
    );
}

/**
 * メディアの種類を取得
 */
function getMediaType(fileName) {
    const extension =
        getExtension(fileName);

    if (
        IMAGE_EXTENSIONS.includes(extension)
    ) {
        return "image";
    }

    return "video";
}

/**
 * ファイル名が安全か確認
 */
function validateMediaName(inputName) {
    if (!inputName) {
        return false;
    }

    if (
        inputName.includes("/") ||
        inputName.includes("\\")
    ) {
        return false;
    }

    if (
        inputName === "." ||
        inputName === ".."
    ) {
        return false;
    }

    const inputExtension =
        path.extname(inputName);

    const baseName =
        path.basename(
            inputName,
            inputExtension
        );

    if (!baseName) {
        return false;
    }

    if (
        baseName === "." ||
        baseName === ".."
    ) {
        return false;
    }

    if (baseName.startsWith(".")) {
        return false;
    }

    return true;
}

/**
 * 重複しないファイルパスを取得
 *
 * test.jpg
 * test (1).jpg
 * test (2).jpg
 * ...
 */
async function getUniqueFilePath(
    directory,
    fileName
) {
    const extension =
        path.extname(fileName);

    const baseName =
        path.basename(
            fileName,
            extension
        );

    let filePath =
        path.join(
            directory,
            fileName
        );

    let counter = 1;

    while (true) {
        try {
            await fs.access(filePath);

            filePath =
                path.join(
                    directory,
                    baseName +
                    " (" +
                    counter +
                    ")" +
                    extension
                );

            counter++;

        } catch (error) {
            if (error.code === "ENOENT") {
                return filePath;
            }

            throw error;
        }
    }
}

module.exports = {
    IMAGE_EXTENSIONS,
    VIDEO_EXTENSIONS,
    MEDIA_EXTENSIONS,
    getExtension,
    isMediaFile,
    getMediaType,
    validateMediaName,
    getUniqueFilePath
};