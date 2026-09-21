import {
    normalView,
    trashView,
    trashButton,
    backFromTrashButton,
    trashList,
    emptyTrashButton
} from "./dom.js";

import {
    refreshMedia
} from "./media/media.js";

import {
    showConfirm,
    showAlert
} from "./modal.js";

/**
 * ゴミ箱一覧を取得
 */
export async function loadTrash() {
    try {
        const response =
            await fetch("/api/trash");

        if (!response.ok) {
            throw new Error(
                "Failed to fetch trash"
            );
        }

        const data =
            await response.json();

        trashList.innerHTML = "";

        for (const item of data.trash) {
            createTrashItem(item);
        }

        updateEmptyTrashButton(
            data.trash.length
        );

    } catch (error) {
        console.error(error);

        await showAlert(
            "ゴミ箱を読み込めませんでした",
            error.message,
            {
                type: "error"
            }
        );
    }
}


/**
 * ゴミ箱アイテムを作成
 */
function createTrashItem(trashItem) {
    const item =
        document.createElement("div");

    item.className =
        "media-item trash-item";


    /*
     * プレビュー
     */
    const preview =
        document.createElement("div");

    preview.className =
        "media-preview";


    /*
     * ゴミ箱専用サムネイルAPI
     */
    const thumbnailUrl =
        "/api/trash/" +
        trashItem.id +
        "/thumbnail";


    const image =
        document.createElement("img");

    image.src =
        thumbnailUrl;

    image.alt =
        trashItem.original_path;

    image.loading =
        "lazy";

    preview.appendChild(
        image
    );


    /*
     * ファイル名
     */
    const name =
        document.createElement("div");

    name.className =
        "media-name";

    name.textContent =
        trashItem.original_path;


    /*
     * 削除日時
     */
    const deletedAt =
        document.createElement("div");

    deletedAt.className =
        "trash-deleted-at";

    deletedAt.textContent =
        formatDeletedAt(
            trashItem.deleted_at
        );


    /*
     * 復元ボタン
     */
    const restoreButton =
        document.createElement("button");

    restoreButton.textContent =
        "復元";

    restoreButton.addEventListener(
        "click",
        async (event) => {
            event.stopPropagation();

            await restoreTrashItem(
                trashItem
            );
        }
    );


    /*
     * 完全削除ボタン
     */
    const deleteButton =
        document.createElement("button");

    deleteButton.textContent =
        "完全削除";

    deleteButton.addEventListener(
        "click",
        async (event) => {
            event.stopPropagation();

            await permanentlyDelete(
                trashItem
            );
        }
    );


    /*
     * DOMへ追加
     */
    item.appendChild(
        preview
    );

    item.appendChild(
        name
    );

    item.appendChild(
        deletedAt
    );

    item.appendChild(
        restoreButton
    );

    item.appendChild(
        deleteButton
    );

    trashList.appendChild(
        item
    );
}


/**
 * ゴミ箱から復元
 */
async function restoreTrashItem(
    trashItem
) {
    const confirmed =
        await showConfirm(
            "ファイルを復元",
            "「" +
            trashItem.original_path +
            "」を復元しますか？",
            {
                confirmText: "復元"
            }
        );

    if (!confirmed) {
        return;
    }

    try {
        const response =
            await fetch(
                "/api/trash/" +
                trashItem.id +
                "/restore",
                {
                    method: "POST"
                }
            );

        const data =
            await response.json();

        if (!response.ok) {
            throw new Error(
                data.error ||
                "Failed to restore media"
            );
        }

        await loadTrash();

        await showAlert(
            "ファイルを復元しました",
            "ファイルを元の場所に戻しました。"
        );

    } catch (error) {
        console.error(error);

        await showAlert(
            "ファイルを復元できませんでした",
            error.message,
            {
                type: "error"
            }
        );
    }
}


/**
 * 完全削除
 */
async function permanentlyDelete(
    trashItem
) {
    const confirmed =
        await showConfirm(
            "ファイルを完全に削除",
            "「" +
            trashItem.original_path +
            "」を完全に削除しますか？\n\n" +
            "この操作は元に戻せません。",
            {
                type: "danger",
                confirmText: "完全に削除"
            }
        );

    if (!confirmed) {
        return;
    }

    try {
        const response =
            await fetch(
                "/api/trash/" +
                trashItem.id,
                {
                    method: "DELETE"
                }
            );

        const data =
            await response.json();

        if (!response.ok) {
            throw new Error(
                data.error ||
                "Failed to permanently delete media"
            );
        }

        await loadTrash();

    } catch (error) {
        console.error(error);

        await showAlert(
            "ファイルを完全に削除できませんでした",
            error.message,
            {
                type: "error"
            }
        );
    }
}


/**
 * ゴミ箱を空にする
 */
async function emptyTrash() {
    const confirmed =
        await showConfirm(
            "ゴミ箱を空にする",
            "ゴミ箱内のすべてのファイルを完全に削除しますか？\n\n" +
            "この操作は元に戻せません。",
            {
                type: "danger",
                confirmText: "すべて削除"
            }
        );

    if (!confirmed) {
        return;
    }

    try {
        const response =
            await fetch(
                "/api/trash",
                {
                    method: "DELETE"
                }
            );

        const data =
            await response.json();

        if (!response.ok) {
            throw new Error(
                data.error ||
                "Failed to empty trash"
            );
        }

        await loadTrash();

    } catch (error) {
        console.error(error);

        await showAlert(
            "ゴミ箱を空にできませんでした",
            error.message,
            {
                type: "error"
            }
        );
    }
}


/**
 * ゴミ箱を開く
 */
async function openTrash() {
    normalView.style.display =
        "none";

    trashView.style.display =
        "block";

    await loadTrash();
}


/**
 * ゴミ箱を閉じる
 */
async function closeTrash() {
    trashView.style.display =
        "none";

    normalView.style.display =
        "block";

    await refreshMedia();
}


/**
 * ゴミ箱が空かどうかによって
 * 「ゴミ箱を空にする」ボタンを制御
 */
function updateEmptyTrashButton(
    count
) {
    emptyTrashButton.disabled =
        count === 0;
}


/**
 * 削除日時を表示用に変換
 */
function formatDeletedAt(
    timestamp
) {
    if (!timestamp) {
        return "";
    }

    const date =
        new Date(timestamp);

    return (
        "削除日時: " +
        date.toLocaleString(
            "ja-JP"
        )
    );
}


/**
 * ゴミ箱イベント初期化
 */
export function initTrash() {
    trashButton.addEventListener(
        "click",
        openTrash
    );

    backFromTrashButton.addEventListener(
        "click",
        closeTrash
    );

    emptyTrashButton.addEventListener(
        "click",
        emptyTrash
    );


    /*
     * 初期状態ではゴミ箱を隠す
     */
    trashView.style.display =
        "none";
}