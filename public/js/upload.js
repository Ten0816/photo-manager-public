import {
    fileInput,
    uploadButton,
    uploadStatus,
    mediaList
} from "./dom.js";

import {
    currentFolder,
    resetMediaState
} from "./state.js";

import {
    loadMedia
} from "./media/media.js";


/**
 * アップロードイベントを初期化
 */
export function initUpload() {

    uploadButton.addEventListener(
        "click",
        uploadFiles
    );
}


/**
 * ファイルアップロード
 */
export function uploadFiles() {

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


                resetMediaState();


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