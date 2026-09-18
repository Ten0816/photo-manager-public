const express = require("express");
const crypto = require("crypto");
const multer = require("multer");
const sharp = require("sharp");
const fs = require("fs/promises");
const path = require("path");
const db = require("./database");

const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

const app = express();
const PORT = 3000;

const MEDIA_DIR = "/mnt/photo-hdd/Memory";
const THUMBNAIL_DIR = "/mnt/photo-hdd/Memory/thumbnails";
const storage = multer.diskStorage({
    destination: (req, file, callback) => {
        callback(null, MEDIA_DIR);
    },

    filename: (req, file, callback) => {
        callback(null, file.originalname);
    }
});

const upload = multer({
    storage: storage
});

app.use(express.static("public"));
app.use("/media", express.static(MEDIA_DIR));

app.get("/", (req, res) => {
    res.send("Photo Manager Server is running!");
});

app.post("/api/upload", upload.array("files"), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({
                error: "No files uploaded"
            });
        }

        console.log(
            req.files.length + " 件のファイルをアップロードしました。"
        );

        res.json({
            message: "Upload completed",
            count: req.files.length
        });
    } catch (error) {
        console.error(error);

        res.status(500).json({
            error: "Upload failed"
        });
    }
});

app.get("/api/media", (req, res) => {
    try {
        const page = Number.parseInt(req.query.page) || 1;
        const limit = Number.parseInt(req.query.limit) || 100;

        const offset = (page - 1) * limit;

        const media = db.prepare(`
            SELECT
                id,
                path,
                type,
                file_size,
                modified_at
            FROM media
            ORDER BY id
            LIMIT ? OFFSET ?
        `).all(limit, offset);

        res.json({
            media: media,
            page: page,
            limit: limit
        });
    } catch (error) {
        console.error(error);

        res.status(500).json({
            error: "Failed to read media database"
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

app.listen(PORT, () => {
    console.log("Server is running on port " + PORT);
});