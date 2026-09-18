const mediaList = document.getElementById("media-list");
const folderList = document.getElementById("folder-list");
const breadcrumb = document.getElementById("breadcrumb");
const parentFolderButton =
    document.getElementById("parent-folder-button");
const createFolderButton =
    document.getElementById("create-folder-button");

const fileInput = document.getElementById("file-input");
const uploadButton = document.getElementById("upload-button");
const uploadStatus = document.getElementById("upload-status");

let currentFolder = "";

const modal = document.getElementById("media-modal");
const modalContent = document.getElementById("modal-content");
const modalClose = document.getElementById("modal-close");

let currentPage = 1;
const pageSize = 100;
let isLoading = false;
let hasMore = true;

async function loadMedia() {
    if (isLoading || !hasMore) {
        return;
    }

    isLoading = true;

    try {
        const response = await fetch(
            "/api/media?path=" +
            encodeURIComponent(currentFolder) +
            "&page=" +
            currentPage +
            "&limit=" +
            pageSize
        );

        if (!response.ok) {
            throw new Error("Failed to fetch media list");
        }

        const data = await response.json();

        for (const media of data.media) {
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

async function loadFolders() {
    try {
        const response = await fetch(
            "/api/folders?path=" +
            encodeURIComponent(currentFolder)
        );

        if (!response.ok) {
            throw new Error("Failed to fetch folders");
        }

        const data = await response.json();

        folderList.innerHTML = "";

        for (const folder of data.folders) {
            const folderElement =
                document.createElement("button");

            folderElement.textContent =
                "📁 " + folder.name;

            folderElement.addEventListener("click", () => {
                openFolder(folder.path);
            });

            folderList.appendChild(folderElement);
        }

        updateBreadcrumb();
        updateParentButton();

    } catch (error) {
        console.error(error);
    }
}

function refreshMedia() {
    mediaList.innerHTML = "";
    currentPage = 1;
    hasMore = true;

    loadMedia();
}

function openFolder(folderPath) {
    currentFolder = folderPath;

    loadFolders();
    refreshMedia();
}

function updateBreadcrumb() {
    breadcrumb.innerHTML = "";

    const rootButton =
        document.createElement("button");

    rootButton.textContent = "📁 Memory";

    rootButton.addEventListener("click", () => {
        currentFolder = "";
        loadFolders();
        refreshMedia();
    });

    breadcrumb.appendChild(rootButton);

    if (!currentFolder) {
        return;
    }

    const parts = currentFolder.split("/");

    let path = "";

    for (const part of parts) {
        path = path
            ? path + "/" + part
            : part;

        const separator =
            document.createElement("span");

        separator.textContent = " / ";

        breadcrumb.appendChild(separator);

        const button =
            document.createElement("button");

        button.textContent = part;

        const targetPath = path;

        button.addEventListener("click", () => {
        currentFolder = targetPath;

        loadFolders();
        refreshMedia();
});

        breadcrumb.appendChild(button);
    }
}

function updateParentButton() {
    parentFolderButton.disabled =
        currentFolder === "";
}

parentFolderButton.addEventListener("click", () => {
    if (!currentFolder) {
        return;
    }

    const parts = currentFolder.split("/");

    parts.pop();

    currentFolder = parts.join("/");

    loadFolders();
    refreshMedia();
});

createFolderButton.addEventListener("click", async () => {
    const folderName = prompt(
        "フォルダ名を入力してください。"
    );

    if (!folderName) {
        return;
    }

    try {
        const response = await fetch(
            "/api/folders?path=" +
            encodeURIComponent(currentFolder),
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    name: folderName
                })
            }
        );

        const data = await response.json();

        if (!response.ok) {
            throw new Error(
                data.error || "Failed to create folder"
            );
        }

        await loadFolders();

    } catch (error) {
        console.error(error);

        alert(
            "フォルダの作成に失敗しました。"
        );
    }
});

function createMediaItem(media) {
    const item = document.createElement("div");
    item.className = "media-item";

    const preview = document.createElement("div");
    preview.className = "media-preview";

    const mediaUrl = "/media/" + encodeURI(media.path);

    if (media.type === "image") {
        const image = document.createElement("img");

        image.src = "/api/thumbnail?path=" + encodeURIComponent(media.path);
        image.alt = media.path;
        image.loading = "lazy";

        preview.appendChild(image);

        item.addEventListener("click", () => {
            openImage(mediaUrl);
        });
    }
    else if (media.type === "video") {
        const image = document.createElement("img");

        image.src = "/api/thumbnail?path=" + encodeURIComponent(media.path);
        image.alt = media.path;

        preview.appendChild(image);

        const playIcon = document.createElement("div");

        playIcon.className = "video-play-icon";
        playIcon.textContent = "▶";

        preview.appendChild(playIcon);

        item.addEventListener("click", () => {
            openVideo(mediaUrl);
        });
    }

    const name = document.createElement("div");

    name.className = "media-name";
    name.textContent = media.path;

    item.appendChild(preview);
    item.appendChild(name);

    mediaList.appendChild(item);
}

function openImage(url) {
    modalContent.innerHTML = "";

    const image = document.createElement("img");

    image.src = url;

    modalContent.appendChild(image);
    modal.classList.add("active");
}

function openVideo(url) {
    modalContent.innerHTML = "";

    const video = document.createElement("video");

    video.src = url;
    video.controls = true;
    video.autoplay = true;

    modalContent.appendChild(video);
    modal.classList.add("active");

    video.play().catch((error) => {
        console.error("Video playback failed:", error);
    });
}

function closeModal() {
    modalContent.innerHTML = "";
    modal.classList.remove("active");
}

modalClose.addEventListener("click", () => {
    closeModal();
});

modal.addEventListener("click", (event) => {
    if (event.target === modal) {
        closeModal();
    }
});

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
        closeModal();
    }
});

window.addEventListener("scroll", () => {
    const scrollPosition = window.innerHeight + window.scrollY;
    const pageHeight = document.documentElement.scrollHeight;

    if (scrollPosition >= pageHeight - 1000) {
        loadMedia();
    }
});

uploadButton.addEventListener("click", async () => {
    const files = fileInput.files;

    if (files.length === 0) {
        uploadStatus.textContent =
            "ファイルを選択してください。";

        return;
    }

    const formData = new FormData();

    for (const file of files) {
        formData.append("files", file);
    }

    uploadButton.disabled = true;
    uploadStatus.textContent =
        "アップロード中...";

    try {
        const response = await fetch(
            "/api/upload?path=" +
            encodeURIComponent(currentFolder),
            {
                method: "POST",
                body: formData
            }
        );

        const data = await response.json();

        if (!response.ok) {
            throw new Error(
                data.error || "Upload failed"
            );
        }

        uploadStatus.textContent =
            data.count +
            " 件のアップロードが完了しました。";

        fileInput.value = "";

        // 現在のフォルダのメディア一覧を更新
        mediaList.innerHTML = "";
        currentPage = 1;
        hasMore = true;

        await loadMedia();

    } catch (error) {
        console.error(error);

        uploadStatus.textContent =
            "アップロードに失敗しました。";

    } finally {
        uploadButton.disabled = false;
    }
});

loadFolders();
loadMedia();