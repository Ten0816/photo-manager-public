export let currentFolder = "";

export let currentPage = 1;

export const pageSize = 100;

export let isLoading = false;

export let hasMore = true;

// メディアの並び順
export let mediaSort = "date-desc";

// 選択モード
export let isSelectionMode = false;

// 選択中のメディアID
export const selectedMediaIds = new Set();

export function setCurrentFolder(folder) {
    currentFolder = folder;
}

export function resetMediaState() {
    currentPage = 1;
    hasMore = true;
}

export function setIsLoading(value) {
    isLoading = value;
}

export function setHasMore(value) {
    hasMore = value;
}

export function nextPage() {
    currentPage++;
}

export function setMediaSort(value) {
    mediaSort = value;
}

export function setSelectionMode(value) {
    isSelectionMode = value;

    if (!value) {
        selectedMediaIds.clear();
    }
}

export function toggleSelectedMedia(id) {
    if (selectedMediaIds.has(id)) {
        selectedMediaIds.delete(id);
    } else {
        selectedMediaIds.add(id);
    }
}

export function clearSelectedMedia() {
    selectedMediaIds.clear();
}

export function selectMedia(id) {
    selectedMediaIds.add(id);
}

export function isMediaSelected(id) {
    return selectedMediaIds.has(id);
}