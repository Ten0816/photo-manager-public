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
    toggleSelectedMedia,
    clearSelectedMedia,
    selectMedia,
    isMediaSelected
} from "./state.js";

import {
    mediaList,

    mediaSortSelect,

    mediaSelectionButton,
    mediaSelectionToolbar,
    selectedMediaCount,
    selectAllMediaButton,
    clearMediaSelectionButton,
    bulkDeleteMediaButton,
    bulkMoveMediaButton
} from "./dom.js";

import { openViewer } from "./viewer.js";


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
            createMediaItem(media);
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
// メディアUI
// ============================================================

/**
 * メディア1件分のUIを作成
 */
export function createMediaItem(media) {
    const item =
        document.createElement("div");

    item.className = "media-item";
    item.mediaData = media;

    const preview =
        document.createElement("div");

    preview.className = "media-preview";

    const thumbnailUrl =
        "/api/thumbnail?path=" +
        encodeURIComponent(media.path);


    // --------------------------------------------------
    // 選択チェックボックス
    // --------------------------------------------------

    const checkbox =
        document.createElement("input");

    checkbox.type = "checkbox";
    checkbox.className =
        "media-select-checkbox";

    checkbox.checked =
        isMediaSelected(media.id);

    checkbox.addEventListener(
        "click",
        event => {
            event.stopPropagation();
        }
    );

    checkbox.addEventListener(
        "change",
        () => {
            toggleSelectedMedia(media.id);

            updateMediaItemSelection(item);

            updateMediaSelectionUI();
        }
    );

    item.appendChild(checkbox);


    // --------------------------------------------------
    // プレビュー
    // --------------------------------------------------

    if (media.type === "image") {
        createImagePreview(
            item,
            preview,
            media,
            thumbnailUrl
        );
    } else if (media.type === "video") {
        createVideoPreview(
            item,
            preview,
            media,
            thumbnailUrl
        );
    }


    // --------------------------------------------------
    // 名前
    // --------------------------------------------------

    const name =
        document.createElement("div");

    name.className = "media-name";
    name.textContent = media.path;


    // --------------------------------------------------
    // 名前変更
    // --------------------------------------------------

    const renameButton =
        document.createElement("button");

    renameButton.textContent =
        "名前変更";

    renameButton.addEventListener(
        "click",
        async event => {
            event.stopPropagation();

            if (isSelectionMode) {
                return;
            }

            await renameMedia(media);
        }
    );


    // --------------------------------------------------
    // 削除
    // --------------------------------------------------

    const deleteButton =
        document.createElement("button");

    deleteButton.textContent =
        "削除";

    deleteButton.addEventListener(
        "click",
        async event => {
            event.stopPropagation();

            if (isSelectionMode) {
                return;
            }

            await deleteMedia(
                media,
                item
            );
        }
    );


    item.appendChild(preview);
    item.appendChild(name);
    item.appendChild(renameButton);
    item.appendChild(deleteButton);

    updateMediaItemSelection(item);

    mediaList.appendChild(item);
}


/**
 * 画像プレビュー作成
 */
export function createImagePreview(
    item,
    preview,
    media,
    thumbnailUrl
) {
    const image =
        document.createElement("img");

    image.src = thumbnailUrl;
    image.alt = media.path;
    image.loading = "lazy";

    preview.appendChild(image);

    item.addEventListener(
        "click",
        () => {
            if (isSelectionMode) {
                toggleSelectedMedia(
                    media.id
                );

                updateMediaItemSelection(
                    item
                );

                updateMediaSelectionUI();

                return;
            }

            openViewer(media);
        }
    );
}


/**
 * 動画プレビュー作成
 */
export function createVideoPreview(
    item,
    preview,
    media,
    thumbnailUrl
) {
    const image =
        document.createElement("img");

    image.src = thumbnailUrl;
    image.alt = media.path;

    preview.appendChild(image);

    const playIcon =
        document.createElement("div");

    playIcon.className =
        "video-play-icon";

    playIcon.textContent = "▶";

    preview.appendChild(playIcon);

    item.addEventListener(
        "click",
        () => {
            if (isSelectionMode) {
                toggleSelectedMedia(
                    media.id
                );

                updateMediaItemSelection(
                    item
                );

                updateMediaSelectionUI();

                return;
            }

            openViewer(media);
        }
    );
}


// ============================================================
// メディア操作
// ============================================================

/**
 * メディア名前変更
 */
export async function renameMedia(media) {
    const currentName =
        media.path
            .split("/")
            .pop();

    const extension =
        "." +
        currentName
            .split(".")
            .pop();

    const baseName =
        currentName.substring(
            0,
            currentName.length -
            extension.length
        );

    const newBaseName =
        prompt(
            "新しいファイル名を入力してください。",
            baseName
        );

    if (
        !newBaseName ||
        newBaseName === baseName
    ) {
        return;
    }


    // ----------------------------
    // ファイル名チェック
    // ----------------------------

    if (
        newBaseName === "." ||
        newBaseName === ".." ||
        newBaseName.startsWith(".")
    ) {
        alert(
            "ファイル名が正しくありません。"
        );

        return;
    }

    if (
        newBaseName.includes("/") ||
        newBaseName.includes("\\")
    ) {
        alert(
            "ファイル名に / や \\ は使用できません。"
        );

        return;
    }


    const newName =
        newBaseName +
        extension;

    if (
        !newName ||
        newName === currentName
    ) {
        return;
    }


    // ----------------------------
    // API
    // ----------------------------

    try {
        const response = await fetch(
            "/api/media?path=" +
            encodeURIComponent(
                media.path
            ),
            {
                method: "PUT",

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body: JSON.stringify({
                    name: newName
                })
            }
        );

        const data =
            await response.json();

        if (!response.ok) {
            throw new Error(
                data.error ||
                "Failed to rename media"
            );
        }

        await refreshMedia();

    } catch (error) {
        console.error(error);

        alert(
            "ファイル名の変更に失敗しました。\n" +
            error.message
        );
    }
}


/**
 * メディア削除
 */
export async function deleteMedia(
    media,
    item
) {
    const confirmed =
        confirm(
            "「" +
            media.path +
            "」を削除しますか？"
        );

    if (!confirmed) {
        return;
    }

    try {
        const response =
            await fetch(
                "/api/media?path=" +
                encodeURIComponent(
                    media.path
                ),
                {
                    method: "DELETE"
                }
            );

        const data =
            await response.json();

        if (!response.ok) {
            throw new Error(
                data.error ||
                "Failed to delete media"
            );
        }

        item.remove();

    } catch (error) {
        console.error(error);

        alert(
            "ファイルの削除に失敗しました。\n" +
            error.message
        );
    }
}


// ============================================================
// 選択
// ============================================================

/**
 * 選択状態をUIへ反映
 */
function updateMediaItemSelection(item) {
    const media =
        item.mediaData;

    if (!media) return;

    const selected =
        isMediaSelected(media.id);

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
}


/**
 * 選択件数などのUIを更新
 */
function updateMediaSelectionUI() {
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
}


/**
 * 現在表示されているメディアの選択状態を更新
 */
function refreshMediaSelectionUI() {
    document
        .querySelectorAll(".media-item")
        .forEach(item => {
            updateMediaItemSelection(item);
        });

    updateMediaSelectionUI();
}


// ============================================================
// 一括削除
// ============================================================

async function bulkDeleteMedia() {
    const ids =
        Array.from(selectedMediaIds);

    if (ids.length === 0) {
        return;
    }

    const confirmed =
        confirm(
            `${ids.length}件のファイルをゴミ箱に移しますか？`
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

        await refreshMedia();

        updateMediaSelectionUI();

    } catch (error) {
        console.error(error);

        alert(
            "一括削除に失敗しました。\n" +
            error.message
        );

    } finally {
        updateMediaSelectionUI();
    }
}


// ============================================================
// 一括移動
// ============================================================

async function bulkMoveMedia() {
    const ids =
        Array.from(selectedMediaIds);

    if (ids.length === 0) {
        return;
    }

    const destination =
        prompt(
            "移動先のフォルダを入力してください。\n" +
            "例: 東京旅行"
        );

    if (destination === null) {
        return;
    }

    const trimmedDestination =
        destination.trim();

    if (!trimmedDestination) {
        alert(
            "移動先フォルダを入力してください。"
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

        await refreshMedia();

        updateMediaSelectionUI();

    } catch (error) {
        console.error(error);

        alert(
            "一括移動に失敗しました。\n" +
            error.message
        );

    } finally {
        updateMediaSelectionUI();
    }
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
            () => {

                document
                    .querySelectorAll(
                        ".media-item"
                    )
                    .forEach(item => {

                        const media =
                            item.mediaData;

                        if (!media) return;

                        selectMedia(
                            media.id
                        );
                    });

                refreshMediaSelectionUI();
            }
        );
    }


    // ----------------------------
    // 選択解除
    // ----------------------------

    if (clearMediaSelectionButton) {
        clearMediaSelectionButton.addEventListener(
            "click",
            () => {

                clearSelectedMedia();

                refreshMediaSelectionUI();
            }
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