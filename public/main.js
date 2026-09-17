const mediaList = document.getElementById("media-list");

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
            "/api/media?page=" + currentPage + "&limit=" + pageSize
        );

        if (!response.ok) {
            throw new Error("Failed to fetch media list");
        }

        const data = await response.json();

        for (const media of data.media) {
            createMediaItem(media);
        }

        if (data.media.length < pageSize) {
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

loadMedia();