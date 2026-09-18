// ============================================================
// DOM
// ============================================================

const mediaList =
    document.getElementById("media-list");

const folderList =
    document.getElementById("folder-list");

const breadcrumb =
    document.getElementById("breadcrumb");

const parentFolderButton =
    document.getElementById(
        "parent-folder-button"
    );

const createFolderButton =
    document.getElementById(
        "create-folder-button"
    );

const fileInput =
    document.getElementById("file-input");

const uploadButton =
    document.getElementById("upload-button");

const uploadStatus =
    document.getElementById("upload-status");

const modal =
    document.getElementById("media-modal");

const modalContent =
    document.getElementById("modal-content");

const modalClose =
    document.getElementById("modal-close");


// ============================================================
// 状態
// ============================================================

let currentFolder = "";

let currentPage = 1;

const pageSize = 100;

let isLoading = false;

let hasMore = true;


// ============================================================
// フォルダ関連
// ============================================================

/**
 * フォルダ一覧を取得して表示
 */
async function loadFolders() {
    try {
        const response = await fetch(
            "/api/folders?path=" +
            encodeURIComponent(
                currentFolder
            )
        );

        if (!response.ok) {
            throw new Error(
                "Failed to fetch folders"
            );
        }

        const data =
            await response.json();

        folderList.innerHTML = "";

        for (
            const folder of data.folders
        ) {
            createFolderItem(folder);
        }

        updateBreadcrumb();
        updateParentButton();

    } catch (error) {
        console.error(error);
    }
}


/**
 * フォルダ1件分のUIを作成
 */
function createFolderItem(folder) {
    const folderElement =
        document.createElement("div");

    const openButton =
        document.createElement("button");

    openButton.textContent =
        "📁 " + folder.name;

    openButton.addEventListener(
        "click",
        () => {
            openFolder(
                folder.path
            );
        }
    );


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

            await renameFolder(
                folder
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

            await deleteFolder(
                folder
            );
        }
    );


    folderElement.appendChild(
        openButton
    );

    folderElement.appendChild(
        renameButton
    );

    folderElement.appendChild(
        deleteButton
    );

    folderList.appendChild(
        folderElement
    );
}


/**
 * フォルダ名前変更
 */
async function renameFolder(folder) {
    const newName = prompt(
        "新しいフォルダ名を入力してください。",
        folder.name
    );

    if (
        !newName ||
        newName === folder.name
    ) {
        return;
    }

    try {
        const response = await fetch(
            "/api/folders?path=" +
            encodeURIComponent(
                folder.path
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
                "Failed to rename folder"
            );
        }

        await loadFolders();

    } catch (error) {
        console.error(error);

        alert(
            "フォルダ名の変更に失敗しました。\n" +
            error.message
        );
    }
}


/**
 * フォルダ削除
 */
async function deleteFolder(folder) {
    const confirmed = confirm(
        "「" +
        folder.name +
        "」を削除しますか？"
    );

    if (!confirmed) {
        return;
    }

    try {
        const response = await fetch(
            "/api/folders?path=" +
            encodeURIComponent(
                folder.path
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
                "Failed to delete folder"
            );
        }

        await loadFolders();

    } catch (error) {
        console.error(error);

        alert(
            error.message
        );
    }
}


/**
 * フォルダを開く
 */
function openFolder(folderPath) {
    currentFolder =
        folderPath;

    loadFolders();
    refreshMedia();
}


/**
 * 親フォルダへ移動
 */
function openParentFolder() {
    if (!currentFolder) {
        return;
    }

    const parts =
        currentFolder.split("/");

    parts.pop();

    currentFolder =
        parts.join("/");

    loadFolders();
    refreshMedia();
}


/**
 * フォルダ作成
 */
async function createFolder() {
    const folderName = prompt(
        "フォルダ名を入力してください。"
    );

    if (!folderName) {
        return;
    }

    try {
        const response = await fetch(
            "/api/folders?path=" +
            encodeURIComponent(
                currentFolder
            ),
            {
                method: "POST",

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body: JSON.stringify({
                    name: folderName
                })
            }
        );

        const data =
            await response.json();

        if (!response.ok) {
            throw new Error(
                data.error ||
                "Failed to create folder"
            );
        }

        await loadFolders();

    } catch (error) {
        console.error(error);

        alert(
            "フォルダの作成に失敗しました。\n" +
            error.message
        );
    }
}


/**
 * パンくずリスト更新
 */
function updateBreadcrumb() {
    breadcrumb.innerHTML = "";

    const rootButton =
        document.createElement("button");

    rootButton.textContent =
        "📁 Memory";

    rootButton.addEventListener(
        "click",
        () => {
            currentFolder = "";

            loadFolders();
            refreshMedia();
        }
    );

    breadcrumb.appendChild(
        rootButton
    );

    if (!currentFolder) {
        return;
    }

    const parts =
        currentFolder.split("/");

    let currentPath = "";

    for (
        const part of parts
    ) {
        currentPath =
            currentPath
                ? currentPath +
                "/" +
                part
                : part;

        const separator =
            document.createElement("span");

        separator.textContent =
            " / ";

        breadcrumb.appendChild(
            separator
        );

        const button =
            document.createElement("button");

        button.textContent =
            part;

        const targetPath =
            currentPath;

        button.addEventListener(
            "click",
            () => {
                currentFolder =
                    targetPath;

                loadFolders();
                refreshMedia();
            }
        );

        breadcrumb.appendChild(
            button
        );
    }
}


/**
 * 親フォルダボタン状態更新
 */
function updateParentButton() {
    parentFolderButton.disabled =
        currentFolder === "";
}


// ============================================================
// メディア一覧
// ============================================================

/**
 * メディア一覧を追加読み込み
 */
async function loadMedia() {
    if (
        isLoading ||
        !hasMore
    ) {
        return;
    }

    isLoading = true;

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
            hasMore = false;
        } else {
            currentPage++;
        }

    } catch (error) {
        console.error(error);

    } finally {
        isLoading = false;
    }
}


/**
 * メディア一覧を最初から読み直す
 */
function refreshMedia() {
    mediaList.innerHTML = "";

    currentPage = 1;

    hasMore = true;

    loadMedia();
}


// ============================================================
// メディアUI
// ============================================================

/**
 * メディア1件分のUIを作成
 */
function createMediaItem(media) {
    const item =
        document.createElement("div");

    item.className =
        "media-item";


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
function createImagePreview(
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
            openImage(
                media
            );
        }
    );
}


/**
 * 動画プレビュー作成
 */
function createVideoPreview(
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
            openVideo(
                mediaUrl
            );
        }
    );
}


// ============================================================
// メディア操作
// ============================================================

/**
 * メディア名前変更
 */
async function renameMedia(media) {
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
async function deleteMedia(
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
// モーダル
// ============================================================

/**
 * 画像を開く
 */
function openImage(media) {
    modalContent.innerHTML = "";

    const image = document.createElement("img");

    image.src =
        "/media/" +
        encodeURI(media.path);

    image.alt = media.path;

    modalContent.appendChild(image);

    const exifInfo =
        document.createElement("div");

    exifInfo.className = "exif-info";

    const takenAt =
        formatTakenAt(media.taken_at);

    const gps =
        media.latitude !== null &&
        media.longitude !== null
            ? `${media.latitude}, ${media.longitude}`
            : "記録されていません";

    exifInfo.innerHTML = `
        <div>
            <strong>撮影日時</strong>
            ${takenAt}
        </div>

        <div>
            <strong>GPS</strong>
            ${gps}
        </div>
    `;

    modalContent.appendChild(exifInfo);

    modal.classList.add("active");

    // 背景ページをスクロールできなくする
    document.body.style.overflow = "hidden";
}

function formatTakenAt(dateString) {
    if (!dateString) {
        return "記録されていません";
    }

    const date = new Date(dateString);

    if (Number.isNaN(date.getTime())) {
        return dateString;
    }

    return date.toLocaleString("ja-JP");
}


/**
 * 動画を開く
 */
function openVideo(url) {
    modalContent.innerHTML = "";

    const video =
        document.createElement("video");

    video.src =
        url;

    video.controls =
        true;

    video.autoplay =
        true;

    modalContent.appendChild(
        video
    );

    modal.classList.add(
        "active"
    );

    video.play().catch(
        (error) => {
            console.error(
                "Video playback failed:",
                error
            );
        }
    );
}


/**
 * モーダルを閉じる
 */
function closeModal() {
    modalContent.innerHTML = "";

    modal.classList.remove("active");

    // 背景ページのスクロールを元に戻す
    document.body.style.overflow = "";
}


// ============================================================
// アップロード
// ============================================================

/**
 * ファイルアップロード
 */
function uploadFiles() {
    const files =
        fileInput.files;

    if (files.length === 0) {
        uploadStatus.textContent =
            "ファイルを選択してください。";

        return;
    }

    const formData =
        new FormData();

    for (
        const file of files
    ) {
        formData.append(
            "files",
            file
        );
    }

    uploadButton.disabled =
        true;

    uploadStatus.textContent =
        "アップロード中... 0%";


    const xhr =
        new XMLHttpRequest();

    xhr.open(
        "POST",
        "/api/upload?path=" +
        encodeURIComponent(
            currentFolder
        )
    );


    // ----------------------------
    // アップロード進捗
    // ----------------------------

    xhr.upload.addEventListener(
        "progress",
        (event) => {
            if (
                !event.lengthComputable
            ) {
                return;
            }

            const progress =
                Math.floor(
                    event.loaded /
                    event.total *
                    100
                );

            uploadStatus.textContent =
                "アップロード中... " +
                progress +
                "%";
        }
    );


    // ----------------------------
    // 完了
    // ----------------------------

    xhr.addEventListener(
        "load",
        async () => {
            try {
                const data =
                    JSON.parse(
                        xhr.responseText
                    );

                if (
                    xhr.status < 200 ||
                    xhr.status >= 300
                ) {
                    throw new Error(
                        data.error ||
                        "Upload failed"
                    );
                }

                uploadStatus.textContent =
                    data.count +
                    " 件のアップロードが完了しました。";

                fileInput.value =
                    "";

                mediaList.innerHTML =
                    "";

                currentPage =
                    1;

                hasMore =
                    true;

                await loadMedia();

            } catch (error) {
                console.error(error);

                uploadStatus.textContent =
                    error.message;

            } finally {
                uploadButton.disabled =
                    false;
            }
        }
    );


    // ----------------------------
    // エラー
    // ----------------------------

    xhr.addEventListener(
        "error",
        () => {
            uploadStatus.textContent =
                "アップロードに失敗しました。";

            uploadButton.disabled =
                false;
        }
    );


    // ----------------------------
    // キャンセル
    // ----------------------------

    xhr.addEventListener(
        "abort",
        () => {
            uploadStatus.textContent =
                "アップロードをキャンセルしました。";

            uploadButton.disabled =
                false;
        }
    );


    xhr.send(
        formData
    );
}


// ============================================================
// イベント
// ============================================================

parentFolderButton.addEventListener(
    "click",
    openParentFolder
);

createFolderButton.addEventListener(
    "click",
    createFolder
);

modalClose.addEventListener(
    "click",
    closeModal
);

modal.addEventListener(
    "click",
    (event) => {
        if (
            event.target === modal
        ) {
            closeModal();
        }
    }
);


document.addEventListener(
    "keydown",
    (event) => {
        if (
            event.key === "Escape"
        ) {
            closeModal();
        }
    }
);


// ============================================================
// 無限スクロール
// ============================================================

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


uploadButton.addEventListener(
    "click",
    uploadFiles
);


// ============================================================
// 初期化
// ============================================================

loadFolders();
loadMedia();