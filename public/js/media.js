import {
    currentFolder,
    currentPage,
    pageSize,
    isLoading,
    hasMore,
    setIsLoading,
    setHasMore,
    nextPage,
    resetMediaState
} from "./state.js";

import {
    mediaList
} from "./dom.js";

import {
    openViewer
} from "./viewer.js";


// ============================================================
// メディア一覧
// ============================================================

/**
 * メディア一覧を追加読み込み
 */
export async function loadMedia() {
    if (
        isLoading ||
        !hasMore
    ) {
        return;
    }

    setIsLoading(true);

    try {
        const response = await fetch(
            "/api/media?path=" +
            encodeURIComponent(
                currentFolder
            ) +
            "&page=" +
            currentPage +
            "&limit=" +
            pageSize
        );

        if (!response.ok) {
            throw new Error(
                "Failed to fetch media list"
            );
        }

        const data =
            await response.json();

        for (
            const media of data.media
        ) {
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


/**
 * メディア1件分のUIを作成
 */
export function createMediaItem(media) {
    const item =
        document.createElement("div");

    item.className =
        "media-item";

    item.mediaData = media;


    // ----------------------------
    // プレビュー
    // ----------------------------

    const preview =
        document.createElement("div");

    preview.className =
        "media-preview";

    const mediaUrl =
        "/media/" +
        encodeURI(media.path);

    const thumbnailUrl =
        "/api/thumbnail?path=" +
        encodeURIComponent(
            media.path
        );


    if (
        media.type === "image"
    ) {
        createImagePreview(
            item,
            preview,
            media,
            mediaUrl,
            thumbnailUrl
        );

    } else if (
        media.type === "video"
    ) {
        createVideoPreview(
            item,
            preview,
            media,
            mediaUrl,
            thumbnailUrl
        );
    }


    // ----------------------------
    // ファイル名
    // ----------------------------

    const name =
        document.createElement("div");

    name.className =
        "media-name";

    name.textContent =
        media.path;


    // ----------------------------
    // 名前変更
    // ----------------------------

    const renameButton =
        document.createElement("button");

    renameButton.textContent =
        "名前変更";

    renameButton.addEventListener(
        "click",
        async (event) => {
            event.stopPropagation();

            await renameMedia(
                media
            );
        }
    );


    // ----------------------------
    // 削除
    // ----------------------------

    const deleteButton =
        document.createElement("button");

    deleteButton.textContent =
        "削除";

    deleteButton.addEventListener(
        "click",
        async (event) => {
            event.stopPropagation();

            await deleteMedia(
                media,
                item
            );
        }
    );


    item.appendChild(
        preview
    );

    item.appendChild(
        name
    );

    item.appendChild(
        renameButton
    );

    item.appendChild(
        deleteButton
    );

    mediaList.appendChild(
        item
    );
}


/**
 * 画像プレビュー作成
 */
export function createImagePreview(
    item,
    preview,
    media,
    mediaUrl,
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

    item.addEventListener(
        "click",
        () => {
            openViewer(
                media
            );
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
    mediaUrl,
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

    item.addEventListener(
        "click",
        () => {
            openViewer(
                media
            );
        }
    );
}


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

        refreshMedia();

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
// イベント
// ============================================================

export function initMediaEvents() {

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