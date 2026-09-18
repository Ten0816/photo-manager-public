export let currentFolder = "";

export let currentPage = 1;

export const pageSize = 100;

export let isLoading = false;

export let hasMore = true;


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