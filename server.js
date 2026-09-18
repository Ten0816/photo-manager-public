const express = require("express");
const crypto = require("crypto");
const multer = require("multer");
const sharp = require("sharp");
const fs = require("fs/promises");
const path = require("path");
const db = require("./database");
const os = require("os");
const fsSync = require("fs");

const UPLOAD_TEMP_DIR = path.join(
    os.tmpdir(),
    "photo-manager-uploads"
);

fsSync.mkdirSync(UPLOAD_TEMP_DIR, {
    recursive: true
});

const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

const app = express();
const PORT = 3000;

const MEDIA_DIR = "/mnt/photo-hdd/Memory";
const THUMBNAIL_DIR = "/mnt/photo-hdd/Memory/thumbnails";

function getSafeMediaPath(relativePath) {
    const mediaRoot = path.resolve(MEDIA_DIR);
    const targetPath = path.resolve(MEDIA_DIR, relativePath || "");

    if (
        targetPath !== mediaRoot &&
        !targetPath.startsWith(mediaRoot + path.sep)
    ) {
        throw new Error("Invalid path");
    }

    return targetPath;
}

const storage = multer.diskStorage({
    destination: (req, file, callback) => {
        callback(null, UPLOAD_TEMP_DIR);
    },

    filename: (req, file, callback) => {
        callback(null, file.originalname);
    }
});

const upload = multer({
    storage: storage,

    limits: {
        fileSize: 10 * 1024 * 1024 * 1024
    },

    fileFilter: (req, file, callback) => {
        const extension =
            path.extname(file.originalname).toLowerCase();

        const allowedExtensions = [
            ".jpg",
            ".jpeg",
            ".png",
            ".webp",
            ".mp4",
            ".mov",
            ".avi",
            ".mkv",
            ".webm"
        ];

        if (!allowedExtensions.includes(extension)) {
            return callback(
                new Error("Unsupported file type")
            );
        }

        callback(null, true);
    }
});

app.use(express.static("public"));
app.use(express.json());
app.use("/media", express.static(MEDIA_DIR));

app.get("/", (req, res) => {
    res.send("Photo Manager Server is running!");
});

app.get("/api/folders", async (req, res) => {
    try {
        const relativePath = req.query.path || "";
        const directory = getSafeMediaPath(relativePath);

        const entries = await fs.readdir(directory, {
            withFileTypes: true
        });

        const folders = [];

        for (const entry of entries) {
            if (!entry.isDirectory()) {
                continue;
            }

            if (entry.name === "thumbnails") {
                continue;
            }

            folders.push({
                name: entry.name,
                path: path.join(relativePath, entry.name)
            });
        }

        folders.sort((a, b) => {
            return a.name.localeCompare(b.name, undefined, {
                numeric: true
            });
        });

        res.json({
            path: relativePath,
            folders: folders
        });
    } catch (error) {
        console.error(error);

        res.status(500).json({
            error: "Failed to read folders"
        });
    }
});

app.post("/api/folders", async (req, res) => {
    try {
        const relativePath = req.query.path || "";
        const folderName = req.body.name;

        if (!folderName) {
            return res.status(400).json({
                error: "Folder name is required"
            });
        }

        if (
            folderName.includes("/") ||
            folderName.includes("\\") ||
            folderName === "." ||
            folderName === ".."
        ) {
            return res.status(400).json({
                error: "Invalid folder name"
            });
        }

        const parentDirectory = getSafeMediaPath(relativePath);
        const folderPath = path.join(parentDirectory, folderName);

        await fs.mkdir(folderPath);

        res.json({
            message: "Folder created",
            name: folderName,
            path: path.join(relativePath, folderName)
        });
    } catch (error) {
        console.error(error);

        res.status(500).json({
            error: "Failed to create folder"
        });
    }
});

app.delete("/api/folders", async (req, res) => {
    try {
        const relativePath = req.query.path || "";

        if (!relativePath) {
            return res.status(400).json({
                error: "Cannot delete root folder"
            });
        }

        const folderPath =
            getSafeMediaPath(relativePath);

        const entries = await fs.readdir(
            folderPath,
            {
                withFileTypes: true
            }
        );

        if (entries.length > 0) {
            return res.status(409).json({
                error: "フォルダが空ではありません。"
            });
        }

        await fs.rmdir(folderPath);

        res.json({
            message: "Folder deleted",
            path: relativePath
        });

    } catch (error) {
        console.error(error);

        if (error.code === "ENOENT") {
            return res.status(404).json({
                error: "Folder not found"
            });
        }

        res.status(500).json({
            error: "Failed to delete folder"
        });
    }
});

app.delete("/api/media", async (req, res) => {
    try {
        const relativePath = req.query.path;

        if (!relativePath) {
            return res.status(400).json({
                error: "Media path is required"
            });
        }

        const filePath =
            getSafeMediaPath(relativePath);

        const stat = await fs.stat(filePath);

        if (!stat.isFile()) {
            return res.status(400).json({
                error: "Target is not a file"
            });
        }

        await fs.unlink(filePath);

        db.prepare(`
            DELETE FROM media
            WHERE path = ?
        `).run(relativePath);

        res.json({
            message: "Media deleted",
            path: relativePath
        });

    } catch (error) {
        console.error(error);

        if (error.code === "ENOENT") {
            return res.status(404).json({
                error: "Media not found"
            });
        }

        res.status(500).json({
            error: "Failed to delete media"
        });
    }
});

app.put("/api/media", async (req, res) => {
    try {
        const relativePath = req.query.path;

        if (!relativePath) {
            return res.status(400).json({
                error: "Media path is required"
            });
        }

        const inputName = req.body.name;

        if (!inputName) {
            return res.status(400).json({
                error: "File name is required"
            });
        }

        // 元ファイルの拡張子を取得
        const oldExtension =
            path.extname(relativePath).toLowerCase();

        // 入力された名前から拡張子を除去
        const newBaseName =
            path.basename(
                inputName,
                path.extname(inputName)
            );

        if (!newBaseName) {
            return res.status(400).json({
                error: "File name is required"
            });
        }

        // 元の拡張子を強制的に付ける
        const newName =
            newBaseName + oldExtension;

        if (
            newName.includes("/") ||
            newName.includes("\\") ||
            newName === "." ||
            newName === ".."
        ) {
            return res.status(400).json({
                error: "Invalid file name"
            });
        }

        const oldPath =
            getSafeMediaPath(relativePath);

        const directory =
            path.dirname(oldPath);

        const newPath =
            path.join(directory, newName);

        // 新しいファイル名を含むパスが安全か確認
        const relativeDirectory =
            path.dirname(relativePath);

        const newRelativePath =
            path.join(
                relativeDirectory === "."
                    ? ""
                    : relativeDirectory,
                newName
            );

        getSafeMediaPath(newRelativePath);

        // 同名ファイルが存在するか確認
        try {
            await fs.access(newPath);

            return res.status(409).json({
                error: "同じ名前のファイルがすでに存在します。"
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
        db.prepare(`
            UPDATE media
            SET path = ?
            WHERE path = ?
        `).run(
            newRelativePath,
            relativePath
        );

        res.json({
            message: "Media renamed",
            oldPath: relativePath,
            newPath: newRelativePath
        });

    } catch (error) {
        console.error(error);

        if (error.code === "ENOENT") {
            return res.status(404).json({
                error: "Media not found"
            });
        }

        res.status(500).json({
            error: "Failed to rename media"
        });
    }
});

app.put("/api/folders", async (req, res) => {
    try {
        const relativePath = req.query.path || "";
        const newName = req.body.name;

        if (!relativePath) {
            return res.status(400).json({
                error: "Cannot rename root folder"
            });
        }

        if (!newName) {
            return res.status(400).json({
                error: "Folder name is required"
            });
        }

        if (
            newName.includes("/") ||
            newName.includes("\\") ||
            newName === "." ||
            newName === ".."
        ) {
            return res.status(400).json({
                error: "Invalid folder name"
            });
        }

        const oldPath =
            getSafeMediaPath(relativePath);

        const parentPath =
            path.dirname(oldPath);

        const newPath =
            path.join(parentPath, newName);

        // 新しいパスも安全か確認
        const relativeParent =
            path.dirname(relativePath);

        const newRelativePath =
            path.join(
                relativeParent === "." ? "" : relativeParent,
                newName
            );

        getSafeMediaPath(newRelativePath);

        // 同名フォルダが存在するか確認
        try {
            await fs.access(newPath);

            return res.status(409).json({
                error: "同じ名前のフォルダがすでに存在します。"
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
        const oldPrefix = relativePath + "/";
        const newPrefix = newRelativePath + "/";

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
            message: "Folder renamed",
            oldPath: relativePath,
            newPath: newRelativePath
        });

    } catch (error) {
        console.error(error);

        if (error.code === "ENOENT") {
            return res.status(404).json({
                error: "Folder not found"
            });
        }

        res.status(500).json({
            error: "Failed to rename folder"
        });
    }
});

app.post("/api/upload", (req, res) => {
    upload.array("files")(req, res, async (error) => {
        if (error) {

            if (error.code === "LIMIT_FILE_SIZE") {
                return res.status(413).json({
                    error: "ファイルサイズが大きすぎます。1ファイル10GBまでです。"
                });
            }

            if (error.message === "Unsupported file type") {
                return res.status(400).json({
                    error: "対応していないファイル形式です。"
                });
            }

            console.error(error);

            return res.status(500).json({
                error: "Upload failed"
            });
        }

        try {
            if (!req.files || req.files.length === 0) {
                return res.status(400).json({
                    error: "No files uploaded"
                });
            }

            const relativePath = req.query.path || "";
            const directory = getSafeMediaPath(relativePath);

            await fs.mkdir(directory, {
                recursive: true
            });

            const uploadedFiles = [];

            const registerMedia = db.prepare(`
                INSERT INTO media (
                    path,
                    type,
                    file_size,
                    modified_at
                )
                VALUES (?, ?, ?, ?)
                ON CONFLICT(path) DO UPDATE SET
                    type = excluded.type,
                    file_size = excluded.file_size,
                    modified_at = excluded.modified_at
            `);

            for (const file of req.files) {
                const temporaryPath = file.path;

                const destinationPath =
                    await getUniqueFilePath(
                        directory,
                        file.originalname
                    );

                await fs.copyFile(
                    temporaryPath,
                    destinationPath
                );

                await fs.unlink(
                    temporaryPath
                );

                const stat = await fs.stat(
                    destinationPath
                );

                const savedFileName =
                    path.basename(destinationPath);

                const mediaPath = path.join(
                    relativePath,
                    savedFileName
                );

                const mediaType = getMediaType(
                    savedFileName
                );

                registerMedia.run(
                    mediaPath,
                    mediaType,
                    stat.size,
                    Math.floor(stat.mtimeMs)
                );

                uploadedFiles.push(mediaPath);
            }

            console.log(
                uploadedFiles.length +
                " 件のファイルを " +
                (relativePath || "Memory") +
                " にアップロードしました。"
            );

            res.json({
                message: "Upload completed",
                count: uploadedFiles.length,
                files: uploadedFiles
            });

        } catch (error) {
            console.error(error);

            res.status(500).json({
                error: "Upload failed"
            });
        }
    });
});

app.get("/api/media", async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 100;
        const relativePath = req.query.path || "";

        if (page < 1 || limit < 1) {
            return res.status(400).json({
                error: "Invalid page or limit"
            });
        }

        // パスが安全か確認
        getSafeMediaPath(relativePath);

        const offset = (page - 1) * limit;

        let media;
        let total;

        if (relativePath === "") {
            // ルートフォルダ
            // 「/」を含まないパスだけ取得
            media = db.prepare(`
                SELECT
                    id,
                    path,
                    type,
                    file_size,
                    modified_at
                FROM media
                WHERE instr(path, '/') = 0
                ORDER BY path
                LIMIT ? OFFSET ?
            `).all(limit, offset);

            total = db.prepare(`
                SELECT COUNT(*) AS count
                FROM media
                WHERE instr(path, '/') = 0
            `).get().count;

        } else {
            // 現在のフォルダ直下だけ取得
            const prefix = relativePath + "/%";
            const deepPrefix = relativePath + "/%/%";

            media = db.prepare(`
                SELECT
                    id,
                    path,
                    type,
                    file_size,
                    modified_at
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

            total = db.prepare(`
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
            hasMore: offset + media.length < total
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            error: "Failed to fetch media"
        });
    }
});

app.get("/api/thumbnail", async (req, res) => {
    try {
        const relativePath = req.query.path;

        if (!relativePath) {
            return res.status(400).send("Path is required");
        }

        const mediaRoot = path.resolve(MEDIA_DIR);
        const mediaPath = path.resolve(MEDIA_DIR, relativePath);

        // Memoryフォルダの外にアクセスされるのを防ぐ
        if (
            mediaPath !== mediaRoot &&
            !mediaPath.startsWith(mediaRoot + path.sep)
        ) {
            return res.status(403).send("Invalid path");
        }

        const extension = path.extname(relativePath).toLowerCase();

        const imageExtensions = [
            ".jpg",
            ".jpeg",
            ".png",
            ".webp"
        ];

        const videoExtensions = [
            ".mp4",
            ".mov",
            ".avi",
            ".mkv",
            ".webm"
        ];

        if (
            !imageExtensions.includes(extension) &&
            !videoExtensions.includes(extension)
        ) {
            return res.status(400).send("Unsupported media type");
        }

        // サムネイル用フォルダを作成
        await fs.mkdir(THUMBNAIL_DIR, {
            recursive: true
        });

        // ファイルパスから安全なサムネイル名を作る
        const hash = crypto
            .createHash("sha256")
            .update(relativePath)
            .digest("hex");

        const thumbnailPath = path.join(
            THUMBNAIL_DIR,
            hash + ".jpg"
        );

        // すでにサムネイルがある場合
        try {
            await fs.access(thumbnailPath);

            return res.sendFile(thumbnailPath);
        } catch {
            // サムネイルがなければ作成する
        }

        // -------------------------
        // 画像
        // -------------------------
        if (imageExtensions.includes(extension)) {
            await sharp(mediaPath)
                .resize({
                    width: 400,
                    height: 400,
                    fit: "cover"
                })
                .jpeg({
                    quality: 80
                })
                .toFile(thumbnailPath);
        }

        // -------------------------
        // 動画
        // -------------------------
        else if (videoExtensions.includes(extension)) {
            await execFileAsync("ffmpeg", [
                "-ss",
                "00:00:01",
                "-i",
                mediaPath,
                "-frames:v",
                "1",
                "-vf",
                "scale=400:-1",
                "-y",
                thumbnailPath
            ]);
        }

        res.sendFile(thumbnailPath);

    } catch (error) {
        console.error(error);

        res.status(500).send("Failed to create thumbnail");
    }
});

async function getMediaFiles(directory) {
    const entries = await fs.readdir(directory, {
        withFileTypes: true
    });

    const media = [];

    for (const entry of entries) {
        const fullPath = path.join(directory, entry.name);

        if (entry.isDirectory()) {
            const childMedia = await getMediaFiles(fullPath);
            media.push(...childMedia);
            continue;
        }

        if (isMediaFile(entry.name)) {
            const relativePath = path.relative(MEDIA_DIR, fullPath);

            media.push({
                path: relativePath,
                type: getMediaType(entry.name)
            });
        }
    }

    return media;
}

function isMediaFile(fileName) {
    const extension = path.extname(fileName).toLowerCase();

    return (
        // 画像
        extension === ".jpg" ||
        extension === ".jpeg" ||
        extension === ".png" ||
        extension === ".webp" ||

        // 動画
        extension === ".mp4" ||
        extension === ".mov" ||
        extension === ".avi" ||
        extension === ".mkv" ||
        extension === ".webm"
    );
}

function getMediaType(fileName) {
    const extension = path.extname(fileName).toLowerCase();

    if (
        extension === ".jpg" ||
        extension === ".jpeg" ||
        extension === ".png" ||
        extension === ".webp"
    ) {
        return "image";
    }

    return "video";
}

async function getUniqueFilePath(directory, fileName) {
    const extension = path.extname(fileName);
    const baseName = path.basename(fileName, extension);

    let filePath = path.join(directory, fileName);
    let counter = 1;

    while (true) {
        try {
            await fs.access(filePath);

            filePath = path.join(
                directory,
                baseName + " (" + counter + ")" + extension
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

app.listen(PORT, () => {
    console.log("Server is running on port " + PORT);
});