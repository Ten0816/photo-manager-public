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

        const url =
            URL.createObjectURL(
                blob
            );

        const link =
            document.createElement("a");

        link.href =
            url;

        link.download =
            media.path
                .split("/")
                .pop();

        document.body.appendChild(
            link
        );

        link.click();

        link.remove();

        URL.revokeObjectURL(
            url
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
