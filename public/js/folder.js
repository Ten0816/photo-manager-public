import {
    currentFolder,
    setCurrentFolder
} from "./state.js";

import {
    folderList,
    breadcrumb,
    parentFolderButton,
    createFolderButton
} from "./dom.js";

import {
    refreshMedia
} from "./media.js";


// ============================================================
// フォルダ関連
// ============================================================

/**
 * フォルダ一覧を取得して表示
 */
export async function loadFolders() {
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
export function createFolderItem(folder) {
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
export async function renameFolder(folder) {
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
export async function deleteFolder(folder) {
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
export function openFolder(folderPath) {
    setCurrentFolder(
        folderPath
    );

    loadFolders();
    refreshMedia();
}


/**
 * 親フォルダへ移動
 */
export function openParentFolder() {
    if (!currentFolder) {
        return;
    }

    const parts =
        currentFolder.split("/");

    parts.pop();

    setCurrentFolder(
        parts.join("/")
    );

    loadFolders();
    refreshMedia();
}


/**
 * フォルダ作成
 */
export async function createFolder() {
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
export function updateBreadcrumb() {
    breadcrumb.innerHTML = "";

    const rootButton =
        document.createElement("button");

    rootButton.textContent =
        "📁 Memory";

    rootButton.addEventListener(
        "click",
        () => {
            setCurrentFolder("");

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
                setCurrentFolder(
                    targetPath
                );

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
export function updateParentButton() {
    parentFolderButton.disabled =
        currentFolder === "";
}


// ============================================================
// イベント
// ============================================================

export function initFolderEvents() {

    parentFolderButton.addEventListener(
        "click",
        openParentFolder
    );

    createFolderButton.addEventListener(
        "click",
        createFolder
    );
}