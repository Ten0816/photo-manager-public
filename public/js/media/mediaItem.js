import {
    isSelectionMode,
    toggleSelectedMedia,
    isMediaSelected
} from "../state.js";

import {
    updateMediaSelectionUI
} from "./mediaSelection.js";

import {
    openViewer
} from "../viewer.js";


// ============================================================
// メディア1件分のUI
// ============================================================

/**
 * メディア1件分のUIを作成
 */
export function createMediaItem(media) {

    const item =
        document.createElement("div");

    item.className =
        "media-item";

    item.mediaData =
        media;


    const preview =
        document.createElement("div");

    preview.className =
        "media-preview";


    const thumbnailUrl =
        "/api/thumbnail?path=" +
        encodeURIComponent(
            media.path
        );


    // --------------------------------------------------
    // 選択チェックボックス
    // --------------------------------------------------

    const checkbox =
        document.createElement("input");

    checkbox.type =
        "checkbox";

    checkbox.className =
        "media-select-checkbox";

    checkbox.checked =
        isMediaSelected(
            media.id
        );

    checkbox.addEventListener(
        "click",
        event => {
            event.stopPropagation();
        }
    );

    checkbox.addEventListener(
        "change",
        () => {

            toggleSelectedMedia(
                media.id
            );

            updateMediaItemSelection(
                item
            );

            updateMediaSelectionUI();
        }
    );

    item.appendChild(
        checkbox
    );


    // --------------------------------------------------
    // プレビュー
    // --------------------------------------------------

    if (
        media.type === "image"
    ) {

        createImagePreview(
            preview,
            media,
            thumbnailUrl
        );

    } else if (
        media.type === "video"
    ) {

        createVideoPreview(
            preview,
            media,
            thumbnailUrl
        );
    }


    // --------------------------------------------------
    // メディアクリック
    // --------------------------------------------------

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

            openViewer(
                media
            );
        }
    );


    // --------------------------------------------------
    // 名前
    // --------------------------------------------------

    const name =
        document.createElement("div");

    name.className =
        "media-name";

    name.textContent =
        media.path;


    item.appendChild(
        preview
    );

    item.appendChild(
        name
    );


    updateMediaItemSelection(
        item
    );


    return item;
}


/**
 * 画像プレビュー作成
 */
function createImagePreview(
    preview,
    media,
    thumbnailUrl
) {

    const image =
        document.createElement("img");

    image.src =
        thumbnailUrl;

    image.alt =
        media.path;

    image.loading =
        "lazy";

    preview.appendChild(
        image
    );
}


/**
 * 動画プレビュー作成
 */
function createVideoPreview(
    preview,
    media,
    thumbnailUrl
) {

    const image =
        document.createElement("img");

    image.src =
        thumbnailUrl;

    image.alt =
        media.path;


    preview.appendChild(
        image
    );


    const playIcon =
        document.createElement("div");

    playIcon.className =
        "video-play-icon";

    playIcon.textContent =
        "▶";


    preview.appendChild(
        playIcon
    );
}


// ============================================================
// 選択状態
// ============================================================

/**
 * 選択状態をUIへ反映
 */
export function updateMediaItemSelection(
    item
) {

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
}