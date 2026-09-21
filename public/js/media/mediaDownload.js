import {
    showAlert
} from "../modal.js";


export async function downloadMedia(
    media
) {
    try {
        const response =
            await fetch(
                "/api/download?path=" +
                encodeURIComponent(
                    media.path
                )
            );

        if (!response.ok) {
            throw new Error(
                "ダウンロードに失敗しました"
            );
        }

        const blob =
            await response.blob();

        downloadBlob(
            blob,
            media.path
                .split("/")
                .pop()
        );

        await showAlert(
            "ダウンロード完了",
            "「" +
            media.path.split("/").pop() +
            "」をダウンロードしました。",
            {
                type: "success"
            }
        );

    } catch (error) {
        console.error(error);

        await showAlert(
            "ダウンロードに失敗しました",
            error.message,
            {
                type: "error"
            }
        );
    }
}


export async function downloadSelectedMedia(
    selectedMedia
) {
    if (
        !Array.isArray(selectedMedia) ||
        selectedMedia.length === 0
    ) {
        return;
    }

    try {
        let blob;
        let fileName;

        if (
            selectedMedia.length === 1
        ) {
            const media =
                selectedMedia[0];

            const response =
                await fetch(
                    "/api/download?path=" +
                    encodeURIComponent(
                        media.path
                    )
                );

            if (!response.ok) {
                throw new Error(
                    "ダウンロードに失敗しました"
                );
            }

            blob =
                await response.blob();

            fileName =
                media.path
                    .split("/")
                    .pop();

        } else {
            const ids =
                selectedMedia.map(
                    media => media.id
                );

            const response =
                await fetch(
                    "/api/download/zip",
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

            if (!response.ok) {
                throw new Error(
                    "ZIPのダウンロードに失敗しました"
                );
            }

            blob =
                await response.blob();

            fileName =
                "photo-manager.zip";
        }

        downloadBlob(
            blob,
            fileName
        );

        await showAlert(
            "ダウンロード完了",
            selectedMedia.length === 1
                ? "ファイルをダウンロードしました。"
                : selectedMedia.length +
                  "件のファイルをZIPでダウンロードしました。",
            {
                type: "success"
            }
        );

    } catch (error) {
        console.error(error);

        await showAlert(
            "ダウンロードに失敗しました",
            error.message,
            {
                type: "error"
            }
        );
    }
}


function downloadBlob(
    blob,
    fileName
) {
    const url =
        URL.createObjectURL(
            blob
        );

    const link =
        document.createElement("a");

    link.href =
        url;

    link.download =
        fileName;

    document.body.appendChild(
        link
    );

    link.click();

    link.remove();

    URL.revokeObjectURL(
        url
    );
}
