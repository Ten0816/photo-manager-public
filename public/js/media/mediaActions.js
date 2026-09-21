import {
    showPrompt,
    showConfirm,
    showAlert
} from "../modal.js";


// ============================================================
// メディア操作
// ============================================================

/**
 * メディア名前変更
 */
export async function renameMedia(
    media
) {

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
        await showPrompt(
            "ファイル名を変更",
            baseName,
            "新しいファイル名を入力してください。"
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

        await showAlert(
            "ファイル名を変更できません",
            "ファイル名が正しくありません。",
            {
                type: "error"
            }
        );

        return;
    }


    if (
        newBaseName.includes("/") ||
        newBaseName.includes("\\")
    ) {

        await showAlert(
            "ファイル名を変更できません",
            "ファイル名に / や \\ は使用できません。",
            {
                type: "error"
            }
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

        const response =
            await fetch(
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


        return true;

    } catch (error) {

        console.error(error);


        await showAlert(
            "ファイル名の変更に失敗しました",
            error.message,
            {
                type: "error"
            }
        );

        return false;
    }
}


/**
 * メディア削除
 */
export async function deleteMedia(
    media
) {

    const confirmed =
        await showConfirm(
            "ファイルを削除",
            "「" +
            media.path +
            "」をゴミ箱に移しますか？",
            {
                type: "danger",
                confirmText: "ゴミ箱へ移動"
            }
        );


    if (!confirmed) {
        return false;
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


        return true;

    } catch (error) {

        console.error(error);


        await showAlert(
            "ファイルを削除できません",
            error.message,
            {
                type: "error"
            }
        );

        return false;
    }
}