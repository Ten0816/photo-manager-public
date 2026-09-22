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
} from "./media/media.js";

import {
    showPrompt,
    showConfirm,
    showAlert
} from "./modal.js";


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

    folderElement.className =
        "folder-item";


    // ========================================================
    // フォルダを開く
    // ========================================================

    const openButton =
        document.createElement("button");

    openButton.className =
        "folder-open-button";

    openButton.addEventListener(
        "click",
        () => {
            openFolder(folder.path);
        }
    );


    const icon =
        document.createElement("div");

    icon.className =
        "folder-icon";

    icon.textContent =
        "📁";


    const name =
        document.createElement("span");

    name.className =
        "folder-name";

    name.textContent =
        folder.name;


    openButton.appendChild(icon);
    openButton.appendChild(name);


    // ========================================================
    // 操作メニュー
    // ========================================================

    const actions =
        document.createElement("div");

    actions.className =
        "folder-actions";


    // --------------------------------------------------------
    // メニューボタン
    // --------------------------------------------------------

    const menuButton =
        document.createElement("button");

    menuButton.className =
        "folder-menu-button";

    menuButton.textContent =
        "⋮";

    menuButton.title =
        "フォルダの操作";


    // --------------------------------------------------------
    // メニュー
    // --------------------------------------------------------

    const menu =
        document.createElement("div");

    menu.className =
        "folder-menu";

    menu.hidden = true;


    // ========================================================
    // 名前変更
    // ========================================================

    const renameButton =
        document.createElement("button");

    renameButton.className =
        "folder-menu-item";

    renameButton.textContent =
        "名前を変更";


    renameButton.addEventListener(
        "click",
        async (event) => {
            event.stopPropagation();

            menu.hidden = true;

            await renameFolder(folder);
        }
    );


    // ========================================================
    // 削除
    // ========================================================

    const deleteButton =
        document.createElement("button");

    deleteButton.className =
        "folder-menu-item folder-menu-delete";

    deleteButton.textContent =
        "削除";


    deleteButton.addEventListener(
        "click",
        async (event) => {
            event.stopPropagation();

            menu.hidden = true;

            await deleteFolder(folder);
        }
    );


    menu.appendChild(renameButton);
    menu.appendChild(deleteButton);


    // ========================================================
    // メニュー開閉
    // ========================================================

    menuButton.addEventListener(
        "click",
        (event) => {
            event.stopPropagation();

            const isOpening =
                menu.hidden;

            // 他のメニューを閉じる
            document
                .querySelectorAll(".folder-menu")
                .forEach((otherMenu) => {
                    otherMenu.hidden = true;
                });

            document
                .querySelectorAll(".folder-item")
                .forEach((otherItem) => {
                    otherItem.classList.remove(
                        "menu-open"
                    );
                });

            // このメニューを開く
            if (isOpening) {
                menu.hidden = false;

                folderElement.classList.add(
                    "menu-open"
                );
            }
        }
    );


    actions.appendChild(menuButton);
    actions.appendChild(menu);


    // ========================================================
    // DOM
    // ========================================================

    folderElement.appendChild(
        openButton
    );

    folderElement.appendChild(
        actions
    );

    folderList.appendChild(
        folderElement
    );
}


/**
 * フォルダ名前変更
 */
export async function renameFolder(folder) {
    const newName =
        await showPrompt(
            "フォルダ名を変更",
            folder.name,
            "新しいフォルダ名を入力してください。"
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

        await showAlert(
            "フォルダ名を変更できません",
            error.message,
            {
                type: "error"
            }
        );
    }
}


/**
 * フォルダ削除
 */
export async function deleteFolder(folder) {
    const confirmed =
        await showConfirm(
            "フォルダを削除",
            "「" +
            folder.name +
            "」を削除しますか？",
            {
                type: "danger",
                confirmText: "削除"
            }
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

        await showAlert(
            "フォルダを削除できません",
            error.message,
            {
                type: "error"
            }
        );
    }
}


/**
 * フォルダを開く
 */
export function openFolder(folderPath) {

    history.pushState(
        {
            view: "folder",
            folder: folderPath
        },
        "",
        "#folder=" +
        encodeURIComponent(folderPath)
    );

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

    const parentPath =
        parts.join("/");

    history.pushState(
        {
            view: "folder",
            folder: parentPath
        },
        "",
        "#folder=" +
        encodeURIComponent(parentPath)
    );

    setCurrentFolder(
        parentPath
    );

    loadFolders();
    refreshMedia();
}


/**
 * フォルダ作成
 */
export async function createFolder() {
    const folderName =
        await showPrompt(
            "新しいフォルダ",
            "",
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

        await showAlert(
            "フォルダを作成できません",
            error.message,
            {
                type: "error"
            }
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

            history.pushState(
                {
                    view: "folder",
                    folder: ""
                },
                "",
                "#folder="
            );

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

                history.pushState(
                    {
                        view: "folder",
                        folder: targetPath
                    },
                    "",
                    "#folder=" +
                    encodeURIComponent(targetPath)
                );

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


    /*
     * 初期状態を履歴に登録
     */
    if (!history.state) {

        history.replaceState(
            {
                view: "folder",
                folder: currentFolder
            },
            "",
            "#folder=" +
            encodeURIComponent(currentFolder)
        );
    }


    /*
     * ブラウザの戻る・進む
     */
    window.addEventListener(
        "popstate",
        async event => {

            const state =
                event.state;

            /*
             * フォルダ履歴の場合
             */
            if (
                state?.view === "folder"
            ) {

                setCurrentFolder(
                    state.folder || ""
                );

                await loadFolders();
                await refreshMedia();

                return;
            }
        }
    );
}