const fs = require("fs/promises");
const path = require("path");
const exifr = require("exifr");

const db = require("./database");

const MEDIA_DIR = "/mnt/photo-hdd/Memory";

async function scanDirectory(directory) {
    const entries = await fs.readdir(directory, {
        withFileTypes: true
    });

    const files = [];

    for (const entry of entries) {
        const fullPath = path.join(directory, entry.name);

        // thumbnailsフォルダはメディアとして扱わない
        if (
            entry.isDirectory() &&
            entry.name === "thumbnails"
        ) {
            continue;
        }

        if (entry.isDirectory()) {
            const childFiles = await scanDirectory(fullPath);
            files.push(...childFiles);
            continue;
        }

        if (!isMediaFile(entry.name)) {
            continue;
        }

        const stat = await fs.stat(fullPath);
        const relativePath = path.relative(MEDIA_DIR, fullPath);
        const type = getMediaType(entry.name);

        let takenAt = null;
        let latitude = null;
        let longitude = null;

        // 画像の場合のみEXIFを取得
        if (type === "image") {
            try {
                const exif = await exifr.parse(fullPath);

                if (exif) {
                    const date =
                        exif.DateTimeOriginal ??
                        exif.CreateDate ??
                        null;

                    if (date instanceof Date) {
                        takenAt = date.toISOString();
                    } else if (date !== null) {
                        takenAt = String(date);
                    }

                    latitude = exif.latitude ?? null;
                    longitude = exif.longitude ?? null;
                }

                if (exif) {
                    const date =
                        exif.DateTimeOriginal ??
                        exif.CreateDate ??
                        null;

                    if (date instanceof Date) {
                        takenAt = date.toISOString();
                    } else if (date !== null) {
                        takenAt = String(date);
                    }

                    latitude = exif.latitude ?? null;
                    longitude = exif.longitude ?? null;
                }
            } catch (error) {
                console.warn(
                    "EXIFの読み込みに失敗しました: " +
                    relativePath
                );
                console.warn(error.message);
            }
        }

        files.push({
            path: relativePath,
            type: type,
            fileSize: stat.size,
            modifiedAt: Math.floor(stat.mtimeMs),
            takenAt: takenAt,
            latitude: latitude,
            longitude: longitude
        });
    }

    return files;
}

function isMediaFile(fileName) {
    const extension = path.extname(fileName).toLowerCase();

    return (
        extension === ".jpg" ||
        extension === ".jpeg" ||
        extension === ".png" ||
        extension === ".webp" ||
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

async function main() {
    console.log("メディア同期を開始します...");

    const files = await scanDirectory(MEDIA_DIR);

    console.log(
        "HDD上で " + files.length + " 件のメディアを確認しました。"
    );

    const transaction = db.transaction((files) => {
        let inserted = 0;
        let updated = 0;
        let deleted = 0;

        const existingFiles = db.prepare(`
            SELECT
                id,
                path,
                type,
                file_size,
                modified_at,
                taken_at,
                latitude,
                longitude
            FROM media
        `).all();

        const existingMap = new Map();

        for (const file of existingFiles) {
            existingMap.set(file.path, file);
        }

        const upsert = db.prepare(`
            INSERT INTO media (
                path,
                type,
                file_size,
                modified_at,
                taken_at,
                latitude,
                longitude
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(path) DO UPDATE SET
                type = excluded.type,
                file_size = excluded.file_size,
                modified_at = excluded.modified_at,
                taken_at = excluded.taken_at,
                latitude = excluded.latitude,
                longitude = excluded.longitude
        `);

        for (const file of files) {
            const existing = existingMap.get(file.path);

            if (!existing) {
                upsert.run(
                    file.path,
                    file.type,
                    file.fileSize,
                    file.modifiedAt,
                    file.takenAt,
                    file.latitude,
                    file.longitude
                );

                inserted++;
                existingMap.delete(file.path);
                continue;
            }

            if (
                existing.type !== file.type ||
                existing.file_size !== file.fileSize ||
                existing.modified_at !== file.modifiedAt ||
                existing.taken_at !== file.takenAt ||
                existing.latitude !== file.latitude ||
                existing.longitude !== file.longitude
            ) {
                upsert.run(
                    file.path,
                    file.type,
                    file.fileSize,
                    file.modifiedAt,
                    file.takenAt,
                    file.latitude,
                    file.longitude
                );

                updated++;
            }

            existingMap.delete(file.path);
        }

        const deleteMedia = db.prepare(`
            DELETE FROM media
            WHERE path = ?
        `);

        for (const [filePath] of existingMap) {
            deleteMedia.run(filePath);
            deleted++;
        }

        return {
            inserted: inserted,
            updated: updated,
            deleted: deleted
        };
    });

    const result = transaction(files);

    console.log("SQLiteの同期が完了しました。");
    console.log("追加: " + result.inserted + " 件");
    console.log("更新: " + result.updated + " 件");
    console.log("削除: " + result.deleted + " 件");
}

main().catch((error) => {
    console.error("メディア同期中にエラーが発生しました。");
    console.error(error);
});