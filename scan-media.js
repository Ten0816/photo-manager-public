const fs = require("fs/promises");
const path = require("path");
const exifr = require("exifr");

const db = require("./database");
const { assertStorageAvailable } = require("./utils/storageSafety");

const MEDIA_DIR =
    process.env.MEDIA_DIR || "/data/Memory";


/**
 * ディレクトリを再帰的にスキャンする。
 *
 * 既存DBに保存されている撮影日時を優先し、
 * 新規ファイルについてはEXIFから撮影日時を取得する。
 */
async function scanDirectory(
    directory,
    existingMap
) {
    const entries =
        await fs.readdir(
            directory,
            {
                withFileTypes: true
            }
        );

    const files = [];

    for (const entry of entries) {

        const fullPath =
            path.join(
                directory,
                entry.name
            );


        // ----------------------------
        // アプリ内部フォルダはスキャンしない
        // ----------------------------

        if (
            entry.isDirectory() &&
            (
                entry.name === ".thumbnails" ||
                entry.name === ".trash" ||
                entry.name === ".incoming"
            )
        ) {
            continue;
        }


        // ----------------------------
        // サブディレクトリ
        // ----------------------------

        if (entry.isDirectory()) {

            const childFiles =
                await scanDirectory(
                    fullPath,
                    existingMap
                );

            files.push(
                ...childFiles
            );

            continue;
        }


        if (!entry.isFile()) continue; // symlinks / special files are ignored

        // ----------------------------
        // メディアファイル以外は無視
        // ----------------------------

        if (!isMediaFile(entry.name)) {
            continue;
        }


        // ----------------------------
        // ファイル情報取得
        // ----------------------------

        const stat =
            await fs.stat(
                fullPath
            );

        const relativePath =
            path.relative(
                MEDIA_DIR,
                fullPath
            );

        const type =
            getMediaType(
                entry.name
            );

        const fileSize =
            stat.size;

        const modifiedAt =
            Math.floor(
                stat.mtimeMs
            );


        // ----------------------------
        // 既存DBデータを確認
        // ----------------------------

        const existing =
            existingMap.get(
                relativePath
            );


        let takenAt = null;


        // ========================================================
        // 撮影日時を決定
        // ========================================================

        /*
         * 優先順位
         *
         * 1. 既存DBに撮影日時がある
         * 2. EXIFの撮影日時
         * 3. ファイルの更新日時
         *
         * EXIFを読み込めない場合でも、
         * taken_at がNULLのままになることを防ぐ。
         */


        // ----------------------------
        // ① 既存DBの撮影日時を優先
        // ----------------------------

        if (
            existing &&
            existing.taken_at &&
            existing.file_size === fileSize &&
            existing.modified_at === modifiedAt
        ) {

            takenAt =
                existing.taken_at;
        }


        // ----------------------------
        // ② DBに撮影日時がない場合
        //    EXIFを解析
        // ----------------------------

        if (!takenAt && type === "image") {

            try {

                const exif =
                    await exifr.parse(
                        fullPath
                    );

                if (exif) {

                    const date =
                        exif.DateTimeOriginal ??
                        exif.CreateDate ??
                        null;

                    const offset =
                        exif.OffsetTimeOriginal ??
                        exif.OffsetTimeDigitized ??
                        null;

                    takenAt =
                        parseExifDate(
                            date,
                            offset
                        );
                }

            } catch (error) {

                console.warn(
                    "EXIFの読み込みに失敗しました: " +
                    relativePath
                );

                console.warn(
                    error.message
                );
            }
        }


        // ----------------------------
        // ③ EXIFからも取得できなかった場合
        //    ファイルの更新日時を使用
        // ----------------------------

        if (!takenAt) {

            takenAt =
                new Date(
                    modifiedAt
                ).toISOString();
        }


        // ----------------------------
        // 同期対象へ追加
        // ----------------------------

        files.push({
            path:
                relativePath,

            type:
                type,

            fileSize:
                fileSize,

            modifiedAt:
                modifiedAt,

            takenAt:
                takenAt
        });
    }

    return files;
}


/**
 * EXIFの撮影日時をISO 8601形式へ変換する。
 *
 * 例:
 * DateTimeOriginal   = 2026:09:19 17:34:55
 * OffsetTimeOriginal = +09:00
 *
 * ↓
 *
 * 2026-09-19T08:34:55.000Z
 */
function parseExifDate(
    date,
    offset
) {

    if (
        date === null ||
        date === undefined
    ) {
        return null;
    }


    /*
     * exifrはDateTimeOriginalを
     * Dateとして返す場合がある。
     */

    if (date instanceof Date) {

        if (
            Number.isNaN(
                date.getTime()
            )
        ) {
            return null;
        }


        if (offset) {

            const match =
                String(offset).match(
                    /^([+-])(\d{2}):?(\d{2})$/
                );

            if (match) {

                const sign =
                    match[1] === "+"
                        ? 1
                        : -1;

                const hours =
                    Number(match[2]);

                const minutes =
                    Number(match[3]);

                const offsetMinutes =
                    sign *
                    (
                        hours * 60 +
                        minutes
                    );

                const correctedTime =
                    date.getTime() -
                    offsetMinutes *
                    60 *
                    1000;

                return new Date(
                    correctedTime
                ).toISOString();
            }
        }

        return date.toISOString();
    }


    if (
        typeof date !== "string"
    ) {
        return null;
    }


    /*
     * EXIFの日時形式:
     *
     * 2026:09:19 17:34:55
     */

    const match =
        date.match(
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


    const milliseconds =
        fraction
            ? Number(
                "0." + fraction
            ) * 1000
            : 0;


    const localTime =
        Date.UTC(
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

        const offsetMatch =
            String(offset).match(
                /^([+-])(\d{2}):?(\d{2})$/
            );

        if (offsetMatch) {

            const sign =
                offsetMatch[1] === "+"
                    ? 1
                    : -1;

            offsetMinutes =
                sign *
                (
                    Number(offsetMatch[2]) *
                    60 +
                    Number(offsetMatch[3])
                );
        }
    }


    return new Date(
        localTime -
        offsetMinutes *
        60 *
        1000
    ).toISOString();
}


/**
 * 対応するメディアファイルか判定する。
 */
function isMediaFile(
    fileName
) {

    const extension =
        path.extname(
            fileName
        ).toLowerCase();

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


/**
 * メディアの種類を取得する。
 */
function getMediaType(
    fileName
) {

    const extension =
        path.extname(
            fileName
        ).toLowerCase();

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


/**
 * メディア情報をスキャンし、SQLiteと同期する。
 */
async function main() {

    await assertStorageAvailable();

    console.log(
        "メディア同期を開始します..."
    );


    // ----------------------------
    // DBに登録されている情報を取得
    // ----------------------------

    const existingFiles =
        db.prepare(`
            SELECT
                id,
                path,
                type,
                file_size,
                modified_at,
                taken_at
            FROM media
        `).all();


    const existingMap =
        new Map();

    for (
        const file of existingFiles
    ) {

        existingMap.set(
            file.path,
            file
        );
    }


    // ----------------------------
    // HDDをスキャン
    // ----------------------------

    const files =
        await scanDirectory(
            MEDIA_DIR,
            existingMap
        );


    console.log(
        "HDD上で " +
        files.length +
        " 件のメディアを確認しました。"
    );


    // ========================================================
    // 同期前の安全チェック
    // ========================================================


    // ----------------------------
    // ① スキャン結果が0件なら中止
    // ----------------------------

    /*
     * DBに既存データがあるのに
     * スキャン結果が0件の場合、
     * HDDのマウント異常などが考えられる。
     *
     * この状態で同期すると、DBのデータが
     * すべて削除される可能性があるため中止する。
     */

    if (
        existingFiles.length > 0 &&
        files.length === 0
    ) {

        throw new Error(
            "メディアが0件です。" +
            "DBの削除を防ぐため、同期を中止しました。"
        );
    }


    // ----------------------------
    // ② 大量削除の防止
    // ----------------------------

    /*
     * DBに登録済みのメディアが20件以上ある場合、
     * スキャン結果が20%以上減少していれば中止する。
     *
     * 大量のファイルを意図的に削除する場合は、
     * この判定に引っかかる可能性がある。
     */

    const MIN_EXISTING_MEDIA_COUNT = 20;

    const MAX_DECREASE_RATIO = 0.2;


    if (
        existingFiles.length >= MIN_EXISTING_MEDIA_COUNT
    ) {

        const decreaseRatio =
            (
                existingFiles.length -
                files.length
            ) / existingFiles.length;


        if (
            decreaseRatio >= MAX_DECREASE_RATIO
        ) {

            throw new Error(
                "メディア件数が大幅に減少しています。" +
                ` DB: ${existingFiles.length} 件、` +
                `スキャン結果: ${files.length} 件。` +
                "DBの変更を中止しました。"
            );
        }
    }


    // ========================================================
    // SQLiteを同期
    // ========================================================

    const transaction =
        db.transaction(
            (
                files,
                existingFiles
            ) => {

                let inserted = 0;

                let updated = 0;

                let deleted = 0;


                const existingMap =
                    new Map();

                for (
                    const file of existingFiles
                ) {

                    existingMap.set(
                        file.path,
                        file
                    );
                }


                // ----------------------------
                // INSERT / UPDATE用SQL
                // ----------------------------

                const upsert =
                    db.prepare(`
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


                // ----------------------------
                // スキャン結果をDBに反映
                // ----------------------------

                for (
                    const file of files
                ) {

                    const existing =
                        existingMap.get(
                            file.path
                        );


                    // 新規ファイル

                    if (!existing) {

                        upsert.run(
                            file.path,
                            file.type,
                            file.fileSize,
                            file.modifiedAt,
                            file.takenAt
                        );

                        inserted++;

                        existingMap.delete(
                            file.path
                        );

                        continue;
                    }


                    // 既存ファイルの情報に変更がある場合

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


                    existingMap.delete(
                        file.path
                    );
                }


                // ----------------------------
                // DBにだけ存在するファイルを削除
                // ----------------------------

                const deleteMedia =
                    db.prepare(`
                        DELETE FROM media
                        WHERE path = ?
                    `);


                for (
                    const [filePath]
                    of existingMap
                ) {

                    deleteMedia.run(
                        filePath
                    );

                    deleted++;
                }


                return {
                    inserted:
                        inserted,

                    updated:
                        updated,

                    deleted:
                        deleted
                };
            }
        );


    // Verify the HDD is still mounted before a DB-changing sync.
    await assertStorageAvailable();

    // トランザクションを実行

    const result =
        transaction(
            files,
            existingFiles
        );


    // ----------------------------
    // 同期結果を表示
    // ----------------------------

    console.log(
        "SQLiteの同期が完了しました。"
    );

    console.log(
        "追加: " +
        result.inserted +
        " 件"
    );

    console.log(
        "更新: " +
        result.updated +
        " 件"
    );

    console.log(
        "削除: " +
        result.deleted +
        " 件"
    );
}


// ========================================================
// エラーハンドリング
// ========================================================

main().catch(
    (error) => {

        console.error(
            "メディア同期中にエラーが発生しました。"
        );

        console.error(
            error
        );

        // Dockerなどから異常終了を検知できるようにする
        process.exitCode = 1;
    }
);