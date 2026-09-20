import {
    storageText,
    storageBarFill
} from "./dom.js";


/**
 * ストレージ使用量を取得して表示
 */
export async function loadStorage() {

    try {

        const response =
            await fetch(
                "/api/storage"
            );

        if (!response.ok) {
            throw new Error(
                "Failed to fetch storage"
            );
        }

        const data =
            await response.json();


        storageText.textContent =
            formatStorageText(
                data
            );


        storageBarFill.style.width =
            data.usagePercent + "%";


    } catch (error) {

        console.error(error);

        storageText.textContent =
            "ストレージ情報を取得できませんでした。";

        storageBarFill.style.width =
            "0%";
    }
}


/**
 * ストレージ情報を表示用文字列に変換
 */
function formatStorageText(data) {

    return (
        formatBytes(data.used) +
        " / " +
        formatBytes(data.total) +
        " 使用中　" +
        "空き容量: " +
        formatBytes(data.free)
    );
}


/**
 * バイトを読みやすい単位に変換
 */
export function formatBytes(bytes) {

    if (
        bytes === 0
    ) {
        return "0 B";
    }

    const units = [
        "B",
        "KB",
        "MB",
        "GB",
        "TB"
    ];

    const index =
        Math.floor(
            Math.log(bytes) /
            Math.log(1024)
        );

    const value =
        bytes /
        Math.pow(
            1024,
            index
        );

    return (
        value.toFixed(
            index >= 3 ? 1 : 0
        ) +
        " " +
        units[index]
    );
}