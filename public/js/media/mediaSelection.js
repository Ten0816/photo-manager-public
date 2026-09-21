import {
    selectedMediaIds,
    selectMedia,
    clearSelectedMedia,
    isMediaSelected
} from "../state.js";

import {
    selectedMediaCount,
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
            "移動先のフォルダを入力してください。\n例: 東京旅行"
        );


    if (destination === null) {
        return;
    }


    const trimmedDestination =
        destination.trim();


    if (!trimmedDestination) {

        await showAlert(
            "移動できません",
            "移動先フォルダを入力してください。",
            {
                type: "error"
            }
        );

        return;
    }


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