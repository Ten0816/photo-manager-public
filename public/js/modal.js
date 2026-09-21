// ============================================================
// カスタムダイアログ
// ============================================================

let modalElement = null;


/**
 * ダイアログ要素を作成
 */
function createModal() {
    if (modalElement) {
        return;
    }

    modalElement =
        document.createElement("div");

    modalElement.className =
        "app-dialog";

    modalElement.hidden = true;

    modalElement.innerHTML = `
        <div class="app-dialog-backdrop"></div>

        <div
            class="app-dialog-panel"
            role="dialog"
            aria-modal="true"
        >
            <div class="app-dialog-title"></div>

            <div class="app-dialog-message"></div>

            <input
                class="app-dialog-input"
                type="text"
            >

            <div class="app-dialog-actions">
                <button
                    type="button"
                    class="app-dialog-cancel"
                >
                    キャンセル
                </button>

                <button
                    type="button"
                    class="app-dialog-confirm"
                >
                    OK
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(
        modalElement
    );
}


/**
 * 共通ダイアログを表示
 */
function showDialog({
    title = "",
    message = "",
    type = "default",
    input = false,
    inputValue = "",
    confirmText = "OK",
    cancelText = "キャンセル"
}) {
    createModal();

    return new Promise(resolve => {
        const titleElement =
            modalElement.querySelector(
                ".app-dialog-title"
            );

        const messageElement =
            modalElement.querySelector(
                ".app-dialog-message"
            );

        const inputElement =
            modalElement.querySelector(
                ".app-dialog-input"
            );

        const cancelButton =
            modalElement.querySelector(
                ".app-dialog-cancel"
            );

        const confirmButton =
            modalElement.querySelector(
                ".app-dialog-confirm"
            );

        titleElement.textContent =
            title;

        messageElement.textContent =
            message;

        inputElement.value =
            inputValue;

        inputElement.hidden =
            !input;

        cancelButton.textContent =
            cancelText;

        confirmButton.textContent =
            confirmText;

        modalElement.dataset.type =
            type;

        modalElement.hidden =
            false;

        document.body.classList.add(
            "dialog-open"
        );

        const finish = value => {
            modalElement.hidden =
                true;

            document.body.classList.remove(
                "dialog-open"
            );

            cleanup();

            resolve(value);
        };

        const handleConfirm = () => {
            if (input) {
                finish(
                    inputElement.value
                );
            } else {
                finish(true);
            }
        };

        const handleCancel = () => {
            finish(
                input
                    ? null
                    : false
            );
        };

        const handleKeyDown = event => {
            if (event.key === "Escape") {
                event.preventDefault();

                handleCancel();
            }

            if (
                event.key === "Enter" &&
                input
            ) {
                event.preventDefault();

                handleConfirm();
            }
        };

        const handleBackdropClick =
            event => {
                if (
                    event.target ===
                    modalElement.querySelector(
                        ".app-dialog-backdrop"
                    )
                ) {
                    handleCancel();
                }
            };

        const cleanup = () => {
            confirmButton.removeEventListener(
                "click",
                handleConfirm
            );

            cancelButton.removeEventListener(
                "click",
                handleCancel
            );

            document.removeEventListener(
                "keydown",
                handleKeyDown
            );

            modalElement.removeEventListener(
                "click",
                handleBackdropClick
            );
        };

        confirmButton.addEventListener(
            "click",
            handleConfirm
        );

        cancelButton.addEventListener(
            "click",
            handleCancel
        );

        document.addEventListener(
            "keydown",
            handleKeyDown
        );

        modalElement.addEventListener(
            "click",
            handleBackdropClick
        );

        if (input) {
            requestAnimationFrame(() => {
                inputElement.focus();

                inputElement.select();
            });
        } else {
            requestAnimationFrame(() => {
                confirmButton.focus();
            });
        }
    });
}


// ============================================================
// Prompt
// ============================================================

/**
 * カスタム prompt
 *
 * キャンセル時は null
 */
export function showPrompt(
    title,
    defaultValue = "",
    message = ""
) {
    return showDialog({
        title,
        message,
        type: "input",
        input: true,
        inputValue: defaultValue,
        confirmText: "変更"
    });
}


// ============================================================
// Confirm
// ============================================================

/**
 * カスタム confirm
 *
 * キャンセル時は false
 */
export function showConfirm(
    title,
    message,
    options = {}
) {
    return showDialog({
        title,
        message,
        type:
            options.type ||
            "default",
        confirmText:
            options.confirmText ||
            "実行",
        cancelText:
            options.cancelText ||
            "キャンセル"
    });
}


// ============================================================
// Alert
// ============================================================

/**
 * カスタム alert
 */
export function showAlert(
    title,
    message,
    options = {}
) {
    return showDialog({
        title,
        message,
        type:
            options.type ||
            "default",
        confirmText:
            options.confirmText ||
            "OK",
        cancelText:
            ""
    }).then(() => {
        return true;
    });
}