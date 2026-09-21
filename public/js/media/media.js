import {
    currentFolder,
    currentPage,
    pageSize,
    isLoading,
    hasMore,
    mediaSort,
    isSelectionMode,
    selectedMediaIds,

    setIsLoading,
    setHasMore,
    nextPage,
    resetMediaState,

    setMediaSort,

    setSelectionMode,
    clearSelectedMedia
} from "../state.js";

import {
    mediaList,
    mediaSortSelect,
    mediaSelectionButton,
    mediaSelectionToolbar,
    selectAllMediaButton,
    clearMediaSelectionButton,
    bulkDeleteMediaButton,
    bulkMoveMediaButton,
    bulkDownloadMediaButton
} from "../dom.js";

import {
    showPrompt,
    showConfirm,
    showAlert
} from "../modal.js";

import {
    createMediaItem,
    updateMediaItemSelection
} from "./mediaItem.js";

import {
    updateMediaSelectionUI,
    refreshMediaSelectionUI,
    bulkDeleteMedia,
    bulkMoveMedia,
    selectAllVisibleMedia,
    clearMediaSelection
} from "./mediaSelection.js";

import {
    downloadSelectedMedia
} from "./mediaDownload.js";


// ============================================================
// メディア一覧
// ============================================================

/**
 * メディア一覧を追加読み込み
 */
export async function loadMedia() {
    if (isLoading || !hasMore) return;

    setIsLoading(true);

    try {
        const response = await fetch(
            "/api/media?path=" +
            encodeURIComponent(currentFolder) +
            "&page=" +
            currentPage +
            "&limit=" +
            pageSize +
            "&sort=" +
            encodeURIComponent(mediaSort)
        );

        if (!response.ok) {
            throw new Error(
                "Failed to fetch media list"
            );
        }

        const data = await response.json();

        for (const media of data.media) {
            const item =
                createMediaItem(media);

            mediaList.appendChild(item);
        }

        if (!data.hasMore) {
            setHasMore(false);
        } else {
            nextPage();
        }
    } catch (error) {
        console.error(error);
    } finally {
        setIsLoading(false);
    }
}


/**
 * メディア一覧を最初から読み直す
 */
export async function refreshMedia() {
    mediaList.innerHTML = "";

    resetMediaState();

    await loadMedia();
}


// ============================================================
// イベント
// ============================================================

export function initMediaEvents() {

    // ----------------------------
    // ソート変更
    // ----------------------------

    if (mediaSortSelect) {
        mediaSortSelect.addEventListener(
            "change",
            async () => {

                setMediaSort(
                    mediaSortSelect.value
                );

                clearSelectedMedia();

                refreshMediaSelectionUI();

                await refreshMedia();
            }
        );
    }


    // ----------------------------
    // 選択モード
    // ----------------------------

    if (mediaSelectionButton) {
        mediaSelectionButton.addEventListener(
            "click",
            () => {

                const nextMode =
                    !isSelectionMode;

                setSelectionMode(
                    nextMode
                );

                mediaSelectionToolbar.hidden =
                    !nextMode;

                mediaSelectionButton.textContent =
                    nextMode
                        ? "✕ 選択終了"
                        : "☑ 選択";

                refreshMediaSelectionUI();
            }
        );
    }


    // ----------------------------
    // すべて選択
    // ----------------------------

    if (selectAllMediaButton) {
        selectAllMediaButton.addEventListener(
            "click",
            selectAllVisibleMedia
        );
    }


    // ----------------------------
    // 選択解除
    // ----------------------------

    if (clearMediaSelectionButton) {
        clearMediaSelectionButton.addEventListener(
            "click",
            clearMediaSelection
        );
    }


    // ----------------------------
    // 一括削除
    // ----------------------------

    if (bulkDeleteMediaButton) {
        bulkDeleteMediaButton.addEventListener(
            "click",
            bulkDeleteMedia
        );
    }


    // ----------------------------
    // 一括移動
    // ----------------------------

    if (bulkMoveMediaButton) {
        bulkMoveMediaButton.addEventListener(
            "click",
            bulkMoveMedia
        );
    }

    bulkDownloadMediaButton.addEventListener(
        "click",
        async () => {
            const selectedMedia =
                Array.from(
                    document.querySelectorAll(
                        ".media-item"
                    )
                )
                    .map(item => item.mediaData)
                    .filter(
                        media =>
                            media &&
                            selectedMediaIds.has(
                                media.id
                            )
                    );

            await downloadSelectedMedia(
                selectedMedia
            );
        }
    );


    // ----------------------------
    // 無限スクロール
    // ----------------------------

    window.addEventListener(
        "scroll",
        () => {

            const scrollPosition =
                window.innerHeight +
                window.scrollY;

            const pageHeight =
                document.documentElement
                    .scrollHeight;

            if (
                scrollPosition >=
                pageHeight - 1000
            ) {
                loadMedia();
            }
        }
    );
}