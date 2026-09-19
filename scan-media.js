const fs = require("fs/promises");
const path = require("path");
const exifr = require("exifr");

const db = require("./database");

const MEDIA_DIR = process.env.MEDIA_DIR || "/data/Memory";

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

        // 画像の場合のみEXIFを取得
        if (type === "image") {
            try {
                const exif = await exifr.parse(fullPath);

                if (exif) {
                    const date =
                        exif.DateTimeOriginal ??
                        exif.CreateDate ??
                        null;

                    const offset =
                        exif.OffsetTimeOriginal ??
                        exif.OffsetTimeDigitized ??
                        null;

                    takenAt = parseExifDate(date, offset);
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
            takenAt: takenAt
        });
    }

    return files;
}

/**
 * EXIFの撮影日時をISO 8601形式へ変換する。
 *
 * 例:
 * DateTimeOriginal  = 2026:09:19 17:34:55
 * OffsetTimeOriginal = +09:00
 *
 * ↓
 *
 * 2026-09-19T08:34:55.000Z
 *
 * これを表示側でJSTへ変換すると
 * 2026-09-19 17:34:55 になる。
 */
function parseExifDate(date, offset) {
    if (date === null || date === undefined) {
        return null;
    }

    /*
     * exifrはDateTimeOriginalをDateとして返す場合がある。
     *
     * ただし今回のファイルでは、
     *
     * EXIF:
     *   DateTimeOriginal   = 2026:09:19 17:34:55
     *   OffsetTimeOriginal = +09:00
     *
     * に対して、
     *
     * exifr:
     *   Date = 2026-09-19T17:34:55.000Z
     *
     * と返している。
     *
     * これは「17:34:55 JST」を「17:34:55 UTC」として
     * 扱っている状態なので、Offset分を引いてUTCに変換する。
     */
    if (date instanceof Date) {
        if (Number.isNaN(date.getTime())) {
            return null;
        }

        if (offset) {
            const match = String(offset).match(
                /^([+-])(\d{2}):?(\d{2})$/
            );

            if (match) {
                const sign = match[1] === "+" ? 1 : -1;
                const hours = Number(match[2]);
                const minutes = Number(match[3]);

                const offsetMinutes =
                    sign * (hours * 60 + minutes);

                const correctedTime =
                    date.getTime() -
                    offsetMinutes * 60 * 1000;

                return new Date(correctedTime).toISOString();
            }
        }

        return date.toISOString();
    }

    if (typeof date !== "string") {
        return null;
    }

    /*
     * EXIFの日時形式:
     *
     * 2026:09:19 17:34:55
     */
    const match = date.match(
        /^(\d{4}):(\d{2}):(\d{2})[ ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/
    );

    if (!match) {
        return null;
    }

    const [
        ,
        year,
        month,
        day,
        hour,
        minute,
        second,
        fraction
    ] = match;

    const milliseconds = fraction
        ? Number(("0." + fraction) * 1000)
        : 0;

    const localTime = Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second),
        milliseconds
    );

    let offsetMinutes = 0;

    if (offset) {
        const offsetMatch = String(offset).match(
            /^([+-])(\d{2}):?(\d{2})$/
        );

        if (offsetMatch) {
            const sign =
                offsetMatch[1] === "+" ? 1 : -1;

            offsetMinutes =
                sign *
                (
                    Number(offsetMatch[2]) * 60 +
                    Number(offsetMatch[3])
                );
        }
    }

    return new Date(
        localTime - offsetMinutes * 60 * 1000
    ).toISOString();
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
                taken_at
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
                taken_at
            )
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(path) DO UPDATE SET
                type = excluded.type,
                file_size = excluded.file_size,
                modified_at = excluded.modified_at,
                taken_at = excluded.taken_at
        `);

        for (const file of files) {
            const existing = existingMap.get(file.path);

            if (!existing) {
                upsert.run(
                    file.path,
                    file.type,
                    file.fileSize,
                    file.modifiedAt,
                    file.takenAt
                );

                inserted++;
                existingMap.delete(file.path);
                continue;
            }

            if (
                existing.type !== file.type ||
                existing.file_size !== file.fileSize ||
                existing.modified_at !== file.modifiedAt ||
                existing.taken_at !== file.takenAt
            ) {
                upsert.run(
                    file.path,
                    file.type,
                    file.fileSize,
                    file.modifiedAt,
                    file.takenAt
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