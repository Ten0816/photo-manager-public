import {
    selectedMediaIds,
    selectMedia,
    clearSelectedMedia,
    isMediaSelected,
    isSelectionMode
} from "../state.js";

import {
    selectedMediaCount,
    bulkRenameMediaButton,
    bulkDeleteMediaButton,
    bulkMoveMediaButton,
    bulkDownloadMediaButton
} from "../dom.js";

import {
    showConfirm,
    showAlert,
    showPrompt
} from "../modal.js";

import {
    downloadSelectedMedia
} from "./mediaDownload.js";


// ============================================================
// 選択状態
// ============================================================

/**
 * 選択状態をUIへ反映
 */
export function updateMediaSelectionUI() {

    const count =
        selectedMediaIds.size;


    if (selectedMediaCount) {

        selectedMediaCount.textContent =
            count;
    }


    if (bulkDeleteMediaButton) {

        bulkDeleteMediaButton.disabled =
            count === 0;
    }


    if (bulkMoveMediaButton) {

        bulkMoveMediaButton.disabled =
            count === 0;
    }

    if (bulkDownloadMediaButton) {
        bulkDownloadMediaButton.disabled =
            count === 0;
    }
}


/**
 * 現在表示されているメディアの
 * 選択状態を更新
 */
export function refreshMediaSelectionUI() {

    document
        .querySelectorAll(
            ".media-item"
        )
        .forEach(item => {

            const media =
                item.mediaData;

            if (!media) {
                return;
            }


            const selected =
                isMediaSelected(
                    media.id
                );


            const checkbox =
                item.querySelector(
                    ".media-select-checkbox"
                );


            if (checkbox) {

    checkbox.hidden =
        !isSelectionMode;

    checkbox.checked =
        selected;

}


            item.classList.toggle(
                "is-selected",
                selected
            );
        });


    updateMediaSelectionUI();
}


// ============================================================
// 一括削除
// ============================================================

export async function bulkDeleteMedia() {

    const ids =
        Array.from(
            selectedMediaIds
        );


    if (ids.length === 0) {
        return;
    }


    const confirmed =
        await showConfirm(
            "ファイルをまとめて削除",
            `${ids.length}件のファイルをゴミ箱に移しますか？`,
            {
                type: "danger",
                confirmText: "ゴミ箱へ移動"
            }
        );


    if (!confirmed) {
        return;
    }


    try {

        bulkDeleteMediaButton.disabled =
            true;


        const response =
            await fetch(
                "/api/media/bulk-delete",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({
                        ids
                    })
                }
            );


        const data =
            await response.json();


        if (!response.ok) {

            throw new Error(
                data.error ||
                "Bulk delete failed"
            );
        }


        clearSelectedMedia();

        const {
            refreshMedia
        } = await import(
            "./media.js"
        );

        await refreshMedia();


        // media.jsから後で渡す
        // refreshMediaをここでは直接importしない


    } catch (error) {

        console.error(error);


        await showAlert(
            "一括削除に失敗しました",
            error.message,
            {
                type: "error"
            }
        );


    } finally {

        updateMediaSelectionUI();
    }
}


// ============================================================
// 一括名前変更
// ============================================================

export async function bulkRenameMedia() {

    const selectedCount =
        selectedMediaIds.size;


    if (selectedCount === 0) {
        return false;
    }


    // --------------------------------------------------------
    // 現在画面に表示されている順番で選択メディアを取得
    // --------------------------------------------------------

    const selectedMedia =
        Array.from(
            document.querySelectorAll(".media-item")
        )
            .map(item => item.mediaData)
            .filter(
                media =>
                    media &&
                    selectedMediaIds.has(media.id)
            );


    if (selectedMedia.length === 0) {
        return false;
    }


    // --------------------------------------------------------
    // 新しいベース名を入力
    // --------------------------------------------------------

    const baseName =
        await showPrompt(
            "ファイルを一括名前変更",
            "",
            "新しい名前を入力してください。\n例：2022"
        );


    if (baseName === null) {
        return false;
    }


    const trimmedBaseName =
        baseName.trim();


    if (!trimmedBaseName) {

        await showAlert(
            "名前を入力してください。",
            "",
            {
                type: "error"
            }
        );

        return false;
    }


    // --------------------------------------------------------
    // 確認
    // --------------------------------------------------------

    const confirmed =
        await showConfirm(
            "ファイルを一括名前変更",
            `${selectedCount}件のファイルを\n「${trimmedBaseName}_1」「${trimmedBaseName}_2」...に変更しますか？`
        );


    if (!confirmed) {
        return false;
    }


    try {

        if (bulkRenameMediaButton) {
            bulkRenameMediaButton.disabled = true;
        }


        // ----------------------------------------------------
        // 表示順のIDをそのままサーバーへ送る
        // ----------------------------------------------------

        const ids =
            selectedMedia.map(
                media => media.id
            );


        const response =
            await fetch(
                "/api/media/bulk-rename",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({
                        ids,
                        baseName:
                            trimmedBaseName
                    })
                }
            );


        const data =
            await response.json();


        if (!response.ok) {

            throw new Error(
                data.error ||
                "一括名前変更に失敗しました。"
            );
        }


        // ----------------------------------------------------
        // 選択状態を解除
        // ----------------------------------------------------

        clearSelectedMedia();


        // ----------------------------------------------------
        // メディア一覧を再読み込み
        // ----------------------------------------------------

        const {
            refreshMedia
        } = await import(
            "./media.js"
        );


        await refreshMedia();


        return true;


    } catch (error) {

        console.error(
            "Bulk rename failed:",
            error
        );


        await showAlert(
            "一括名前変更に失敗しました",
            error.message,
            {
                type: "error"
            }
        );


        return false;


    } finally {

        updateMediaSelectionUI();

    }
}


// ============================================================
// 一括移動
// ============================================================

export async function bulkMoveMedia() {

    const ids =
        Array.from(
            selectedMediaIds
        );


    if (ids.length === 0) {
        return;
    }


    const destination =
        await showPrompt(
            "ファイルを移動",
            "",
            "移動先のフォルダを入力してください。\n空欄でMemory直下へ移動します。"
        );


    if (destination === null) {
        return;
    }


    const trimmedDestination =
    destination.trim();


    try {

        bulkMoveMediaButton.disabled =
            true;


        const response =
            await fetch(
                "/api/media/bulk-move",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({
                        ids,
                        destination:
                            trimmedDestination
                    })
                }
            );


        const data =
            await response.json();


        if (!response.ok) {

            throw new Error(
                data.error ||
                "Bulk move failed"
            );
        }


        clearSelectedMedia();

        const {
            refreshMedia
        } = await import(
            "./media.js"
        );

        await refreshMedia();


    } catch (error) {

        console.error(error);


        await showAlert(
            "一括移動に失敗しました",
            error.message,
            {
                type: "error"
            }
        );


    } finally {

        updateMediaSelectionUI();
    }
}


// ============================================================
// 全選択
// ============================================================

export function selectAllVisibleMedia() {

    document
        .querySelectorAll(
            ".media-item"
        )
        .forEach(item => {

            const media =
                item.mediaData;

            if (!media) {
                return;
            }


            selectMedia(
                media.id
            );
        });


    refreshMediaSelectionUI();
}


// ============================================================
// 選択解除
// ============================================================

export function clearMediaSelection() {

    clearSelectedMedia();

    refreshMediaSelectionUI();
}